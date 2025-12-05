import { Router } from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query, getConnection } from '../config/db.js';
import { requireAuth, requireAdmin, requireEditorOrAdmin } from '../middleware/auth.js';
import sanitizeHtml from 'sanitize-html';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', '..', 'logs');
const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    // Keep original filename (sanitize + fix common latin1->utf8 mojibake)
    let original = file.originalname || `upload-${Date.now()}`;
    try {
      const recoded = Buffer.from(original, 'latin1').toString('utf8');
      if (recoded && recoded !== original) original = recoded;
    } catch {}
    const base = path.basename(original);
    const safe = base.replace(/[\/:*?"<>|]+/g, '_').slice(0, 180);
    let finalName = safe || `file-${Date.now()}`;
    try {
      const ext = path.extname(finalName);
      const stem = finalName.slice(0, finalName.length - ext.length) || 'file';
      let idx = 1;
      while (fs.existsSync(path.join(uploadDir, finalName))) {
        finalName = `${stem} (${idx})${ext}`;
        idx += 1;
      }
    } catch {}
    cb(null, finalName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedPrefixes = ['image/', 'video/'];
    const allowedExact = new Set([
      'application/pdf',
      // Word
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // PowerPoint
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Excel
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]);
    if (allowedPrefixes.some(p => file.mimetype.startsWith(p)) || allowedExact.has(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'));
  }
});

export const apiAdminRouter = Router();

// 後台登入／登出
apiAdminRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const rows = await query('SELECT * FROM users WHERE username = ?', [username]);
  const user = rows[0];
  if (!user) {
    try { fs.appendFileSync(path.join(logsDir, 'auth.log'), `[${new Date().toISOString()}] admin_login_fail user=${username}\n`); } catch {}
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) {
    try { fs.appendFileSync(path.join(logsDir, 'auth.log'), `[${new Date().toISOString()}] admin_login_fail user=${username}\n`); } catch {}
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const preserveMember = req.session?.member || null;
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.user = { id: user.id, username: user.username, role: user.role, must_change_password: !!user.must_change_password };
    if (preserveMember) req.session.member = preserveMember;
    res.json({ id: user.id, username: user.username, role: user.role, must_change_password: !!user.must_change_password });
  });
});

apiAdminRouter.post('/logout', requireAuth, (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.user = null;
  res.json({ ok: true });
});

apiAdminRouter.get('/me', (req, res) => {
  res.json(req.session.user || null);
});

// Change own password
apiAdminRouter.post('/users/me/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const rows = await query('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
  const user = rows[0];
  if (!user) return res.status(400).json({ error: 'User not found' });
  const ok = await bcrypt.compare(String(current_password || ''), user.password_hash);
  if (!ok) return res.status(400).json({ error: 'Current password incorrect' });
  const hash = await bcrypt.hash(String(new_password || ''), 10);
  await query('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', [hash, user.id]);
  req.session.user.must_change_password = false;
  res.json({ ok: true });
});

// 站台設定 CRUD
apiAdminRouter.get('/settings', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM settings');
  res.json(rows);
});
apiAdminRouter.post('/settings', requireEditorOrAdmin, async (req, res) => {
  const entries = Object.entries(req.body || {});
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    for (const [key, value] of entries) {
      await conn.execute('INSERT INTO settings(`key`,`value`) VALUES(?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)', [key, String(value)]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// 內容清洗（允許 iframe/img 以供編輯器使用）
function sanitizeContent(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'iframe', 'video', 'source']),
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt'],
      iframe: ['src', 'allow', 'allowfullscreen', 'frameborder'],
      '*': ['style', 'class']
    }
  });
}

