// Trigger Zeabur redeploy - 2026-02-01
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const webpush = require('web-push');
const XLSX = require('xlsx');
const { getDbConfig } = require('./db-config');
// Embedding API 客戶端（直接使用 HTTP 請求，不再依賴 plant-search-client.js）
const EMBEDDING_API_URL = process.env.EMBEDDING_API_URL || 'http://gpstask-ooffix:8080';
const http = require('http');
const https = require('https');
const { URL } = require('url');

// 簡單的 HTTP 請求函數（不依賴外部庫）
// 預設 60 秒逾時，避免 Embedding API 連線失敗時無限等待
const EMBEDDING_REQUEST_TIMEOUT_MS = parseInt(process.env.EMBEDDING_REQUEST_TIMEOUT_MS || '60000', 10);

// 動態權重區間（Q 越低越依賴 embedding，避免爛 traits 亂帶）
const DYNAMIC_WEIGHT_SEGMENTS = [
  { threshold: 0.30, embedding: 0.90, feature: 0.10 },
  { threshold: 0.55, embedding: 0.70, feature: 0.30 },
  { threshold: 0.75, embedding: 0.50, feature: 0.50 },
  { threshold: 1.01, embedding: 0.30, feature: 0.70 }
];

// Step 9: 學名／中文名對應表（LM 學名可匹配 RAG 中文）
let _plantNameMapping = null;
function getPlantNameMapping() {
  if (_plantNameMapping) return _plantNameMapping;
  try {
    const mappingPath = path.join(__dirname, 'scripts', 'rag', 'data', 'plant-name-mapping.json');
    if (fs.existsSync(mappingPath)) {
      _plantNameMapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
      return _plantNameMapping;
    }
  } catch (e) {
    console.warn('[RAG] 學名對應表載入失敗:', e.message);
  }
  _plantNameMapping = { allNames: {} };
  return _plantNameMapping;
}

/** LM 名稱經對應表擴展後，是否與 RAG 植物匹配 */
function isMatchViaPlantMapping(lmName, plant, allNames) {
  if (!allNames || typeof allNames !== 'object') return false;
  const expanded = allNames[lmName] || allNames[lmName.toLowerCase()] || [];
  if (expanded.length === 0) return false;
  const plantChinese = (plant.chinese_name || '').trim();
  const plantScientific = (plant.scientific_name || '').trim();
  return expanded.some(n => {
    const nStr = String(n || '').trim();
    if (!nStr || nStr.length < 2) return false;
    if (/[\u4e00-\u9fff]/.test(nStr)) return plantChinese === nStr;
    return plantScientific.toLowerCase() === nStr.toLowerCase();
  });
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    const timeoutMs = options.timeout ?? EMBEDDING_REQUEST_TIMEOUT_MS;

    let bodyBuffer = null;
    if (options.body) {
      bodyBuffer = Buffer.from(
        typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
        'utf8'
      );
    }
    const headers = {
      'User-Agent': 'GPS-Task-Embedding-Client/1.0',
      ...options.headers
    };
    if (bodyBuffer) {
      headers['Content-Length'] = bodyBuffer.length;
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers
    };

    const req = httpModule.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (e) => reject(e));

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Embedding API 請求逾時 (${timeoutMs / 1000} 秒)`));
    });

    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

async function healthCheck() {
  try {
    const result = await httpRequest(`${EMBEDDING_API_URL}/health`);
    return result.data;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getVisionPrompt() {
  try {
    const result = await httpRequest(`${EMBEDDING_API_URL}/vision-prompt`);
    return result.data;
  } catch (e) {
    return null;
  }
}

async function classify(query) {
  try {
    const result = await httpRequest(`${EMBEDDING_API_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { query }
    });
    return result.data;
  } catch (e) {
    return { is_plant: false, plant_score: 0, error: e.message };
  }
}

// URL 長度限制約 2K–8K，長查詢改用 POST 避免被代理截斷
const SEARCH_GET_MAX_QUERY_LEN = 500;

// RAG 每階段取回數量（擴大以提升召回，正確答案常落在 4~60 名）
const RAG_TOP_K = parseInt(process.env.RAG_TOP_K || '30', 10);

async function smartSearch(query, topK = RAG_TOP_K) {
  try {
    let result;
    const usePost = query.length > SEARCH_GET_MAX_QUERY_LEN;
    if (usePost) {
      result = await httpRequest(`${EMBEDDING_API_URL}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { query, top_k: topK, smart: true }
      });
    } else {
      result = await httpRequest(`${EMBEDDING_API_URL}/search?q=${encodeURIComponent(query)}&top_k=${topK}&smart=true`);
    }
    const data = result.data;
    if (data && data.error) {
      console.error('[RAG] 第一階段 smartSearch API 回傳錯誤:', data.error);
    }
    return data;
  } catch (e) {
    console.error('[RAG] 第一階段 smartSearch 連線/請求失敗:', e.message);
    return { classification: { is_plant: false }, results: [], error: e.message };
  }
}

function cleanGuessNames(rawNames = []) {
  if (!Array.isArray(rawNames)) return [];
  const cleaned = [];
  for (const n of rawNames) {
    if (!n) continue;
    let name = String(n).trim();
    if (!name) continue;
    // 移除明顯描述性或非名稱片語
    if (/例如|比如|像是|可能是|可能為|這種植物|這是一株|整體呈現|看起來像/.test(name)) continue;
    // 移除內含空白/標點過多的長句
    if (/[。！？；：,，]/.test(name) && name.length > 8) continue;
    // 長度過短或過長的略過（例如「植物」「一種植物」等）
    if (name.length < 2 || name.length > 12) continue;
    cleaned.push(name);
  }
  return Array.from(new Set(cleaned));
}

async function hybridSearch({ query, features = [], guessNames = [], topK = RAG_TOP_K, weights = null, traits = null }) {
  try {
    const safeGuessNames = cleanGuessNames(guessNames);
    const result = await httpRequest(`${EMBEDDING_API_URL}/hybrid-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { query, features, guess_names: safeGuessNames, top_k: topK, weights, traits }
    });
    const data = result.data;
    if (data && data.error) {
      console.error('[RAG] 第二階段 hybridSearch API 回傳錯誤:', data.error);
    }
    return data;
  } catch (e) {
    console.error('[RAG] 第二階段 hybridSearch 連線/請求失敗:', e.message);
    return { results: [], error: e.message };
  }
}

/**
 * 合併兩階段 RAG 結果，依 score 排序，去重（同種取較高分）
 * @param {Array} prePlants - 第一階段結果
 * @param {Array} newPlants - 第二階段結果
 * @param {number} limit - 回傳筆數上限
 * @returns {Array} 合併後依分數排序的植物列表
 */
function mergePlantResults(prePlants, newPlants, limit = RAG_TOP_K) {
  const byKey = new Map();
  function add(p) {
    const key = (p.chinese_name || p.scientific_name || '').trim();
    if (!key) return;
    const score = p.score ?? p.embedding_score ?? 0;
    const existing = byKey.get(key);
    if (!existing || score > (existing.score ?? existing.embedding_score ?? 0)) {
      byKey.set(key, { ...p, score: p.score ?? score });
    }
  }
  (prePlants || []).forEach(add);
  (newPlants || []).forEach(add);
  return Array.from(byKey.values())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function determineDynamicWeights(traitQuality = {}) {
  const q = traitQuality.quality ?? 0;
  const genericRatio = traitQuality.genericRatio ?? 1;
  let selected = DYNAMIC_WEIGHT_SEGMENTS.find(segment => q < segment.threshold);
  if (!selected) {
    selected = DYNAMIC_WEIGHT_SEGMENTS[DYNAMIC_WEIGHT_SEGMENTS.length - 1];
  }
  let embeddingWeight = selected.embedding;
  let featureWeight = selected.feature;

  if (typeof genericRatio === 'number' && genericRatio >= 0.6 && featureWeight > 0.55) {
    featureWeight = 0.55;
    embeddingWeight = 1 - featureWeight;
  }

  const total = embeddingWeight + featureWeight;
  if (total !== 1) {
    embeddingWeight = embeddingWeight / total;
    featureWeight = featureWeight / total;
  }

  embeddingWeight = clamp(Number(embeddingWeight.toFixed(3)), 0.1, 0.9);
  featureWeight = clamp(Number(featureWeight.toFixed(3)), 0.1, 0.9);

  return { embedding: embeddingWeight, feature: featureWeight };
}

function parseVisionResponse(description) {
  // 簡單的解析邏輯（如果需要更複雜的解析，可以從 traits-parser 導入）
  try {
    // 嘗試從 description 中提取 JSON
    const jsonMatch = description.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        intent: parsed.intent || 'unknown',
        confidence: parsed.confidence,
        short_caption: parsed.short_caption || parsed.shortCaption,
        plant: parsed.plant || {}
      };
    }
    return { success: false, intent: 'unknown' };
  } catch (e) {
    return { success: false, intent: 'unknown', error: e.message };
  }
}

