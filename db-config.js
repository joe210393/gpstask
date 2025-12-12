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
  if (value.includes('${') && value.includes('}')) {
    throw new Error(`Environment variable ${name} appears to contain unexpanded variable syntax (e.g., \${VAR}). Please check your Zeabur environment variable configuration. Current value: ${value.substring(0, 20)}...`);
  }
  return value;
}

function getDbConfig() {
  // Prefer DATABASE_URL if provided (common pattern in many PaaS)
  if (process.env.DATABASE_URL) {
    const dbUrl = String(process.env.DATABASE_URL);
    // 檢查是否包含未展開的變數語法
    if (dbUrl.includes('${') && dbUrl.includes('}')) {
      throw new Error('DATABASE_URL appears to contain unexpanded variable syntax (e.g., ${VAR}). Please check your Zeabur environment variable configuration.');
    }
    
    // 診斷：顯示原始 URL（隱藏敏感資訊）
    const urlPreview = dbUrl.length > 50 ? dbUrl.substring(0, 50) + '...' : dbUrl;
    console.log('原始 DATABASE_URL 預覽:', urlPreview.replace(/:[^:@]+@/, ':****@'));
    
    // 使用正則表達式手動解析 URL，避免 new URL() 對 URL 編碼密碼的處理問題
    const mysqlUrlRegex = /^mysql:\/\/([^:]+):([^@]+)@([^:\/]+):?(\d+)?\/(.+)$/;
    const match = dbUrl.match(mysqlUrlRegex);
    
    if (!match) {
      console.error('正則表達式匹配失敗，嘗試使用 new URL() 作為備用方案');
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
    console.log('正則匹配結果:');
    console.log(`  - match[1] (user): ${match[1]}`);
    console.log(`  - match[2] (password raw): ${match[2]}`);
    console.log(`  - match[3] (host): ${match[3]}`);
    console.log(`  - match[4] (port): ${match[4] || 'default 3306'}`);
    console.log(`  - match[5] (database): ${match[5]}`);
    
    const user = decodeURIComponent(match[1]);
    const passwordRaw = match[2];
    const password = decodeURIComponent(passwordRaw); // 這裡會正確解碼 %21 為 !
    const host = match[3];
    const port = match[4] ? Number(match[4]) : 3306;
    const database = decodeURIComponent(match[5]);
    
    console.log('解碼後:');
    console.log(`  - passwordRaw 長度: ${passwordRaw.length}, 內容: ${passwordRaw.substring(0, 20)}...`);
    console.log(`  - password 長度: ${password.length}`);
    
    // 診斷資訊：顯示解析結果（不顯示完整密碼）
    console.log('DATABASE_URL 解析結果:');
    console.log(`  - Host: ${host}`);
    console.log(`  - Port: ${port}`);
    console.log(`  - User: ${user}`);
    console.log(`  - Database: ${database}`);
    console.log(`  - Password: [已設定，長度: ${password.length}]`);
    if (password.length > 0) {
      // 只顯示前 5 個和後 3 個字元，中間用 * 代替
      const preview = password.length > 8 
        ? `${password.substring(0, 5)}${'*'.repeat(Math.min(password.length - 8, 10))}${password.substring(password.length - 3)}`
        : '*'.repeat(password.length);
      console.log(`  - Password 預覽: ${preview}`);
    }
    
    if (!host || !user || !password || !database) {
      console.error('DATABASE_URL 解析結果:', { host, user, password: password ? `[已設定，長度: ${password.length}]` : '[未設定]', database, port });
      throw new Error('DATABASE_URL missing required parts (host/user/password/database). Please check your DATABASE_URL format.');
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
  if (passwordStr.includes('${') && passwordStr.includes('}')) {
    throw new Error(`MYSQL_ROOT_PASSWORD/MYSQL_PASSWORD appears to contain unexpanded variable syntax (e.g., \${PASSWORD}). Please check your Zeabur environment variable configuration.`);
  }
  const port = process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306;
  if (Number.isNaN(port) || port <= 0) {
    throw new Error('MYSQL_PORT must be a valid number');
  }
  return { host, user, password: passwordStr, database, port, charset: 'utf8mb4' };
}

module.exports = { getDbConfig };


