const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let connection;
  try {
    console.log('🔄 開始資料庫升級：修改 task_type 欄位...');
    
    connection = await mysql.createConnection(dbConfig);

    // 檢查欄位是否存在
    const [columns] = await connection.query("SHOW COLUMNS FROM tasks LIKE 'task_type'");
    if (columns.length === 0) {
      console.log('ℹ️ task_type 欄位不存在，跳過');
      return;
    }

    // 檢查欄位類型
    const colType = String(columns[0].Type || '').toLowerCase();
    if (colType.includes('varchar')) {
      console.log('ℹ️ task_type 欄位已是 VARCHAR，跳過');
      return;
    }

    // 修改 task_type 欄位定義，將 ENUM 改為 VARCHAR 以支援更多類型
    await connection.execute(`
      ALTER TABLE tasks 
      MODIFY COLUMN task_type VARCHAR(50) NOT NULL DEFAULT 'qa'
    `);
    
    console.log('✅ task_type 欄位已改為 VARCHAR(50)');

    console.log('🎉 資料庫升級完成！');

  } catch (error) {
    console.error('❌ 升級失敗:', error.message || error);
    // 不阻止服務啟動
  } finally {
    if (connection) await connection.end();
  }
}

migrate();
