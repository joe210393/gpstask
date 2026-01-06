const mysql = require('mysql2/promise');
const { getDbConfig } = require('../../db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let conn;
  try {
    console.log('🔄 開始執行道具系統遷移...');
    conn = await mysql.createConnection(dbConfig);

    // 1. 建立 items 表格
    console.log('📦 檢查/建立 items 表格...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        image_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. 建立 user_inventory 表格
    console.log('🎒 檢查/建立 user_inventory 表格...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_inventory (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        item_id INT NOT NULL,
        quantity INT DEFAULT 1,
        obtained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      )
    `);

    // 3. 修改 tasks 表格
    console.log('🔧 修改 tasks 表格 (增加 required_item_id, reward_item_id)...');
    
    // 檢查欄位是否存在，避免重複報錯
    const [cols] = await conn.execute("SHOW COLUMNS FROM tasks LIKE 'required_item_id'");
    if (cols.length === 0) {
      await conn.execute(`
        ALTER TABLE tasks
        ADD COLUMN required_item_id INT NULL COMMENT '解鎖此任務需要的道具',
        ADD COLUMN reward_item_id INT NULL COMMENT '完成此任務獲得的道具',
        ADD FOREIGN KEY (required_item_id) REFERENCES items(id) ON DELETE SET NULL,
        ADD FOREIGN KEY (reward_item_id) REFERENCES items(id) ON DELETE SET NULL
      `);
      console.log('✅ tasks 表格欄位新增完成');
    } else {
      console.log('ℹ️ tasks 表格欄位已存在，跳過');
    }

    console.log('🎉 道具系統資料庫遷移完成！');

  } catch (err) {
    console.error('❌ Migration 失敗:', err);
    // process.exit(1); // 移除這行，允許後續腳本繼續執行
  } finally {
    if (conn) await conn.end();
  }
}

migrate();

