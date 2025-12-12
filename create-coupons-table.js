const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

async function createCouponsTable() {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    console.log('🔗 連接資料庫成功...');

    // 創建 user_coupons 表
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_coupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        coupon_code VARCHAR(50) NOT NULL UNIQUE,
        title VARCHAR(100) NOT NULL,
        description TEXT,
        discount_amount DECIMAL(10,2) DEFAULT 0,
        discount_percent DECIMAL(5,2) DEFAULT 0,
        expiry_date DATE NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        used_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ user_coupons 表創建成功');

    // 檢查是否已有測試數據
    const [existing] = await conn.execute('SELECT COUNT(*) as count FROM user_coupons');
    if (existing[0].count === 0) {
      console.log('📝 插入測試優惠券數據...');

      // 為現有用戶創建一些測試優惠券
      const [users] = await conn.execute('SELECT id, username FROM users LIMIT 3');

      for (const user of users) {
        const couponCode = 'TEST' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);

        await conn.execute(
          'INSERT INTO user_coupons (user_id, coupon_code, title, description, discount_amount, expiry_date) VALUES (?, ?, ?, ?, ?, ?)',
          [
            user.id,
            couponCode,
            `歡迎優惠券 - ${user.username}`,
            `歡迎 ${user.username} 加入我們的系統！`,
            10,
            expiryDate.toISOString().split('T')[0]
          ]
        );

        console.log(`✅ 為用戶 ${user.username} 創建測試優惠券: ${couponCode}`);
      }
    } else {
      console.log(`📋 已存在 ${existing[0].count} 個優惠券，跳過測試數據插入`);
    }

    console.log('\n🎉 優惠券系統設置完成！');

  } catch (err) {
    console.error('❌ 創建優惠券表失敗:', err);
  } finally {
    if (conn) await conn.end();
  }
}

createCouponsTable();
