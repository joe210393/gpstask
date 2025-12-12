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
const migrationActor = (process.env.MIGRATION_ACTOR && String(process.env.MIGRATION_ACTOR).trim())
  ? String(process.env.MIGRATION_ACTOR).trim()
  : 'system_migration';

async function migrateTasksTable() {
  let conn;
  try {
    console.log('連接資料庫...');
    conn = await mysql.createConnection(dbConfig);

    // 檢查 created_by 字段是否已存在
    const [columns] = await conn.execute(
      "SHOW COLUMNS FROM tasks LIKE 'created_by'"
    );

    if (columns.length === 0) {
      console.log('添加 created_by 字段到 tasks 表...');
      await conn.execute(
        'ALTER TABLE tasks ADD COLUMN created_by VARCHAR(100) AFTER youtubeUrl'
      );
      console.log('✅ 成功添加 created_by 字段');
    } else {
      console.log('✅ created_by 字段已存在');
    }

    // 檢查是否有現有任務，將它們分配給 migrationActor（如果還沒有 created_by）
    const [existingTasks] = await conn.execute(
      'SELECT id, name FROM tasks WHERE created_by IS NULL'
    );

    if (existingTasks.length > 0) {
      console.log(`更新 ${existingTasks.length} 個現有任務的 created_by 字段為 '${migrationActor}'...`);
      await conn.execute(
        'UPDATE tasks SET created_by = ? WHERE created_by IS NULL',
        [migrationActor]
      );
      console.log('✅ 成功更新現有任務的 created_by 字段');
    } else {
      console.log('✅ 所有任務都已有 created_by 字段');
    }

  } catch (err) {
    console.error('遷移失敗:', err);
  } finally {
    if (conn) await conn.end();
  }
}

migrateTasksTable().then(() => {
  console.log('任務表遷移完成');
  process.exit(0);
}).catch(err => {
  console.error('遷移錯誤:', err);
  process.exit(1);
});
