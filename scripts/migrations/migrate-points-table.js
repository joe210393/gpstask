const mysql = require('mysql2/promise');
const { getDbConfig } = require('../../db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let conn;
  try {
    console.log('🔄 開始執行積分交易表格遷移...');
    conn = await mysql.createConnection(dbConfig);

    console.log('💰 檢查/建立 point_transactions 表格...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS point_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('earned', 'spent') NOT NULL COMMENT 'earned=獲得, spent=消費',
        points INT NOT NULL DEFAULT 0,
        description VARCHAR(255),
        reference_type VARCHAR(50) COMMENT '關聯來源 (task_completion, product_redemption)',
        reference_id INT COMMENT '關聯來源ID',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ point_transactions 表格準備就緒');

  } catch (err) {
    console.error('❌ Migration 失敗:', err);
    // 不拋出錯誤，讓系統嘗試啟動
  } finally {
    if (conn) await conn.end();
  }
}

migrate();
