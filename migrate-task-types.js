const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'hkg1.clusters.zeabur.com',
  user: process.env.MYSQL_USERNAME || 'root',
  password: process.env.MYSQL_ROOT_PASSWORD || '5Ob7dxupaEePK684MzLylS9g10Gs2kN3',
  database: process.env.MYSQL_DATABASE || 'zeabur',
  port: process.env.MYSQL_PORT || 30586,
  charset: 'utf8mb4'
};

async function migrate() {
  let connection;
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected.');

    // Check if columns exist to avoid errors
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'task_type'
    `, [dbConfig.database]);

    if (columns.length > 0) {
      console.log('Columns already exist. Skipping migration.');
      return;
    }

    console.log('Adding new columns to tasks table...');
    
    // Add columns
    // task_type: qa (default), multiple_choice, photo
    // options: JSON for multiple choice options
    // correct_answer: string for correct option
    await connection.execute(`
      ALTER TABLE tasks
      ADD COLUMN task_type VARCHAR(20) NOT NULL DEFAULT 'qa' COMMENT 'qa, multiple_choice, photo',
      ADD COLUMN options JSON NULL COMMENT 'Options for multiple choice',
      ADD COLUMN correct_answer VARCHAR(255) NULL COMMENT 'Correct answer for multiple choice'
    `);

    console.log('Migration completed successfully.');

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    if (connection) await connection.end();
  }
}

migrate();

