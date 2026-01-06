const mysql = require('mysql2/promise');
const { getDbConfig } = require('../../db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let conn;
  try {
    console.log('🔄 開始執行劇情結局關卡遷移...');
    conn = await mysql.createConnection(dbConfig);

    // 檢查並新增 tasks.is_final_step
    const [tasksCols] = await conn.query("SHOW COLUMNS FROM tasks LIKE 'is_final_step'");
    if (tasksCols.length === 0) {
      console.log('🛠 新增 tasks.is_final_step 欄位...');
      await conn.query("ALTER TABLE tasks ADD COLUMN is_final_step BOOLEAN DEFAULT FALSE COMMENT '是否為劇情任務的結局關卡'");
      console.log('✅ tasks.is_final_step 新增完成');
    } else {
      console.log('ℹ️ tasks.is_final_step 已存在，跳過');
    }

    console.log('🎉 劇情結局關卡遷移完成！');

  } catch (err) {
    console.error('❌ 資料庫遷移失敗:', err);
  } finally {
    if (conn) await conn.end();
  }
}

migrate();

