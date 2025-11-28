const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'hkg1.clusters.zeabur.com',
  user: process.env.MYSQL_USERNAME || 'root',
  password: process.env.MYSQL_ROOT_PASSWORD || '5Ob7dxupaEePK684MzLylS9g10Gs2kN3',
  database: process.env.MYSQL_DATABASE || 'zeabur',
  port: process.env.MYSQL_PORT || 30586,
  charset: 'utf8mb4'
};

async function initDatabase() {
  let connection;

  try {
    console.log('Connecting to Zeabur MySQL...');
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected successfully!');

    // Read and execute seed.sql
    const fs = require('fs');
    const sql = fs.readFileSync('./server/seed.sql', 'utf8');

    // Split SQL commands and execute them
    const commands = sql.split(';').filter(cmd => cmd.trim().length > 0);

    for (const command of commands) {
      if (command.trim()) {
        console.log('Executing:', command.substring(0, 50) + '...');
        await connection.query(command);
      }
    }

    console.log('Database initialized successfully!');

  } catch (error) {
    console.error('Database initialization failed:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

initDatabase();
