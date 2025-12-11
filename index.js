const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// JWT 設定
const JWT_SECRET = process.env.JWT_SECRET || 'gps-task-secret-key-change-in-production';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

const app = express();

// 設定圖片上傳目錄
// 如果 /data/public/images 存在 (Zeabur 環境)，就使用該路徑
// 否則使用本地 public/images
const ZEABUR_UPLOAD_PATH = '/data/public/images';
const UPLOAD_DIR = fs.existsSync(ZEABUR_UPLOAD_PATH) 
  ? ZEABUR_UPLOAD_PATH 
  : path.join(__dirname, 'public/images');
  
console.log('📁 圖片儲存路徑:', UPLOAD_DIR);

// CORS 設定 - 根據環境變數限制網域
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'https://gpstask.zeabur.app'];

const corsOptions = {
  origin: (origin, callback) => {
    // 允許沒有 origin 的請求（如 Postman 或 curl）
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.warn(`🚫 CORS 阻擋來源: ${origin}`);
      return callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true, // 允許 cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400 // 預檢請求快取 24 小時
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ charset: 'utf-8' }));

// 優先從 UPLOAD_DIR 提供圖片服務，這對於掛載的 Volume 很重要
// 當請求 /images/xxx.jpg 時，會先去 UPLOAD_DIR 找
app.use('/images', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// 設置響應字符集
app.use((req, res, next) => {
  // 對於 API 路由，設置正確的字符集
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});

const dbConfig = {
  host: process.env.MYSQL_HOST || 'hkg1.clusters.zeabur.com', // Zeabur MySQL host
  user: process.env.MYSQL_USERNAME || 'root',
  password: process.env.MYSQL_ROOT_PASSWORD || '5N29BnfD0RbMw4Wd6y1iVPEgUI783voa', // Zeabur MySQL password
  database: process.env.MYSQL_DATABASE || 'zeabur',
  port: process.env.MYSQL_PORT || 32121, // Zeabur MySQL port
  charset: 'utf8mb4' // 設置字符集為 UTF-8，避免中文亂碼
};

const ALLOWED_TASK_TYPES = ['qa', 'multiple_choice', 'photo'];

// JWT 工具函數
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
}

// 測試資料庫連接
async function testDatabaseConnection() {
  let conn;
  try {
    console.log('🔄 測試資料庫連接...');
    conn = await mysql.createConnection(dbConfig);
    console.log('✅ 資料庫連接成功');
    return true;
  } catch (error) {
    console.error('❌ 資料庫連接失敗:', error.message);
    console.error('   錯誤詳情:', error);
    return false;
  } finally {
    if (conn) await conn.end();
  }
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// JWT 認證中間層
function authenticateToken(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ success: false, message: '未提供認證令牌' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ success: false, message: '認證令牌無效或已過期' });
  }

  req.user = decoded;
  next();
}

// 兼容性認證中間層 - 同時支持JWT和臨時用戶資訊（用於遷移期間）
function authenticateTokenCompat(req, res, next) {
  // 首先嘗試JWT認證
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }

  // 如果沒有JWT token，檢查是否有臨時的用戶資訊
  const tempUser = req.headers['x-user-info'];
  if (tempUser) {
    try {
      const userInfo = JSON.parse(tempUser);
      if (userInfo && userInfo.id && userInfo.username && userInfo.role) {
        req.user = userInfo;
        return next();
      }
    } catch (e) {
      // 解析失敗，繼續到錯誤處理
    }
  }

  return res.status(401).json({ success: false, message: '未認證' });
}

// RBAC 角色授權中間層
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未認證' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: '權限不足' });
    }

    next();
  };
}

