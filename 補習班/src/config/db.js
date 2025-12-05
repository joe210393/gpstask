import mysql from 'mysql2/promise';

// 支援 DATABASE_URL（例如：mysql://user:pass@host:port/dbname）
function resolveDbConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const u = new URL(url);
      const isMysql = u.protocol.replace(':','') === 'mysql';
      if (isMysql) {
        const cfg = {
          host: u.hostname,
          port: Number(u.port || 3306),
          user: decodeURIComponent(u.username || ''),
          password: decodeURIComponent(u.password || ''),
          database: decodeURIComponent((u.pathname || '').replace(/^\//, '')) || 'site_cms'
        };
        // Allow explicit DB_NAME to override DATABASE_URL's database segment
        if (process.env.DB_NAME) cfg.database = process.env.DB_NAME;
        return cfg;
      }
    } catch {}
  }
  return {
    // 寫死預設為 Zeabur 的資料庫（可被環境變數覆蓋）
    host: process.env.DB_HOST || 'hkg1.clusters.zeabur.com',
    port: Number(process.env.DB_PORT || 31718),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'u18gPqVJsr3v7DBA2i6Gl5Ow4yEf9nM0',
    database: process.env.DB_NAME || 'zeabur'
  };
}

const base = resolveDbConfig();
const useSsl = String(process.env.DB_SSL || '').toLowerCase();
const ssl = useSsl && useSsl !== '0' && useSsl !== 'false' && useSsl !== 'off' ? { rejectUnauthorized: false } : undefined;

const pool = mysql.createPool({
  ...base,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z',
  ssl
});

// 啟動時輸出精簡 DB 設定（不含密碼），方便雲端日誌診斷
try {
  // eslint-disable-next-line no-console
  console.log('DB config summary', { host: base.host, port: base.port, database: base.database, ssl: Boolean(ssl), via: process.env.DATABASE_URL ? 'DATABASE_URL' : 'ENV_FIELDS' });
} catch {}

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function getConnection() {
  return pool.getConnection();
}

export default pool;