// Example: pages CRUD (similar patterns apply to posts, news, etc.)
apiAdminRouter.get('/pages', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM pages ORDER BY id DESC');
  res.json(rows);
});
apiAdminRouter.post('/pages', requireAuth, async (req, res) => {
  const { slug, title, content_html, background_image_id, is_published } = req.body || {};
  await query(
    'INSERT INTO pages(slug, title, content_html, background_image_id, is_published) VALUES (?,?,?,?,?)\n     ON DUPLICATE KEY UPDATE title=VALUES(title), content_html=VALUES(content_html), background_image_id=VALUES(background_image_id), is_published=VALUES(is_published)'
    , [
      String(slug), String(title), sanitizeContent(content_html), background_image_id || null, is_published ? 1 : 0
    ]
  );
  res.json({ ok: true });
});
apiAdminRouter.put('/pages/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { slug, title, content_html, background_image_id, is_published } = req.body || {};
  await query('UPDATE pages SET slug=?, title=?, content_html=?, background_image_id=?, is_published=? WHERE id=?', [
    String(slug), String(title), sanitizeContent(content_html), background_image_id || null, is_published ? 1 : 0, id
  ]);
  res.json({ ok: true });
});

// 關於頁（講師／我們／基金帳戶）讀取與儲存
apiAdminRouter.get('/about', requireAuth, async (_req, res) => {
  const teacher = await query('SELECT content_html, background_image_id FROM pages WHERE slug = ? LIMIT 1', ['about-teacher']);
  const aboutus = await query('SELECT content_html, background_image_id FROM pages WHERE slug = ? LIMIT 1', ['about-us']);
  const ftmo = await query('SELECT content_html, background_image_id FROM pages WHERE slug = ? LIMIT 1', ['about-ftmo']);
  res.json({ teacher: teacher[0] || null, aboutus: aboutus[0] || null, ftmo: ftmo[0] || null });
});
apiAdminRouter.delete('/pages/:id', requireEditorOrAdmin, async (req, res) => {
  await query('DELETE FROM pages WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// 媒體上傳（含圖片縮圖）
apiAdminRouter.post('/media/upload', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });
  let thumbPath = null;
  if (file.mimetype.startsWith('image/')) {
    try {
      const thumbName = file.filename.replace(/(\.[^.]+)$/, '_thumb$1');
      const fullThumbPath = path.join(uploadDir, thumbName);
      await sharp(file.path).resize(480).jpeg({ quality: 80 }).toFile(fullThumbPath);
      thumbPath = `/uploads/${thumbName}`;
    } catch {}
  }
  // Store a display name with utf8 fixed for DB as well
  let displayName = file.originalname || '';
  try {
    const recoded = Buffer.from(displayName, 'latin1').toString('utf8');
    if (recoded) displayName = recoded;
  } catch {}
  const result = await query('INSERT INTO media(file_name, file_path, mime_type, file_size, created_at) VALUES (?,?,?,?, NOW())', [
    displayName,
    `/uploads/${file.filename}`,
    file.mimetype,
    file.size
  ]);
  const mediaId = result && typeof result === 'object' && 'insertId' in result ? result.insertId : null;
  res.json({ ok: true, media_id: mediaId, path: `/uploads/${file.filename}`, thumb: thumbPath });
});

