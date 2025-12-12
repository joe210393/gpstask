const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs'); // 改用 bcryptjs 以匹配 index.js
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

async function createDefaultAdmin() {
  let connection;
  try {
    console.log('🔄 檢查/建立預設 admin 帳號...');
    connection = await mysql.createConnection(dbConfig);

    // 檢查 admin 是否存在
    const [rows] = await connection.execute('SELECT id FROM users WHERE username = ?', ['admin']);
    
    if (rows.length === 0) {
      console.log('📦 建立預設 admin 帳號...');
      // 密碼加密
      const hashedPassword = await bcrypt.hash('admin', 10);
      
      await connection.execute(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        ['admin', hashedPassword, 'admin']
      );
      console.log('✅ 預設 admin 帳號建立完成 (帳號: admin / 密碼: admin)');
    } else {
      console.log('ℹ️ admin 帳號已存在，跳過');
    }

  } catch (err) {
    console.error('❌ 建立 admin 帳號失敗:', err);
    // 不阻止啟動，可能是 bcrypt 依賴問題或其他非致命錯誤
  } finally {
    if (connection) await connection.end();
  }
}

createDefaultAdmin();

