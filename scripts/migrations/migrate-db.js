const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let conn;
  try {
    console.log('連接到資料庫...');
    conn = await mysql.createConnection(dbConfig);

    // 檢查 points 字段是否存在
    console.log('檢查 points 字段...');
    const [pointsCheck] = await conn.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `, [dbConfig.database, 'tasks', 'points']);

    if (pointsCheck.length === 0) {
      console.log('添加 points 字段...');
      await conn.execute('ALTER TABLE tasks ADD COLUMN points INT NOT NULL DEFAULT 0');
      console.log('✓ points 字段添加成功');
    } else {
      console.log('✓ points 字段已存在');
    }

    // 檢查 youtubeUrl 字段是否存在
    console.log('檢查 youtubeUrl 字段...');
    const [youtubeCheck] = await conn.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `, [dbConfig.database, 'tasks', 'youtubeUrl']);

    if (youtubeCheck.length === 0) {
      console.log('添加 youtubeUrl 字段...');
      await conn.execute('ALTER TABLE tasks ADD COLUMN youtubeUrl VARCHAR(500) NULL');
      console.log('✓ youtubeUrl 字段添加成功');
    } else {
      console.log('✓ youtubeUrl 字段已存在');
    }

    console.log('✅ 資料庫遷移完成！');
    console.log('現在您可以正常使用積分功能了。');

  } catch (error) {
    console.error('❌ 遷移失敗:', error.message);
  } finally {
    if (conn) await conn.end();
  }
}

migrate();
