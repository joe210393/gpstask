const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

async function fixPasswordNull() {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    console.log('檢查 users 表結構...');

    // 修改 password 欄位為可空
    await conn.execute('ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NULL');

    console.log('✅ password 欄位已修改為可空');

    // 檢查現有用戶的密碼
    const [users] = await conn.execute('SELECT id, username, password, role FROM users');
    console.log(`\n現有用戶 (${users.length}個):`);

    users.forEach(user => {
      console.log(`- ${user.username} (${user.role}): ${user.password ? '有密碼' : '無密碼'}`);
    });

    console.log('\n✅ 資料庫修復完成！');

  } catch (err) {
    console.error('修復失敗:', err);
  } finally {
    if (conn) await conn.end();
  }
}

fixPasswordNull();
