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
  return String(v);
}

function getDbConfig() {
  // Prefer DATABASE_URL if provided (common pattern in many PaaS)
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
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
  }

  const host = requireEnv('MYSQL_HOST');
  const user = requireEnv('MYSQL_USERNAME');
  const database = requireEnv('MYSQL_DATABASE');
  const password = process.env.MYSQL_ROOT_PASSWORD || process.env.MYSQL_PASSWORD;
  if (!password || String(password).trim() === '') {
    throw new Error('Missing required environment variable: MYSQL_ROOT_PASSWORD (or MYSQL_PASSWORD)');
  }
  const port = process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306;
  if (Number.isNaN(port) || port <= 0) {
    throw new Error('MYSQL_PORT must be a valid number');
  }
  return { host, user, password: String(password), database, port, charset: 'utf8mb4' };
}

module.exports = { getDbConfig };


