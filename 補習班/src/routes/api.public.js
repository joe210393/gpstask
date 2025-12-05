import { Router } from 'express';
import { query } from '../config/db.js';
import bcrypt from 'bcrypt';
import sanitizeHtml from 'sanitize-html';
import { exposeCsrfToken } from '../middleware/csrf.js';
import { sendContactMail } from '../config/mailer.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';

export const apiPublicRouter = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', '..', 'logs');

// CSRF 取得端點（回傳前端可用之 CSRF Token）
apiPublicRouter.get('/csrf', exposeCsrfToken);

// 站台設定（含背景與 LINE 連結等）
apiPublicRouter.get('/settings', async (_req, res) => {
  try {
    const rows = await query('SELECT `key`, `value` FROM settings');
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    if (!('default_bg_color' in settings)) settings.default_bg_color = '#f5f6f8';
    return res.json(settings);
  } catch {
    // DB 異常時提供安全預設，避免前端報錯
    return res.json({ default_bg_color: '#f5f6f8' });
  }
});

// 導覽選單（前台渲染使用）
apiPublicRouter.get('/menus', async (_req, res) => {
  try {
    const rows = await query('SELECT * FROM menus WHERE visible = 1 ORDER BY parent_id IS NOT NULL, parent_id, order_index');
    res.json(rows);
  } catch {
    // 發生錯誤時回傳空清單，保留靜態導覽列
    res.json([]);
  }
});

// 單一頁面（後台發佈的靜態內容）
apiPublicRouter.get('/pages/:slug', async (req, res) => {
  const { slug } = req.params;
  const rows = await query('SELECT p.*, m.file_path AS background_image_url FROM pages p LEFT JOIN media m ON m.id = p.background_image_id WHERE p.slug = ? AND p.is_published = 1', [slug]);
  const page = rows[0];
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(page);
});

// 部落格列表（支援分頁與搜尋）
apiPublicRouter.get('/posts', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();
  const where = ['is_published = 1'];
  const params = [];
  if (search) {
    where.push('(title LIKE ? OR excerpt LIKE ? )');
    params.push(`%${search}%`, `%${search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 10;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
  const items = await query(
    `SELECT p.id, p.title, p.slug, p.excerpt, p.cover_media_id, p.published_at, m.file_path AS cover_url
     FROM posts p LEFT JOIN media m ON m.id = p.cover_media_id
     ${whereSql.replaceAll('posts','p')} ORDER BY p.published_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );
  const [{ cnt }] = await query(`SELECT COUNT(1) AS cnt FROM posts ${whereSql}`, params);
  res.json({ items, page, limit, total: cnt });
});

// 部落格內頁
apiPublicRouter.get('/posts/:slug', async (req, res) => {
  const rows = await query('SELECT * FROM posts WHERE slug = ? AND is_published = 1', [req.params.slug]);
  const post = rows[0];
  if (!post) return res.status(404).json({ error: 'Not found' });
  res.json(post);
});

