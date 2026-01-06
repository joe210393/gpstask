const mysql = require('mysql2/promise');
const { getDbConfig } = require('../../db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let conn;
  try {
    console.log('🔄 開始執行資料庫修復遷移...');
    conn = await mysql.createConnection(dbConfig);

    // 1. 修復 tasks 表格 (補上 created_by)
    console.log('🔧 檢查 tasks 表格...');
    const [taskCols] = await conn.execute("SHOW COLUMNS FROM tasks LIKE 'created_by'");
    if (taskCols.length === 0) {
      console.log('   ➕ 新增 created_by 欄位...');
      await conn.execute("ALTER TABLE tasks ADD COLUMN created_by VARCHAR(50) DEFAULT 'admin'");
    } else {
      console.log('   ℹ️ created_by 已存在');
    }

    // 2. 修復 user_tasks 表格 (補上 started_at, finished_at 等)
    console.log('🔧 檢查 user_tasks 表格...');
    
    const columnsToCheck = [
      { name: 'started_at', def: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
      { name: 'finished_at', def: 'TIMESTAMP NULL' },
      { name: 'redeemed', def: 'BOOLEAN DEFAULT FALSE' },
      { name: 'redeemed_at', def: 'TIMESTAMP NULL' },
      { name: 'redeemed_by', def: 'VARCHAR(50) NULL' },
      { name: 'answer', def: 'TEXT NULL' }
    ];

    for (const col of columnsToCheck) {
      const [cols] = await conn.execute(`SHOW COLUMNS FROM user_tasks LIKE '${col.name}'`);
      if (cols.length === 0) {
        console.log(`   ➕ 新增 ${col.name} 欄位...`);
        await conn.execute(`ALTER TABLE user_tasks ADD COLUMN ${col.name} ${col.def}`);
      } else {
        console.log(`   ℹ️ ${col.name} 已存在`);
      }
    }

    console.log('🎉 資料庫修復完成！');

  } catch (err) {
    console.error('❌ 修復失敗:', err);
    // 不拋出錯誤，讓系統嘗試啟動
  } finally {
    if (conn) await conn.end();
  }
}

migrate();

