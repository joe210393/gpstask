const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

function ensureExplicitRun() {
  if (process.env.RUN_DB_SCRIPT !== '1') {
    console.error('❌ 安全保護：此腳本需要明確允許才可執行。請先設定環境變數 RUN_DB_SCRIPT=1');
    console.error('   （避免在正式環境或 CI/CD 被誤跑）');
    process.exit(1);
  }
}

ensureExplicitRun();

const dbConfig = getDbConfig();
// 預設將現有劇情歸給 admin
const defaultCreator = (process.env.MIGRATION_ACTOR && String(process.env.MIGRATION_ACTOR).trim())
  ? String(process.env.MIGRATION_ACTOR).trim()
  : 'admin';

async function migrate() {
  let connection;
  try {
    console.log('🔄 開始資料庫升級：新增 quest_chains.created_by 欄位...');
    connection = await mysql.createConnection(dbConfig);

    // 檢查欄位是否存在
    const [columns] = await connection.query(`SHOW COLUMNS FROM quest_chains LIKE 'created_by'`);
    
    if (columns.length === 0) {
      console.log('🛠 正在新增 created_by 欄位...');
      await connection.query(`
        ALTER TABLE quest_chains
        ADD COLUMN created_by VARCHAR(50) NOT NULL DEFAULT '${defaultCreator}' AFTER title
      `);
      console.log(`✅ created_by 欄位新增成功，預設值為 '${defaultCreator}'`);
    } else {
      console.log('ℹ️ created_by 欄位已存在，跳過');
    }

    console.log('🎉 資料庫升級完成！');

  } catch (error) {
    console.error('❌ 升級失敗:', error);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

migrate();

