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

async function migrateProductsTable() {
  let conn;
  try {
    console.log('連接資料庫...');
    conn = await mysql.createConnection(dbConfig);

    // 檢查 created_by 字段是否已存在
    const [columns] = await conn.execute(
      "SHOW COLUMNS FROM products LIKE 'created_by'"
    );

    if (columns.length === 0) {
      console.log('添加 created_by 字段到 products 表...');
      await conn.execute(
        'ALTER TABLE products ADD COLUMN created_by VARCHAR(100) AFTER is_active'
      );
      console.log('✅ 成功添加 created_by 字段');
    } else {
      console.log('✅ created_by 字段已存在');
    }

    // 檢查是否有現有商品，將它們分配給 migrationActor（如果還沒有 created_by）
    const [existingProducts] = await conn.execute(
      'SELECT id, name FROM products WHERE created_by IS NULL'
    );

    if (existingProducts.length > 0) {
      console.log(`更新 ${existingProducts.length} 個現有商品的 created_by 字段為 '${migrationActor}'...`);
      await conn.execute(
        'UPDATE products SET created_by = ? WHERE created_by IS NULL',
        [migrationActor]
      );
      console.log('✅ 成功更新現有商品的 created_by 字段');
    } else {
      console.log('✅ 所有商品都已有 created_by 字段');
    }

  } catch (err) {
    console.error('遷移失敗:', err);
  } finally {
    if (conn) await conn.end();
  }
}

migrateProductsTable().then(() => {
  console.log('遷移完成');
  process.exit(0);
}).catch(err => {
  console.error('遷移錯誤:', err);
  process.exit(1);
});