// 最新消息 列表／內頁
apiPublicRouter.get('/news', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();
  const where = ['is_published = 1'];
  const params = [];
  if (search) {
    where.push('(title LIKE ? )');
    params.push(`%${search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit2 = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 10;
  const safeOffset2 = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
  const items = await query(
    `SELECT n.id, n.title, n.slug, n.published_at, n.excerpt, m.file_path AS cover_url
     FROM news n LEFT JOIN media m ON m.id = n.cover_media_id
     ${whereSql.replaceAll('news','n')} ORDER BY n.published_at DESC LIMIT ${safeLimit2} OFFSET ${safeOffset2}`,
    params
  );
  const [{ cnt }] = await query(`SELECT COUNT(1) AS cnt FROM news ${whereSql}`, params);
  res.json({ items, page, limit, total: cnt });
});

apiPublicRouter.get('/news/:slug', async (req, res) => {
  const rows = await query('SELECT * FROM news WHERE slug = ? AND is_published = 1', [req.params.slug]);
  const item = rows[0];
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// 傳奇榜清單（僅已發佈、含封面）
apiPublicRouter.get('/leaderboard', async (_req, res) => {
  const rows = await query(
    'SELECT l.id, l.title, l.slug, l.excerpt, m.file_path AS cover_url FROM leaderboard l LEFT JOIN media m ON m.id = l.cover_media_id WHERE l.is_published = 1 ORDER BY COALESCE(l.published_at, l.id) DESC'
  );
  res.json(rows);
});

// 傳奇榜內頁
apiPublicRouter.get('/leaderboard/:slug', async (req, res) => {
  const rows = await query('SELECT l.*, m.file_path AS cover_url FROM leaderboard l LEFT JOIN media m ON m.id = l.cover_media_id WHERE l.slug = ? AND l.is_published = 1 LIMIT 1', [req.params.slug]);
  const item = rows[0];
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// 實例見證清單
apiPublicRouter.get('/testimonials', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 12)));
  const offset = (page - 1) * limit;
  const rows = await query(
    `SELECT t.id, t.title, t.slug, t.excerpt, t.video_url, t.published_at, m.file_path AS cover_url
     FROM testimonials t LEFT JOIN media m ON m.id = t.cover_media_id
     WHERE t.is_published = 1 ORDER BY COALESCE(t.published_at, t.id) DESC LIMIT ${limit} OFFSET ${offset}`
  );
  const [{ cnt }] = await query('SELECT COUNT(1) AS cnt FROM testimonials WHERE is_published = 1');
  res.json({ items: rows, page, limit, total: cnt });
});

// 實例見證內頁
apiPublicRouter.get('/testimonials/:slug', async (req, res) => {
  const rows = await query('SELECT t.*, m.file_path AS cover_url FROM testimonials t LEFT JOIN media m ON m.id = t.cover_media_id WHERE t.slug = ? AND t.is_published = 1 LIMIT 1', [req.params.slug]);
  const item = rows[0];
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// 課程方案清單
apiPublicRouter.get('/plans', async (_req, res) => {
  const rows = await query('SELECT p.id, p.name, p.price, p.tagline, p.slug, p.content_html, p.published_at, m.file_path AS cover_url FROM plans p LEFT JOIN media m ON m.id = p.cover_media_id WHERE p.is_active = 1 AND p.is_published = 1 ORDER BY COALESCE(p.published_at, p.id) DESC');
  res.json(rows);
});

// 課程方案內頁
apiPublicRouter.get('/plans/:slug', async (req, res) => {
  const rawParam = String(req.params.slug || '').trim();
  if (!rawParam) return res.status(404).json({ error: 'Not found' });
  const lookupById = req.query.by_id === '1' && /^[0-9]+$/.test(rawParam);
  const condition = lookupById ? 'p.id = ?' : 'p.slug = ?';
  const bindValue = lookupById ? Number(rawParam) : rawParam;
  const rows = await query(
    `SELECT p.*, m.file_path AS cover_url
     FROM plans p
     LEFT JOIN media m ON m.id = p.cover_media_id
     WHERE ${condition} AND p.is_active = 1 AND p.is_published = 1
     LIMIT 1`,
    [bindValue]
  );
  const plan = rows[0];
  if (!plan) return res.status(404).json({ error: 'Not found' });
  res.json(plan);
});

// 課程試讀清單（公開可見）
apiPublicRouter.get('/trial', async (_req, res) => {
  const rows = await query('SELECT * FROM trial_contents WHERE is_public = 1 ORDER BY id');
  res.json(rows);
});

// 首頁輪播圖（公開）
apiPublicRouter.get('/slides', async (_req, res) => {
  const rows = await query('SELECT s.id, s.title, s.link_url, s.order_index, m.file_path AS image_url FROM slides s JOIN media m ON m.id = s.media_id WHERE s.is_active = 1 ORDER BY s.order_index ASC, s.id DESC');
  res.json(rows);
});

// 上課內容（YouTube 連結），依會員等級篩選
apiPublicRouter.get('/courses', async (req, res) => {
  const tierOrder = { free: 0, basic: 1, advanced: 2, platinum: 3 };
  const memberTier = req.session?.member?.tier || 'free';
  const minRank = tierOrder[memberTier] ?? 0;
  const allowedTiers = Object.entries(tierOrder).filter(([,v]) => v <= minRank).map(([k]) => `'${k}'`).join(',');
  const rows = await query(`SELECT id, title, video_url, category, min_tier FROM course_contents WHERE is_active = 1 AND min_tier IN (${allowedTiers}) ORDER BY id DESC`);
  res.json(rows);
});

// 上課教材清單，依會員等級篩選
apiPublicRouter.get('/materials', async (req, res) => {
  const tierOrder = { free: 0, basic: 1, advanced: 2, platinum: 3 };
  const memberTier = req.session?.member?.tier || 'free';
  const minRank = tierOrder[memberTier] ?? 0;
  const allowedTiers = Object.entries(tierOrder).filter(([,v]) => v <= minRank).map(([k]) => `'${k}'`).join(',');
  const rows = await query(`SELECT cm.id, cm.title, cm.min_tier, m.file_path, m.file_name FROM course_materials cm JOIN media m ON m.id = cm.media_id WHERE cm.is_active = 1 AND cm.min_tier IN (${allowedTiers}) ORDER BY cm.id DESC`);
  res.json(rows);
});

// 聯絡表單送出（會寄通知信）
apiPublicRouter.post('/contact', async (req, res) => {
  const { name = '', email = '', phone = '', message = '' } = req.body || {};
  const cleanName = String(name).slice(0, 100).trim();
  const cleanEmail = String(email).slice(0, 150).trim();
  const cleanPhone = String(phone).slice(0, 30).trim();
  const cleanMessage = sanitizeHtml(String(message).slice(0, 5000), { allowedTags: [], allowedAttributes: {} });
  if (!cleanName || !cleanEmail || !cleanMessage) return res.status(400).json({ error: 'Missing required fields' });
  await query('INSERT INTO contacts(name, email, phone, message, created_at) VALUES (?,?,?,?, NOW())', [cleanName, cleanEmail, cleanPhone, cleanMessage]);
  try { await sendContactMail({ name: cleanName, email: cleanEmail, phone: cleanPhone, message: cleanMessage }); } catch {}
  res.json({ ok: true });
});

// 會員註冊與登入（公開）
apiPublicRouter.post('/members/register', async (req, res) => {
  const { email, password, name, chinese_name, english_name, gender, birth_date, id_number, phone_mobile, phone_landline, address, line_id, special_needs, referrer, username, password_hint_question, password_hint_answer } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const exists = await query('SELECT id FROM members WHERE email = ? OR username = ? LIMIT 1', [String(email), String(username || '')]);
  if (exists.length) return res.status(400).json({ error: 'Email already registered' });
  const hash = await bcrypt.hash(String(password), 10);
  const hintHash = password_hint_answer ? await bcrypt.hash(String(password_hint_answer), 10) : null;
  await query(`INSERT INTO members(email, username, password_hash, name, chinese_name, english_name, gender, birth_date, id_number, passport_number, phone_mobile, phone_landline, address, line_id, wechat_id, special_needs, referrer, password_hint_question, password_hint_answer_hash)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    String(email), username || null, hash, name || null, chinese_name || null, english_name || null,
    ['male','female','other'].includes(gender) ? gender : null,
    birth_date || null, id_number || null, null, phone_mobile || null, phone_landline || null,
    address || null, line_id || null, null, special_needs || null, referrer || null,
    password_hint_question || null, hintHash
  ]);
  // 註冊後自動登入（若帳號啟用）
  const [{ id, tier, is_active }] = await query('SELECT id, tier, is_active FROM members WHERE email = ? LIMIT 1', [String(email)]);
  if (is_active) {
    req.session.member = { id, email: String(email), name: name || null, tier };
  }
  res.json({ ok: true });
});

