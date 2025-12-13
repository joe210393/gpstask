const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let conn;
  try {
    console.log('🔄 開始執行商品系統修復腳本...');
    conn = await mysql.createConnection(dbConfig);

    // 1. 檢查並新增 products.is_active
    const [productsCols] = await conn.query("SHOW COLUMNS FROM products LIKE 'is_active'");
    if (productsCols.length === 0) {
      console.log('🛠 新增 products.is_active 欄位...');
      await conn.query("ALTER TABLE products ADD COLUMN is_active BOOLEAN DEFAULT TRUE");
      console.log('✅ products.is_active 新增完成');
    } else {
      console.log('ℹ️ products.is_active 已存在，跳過');
    }

    // 2. 建立 product_redemptions 表格
    console.log('💰 檢查/建立 product_redemptions 表格...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS product_redemptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        product_id INT NOT NULL,
        points_used INT NOT NULL,
        status ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending',
        notes TEXT,
        redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ product_redemptions 表格準備就緒');

    console.log('🎉 商品系統資料庫修復完成！');

  } catch (err) {
    console.error('❌ 資料庫修復失敗:', err);
  } finally {
    if (conn) await conn.end();
  }
}

migrate();