// 安全的檔案上傳配置
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // 確保目錄存在
      if (!fs.existsSync(UPLOAD_DIR)) {
        try {
          fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        } catch (err) {
          console.error('建立上傳目錄失敗:', err);
        }
      }
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      // 生成安全的檔案名稱：時間戳 + 隨機字串 + 副檔名
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const extension = path.extname(file.originalname).toLowerCase();
      cb(null, uniqueSuffix + extension);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB 限制
    files: 1 // 一次只能上傳一個檔案
  },
  fileFilter: (req, file, cb) => {
    // 允許的檔案類型和 MIME types
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp'
    ];

    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

    const fileExtension = path.extname(file.originalname).toLowerCase();

    // 檢查 MIME type 和副檔名
    if (allowedTypes.includes(file.mimetype) && allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('不支援的檔案類型。只允許 JPG、PNG、GIF、WebP 圖片檔案。'), false);
    }
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !role) {
    return res.status(400).json({ success: false, message: '缺少參數' });
  }
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    if (role === 'user') {
      // 手機門號登入 - 不需要密碼驗證
      const [users] = await conn.execute('SELECT * FROM users WHERE username = ? AND role = ?', [username, 'user']);
      if (users.length === 0) {
        return res.status(400).json({ success: false, message: '查無此用戶' });
      }

      // 生成 JWT token
      const token = generateToken(users[0]);

      // 設置 httpOnly cookie
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      // 返回用戶信息
      const userResponse = {
        id: users[0].id,
        username: users[0].username,
        role: users[0].role
      };

      res.json({ success: true, user: userResponse });
    } else if (role === 'staff' || role === 'shop' || role === 'admin') {
      // 帳號密碼登入 - 支援舊的 'staff' 和新的 'shop' 角色
      const [users] = await conn.execute('SELECT * FROM users WHERE username = ? AND role IN (?, ?, ?)', [username, 'staff', 'shop', 'admin']);
      if (users.length === 0) {
        return res.status(400).json({ success: false, message: '查無此帳號' });
      }

      const storedPassword = users[0].password;
      let match = false;

      // 所有密碼都必須是 bcrypt hash 格式
      if (storedPassword && (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$'))) {
        // 使用 bcrypt 比較
        match = await bcrypt.compare(password, storedPassword);
      } else {
        // 密碼格式錯誤或為空，拒絕登入
        match = false;
        console.warn(`用戶 ${username} 的密碼格式不正確`);
      }

      if (!match) {
        return res.status(400).json({ success: false, message: '密碼錯誤' });
      }

      // 生成 JWT token
      const token = generateToken(users[0]);

      // 設置 httpOnly cookie
      res.cookie('token', token, {
        httpOnly: true, // 防止 XSS 攻擊
        secure: process.env.NODE_ENV === 'production', // 生產環境使用 HTTPS
        sameSite: 'strict', // 防止 CSRF 攻擊
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 天
      });

      // 返回用戶信息（不包含敏感數據）
      const userResponse = {
        id: users[0].id,
        username: users[0].username,
        role: users[0].role
      };

      res.json({ success: true, user: userResponse });
    } else {
      return res.status(400).json({ success: false, message: '角色錯誤' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 登出 API - 清除 JWT cookie
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: '已成功登出' });
});

// 獲取當前用戶信息 API
app.get('/api/me', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});



// 根據優惠券代碼查詢優惠券（商家核銷用）

// 商家核銷優惠券

// 獲取今日核銷歷史（商家用）

// 創建優惠券（任務完成後自動調用）