apiPublicRouter.post('/members/login', async (req, res) => {
  const { account, password } = req.body || {};
  const rows = await query('SELECT id, email, username, password_hash, name, tier, is_active FROM members WHERE email = ? OR username = ? LIMIT 1', [String(account), String(account)]);
  const m = rows[0];
  if (!m || !m.is_active) {
    try { fs.appendFileSync(path.join(logsDir, 'auth.log'), `[${new Date().toISOString()}] member_login_fail account=${account}\n`); } catch {}
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(String(password || ''), m.password_hash);
  if (!ok) {
    try { fs.appendFileSync(path.join(logsDir, 'auth.log'), `[${new Date().toISOString()}] member_login_fail account=${account}\n`); } catch {}
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const preserveAdmin = req.session?.user || null;
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.member = { id: m.id, email: m.email, name: m.name, tier: m.tier };
    if (preserveAdmin) req.session.user = preserveAdmin;
    res.json({ id: m.id, email: m.email, name: m.name, tier: m.tier });
  });
});

apiPublicRouter.post('/members/logout', async (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.member = null;
  res.json({ ok: true });
});

apiPublicRouter.get('/members/me', async (req, res) => {
  res.json(req.session?.member || null);
});

// 會員完整資料（需已登入）
apiPublicRouter.get('/members/profile', async (req, res) => {
  const member = req.session?.member;
  if (!member?.id) return res.status(401).json({ error: 'Unauthorized' });
  const rows = await query('SELECT id, email, username, name, chinese_name, english_name, gender, birth_date, id_number, phone_mobile, phone_landline, address, line_id, special_needs, referrer, tier, is_active, created_at FROM members WHERE id = ? LIMIT 1', [member.id]);
  const m = rows[0];
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

// 會員檔案上傳（需已登入）
// 儲存路徑：每位會員一個獨立資料夾（私有目錄）
const memberStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const member = req.session?.member;
    if (!member?.id) return cb(new Error('Unauthorized'), '');
    const dir = path.join(process.cwd(), 'private_member_uploads', String(member.id));
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const member = req.session?.member;
    // keep original filename (sanitized), make unique if already exists
    let original = file.originalname || `upload-${Date.now()}`;
    try {
      const recoded = Buffer.from(original, 'latin1').toString('utf8');
      if (recoded && recoded !== original) original = recoded;
    } catch {}
    const base = path.basename(original);
    const safe = base.replace(/[\/:*?"<>|]+/g, '_').slice(0, 180);
    const dir = path.join(process.cwd(), 'private_member_uploads', String(member?.id || '')); 
    let finalName = safe || `file-${Date.now()}`;
    try {
      const ext = path.extname(finalName);
      const stem = finalName.slice(0, finalName.length - ext.length) || 'file';
      let idx = 1;
      while (fs.existsSync(path.join(dir, finalName))) {
        finalName = `${stem} (${idx})${ext}`;
        idx += 1;
      }
    } catch {}
    cb(null, finalName);
  }
});

const memberUpload = multer({
  storage: memberStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mt = file.mimetype || '';
    const allowedPrefixes = ['image/', 'video/'];
    const allowedExact = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv',
      'application/octet-stream'
    ]);
    if (allowedPrefixes.some(p => mt.startsWith(p)) || allowedExact.has(mt)) cb(null, true);
    else cb(new Error('Invalid file type'));
  }
});

