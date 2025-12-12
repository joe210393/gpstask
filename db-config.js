// Centralized DB config helper
// Security rule: never hardcode passwords/hosts in code. Use environment variables only.
//
// Supported env:
// - DATABASE_URL (optional): mysql://user:pass@host:port/dbname
// - MYSQL_HOST
// - MYSQL_PORT (optional, defaults to 3306)
// - MYSQL_USERNAME
// - MYSQL_ROOT_PASSWORD or MYSQL_PASSWORD
// - MYSQL_DATABASE

function requireEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const value = String(v);
  // 檢查是否包含未展開的變數語法（例如 ${VAR}）
  // 放寬檢查：只在明確看起來像未展開變數時才報錯，避免誤判包含 $ 或 {} 的合法密碼
  if (value.startsWith('${') && value.endsWith('}')) {
    throw new Error(`Environment variable ${name} appears to contain unexpanded variable syntax (e.g., \${VAR}). Please check your Zeabur environment variable configuration.`);
  }
  return value;
}

function getDbConfig() {
  // Prefer DATABASE_URL if provided (common pattern in many PaaS)
  if (process.env.DATABASE_URL) {
    const dbUrl = String(process.env.DATABASE_URL);
    // 檢查是否包含未展開的變數語法
    if (dbUrl.startsWith('${') && dbUrl.endsWith('}')) {
      throw new Error('DATABASE_URL appears to contain unexpanded variable syntax (e.g., ${VAR}). Please check your Zeabur environment variable configuration.');
    }
    
    // 診斷：顯示原始 URL（隱藏敏感資訊）
    // const urlPreview = dbUrl.length > 50 ? dbUrl.substring(0, 50) + '...' : dbUrl;
    // console.log('原始 DATABASE_URL 預覽:', urlPreview.replace(/:[^:@]+@/, ':****@'));
    
    // 使用正則表達式手動解析 URL，避免 new URL() 對 URL 編碼密碼的處理問題
    const mysqlUrlRegex = /^mysql:\/\/([^:]+):([^@]+)@([^:\/]+):?(\d+)?\/(.+)$/;
    const match = dbUrl.match(mysqlUrlRegex);
    
    if (!match) {
      // console.error('正則表達式匹配失敗，嘗試使用 new URL() 作為備用方案');
      // 如果正則失敗，嘗試使用 new URL() 作為備用方案
      let url;
      try {
        url = new URL(dbUrl);
        if (url.protocol !== 'mysql:') {
          throw new Error('DATABASE_URL must start with mysql://');
        }
        const user = decodeURIComponent(url.username || '');
        const password = decodeURIComponent(url.password || '');
        const host = url.hostname;
        const port = url.port ? Number(url.port) : 3306;
        const database = (url.pathname || '').replace(/^\//, '');
        
        if (!host || !user || !password || !database) {
          throw new Error('DATABASE_URL missing required parts (host/user/password/database)');
        }
        
        return { host, user, password, database, port, charset: 'utf8mb4' };
      } catch (err) {
        throw new Error(`DATABASE_URL format error: ${err.message}. Please ensure the URL is properly formatted (e.g., mysql://user:password@host:port/database). If your password contains special characters like !, @, #, :, /, you may need to URL-encode them.`);
      }
    }
    
    // 從正則匹配結果中提取各部分
    const user = decodeURIComponent(match[1]);
    const passwordRaw = match[2];
    const password = decodeURIComponent(passwordRaw); // 這裡會正確解碼 %21 為 !
    const host = match[3];
    const port = match[4] ? Number(match[4]) : 3306;
    const database = decodeURIComponent(match[5]);
    
    if (!host || !user || !password || !database) {
      // 避免輸出完整的敏感資訊
      console.error('DATABASE_URL 解析失敗: 缺少必要欄位 (host/user/password/database)');
      throw new Error('DATABASE_URL missing required parts. Please check your DATABASE_URL format.');
    }
    
    return { host, user, password, database, port, charset: 'utf8mb4' };
  }

  const host = requireEnv('MYSQL_HOST');
  const user = requireEnv('MYSQL_USERNAME');
  const database = requireEnv('MYSQL_DATABASE');
  const password = process.env.MYSQL_ROOT_PASSWORD || process.env.MYSQL_PASSWORD;
  if (!password || String(password).trim() === '') {
    throw new Error('Missing required environment variable: MYSQL_ROOT_PASSWORD (or MYSQL_PASSWORD)');
  }
  const passwordStr = String(password);
  // 檢查密碼是否包含未展開的變數語法
  if (passwordStr.startsWith('${') && passwordStr.endsWith('}')) {
    throw new Error(`MYSQL_ROOT_PASSWORD/MYSQL_PASSWORD appears to contain unexpanded variable syntax (e.g., \${PASSWORD}). Please check your Zeabur environment variable configuration.`);
  }
  const port = process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306;
  if (Number.isNaN(port) || port <= 0) {
    throw new Error('MYSQL_PORT must be a valid number');
  }
  return { host, user, password: passwordStr, database, port, charset: 'utf8mb4' };
}

module.exports = { getDbConfig };


