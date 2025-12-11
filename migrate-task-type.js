require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USERNAME || 'root',
  password: process.env.MYSQL_ROOT_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'zeabur',
  port: process.env.MYSQL_PORT || 3306
};

async function migrate() {
  let connection;
  try {
    console.log('🔄 開始資料庫升級：修改 task_type 欄位...');
    
    connection = await mysql.createConnection(dbConfig);

    // 修改 task_type 欄位定義，將 ENUM 改為 VARCHAR 以支援更多類型
    // 注意：在 MySQL 中，修改欄位類型通常使用 MODIFY COLUMN
    await connection.execute(`
      ALTER TABLE tasks 
      MODIFY COLUMN task_type VARCHAR(50) NOT NULL DEFAULT 'qa'
    `);
    
    console.log('✅ task_type 欄位已改為 VARCHAR(50)');

    console.log('🎉 資料庫升級完成！');

  } catch (error) {
    console.error('❌ 升級失敗:', error);
  } finally {
    if (connection) await connection.end();
  }
}

migrate();
