const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'hkg1.clusters.zeabur.com',
  user: process.env.MYSQL_USERNAME || 'root',
  password: process.env.MYSQL_ROOT_PASSWORD || '5Ob7dxupaEePK684MzLylS9g10Gs2kN3',
  database: process.env.MYSQL_DATABASE || 'zeabur',
  port: process.env.MYSQL_PORT || 30586,
  charset: 'utf8mb4'
};

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
