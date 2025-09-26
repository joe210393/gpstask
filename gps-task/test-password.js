const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'gps_task',
  port: 3306
};

async function testPassword() {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    // 獲取 staff1 的密碼
    const [users] = await conn.execute('SELECT password FROM users WHERE username = ?', ['staff1']);
    if (users.length === 0) {
      console.log('❌ 用戶不存在');
      return;
    }

    const storedPassword = users[0].password;
    const inputPassword = 'staff123';

    console.log('🔐 存儲的密碼 hash:', storedPassword);
    console.log('🔑 輸入的密碼:', inputPassword);

    // 測試 bcrypt 比較
    const isValid = await bcrypt.compare(inputPassword, storedPassword);
    console.log('✅ bcrypt 比較結果:', isValid);

  } catch (err) {
    console.error('❌ 測試失敗:', err);
  } finally {
    if (conn) await conn.end();
  }
}

testPassword();