app.post('/api/register', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !role) {
    return res.status(400).json({ success: false, message: '缺少參數' });
  }
  if (role === 'user') {
    // 手機門號註冊，不需密碼
    if (!/^09[0-9]{8}$/.test(username)) {
      return res.status(400).json({ success: false, message: '請輸入正確的手機門號' });
    }
  } else if (role === 'staff' || role === 'admin') {
    if (!password) {
      return res.status(400).json({ success: false, message: '請填寫密碼' });
    }
  } else {
    return res.status(400).json({ success: false, message: '角色錯誤' });
  }
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    // 檢查帳號是否已存在
    const [exist] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (exist.length > 0) {
      return res.status(400).json({ success: false, message: '帳號已存在' });
    }
    // 寫入資料庫
    await conn.execute(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, password || null, role]
    );
    res.json({ success: true, message: '註冊成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 查詢所有任務
// 獲取任務（前端用）
app.get('/api/tasks', async (req, res) => {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute('SELECT * FROM tasks WHERE 1=1 ORDER BY id DESC');
    res.json({ success: true, tasks: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 獲取任務（管理後台用，根據用戶角色篩選）
app.get('/api/tasks/admin', authenticateToken, requireRole('shop', 'admin'), async (req, res) => {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const username = req.user.username;
    const userRole = req.user.role;

    let query, params;

    if (userRole === 'admin') {
      // 管理員可以看到所有任務
      query = 'SELECT * FROM tasks ORDER BY id DESC';
      params = [];
    } else {
      // 商店只能看到自己創建的任務
      query = 'SELECT * FROM tasks WHERE created_by = ? ORDER BY id DESC';
      params = [username];
    }

    const [rows] = await conn.execute(query, params);
    res.json({ success: true, tasks: rows, userRole });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// === 劇情任務 (Quest Chains) API ===

// 取得所有劇情 (管理員/工作人員)
app.get('/api/quest-chains', staffOrAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute('SELECT * FROM quest_chains ORDER BY id DESC');
    res.json({ success: true, questChains: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 新增劇情
app.post('/api/quest-chains', staffOrAdminAuth, async (req, res) => {
  const { title, description, chain_points, badge_name, badge_image } = req.body;
  if (!title) return res.status(400).json({ success: false, message: '缺少標題' });

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    await conn.execute(
      'INSERT INTO quest_chains (title, description, chain_points, badge_name, badge_image) VALUES (?, ?, ?, ?, ?)',
      [title, description, chain_points || 0, badge_name || null, badge_image || null]
    );
    res.json({ success: true, message: '劇情建立成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 新增任務
app.post('/api/tasks', staffOrAdminAuth, async (req, res) => {
  const { 
    name, lat, lng, radius, description, photoUrl, youtubeUrl, ar_image_url, points, 
    task_type, options, correct_answer,
    // 新增參數
    type, quest_chain_id, quest_order, time_limit_start, time_limit_end, max_participants
  } = req.body;

  console.log('[POST /api/tasks] Received:', req.body);

  if (!name || !lat || !lng || !radius || !description || !photoUrl) {
    return res.status(400).json({ success: false, message: '缺少參數' });
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const username = req.headers['x-username'];
    const pts = Number(points) || 0;
    
    // 檢查 task_type (問答/選擇/拍照)
    const tType = ALLOWED_TASK_TYPES.includes(task_type) ? task_type : 'qa';
    const opts = options ? JSON.stringify(options) : null;

    // 檢查 type (single/timed/quest)
    const mainType = ['single', 'timed', 'quest'].includes(type) ? type : 'single';
    
    // 處理時間格式 (如果空字串轉為 null)
    const tStart = time_limit_start || null;
    const tEnd = time_limit_end || null;
    const maxP = max_participants ? Number(max_participants) : null;
    const qId = quest_chain_id ? Number(quest_chain_id) : null;
    const qOrder = quest_order ? Number(quest_order) : null;

    await conn.execute(
      `INSERT INTO tasks (
        name, lat, lng, radius, description, photoUrl, iconUrl, youtubeUrl, ar_image_url, points, created_by, 
        task_type, options, correct_answer,
        type, quest_chain_id, quest_order, time_limit_start, time_limit_end, max_participants
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, lat, lng, radius, description, photoUrl, '/images/flag-red.png', youtubeUrl || null, ar_image_url || null, pts, username, 
        tType, opts, correct_answer || null,
        mainType, qId, qOrder, tStart, tEnd, maxP
      ]
    );
    res.json({ success: true, message: '新增成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 安全的檔案上傳 API
app.post('/api/upload', authenticateToken, requireRole('user', 'shop', 'admin'), (req, res) => {
  // 使用 multer 中間層處理檔案上傳
  upload.single('photo')(req, res, (err) => {
    if (err) {
      // 處理上傳錯誤
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: '檔案大小超過 5MB 限制' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ success: false, message: '一次只能上傳一個檔案' });
        }
      }

      // 處理自定義錯誤（檔案類型不支援）
      if (err.message.includes('不支援的檔案類型')) {
        return res.status(400).json({ success: false, message: err.message });
      }

      // 其他錯誤
      console.error('檔案上傳錯誤:', err);
      return res.status(500).json({ success: false, message: '檔案上傳失敗' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: '未選擇檔案' });
    }

    // 回傳安全的圖片路徑（使用新的檔案名稱）
    const imageUrl = '/images/' + req.file.filename;
    console.log(`✅ 檔案上傳成功: ${req.file.originalname} -> ${req.file.filename}`);
    res.json({ success: true, url: imageUrl, filename: req.file.filename });
  });
});

// 查詢目前登入者進行中的任務（需傳 username）
app.get('/api/user-tasks', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ success: false, message: '缺少 username' });
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    // 取得 user_id
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.json({ success: true, tasks: [] });
    const userId = users[0].id;
    // 查詢進行中任務
    const [rows] = await conn.execute(
      `SELECT t.*, ut.status, ut.started_at, ut.finished_at, ut.id as user_task_id
       FROM user_tasks ut
       JOIN tasks t ON ut.task_id = t.id
       WHERE ut.user_id = ? AND ut.status = '進行中'`,
      [userId]
    );
    res.json({ success: true, tasks: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 加入任務（需傳 username, task_id）
app.post('/api/user-tasks', async (req, res) => {
  const { username, task_id } = req.body;
  if (!username || !task_id) return res.status(400).json({ success: false, message: '缺少參數' });
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    // 取得 user_id 與 role
    const [users] = await conn.execute('SELECT id, role FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(400).json({ success: false, message: '找不到使用者' });
    
    const user = users[0];
    // 阻擋管理員或工作人員接取任務
    if (user.role === 'admin' || user.role === 'shop' || user.role === 'staff') {
      return res.status(403).json({ success: false, message: '管理員或工作人員無法接取任務' });
    }

    const userId = user.id;
    // 檢查是否已經有進行中
    const [inProgress] = await conn.execute('SELECT id FROM user_tasks WHERE user_id = ? AND task_id = ? AND status = "進行中"', [userId, task_id]);
    if (inProgress.length > 0) return res.json({ success: true, message: '已在進行中' });

    // 檢查是否已經完成過
    const [completed] = await conn.execute('SELECT id FROM user_tasks WHERE user_id = ? AND task_id = ? AND status = "完成"', [userId, task_id]);
    if (completed.length > 0) return res.json({ success: false, message: '此任務已完成過，無法再次接取' });

    await conn.execute('INSERT INTO user_tasks (user_id, task_id, status) VALUES (?, ?, "進行中")', [userId, task_id]);
    res.json({ success: true, message: '已加入任務' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 管理員刪除用戶任務紀錄 (重置任務狀態)
app.delete('/api/user-tasks/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    // 檢查該紀錄是否存在
    const [rows] = await conn.execute('SELECT id FROM user_tasks WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到該任務紀錄' });

    await conn.execute('DELETE FROM user_tasks WHERE id = ?', [id]);
    res.json({ success: true, message: '任務紀錄已刪除，玩家可重新接取' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 完成任務（需傳 username, task_id）
app.post('/api/user-tasks/finish', async (req, res) => {
  const { username, task_id } = req.body;
  if (!username || !task_id) return res.status(400).json({ success: false, message: '缺少參數' });
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    // 取得 user_id
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(400).json({ success: false, message: '找不到使用者' });
    const userId = users[0].id;

    // 取得任務資訊
    const [tasks] = await conn.execute('SELECT name, points FROM tasks WHERE id = ?', [task_id]);
    if (tasks.length === 0) return res.status(400).json({ success: false, message: '找不到任務' });
    const task = tasks[0];

    // 開始交易
    await conn.beginTransaction();

    try {
      // 更新任務狀態為完成
      await conn.execute('UPDATE user_tasks SET status = "完成", finished_at = NOW() WHERE user_id = ? AND task_id = ? AND status = "進行中"', [userId, task_id]);

      // 記錄積分獲得交易
      if (task.points > 0) {
        await conn.execute(
          'INSERT INTO point_transactions (user_id, type, points, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, 'earned', task.points, `完成任務: ${task.name}`, 'task_completion', task_id]
        );
      }

      await conn.commit();
      res.json({ success: true, message: `已完成任務，獲得 ${task.points} 積分！` });

    } catch (err) {
      await conn.rollback();
      throw err;
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 查詢單一任務
app.get('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute('SELECT * FROM tasks WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到任務' });
    res.json({ success: true, task: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 編輯任務
app.put('/api/tasks/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { 
    name, lat, lng, radius, description, photoUrl, youtubeUrl, ar_image_url, points, 
    task_type, options, correct_answer,
    type, quest_chain_id, quest_order, time_limit_start, time_limit_end, max_participants
  } = req.body;

  if (!name || !lat || !lng || !radius || !description || !photoUrl) {
    return res.status(400).json({ success: false, message: '缺少參數' });
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const username = req.headers['x-username'];

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;

    // 檢查任務是否存在，並確認權限
    let taskQuery, taskParams;
    if (userRole === 'admin') {
      taskQuery = 'SELECT id FROM tasks WHERE id = ?';
      taskParams = [id];
    } else {
      taskQuery = 'SELECT id FROM tasks WHERE id = ? AND created_by = ?';
      taskParams = [id, username];
    }

    const [taskRows] = await conn.execute(taskQuery, taskParams);
    if (taskRows.length === 0) {
      return res.status(403).json({ success: false, message: '無權限編輯此任務' });
    }

    const pts = Number(points) || 0;
    const tType = ALLOWED_TASK_TYPES.includes(task_type) ? task_type : 'qa';
    const opts = options ? JSON.stringify(options) : null;

    // 檢查 type (single/timed/quest)
    const mainType = ['single', 'timed', 'quest'].includes(type) ? type : 'single';
    
    const tStart = time_limit_start || null;
    const tEnd = time_limit_end || null;
    const maxP = max_participants ? Number(max_participants) : null;
    const qId = quest_chain_id ? Number(quest_chain_id) : null;
    const qOrder = quest_order ? Number(quest_order) : null;

    await conn.execute(
      `UPDATE tasks SET 
        name=?, lat=?, lng=?, radius=?, description=?, photoUrl=?, youtubeUrl=?, ar_image_url=?, points=?, 
        task_type=?, options=?, correct_answer=?,
        type=?, quest_chain_id=?, quest_order=?, time_limit_start=?, time_limit_end=?, max_participants=?
       WHERE id=?`,
      [
        name, lat, lng, radius, description, photoUrl, youtubeUrl || null, ar_image_url || null, pts, 
        tType, opts, correct_answer || null, 
        mainType, qId, qOrder, tStart, tEnd, maxP,
        id
      ]
    );
    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 刪除任務
app.delete('/api/tasks/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const username = req.headers['x-username'];

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;

    // 檢查任務是否存在，並確認權限
    let taskQuery, taskParams;
    if (userRole === 'admin') {
      taskQuery = 'SELECT id FROM tasks WHERE id = ?';
      taskParams = [id];
    } else {
      taskQuery = 'SELECT id FROM tasks WHERE id = ? AND created_by = ?';
      taskParams = [id, username];
    }

    const [taskRows] = await conn.execute(taskQuery, taskParams);
    if (taskRows.length === 0) {
      return res.status(403).json({ success: false, message: '無權限刪除此任務' });
    }

    // 先刪除相關的使用者任務記錄
    await conn.execute('DELETE FROM user_tasks WHERE task_id = ?', [id]);
    // 再刪除任務本身
    await conn.execute('DELETE FROM tasks WHERE id = ?', [id]);
    res.json({ success: true, message: '已刪除' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// ====== Rank 計算工具 ======
function getRank(started, finished) {
  if (!started || !finished) return '';
  // 轉為台灣時區
  const startedTW = new Date(new Date(started).getTime() + 8 * 60 * 60 * 1000);
  const finishedTW = new Date(new Date(finished).getTime() + 8 * 60 * 60 * 1000);
  const diff = (finishedTW - startedTW) / 3600000;
  if (diff <= 1) return 'S+';
  if (diff <= 2) return 'S';
  if (diff <= 3) return 'A';
  if (diff <= 4) return 'B';
  if (diff <= 5) return 'C';
  if (diff <= 6) return 'D';
  return 'E';
}

// 查詢使用者在各劇情任務線的目前進度
app.get('/api/user/quest-progress', async (req, res) => {
  const username = req.headers['x-username'];
  if (!username) return res.json({ success: true, progress: {} }); // 未登入，回傳空物件

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    
    // 取得 user_id
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.json({ success: true, progress: {} });
    const userId = users[0].id;

    // 查詢 user_quests 表
    const [rows] = await conn.execute(
      'SELECT quest_chain_id, current_step_order FROM user_quests WHERE user_id = ?',
      [userId]
    );

    const progress = {};
    rows.forEach(row => {
      progress[row.quest_chain_id] = row.current_step_order;
    });

    res.json({ success: true, progress });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 查詢所有（進行中＋完成）任務
app.get('/api/user-tasks/all', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ success: false, message: '缺少 username' });
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    // 取得 user_id
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.json({ success: true, tasks: [] });
    const userId = users[0].id;
    // 查詢所有任務
    const [rows] = await conn.execute(
      `SELECT t.*, ut.status, ut.started_at, ut.finished_at, ut.id as user_task_id, ut.redeemed, ut.redeemed_at, ut.redeemed_by, ut.answer
       FROM user_tasks ut
       JOIN tasks t ON ut.task_id = t.id
       WHERE ut.user_id = ?
       ORDER BY ut.started_at DESC`,
      [userId]
    );
    // 加 rank
    const tasks = rows.map(row => ({
      ...row,
      rank: getRank(row.started_at, row.finished_at)
    }));
    res.json({ success: true, tasks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// ===== Admin 權限驗證中介層 =====
function adminAuth(req, res, next) {
  const username = req.headers['x-username'];
  if (!username) return res.status(401).json({ success: false, message: '未登入' });
  mysql.createConnection(dbConfig).then(conn => {
    conn.execute('SELECT role FROM users WHERE username = ?', [username])
      .then(([rows]) => {
        conn.end();
        if (rows.length === 0 || rows[0].role !== 'admin') {
          return res.status(403).json({ success: false, message: '無權限' });
        }
        next();
      })
      .catch(err => {
        conn.end();
        res.status(500).json({ success: false, message: '伺服器錯誤' });
      });
  });
}

// ===== Staff 或 Admin 權限驗證中介層 =====
// 舊的中間層 - 為了向後兼容保留，但建議使用新的 JWT 中間層
function staffOrAdminAuth(req, res, next) {
  const username = req.headers['x-username'];
  if (!username) return res.status(401).json({ success: false, message: '未登入' });
  mysql.createConnection(dbConfig).then(conn => {
    conn.execute('SELECT role FROM users WHERE username = ?', [username])
      .then(([rows]) => {
        conn.end();
        if (rows.length === 0 || (rows[0].role !== 'shop' && rows[0].role !== 'admin')) {
          return res.status(403).json({ success: false, message: '無權限' });
        }
        next();
      })
      .catch(err => {
        conn.end();
        res.status(500).json({ success: false, message: '伺服器錯誤' });
      });
  });
}

// ===== Staff 兌換任務獎勵 =====
app.post('/api/user-tasks/:id/redeem', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  const staffUser = req.headers['x-username'];
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    // 只能兌換已完成且未兌換的
    const [rows] = await conn.execute('SELECT * FROM user_tasks WHERE id = ? AND status = "完成" AND redeemed = 0', [id]);
    if (rows.length === 0) return res.status(400).json({ success: false, message: '不可重複兌換或尚未完成' });
    await conn.execute('UPDATE user_tasks SET redeemed = 1, redeemed_at = NOW(), redeemed_by = ? WHERE id = ?', [staffUser, id]);
    res.json({ success: true, message: '已兌換' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// ===== Staff 查詢所有進行中任務（可搜尋） =====
app.get('/api/user-tasks/in-progress', staffOrAdminAuth, async (req, res) => {
  const { taskName, username } = req.query;
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const reqUsername = req.headers['x-username'];

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [reqUsername]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;
    let sql = `SELECT ut.id as user_task_id, ut.user_id, ut.task_id, ut.status, ut.started_at, ut.finished_at, ut.redeemed, ut.redeemed_at, ut.redeemed_by, ut.answer, u.username, t.name as task_name, t.description, t.points, t.created_by as task_creator, t.task_type
      FROM user_tasks ut
      JOIN users u ON ut.user_id = u.id
      JOIN tasks t ON ut.task_id = t.id
      WHERE ut.status = '進行中'`;
    const params = [];

    if (userRole === 'staff') {
      // 工作人員只能看到自己創建的任務的進行中記錄
      sql += ' AND t.created_by = ?';
      params.push(reqUsername);
    }

    if (taskName) {
      sql += ' AND t.name LIKE ?';
      params.push('%' + taskName + '%');
    }
    if (username) {
      sql += ' AND u.username LIKE ?';
      params.push('%' + username + '%');
    }
    sql += ' ORDER BY ut.started_at DESC';
    const [rows] = await conn.execute(sql, params);
    res.json({ success: true, tasks: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// ===== Staff 查詢所有已完成但未兌換的任務（可搜尋） =====
app.get('/api/user-tasks/to-redeem', staffOrAdminAuth, async (req, res) => {
  const { taskName, username } = req.query;
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const reqUsername = req.headers['x-username'];

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [reqUsername]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;
    let sql = `SELECT ut.id as user_task_id, ut.user_id, ut.task_id, ut.status, ut.started_at, ut.finished_at, ut.redeemed, ut.redeemed_at, ut.redeemed_by, u.username, t.name as task_name, t.description, t.points, t.created_by as task_creator, t.task_type
      FROM user_tasks ut
      JOIN users u ON ut.user_id = u.id
      JOIN tasks t ON ut.task_id = t.id
      WHERE ut.status = '完成' AND ut.redeemed = 0`;
    const params = [];

    if (userRole === 'staff') {
      // 工作人員只能看到自己創建的任務的已完成記錄
      sql += ' AND t.created_by = ?';
      params.push(reqUsername);
    }

    if (taskName) {
      sql += ' AND t.name LIKE ?';
      params.push('%' + taskName + '%');
    }
    if (username) {
      sql += ' AND u.username LIKE ?';
      params.push('%' + username + '%');
    }
    sql += ' ORDER BY ut.finished_at DESC';
    const [rows] = await conn.execute(sql, params);
    res.json({ success: true, tasks: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 儲存/更新猜謎答案或提交選擇題答案
app.patch('/api/user-tasks/:id/answer', async (req, res) => {
  const { id } = req.params;
  const { answer } = req.body;
  if (!answer) return res.status(400).json({ success: false, message: '缺少答案' });
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    // 1. 取得任務資訊
    const [rows] = await conn.execute(`
      SELECT ut.*, t.task_type, t.correct_answer, t.points, t.name as task_name, ut.user_id, ut.task_id
      FROM user_tasks ut
      JOIN tasks t ON ut.task_id = t.id
      WHERE ut.id = ?
    `, [id]);

    if (rows.length === 0) return res.status(404).json({ success: false, message: '任務不存在' });
    const userTask = rows[0];

    if (userTask.status === '完成') {
       return res.json({ success: true, message: '任務已完成，無需更新' });
    }

    let isCompleted = false;
    let message = '答案已儲存';

    // 2. 檢查是否為選擇題且答案正確
    if (userTask.task_type === 'multiple_choice') {
      if (userTask.correct_answer && answer === userTask.correct_answer) {
        isCompleted = true;
        message = '答對了！任務完成！';
      } else {
        // 選擇題答錯，不完成任務
        message = '答案不正確，請再試一次';
      }
    }

    // 3. 更新狀態
    if (isCompleted) {
       await conn.beginTransaction();
       try {
         await conn.execute('UPDATE user_tasks SET answer = ?, status = "完成", finished_at = NOW() WHERE id = ?', [answer, id]);

         // 記錄積分交易
         if (userTask.points > 0) {
            await conn.execute(
              'INSERT INTO point_transactions (user_id, type, points, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
              [userTask.user_id, 'earned', userTask.points, `完成任務: ${userTask.task_name}`, 'task_completion', userTask.task_id]
            );
         }
         await conn.commit();
       } catch (e) {
         await conn.rollback();
         throw e;
       }
    } else {
       // 只更新答案，狀態不變（保持進行中）
       await conn.execute('UPDATE user_tasks SET answer = ? WHERE id = ?', [answer, id]);
    }

    res.json({ success: true, message, isCompleted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// ===== 商品管理 API =====

// 獲取所有商品（用戶用）
app.get('/api/products', async (req, res) => {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(`
      SELECT p.*, u.username as creator_username
      FROM products p
      LEFT JOIN users u ON p.created_by = u.username
      WHERE p.is_active = TRUE
      ORDER BY p.points_required ASC
    `);
    res.json({ success: true, products: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 獲取所有商品（管理員用）- 根據用戶角色篩選
app.get('/api/products/admin', staffOrAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const username = req.headers['x-username'];

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;
    let query, params;

    if (userRole === 'admin') {
      // 管理員可以看到所有商品
      query = 'SELECT * FROM products ORDER BY created_at DESC';
      params = [];
    } else {
      // 工作人員只能看到自己創建的商品
      query = 'SELECT * FROM products WHERE created_by = ? ORDER BY created_at DESC';
      params = [username];
    }

    const [rows] = await conn.execute(query, params);
    res.json({ success: true, products: rows, userRole });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 新增商品
app.post('/api/products', staffOrAdminAuth, async (req, res) => {
  const { name, description, image_url, points_required, stock } = req.body;
  if (!name || !points_required || stock === undefined) {
    return res.status(400).json({ success: false, message: '缺少必要參數' });
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const username = req.headers['x-username'];

    const [result] = await conn.execute(
      'INSERT INTO products (name, description, image_url, points_required, stock, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description || '', image_url || '', points_required, stock, username]
    );
    res.json({ success: true, message: '商品新增成功', productId: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 編輯商品
app.put('/api/products/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { name, description, image_url, points_required, stock, is_active } = req.body;
  if (!name || !points_required || stock === undefined) {
    return res.status(400).json({ success: false, message: '缺少必要參數' });
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const username = req.headers['x-username'];

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;

    // 檢查商品是否存在，並確認權限
    let productQuery, productParams;
    if (userRole === 'admin') {
      productQuery = 'SELECT id FROM products WHERE id = ?';
      productParams = [id];
    } else {
      productQuery = 'SELECT id FROM products WHERE id = ? AND created_by = ?';
      productParams = [id, username];
    }

    const [productRows] = await conn.execute(productQuery, productParams);
    if (productRows.length === 0) {
      return res.status(403).json({ success: false, message: '無權限編輯此商品' });
    }

    await conn.execute(
      'UPDATE products SET name = ?, description = ?, image_url = ?, points_required = ?, stock = ?, is_active = ? WHERE id = ?',
      [name, description || '', image_url || '', points_required, stock, is_active !== undefined ? is_active : true, id]
    );
    res.json({ success: true, message: '商品更新成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 刪除商品
app.delete('/api/products/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const username = req.headers['x-username'];

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;

    // 檢查商品是否存在，並確認權限
    let productQuery, productParams;
    if (userRole === 'admin') {
      productQuery = 'SELECT id FROM products WHERE id = ?';
      productParams = [id];
    } else {
      productQuery = 'SELECT id FROM products WHERE id = ? AND created_by = ?';
      productParams = [id, username];
    }

    const [productRows] = await conn.execute(productQuery, productParams);
    if (productRows.length === 0) {
      return res.status(403).json({ success: false, message: '無權限刪除此商品' });
    }

    await conn.execute(
      'DELETE FROM products WHERE id = ?',
      [id]
    );
    res.json({ success: true, message: '商品刪除成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 獲取用戶的商品兌換記錄
app.get('/api/products/redemptions', async (req, res) => {
  const username = req.headers['x-username'];
  if (!username) {
    return res.status(400).json({ success: false, message: '缺少用戶名稱' });
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    // 獲取用戶ID
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(400).json({ success: false, message: '用戶不存在' });
    }
    const userId = users[0].id;

    // 獲取兌換記錄
    const [rows] = await conn.execute(`
      SELECT pr.*, p.name as product_name, p.image_url
      FROM product_redemptions pr
      JOIN products p ON pr.product_id = p.id
      WHERE pr.user_id = ?
      ORDER BY pr.redeemed_at DESC
    `, [userId]);

    res.json({ success: true, redemptions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 兌換商品
app.post('/api/products/:id/redeem', async (req, res) => {
  const { id } = req.params;
  const username = req.headers['x-username'];
  if (!username) {
    return res.status(400).json({ success: false, message: '缺少用戶名稱' });
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    // 獲取用戶ID
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(400).json({ success: false, message: '用戶不存在' });
    }
    const userId = users[0].id;

    // 獲取商品資訊
    const [products] = await conn.execute('SELECT * FROM products WHERE id = ? AND is_active = TRUE', [id]);
    if (products.length === 0) {
      return res.status(400).json({ success: false, message: '商品不存在或已下架' });
    }
    const product = products[0];

    // 檢查庫存
    if (product.stock <= 0) {
      return res.status(400).json({ success: false, message: '商品已售完' });
    }

    // 計算用戶總積分（獲得積分 - 消費積分）
    const [userPointsResult] = await conn.execute(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'earned' THEN points ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'spent' THEN points ELSE 0 END), 0) as total_points
      FROM point_transactions
      WHERE user_id = ?
    `, [userId]);

    const totalPoints = userPointsResult[0].total_points || 0;

    // 檢查積分是否足夠
    if (totalPoints < product.points_required) {
      return res.status(400).json({ success: false, message: `積分不足，需要 ${product.points_required} 積分，您目前有 ${totalPoints} 積分` });
    }

    // 開始交易
    await conn.beginTransaction();

    try {
      // 減少庫存
      await conn.execute('UPDATE products SET stock = stock - 1 WHERE id = ?', [id]);

      // 記錄兌換
      const [redemptionResult] = await conn.execute(
        'INSERT INTO product_redemptions (user_id, product_id, points_used, status) VALUES (?, ?, ?, ?)',
        [userId, id, product.points_required, 'pending']
      );

      // 記錄積分扣除交易
      await conn.execute(
        'INSERT INTO point_transactions (user_id, type, points, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, 'spent', product.points_required, `兌換商品: ${product.name}`, 'product_redemption', redemptionResult.insertId]
      );

      await conn.commit();
      res.json({ success: true, message: '商品兌換成功！請等待工作人員確認。' });

    } catch (err) {
      await conn.rollback();
      throw err;
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 獲取用戶總積分
app.get('/api/user/points', async (req, res) => {
  const username = req.headers['x-username'];
  if (!username) {
    return res.status(400).json({ success: false, message: '缺少用戶名稱' });
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    // 獲取用戶ID
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(400).json({ success: false, message: '用戶不存在' });
    }
    const userId = users[0].id;

    // 計算總積分（獲得積分 - 消費積分）
    const [result] = await conn.execute(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'earned' THEN points ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'spent' THEN points ELSE 0 END), 0) as total_points
      FROM point_transactions
      WHERE user_id = ?
    `, [userId]);

    res.json({ success: true, totalPoints: result[0].total_points || 0 });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// ===== 兌換記錄管理 API =====

// 獲取商品兌換記錄（管理員/工作人員用）
app.get('/api/product-redemptions/admin', staffOrAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const username = req.headers['x-username'];

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;
    let query, params;

    if (userRole === 'admin') {
      // 管理員可以看到所有兌換記錄
      query = `
        SELECT pr.*, p.name as product_name, p.image_url, p.created_by as merchant_name, u.username
        FROM product_redemptions pr
        JOIN products p ON pr.product_id = p.id
        JOIN users u ON pr.user_id = u.id
        ORDER BY pr.redeemed_at DESC
      `;
      params = [];
    } else {
      // 工作人員只能看到自己管理的商品的兌換記錄
      query = `
        SELECT pr.*, p.name as product_name, p.image_url, p.created_by as merchant_name, u.username
        FROM product_redemptions pr
        JOIN products p ON pr.product_id = p.id
        JOIN users u ON pr.user_id = u.id
        WHERE p.created_by = ?
        ORDER BY pr.redeemed_at DESC
      `;
      params = [username];
    }

    const [rows] = await conn.execute(query, params);
    res.json({ success: true, redemptions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

// 更新兌換記錄狀態
app.put('/api/product-redemptions/:id/status', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  if (!['completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ success: false, message: '無效的狀態' });
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const username = req.headers['x-username'];

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;

    // 獲取兌換記錄詳情和商品名稱
    let query, params;
    if (userRole === 'admin') {
      query = `
        SELECT pr.*, p.name as product_name, p.created_by
        FROM product_redemptions pr
        JOIN products p ON pr.product_id = p.id
        WHERE pr.id = ?
      `;
      params = [id];
    } else {
      query = `
        SELECT pr.*, p.name as product_name, p.created_by
        FROM product_redemptions pr
        JOIN products p ON pr.product_id = p.id
        WHERE pr.id = ? AND p.created_by = ?
      `;
      params = [id, username];
    }

    const [redemptions] = await conn.execute(query, params);

    if (redemptions.length === 0) {
      return res.status(404).json({ success: false, message: '兌換記錄不存在或無權限處理' });
    }

    const redemption = redemptions[0];
    const productName = redemption.product_name;

    // 開始交易
    await conn.beginTransaction();

    try {
      // 更新兌換記錄狀態
      await conn.execute(
        'UPDATE product_redemptions SET status = ?, notes = ? WHERE id = ?',
        [status, notes || '', id]
      );

      // 如果是取消兌換，需要退還積分和商品庫存
      if (status === 'cancelled') {
        // 退還商品庫存
        await conn.execute(
          'UPDATE products SET stock = stock + 1 WHERE id = ?',
          [redemption.product_id]
        );

        // 記錄積分退還交易
        await conn.execute(
          'INSERT INTO point_transactions (user_id, type, points, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
          [redemption.user_id, 'earned', redemption.points_used, `取消兌換退還積分: ${productName}`, 'redemption_cancelled', redemption.id]
        );
      }

      await conn.commit();
      res.json({ success: true, message: status === 'completed' ? '兌換已完成' : '兌換已取消' });

    } catch (err) {
      await conn.rollback();
      throw err;
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) await conn.end();
  }
});

const PORT = process.env.PORT || 3001;

// catch-all route for static html (avoid 404 on /), 只針對非 /api/ 路徑
// 健康檢查端點
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: {
      host: process.env.MYSQL_HOST ? '[已設定]' : '[未設定]',
      port: process.env.MYSQL_PORT ? '[已設定]' : '[未設定]',
      database: process.env.MYSQL_DATABASE ? '[已設定]' : '[未設定]',
      username: process.env.MYSQL_USERNAME ? '[已設定]' : '[未設定]',
      password: process.env.MYSQL_ROOT_PASSWORD ? '[已設定]' : '[未設定]'
    }
  });
});

app.get(/^\/(?!api\/).*/, (req, res, next) => {
  if (req.path.match(/\.[a-zA-Z0-9]+$/)) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 除錯：輸出環境變數（僅開發環境）
if (process.env.NODE_ENV !== 'production') {
  console.log('=== 環境變數檢查 ===');
  console.log('MYSQL_HOST:', process.env.MYSQL_HOST);
  console.log('MYSQL_PORT:', process.env.MYSQL_PORT);
  console.log('MYSQL_USERNAME:', process.env.MYSQL_USERNAME);
  console.log('MYSQL_DATABASE:', process.env.MYSQL_DATABASE);
  console.log('MYSQL_ROOT_PASSWORD:', process.env.MYSQL_ROOT_PASSWORD ? '[已設定]' : '[未設定]');
  console.log('ALLOWED_ORIGINS:', process.env.ALLOWED_ORIGINS);
  console.log('==================');
}

// 啟動時測試資料庫連接
(async () => {
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    console.error('⚠️  警告: 資料庫連接失敗，部分功能可能無法正常運作');
  }
})();

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  console.log(`🌐 應用程式運行在: http://localhost:${PORT}`);
  console.log(`🔍 健康檢查端點: http://localhost:${PORT}/api/health`);
}); 
