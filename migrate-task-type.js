const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'hkg1.clusters.zeabur.com',
  user: process.env.MYSQL_USERNAME || 'root',
  password: process.env.MYSQL_ROOT_PASSWORD || '5N29BnfD0RbMw4Wd6y1iVPEgUI783voa',
  database: process.env.MYSQL_DATABASE || 'zeabur',
  port: process.env.MYSQL_PORT || 32121,
  charset: 'utf8mb4'
};

async function migrate() {
  let conn;
  try {
    console.log('連接到資料庫...');
    conn = await mysql.createConnection(dbConfig);
    console.log('資料庫連接成功！');

    // 檢查 task_type 字段
    console.log('檢查 task_type 字段...');
    const [typeCheck] = await conn.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `, [dbConfig.database, 'tasks', 'task_type']);

    if (typeCheck.length === 0) {
      console.log('添加 task_type 字段...');
      await conn.execute("ALTER TABLE tasks ADD COLUMN task_type ENUM('qa', 'multiple_choice', 'photo') NOT NULL DEFAULT 'qa'");
      console.log('✓ task_type 字段添加成功');
    } else {
      console.log('✓ task_type 字段已存在');
    }

    // 檢查 options 字段
    console.log('檢查 options 字段...');
    const [optionsCheck] = await conn.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `, [dbConfig.database, 'tasks', 'options']);

    if (optionsCheck.length === 0) {
      console.log('添加 options 字段...');
      await conn.execute('ALTER TABLE tasks ADD COLUMN options JSON NULL');
      console.log('✓ options 字段添加成功');
    } else {
      console.log('✓ options 字段已存在');
    }

    // 檢查 correct_answer 字段
    console.log('檢查 correct_answer 字段...');
    const [answerCheck] = await conn.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `, [dbConfig.database, 'tasks', 'correct_answer']);

    if (answerCheck.length === 0) {
      console.log('添加 correct_answer 字段...');
      await conn.execute('ALTER TABLE tasks ADD COLUMN correct_answer VARCHAR(255) NULL');
      console.log('✓ correct_answer 字段添加成功');
    } else {
      console.log('✓ correct_answer 字段已存在');
    }

    console.log('✅ 資料庫遷移完成！');

  } catch (error) {
    console.error('❌ 遷移失敗:', error.message);
  } finally {
    if (conn) await conn.end();
  }
}

migrate();

