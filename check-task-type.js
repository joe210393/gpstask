const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

(async () => {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    console.log('Connected to DB');

    // Check table structure
    const [columns] = await conn.execute("SHOW COLUMNS FROM tasks LIKE 'task_type'");
    console.log('Task Type Column:', columns);

    // Check specific task data
    const [rows] = await conn.execute('SELECT id, name, task_type FROM tasks ORDER BY id DESC LIMIT 5');
    console.log('Recent Tasks:', rows);

  } catch (err) {
    console.error(err);
  } finally {
    if (conn) await conn.end();
  }
})();
