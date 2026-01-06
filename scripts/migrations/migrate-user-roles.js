const mysql = require('mysql2/promise');
const { getDbConfig } = require('../../db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let connection;
  try {
    console.log('🔄 開始資料庫遷移：使用者角色與上下屬欄位...');
    connection = await mysql.createConnection(dbConfig);

    const [cols] = await connection.query('SHOW COLUMNS FROM users');
    const colNames = cols.map(c => c.Field);
    const roleCol = cols.find(c => c.Field === 'role');

    // 1) 將 users.role 由 ENUM 改為 VARCHAR，避免未來擴充困難
    if (roleCol && String(roleCol.Type || '').toLowerCase().includes('enum')) {
      console.log('🛠 將 users.role 由 ENUM 改為 VARCHAR(20)...');
      await connection.query(`ALTER TABLE users MODIFY COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'`);
      console.log('✅ users.role 已改為 VARCHAR(20)');
    } else {
      console.log('ℹ️ users.role 非 ENUM 或已調整，跳過');
    }

    // 2) 上下屬關係：staff 由誰指派（shop/admin）
    if (!colNames.includes('managed_by')) {
      console.log('🛠 新增 users.managed_by 欄位...');
      await connection.query(`ALTER TABLE users ADD COLUMN managed_by VARCHAR(50) NULL AFTER role`);
      console.log('✅ users.managed_by 新增完成');
    } else {
      console.log('ℹ️ users.managed_by 已存在，跳過');
    }

    // 3) 帳號建立者：shop/admin 帳號由誰建立（admin）
    if (!colNames.includes('created_by')) {
      console.log('🛠 新增 users.created_by 欄位...');
      await connection.query(`ALTER TABLE users ADD COLUMN created_by VARCHAR(50) NULL AFTER managed_by`);
      console.log('✅ users.created_by 新增完成');
    } else {
      console.log('ℹ️ users.created_by 已存在，跳過');
    }

    // 4) 店家資訊（先存資料，未來可在地圖上顯示）
    if (!colNames.includes('shop_name')) {
      console.log('🛠 新增 users.shop_name / shop_address / shop_description 欄位...');
      await connection.query(`ALTER TABLE users ADD COLUMN shop_name VARCHAR(100) NULL AFTER created_by`);
      await connection.query(`ALTER TABLE users ADD COLUMN shop_address VARCHAR(255) NULL AFTER shop_name`);
      await connection.query(`ALTER TABLE users ADD COLUMN shop_description TEXT NULL AFTER shop_address`);
      console.log('✅ 店家資訊欄位新增完成');
    } else {
      console.log('ℹ️ 店家資訊欄位已存在，跳過');
    }

    console.log('🎉 使用者角色遷移完成！');
  } catch (error) {
    console.error('❌ 遷移失敗:', error);
  } finally {
    if (connection) await connection.end();
  }
}

migrate();


