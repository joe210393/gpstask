import 'dotenv/config';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import fs from 'fs';
import morgan from 'morgan';
import session from 'express-session';
import csrf from 'csurf';
import { fileURLToPath } from 'url';
import { apiPublicRouter } from './routes/api.public.js';
import { apiAdminRouter } from './routes/api.admin.js';
import { query } from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 基本安全標頭（含 CSP）— 允許試讀影片之 YouTube/Vimeo iframe
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameSrc: [
          "'self'",
          'https://www.youtube.com',
          'https://www.youtube-nocookie.com',
          'https://player.vimeo.com'
        ]
      }
    }
  })
);

// 請求日誌
app.use(morgan('dev'));

// 若部署在反向代理（例如 Zeabur/Nginx/Cloudflare）後方，可透過環境變數啟用
const trustProxyEnv = String(process.env.TRUST_PROXY || '').toLowerCase();
if (trustProxyEnv && trustProxyEnv !== '0' && trustProxyEnv !== 'false' && trustProxyEnv !== 'off') {
  app.set('trust proxy', 1);
}

// 解析請求本文
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 工作階段（Session）
const sessionSecret = process.env.SESSION_SECRET || 'change_this_secret';
app.use(
  session({
    name: 'sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

// CSRF 防護（基於 Session 的 Token）
const csrfProtection = csrf();
// Lightweight in-memory rate limiter (per IP+path)
function createLimiter(windowMs, max) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const hit = buckets.get(key);
    if (!hit || now > hit.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    hit.count += 1;
    if (hit.count > max) return res.status(429).json({ error: 'Too many requests' });
    next();
  };
}
const limiterLogin = createLimiter(10 * 60 * 1000, 20);
const limiterUpload = createLimiter(10 * 60 * 1000, 60);
const limiterContact = createLimiter(10 * 60 * 1000, 30);

// 靜態檔案目錄
const publicDir = path.join(__dirname, '..', 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const privateMemberDir = path.join(__dirname, '..', 'private_member_uploads');
const logsDir = path.join(__dirname, '..', 'logs');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}
try { fs.mkdirSync(privateMemberDir, { recursive: true }); } catch {}
try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
app.use(express.static(publicDir, { extensions: ['html'] }));

// 前台 API（附帶 CSRF 防護）
// Apply targeted rate limits on specific subpaths first
app.use('/api/public/members/login', limiterLogin);
app.use('/api/public/members/upload', limiterUpload);
app.use('/api/public/contact', limiterContact);
app.use('/api/public', csrfProtection, apiPublicRouter);

// 後台 API（需登入 Session，亦套用 CSRF 防護）
// 加上後台登入的速率限制
app.use('/api/admin/login', limiterLogin);
app.use('/api/admin', csrfProtection, apiAdminRouter);

// 舊版公開下載連結的相容層（需本人 Session 才允許轉導）
app.get('/member_uploads/:memberId/:filename', (req, res) => {
  if (!req.session?.member?.id) return res.status(401).end();
  const { memberId, filename } = req.params;
  if (String(req.session.member.id) !== String(memberId)) return res.status(403).end();
  res.redirect(`/api/public/members/files/${encodeURIComponent(filename)}`);
});

// 健康檢查
app.get('/healthz', (_req, res) => res.json({ ok: true }));
// 資料庫健康檢查（除錯用）
app.get('/healthz/db', async (_req, res) => {
  try {
    const [{ now }] = await query('SELECT NOW() AS now');
    res.json({ ok: true, now });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

// Serve known static html pages explicitly (single-file pages)
const pages = ['index.html','about-teacher.html','about-us.html','about-ftmo.html','blog.html','blog-post.html','news.html','news-post.html','leaderboard.html','leader.html','plans.html','plan.html','contact.html','trial.html','login.html','register.html','user.html','admin/members.html'];
pages.forEach(p => {
  app.get('/' + (p === 'index.html' ? '' : p), (_req, res) => res.sendFile(path.join(publicDir, p)));
});

// 404 for API
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 全域錯誤處理（含 CSRF 錯誤）
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});


