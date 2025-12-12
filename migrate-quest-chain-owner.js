const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let conn;
  try {
    console.log('🔄 檢查 quest_chains 表格結構...');
    conn = await mysql.createConnection(dbConfig);

    // 先檢查表是否存在
    const [tables] = await conn.query("SHOW TABLES LIKE 'quest_chains'");
    if (tables.length === 0) {
      console.log('ℹ️ quest_chains 表格不存在，跳過 migration（將由 migrate-task-system.js 建立）');
      return;
    }

    // 檢查欄位是否存在
    const [cols] = await conn.query("SHOW COLUMNS FROM quest_chains LIKE 'created_by'");
    if (cols.length === 0) {
      console.log('🛠 新增 created_by 欄位...');
      // 預設給 'admin'，確保舊資料有歸屬
      await conn.query("ALTER TABLE quest_chains ADD COLUMN created_by VARCHAR(50) NOT NULL DEFAULT 'admin' AFTER id");
      console.log('✅ quest_chains.created_by 新增完成');
    } else {
      console.log('ℹ️ quest_chains.created_by 已存在，跳過');
    }

  } catch (err) {
    console.error('❌ Migration 失敗:', err.message);
    // 不要因為 migration 失敗就阻止服務啟動（可能是欄位已存在或其他非致命錯誤）
    console.error('   繼續啟動服務...');
  } finally {
    if (conn) await conn.end();
  }
}

migrate();