function requireMemberAuth(req, res, next) {
  if (!req.session?.member?.id) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

apiPublicRouter.post('/members/upload', requireMemberAuth, memberUpload.array('files', 20), async (req, res) => {
  // 若為 multipart 多檔上傳：回傳可下載連結（受保護路由）
  if (Array.isArray(req.files) && req.files.length) {
    const items = req.files.map(f => ({ name: path.basename(f.filename || f.originalname || f.path), url: `/api/public/members/files/${encodeURIComponent(path.basename(f.filename || f.path))}` }));
    return res.json({ ok: true, items });
  }
  // 後備方案：原始串流上傳（單檔，透過 X-Filename）
  try {
    const member = req.session?.member;
    const chunks = [];
    const rawName = req.headers['x-filename'] ? String(req.headers['x-filename']) : `upload-${Date.now()}`;
    // decode and sanitize filename
    const safeName = path.basename(decodeURIComponent(rawName));
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const dir = path.join(process.cwd(), 'private_member_uploads', String(member.id));
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      const target = path.join(dir, safeName);
      fs.writeFileSync(target, buf);
      res.json({ ok: true, items: [{ name: safeName, url: `/api/public/members/files/${encodeURIComponent(safeName)}` }] });
    });
  } catch (e) {
    try { fs.appendFileSync(path.join(logsDir, 'upload.log'), `[${new Date().toISOString()}] member_upload_raw_fail id=${req.session?.member?.id||''} reason=${e?.message||''}\n`); } catch {}
    res.status(400).json({ error: 'Upload failed' });
  }
});

// 列出本人上傳之檔案（合併顯示舊 public 與新私有目錄）
apiPublicRouter.get('/members/files', requireMemberAuth, async (req, res) => {
  const memberId = String(req.session.member.id);
  const baseDir = path.join(process.cwd(), 'private_member_uploads', memberId);
  const legacyDir = path.join(process.cwd(), 'public', 'member_uploads', memberId);
  let items = [];
  try {
    const files = fs.readdirSync(baseDir);
    items = files.map((f) => ({ name: f, url: `/api/public/members/files/${encodeURIComponent(f)}` }));
  } catch {
    items = [];
  }
  // Also include legacy public folder files for backward compatibility
  try {
    const legacy = fs.readdirSync(legacyDir);
    const existing = new Set(items.map(i => i.name));
    legacy.forEach(f => { if (!existing.has(f)) items.push({ name: f, url: `/member_uploads/${memberId}/${encodeURIComponent(f)}` }); });
  } catch {}
  res.json({ items });
});

// 受保護下載路由（需登入且僅能下載自己的檔案）
apiPublicRouter.get('/members/files/:filename', requireMemberAuth, async (req, res) => {
  const memberId = String(req.session.member.id);
  const filename = path.basename(String(req.params.filename));
  const baseDir = path.join(process.cwd(), 'private_member_uploads', memberId);
  const target = path.join(baseDir, filename);
  try {
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.sendFile(target);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// Debug path route
apiPublicRouter.get('/debug-paths', async (_req, res) => {
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  const privateDir = path.join(process.cwd(), 'private_member_uploads');
  let uploadsFiles = [];
  let privateFiles = [];
  try { uploadsFiles = fs.readdirSync(uploadDir); } catch(e) { uploadsFiles = [String(e)]; }
  try { privateFiles = fs.readdirSync(privateDir); } catch(e) { privateFiles = [String(e)]; }
  
  res.json({
    cwd: process.cwd(),
    uploadDir,
    privateDir,
    uploads_content_sample: uploadsFiles.slice(0, 20),
    private_content_sample: privateFiles.slice(0, 20)
  });
});


