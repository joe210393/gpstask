const mysql = require('mysql2/promise');
const { getDbConfig } = require('./db-config');

const dbConfig = getDbConfig();

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
