require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USERNAME || 'root',
  password: process.env.MYSQL_ROOT_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'gps_task_db',
  port: process.env.MYSQL_PORT || 3306
};

async function addArImageColumn() {
  let connection;
  try {
    console.log('正在連接資料庫...');
    connection = await mysql.createConnection(dbConfig);
    
    console.log('正在檢查 tasks 表格結構...');
    const [columns] = await connection.query(`SHOW COLUMNS FROM tasks LIKE 'ar_image_url'`);
    
    if (columns.length === 0) {
      console.log('正在新增 ar_image_url 欄位...');
      await connection.query(`
        ALTER TABLE tasks 
        ADD COLUMN ar_image_url VARCHAR(255) DEFAULT NULL AFTER photoUrl
      `);
      console.log('✅ ar_image_url 欄位新增成功！');
    } else {
      console.log('ℹ️ ar_image_url 欄位已存在，跳過。');
    }

  } catch (error) {
    console.error('❌ 發生錯誤:', error.message);
  } finally {
    if (connection) await connection.end();
  }
}

addArImageColumn();