async function embeddingStats() {
  try {
    const result = await httpRequest(`${EMBEDDING_API_URL}/stats`);
    return result.data;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
const { parseTraitsFromResponse, isPlantFromTraits, traitsToFeatureList, evaluateTraitQuality, extractFeaturesFromDescriptionKeywords, extractGuessNamesFromDescription, removeCompoundSimpleContradiction, capByCategoryAndResolveContradictions, aggregateTraitsFromMultipleImages } = require('./scripts/rag/vectordb/traits-parser');

/** 不確定性偵測：符合任一條件即建議補拍（兩段式多圖觸發） */
function isUncertain(plantResults, traits, description) {
  if (!plantResults?.plants?.length) return true;
  const plants = plantResults.plants;
  const top1 = plants[0]?.score ?? 0;
  const top5 = plants[4]?.score ?? 0;
  const scoreGap = top1 - top5;

  const features = traits ? traitsToFeatureList(traits) : [];
  const infloTypes = ['總狀花序', '繖房花序', '圓錐花序', '聚繖花序', '穗狀花序', '頭狀花序', '繖形花序'];
  const hasInfloConflict = infloTypes.filter((t) => features.includes(t)).length > 1;
  const orientBoth = features.includes('直立花序') && features.includes('下垂花序');

  const infloUnknown = !features.some((f) => infloTypes.includes(f));
  const flowerShapeUnknown = !features.some((f) => ['鐘形花', '漏斗形花', '唇形花', '蝶形花'].includes(f));

  if (infloUnknown && flowerShapeUnknown) return true;
  if (hasInfloConflict || orientBoth) return true;
  if (scoreGap < 0.08 && top1 < 0.75) return true;
  return false;
}

/** C. 二段式果實補抽：僅用文字描述向 AI 詢問果實類型，回傳 { fruit_type } 或 null */
async function fetchFruitTypeFromDescription(description, aiUrl, aiKey, model) {
  const prompt = `根據以下植物描述，只判斷果實類型。請只回傳一個 JSON 物件，格式為 {"fruit_type": "berry"|"drupe"|"capsule"|"legume"|"samara"|"achene"|"nut"|"pome"|"unknown"}。若無法判斷則填 unknown。不要輸出其他文字。\n\n描述：\n${(description || '').substring(0, 800)}`;
  const res = await fetch(`${aiUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 80,
      temperature: 0
    })
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || '';
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.fruit_type && parsed.fruit_type !== 'unknown') return parsed;
  } catch (_) {}
  return null;
}

// 避免 Embedding API 暫時不可用時，前端不斷重送導致「看起來像無限循環」
let _embeddingHealthCache = { ts: 0, ok: null, ready: null };
async function isEmbeddingApiReady({ ttlMs = 15000 } = {}) {
  const now = Date.now();
  if (_embeddingHealthCache.ts && now - _embeddingHealthCache.ts < ttlMs) {
    return Boolean(_embeddingHealthCache.ok && _embeddingHealthCache.ready);
  }
  try {
    const h = await healthCheck();
    _embeddingHealthCache = { ts: now, ok: h.ok, ready: h.ready };
    return Boolean(h.ok && h.ready);
  } catch (e) {
    _embeddingHealthCache = { ts: now, ok: false, ready: false };
    return false;
  }
}

// JWT 設定
const JWT_SECRET = process.env.JWT_SECRET;
// 強制生產環境檢查
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  console.error('❌ 嚴重錯誤: 生產環境未設定 JWT_SECRET，拒絕啟動。');
  process.exit(1);
}
// 開發環境 fallback
const FINAL_JWT_SECRET = JWT_SECRET || 'dev-secret-key-do-not-use-in-prod';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

// Web Push (VAPID) 設定
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@gpstask.app';

// 初始化 webpush（如果提供了 VAPID 金鑰）
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('✅ Web Push (VAPID) 已初始化');
} else {
  console.warn('⚠️  警告: 未設定 VAPID 金鑰，推送通知功能將無法使用');
  console.warn('   請設定環境變數: VAPID_PUBLIC_KEY 和 VAPID_PRIVATE_KEY');
  console.warn('   可以使用以下命令生成: npx web-push generate-vapid-keys');
}

const app = express();
console.log('🚀 GPS Task Server with Plant RAG integration');

// 🔥 關鍵設定：信任反向代理（Zeabur/Cloudflare 等）
// 設定為 1 表示只信任第一層代理（Zeabur 通常只有一層負載均衡器）
// 這比 trust proxy: true 更安全，避免信任過多代理層導致 IP 偽造風險
app.set('trust proxy', 1);

// 安全性設定
app.use(helmet({
  contentSecurityPolicy: false, // AR.js 需要較寬鬆的 CSP
  crossOriginEmbedderPolicy: false
}));

// 全局限流
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 1000, // 每個 IP 限制 1000 次請求
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// 登入限流 (更嚴格)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: '嘗試次數過多，請 15 分鐘後再試' }
});
app.use('/api/login', authLimiter);
app.use('/api/staff-login', authLimiter);

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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-username'],
  maxAge: 86400 // 預檢請求快取 24 小時
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ charset: 'utf-8' }));

// 優先從 UPLOAD_DIR 提供圖片服務，這對於掛載的 Volume 很重要
// 當請求 /images/xxx.jpg 時，會先去 UPLOAD_DIR 找
app.use('/images', express.static(UPLOAD_DIR));

// 設定靜態檔案服務，並強制為 .glb/.gltf 設定正確的 MIME type
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (path.extname(filePath) === '.glb') {
      res.setHeader('Content-Type', 'model/gltf-binary');
    } else if (path.extname(filePath) === '.gltf') {
      res.setHeader('Content-Type', 'model/gltf+json');
    }
  }
}));

// 移除錯誤的 mime.define
// express.static.mime.define({'model/gltf-binary': ['glb']});
// express.static.mime.define({'model/gltf+json': ['gltf']});

// 設置響應字符集
app.use((req, res, next) => {
  // 對於 API 路由，設置正確的字符集
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});

// IMPORTANT: DB config must come from env vars only. No hardcoded defaults.
const dbConfig = getDbConfig();

// 建立連接池
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

const ALLOWED_TASK_TYPES = ['qa', 'multiple_choice', 'photo', 'number', 'keyword', 'location'];

// JWT 工具函數
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role
    },
    FINAL_JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
}

// 測試資料庫連接
async function testDatabaseConnection() {
  let conn;
  try {
    console.log('🔄 測試資料庫連接...');
    
    // 開發環境：顯示詳細診斷資訊（不包含密碼）
    if (process.env.NODE_ENV !== 'production') {
      console.log('   連接資訊:');
      console.log(`   - Host: ${dbConfig.host}`);
      console.log(`   - Port: ${dbConfig.port}`);
      console.log(`   - User: ${dbConfig.user}`);
      console.log(`   - Database: ${dbConfig.database}`);
      console.log(`   - Password: ${dbConfig.password ? (dbConfig.password.length > 0 ? `[已設定，長度: ${dbConfig.password.length}]` : '[空字串]') : '[未設定]'}`);
    }
    
    // 使用連接池獲取連接
    conn = await pool.getConnection();
    console.log('✅ 資料庫連接成功 (Connection Pool Active)');
    return true;
  } catch (error) {
    console.error('❌ 資料庫連接失敗:', error.message);
    
    // 開發環境：顯示詳細診斷資訊
    if (process.env.NODE_ENV !== 'production' && error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('   診斷: 這通常是因為：');
      console.error('   1. 密碼不正確');
      console.error('   2. 環境變數包含未展開的變數語法（如 ${PASSWORD}）');
      console.error('   3. 用戶權限不足');
    }
    
    // 生產環境：僅顯示錯誤訊息，不顯示詳細診斷
    return false;
  } finally {
    if (conn) conn.release(); // 釋放連接回池
  }
}

function verifyToken(token) {
  try {
    return jwt.verify(token, FINAL_JWT_SECRET);
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

// 兼容性認證中間層 - 現在與 authenticateToken 功能完全相同
// 保留此函數以維持向後兼容性，實際上是 authenticateToken 的別名
function authenticateTokenCompat(req, res, next) {
  return authenticateToken(req, res, next);
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

// 共享的存儲配置
const storage = multer.diskStorage({
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
});

// 共享的檔案類型過濾器（圖片和 3D 模型）
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.glb', '.gltf'];
  const fileExtension = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error('不支援的檔案類型。只允許 JPG, PNG, GIF, WebP, GLB, GLTF。'), false);
  }
};

// 音頻文件過濾器
const audioFileFilter = (req, file, cb) => {
  const allowedExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'];
    const fileExtension = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
    cb(new Error('不支援的檔案類型。只允許 MP3, WAV, OGG, M4A, AAC, FLAC, WebM。'), false);
  }
};

// 一般圖片上傳配置（5MB 限制）- 用於用戶上傳照片答案、道具圖片、徽章圖片等
const uploadImage = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB 限制
    files: 1
  },
  fileFilter: fileFilter
});

// 3D 模型上傳配置（100MB 限制）- 用於 AR 模型上傳
const uploadModel = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB 限制 (為了支援 GLB 模型)
    files: 1
  },
  fileFilter: fileFilter
});

// 音頻文件上傳配置（100MB 限制）- 用於背景音樂上傳
const uploadAudio = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB 限制 (為了支援高品質音頻)
    files: 1
  },
  fileFilter: audioFileFilter
});

// 向後兼容：保留 upload 作為 uploadImage 的別名（用於舊代碼）
const upload = uploadImage;

// 登入 API
// - role=user：一般用戶登入（手機門號，不需密碼），同時允許 staff 也用此入口登入
// - role=staff_portal：工作人員入口（帳號密碼），僅允許 admin/shop
// - 兼容：role=shop/admin/staff（舊版工作人員入口）
app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !role) {
    return res.status(400).json({ success: false, message: '缺少參數' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    if (role === 'user') {
      // 手機門號登入 - 設計為無密碼快速登入（景點快速使用）
      // 如果用戶提供了密碼且帳號有密碼，則驗證；否則直接通過
      const [users] = await conn.execute(
        'SELECT * FROM users WHERE username = ? AND role IN (?, ?)',
        [username, 'user', 'staff']
      );
      if (users.length === 0) {
        return res.status(400).json({ success: false, message: '查無此用戶' });
      }

      const user = users[0];
      
      // 安全修復：如果帳號有密碼，必須提供並驗證密碼
      // 只有當帳號沒有密碼時，才允許無密碼登入（快速登入設計）
      if (user.password && user.password.trim() !== '') {
        // 帳號有密碼，必須提供密碼並驗證
        if (!password) {
          return res.status(400).json({ success: false, message: '此帳號需要密碼，請輸入密碼' });
        }
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          return res.status(400).json({ success: false, message: '密碼錯誤' });
        }
      }
      // 如果帳號沒有密碼，允許無密碼登入（符合快速登入設計）

      // 生成 JWT token
      const token = generateToken(user);

      // 設置 httpOnly cookie
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        // IMPORTANT:
        // - Using SameSite=Strict can break flows when users open the site from external apps (LINE/FB/in-app browsers),
        //   causing cookies not to be sent and "開始任務" to fail with 401.
        // - Lax is the practical default for this app while still providing CSRF mitigation.
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/' // 確保 cookie 在所有路徑下都可用
      });

      // 返回用戶信息
      const userResponse = {
        id: users[0].id,
        username: users[0].username,
        role: users[0].role
      };

      res.json({ success: true, user: userResponse });
    } else if (role === 'staff_portal' || role === 'shop' || role === 'admin' || role === 'staff') {
      // 工作人員入口（帳號密碼）
      // 新規則：僅允許 admin / shop 走此入口（staff 一律走一般用戶登入）
      const [users] = await conn.execute(
        'SELECT * FROM users WHERE username = ? AND role IN (?, ?)',
        [username, 'shop', 'admin']
      );
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
        // See note above: keep lax to avoid external-entry cookie loss.
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
        path: '/' // 確保 cookie 在所有路徑下都可用
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
    console.error('登入 API 錯誤:', err);
    // 如果是資料庫連接錯誤，返回更清楚的錯誤訊息
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('資料庫連接失敗 - 請檢查環境變數設定');
      return res.status(503).json({ 
        success: false, 
        message: '資料庫連接失敗，請聯繫管理員檢查伺服器設定' 
      });
    }
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
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
  // 新規則：註冊僅允許一般用戶（手機門號）。staff 需由 admin/shop 指派；shop/admin 需由 admin 建立。
  if (role !== 'user') {
    return res.status(403).json({ success: false, message: '僅允許註冊一般用戶，工作人員/商店/管理員帳號請由管理員建立或指派' });
  }
    // 手機門號註冊，不需密碼
    if (!/^09[0-9]{8}$/.test(username)) {
      return res.status(400).json({ success: false, message: '請輸入正確的手機門號' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    // 檢查帳號是否已存在
    const [exist] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (exist.length > 0) {
      return res.status(400).json({ success: false, message: '帳號已存在' });
    }
    // 寫入資料庫
    await conn.execute(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, null, 'user']
    );
    res.json({ success: true, message: '註冊成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// ===== 帳號/權限管理（新規則）=====

// admin 建立 admin/shop 帳號（帳號密碼）
app.post('/api/admin/accounts', authenticateToken, requireRole('admin'), async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ success: false, message: '缺少參數' });
  }
  if (!['admin', 'shop'].includes(role)) {
    return res.status(400).json({ success: false, message: '僅允許建立 admin 或 shop 帳號' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    const [exist] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (exist.length > 0) return res.status(400).json({ success: false, message: '帳號已存在' });

    const hashed = await bcrypt.hash(password, 10);
    await conn.execute(
      'INSERT INTO users (username, password, role, created_by) VALUES (?, ?, ?, ?)',
      [username, hashed, role, req.user.username]
    );
    res.json({ success: true, message: '建立成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// admin/shop 指派 staff：指定人選需先註冊 user（手機門號）
app.post('/api/staff/assign', authenticateToken, requireRole('admin', 'shop'), async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, message: '缺少 username' });
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT id, role FROM users WHERE username = ?', [username]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到使用者' });
    const u = rows[0];
    if (u.role === 'admin' || u.role === 'shop') return res.status(400).json({ success: false, message: '不可將 admin/shop 指派為 staff' });
    // 允許 user -> staff、或 staff 重新綁定（由 admin）
    if (u.role === 'staff' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '此帳號已是 staff，僅 admin 可重新指派' });
    }
    await conn.execute('UPDATE users SET role = ?, managed_by = ? WHERE id = ?', ['staff', req.user.username, u.id]);
    res.json({ success: true, message: '已指派為 staff' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// admin/shop 撤銷 staff：staff 變回 user，即可接取任務
app.post('/api/staff/revoke', authenticateToken, requireRole('admin', 'shop'), async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, message: '缺少 username' });
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT id, role, managed_by FROM users WHERE username = ?', [username]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到使用者' });
    const u = rows[0];
    if (u.role !== 'staff') return res.status(400).json({ success: false, message: '此帳號不是 staff' });
    if (req.user.role === 'shop' && u.managed_by !== req.user.username) {
      return res.status(403).json({ success: false, message: '無權限撤銷非本店 staff' });
    }
    await conn.execute('UPDATE users SET role = ?, managed_by = NULL WHERE id = ?', ['user', u.id]);
    res.json({ success: true, message: '已撤銷 staff，恢復為一般用戶' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// admin/shop 修改自己的密碼（第一次登入後可改）
app.post('/api/change-password', authenticateToken, requireRole('admin', 'shop'), async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ success: false, message: '缺少參數' });
  if (String(newPassword).length < 6) return res.status(400).json({ success: false, message: '新密碼至少 6 碼' });
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT id, password FROM users WHERE username = ?', [req.user.username]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到使用者' });
    const stored = rows[0].password;
    const ok = stored && (stored.startsWith('$2a$') || stored.startsWith('$2b$')) && await bcrypt.compare(oldPassword, stored);
    if (!ok) return res.status(400).json({ success: false, message: '舊密碼錯誤' });
    const hashed = await bcrypt.hash(newPassword, 10);
    await conn.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, rows[0].id]);
    res.json({ success: true, message: '密碼已更新' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// shop 店家資訊（未來地圖顯示用）
app.get('/api/shop/profile', authenticateToken, requireRole('shop', 'admin'), async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute(
      'SELECT username, role, shop_name, shop_address, shop_description FROM users WHERE username = ?',
      [req.user.username]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到帳號' });
    res.json({ success: true, profile: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

app.put('/api/shop/profile', authenticateToken, requireRole('shop', 'admin'), async (req, res) => {
  const { shop_name, shop_address, shop_description } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.execute(
      'UPDATE users SET shop_name = ?, shop_address = ?, shop_description = ? WHERE username = ?',
      [shop_name || null, shop_address || null, shop_description || null, req.user.username]
    );
    res.json({ success: true, message: '店家資訊已更新' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 查詢所有任務
// 獲取任務（前端用）
app.get('/api/tasks', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    // Join items 表格以獲取道具名稱，Join ar_models 獲取 3D 模型
    const [rows] = await conn.execute(`
      SELECT t.*, 
             i_req.name as required_item_name, i_req.image_url as required_item_image, i_req.model_url as required_item_model,
             i_rew.name as reward_item_name, i_rew.image_url as reward_item_image, i_rew.model_url as reward_item_model,
             am.url as ar_model_url, am.scale as ar_model_scale
      FROM tasks t
      LEFT JOIN items i_req ON t.required_item_id = i_req.id
      LEFT JOIN items i_rew ON t.reward_item_id = i_rew.id
      LEFT JOIN ar_models am ON t.ar_model_id = am.id
      WHERE 1=1 ORDER BY t.id DESC
    `);
    res.json({ success: true, tasks: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 獲取任務（管理後台用，根據用戶角色篩選）
app.get('/api/tasks/admin', authenticateToken, requireRole('shop', 'admin'), async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
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
    if (conn) conn.release();
  }
});

// === 劇情任務 (Quest Chains) API ===

// 取得所有劇情 (admin / shop)
app.get('/api/quest-chains', staffOrAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const { username, role } = req.user || {};
    // admin 看全部；shop 只看自己建立的劇情
    const [rows] = await conn.execute(
      role === 'admin'
        ? 'SELECT * FROM quest_chains ORDER BY id DESC'
        : 'SELECT * FROM quest_chains WHERE created_by = ? ORDER BY id DESC',
      role === 'admin' ? [] : [username]
    );
    res.json({ success: true, questChains: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 新增劇情 (支援圖片上傳)
app.post('/api/quest-chains', staffOrAdminAuth, uploadImage.single('badge_image'), async (req, res) => {
  const { title, description, chain_points, badge_name } = req.body;
  if (!title) return res.status(400).json({ success: false, message: '缺少標題' });

  const creator = req.user?.username || req.user?.username;
  
  // 處理上傳的圖片
  let badge_image = null;
  if (req.file) {
    badge_image = '/images/' + req.file.filename;
  } else if (req.body.badge_image_url) {
     // 如果有提供 URL (兼容舊方式或直接輸入)
     badge_image = req.body.badge_image_url;
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.execute(
      'INSERT INTO quest_chains (title, description, chain_points, badge_name, badge_image, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description, chain_points || 0, badge_name || null, badge_image || null, creator]
    );
    res.json({ success: true, message: '劇情建立成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 刪除劇情
app.delete('/api/quest-chains/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  const username = req.user?.username || req.user?.username;
  const userRole = req.user?.role;

  let conn;
  try {
    conn = await pool.getConnection();
    
    // 1. 檢查權限與擁有者
    const [quests] = await conn.execute('SELECT created_by FROM quest_chains WHERE id = ?', [id]);
    if (quests.length === 0) {
      return res.status(404).json({ success: false, message: '找不到此劇情' });
    }
    
    // Admin 可以刪除所有；Shop 只能刪除自己的
    if (userRole !== 'admin' && quests[0].created_by !== username) {
      return res.status(403).json({ success: false, message: '無權限刪除此劇情' });
    }

    // 2. 檢查是否有任務關聯到此劇情
    const [tasks] = await conn.execute('SELECT id FROM tasks WHERE quest_chain_id = ?', [id]);
    if (tasks.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `無法刪除：此劇情尚有 ${tasks.length} 個任務關聯中。請先刪除或移除相關任務。` 
      });
    }

    // 3. 執行刪除（使用事務確保數據一致性）
    await conn.beginTransaction();
    try {
      // 先刪除用戶的劇情進度 (user_quests) - 雖然理論上沒有任務應該就沒有進度，但保險起見
      await conn.execute('DELETE FROM user_quests WHERE quest_chain_id = ?', [id]);
      
      // 清理 point_transactions 中的關聯紀錄
      // 將 reference_type 為 'quest_chain_completion' 且 reference_id 為此劇情 ID 的紀錄標記為已刪除
      // 注意：不直接刪除積分紀錄，而是將 reference_id 設為 NULL，保留歷史記錄
      await conn.execute(
        'UPDATE point_transactions SET reference_id = NULL, description = CONCAT(description, " (劇情已刪除)") WHERE reference_type = "quest_chain_completion" AND reference_id = ?',
        [id]
      );
      
      // 刪除劇情
      await conn.execute('DELETE FROM quest_chains WHERE id = ?', [id]);
      
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }

    res.json({ success: true, message: '劇情已刪除' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// ===== 3D 模型庫管理 API =====

// 取得所有模型
app.get('/api/ar-models', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT * FROM ar_models ORDER BY id DESC');
    res.json({ success: true, models: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 上傳模型 (Admin/Shop)
app.post('/api/ar-models', staffOrAdminAuth, uploadModel.single('model'), async (req, res) => {
  const { name, scale } = req.body;
  if (!name) return res.status(400).json({ success: false, message: '缺少模型名稱' });
  if (!req.file) return res.status(400).json({ success: false, message: '未選擇檔案' });

  const modelUrl = '/images/' + req.file.filename; // 因為我們還是存在 /images 目錄下 (雖然是 .glb)
  const modelScale = parseFloat(scale) || 1.0;
  const username = req.user?.username || req.user?.username;

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.execute(
      'INSERT INTO ar_models (name, url, scale, created_by) VALUES (?, ?, ?, ?)',
      [name, modelUrl, modelScale, username]
    );
    res.json({ success: true, message: '模型上傳成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 刪除模型
app.delete('/api/ar-models/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    
    // 檢查是否有任務引用
    const [tasks] = await conn.execute('SELECT id FROM tasks WHERE ar_model_id = ?', [id]);
    if (tasks.length > 0) {
      return res.status(400).json({ success: false, message: '此模型正被任務使用中，無法刪除' });
    }

    // 刪除檔案 (選擇性實作，目前只刪除 DB 紀錄，保留檔案以防誤刪)
    await conn.execute('DELETE FROM ar_models WHERE id = ?', [id]);
    res.json({ success: true, message: '模型已刪除' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// ===== 道具系統 (Item System) API =====

// 取得所有道具
app.get('/api/items', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT * FROM items ORDER BY id DESC');
    res.json({ success: true, items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 新增道具 (Admin/Shop)
app.post('/api/items', staffOrAdminAuth, uploadImage.single('image'), async (req, res) => {
  const { name, description, model_url } = req.body;
  if (!name) return res.status(400).json({ success: false, message: '缺少道具名稱' });

  let image_url = null;
  if (req.file) {
    image_url = '/images/' + req.file.filename;
  } else if (req.body.image_url) {
    image_url = req.body.image_url;
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.execute(
      'INSERT INTO items (name, description, image_url, model_url) VALUES (?, ?, ?, ?)',
      [name, description || '', image_url, model_url || null]
    );
    res.json({ success: true, message: '道具新增成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 編輯道具
app.put('/api/items/:id', staffOrAdminAuth, uploadImage.single('image'), async (req, res) => {
  const { id } = req.params;
  const { name, description, model_url } = req.body;
  if (!name) return res.status(400).json({ success: false, message: '缺少道具名稱' });

  let conn;
  try {
    conn = await pool.getConnection();
    
    // 如果有上傳新圖片就更新，否則保留原圖
    let sql, params;
    if (req.file) {
      const image_url = '/images/' + req.file.filename;
      sql = 'UPDATE items SET name = ?, description = ?, image_url = ?, model_url = ? WHERE id = ?';
      params = [name, description || '', image_url, model_url || null, id];
    } else if (req.body.image_url) {
      sql = 'UPDATE items SET name = ?, description = ?, image_url = ?, model_url = ? WHERE id = ?';
      params = [name, description || '', req.body.image_url, model_url || null, id];
    } else {
      sql = 'UPDATE items SET name = ?, description = ?, model_url = ? WHERE id = ?';
      params = [name, description || '', model_url || null, id];
    }

    await conn.execute(sql, params);
    res.json({ success: true, message: '道具更新成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 刪除道具
app.delete('/api/items/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    
    // 檢查是否有任務使用了此道具
    const [tasks] = await conn.execute(
      'SELECT id FROM tasks WHERE required_item_id = ? OR reward_item_id = ?',
      [id, id]
    );
    if (tasks.length > 0) {
      return res.status(400).json({ success: false, message: '此道具被任務引用中，無法刪除' });
    }

    await conn.execute('DELETE FROM items WHERE id = ?', [id]);
    res.json({ success: true, message: '道具已刪除' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 管理員發放道具給玩家
app.post('/api/admin/grant-item', staffOrAdminAuth, async (req, res) => {
  const { username, item_id, quantity } = req.body;
  if (!username || !item_id) return res.status(400).json({ success: false, message: '缺少必要參數' });
  const qty = parseInt(quantity) || 1;

  let conn;
  try {
    conn = await pool.getConnection();
    
    // 檢查玩家是否存在
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(404).json({ success: false, message: '找不到此玩家帳號' });
    const userId = users[0].id;

    // 檢查道具是否存在
    const [items] = await conn.execute('SELECT id, name FROM items WHERE id = ?', [item_id]);
    if (items.length === 0) return res.status(404).json({ success: false, message: '找不到此道具' });
    const itemName = items[0].name;

    // 發放道具 (檢查是否已有，有則更新數量，無則新增)
    const [inventory] = await conn.execute(
      'SELECT id FROM user_inventory WHERE user_id = ? AND item_id = ?', 
      [userId, item_id]
    );

    if (inventory.length > 0) {
      await conn.execute('UPDATE user_inventory SET quantity = quantity + ? WHERE id = ?', [qty, inventory[0].id]);
    } else {
      await conn.execute('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, ?)', [userId, item_id, qty]);
    }

    res.json({ success: true, message: `已成功發放 ${qty} 個【${itemName}】給 ${username}` });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 取得使用者背包
app.get('/api/user/inventory', authenticateToken, async (req, res) => {
  // 強制使用 JWT 認證
  if (!req.user || !req.user.username) {
    return res.status(401).json({ success: false, message: '未認證' });
  }
  const username = req.user.username;

  let conn;
  try {
    conn = await pool.getConnection();
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.json({ success: true, inventory: [] });
    const userId = users[0].id;

    const [rows] = await conn.execute(`
      SELECT ui.*, i.name, i.description, i.image_url 
      FROM user_inventory ui
      JOIN items i ON ui.item_id = i.id
      WHERE ui.user_id = ?
    `, [userId]);
    
    res.json({ success: true, inventory: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 新增任務
app.post('/api/tasks', staffOrAdminAuth, async (req, res) => {
  const { 
    name, lat, lng, radius, description, photoUrl, youtubeUrl, ar_image_url, points, 
    task_type, options, correct_answer,
    // 新增參數
    type, quest_chain_id, quest_order, time_limit_start, time_limit_end, max_participants,
    // 道具參數
    required_item_id, reward_item_id,
    // 劇情結局關卡
    is_final_step,
    // AR 模型 ID 與 順序
    ar_model_id,
    ar_order_model, ar_order_image, ar_order_youtube,
    // 背景音樂
    bgm_url
  } = req.body;

  console.log('[POST /api/tasks] Received:', req.body);

  const requester = req.user || {};
  const requesterRole = requester.role;
  const requesterName = requester.username;

  if (!name || !lat || !lng || !radius || !description || !photoUrl) {
    return res.status(400).json({ success: false, message: '缺少參數' });
  }

  // 商店新增任務：若指定 quest_chain_id，必須是自己建立的劇情
  if (requesterRole === 'shop' && quest_chain_id) {
    let connCheck;
    try {
      connCheck = await pool.getConnection();
      const [chains] = await connCheck.execute(
        'SELECT id FROM quest_chains WHERE id = ? AND created_by = ?',
        [quest_chain_id, requesterName]
      );
      if (chains.length === 0) {
        return res.status(403).json({ success: false, message: '無權使用其他人建立的劇情' });
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (connCheck) connCheck.release();
    }
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const username = req.user?.username;
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
    
    const reqItemId = required_item_id ? Number(required_item_id) : null;
    const rewItemId = reward_item_id ? Number(reward_item_id) : null;
    const isFinal = is_final_step === true || is_final_step === 'true' || is_final_step === 1;
    const arModelId = ar_model_id ? Number(ar_model_id) : null;
    
    const orderModel = ar_order_model ? Number(ar_order_model) : null;
    const orderImage = ar_order_image ? Number(ar_order_image) : null;
    const orderYoutube = ar_order_youtube ? Number(ar_order_youtube) : null;

    // 動態檢查 bgm_url 欄位是否存在
    const [bgmColCheck] = await conn.execute("SHOW COLUMNS FROM tasks LIKE 'bgm_url'");
    const hasBgmUrl = bgmColCheck.length > 0;
    
    const bgmUrlValue = bgm_url || null;
    
    if (hasBgmUrl) {
    await conn.execute(
        `INSERT INTO tasks (
          name, lat, lng, radius, description, photoUrl, iconUrl, youtubeUrl, ar_image_url, points, created_by, 
          task_type, options, correct_answer,
          type, quest_chain_id, quest_order, time_limit_start, time_limit_end, max_participants,
          required_item_id, reward_item_id, is_final_step, ar_model_id,
          ar_order_model, ar_order_image, ar_order_youtube, bgm_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name, lat, lng, radius, description, photoUrl, '/images/flag-red.png', youtubeUrl || null, ar_image_url || null, pts, username, 
          tType, opts, correct_answer || null,
          mainType, qId, qOrder, tStart, tEnd, maxP,
          reqItemId, rewItemId, isFinal, arModelId,
          orderModel, orderImage, orderYoutube, bgmUrlValue
        ]
      );
    } else {
      await conn.execute(
        `INSERT INTO tasks (
          name, lat, lng, radius, description, photoUrl, iconUrl, youtubeUrl, ar_image_url, points, created_by, 
          task_type, options, correct_answer,
          type, quest_chain_id, quest_order, time_limit_start, time_limit_end, max_participants,
          required_item_id, reward_item_id, is_final_step, ar_model_id,
          ar_order_model, ar_order_image, ar_order_youtube
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name, lat, lng, radius, description, photoUrl, '/images/flag-red.png', youtubeUrl || null, ar_image_url || null, pts, username, 
          tType, opts, correct_answer || null,
          mainType, qId, qOrder, tStart, tEnd, maxP,
          reqItemId, rewItemId, isFinal, arModelId,
          orderModel, orderImage, orderYoutube
        ]
      );
    }
    res.json({ success: true, message: '新增成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 安全的檔案上傳 API（圖片，5MB 限制）
app.post('/api/upload', authenticateToken, requireRole('user', 'shop', 'admin'), (req, res) => {
  // 使用一般圖片上傳配置（5MB 限制）
  uploadImage.single('photo')(req, res, (err) => {
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

// 音頻文件上傳 API（100MB 限制）
app.post('/api/upload-audio', authenticateToken, requireRole('shop', 'admin'), (req, res) => {
  // 使用音頻上傳配置（100MB 限制）
  uploadAudio.single('audio')(req, res, (err) => {
    if (err) {
      // 處理上傳錯誤
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: '檔案大小超過 100MB 限制' });
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
      console.error('音頻上傳錯誤:', err);
      return res.status(500).json({ success: false, message: '音頻上傳失敗' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: '未選擇檔案' });
    }

    // 回傳安全的音頻路徑（使用新的檔案名稱）
    const audioUrl = '/images/' + req.file.filename;
    console.log(`✅ 音頻上傳成功: ${req.file.originalname} -> ${req.file.filename}`);
    res.json({ success: true, url: audioUrl, filename: req.file.filename });
  });
});

// 查詢目前登入者進行中的任務（需傳 username）
app.get('/api/user-tasks', authenticateToken, async (req, res) => {
  // 強制使用 JWT 認證
  if (!req.user || !req.user.username) {
    return res.status(401).json({ success: false, message: '未認證' });
  }
  const username = req.user.username;
  
  let conn;
  try {
    conn = await pool.getConnection();
    // 取得 user_id（使用認證的 username）
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
    if (conn) conn.release();
  }
});

// 加入任務（需傳 username, task_id）
app.post('/api/user-tasks', authenticateToken, async (req, res) => {
  // 強制使用 JWT 認證
  if (!req.user || !req.user.username) {
    return res.status(401).json({ success: false, message: '未認證' });
  }
  const username = req.user.username;

  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ success: false, message: '缺少參數' });
  let conn;
  try {
    conn = await pool.getConnection();
    // 取得 user_id 與 role（使用認證的 username，而不是請求中的 username）
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
    if (conn) conn.release();
  }
});

// 管理員刪除用戶任務紀錄 (重置任務狀態)
app.delete('/api/user-tasks/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    // 檢查該紀錄是否存在
    const [rows] = await conn.execute('SELECT id FROM user_tasks WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到該任務紀錄' });

    await conn.execute('DELETE FROM user_tasks WHERE id = ?', [id]);
    res.json({ success: true, message: '任務紀錄已刪除，玩家可重新接取' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 完成任務（人工審核用，需 reviewer 權限）
app.post('/api/user-tasks/finish', reviewerAuth, async (req, res) => {
  const { username, task_id } = req.body;
  if (!username || !task_id) return res.status(400).json({ success: false, message: '缺少參數' });
  let conn;
  try {
    conn = await pool.getConnection();

    // 取得 user_id
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(400).json({ success: false, message: '找不到使用者' });
    const userId = users[0].id;

    // 取得任務資訊 + 建立者（用於權限判斷）
    const [tasks] = await conn.execute('SELECT name, points, created_by, quest_chain_id, quest_order FROM tasks WHERE id = ?', [task_id]);
    if (tasks.length === 0) return res.status(400).json({ success: false, message: '找不到任務' });
    const task = tasks[0];

    // 權限範圍判斷（admin 全部；shop 僅自己；staff 僅所屬 shop/admin）
    // 新規則：shop 也可審核全部任務（不限制 created_by）

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

      // 發放獎勵道具 (檢查任務是否有 reward_item_id)
      let earnedItemName = null;
      const [taskDetails] = await conn.execute('SELECT reward_item_id, i.name as item_name FROM tasks t LEFT JOIN items i ON t.reward_item_id = i.id WHERE t.id = ?', [task_id]);
      if (taskDetails.length > 0 && taskDetails[0].reward_item_id) {
        const rewardItemId = taskDetails[0].reward_item_id;
        earnedItemName = taskDetails[0].item_name;
        // 檢查背包是否已有此道具
        const [inventory] = await conn.execute(
          'SELECT id, quantity FROM user_inventory WHERE user_id = ? AND item_id = ?',
          [userId, rewardItemId]
        );
        if (inventory.length > 0) {
          // 已有，數量+1
          await conn.execute('UPDATE user_inventory SET quantity = quantity + 1 WHERE id = ?', [inventory[0].id]);
        } else {
          // 沒有，新增
          await conn.execute('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)', [userId, rewardItemId]);
        }
      }

      // 更新劇情任務進度
      if (task.quest_chain_id && task.quest_order) {
        const [userQuests] = await conn.execute(
          'SELECT id, current_step_order FROM user_quests WHERE user_id = ? AND quest_chain_id = ?',
          [userId, task.quest_chain_id]
        );

        if (userQuests.length > 0) {
          if (userQuests[0].current_step_order === task.quest_order) {
            await conn.execute(
              'UPDATE user_quests SET current_step_order = current_step_order + 1 WHERE id = ?',
              [userQuests[0].id]
            );
          }
        } else {
          await conn.execute(
            'INSERT INTO user_quests (user_id, quest_chain_id, current_step_order) VALUES (?, ?, ?)',
            [userId, task.quest_chain_id, task.quest_order + 1]
          );
        }
      }

      await conn.commit();
      
      let msg = `已完成任務，獲得 ${task.points} 積分！`;
      if (earnedItemName) {
        msg += ` 並獲得道具：${earnedItemName}`;
      }
      res.json({ success: true, message: msg });

    } catch (err) {
      await conn.rollback();
      throw err;
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 查詢單一任務
app.get('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    // Join items 表格以獲取道具名稱，Join ar_models 獲取 3D 模型
    const [rows] = await conn.execute(`
      SELECT t.*, 
             i_req.name as required_item_name, i_req.image_url as required_item_image, i_req.model_url as required_item_model,
             i_rew.name as reward_item_name, i_rew.image_url as reward_item_image, i_rew.model_url as reward_item_model,
             am.url as ar_model_url, am.scale as ar_model_scale
      FROM tasks t
      LEFT JOIN items i_req ON t.required_item_id = i_req.id
      LEFT JOIN items i_rew ON t.reward_item_id = i_rew.id
      LEFT JOIN ar_models am ON t.ar_model_id = am.id
      WHERE t.id = ?
    `, [id]);
    
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到任務' });
    res.json({ success: true, task: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 編輯任務
app.put('/api/tasks/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { 
    name, lat, lng, radius, description, photoUrl, youtubeUrl, ar_image_url, points, 
    task_type, options, correct_answer,
    type, quest_chain_id, quest_order, time_limit_start, time_limit_end, max_participants,
    // 道具參數
    required_item_id, reward_item_id,
    // 劇情結局關卡
    is_final_step,
    // AR 模型 ID 與 順序
    ar_model_id,
    ar_order_model, ar_order_image, ar_order_youtube,
    // 背景音樂
    bgm_url
  } = req.body;

  if (!name || !lat || !lng || !radius || !description || !photoUrl) {
    return res.status(400).json({ success: false, message: '缺少參數' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const username = req.user?.username;

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
    
    const reqItemId = required_item_id ? Number(required_item_id) : null;
    const rewItemId = reward_item_id ? Number(reward_item_id) : null;
    const isFinal = is_final_step === true || is_final_step === 'true' || is_final_step === 1;
    const arModelId = ar_model_id ? Number(ar_model_id) : null;
    
    const orderModel = ar_order_model ? Number(ar_order_model) : null;
    const orderImage = ar_order_image ? Number(ar_order_image) : null;
    const orderYoutube = ar_order_youtube ? Number(ar_order_youtube) : null;
    const bgmUrlValue = bgm_url || null;

    // 動態檢查 bgm_url 欄位是否存在
    const [bgmColCheck] = await conn.execute("SHOW COLUMNS FROM tasks LIKE 'bgm_url'");
    const hasBgmUrl = bgmColCheck.length > 0;

    if (hasBgmUrl) {
    await conn.execute(
        `UPDATE tasks SET 
          name=?, lat=?, lng=?, radius=?, description=?, photoUrl=?, youtubeUrl=?, ar_image_url=?, points=?, 
          task_type=?, options=?, correct_answer=?,
          type=?, quest_chain_id=?, quest_order=?, time_limit_start=?, time_limit_end=?, max_participants=?,
          required_item_id=?, reward_item_id=?, is_final_step=?, ar_model_id=?,
          ar_order_model=?, ar_order_image=?, ar_order_youtube=?, bgm_url=?
         WHERE id=?`,
        [
          name, lat, lng, radius, description, photoUrl, youtubeUrl || null, ar_image_url || null, pts, 
          tType, opts, correct_answer || null, 
          mainType, qId, qOrder, tStart, tEnd, maxP,
          reqItemId, rewItemId, isFinal, arModelId,
          orderModel, orderImage, orderYoutube, bgmUrlValue,
          id
        ]
      );
    } else {
      await conn.execute(
        `UPDATE tasks SET 
          name=?, lat=?, lng=?, radius=?, description=?, photoUrl=?, youtubeUrl=?, ar_image_url=?, points=?, 
          task_type=?, options=?, correct_answer=?,
          type=?, quest_chain_id=?, quest_order=?, time_limit_start=?, time_limit_end=?, max_participants=?,
          required_item_id=?, reward_item_id=?, is_final_step=?, ar_model_id=?,
          ar_order_model=?, ar_order_image=?, ar_order_youtube=?
         WHERE id=?`,
        [
          name, lat, lng, radius, description, photoUrl, youtubeUrl || null, ar_image_url || null, pts, 
          tType, opts, correct_answer || null, 
          mainType, qId, qOrder, tStart, tEnd, maxP,
          reqItemId, rewItemId, isFinal, arModelId,
          orderModel, orderImage, orderYoutube,
          id
        ]
      );
    }
    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 刪除任務
app.delete('/api/tasks/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    const username = req.user?.username;

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
    if (conn) conn.release();
  }
});

// ====== Rank 計算工具 ======
// 計算任務完成時間差並返回等級
// 注意：此函數假設資料庫 TIMESTAMP 存儲的是 UTC 時間
// 如果 MySQL 的 time_zone 設定為 UTC，則此假設正確
// 如果資料庫存儲的已經是本地時間（台灣時區），則不需要手動轉換
function getRank(started, finished) {
  if (!started || !finished) return '';
  
  // MySQL TIMESTAMP 類型會自動轉換為伺服器時區
  // 如果伺服器時區是 UTC，則需要手動轉換為台灣時區 (UTC+8)
  // 如果伺服器時區已經是 Asia/Taipei，則不需要轉換
  // 為了安全，這裡假設資料庫返回的是 UTC，手動轉換為台灣時區
  const startedDate = new Date(started);
  const finishedDate = new Date(finished);
  
  // 計算時間差（小時）- 直接計算，因為 Date 對象會自動處理時區
  // 如果資料庫返回的是 UTC 字符串，JavaScript Date 會自動轉換為本地時區
  // 所以這裡不需要手動加 8 小時，除非資料庫返回的是已經轉換過的本地時間字符串
  const diff = (finishedDate.getTime() - startedDate.getTime()) / (1000 * 60 * 60);
  
  // 等級判定（基於完成時間，單位：小時）
  if (diff <= 1) return 'S+';
  if (diff <= 2) return 'S';
  if (diff <= 3) return 'A';
  if (diff <= 4) return 'B';
  if (diff <= 5) return 'C';
  if (diff <= 6) return 'D';
  return 'E';
}

// 查詢使用者在各劇情任務線的目前進度 (具備自我修復功能)
app.get('/api/user/quest-progress', authenticateToken, async (req, res) => {
  // 強制使用 JWT 認證
  if (!req.user || !req.user.username) {
    return res.status(401).json({ success: false, message: '未認證' });
  }
  const username = req.user.username;
  
  if (!username) {
    console.warn('[quest-progress] 未提供用戶名');
    return res.json({ success: true, progress: {} });
  } 

  let conn;
  try {
    conn = await pool.getConnection();
    
    // 取得 user_id
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.json({ success: true, progress: {} });
    const userId = users[0].id;

    // 1. 查詢 user_quests 表 (目前的記錄)
    const [questRows] = await conn.execute(
      'SELECT quest_chain_id, current_step_order FROM user_quests WHERE user_id = ?',
      [userId]
    );
    const currentProgress = {};
    questRows.forEach(row => {
      // 確保 quest_chain_id 作為字串 key，避免類型不匹配問題
      const chainId = String(row.quest_chain_id);
      currentProgress[chainId] = row.current_step_order;
    });

    // 2. 自我修復邏輯：檢查 user_tasks 中實際完成的任務
    // 找出每個劇情線中，使用者已完成的最大 quest_order
    const [completedRows] = await conn.execute(`
      SELECT t.quest_chain_id, MAX(t.quest_order) as max_completed_order
      FROM user_tasks ut
      JOIN tasks t ON ut.task_id = t.id
      WHERE ut.user_id = ? AND ut.status = '完成' AND t.quest_chain_id IS NOT NULL
      GROUP BY t.quest_chain_id
    `, [userId]);

    const updates = [];

    // 比對並修復
    for (const row of completedRows) {
      // 確保 chainId 作為字串，與 currentProgress 的 key 類型一致
      const chainId = String(row.quest_chain_id);
      const maxCompleted = row.max_completed_order;
      // 理論上，如果完成了第 N 關，當前進度應該是 N + 1
      const correctNextStep = maxCompleted + 1;

      if (!currentProgress[chainId]) {
        // 情況 A: user_quests 沒記錄，但有完成的任務 -> 補插入
        updates.push(
          conn.execute(
            'INSERT INTO user_quests (user_id, quest_chain_id, current_step_order) VALUES (?, ?, ?)',
            [userId, row.quest_chain_id, correctNextStep] // 資料庫插入時使用原始數字類型
          )
        );
        currentProgress[chainId] = correctNextStep;
      } else if (currentProgress[chainId] < correctNextStep) {
        // 情況 B: 記錄落後 (例如記錄是 1，但已經完成了第 1 關，應該要是 2) -> 更新
        updates.push(
          conn.execute(
            'UPDATE user_quests SET current_step_order = ? WHERE user_id = ? AND quest_chain_id = ?',
            [correctNextStep, userId, row.quest_chain_id] // 資料庫更新時使用原始數字類型
          )
        );
        currentProgress[chainId] = correctNextStep;
      }
    }

    if (updates.length > 0) {
      await Promise.all(updates);
      console.log(`[quest-progress] 已自動修復使用者 ${username} 的 ${updates.length} 條劇情進度`);
    }

    console.log(`[quest-progress] 使用者 ${username} 的劇情進度:`, currentProgress);
    res.json({ success: true, progress: currentProgress });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 查詢所有（進行中＋完成）任務
app.get('/api/user-tasks/all', authenticateToken, async (req, res) => {
  // 強制使用 JWT 認證
  if (!req.user || !req.user.username) {
    return res.status(401).json({ success: false, message: '未認證' });
  }
  const username = req.user.username;
  
  let conn;
  try {
    conn = await pool.getConnection();
    // 取得 user_id（使用認證的 username）
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
    if (conn) conn.release();
  }
});

// ===== Admin 權限驗證中介層 (安全性修復：基於 JWT) =====
function adminAuth(req, res, next) {
  authenticateTokenCompat(req, res, () => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
      return res.status(403).json({ success: false, message: '無權限：需要管理員身分' });
    }
  });
}

// ===== Staff 或 Admin 權限驗證中介層 (安全性修復：基於 JWT) =====
function staffOrAdminAuth(req, res, next) {
  authenticateTokenCompat(req, res, () => {
    const role = req.user?.role;
    if (role === 'admin' || role === 'shop' || role === 'staff') {
      next();
    } else {
          return res.status(403).json({ success: false, message: '無權限' });
        }
  });
}

// ===== Reviewer 權限：staff / shop / admin 都可審核（新規則）=====
function reviewerAuth(req, res, next) {
  authenticateTokenCompat(req, res, async () => {
    if (!req.user || !req.user.username) return res.status(401).json({ success: false, message: '未認證' });
    try {
      const conn = await pool.getConnection();
      const [rows] = await conn.execute('SELECT role, managed_by FROM users WHERE username = ?', [req.user.username]);
      conn.release();
      if (rows.length === 0) return res.status(401).json({ success: false, message: '用戶不存在' });
      const role = rows[0].role;
      if (!['admin', 'shop', 'staff'].includes(role)) {
        return res.status(403).json({ success: false, message: '無權限' });
      }
      // 強制以 DB 為準（避免 token 舊資料）
      req.user.role = role;
      req.user.managed_by = rows[0].managed_by || null;
      return next();
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
  });
}

// ===== Staff 兌換任務獎勵 =====
app.post('/api/user-tasks/:id/redeem', reviewerAuth, async (req, res) => {
  const { id } = req.params;
  const staffUser = req.user.username;
  let conn;
  try {
    conn = await pool.getConnection();
    // 只能兌換已完成且未兌換的（同時做任務建立者權限範圍判斷）
    const [rows] = await conn.execute(
      `SELECT ut.*, t.created_by
       FROM user_tasks ut
       JOIN tasks t ON ut.task_id = t.id
       WHERE ut.id = ? AND ut.status = "完成" AND ut.redeemed = 0`,
      [id]
    );
    if (rows.length === 0) return res.status(400).json({ success: false, message: '不可重複兌換或尚未完成' });

    // 新規則：shop 也可核銷全部任務（不限制 created_by）

    await conn.execute('UPDATE user_tasks SET redeemed = 1, redeemed_at = NOW(), redeemed_by = ? WHERE id = ?', [staffUser, id]);
    res.json({ success: true, message: '已兌換' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// ===== Staff 查詢所有進行中任務（可搜尋） =====
app.get('/api/user-tasks/in-progress', reviewerAuth, async (req, res) => {
  const { taskName, username } = req.query;
  let conn;
  try {
    conn = await pool.getConnection();
    const userRole = req.user.role;
    const reqUsername = req.user.username;
    const reviewerOwner = reqUsername;
    let sql = `SELECT ut.id as user_task_id, ut.user_id, ut.task_id, ut.status, ut.started_at, ut.finished_at, ut.redeemed, ut.redeemed_at, ut.redeemed_by, ut.answer, u.username, t.name as task_name, t.description, t.points, t.created_by as task_creator, t.task_type
      FROM user_tasks ut
      JOIN users u ON ut.user_id = u.id
      JOIN tasks t ON ut.task_id = t.id
      WHERE ut.status = '進行中'`;
    const params = [];

    // 新規則：shop 也可審核全部任務（不再限制 created_by）

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
    if (conn) conn.release();
  }
});

// ===== Staff 查詢所有已完成但未兌換的任務（可搜尋） =====
app.get('/api/user-tasks/to-redeem', reviewerAuth, async (req, res) => {
  const { taskName, username } = req.query;
  let conn;
  try {
    conn = await pool.getConnection();
    const userRole = req.user.role;
    const reqUsername = req.user.username;
    const reviewerOwner = reqUsername;
    let sql = `SELECT ut.id as user_task_id, ut.user_id, ut.task_id, ut.status, ut.started_at, ut.finished_at, ut.redeemed, ut.redeemed_at, ut.redeemed_by, u.username, t.name as task_name, t.description, t.points, t.created_by as task_creator, t.task_type
      FROM user_tasks ut
      JOIN users u ON ut.user_id = u.id
      JOIN tasks t ON ut.task_id = t.id
      WHERE ut.status = '完成' AND ut.redeemed = 0`;
    const params = [];

    // 新規則：shop 也可審核全部任務（不再限制 created_by）

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
    if (conn) conn.release();
  }
});

// 儲存/更新猜謎答案或提交選擇題答案
app.patch('/api/user-tasks/:id/answer', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { answer } = req.body;
  if (!answer) return res.status(400).json({ success: false, message: '缺少答案' });
  
  // 強制使用 JWT 認證
  if (!req.user || !req.user.username) {
    return res.status(401).json({ success: false, message: '未認證' });
  }
  const username = req.user.username;
  
  let conn;
  try {
    conn = await pool.getConnection();

    // 1. 取得任務資訊
    const [rows] = await conn.execute(`
      SELECT ut.*, t.task_type, t.correct_answer, t.points, t.name as task_name, ut.user_id, ut.task_id, t.quest_chain_id, t.quest_order
      FROM user_tasks ut
      JOIN tasks t ON ut.task_id = t.id
      WHERE ut.id = ?
    `, [id]);

    if (rows.length === 0) return res.status(404).json({ success: false, message: '任務不存在' });
    const userTask = rows[0];
    
    // 2. 驗證任務屬於當前用戶
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(401).json({ success: false, message: '用戶不存在' });
    const userId = users[0].id;
    
    if (userTask.user_id !== userId) {
      return res.status(403).json({ success: false, message: '無權限：此任務不屬於您' });
    }

    if (userTask.status === '完成') {
       return res.json({ 
         success: true, 
         message: '任務已完成，無需更新',
         isCompleted: true,
         questChainCompleted: false,
         questChainReward: null
       });
    }

    let isCompleted = false;
    let message = '答案已儲存';
    let earnedItemName = null; // 移到外層宣告
    let questChainCompleted = false; // 移到外層宣告
    let questChainReward = null; // 移到外層宣告

    // 2. 檢查是否為自動驗證題型且答案正確
    if (['multiple_choice', 'number', 'keyword', 'location'].includes(userTask.task_type)) {
      if (userTask.task_type === 'location') {
        // 地理圍欄任務：只要前端送出請求，即視為完成
        isCompleted = true;
        message = '📍 打卡成功！';
      } else if (userTask.correct_answer && answer.trim().toLowerCase() === userTask.correct_answer.trim().toLowerCase()) {
        isCompleted = true;
        message = '答對了！任務完成！';
      } else {
        // 答錯，不完成任務
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

         // 發放獎勵道具
         const [taskDetails] = await conn.execute('SELECT reward_item_id, i.name as item_name FROM tasks t LEFT JOIN items i ON t.reward_item_id = i.id WHERE t.id = ?', [userTask.task_id]);
         if (taskDetails.length > 0 && taskDetails[0].reward_item_id) {
           const rewardItemId = taskDetails[0].reward_item_id;
           earnedItemName = taskDetails[0].item_name;
           const [inventory] = await conn.execute(
             'SELECT id, quantity FROM user_inventory WHERE user_id = ? AND item_id = ?',
             [userTask.user_id, rewardItemId]
           );
           if (inventory.length > 0) {
             await conn.execute('UPDATE user_inventory SET quantity = quantity + 1 WHERE id = ?', [inventory[0].id]);
           } else {
             await conn.execute('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, 1)', [userTask.user_id, rewardItemId]);
           }
         }

         // 更新劇情任務進度
         if (userTask.quest_chain_id && userTask.quest_order) {
           const [userQuests] = await conn.execute(
             'SELECT id, current_step_order FROM user_quests WHERE user_id = ? AND quest_chain_id = ?',
             [userTask.user_id, userTask.quest_chain_id]
           );

           if (userQuests.length > 0) {
             // 已經有進度，且完成的是當前步驟 -> 進度+1
             // 這裡假設 quest_order 是循序漸進的 (1, 2, 3...)
             if (userQuests[0].current_step_order === userTask.quest_order) {
               await conn.execute(
                 'UPDATE user_quests SET current_step_order = current_step_order + 1 WHERE id = ?',
                 [userQuests[0].id]
               );
             }
           } else {
             // 還沒有進度記錄（理論上如果是第一關應該要有，但如果是手動亂接的可能沒有）
             // 插入下一關 (當前關卡 + 1)
             await conn.execute(
               'INSERT INTO user_quests (user_id, quest_chain_id, current_step_order) VALUES (?, ?, ?)',
               [userTask.user_id, userTask.quest_chain_id, userTask.quest_order + 1]
             );
           }
           
           // 檢查是否完成整個劇情線
           // 查詢該劇情線的最大關卡數
           const [maxOrder] = await conn.execute(
             'SELECT MAX(quest_order) as max_order FROM tasks WHERE quest_chain_id = ?',
             [userTask.quest_chain_id]
           );
           
           if (maxOrder.length > 0 && maxOrder[0].max_order === userTask.quest_order) {
             // 完成了最後一關！
             questChainCompleted = true;
             
             // 獲取劇情線的獎勵信息
             const [questChain] = await conn.execute(
               'SELECT chain_points, badge_name, badge_image FROM quest_chains WHERE id = ?',
               [userTask.quest_chain_id]
             );
             
             if (questChain.length > 0) {
               questChainReward = questChain[0];
               
               // 發放額外積分
               if (questChainReward.chain_points > 0) {
                 // 記錄積分交易 (系統會自動計算總積分，無需更新 user_points 表)
                 await conn.execute(
                   'INSERT INTO point_transactions (user_id, type, points, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
                   [userTask.user_id, 'earned', questChainReward.chain_points, `完成劇情線：${questChainReward.badge_name || '未命名劇情'}`, 'quest_chain_completion', userTask.quest_chain_id]
                 );
               }
               
               // 標記劇情線為完成（稱號信息已經在 quest_chains 表中，不需要額外存儲）
               await conn.execute(
                 'UPDATE user_quests SET is_completed = TRUE, completed_at = NOW() WHERE user_id = ? AND quest_chain_id = ?',
                 [userTask.user_id, userTask.quest_chain_id]
               );
             }
           }
         }

         await conn.commit();
         
         // 更新回傳訊息
         if (earnedItemName) {
            message += ` 並獲得道具：${earnedItemName}！`;
         }
       } catch (err) {
         await conn.rollback();
         throw err;
       }
    } else {
       // 只更新答案，狀態不變（保持進行中）
       await conn.execute('UPDATE user_tasks SET answer = ? WHERE id = ?', [answer, id]);
    }

    // 如果任務完成，發送推送通知
    if (isCompleted) {
      const pushTitle = questChainCompleted 
        ? '🎉 劇情線完成！' 
        : '✅ 任務完成！';
      
      let pushBody = `恭喜完成「${userTask.task_name}」`;
      if (earnedItemName) {
        pushBody += `，獲得道具：${earnedItemName}`;
      }
      if (questChainCompleted && questChainReward) {
        pushBody += `\n獲得稱號：${questChainReward.badge_name || '未命名稱號'}`;
        if (questChainReward.chain_points > 0) {
          pushBody += `\n額外積分：${questChainReward.chain_points}`;
        }
      }

      // 非阻塞方式發送推送（不等待完成）
      sendPushNotification(
        userTask.user_id,
        pushTitle,
        pushBody,
        {
          url: `/task-detail.html?id=${userTask.task_id}`,
          taskId: userTask.task_id
        }
      ).catch(err => {
        console.error('推送通知發送失敗（非阻塞）:', err);
      });
    }

    res.json({ 
      success: true, 
      message, 
      isCompleted, 
      earnedItemName,
      questChainCompleted,
      questChainReward: questChainCompleted ? questChainReward : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 獲取用戶的所有稱號
app.get('/api/user/badges', authenticateToken, async (req, res) => {
  // 強制使用 JWT 認證
  if (!req.user || !req.user.username) {
    return res.status(401).json({ success: false, message: '未認證' });
  }
  const username = req.user.username;

  let conn;
  try {
    conn = await pool.getConnection();
    
    // 獲取用戶 ID
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.json({ success: true, badges: [] });
    }
    const userId = users[0].id;

    // 從 user_quests JOIN quest_chains 獲取已完成的劇情稱號
    const [badges] = await conn.execute(
      `SELECT 
        uq.id,
        qc.badge_name as name,
        qc.badge_image as image_url,
        uq.completed_at as obtained_at,
        'quest' as source_type,
        uq.quest_chain_id as source_id
      FROM user_quests uq
      JOIN quest_chains qc ON uq.quest_chain_id = qc.id
      WHERE uq.user_id = ? AND uq.is_completed = TRUE AND qc.badge_name IS NOT NULL
      ORDER BY uq.completed_at DESC`,
      [userId]
    );

    res.json({ success: true, badges });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// ===== 推送通知 API =====

// 獲取 VAPID 公鑰（前端訂閱時需要）
app.get('/api/push/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(503).json({ 
      success: false, 
      message: '推送通知服務未配置，請聯繫管理員' 
    });
  }
  res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

// 訂閱推送通知
app.post('/api/push/subscribe', authenticateTokenCompat, async (req, res) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(503).json({ 
      success: false, 
      message: '推送通知服務未配置' 
    });
  }

  const username = req.user?.username;
  if (!username) {
    return res.status(401).json({ success: false, message: '未登入' });
  }

  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ success: false, message: '無效的訂閱資訊' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    
    // 獲取用戶 ID
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }
    const userId = users[0].id;

    // 儲存或更新訂閱資訊
    await conn.execute(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         p256dh = VALUES(p256dh),
         auth = VALUES(auth),
         updated_at = NOW()`,
      [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    );

    res.json({ success: true, message: '推送訂閱成功' });
  } catch (err) {
    console.error('推送訂閱失敗:', err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 取消推送訂閱
app.post('/api/push/unsubscribe', authenticateTokenCompat, async (req, res) => {
  const username = req.user?.username;
  if (!username) {
    return res.status(401).json({ success: false, message: '未登入' });
  }

  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ success: false, message: '缺少 endpoint' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    
    // 獲取用戶 ID
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }
    const userId = users[0].id;

    // 刪除訂閱
    await conn.execute(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
      [userId, endpoint]
    );

    res.json({ success: true, message: '已取消推送訂閱' });
  } catch (err) {
    console.error('取消訂閱失敗:', err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 推送通知發送函數（內部使用）
async function sendPushNotification(userId, title, body, data = {}) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('⚠️  無法發送推送通知: VAPID 金鑰未配置');
    return;
  }

  let conn;
  try {
    conn = await pool.getConnection();
    
    // 獲取用戶的所有訂閱
    const [subscriptions] = await conn.execute(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );

    if (subscriptions.length === 0) {
      return; // 用戶未訂閱，靜默失敗
    }

    // 發送推送給所有訂閱
    const promises = subscriptions.map(async (sub) => {
      try {
        const subscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };

        const payload = JSON.stringify({
          title,
          body,
          icon: '/images/mascot.png',
          badge: '/images/flag-red.png',
          vibrate: [100, 50, 100],
          ...data
        });

        await webpush.sendNotification(subscription, payload);
        console.log(`✅ 推送通知已發送給用戶 ${userId}`);
      } catch (err) {
        console.error(`❌ 推送通知發送失敗 (用戶 ${userId}):`, err);
        
        // 如果訂閱已失效（410 Gone），刪除它
        if (err.statusCode === 410) {
          await conn.execute(
            'DELETE FROM push_subscriptions WHERE endpoint = ?',
            [sub.endpoint]
          );
          console.log(`🗑️  已刪除失效的推送訂閱: ${sub.endpoint}`);
        }
      }
    });

    await Promise.allSettled(promises);
  } catch (err) {
    console.error('發送推送通知時發生錯誤:', err);
  } finally {
    if (conn) conn.release();
  }
}

// ===== 商品管理 API =====

// 獲取所有商品（用戶用）
app.get('/api/products', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    
    // 檢查 products 表是否有 is_active 和 created_by 欄位
    const [isActiveCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'is_active'");
    const [createdByCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'created_by'");
    const hasIsActive = isActiveCols.length > 0;
    const hasCreatedBy = createdByCols.length > 0;
    
    // 根據欄位存在與否構建查詢
    let query;
    if (hasIsActive && hasCreatedBy) {
      query = `SELECT p.*, u.username as creator_username
      FROM products p
      LEFT JOIN users u ON p.created_by = u.username
      WHERE p.is_active = TRUE
         ORDER BY p.points_required ASC`;
    } else if (hasIsActive) {
      query = `SELECT p.*, NULL as creator_username
         FROM products p
         WHERE p.is_active = TRUE
         ORDER BY p.points_required ASC`;
    } else if (hasCreatedBy) {
      query = `SELECT p.*, u.username as creator_username
         FROM products p
         LEFT JOIN users u ON p.created_by = u.username
         ORDER BY p.points_required ASC`;
    } else {
      query = `SELECT p.*, NULL as creator_username
         FROM products p
         ORDER BY p.points_required ASC`;
    }
    
    const [rows] = await conn.execute(query);
    res.json({ success: true, products: rows });
  } catch (err) {
    console.error('[/api/products] 錯誤:', err);
    res.status(500).json({ success: false, message: '伺服器錯誤', error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// 獲取所有商品（管理員用）- 根據用戶角色篩選
app.get('/api/products/admin', staffOrAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const username = req.user?.username;

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;

    // 檢查 products 表是否有 created_by 欄位
    const [createdByCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'created_by'");
    const hasCreatedBy = createdByCols.length > 0;
    
    let query, params;
    if (userRole === 'admin') {
      // 管理員可以看到所有商品
      query = 'SELECT * FROM products ORDER BY created_at DESC';
      params = [];
    } else {
      // 工作人員只能看到自己創建的商品（如果有 created_by 欄位）
      if (hasCreatedBy) {
      query = 'SELECT * FROM products WHERE created_by = ? ORDER BY created_at DESC';
      params = [username];
      } else {
        // 如果沒有 created_by 欄位，工作人員可以看到所有商品（向後兼容）
        query = 'SELECT * FROM products ORDER BY created_at DESC';
        params = [];
      }
    }

    const [rows] = await conn.execute(query, params);
    res.json({ success: true, products: rows, userRole });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 新增商品
app.post('/api/products', staffOrAdminAuth, async (req, res) => {
  const { name, description, image_url, points_required, stock, is_active } = req.body;
  if (!name || !points_required || stock === undefined) {
    return res.status(400).json({ success: false, message: '缺少必要參數' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const username = req.user?.username;

    // 檢查 products 表是否有 is_active 和 created_by 欄位
    const [isActiveCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'is_active'");
    const [createdByCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'created_by'");
    const hasIsActive = isActiveCols.length > 0;
    const hasCreatedBy = createdByCols.length > 0;

    let result;
    if (hasIsActive && hasCreatedBy) {
      // 如果有 is_active 和 created_by 欄位，包含在 INSERT 中
      [result] = await conn.execute(
        'INSERT INTO products (name, description, image_url, points_required, stock, created_by, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, description || '', image_url || '', points_required, stock, username, is_active !== undefined ? is_active : true]
      );
    } else if (hasCreatedBy) {
      // 如果只有 created_by 欄位，不包含 is_active
      [result] = await conn.execute(
      'INSERT INTO products (name, description, image_url, points_required, stock, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description || '', image_url || '', points_required, stock, username]
    );
    } else {
      // 如果都沒有，使用最簡單的 INSERT 語句
      [result] = await conn.execute(
        'INSERT INTO products (name, description, image_url, points_required, stock) VALUES (?, ?, ?, ?, ?)',
        [name, description || '', image_url || '', points_required, stock]
      );
    }
    res.json({ success: true, message: '商品新增成功', productId: result.insertId });
  } catch (err) {
    console.error('[/api/products POST] 錯誤:', err);
    res.status(500).json({ success: false, message: '伺服器錯誤', error: err.message });
  } finally {
    if (conn) conn.release();
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
    conn = await pool.getConnection();
    const username = req.user?.username;

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;

    // 檢查 products 表是否有 created_by 欄位
    const [createdByCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'created_by'");
    const hasCreatedBy = createdByCols.length > 0;

    // 檢查商品是否存在，並確認權限
    let productQuery, productParams;
    if (userRole === 'admin') {
      productQuery = 'SELECT id FROM products WHERE id = ?';
      productParams = [id];
    } else {
      if (hasCreatedBy) {
      productQuery = 'SELECT id FROM products WHERE id = ? AND created_by = ?';
      productParams = [id, username];
      } else {
        // 如果沒有 created_by 欄位，工作人員可以編輯任何商品（向後兼容）
        productQuery = 'SELECT id FROM products WHERE id = ?';
        productParams = [id];
      }
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
    if (conn) conn.release();
  }
});

// 刪除商品
app.delete('/api/products/:id', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    const username = req.user?.username;

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
    if (conn) conn.release();
  }
});

// 獲取用戶的商品兌換記錄
app.get('/api/products/redemptions', authenticateToken, async (req, res) => {
  // 強制使用 JWT 認證
  if (!req.user || !req.user.username) {
    return res.status(401).json({ success: false, message: '未認證' });
  }
  const username = req.user.username;

  let conn;
  try {
    conn = await pool.getConnection();
    // 獲取用戶ID
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(400).json({ success: false, message: '用戶不存在' });
    }
    const userId = users[0].id;

    // 獲取兌換記錄
    const [rows] = await conn.execute(`
      SELECT pr.*, p.id as product_id, p.name as product_name, p.image_url
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
    if (conn) conn.release();
  }
});

// 兌換商品
app.post('/api/products/:id/redeem', authenticateToken, async (req, res) => {
  const { id } = req.params;
  // 強制使用 JWT 認證
  if (!req.user || !req.user.username) {
    return res.status(401).json({ success: false, message: '未認證' });
  }
  const username = req.user.username;

  let conn;
  try {
    conn = await pool.getConnection();

    // 獲取用戶ID
    const [users] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(400).json({ success: false, message: '用戶不存在' });
    }
    const userId = users[0].id;

    // 檢查 products 表是否有 is_active 欄位
    const [isActiveCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'is_active'");
    const hasIsActive = isActiveCols.length > 0;

    // 獲取商品資訊
    let products;
    if (hasIsActive) {
      [products] = await conn.execute('SELECT * FROM products WHERE id = ? AND is_active = TRUE', [id]);
    } else {
      [products] = await conn.execute('SELECT * FROM products WHERE id = ?', [id]);
    }
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
    if (conn) conn.release();
  }
});

// 獲取用戶總積分
app.get('/api/user/points', authenticateToken, async (req, res) => {
  // 強制使用 JWT 認證
  if (!req.user || !req.user.username) {
    return res.status(401).json({ success: false, message: '未認證' });
  }
  const username = req.user.username;

  let conn;
  try {
    conn = await pool.getConnection();

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
    if (conn) conn.release();
  }
});

// ===== 兌換記錄管理 API =====

// 獲取商品兌換記錄（管理員/工作人員用）
app.get('/api/product-redemptions/admin', staffOrAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const username = req.user?.username;

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;
    
    // 檢查 products 表是否有 created_by 欄位
    const [createdByCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'created_by'");
    const hasCreatedBy = createdByCols.length > 0;
    
    let query, params;

    if (userRole === 'admin') {
      // 管理員可以看到所有兌換記錄
      if (hasCreatedBy) {
      query = `
        SELECT pr.*, p.name as product_name, p.image_url, p.created_by as merchant_name, u.username
        FROM product_redemptions pr
        JOIN products p ON pr.product_id = p.id
        JOIN users u ON pr.user_id = u.id
        ORDER BY pr.redeemed_at DESC
      `;
      } else {
        query = `
          SELECT pr.*, p.name as product_name, p.image_url, NULL as merchant_name, u.username
          FROM product_redemptions pr
          JOIN products p ON pr.product_id = p.id
          JOIN users u ON pr.user_id = u.id
          ORDER BY pr.redeemed_at DESC
        `;
      }
      params = [];
    } else {
      // 工作人員只能看到自己管理的商品的兌換記錄
      if (hasCreatedBy) {
      query = `
        SELECT pr.*, p.name as product_name, p.image_url, p.created_by as merchant_name, u.username
        FROM product_redemptions pr
        JOIN products p ON pr.product_id = p.id
        JOIN users u ON pr.user_id = u.id
        WHERE p.created_by = ?
        ORDER BY pr.redeemed_at DESC
      `;
      params = [username];
      } else {
        // 如果沒有 created_by 欄位，工作人員可以看到所有記錄（向後兼容）
        query = `
          SELECT pr.*, p.name as product_name, p.image_url, NULL as merchant_name, u.username
          FROM product_redemptions pr
          JOIN products p ON pr.product_id = p.id
          JOIN users u ON pr.user_id = u.id
          ORDER BY pr.redeemed_at DESC
        `;
        params = [];
      }
    }

    const [rows] = await conn.execute(query, params);
    res.json({ success: true, redemptions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// ===== Admin 會員管理 API =====

// 獲取所有用戶列表（含統計資訊，支持分頁）- 僅 admin
app.get('/api/admin/users', adminAuth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  let conn;
  try {
    conn = await pool.getConnection();

    // 獲取總用戶數
    const [totalCount] = await conn.execute(
      'SELECT COUNT(*) as total FROM users WHERE role = ?',
      ['user']
    );
    const totalUsers = totalCount[0].total;

    // 獲取用戶列表 + 統計資訊
    // 注意：直接將 limit 和 offset 放入查詢字串，避免 prepared statement 參數問題
    const [users] = await conn.query(`
      SELECT 
        u.id,
        u.username,
        u.role,
        u.created_at,
        COALESCE(SUM(CASE WHEN pt.type = 'earned' THEN pt.points ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN pt.type = 'spent' THEN pt.points ELSE 0 END), 0) as total_points,
        SUM(CASE WHEN ut.status = '完成' THEN 1 ELSE 0 END) as completed_tasks,
        SUM(CASE WHEN ut.status = '進行中' THEN 1 ELSE 0 END) as in_progress_tasks
      FROM users u
      LEFT JOIN point_transactions pt ON pt.user_id = u.id
      LEFT JOIN user_tasks ut ON ut.user_id = u.id
      WHERE u.role = 'user'
      GROUP BY u.id, u.username, u.role, u.created_at
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const totalPages = Math.ceil(totalUsers / limit);

    res.json({
      success: true,
      users,
      pagination: {
        page,
        limit,
        totalUsers,
        totalPages
      }
    });
  } catch (err) {
    console.error('獲取用戶列表失敗:', err);
    console.error('錯誤詳情:', err.message);
    console.error('錯誤堆疊:', err.stack);
    res.status(500).json({ 
      success: false, 
      message: '伺服器錯誤',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    if (conn) conn.release();
  }
});

// 獲取單個用戶的任務詳情 - 僅 admin
app.get('/api/admin/users/:userId/tasks', adminAuth, async (req, res) => {
  const { userId } = req.params;

  let conn;
  try {
    conn = await pool.getConnection();

    // 驗證用戶是否存在且為一般用戶
    const [userCheck] = await conn.execute(
      'SELECT id, username FROM users WHERE id = ? AND role = ?',
      [userId, 'user']
    );

    if (userCheck.length === 0) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    // 獲取用戶的所有任務
    const [tasks] = await conn.query(`
      SELECT 
        ut.id as user_task_id,
        ut.status,
        ut.started_at,
        ut.finished_at,
        ut.answer,
        t.id as task_id,
        t.name as task_name,
        t.points,
        t.type as task_type
      FROM user_tasks ut
      INNER JOIN tasks t ON ut.task_id = t.id
      WHERE ut.user_id = ?
      ORDER BY ut.started_at DESC
    `, [userId]);

    res.json({
      success: true,
      user: userCheck[0],
      tasks
    });
  } catch (err) {
    console.error('獲取用戶任務詳情失敗:', err);
    res.status(500).json({ success: false, message: '伺服器錯誤' });
  } finally {
    if (conn) conn.release();
  }
});

// 導出所有用戶資料為 Excel - 僅 admin
app.get('/api/admin/users/export', adminAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    // 獲取所有用戶 + 統計資訊
    const [users] = await conn.execute(`
      SELECT 
        u.id,
        u.username,
        u.role,
        DATE_FORMAT(u.created_at, '%Y-%m-%d %H:%i:%s') as created_at,
        COALESCE(SUM(CASE WHEN pt.type = 'earned' THEN pt.points ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN pt.type = 'spent' THEN pt.points ELSE 0 END), 0) as total_points,
        SUM(CASE WHEN ut.status = '完成' THEN 1 ELSE 0 END) as completed_tasks,
        SUM(CASE WHEN ut.status = '進行中' THEN 1 ELSE 0 END) as in_progress_tasks
      FROM users u
      LEFT JOIN point_transactions pt ON pt.user_id = u.id
      LEFT JOIN user_tasks ut ON ut.user_id = u.id
      WHERE u.role = 'user'
      GROUP BY u.id, u.username, u.role, u.created_at
      ORDER BY u.created_at DESC
    `);

    // 準備 Excel 資料
    const wsData = users.map(user => ({
      '用戶ID': user.id,
      '帳號': user.username,
      '角色': user.role,
      '註冊時間': user.created_at,
      '總積分': user.total_points,
      '已完成任務數': user.completed_tasks,
      '進行中任務數': user.in_progress_tasks
    }));

    // 創建工作表
    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '會員列表');

    // 生成 Excel 緩衝區
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 設置響應頭
    const filename = `會員資料_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    res.send(excelBuffer);
  } catch (err) {
    console.error('導出 Excel 失敗:', err);
    res.status(500).json({ success: false, message: '導出失敗' });
  } finally {
    if (conn) conn.release();
  }
});

// 批量匯入會員 API
// 上傳 Excel 的 Multer 設定 (使用記憶體儲存，不存硬碟)
const uploadExcel = multer({ storage: multer.memoryStorage() });

// AI 辨識用的暫存上傳 (使用記憶體儲存，快速且不佔空間)
const uploadTemp = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 限制 10MB
});

// AI 視覺辨識 API
app.post('/api/vision-test', uploadTemp.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '未上傳圖片' });
    }

    // 1. 將圖片轉為 Base64
    const base64Image = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64Image}`;

    // 2. 準備 AI 提示詞 (Prompt)
    // 優先使用前端傳來的自訂 Prompt (導演模式)
    const systemPrompt = req.body.systemPrompt || '你是一個有用的 AI 助手。';
    const userPromptText = req.body.userPrompt || '請辨識這張圖片的內容。';

    // 如果有 GPS，加入地點資訊到 User Prompt 後面
    let locationInfo = '';
    if (req.body.latitude && req.body.longitude) {
      locationInfo = `\n(拍攝地點: 緯度 ${req.body.latitude}, 經度 ${req.body.longitude})`;
    }

    const finalUserPrompt = userPromptText + locationInfo;

    // 3. 呼叫 AI API (LM Studio / OpenAI Compatible)
    // AI endpoint (OpenAI-compatible)
    // NOTE: On Zeabur/production you MUST set AI_API_URL (and usually AI_API_KEY),
    // otherwise the server would try to call localhost and always fail.
    const AI_API_URL =
      process.env.AI_API_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:1234/v1' : null);
    // 生產環境必須設定 AI_MODEL，開發環境使用預設值
    const AI_MODEL = process.env.AI_MODEL || (process.env.NODE_ENV !== 'production' ? 'google/gemma-3-12b' : null);
    const AI_API_KEY = process.env.AI_API_KEY || 'lm-studio';

    if (!AI_API_URL) {
      throw new Error('AI_API_URL 未設定：請在部署環境設定 AI_API_URL / AI_API_KEY / AI_MODEL');
    }
    
    if (!AI_MODEL) {
      throw new Error('AI_MODEL 未設定：請在部署環境設定 AI_MODEL（例如：google/gemma-3-12b）');
    }

    // 3.5. 檢查是否為快速特徵提取模式（前端已進行快速提取，這裡只返回特徵）
    // 注意：快速特徵提取已經在前端完成，這裡不再重複調用，避免重複 API 調用
    let plantResults = null;
    let ragContextForLM = ''; // RAG 結果，將加入 LM prompt
    let quickFeatures = null; // 快速特徵提取結果，用於前端第一階段顯示
    
    // 檢查是否為快速提取模式（前端傳遞 quickOnly=true）
    const quickOnly = req.body && (req.body.quickOnly === 'true' || req.body.quick_only === 'true');
    
    if (quickOnly) {
      // 快速提取模式：只進行特徵提取，不進行 RAG 和完整分析
      console.log('⚡ 快速特徵提取模式：只提取特徵，跳過 RAG 和完整分析');
      
      const quickFeaturePrompt = `你是一位專業的植物形態學家。請快速分析圖片中的植物特徵，只提取關鍵識別特徵（生活型、葉序、葉形、花序、花色等），不要給出植物名稱。用簡短文字描述即可。`;
      
      const quickResponse = await fetch(`${AI_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_API_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: "system", content: quickFeaturePrompt },
            {
              role: "user",
              content: [
                { type: "text", text: "請快速提取這張圖片中植物的關鍵識別特徵（生活型、葉序、葉形、花序、花色等），用簡短文字描述。" },
                { type: "image_url", image_url: { url: dataUrl } }
              ]
            }
          ],
          max_tokens: 500,
          temperature: 0.3
        })
      });
      
      if (quickResponse.ok) {
        const quickData = await quickResponse.json();
        quickFeatures = quickData.choices[0].message.content;
        console.log('📊 快速特徵提取完成');
        
        // 快速模式：直接返回特徵，不進行後續處理
        return res.json({
          success: true,
          quick_features: quickFeatures,
          description: quickFeatures
        });
      } else {
        throw new Error('快速特徵提取失敗');
      }
    }
    
    // 完整分析模式：繼續進行完整分析（包括 RAG 搜尋）

    let description;
    let detailedDescription;
    let finishReason = 'stop';
    let followUpTraits = null; // 補圖時使用投票聚合後的 traits

    const previousSessionRaw = req.body?.previous_session;
    let photoCount = 1; // 目前已分析的張數（含本次）
    if (previousSessionRaw) {
      try {
        const session = typeof previousSessionRaw === 'string' ? JSON.parse(previousSessionRaw) : previousSessionRaw;
        photoCount = (session.photo_count ?? 1) + 1;
        const angleLabel = photoCount === 2 ? '第二' : '第三';
        console.log(`📷 補圖模式：使用第${angleLabel}張圖 + 投票聚合 (photo_count=${photoCount})`);
        const enhancedSystemPrompt = systemPrompt + ragContextForLM;
        const aiResponse = await fetch(`${AI_API_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [
              { role: 'system', content: enhancedSystemPrompt },
              { role: 'user', content: [{ type: 'text', text: finalUserPrompt }, { type: 'image_url', image_url: { url: dataUrl } }] }
            ],
            max_tokens: 2000,
            temperature: 0
          })
        });
        if (!aiResponse.ok) throw new Error('補圖 Vision API 失敗');
        const aiData = await aiResponse.json();
        description = aiData.choices[0].message.content;
        finishReason = aiData.choices[0].finish_reason || 'stop';
        const analysisMatch = description.match(/<analysis>([\s\S]*?)<\/analysis>/i);
        const part2 = analysisMatch ? analysisMatch[1].trim() : description.substring(0, 800);
        detailedDescription = (session.detailedDescription || '') + '\n\n[' + angleLabel + '角度] ' + part2;
        const traits2 = parseTraitsFromResponse(description);
        if (session.traits && traits2) {
          followUpTraits = aggregateTraitsFromMultipleImages([session.traits, traits2]) || traits2;
          console.log('📊 投票聚合完成，使用聚合 traits');
        } else {
          followUpTraits = traits2 || session.traits;
        }
      } catch (e) {
        console.warn('補圖流程失敗，改用單圖:', e.message);
      }
    }

    if (!followUpTraits && !description) {
      // 4. 呼叫 AI（將 RAG 結果加入 prompt，讓 LM 參考）
      console.log('🤖 正在呼叫 AI:', AI_API_URL);
      console.log('📝 System Prompt:', systemPrompt.substring(0, 50) + '...');
      const enhancedSystemPrompt = systemPrompt + ragContextForLM;

      const aiResponse = await fetch(`${AI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: enhancedSystemPrompt
          },
          {
            role: "user",
            content: [
              { type: "text", text: finalUserPrompt },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl
                }
              }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0
      })
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI API Error:', errText);
      throw new Error(`AI API 回應錯誤: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    description = aiData.choices[0].message.content;
    finishReason = aiData.choices[0].finish_reason || 'stop';

    // 🔥 關鍵修復：清洗模型回應中的重複垃圾文字（如 "modifiable modifiable..."）
    // 這種重複迴圈是 Local LLM 常見的崩潰模式，會導致 JSON 解析失敗
    if (description.length > 500) {
      // 檢測重複 10 次以上的單字模式
      const repetitionMatch = description.match(/(\b\w+\b)(?:\s+\1){10,}/);
      if (repetitionMatch) {
        console.warn(`⚠️ 檢測到模型重複迴圈 (${repetitionMatch[1]}...)，正在清洗...`);
        // 截斷重複部分之後的內容（保留前面有用的部分）
        const loopIndex = description.indexOf(repetitionMatch[0]);
        if (loopIndex !== -1) {
          // 保留到重複開始前，並嘗試補上結尾（如果是 JSON 結構）
          let cleanDesc = description.substring(0, loopIndex);
          
          // 如果看起來像是在 JSON 中斷掉，嘗試修復
          if (cleanDesc.includes('```json') && !cleanDesc.includes('```')) {
             cleanDesc += '\n}\n```'; // 嘗試強制閉合
          }
          
          description = cleanDesc;
          console.log('✅ 清洗完成，新長度:', description.length);
        }
      }
    }

    // 檢查是否因為長度限制被截斷
    if (finishReason === 'length') {
      console.warn('⚠️ AI 回應被截斷（finish_reason: length），可能缺少完整的 XML 格式');
    }

    // 5. 從 AI 回應中提取詳細描述（用於後續 RAG 驗證）
    detailedDescription = description;
    const analysisMatch = description.match(/<analysis>([\s\S]*?)<\/analysis>/i);
    if (analysisMatch) {
      detailedDescription = analysisMatch[1].trim();
      console.log('📋 從 <analysis> 提取詳細描述:', detailedDescription.substring(0, 100) + '...');
    } else {
      const partialAnalysisMatch = description.match(/<analysis>([\s\S]*)/i);
      if (partialAnalysisMatch) {
        detailedDescription = partialAnalysisMatch[1].trim();
        console.log('⚠️ 找到不完整的 <analysis> 標籤（可能被截斷），使用部分內容');
        // 如果回應被截斷，檢查提取的描述長度
        if (detailedDescription.length < 100) {
          console.warn('⚠️ 提取的描述過短（' + detailedDescription.length + ' 字元），可能影響 RAG 搜尋準確度');
        } else {
          console.log('✅ 提取的描述長度足夠（' + detailedDescription.length + ' 字元），應該不影響 RAG 搜尋');
        }
      } else {
        const stepMatch = description.match(/第二步：詳細描述圖片細節[^]*?([\s\S]{200,})/i);
        if (stepMatch) {
          detailedDescription = stepMatch[1].trim();
          console.log('⚠️ 未找到 <analysis> 標籤，從「第二步」提取描述');
        } else {
          console.log('⚠️ 未找到 <analysis> 標籤，使用完整回應作為描述');
        }
      }
    }
    } // end if (!followUpTraits && !description) — 一般首次辨識流程

    // 檢查回應是否被截斷，如果被截斷，發出警告
    const isTruncated = finishReason === 'length' || (description.length > 3000 && !description.includes('</analysis>'));
    if (isTruncated) {
      console.warn('⚠️ AI 回應可能被截斷（finish_reason=' + finishReason + '），RAG 搜尋可能受影響');
      console.warn('💡 建議：考慮增加 max_tokens 或優化 prompt 長度');
    }

    // 6. 如果預先 RAG 沒有結果，進行後續 RAG 搜尋（驗證和補充）
    // 注意：如果預先搜尋已經有結果，應該保留它，不要被後續搜尋覆蓋
    // 除非後續搜尋的分數明顯更高（例如高 15% 以上）
    // 重要：在進行後續搜尋前，保存預先搜尋的結果（如果有的話）
    let preSearchResults = plantResults; // 保存預先搜尋的結果（在後續搜尋之前，使用 let 以便後續修改）
    if (!plantResults) {
      try {
        const embeddingReady = await isEmbeddingApiReady();
      if (!embeddingReady) {
        console.warn('⚠️ Embedding API 未就緒，跳過植物 RAG');
        plantResults = { is_plant: false, message: 'Embedding API 未就緒，暫時跳過植物搜尋' };
      } else {
        console.log('🌿 正在查詢植物 RAG（使用詳細描述）...');
        try {
          const urlHost = new URL(EMBEDDING_API_URL).hostname;
          console.log(`[RAG] Embedding API: ${urlHost} (查詢長度: ${detailedDescription?.length || 0} 字元)`);
        } catch (_) {}
        if (!EMBEDDING_API_URL || EMBEDDING_API_URL.includes('gpstask-ooffix') || EMBEDDING_API_URL.includes('localhost')) {
          console.warn('[RAG] ⚠️ EMBEDDING_API_URL 可能錯誤，應為 https://gps-task-embedding.zeabur.app');
        }

        // 人造物跳過：第三步說人造物 且 第四步明確寫「不提取生物特徵」→ 一律跳過
        // 避免「葉片長度：N/A」等模板字被誤判為植物證據，導致仍跑 RAG 並要求補拍花朵
        const saysArtifact = description && description.includes('第三步：判斷類別') && description.includes('人造物');
        const explicitlyNoBioFeatures = /不提取生物特徵|由於判斷為人造物|不進行猜測/.test(description || '');
        const hasRealPlantEvidence = /葉片[^N]*[形狀狀卵披針]|花朵[^直徑N]*[色紫紅白黃]|花序|枝條|果實|樹皮|脈序|鋸齒緣/.test(description || '');
        const skipAsArtifact = !previousSessionRaw && saysArtifact && (explicitlyNoBioFeatures || !hasRealPlantEvidence);
        if (skipAsArtifact) {
          console.log('⏭️ Vision 判斷為人造物，跳過植物 RAG');
          plantResults = {
            is_plant: false,
            category: 'human_made',
            message: 'Vision 分析判斷為人造物，已略過植物搜尋'
          };
        } else {
          if (saysArtifact && !skipAsArtifact) {
            console.log('⚠️ Vision 判人造物但描述含植物特徵，仍執行植物 RAG');
          }
          // 重要：先進行傳統搜尋（embedding only）作為基準
          // 這樣可以確保第一階段的結果不會被後續的 traits-based 搜尋覆蓋
          console.log('🔍 第一階段：進行傳統搜尋（embedding only）作為基準...');
          const classification = await classify(detailedDescription);
          
          const visionSaysPlant = description && 
            description.includes('第三步：判斷類別') && 
            description.includes('植物');
          
          const PLANT_SCORE_THRESHOLD = visionSaysPlant ? 0.4 : (finishReason === 'length' ? 0.45 : 0.5);

          if (classification.is_plant && classification.plant_score >= PLANT_SCORE_THRESHOLD) {
            const ragResult = await smartSearch(detailedDescription, RAG_TOP_K);

            if (ragResult?.error) {
              console.warn('[RAG] 第一階段失敗:', ragResult.error);
            }
            if (ragResult?.results?.length === 0 && !ragResult?.error) {
              console.log('[RAG] 第一階段 API 回傳 0 筆結果（非連線錯誤）');
            }

            if (ragResult.classification?.is_plant && ragResult.results?.length > 0) {
              console.log(`✅ 第一階段傳統搜尋找到 ${ragResult.results.length} 個結果`);
              console.log('📋 第一階段檢測到的植物：');
              ragResult.results.forEach((p, idx) => {
                console.log(`  ${idx + 1}. ${p.chinese_name} (${p.scientific_name || '無學名'}) - 分數: ${(p.score * 100).toFixed(1)}%`);
              });
              
              const firstStageResults = {
                is_plant: true,
                category: 'plant',
                search_type: 'embedding',
                message: ragResult.message,
                plants: ragResult.results.map(p => ({
                  chinese_name: p.chinese_name,
                  scientific_name: p.scientific_name,
                  family: p.family,
                  life_form: p.life_form,
                  score: p.score,
                  summary: p.summary
                }))
              };
              
              // 保存第一階段結果作為基準
              preSearchResults = firstStageResults;
              plantResults = firstStageResults;
              console.log(`💾 第一階段結果已保存作為基準（最高分數: ${(firstStageResults.plants[0].score * 100).toFixed(1)}%）`);
            }
          }

          // 第二階段：使用 traits-based 判斷（補圖時用投票聚合結果）
          let traits = followUpTraits || parseTraitsFromResponse(description);
          // C. 二段式果實補抽：LM 有提到果實但 trait 無 fruit_type 時，再問一次只答果實
          if (traits && AI_API_URL && AI_MODEL) {
            const descMentionsFruit = /果實|漿果|核果|蒴果|莢果|小果實|結實|紅果|綠.*果/.test(description);
            const fruitMissing = !traits.fruit_type || String(traits.fruit_type.value || '').toLowerCase() === 'unknown';
            if (descMentionsFruit && fruitMissing) {
              try {
                const fruitOnly = await fetchFruitTypeFromDescription(description, AI_API_URL, AI_API_KEY, AI_MODEL);
                if (fruitOnly && fruitOnly.fruit_type) {
                  traits.fruit_type = { value: fruitOnly.fruit_type, confidence: 0.5, evidence: '二段式果實補抽' };
                  console.log('[RAG] 二段式果實補抽: fruit_type=' + fruitOnly.fruit_type);
                }
              } catch (e) {
                console.warn('[RAG] 二段式果實補抽失敗:', e.message);
              }
            }
          }
          let traitsBasedDecision = null;

          if (traits) {
            traitsBasedDecision = isPlantFromTraits(traits);
            console.log(`🌿 第二階段 Traits 判斷: is_plant=${traitsBasedDecision.is_plant}, confidence=${traitsBasedDecision.confidence.toFixed(2)}, reason=${traitsBasedDecision.reason}`);
            console.log(`   提取到的 traits: ${Object.keys(traits).join(', ')}`);

            if (traitsBasedDecision.is_plant) {
              // 使用 traits 轉換的特徵列表進行混合搜尋
              let features = traitsToFeatureList(traits);
              // P1-1 關鍵字輔助：無論 traits 成功與否，從 LM 描述補強果實/花序（LM 常描述但 JSON 未抽到）
              const keywordAssist = extractFeaturesFromDescriptionKeywords(description);
              if (keywordAssist.length > 0) {
                const added = keywordAssist.filter((k) => !features.includes(k));
                if (added.length > 0) {
                  features = [...features, ...added];
                  console.log(`📊 keyword_assist 補強: +[${added.join(', ')}] → ${features.join(', ')}`);
                }
              }
              features = removeCompoundSimpleContradiction(features);
              features = capByCategoryAndResolveContradictions(features);
              console.log(`📊 使用 traits 提取的特徵: ${features.join(', ')}`);

              const traitQuality = evaluateTraitQuality(traits);
              const dynamicWeights = determineDynamicWeights(traitQuality);
              console.log(`[RAG] traits 品質: Q=${traitQuality.quality.toFixed(2)}, coverage=${traitQuality.coverage.toFixed(2)}, generic_ratio=${traitQuality.genericRatio?.toFixed(2) ?? 'n/a'}, wE=${dynamicWeights.embedding.toFixed(2)}, wF=${dynamicWeights.feature.toFixed(2)}`);

              // 🔥 關鍵修復：構建簡短的 query_text_zh（只用於 embedding）
              // 直接使用 traitsToFeatureList 轉換後的中文特徵，避免重複定義不完整的 Map
              let queryTextZh = '';
              
              // 優先使用轉換後的特徵列表（已經處理過翻譯和特殊值）
              // 取前 15 個特徵（通常已包含最重要的特徵）
              if (features.length > 0) {
                queryTextZh = features.slice(0, 15).join('、');
              }
              
              // 如果特徵太少，嘗試補充 detailedDescription 的簡短摘要
              if (!queryTextZh || queryTextZh.length < 10) {
                const cleanDesc = detailedDescription
                  .replace(/第[一二三四五六七八九十\d]+步[：:]/g, '')
                  .replace(/\*\*[^*]+\*\*/g, '')
                  .replace(/推測|估計|無法判斷|可能/g, '')
                  .trim()
                  .substring(0, 100);  // 最多 100 字
                
                if (cleanDesc) {
                  queryTextZh = queryTextZh ? `${queryTextZh}。${cleanDesc}` : cleanDesc;
                }
              }
              
              // 限制長度（最多 200 字元）
              if (queryTextZh.length > 200) {
                queryTextZh = queryTextZh.substring(0, 200);
              }
              
              console.log(`📝 構建的 query_text_zh (${queryTextZh.length} 字元): ${queryTextZh.substring(0, 50)}...`);

              // 將第一階段 RAG 結果的植物名稱傳入第二階段，供 hybrid-search 做關鍵字匹配與查詢增強
              const guessNamesFromFirst = (preSearchResults?.plants || [])
                .map(p => p.chinese_name || p.scientific_name)
                .filter(Boolean);
              const guessFromLm = extractGuessNamesFromDescription(description);
              const guessNames = cleanGuessNames([...guessFromLm, ...guessNamesFromFirst]).slice(0, 12);
              if (guessFromLm.length > 0) {
                console.log(`[RAG] LM 猜名補強 guess_names: +[${guessFromLm.join(', ')}]`);
              }
              if (guessNames.length > 0) {
                console.log(`[RAG] 第二階段 guess_names: ${guessNames.join('、')}`);
              }
              console.log(`[RAG] 第二階段請求: query=${queryTextZh.length}字 features=${features.length} guess_names=${guessNames.length} topK=${RAG_TOP_K}`);

              const hybridResult = await hybridSearch({
                query: queryTextZh,
                features: features,
                guessNames: guessNames,
                topK: RAG_TOP_K,
                weights: dynamicWeights,
                traits: traits
              });
              if (hybridResult?.weights) {
                const usedE = hybridResult.weights.embedding ?? dynamicWeights.embedding;
                const usedF = hybridResult.weights.feature ?? dynamicWeights.feature;
                console.log(`[RAG] 第二階段實際權重: E=${Number(usedE).toFixed(2)}, F=${Number(usedF).toFixed(2)}`);
              }

              if (hybridResult.results?.length > 0) {
                console.log(`✅ 第二階段 Traits-based 混合搜尋找到 ${hybridResult.results.length} 個結果`);
                // 顯示所有檢測到的植物（用於調試）
                console.log('📋 第二階段檢測到的植物：');
                hybridResult.results.forEach((p, idx) => {
                  console.log(`  ${idx + 1}. ${p.chinese_name} (${p.scientific_name || '無學名'}) - 分數: ${(p.score * 100).toFixed(1)}% (embedding: ${(p.embedding_score * 100).toFixed(1)}%, feature: ${(p.feature_score * 100).toFixed(1)}%)`);
                  if (p.matched_features && p.matched_features.length > 0) {
                    console.log(`     匹配特徵: ${p.matched_features.join(', ')}`);
                  }
                });
                
                const newResults = {
                  is_plant: true,
                  category: 'plant',
                  search_type: 'hybrid_traits',
                  traits: traits,
                  traits_decision: traitsBasedDecision,
                  feature_info: hybridResult.feature_info,
                  plants: hybridResult.results.map(p => ({
                    chinese_name: p.chinese_name,
                    scientific_name: p.scientific_name,
                    family: p.family,
                    life_form: p.life_form,
                    score: p.score,
                    embedding_score: p.embedding_score,
                    feature_score: p.feature_score,
                    matched_features: p.matched_features,
                    summary: p.summary
                  }))
                };
                
                // 合併兩階段候選，依分數排序（移除 +0.15 gate）
                if (preSearchResults && preSearchResults.is_plant && preSearchResults.plants && preSearchResults.plants.length > 0) {
                  const merged = mergePlantResults(preSearchResults.plants, newResults.plants);
                  console.log(`🔄 合併兩階段結果：第一階段 ${preSearchResults.plants.length} 筆 + 第二階段 ${newResults.plants.length} 筆 → 去重後 ${merged.length} 筆`);
                  plantResults = { ...newResults, plants: merged };
                } else {
                  plantResults = newResults;
                }
              } else {
                const why = hybridResult.error
                  ? `API 錯誤: ${hybridResult.error}`
                  : (Array.isArray(hybridResult.results) ? `results.length=0` : 'results 未定義');
                console.log(`⚠️ 第二階段搜尋無結果（${why}），檢查是否有第一階段結果`);
                if (preSearchResults) {
                  console.log('✅ 回退使用第一階段 embedding 結果');
                  plantResults = preSearchResults;
                } else {
                  // 如果第一階段也沒有結果，但 Traits 判斷是植物，我們應該保留這個判斷
                  // 這樣前端至少能顯示「植物」類別，而不是「一般物品」
                  console.log('⚠️ 兩階段搜尋都無結果，但 Traits 判斷為植物，設置基本植物屬性');
                  plantResults = {
                    is_plant: true,
                    category: 'plant',
                    search_type: 'traits_only',
                    traits: traits,
                    traits_decision: traitsBasedDecision,
                    message: '檢測到植物特徵，但資料庫中未找到匹配植物',
                    plants: []
                  };
                }
              }
            } else {
              // Traits 判斷不是植物，但也許第一階段認為是
              if (preSearchResults) {
                console.log('⚠️ Traits 判斷非植物，但第一階段 embedding 認為是，使用第一階段結果');
                plantResults = preSearchResults;
              }
            }
          } else {
            // traits JSON 抽取失敗：先嘗試從 LM 描述擷取棕櫚/複葉關鍵字（P0：讓棕櫚類進 hybrid）
            let keywordFeatures = extractFeaturesFromDescriptionKeywords(description);
            if (keywordFeatures.length > 0 && preSearchResults?.plants?.length > 0) {
              keywordFeatures = removeCompoundSimpleContradiction(keywordFeatures);
              keywordFeatures = capByCategoryAndResolveContradictions(keywordFeatures);
              console.log(`[RAG] P0 fallback: 從描述擷取特徵 [${keywordFeatures.join(', ')}]，進入 hybrid`);
              const guessNamesFromFirst = preSearchResults.plants
                .map(p => p.chinese_name || p.scientific_name)
                .filter(Boolean);
              const guessFromLm = extractGuessNamesFromDescription(description);
              const guessNamesFallback = cleanGuessNames([...guessFromLm, ...guessNamesFromFirst]).slice(0, 12);
              const queryTextZh = keywordFeatures.join('、') + '、' + (detailedDescription || '').substring(0, 80);
              const hybridResult = await hybridSearch({
                query: queryTextZh.substring(0, 200),
                features: keywordFeatures,
                guessNames: guessNamesFallback,
                topK: RAG_TOP_K,
                weights: determineDynamicWeights({ quality: 0.6, genericRatio: 0.3 })
              });
              if (hybridResult?.results?.length > 0) {
                console.log(`✅ 混合搜尋找到 ${hybridResult.results.length} 個結果（keyword fallback）`);
                const newResults = {
                  is_plant: true,
                  category: 'plant',
                  search_type: 'hybrid_traits',
                  plants: hybridResult.results.map(p => ({
                    chinese_name: p.chinese_name,
                    scientific_name: p.scientific_name,
                    family: p.family,
                    life_form: p.life_form,
                    score: p.score,
                    embedding_score: p.embedding_score,
                    feature_score: p.feature_score,
                    matched_features: p.matched_features,
                    summary: p.summary
                  }))
                };
                const merged = mergePlantResults(preSearchResults.plants, newResults.plants);
                plantResults = { ...newResults, plants: merged };
              }
            }

            if (!plantResults) {
              // 結構化 JSON 路徑
              console.log('⚠️ 未提取到 traits JSON，改用結構化 JSON 嘗試第二階段混合搜尋');
              const visionParsed = parseVisionResponse(description);
              let visionFeatures = Array.isArray(visionParsed?.plant?.features)
                ? visionParsed.plant.features.filter(Boolean)
                : [];
              let visionGuessNames = Array.isArray(visionParsed?.plant?.guess_names)
                ? visionParsed.plant.guess_names.filter(Boolean)
                : [];
              const guessFromLmAlt = extractGuessNamesFromDescription(description);
              if (guessFromLmAlt.length > 0) {
                visionGuessNames = cleanGuessNames([...guessFromLmAlt, ...visionGuessNames]).slice(0, 12);
                console.log(`[RAG] LM 猜名補強 (structured): +[${guessFromLmAlt.join(', ')}]`);
              }
              // P1-1 關鍵字輔助：補強果實/花序
              const keywordAssistAlt = extractFeaturesFromDescriptionKeywords(description);
              if (keywordAssistAlt.length > 0) {
                const added = keywordAssistAlt.filter((k) => !visionFeatures.includes(k));
                if (added.length > 0) {
                  visionFeatures = [...visionFeatures, ...added];
                  console.log(`📊 keyword_assist (structured): +[${added.join(', ')}]`);
                }
              }
              visionFeatures = removeCompoundSimpleContradiction(visionFeatures);
              visionFeatures = capByCategoryAndResolveContradictions(visionFeatures);

              if (visionParsed.success && visionParsed.intent === 'plant' && (visionFeatures.length > 0 || visionGuessNames.length > 0)) {
              // 沒有 traits 品質分數時，用 features 數量做一個保守估計，讓 hybrid 有機會拉開差距
              const q = Math.min(1, Math.max(0, visionFeatures.length / 6));
              const weights = determineDynamicWeights({ quality: q, genericRatio: 0.6 });
              const queryForHybrid = visionParsed.short_caption || detailedDescription;

              console.log(
                `📊 結構化 JSON 混合搜尋: features=${visionFeatures.length}, guess_names=${visionGuessNames.length}, q≈${q.toFixed(2)}, wE=${weights.embedding.toFixed(2)}, wF=${weights.feature.toFixed(2)}`
              );

              const hybridResult = await hybridSearch({
                query: queryForHybrid,
                features: visionFeatures,
                guessNames: visionGuessNames,
                topK: RAG_TOP_K,
                weights
              });

              if (hybridResult.results?.length > 0) {
                console.log(`✅ 混合搜尋找到 ${hybridResult.results.length} 個結果（structured JSON）`);

                const newResults = {
                  is_plant: true,
                  category: 'plant',
                  search_type: 'hybrid_structured_json',
                  vision_parsed: {
                    intent: visionParsed.intent,
                    confidence: visionParsed.confidence,
                    short_caption: visionParsed.short_caption,
                    features: visionFeatures,
                    guess_names: visionGuessNames
                  },
                  feature_info: hybridResult.feature_info,
                  plants: hybridResult.results.map(p => ({
                    chinese_name: p.chinese_name,
                    scientific_name: p.scientific_name,
                    family: p.family,
                    life_form: p.life_form,
                    score: p.score,
                    embedding_score: p.embedding_score,
                    feature_score: p.feature_score,
                    matched_features: p.matched_features,
                    summary: p.summary
                  }))
                };

                // 合併兩階段候選，依分數排序
                if (preSearchResults && preSearchResults.is_plant && preSearchResults.plants && preSearchResults.plants.length > 0) {
                  const merged = mergePlantResults(preSearchResults.plants, newResults.plants);
                  console.log(`🔄 合併兩階段結果（structured JSON）: ${preSearchResults.plants.length} + ${newResults.plants.length} → ${merged.length} 筆`);
                  plantResults = { ...newResults, plants: merged };
                } else {
                  plantResults = newResults;
                }
              } else {
                const why = hybridResult?.error ? `API 錯誤: ${hybridResult.error}` : 'results.length=0';
                console.log(`⚠️ 混合搜尋無結果（structured JSON, ${why}），回退使用第一階段 embedding`);
                if (preSearchResults) {
                  plantResults = preSearchResults;
                }
              }
              } else {
                console.log('⚠️ 結構化 JSON 不足以混合搜尋（缺少 features/guess_names），回退使用第一階段 embedding');
                if (preSearchResults) {
                  plantResults = preSearchResults;
                }
              }
            }
          }

          // 如果 traits-based 判斷失敗，嘗試舊的 parseVisionResponse 方法
          if (!plantResults) {
            const visionParsed = parseVisionResponse(description);

            if (visionParsed.success && visionParsed.intent === 'plant') {
              // 使用混合搜尋（結合特徵權重）
              // 重要：使用詳細描述作為 query，而不是 shortCaption 或 guess_names
              console.log(
                `📊 結構化辨識: intent=${visionParsed.intent}, features=${visionParsed.plant.features.join(',')}`
              );

              const hybridResult = await hybridSearch({
                query: detailedDescription, // 使用詳細描述，而不是猜測的名稱
                features: visionParsed.plant.features || [],
                guessNames: visionParsed.plant.guess_names || [],
                topK: RAG_TOP_K,
                weights: determineDynamicWeights()
              });

              if (hybridResult.results?.length > 0) {
                console.log(`✅ 混合搜尋找到 ${hybridResult.results.length} 個結果`);
                // 顯示所有檢測到的植物（用於調試）
                console.log('📋 所有檢測到的植物：');
                hybridResult.results.forEach((p, idx) => {
                  console.log(`  ${idx + 1}. ${p.chinese_name} (${p.scientific_name || '無學名'}) - 分數: ${(p.score * 100).toFixed(1)}% (embedding: ${(p.embedding_score * 100).toFixed(1)}%, feature: ${(p.feature_score * 100).toFixed(1)}%)`);
                  if (p.matched_features && p.matched_features.length > 0) {
                    console.log(`     匹配特徵: ${p.matched_features.join(', ')}`);
                  }
                });
                
                const newResults = {
                  is_plant: true,
                  category: 'plant',
                  search_type: 'hybrid',
                  vision_parsed: {
                    intent: visionParsed.intent,
                    confidence: visionParsed.confidence,
                    features: visionParsed.plant.features,
                    guess_names: visionParsed.plant.guess_names
                  },
                  feature_info: hybridResult.feature_info,
                  plants: hybridResult.results.map(p => ({
                    chinese_name: p.chinese_name,
                    scientific_name: p.scientific_name,
                    family: p.family,
                    life_form: p.life_form,
                    score: p.score,
                    embedding_score: p.embedding_score,
                    feature_score: p.feature_score,
                    matched_features: p.matched_features,
                    summary: p.summary
                  }))
                };
                
                // 合併兩階段候選，依分數排序
                if (preSearchResults && preSearchResults.is_plant && preSearchResults.plants && preSearchResults.plants.length > 0) {
                  const merged = mergePlantResults(preSearchResults.plants, newResults.plants);
                  console.log(`🔄 合併兩階段結果（vision 解析）: ${preSearchResults.plants.length} + ${newResults.plants.length} → ${merged.length} 筆`);
                  plantResults = { ...newResults, plants: merged };
                } else {
                  plantResults = newResults;
                }
              }
            }
          }

          // 如果結構化解析失敗或不是植物，先用 classify 判斷，只有植物才搜尋（省 token）
          if (!plantResults) {
            // 使用詳細描述進行分類（而不是完整回應）
            const classification = await classify(detailedDescription);

            // 調整閾值：與 Python API 的 PLANT_THRESHOLD (0.40) 保持一致
            // 如果 Vision AI 已經明確判斷是植物（從 <analysis> 中看到「第三步：判斷類別」是「植物」），
            // 則降低閾值以確保能搜尋
            const visionSaysPlant = description && 
              description.includes('第三步：判斷類別') && 
              description.includes('植物');
            
            // 如果 Vision AI 明確說是植物，使用較低閾值；否則使用正常閾值
            const PLANT_SCORE_THRESHOLD = visionSaysPlant ? 0.4 : (finishReason === 'length' ? 0.45 : 0.5);

            if (classification.is_plant && classification.plant_score >= PLANT_SCORE_THRESHOLD) {
              // 確認是植物，使用詳細描述進行完整搜尋
              console.log(
                `🔍 確認是植物 (plant_score=${classification.plant_score.toFixed(
                  3
                )} >= ${PLANT_SCORE_THRESHOLD})，使用詳細描述進行 RAG 搜尋...`
              );
              const ragResult = await smartSearch(detailedDescription, RAG_TOP_K);

              if (ragResult.classification?.is_plant && ragResult.results?.length > 0) {
                console.log(`✅ 傳統搜尋找到 ${ragResult.results.length} 個結果`);
                // 顯示所有檢測到的植物（用於調試）
                console.log('📋 所有檢測到的植物：');
                ragResult.results.forEach((p, idx) => {
                  console.log(`  ${idx + 1}. ${p.chinese_name} (${p.scientific_name || '無學名'}) - 分數: ${(p.score * 100).toFixed(1)}%`);
                });
                
                const newResults = {
                  is_plant: true,
                  category: 'plant',
                  search_type: 'embedding',
                  message: ragResult.message,
                  plants: ragResult.results.map(p => ({
                    chinese_name: p.chinese_name,
                    scientific_name: p.scientific_name,
                    family: p.family,
                    life_form: p.life_form,
                    score: p.score,
                    summary: p.summary
                  }))
                };
                
                // 重要：第一次搜尋完成後，保存結果作為 preSearchResults
                // 這樣後續的 traits-based 搜尋可以與第一次搜尋的結果比較
                if (!preSearchResults) {
                  preSearchResults = newResults;
                  console.log(`💾 保存第一次搜尋結果作為基準（最高分數: ${(newResults.plants[0].score * 100).toFixed(1)}%）`);
                }
                
                // 合併兩階段候選（若 preSearchResults 來自同流程的第一次搜尋）
                if (preSearchResults && preSearchResults.is_plant && preSearchResults.plants && preSearchResults.plants.length > 0) {
                  const merged = mergePlantResults(preSearchResults.plants, newResults.plants);
                  console.log(`🔄 合併搜尋結果: ${preSearchResults.plants.length} + ${newResults.plants.length} → ${merged.length} 筆`);
                  plantResults = { ...newResults, plants: merged };
                } else {
                  plantResults = newResults;
                }
              } else {
                const cls = ragResult.classification || {};
                console.log(
                  `📝 RAG 判斷非植物(is_plant=false): category=${cls.category || 'unknown'} plant_score=${
                    cls.plant_score ?? 'n/a'
                  }`
                );
                plantResults = {
                  is_plant: false,
                  category: ragResult.classification?.category,
                  message: ragResult.message
                };
              }
            } else {
              // 分類結果顯示非植物，直接跳過搜尋（省 token）
              const reason = traitsBasedDecision 
                ? `Traits 判斷: ${traitsBasedDecision.reason}` 
                : `Classify 判斷: category=${classification.category || 'unknown'} plant_score=${classification.plant_score?.toFixed(3) ?? 'n/a'} < ${PLANT_SCORE_THRESHOLD}`;
              
              console.log(`⏭️ 跳過 RAG 搜尋（非植物）: ${reason}`);
              plantResults = {
                is_plant: false,
                category: classification.category,
                message: `非植物相關查詢（${classification.category}），已跳過 RAG 搜尋以節省 token`
              };
            }
          }
        }
      }
      } catch (ragErr) {
        console.warn('⚠️ 植物 RAG 查詢失敗 (非致命):', ragErr.message);
        // 如果 Vision AI 明確判斷為植物，即使 RAG 失敗也要設置 category
        if (!plantResults && description && description.includes('第三步：判斷類別') && description.includes('植物')) {
          plantResults = {
            is_plant: true,
            category: 'plant',
            message: 'Vision AI 判斷為植物，但 RAG 搜尋失敗'
          };
        }
        // RAG 失敗不影響主要回應
      }
    }

    // 如果 LM 的回答中包含植物名稱，且該名稱在 RAG 結果中，提高信心度
    let lmConfidenceBoost = 0;
    if (plantResults && plantResults.is_plant && plantResults.plants && plantResults.plants.length > 0) {
      // 從 LM 的回答中提取植物名稱（中文名或學名）
      const lmPlantNames = [];
      const replyMatch = description.match(/<reply>([\s\S]*?)<\/reply>/i);
      const replyText = replyMatch ? replyMatch[1] : description;
      
      // 方法 1: 從 RAG 結果中取得所有可能的中文名和學名，然後在 LM 回答中搜尋
      // 這樣可以匹配任何植物名稱，而不只是特定幾個
      const allPossibleNames = [];
      for (const plant of plantResults.plants) {
        if (plant.chinese_name && plant.chinese_name.length >= 2) {
          allPossibleNames.push(plant.chinese_name);
        }
        if (plant.scientific_name && plant.scientific_name.length >= 2) {
          allPossibleNames.push(plant.scientific_name);
        }
      }
      
      // 在 LM 回答中搜尋這些名稱
      for (const name of allPossibleNames) {
        // 檢查中文名（至少 2 個字）
        if (name.length >= 2 && replyText.includes(name)) {
          lmPlantNames.push(name);
        }
        // 檢查學名（格式：Genus species，使用正則表達式匹配）
        const scientificNamePattern = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 轉義特殊字符
        if (replyText.match(new RegExp(scientificNamePattern, 'i'))) {
          lmPlantNames.push(name);
        }
      }
      
      // 方法 2: 提取學名（常見模式：*Antirrhinum majus*、Antirrhinum majus）
      // 作為備用方法，以防 RAG 結果中沒有學名
      const scientificNameMatches = replyText.match(/\*?([A-Z][a-z]+(?:\s+[a-z]+)+)\*?/g);
      if (scientificNameMatches) {
        for (const match of scientificNameMatches) {
          const cleanName = match.replace(/[*_]/g, '').trim();
          if (cleanName.length > 0) {
            lmPlantNames.push(cleanName);
          }
        }
      }
      
      // P3-2a/2b: LM 加成僅對「名稱匹配」的候選，且須 feature match >= 2 才加成
      const nameMapping = getPlantNameMapping();
      const allNames = nameMapping.allNames || {};
      const LM_BOOST = 0.4;
      const LM_FEATURE_MATCH_THRESHOLD = 2;

      const matchingPlantIndices = new Set();
      if (lmPlantNames.length > 0) {
        for (let i = 0; i < plantResults.plants.length; i++) {
          const plant = plantResults.plants[i];
          const plantNameLower = (plant.chinese_name || '').toLowerCase();
          const scientificNameLower = (plant.scientific_name || '').toLowerCase();

          for (const lmName of lmPlantNames) {
            const lmNameLower = lmName.toLowerCase();
            const isExactMatch = plantNameLower === lmNameLower ||
              scientificNameLower === lmNameLower ||
              (plantNameLower.includes(lmNameLower) && lmNameLower.length >= 3) ||
              (lmNameLower.includes(plantNameLower) && plantNameLower.length >= 3);
            const isMatchViaMapping = isMatchViaPlantMapping(lmName, plant, allNames);

            if (isExactMatch || isMatchViaMapping) {
              const matchedCount = (plant.matched_features || []).length;
              const passesThreshold = matchedCount >= LM_FEATURE_MATCH_THRESHOLD;
              if (passesThreshold) {
                matchingPlantIndices.add(i);
                const via = isMatchViaMapping ? ' (經學名對應表)' : '';
                console.log(`✅ LM 與 RAG 匹配: LM提到「${lmName}」，RAG找到「${plant.chinese_name}」${via}，feature 匹配=${matchedCount}，給予加成`);
              } else {
                console.log(`⚠️ LM 提到「${lmName}」且 RAG 找到「${plant.chinese_name}」，但 feature 匹配=${matchedCount} < ${LM_FEATURE_MATCH_THRESHOLD}，不給予加成`);
              }
              break;
            }
          }
        }
      }

      // 僅對匹配候選加成
      if (matchingPlantIndices.size > 0 && plantResults.plants) {
        const topScore = plantResults.plants[0]?.score || 0;
        if (topScore >= 0.5) {
          plantResults.lm_confidence_boost = LM_BOOST;
          plantResults.plants = plantResults.plants.map((p, i) => {
            if (!matchingPlantIndices.has(i)) {
              return { ...p, adjusted_score: p.score };
            }
            const maxBoost = p.score * 0.5;
            const actualBoost = Math.min(LM_BOOST, maxBoost);
            const adjusted = Math.min(1.0, p.score + actualBoost);
            console.log(`📊 分數調整: ${p.chinese_name} 原始=${(p.score * 100).toFixed(1)}%, 加成=${(actualBoost * 100).toFixed(1)}%, 調整後=${(adjusted * 100).toFixed(1)}%`);
            return { ...p, adjusted_score: adjusted };
          });
        } else {
          console.log(`⚠️ 最高分數 ${(topScore * 100).toFixed(1)}% < 50%，跳過 LM 加成`);
        }
      }
    }

    // 兩段式多圖：僅在「確定是植物」且「結果不確定」時才建議補拍；非植物（人造物等）絕不要求拍花朵
    // 支援最多 3 張：第 1 張後可要第 2 張，第 2 張後仍不確定可要第 3 張
    const traitsForCheck = followUpTraits || parseTraitsFromResponse(description);
    const isPlant = plantResults?.is_plant && plantResults?.plants?.length > 0;
    const uncertain = isPlant && isUncertain(plantResults, traitsForCheck, description);
    const needMorePhotos = uncertain && photoCount < 3 && plantResults?.category !== 'human_made';
    const sessionData = needMorePhotos ? {
      description,
      detailedDescription,
      traits: traitsForCheck,
      plants: plantResults?.plants || [],
      photo_count: photoCount
    } : null;

    res.json({
      success: true,
      description: description,
      plant_rag: plantResults,
      quick_features: quickFeatures,
      ...(needMorePhotos && {
        need_more_photos: true,
        need_more_photos_message: '請從不同角度再拍一張（特別是花朵或花序），可提高辨識準確度',
        session_data: sessionData
      })
    });

  } catch (err) {
    console.error('❌ AI 辨識失敗:', err);
    res.status(500).json({
      success: false,
      message: 'AI 暫時無法連線，請確認後端設定',
      error: err.message
    });
  }
});

// 取得植物辨識用的結構化 Prompt
app.get('/api/plant-vision-prompt', async (req, res) => {
  try {
    const promptData = await getVisionPrompt();
    if (promptData) {
      res.json({ success: true, ...promptData });
    } else {
      res.status(503).json({ success: false, message: 'Embedding API 未連接' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// AI 文字聊天 API (語音/文字用)
app.post('/api/chat-text', async (req, res) => {
  try {
    const systemPrompt = req.body.systemPrompt || '你是一個有用的 AI 助手。';
    const userPromptText = req.body.userPrompt || '';
    const userText = req.body.text || '';
    const locationText = req.body.locationText || '';

    if (!userText) {
      return res.status(400).json({ success: false, message: '缺少使用者內容' });
    }

    const finalUserPrompt = `${userPromptText}\n\n${userText}${locationText ? `\n\n(位置: ${locationText})` : ''}`.trim();

    const AI_API_URL =
      process.env.AI_API_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:1234/v1' : null);
    // 生產環境必須設定 AI_MODEL，開發環境使用預設值
    const AI_MODEL = process.env.AI_MODEL || (process.env.NODE_ENV !== 'production' ? 'google/gemma-3-12b' : null);
    const AI_API_KEY = process.env.AI_API_KEY || 'lm-studio';

    if (!AI_API_URL) {
      throw new Error('AI_API_URL 未設定：請在部署環境設定 AI_API_URL / AI_API_KEY / AI_MODEL');
    }
    
    if (!AI_MODEL) {
      throw new Error('AI_MODEL 未設定：請在部署環境設定 AI_MODEL（例如：google/gemma-3-12b）');
    }

    console.log('🤖 正在呼叫 AI(文字):', AI_API_URL);

    const aiResponse = await fetch(`${AI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: finalUserPrompt }
        ],
        max_tokens: 600,
        temperature: 0.7
      })
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI API Error(文字):', errText);
      throw new Error(`AI API 回應錯誤: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const description = aiData.choices[0].message.content;

    res.json({
      success: true,
      description: description
    });
  } catch (err) {
    console.error('❌ AI 文字回覆失敗:', err);
    res.status(500).json({
      success: false,
      message: 'AI 暫時無法連線，請確認後端設定',
      error: err.message
    });
  }
});

app.post('/api/admin/import-users', adminAuth, uploadExcel.single('file'), async (req, res) => {
  const { simulateActivity, startDate, endDate } = req.body;
  const isSimulationEnabled = simulateActivity === 'true';

  if (!req.file) {
    return res.status(400).json({ success: false, message: '請上傳 Excel 檔案' });
  }

  let conn;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      return res.status(400).json({ success: false, message: 'Excel 檔案內容為空' });
    }

    // 檢查欄位 (支援 'phone' 或 '手機號碼')
    const phoneKey = data[0].phone ? 'phone' : (data[0]['手機號碼'] ? '手機號碼' : null);
    if (!phoneKey) {
      return res.status(400).json({ success: false, message: '找不到手機號碼欄位 (請使用 "phone" 或 "手機號碼")' });
    }

    conn = await pool.getConnection();
    
    // 預先抓取所有任務資料供模擬使用
    let independentTasks = [];
    let questChains = [];
    
    if (isSimulationEnabled) {
      const [tasks] = await conn.execute('SELECT id, points, quest_chain_id, quest_order FROM tasks');
      const [chains] = await conn.execute('SELECT id FROM quest_chains');
      
      independentTasks = tasks.filter(t => !t.quest_chain_id);
      
      // 整理劇情任務結構
      const questTasks = tasks.filter(t => t.quest_chain_id);
      chains.forEach(chain => {
        const chainTasks = questTasks.filter(t => t.quest_chain_id === chain.id).sort((a, b) => a.quest_order - b.quest_order);
        if (chainTasks.length > 0) {
          questChains.push({
            id: chain.id,
            tasks: chainTasks
          });
        }
      });
    }

    let successCount = 0;
    let skipCount = 0;
    const password = ''; // 無密碼
    
    // 設定註冊時間範圍 (使用前端傳來的參數，或預設值)
    const START_DATE = startDate ? new Date(startDate) : new Date('2025-11-01');
    const END_DATE = endDate ? new Date(endDate) : new Date('2025-12-29');
    
    // 確保結束時間包含了當天的最後一刻
    END_DATE.setHours(23, 59, 59, 999);

    const START_HOUR = 7;
    const END_HOUR = 23;

    function getRandomDate(start, end) {
        const startTime = start.getTime();
        const endTime = end.getTime();
        const diff = endTime - startTime;
        let randomTime = startTime + Math.random() * diff;
        let date = new Date(randomTime);
        const randomHour = Math.floor(Math.random() * (END_HOUR - START_HOUR + 1)) + START_HOUR;
        const randomMinute = Math.floor(Math.random() * 60);
        const randomSecond = Math.floor(Math.random() * 60);
        date.setHours(randomHour, randomMinute, randomSecond);
        return date;
    }

    for (const row of data) {
      const phone = String(row[phoneKey]).trim();
      if (!phone) continue;

      try {
        // 檢查是否已存在
        const [existing] = await conn.execute('SELECT id FROM users WHERE username = ?', [phone]);
        if (existing.length > 0) {
          skipCount++;
          continue;
        }

        const createdAt = getRandomDate(START_DATE, END_DATE);
        const formattedDate = createdAt.toISOString().slice(0, 19).replace('T', ' ');

        const [result] = await conn.execute(
          'INSERT INTO users (username, password, role, created_at) VALUES (?, ?, ?, ?)',
          [phone, password, 'user', formattedDate]
        );
        
        const userId = result.insertId;
        successCount++;

        // --- 模擬遊玩數據 ---
        if (isSimulationEnabled) {
          // 1. 模擬一般任務
          // 確保不超過現有任務數量
          const maxIndependent = Math.min(independentTasks.length, 5); // 最多 5 個，或是全部
          const numIndependent = Math.floor(Math.random() * (maxIndependent + 1)); // 0 ~ max
          
          const shuffledTasks = independentTasks.sort(() => 0.5 - Math.random());
          const selectedIndependent = shuffledTasks.slice(0, numIndependent);

          for (const task of selectedIndependent) {
             // 隨機完成時間：註冊後 1小時 ~ 30天
             const taskTime = new Date(createdAt.getTime() + (Math.random() * 30 * 24 * 60 * 60 * 1000) + (60 * 60 * 1000));
             if (taskTime > new Date()) continue; // 不超過現在時間

             const formattedTaskTime = taskTime.toISOString().slice(0, 19).replace('T', ' ');
             
             // 寫入 user_tasks
             await conn.execute(
               `INSERT INTO user_tasks (user_id, task_id, status, started_at, finished_at, answer) 
                VALUES (?, ?, '完成', ?, ?, ?)`,
               [userId, task.id, formattedTaskTime, formattedTaskTime, '模擬作答']
             );

             // 寫入 point_transactions
             await conn.execute(
               `INSERT INTO point_transactions (user_id, type, points, description, reference_type, reference_id, created_at)
                VALUES (?, 'earned', ?, ?, 'task_completion', ?, ?)`,
               [userId, task.points, `完成任務 #${task.id}`, task.id, formattedTaskTime]
             );
          }

          // 2. 模擬劇情任務
          // 確保不超過現有劇情鏈數量
          const maxChains = Math.min(questChains.length, 2); // 最多 2 個，或是全部
          const numChains = Math.floor(Math.random() * (maxChains + 1)); // 0 ~ max
          
          const shuffledChains = questChains.sort(() => 0.5 - Math.random());
          const selectedChains = shuffledChains.slice(0, numChains);

          for (const chain of selectedChains) {
            // 隨機決定玩到第幾關 (1 ~ chain.tasks.length)
            // 這裡本身就不會超過該劇情鏈的長度
            const progress = Math.floor(Math.random() * chain.tasks.length) + 1;
            
            // 按順序解鎖
            let lastTaskTime = new Date(createdAt.getTime() + (Math.random() * 24 * 60 * 60 * 1000)); // 註冊後一天開始玩

            for (let i = 0; i < progress; i++) {
               const task = chain.tasks[i];
               // 每一關間隔 10分 ~ 2小時
               lastTaskTime = new Date(lastTaskTime.getTime() + (Math.random() * 2 * 60 * 60 * 1000) + (10 * 60 * 1000));
               
               if (lastTaskTime > new Date()) break;

               const formattedTaskTime = lastTaskTime.toISOString().slice(0, 19).replace('T', ' ');

               // 最後一關有機率是「進行中」而非「完成」
               // 如果是最後一關且不是整個劇情鏈的最後一關，30% 機率是進行中
               const isLastInProgress = (i === progress - 1) && (Math.random() < 0.3);
               
               if (isLastInProgress) {
                 await conn.execute(
                   `INSERT INTO user_tasks (user_id, task_id, status, started_at) 
                    VALUES (?, ?, '進行中', ?)`,
                   [userId, task.id, formattedTaskTime]
                 );
               } else {
                 await conn.execute(
                   `INSERT INTO user_tasks (user_id, task_id, status, started_at, finished_at, answer) 
                    VALUES (?, ?, '完成', ?, ?, ?)`,
                   [userId, task.id, formattedTaskTime, formattedTaskTime, '模擬劇情作答']
                 );
                 
                 await conn.execute(
                   `INSERT INTO point_transactions (user_id, type, points, description, reference_type, reference_id, created_at)
                    VALUES (?, 'earned', ?, ?, 'task_completion', ?, ?)`,
                   [userId, task.points, `完成劇情任務 #${task.id}`, task.id, formattedTaskTime]
                 );
               }
            }
          }
        }

      } catch (err) {
        console.error(`匯入失敗: ${phone}`, err);
        // 不中斷迴圈，繼續下一個
      }
    }

    res.json({
      success: true,
      message: `匯入完成。成功: ${successCount}, 重複跳過: ${skipCount}`,
      details: { successCount, skipCount }
    });

  } catch (err) {
    console.error('Excel 匯入失敗:', err);
    res.status(500).json({ success: false, message: '匯入過程發生錯誤: ' + err.message });
  } finally {
    if (conn) conn.release();
  }
});

// 批量新增特定用戶（一次性功能）

// 更新兌換記錄狀態
app.put('/api/product-redemptions/:id/status', staffOrAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  if (!['completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ success: false, message: '無效的狀態' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const username = req.user?.username;

    // 獲取用戶角色
    const [userRows] = await conn.execute(
      'SELECT role FROM users WHERE username = ?',
      [username]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用戶不存在' });
    }

    const userRole = userRows[0].role;

    // 檢查 products 表是否有 created_by 欄位
    const [createdByCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'created_by'");
    const hasCreatedBy = createdByCols.length > 0;

    // 獲取兌換記錄詳情和商品名稱
    let query, params;
    if (userRole === 'admin') {
      if (hasCreatedBy) {
      query = `
        SELECT pr.*, p.name as product_name, p.created_by
        FROM product_redemptions pr
        JOIN products p ON pr.product_id = p.id
        WHERE pr.id = ?
      `;
      } else {
        query = `
          SELECT pr.*, p.name as product_name, NULL as created_by
          FROM product_redemptions pr
          JOIN products p ON pr.product_id = p.id
          WHERE pr.id = ?
        `;
      }
      params = [id];
    } else {
      if (hasCreatedBy) {
      query = `
        SELECT pr.*, p.name as product_name, p.created_by
        FROM product_redemptions pr
        JOIN products p ON pr.product_id = p.id
        WHERE pr.id = ? AND p.created_by = ?
      `;
      params = [id, username];
      } else {
        // 如果沒有 created_by 欄位，工作人員可以處理任何兌換記錄（向後兼容）
        query = `
          SELECT pr.*, p.name as product_name, NULL as created_by
          FROM product_redemptions pr
          JOIN products p ON pr.product_id = p.id
          WHERE pr.id = ?
        `;
        params = [id];
      }
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
    if (conn) conn.release();
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

// Embedding API health (for Zeabur debugging from phone)
app.get('/api/embedding-health', async (req, res) => {
  try {
    const h = await healthCheck();
    res.json({
      ok: Boolean(h.ok),
      embedding_api_url: process.env.EMBEDDING_API_URL || null,
      health: h,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      embedding_api_url: process.env.EMBEDDING_API_URL || null,
      error: err.message,
    });
  }
});

app.get('/api/embedding-stats', async (req, res) => {
  try {
    const s = await embeddingStats();
    res.json({
      ok: Boolean(s.ok),
      embedding_api_url: process.env.EMBEDDING_API_URL || null,
      stats: s,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      embedding_api_url: process.env.EMBEDDING_API_URL || null,
      error: err.message,
    });
  }
});

app.get(/^\/(?!api\/).*/, (req, res, next) => {
  if (req.path.match(/\.[a-zA-Z0-9]+$/)) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 輸出環境變數檢查（僅在開發環境顯示詳細資訊，生產環境僅顯示必要狀態）
if (process.env.NODE_ENV !== 'production') {
  console.log('=== 環境變數檢查 (開發模式) ===');
  if (process.env.DATABASE_URL) {
    console.log('DATABASE_URL:', '[已設定 - 將優先使用]');
  } else {
    console.log('DATABASE_URL:', '[未設定]');
    console.log('MYSQL_HOST:', process.env.MYSQL_HOST || '[未設定]');
    console.log('MYSQL_PORT:', process.env.MYSQL_PORT || '[未設定]');
    console.log('MYSQL_USERNAME:', process.env.MYSQL_USERNAME || '[未設定]');
    console.log('MYSQL_DATABASE:', process.env.MYSQL_DATABASE || '[未設定]');
  console.log('MYSQL_ROOT_PASSWORD:', process.env.MYSQL_ROOT_PASSWORD ? '[已設定]' : '[未設定]');
    console.log('MYSQL_PASSWORD:', process.env.MYSQL_PASSWORD ? '[已設定]' : '[未設定]');
  }
  console.log('ALLOWED_ORIGINS:', process.env.ALLOWED_ORIGINS || '[未設定]');
  console.log('==================');
} else {
  // 生產環境：僅顯示必要狀態，不輸出任何敏感資訊
  console.log('✅ 環境變數已載入（生產模式，詳細資訊已隱藏）');
}

// 啟動時測試資料庫連接
(async () => {
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    console.error('⚠️  警告: 資料庫連接失敗，部分功能可能無法正常運作');
  } else {
    // 自動執行 AR 系統資料庫遷移
    try {
        const conn = await pool.getConnection();
        
        // 1. 建立 ar_models 表
        await conn.execute(`
          CREATE TABLE IF NOT EXISTS ar_models (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            url VARCHAR(512) NOT NULL,
            type VARCHAR(50) DEFAULT 'general',
            scale FLOAT DEFAULT 1.0,
            created_by VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // 2. 修改 tasks 表
        const [taskCols] = await conn.execute("SHOW COLUMNS FROM tasks LIKE 'ar_model_id'");
        if (taskCols.length === 0) {
            await conn.execute("ALTER TABLE tasks ADD COLUMN ar_model_id INT DEFAULT NULL");
            console.log('✅ 資料庫遷移: tasks 表已新增 ar_model_id');
        }

        // 3. 修改 items 表
        const [itemCols] = await conn.execute("SHOW COLUMNS FROM items LIKE 'model_url'");
        if (itemCols.length === 0) {
            await conn.execute("ALTER TABLE items ADD COLUMN model_url VARCHAR(512) DEFAULT NULL");
            console.log('✅ 資料庫遷移: items 表已新增 model_url');
        }

        // 4. 修改 products 表 - 添加 is_active 欄位
        const [productCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'is_active'");
        if (productCols.length === 0) {
            await conn.execute("ALTER TABLE products ADD COLUMN is_active BOOLEAN DEFAULT TRUE");
            console.log('✅ 資料庫遷移: products 表已新增 is_active');
        }

        // 5. 修改 products 表 - 添加 created_by 欄位
        const [productCreatedByCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'created_by'");
        if (productCreatedByCols.length === 0) {
            await conn.execute("ALTER TABLE products ADD COLUMN created_by VARCHAR(255) DEFAULT NULL");
            console.log('✅ 資料庫遷移: products 表已新增 created_by');
        }

        // 4. 新增 AR 順序欄位 (tasks 表)
        const arOrderCols = ['ar_order_model', 'ar_order_image', 'ar_order_youtube'];
        for (const col of arOrderCols) {
            const [check] = await conn.execute(`SHOW COLUMNS FROM tasks LIKE '${col}'`);
            if (check.length === 0) {
                await conn.execute(`ALTER TABLE tasks ADD COLUMN ${col} INT DEFAULT NULL`);
                console.log(`✅ 資料庫遷移: tasks 表已新增 ${col}`);
            }
        }

        // 6. 新增背景音樂欄位 (tasks 表)
        const [bgmCols] = await conn.execute("SHOW COLUMNS FROM tasks LIKE 'bgm_url'");
        if (bgmCols.length === 0) {
            await conn.execute("ALTER TABLE tasks ADD COLUMN bgm_url VARCHAR(512) DEFAULT NULL");
            console.log('✅ 資料庫遷移: tasks 表已新增 bgm_url');
        }

        // 5. 建立推送訂閱表
        await conn.execute(`
          CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh VARCHAR(255) NOT NULL,
            auth VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE KEY unique_user_endpoint (user_id, endpoint(255))
          )
        `);
        console.log('✅ 資料庫遷移: push_subscriptions 表已建立');
        
        conn.release();
        console.log('✅ AR 多步驟系統資料庫結構檢查完成');
    } catch (err) {
        console.error('❌ AR 系統資料庫遷移失敗:', err);
    }
  }
})();

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  console.log(`🌐 應用程式運行在: http://localhost:${PORT}`);
  console.log(`🔍 健康檢查端點: http://localhost:${PORT}/api/health`);
}); 
// Force redeploy timestamp: Tue Jan  6 12:06:17 CST 2026
