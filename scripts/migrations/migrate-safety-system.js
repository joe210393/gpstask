const mysql = require('mysql2/promise');
const { getDbConfig } = require('../../db-config');

const dbConfig = getDbConfig();

async function migrate() {
  let connection;
  try {
    console.log('🔄 安全設施 / SOS 系統資料表...');
    connection = await mysql.createConnection(dbConfig);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS safety_facilities (
        id INT AUTO_INCREMENT PRIMARY KEY,
        facility_type ENUM('medical','water','supply') NOT NULL,
        name VARCHAR(100) NOT NULL,
        lat DOUBLE NOT NULL,
        lng DOUBLE NOT NULL,
        description TEXT,
        supplies JSON NULL,
        open_hours VARCHAR(255) NULL,
        notes TEXT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_by VARCHAR(50) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_facility_type_active (facility_type, is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS safety_settings (
        id INT PRIMARY KEY DEFAULT 1,
        sos_enabled TINYINT(1) NOT NULL DEFAULT 1,
        emergency_phone VARCHAR(30) NULL,
        sos_instructions TEXT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        updated_by VARCHAR(50) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [settingsRows] = await connection.execute('SELECT id FROM safety_settings WHERE id = 1');
    if (settingsRows.length === 0) {
      await connection.execute(
        `INSERT INTO safety_settings (id, sos_enabled, emergency_phone, sos_instructions)
         VALUES (1, 1, NULL, '長按 SOS 按鈕 3 秒後，可撥打 119 或活動緊急專線。')`
      );
    }

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_emergency_contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(50) NULL,
        phone VARCHAR(30) NOT NULL,
        sort_order TINYINT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_contact_order (user_id, sort_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS sos_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        username VARCHAR(50) NOT NULL,
        lat DOUBLE NULL,
        lng DOUBLE NULL,
        location_accuracy DOUBLE NULL,
        location_status ENUM('success','failed','denied') NOT NULL DEFAULT 'failed',
        emergency_contacts_snapshot JSON NULL,
        status ENUM('pending','handling','resolved') NOT NULL DEFAULT 'pending',
        handled_by VARCHAR(50) NULL,
        handled_at TIMESTAMP NULL,
        admin_notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_sos_status_created (status, created_at DESC),
        INDEX idx_sos_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('✅ 安全設施 / SOS 資料表就緒');
  } catch (err) {
    console.error('❌ migrate-safety-system 失敗:', err.message);
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end();
  }
}

migrate();
