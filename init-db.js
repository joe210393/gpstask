const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

async function initDb() {
  let connection;
  try {
    console.log('🔄 開始初始化資料庫結構...');
    connection = await mysql.createConnection(dbConfig);

    // 1. 建立 users 表格
    console.log('📦 檢查/建立 users 表格...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255),
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. 建立 tasks 表格
    console.log('📦 檢查/建立 tasks 表格...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        lat DOUBLE NOT NULL,
        lng DOUBLE NOT NULL,
        radius INT DEFAULT 50,
        description TEXT,
        photoUrl VARCHAR(255),
        iconUrl VARCHAR(255),
        youtubeUrl VARCHAR(255),
        ar_image_url VARCHAR(255),
        points INT DEFAULT 10,
        task_type VARCHAR(50) DEFAULT 'qa',
        options JSON,
        correct_answer VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. 建立 user_tasks 表格 (記錄用戶完成的任務)
    console.log('📦 檢查/建立 user_tasks 表格...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        task_id INT NOT NULL,
        status VARCHAR(20) DEFAULT 'completed',
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      )
    `);

    // 4. 建立 products 表格 (兌換商品)
    console.log('📦 檢查/建立 products 表格...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        points_required INT NOT NULL,
        image_url VARCHAR(255),
        stock INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. 建立 redemptions 表格 (兌換紀錄)
    console.log('📦 檢查/建立 redemptions 表格...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS redemptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        product_id INT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    console.log('✅ 資料庫基礎結構初始化完成');

  } catch (err) {
    console.error('❌ 資料庫初始化失敗:', err);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

initDb();