// List media
apiAdminRouter.get('/media', requireAuth, async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 24)));
  const offset = (page - 1) * limit;
  const qstr = String(req.query.q || '').trim();
  const where = [];
  const params = [];
  if (qstr) { where.push('(file_name LIKE ? OR mime_type LIKE ?)'); params.push(`%${qstr}%`, `%${qstr}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 24;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
  const items = await query(
    `SELECT id, file_name, file_path, mime_type, created_at FROM media ${whereSql}
     ORDER BY id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`, params
  );
  const [{ cnt }] = await query(`SELECT COUNT(1) AS cnt FROM media ${whereSql}`, params);
  res.json({ items, page, limit, total: cnt });
});

// 媒體刪除（會一併刪實體檔與縮圖）
apiAdminRouter.delete('/media/:id', requireEditorOrAdmin, async (req, res) => {
  const { id } = req.params;
  const rows = await query('SELECT file_path FROM media WHERE id = ? LIMIT 1', [id]);
  const record = rows[0];
  await query('DELETE FROM media WHERE id = ?', [id]);
  if (record && record.file_path) {
    try {
      const original = path.join(uploadDir, path.basename(record.file_path));
      try { fs.unlinkSync(original); } catch {}
      const thumb = original.replace(/(\.[^.]+)$/, '_thumb$1');
      try { fs.unlinkSync(thumb); } catch {}
    } catch {}
  }
  res.json({ ok: true });
});

// 媒體使用處查詢
apiAdminRouter.get('/media/:id/usage', requireAuth, async (req, res) => {
  const { id } = req.params;
  const [posts, news, leaderboard, plans, pages, slides] = await Promise.all([
    query('SELECT id, title, slug FROM posts WHERE cover_media_id = ?', [id]),
    query('SELECT id, title, slug FROM news WHERE cover_media_id = ?', [id]),
    query('SELECT id, title, slug FROM leaderboard WHERE cover_media_id = ?', [id]),
    query('SELECT id, name AS title, slug FROM plans WHERE cover_media_id = ?', [id]),
    query('SELECT id, title, slug FROM pages WHERE background_image_id = ?', [id]),
    query('SELECT id, title FROM slides WHERE media_id = ?', [id])
  ]);
  res.json({ posts, news, leaderboard, plans, pages, slides });
});

// 部落格 CRUD
apiAdminRouter.get('/posts', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM posts ORDER BY id DESC');
  res.json(rows);
});
apiAdminRouter.post('/posts', requireAuth, async (req, res) => {
  const { title, slug, excerpt, content_html, cover_media_id, published_at, is_published } = req.body || {};
  await query('INSERT INTO posts(title, slug, excerpt, content_html, cover_media_id, published_at, is_published) VALUES (?,?,?,?,?,?,?)', [
    String(title), String(slug), String(excerpt || ''), sanitizeContent(content_html), cover_media_id || null, published_at || null, is_published ? 1 : 0
  ]);
  res.json({ ok: true });
});
apiAdminRouter.put('/posts/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, slug, excerpt, content_html, cover_media_id, published_at, is_published } = req.body || {};
  await query('UPDATE posts SET title=?, slug=?, excerpt=?, content_html=?, cover_media_id=?, published_at=?, is_published=? WHERE id=?', [
    String(title), String(slug), String(excerpt || ''), sanitizeContent(content_html), cover_media_id || null, published_at || null, is_published ? 1 : 0, id
  ]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/posts/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM posts WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// 最新消息 CRUD
apiAdminRouter.get('/news', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM news ORDER BY id DESC');
  res.json(rows);
});
apiAdminRouter.post('/news', requireAuth, async (req, res) => {
  const { title, slug, content_html, excerpt, cover_media_id, published_at, is_published } = req.body || {};
  await query('INSERT INTO news(title, slug, content_html, excerpt, cover_media_id, published_at, is_published) VALUES (?,?,?,?,?,?,?)', [
    String(title), String(slug), sanitizeContent(content_html), String(excerpt || ''), cover_media_id || null, published_at || null, is_published ? 1 : 0
  ]);
  res.json({ ok: true });
});
apiAdminRouter.put('/news/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, slug, content_html, excerpt, cover_media_id, published_at, is_published } = req.body || {};
  await query('UPDATE news SET title=?, slug=?, content_html=?, excerpt=?, cover_media_id=?, published_at=?, is_published=? WHERE id=?', [
    String(title), String(slug), sanitizeContent(content_html), String(excerpt || ''), cover_media_id || null, published_at || null, is_published ? 1 : 0, id
  ]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/news/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM news WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// 傳奇榜 CRUD（文章型）
apiAdminRouter.get('/leaderboard', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM leaderboard ORDER BY id DESC');
  res.json(rows);
});
apiAdminRouter.post('/leaderboard', requireAuth, async (req, res) => {
  const { title, slug, excerpt, content_html, cover_media_id, published_at, is_published } = req.body || {};
  await query('INSERT INTO leaderboard(title, slug, excerpt, content_html, cover_media_id, published_at, is_published) VALUES (?,?,?,?,?,?,?)', [
    String(title), String(slug), String(excerpt || ''), sanitizeContent(content_html), cover_media_id || null, published_at || null, is_published ? 1 : 0
  ]);
  res.json({ ok: true });
});
apiAdminRouter.put('/leaderboard/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, slug, excerpt, content_html, cover_media_id, published_at, is_published } = req.body || {};
  await query('UPDATE leaderboard SET title=?, slug=?, excerpt=?, content_html=?, cover_media_id=?, published_at=?, is_published=? WHERE id=?', [
    String(title), String(slug), String(excerpt || ''), sanitizeContent(content_html), cover_media_id || null, published_at || null, is_published ? 1 : 0, id
  ]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/leaderboard/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM leaderboard WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// 方案 CRUD（文章欄位）
apiAdminRouter.get('/plans', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM plans ORDER BY id DESC');
  res.json(rows);
});
apiAdminRouter.post('/plans', requireAuth, async (req, res) => {
  const { name, price, tagline, features_json, is_active, title, slug, excerpt, content_html, cover_media_id, published_at, is_published } = req.body || {};
  const effectiveTitle = (title && String(title).trim()) ? String(title).trim() : String(name || '').trim();
  await query('INSERT INTO plans(name, price, tagline, features_json, is_active, title, slug, excerpt, content_html, cover_media_id, published_at, is_published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
    String(name || ''), Number(price || 0), tagline || null, JSON.stringify([]), is_active ? 1 : 0,
    effectiveTitle, String(slug || ''), String(excerpt || ''), sanitizeContent(content_html), cover_media_id || null, published_at || null, is_published ? 1 : 0
  ]);
  res.json({ ok: true });
});
apiAdminRouter.put('/plans/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, price, tagline, features_json, is_active, title, slug, excerpt, content_html, cover_media_id, published_at, is_published } = req.body || {};
  const effectiveTitle = (title && String(title).trim()) ? String(title).trim() : String(name || '').trim();
  await query('UPDATE plans SET name=?, price=?, tagline=?, features_json=?, is_active=?, title=?, slug=?, excerpt=?, content_html=?, cover_media_id=?, published_at=?, is_published=? WHERE id=?', [
    String(name || ''), Number(price || 0), tagline || null, JSON.stringify([]), is_active ? 1 : 0,
    effectiveTitle, String(slug || ''), String(excerpt || ''), sanitizeContent(content_html), cover_media_id || null, published_at || null, is_published ? 1 : 0, id
  ]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/plans/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM plans WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// 實例見證 CRUD
apiAdminRouter.get('/testimonials', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM testimonials ORDER BY id DESC');
  res.json(rows);
});
apiAdminRouter.post('/testimonials', requireAuth, async (req, res) => {
  const { title, slug, excerpt, content_html, video_url, cover_media_id, published_at, is_published } = req.body || {};
  await query('INSERT INTO testimonials(title, slug, excerpt, content_html, video_url, cover_media_id, published_at, is_published) VALUES (?,?,?,?,?,?,?,?)', [
    String(title), String(slug), String(excerpt || ''), sanitizeContent(content_html), video_url || null, cover_media_id || null, published_at || null, is_published ? 1 : 0
  ]);
  res.json({ ok: true });
});
apiAdminRouter.put('/testimonials/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, slug, excerpt, content_html, video_url, cover_media_id, published_at, is_published } = req.body || {};
  await query('UPDATE testimonials SET title=?, slug=?, excerpt=?, content_html=?, video_url=?, cover_media_id=?, published_at=?, is_published=? WHERE id=?', [
    String(title), String(slug), String(excerpt || ''), sanitizeContent(content_html), video_url || null, cover_media_id || null, published_at || null, is_published ? 1 : 0, id
  ]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/testimonials/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM testimonials WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// 課程試讀 CRUD
apiAdminRouter.get('/trial', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM trial_contents ORDER BY id DESC');
  res.json(rows);
});
apiAdminRouter.post('/trial', requireAuth, async (req, res) => {
  const { title, type, content_html, video_url, is_public } = req.body || {};
  await query('INSERT INTO trial_contents(title, type, content_html, video_url, is_public) VALUES (?,?,?,?,?)', [
    String(title), type === 'video' ? 'video' : 'article', sanitizeContent(content_html), video_url || null, is_public ? 1 : 0
  ]);
  res.json({ ok: true });
});
apiAdminRouter.put('/trial/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, type, content_html, video_url, is_public } = req.body || {};
  await query('UPDATE trial_contents SET title=?, type=?, content_html=?, video_url=?, is_public=? WHERE id=?', [
    String(title), type === 'video' ? 'video' : 'article', sanitizeContent(content_html), video_url || null, is_public ? 1 : 0, id
  ]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/trial/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM trial_contents WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// 聯絡表單列表與已處理標記
apiAdminRouter.get('/contacts', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM contacts ORDER BY created_at DESC');
  res.json(rows);
});
apiAdminRouter.put('/contacts/:id/process', requireAuth, async (req, res) => {
  await query('UPDATE contacts SET processed=1 WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// 選單 CRUD 與排序
apiAdminRouter.get('/menus', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM menus ORDER BY parent_id IS NOT NULL, parent_id, order_index');
  res.json(rows);
});
apiAdminRouter.post('/menus', requireAuth, async (req, res) => {
  const { parent_id, title, slug, url, order_index, visible } = req.body || {};
  await query('INSERT INTO menus(parent_id, title, slug, url, order_index, visible) VALUES (?,?,?,?,?,?)', [
    parent_id || null, String(title), String(slug || ''), url || null, Number(order_index || 0), visible ? 1 : 0
  ]);
  res.json({ ok: true });
});
apiAdminRouter.put('/menus/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { parent_id, title, slug, url, order_index, visible } = req.body || {};
  await query('UPDATE menus SET parent_id=?, title=?, slug=?, url=?, order_index=?, visible=? WHERE id=?', [
    parent_id || null, String(title), String(slug || ''), url || null, Number(order_index || 0), visible ? 1 : 0, id
  ]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/menus/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM menus WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});
apiAdminRouter.post('/menus/reorder', requireAuth, async (req, res) => {
  const { orders } = req.body || {};
  if (!Array.isArray(orders)) return res.status(400).json({ error: 'orders required' });
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    for (const { id, order_index } of orders) {
      await conn.execute('UPDATE menus SET order_index=? WHERE id=?', [Number(order_index || 0), id]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
});

// 後台使用者管理
apiAdminRouter.get('/users', requireAdmin, async (_req, res) => {
  const rows = await query('SELECT id, username, role, must_change_password, created_at FROM users ORDER BY id');
  res.json(rows);
});
apiAdminRouter.post('/users', requireAdmin, async (req, res) => {
  const { username, password, role } = req.body || {};
  const hash = await bcrypt.hash(String(password || ''), 10);
  await query('INSERT INTO users(username, password_hash, role, must_change_password) VALUES (?,?,?,?)', [
    String(username), hash, role === 'editor' ? 'editor' : 'admin', 0
  ]);
  res.json({ ok: true });
});

// 首頁輪播 CRUD
apiAdminRouter.get('/slides', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM slides ORDER BY order_index ASC, id DESC');
  res.json(rows);
});

// 上課內容 CRUD（YouTube 連結）
apiAdminRouter.get('/courses', requireAuth, async (_req, res) => {
  const rows = await query('SELECT * FROM course_contents ORDER BY id DESC');
  res.json(rows);
});
apiAdminRouter.post('/courses', requireAuth, async (req, res) => {
  const { title, video_url, category, min_tier, is_active } = req.body || {};
  const allowed = new Set(['free','basic','advanced','platinum']);
  const tier = allowed.has(String(min_tier)) ? String(min_tier) : 'free';
  await query('INSERT INTO course_contents(title, video_url, category, min_tier, is_active) VALUES (?,?,?,?,?)', [String(title), String(video_url), String(category || 'general'), tier, is_active ? 1 : 0]);
  res.json({ ok: true });
});
apiAdminRouter.put('/courses/:id', requireAuth, async (req, res) => {
  const { title, video_url, category, min_tier, is_active } = req.body || {};
  const allowed = new Set(['free','basic','advanced','platinum']);
  const tier = allowed.has(String(min_tier)) ? String(min_tier) : 'free';
  await query('UPDATE course_contents SET title=?, video_url=?, category=?, min_tier=?, is_active=? WHERE id=?', [String(title), String(video_url), String(category || 'general'), tier, is_active ? 1 : 0, req.params.id]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/courses/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM course_contents WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// 上課教材 CRUD（透過媒體庫檔案）
apiAdminRouter.get('/materials', requireAuth, async (_req, res) => {
  const rows = await query('SELECT cm.*, m.file_name, m.file_path FROM course_materials cm JOIN media m ON m.id = cm.media_id ORDER BY cm.id DESC');
  res.json(rows);
});
apiAdminRouter.post('/materials', requireAuth, async (req, res) => {
  const { title, media_id, min_tier, is_active } = req.body || {};
  const allowed = new Set(['free','basic','advanced','platinum']);
  const tier = allowed.has(String(min_tier)) ? String(min_tier) : 'free';
  await query('INSERT INTO course_materials(title, media_id, min_tier, is_active) VALUES (?,?,?,?)', [String(title), Number(media_id), tier, is_active ? 1 : 0]);
  res.json({ ok: true });
});
apiAdminRouter.put('/materials/:id', requireAuth, async (req, res) => {
  const { title, media_id, min_tier, is_active } = req.body || {};
  const allowed = new Set(['free','basic','advanced','platinum']);
  const tier = allowed.has(String(min_tier)) ? String(min_tier) : 'free';
  await query('UPDATE course_materials SET title=?, media_id=?, min_tier=?, is_active=? WHERE id=?', [String(title), Number(media_id), tier, is_active ? 1 : 0, req.params.id]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/materials/:id', requireAuth, async (req, res) => {
  await query('DELETE FROM course_materials WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});
apiAdminRouter.post('/slides', requireAuth, async (req, res) => {
  const { media_id, title, link_url, order_index, is_active } = req.body || {};
  await query('INSERT INTO slides(media_id, title, link_url, order_index, is_active) VALUES (?,?,?,?,?)', [
    Number(media_id), title || null, link_url || null, Number(order_index || 0), is_active ? 1 : 0
  ]);
  res.json({ ok: true });
});
apiAdminRouter.put('/slides/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { media_id, title, link_url, order_index, is_active } = req.body || {};
  await query('UPDATE slides SET media_id=?, title=?, link_url=?, order_index=?, is_active=? WHERE id=?', [
    Number(media_id), title || null, link_url || null, Number(order_index || 0), is_active ? 1 : 0, id
  ]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/slides/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  // get media file path
  const rows = await query('SELECT m.file_path FROM slides s JOIN media m ON m.id = s.media_id WHERE s.id = ?', [id]);
  const r = rows[0];
  await query('DELETE FROM slides WHERE id = ?', [id]);
  if (r && r.file_path) {
    try {
      const p = path.join(uploadDir, path.basename(r.file_path));
      fs.unlinkSync(p);
      const thumb = p.replace(/(\.[^.]+)$/, '_thumb$1');
      try { fs.unlinkSync(thumb); } catch {}
      // also delete from media table
      await query('DELETE FROM media WHERE file_path = ?', [r.file_path]);
    } catch {}
  }
  res.json({ ok: true });
});
apiAdminRouter.put('/users/:id', requireAdmin, async (req, res) => {
  const { role, must_change_password } = req.body || {};
  await query('UPDATE users SET role=?, must_change_password=? WHERE id=?', [
    role === 'editor' ? 'editor' : 'admin', must_change_password ? 1 : 0, req.params.id
  ]);
  res.json({ ok: true });
});

// Reset another user's password (admin only)
apiAdminRouter.post('/users/:id/password', requireAdmin, async (req, res) => {
  const { new_password } = req.body || {};
  const userId = req.params.id;
  if (!new_password || String(new_password).length < 4) {
    return res.status(400).json({ error: 'New password too short' });
  }
  const hash = await bcrypt.hash(String(new_password), 10);
  await query('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', [hash, userId]);
  res.json({ ok: true });
});

// 會員管理（後台）
apiAdminRouter.get('/members', requireEditorOrAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = await query(
      'SELECT id, email, username, name, chinese_name, english_name, tier, is_active, created_at FROM members WHERE email LIKE ? OR name LIKE ? OR username LIKE ? OR id_number LIKE ? ORDER BY id DESC',
      [like, like, like, like]
    );
  } else {
    rows = await query('SELECT id, email, username, name, chinese_name, english_name, tier, is_active, created_at FROM members ORDER BY id DESC');
  }
  res.json(rows);
});
apiAdminRouter.put('/members/:id', requireEditorOrAdmin, async (req, res) => {
  const { tier, is_active, name } = req.body || {};
  const allowed = new Set(['free','basic','advanced','platinum']);
  const t = allowed.has(String(tier)) ? String(tier) : 'free';
  await query('UPDATE members SET name=?, tier=?, is_active=? WHERE id=?', [name || null, t, is_active ? 1 : 0, req.params.id]);
  res.json({ ok: true });
});
apiAdminRouter.delete('/members/:id', requireEditorOrAdmin, async (req, res) => {
  const memberId = String(req.params.id);
  await query('DELETE FROM members WHERE id=?', [memberId]);
  // remove uploaded folder
  try {
    const baseDir = path.join(__dirname, '..', '..', 'private_member_uploads', memberId);
    if (fs.existsSync(baseDir)) {
      try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch {
        // fallback: attempt to delete files then dir
        try { fs.readdirSync(baseDir).forEach(f => { try { fs.unlinkSync(path.join(baseDir, f)); } catch {} }); fs.rmdirSync(baseDir); } catch {}
      }
    }
  } catch {}
  res.json({ ok: true });
});

// 會員完整資料
apiAdminRouter.get('/members/:id', requireEditorOrAdmin, async (req, res) => {
  const rows = await query('SELECT id, email, username, name, chinese_name, english_name, gender, birth_date, id_number, phone_mobile, phone_landline, address, line_id, special_needs, referrer, tier, is_active, created_at FROM members WHERE id = ? LIMIT 1', [req.params.id]);
  res.json(rows[0] || null);
});

// 會員上傳檔案列表
apiAdminRouter.get('/members/:id/files', requireEditorOrAdmin, async (req, res) => {
  const memberId = String(req.params.id);
  const baseDir = path.join(__dirname, '..', '..', 'private_member_uploads', memberId);
  let items = [];
  try {
    const files = fs.readdirSync(baseDir);
    items = files.map((f) => ({ name: f, url: `/api/public/members/files/${encodeURIComponent(f)}` }));
  } catch {
    items = [];
  }
  res.json({ items });
});

// 刪除會員上傳檔案（後台）
apiAdminRouter.delete('/members/:id/files/:filename', requireEditorOrAdmin, async (req, res) => {
  const memberId = String(req.params.id);
  const filename = path.basename(String(req.params.filename));
  const baseDir = path.join(__dirname, '..', '..', 'private_member_uploads', memberId);
  const target = path.join(baseDir, filename);
  try {
    fs.unlinkSync(target);
  } catch {}
  // if directory becomes empty, it's fine to keep
  res.json({ ok: true });
});


