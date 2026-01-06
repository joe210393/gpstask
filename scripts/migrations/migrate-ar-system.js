const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

async function migrate() {
  const dbConfig = getDbConfig();
  let conn;
  
  try {
    conn = await mysql.createConnection(dbConfig);
    console.log('✅ 資料庫連接成功');

    // 1. 建立 ar_models 表 (資產庫)
    console.log('🛠️ 正在建立 ar_models 表...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ar_models (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        url VARCHAR(512) NOT NULL,
        type VARCHAR(50) DEFAULT 'general', -- general, character, marker
        scale FLOAT DEFAULT 1.0, -- 預設縮放比例
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ ar_models 表準備就緒');

    // 2. 修改 tasks 表
    console.log('🛠️ 正在更新 tasks 表...');
    
    // 檢查是否有 ar_model_id 欄位
    const [taskCols] = await conn.execute("SHOW COLUMNS FROM tasks LIKE 'ar_model_id'");
    if (taskCols.length === 0) {
        await conn.execute("ALTER TABLE tasks ADD COLUMN ar_model_id INT DEFAULT NULL");
        console.log('   + 新增 ar_model_id 欄位');
    }

    // 3. 修改 items 表
    console.log('🛠️ 正在更新 items 表...');
    const [itemCols] = await conn.execute("SHOW COLUMNS FROM items LIKE 'model_url'");
    if (itemCols.length === 0) {
        await conn.execute("ALTER TABLE items ADD COLUMN model_url VARCHAR(512) DEFAULT NULL");
        console.log('   + 新增 model_url 欄位');
    }

    console.log('🎉 資料庫遷移完成！');

  } catch (err) {
    console.error('❌ 遷移失敗:', err);
  } finally {
    if (conn) await conn.end();
  }
}

migrate();
