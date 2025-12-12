const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let connection;
  try {
    console.log('🔄 開始資料庫遷移：新增 AR 圖片欄位...');
    
    connection = await mysql.createConnection(dbConfig);

    // 檢查欄位是否存在
    const [columns] = await connection.query(`
      SHOW COLUMNS FROM tasks LIKE 'ar_image_url'
    `);

    if (columns.length === 0) {
      // 新增 ar_image_url 欄位
      await connection.query(`
        ALTER TABLE tasks
        ADD COLUMN ar_image_url VARCHAR(255) DEFAULT NULL AFTER photoUrl
      `);
      console.log('✅ 成功新增 ar_image_url 欄位');
    } else {
      console.log('ℹ️ ar_image_url 欄位已存在，跳過');
    }

    console.log('🎉 遷移完成！');

  } catch (error) {
    console.error('❌ 遷移失敗:', error);
  } finally {
    if (connection) await connection.end();
  }
}

migrate();
