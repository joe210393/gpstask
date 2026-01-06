const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { getDbConfig } = require('../../db-config');

const dbConfig = getDbConfig();

async function hashPlaintextPasswords() {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    console.log('🔐 連接資料庫成功...');

    // 獲取所有有明文密碼的用戶
    const [users] = await conn.execute(
      'SELECT id, username, password FROM users WHERE password IS NOT NULL AND (password NOT LIKE "$2a$%" AND password NOT LIKE "$2b$%")'
    );

    console.log(`📋 發現 ${users.length} 個明文密碼用戶：`);
    for (const user of users) {
      console.log(`  ${user.username}: ${user.password}`);
    }

    // 為每個明文密碼生成 bcrypt hash
    for (const user of users) {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      await conn.execute(
        'UPDATE users SET password = ? WHERE id = ?',
        [hashedPassword, user.id]
      );
      console.log(`✅ ${user.username} 的密碼已加密`);
    }

    // 驗證所有密碼都已加密
    const [allUsers] = await conn.execute('SELECT username, password FROM users WHERE password IS NOT NULL');
    console.log('\n🔍 驗證結果：');
    let allEncrypted = true;
    for (const user of allUsers) {
      const isEncrypted = user.password.startsWith('$2a$') || user.password.startsWith('$2b$');
      console.log(`  ${user.username}: ${isEncrypted ? '已加密' : '未加密'}`);
      if (!isEncrypted) allEncrypted = false;
    }

    console.log(`\n🎉 ${allEncrypted ? '所有密碼都已正確加密！' : '還有未加密的密碼！'}`);

  } catch (err) {
    console.error('❌ 密碼加密失敗:', err);
  } finally {
    if (conn) await conn.end();
  }
}

hashPlaintextPasswords();
