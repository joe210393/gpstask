import 'dotenv/config';
import bcrypt from 'bcrypt';
import { query } from '../config/db.js';

// 工具：若資料表缺少欄位則新增（可重複執行）
async function addColumnIfMissing(tableName, columnName, alterSql) {
  const rows = await query(
    'SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [tableName, columnName]
  );
  if ((rows?.[0]?.cnt || 0) === 0) {
    await query(alterSql);
  }
}

async function main() {
  // 建立必備資料表（若不存在）
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(50) UNIQUE,
      password_hash VARCHAR(191),
      role ENUM('admin','editor') DEFAULT 'admin',
      must_change_password TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 若舊表已存在，確保欄位存在（補齊）
  await addColumnIfMissing(
    'users',
    'must_change_password',
    'ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) DEFAULT 0'
  );

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      ` + '`key`' + ` VARCHAR(100) UNIQUE,
      ` + '`value`' + ` TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS menus (
      id INT PRIMARY KEY AUTO_INCREMENT,
      parent_id INT NULL,
      title VARCHAR(100),
      slug VARCHAR(100),
      url VARCHAR(255),
      order_index INT,
      visible TINYINT(1) DEFAULT 1,
      INDEX(parent_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS pages (
      id INT PRIMARY KEY AUTO_INCREMENT,
      slug VARCHAR(100) UNIQUE,
      title VARCHAR(150),
      content_html MEDIUMTEXT,
      background_image_id INT NULL,
      is_published TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 預設建立三個關於頁面（若尚未存在）
  await query('INSERT IGNORE INTO pages(slug, title, content_html, background_image_id, is_published) VALUES (?,?,?,?,1)', ['about-teacher', '關於院長', '', null]);
  await query('INSERT IGNORE INTO pages(slug, title, content_html, background_image_id, is_published) VALUES (?,?,?,?,1)', ['about-us', '關於我們', '', null]);
  await query('INSERT IGNORE INTO pages(slug, title, content_html, background_image_id, is_published) VALUES (?,?,?,?,1)', ['about-ftmo', '關於 FTMO', '', null]);

  await query(`
    CREATE TABLE IF NOT EXISTS posts (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(150),
      slug VARCHAR(150) UNIQUE,
      excerpt TEXT,
      content_html MEDIUMTEXT,
      cover_media_id INT NULL,
      published_at DATETIME NULL,
      is_published TINYINT(1) DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS news (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(150),
      slug VARCHAR(150) UNIQUE,
      content_html MEDIUMTEXT,
      excerpt TEXT NULL,
      cover_media_id INT NULL,
      published_at DATETIME NULL,
      is_published TINYINT(1) DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // news 表補齊新欄位（相容舊資料庫）
  await addColumnIfMissing(
    'news',
    'excerpt',
    'ALTER TABLE news ADD COLUMN excerpt TEXT NULL'
  );
  await addColumnIfMissing(
    'news',
    'cover_media_id',
    'ALTER TABLE news ADD COLUMN cover_media_id INT NULL'
  );

  await query(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(150),
      slug VARCHAR(150) UNIQUE,
      excerpt TEXT,
      content_html MEDIUMTEXT,
      cover_media_id INT NULL,
      published_at DATETIME NULL,
      is_published TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // leaderboard 表補齊新欄位（相容舊資料庫）
  await addColumnIfMissing(
    'leaderboard',
    'slug',
    'ALTER TABLE leaderboard ADD COLUMN slug VARCHAR(150) UNIQUE'
  );
  await addColumnIfMissing(
    'leaderboard',
    'excerpt',
    'ALTER TABLE leaderboard ADD COLUMN excerpt TEXT'
  );
  await addColumnIfMissing(
    'leaderboard',
    'content_html',
    'ALTER TABLE leaderboard ADD COLUMN content_html MEDIUMTEXT'
  );
  await addColumnIfMissing(
    'leaderboard',
    'cover_media_id',
    'ALTER TABLE leaderboard ADD COLUMN cover_media_id INT NULL'
  );
  await addColumnIfMissing(
    'leaderboard',
    'published_at',
    'ALTER TABLE leaderboard ADD COLUMN published_at DATETIME NULL'
  );
  await addColumnIfMissing(
    'leaderboard',
    'is_published',
    'ALTER TABLE leaderboard ADD COLUMN is_published TINYINT(1) DEFAULT 1'
  );

  await query(`
    CREATE TABLE IF NOT EXISTS plans (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(120),
      price DECIMAL(10,2),
      tagline VARCHAR(150) NULL,
      features_json JSON,
      is_active TINYINT(1) DEFAULT 1,
      -- Blog-like fields for plans content
      title VARCHAR(150) NULL,
      slug VARCHAR(150) UNIQUE NULL,
      excerpt TEXT NULL,
      content_html MEDIUMTEXT NULL,
      cover_media_id INT NULL,
      published_at DATETIME NULL,
      is_published TINYINT(1) DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // plans 表補齊文章欄位（相容舊資料庫）
  await addColumnIfMissing(
    'plans',
    'title',
    'ALTER TABLE plans ADD COLUMN title VARCHAR(150) NULL'
  );
  await addColumnIfMissing(
    'plans',
    'slug',
    'ALTER TABLE plans ADD COLUMN slug VARCHAR(150) UNIQUE NULL'
  );
  await addColumnIfMissing(
    'plans',
    'excerpt',
    'ALTER TABLE plans ADD COLUMN excerpt TEXT NULL'
  );
  await addColumnIfMissing(
    'plans',
    'content_html',
    'ALTER TABLE plans ADD COLUMN content_html MEDIUMTEXT NULL'
  );
  await addColumnIfMissing(
    'plans',
    'cover_media_id',
    'ALTER TABLE plans ADD COLUMN cover_media_id INT NULL'
  );
  await addColumnIfMissing(
    'plans',
    'published_at',
    'ALTER TABLE plans ADD COLUMN published_at DATETIME NULL'
  );
  await addColumnIfMissing(
    'plans',
    'is_published',
    'ALTER TABLE plans ADD COLUMN is_published TINYINT(1) DEFAULT 0'
  );

  await query(`
    CREATE TABLE IF NOT EXISTS trial_contents (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(150),
      type ENUM('video','article'),
      content_html MEDIUMTEXT NULL,
      video_url VARCHAR(255) NULL,
      is_public TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(150),
      slug VARCHAR(150) UNIQUE,
      excerpt TEXT,
      content_html MEDIUMTEXT,
      video_url VARCHAR(255) NULL,
      cover_media_id INT NULL,
      published_at DATETIME NULL,
      is_published TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(100),
      email VARCHAR(150),
      phone VARCHAR(30),
      message TEXT,
      created_at DATETIME,
      processed TINYINT(1) DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS media (
      id INT PRIMARY KEY AUTO_INCREMENT,
      file_name VARCHAR(191),
      file_path VARCHAR(255),
      mime_type VARCHAR(100),
      file_size INT,
      alt_text VARCHAR(150) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Members for site registration/login
  await query(`
    CREATE TABLE IF NOT EXISTS members (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(191) UNIQUE,
      password_hash VARCHAR(191),
      name VARCHAR(150) NULL,
      tier ENUM('free','basic','advanced','platinum') DEFAULT 'free',
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Add extended profile columns (idempotent)
  await addColumnIfMissing('members','username',"ALTER TABLE members ADD COLUMN username VARCHAR(191) UNIQUE NULL");
  // Ensure unique indexes exist (idempotent, MySQL without IF NOT EXISTS)
  await query("CREATE UNIQUE INDEX idx_members_email ON members(email)").catch(()=>{});
  await query("CREATE UNIQUE INDEX idx_members_username ON members(username)").catch(()=>{});
  await addColumnIfMissing('members','chinese_name',"ALTER TABLE members ADD COLUMN chinese_name VARCHAR(150) NULL");
  await addColumnIfMissing('members','english_name',"ALTER TABLE members ADD COLUMN english_name VARCHAR(150) NULL");
  await addColumnIfMissing('members','gender',"ALTER TABLE members ADD COLUMN gender ENUM('male','female','other') NULL");
  await addColumnIfMissing('members','birth_date',"ALTER TABLE members ADD COLUMN birth_date DATE NULL");
  await addColumnIfMissing('members','id_number',"ALTER TABLE members ADD COLUMN id_number VARCHAR(50) NULL");
  await addColumnIfMissing('members','passport_number',"ALTER TABLE members ADD COLUMN passport_number VARCHAR(50) NULL");
  await addColumnIfMissing('members','phone_mobile',"ALTER TABLE members ADD COLUMN phone_mobile VARCHAR(30) NULL");
  await addColumnIfMissing('members','phone_landline',"ALTER TABLE members ADD COLUMN phone_landline VARCHAR(30) NULL");
  await addColumnIfMissing('members','address',"ALTER TABLE members ADD COLUMN address VARCHAR(255) NULL");
  await addColumnIfMissing('members','line_id',"ALTER TABLE members ADD COLUMN line_id VARCHAR(100) NULL");
  await addColumnIfMissing('members','wechat_id',"ALTER TABLE members ADD COLUMN wechat_id VARCHAR(100) NULL");
  await addColumnIfMissing('members','special_needs',"ALTER TABLE members ADD COLUMN special_needs TEXT NULL");
  await addColumnIfMissing('members','referrer',"ALTER TABLE members ADD COLUMN referrer VARCHAR(150) NULL");
  await addColumnIfMissing('members','password_hint_question',"ALTER TABLE members ADD COLUMN password_hint_question VARCHAR(255) NULL");
  await addColumnIfMissing('members','password_hint_answer_hash',"ALTER TABLE members ADD COLUMN password_hint_answer_hash VARCHAR(191) NULL");

  await query(`
    CREATE TABLE IF NOT EXISTS slides (
      id INT PRIMARY KEY AUTO_INCREMENT,
      media_id INT NOT NULL,
      title VARCHAR(150) NULL,
      link_url VARCHAR(255) NULL,
      order_index INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX(order_index),
      INDEX(is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Course contents (YouTube links) with tier access
  await query(`
    CREATE TABLE IF NOT EXISTS course_contents (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(150) NOT NULL,
      video_url VARCHAR(255) NOT NULL,
      category VARCHAR(100) DEFAULT 'general',
      min_tier ENUM('free','basic','advanced','platinum') DEFAULT 'free',
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 課程內容表補齊類別欄位（相容舊資料庫）
  await addColumnIfMissing('course_contents','category',"ALTER TABLE course_contents ADD COLUMN category VARCHAR(100) DEFAULT 'general'");

  // Course materials (downloadable files via media library) with tier access
  await query(`
    CREATE TABLE IF NOT EXISTS course_materials (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(150) NOT NULL,
      media_id INT NOT NULL,
      min_tier ENUM('free','basic','advanced','platinum') DEFAULT 'free',
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX(media_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 預設建立 admin/admin（僅初次）並寫入基本設定
  const existing = await query('SELECT id FROM users WHERE username = ? LIMIT 1', ['admin']);
  if (existing.length === 0) {
    const hash = await bcrypt.hash('admin', 10);
    await query('INSERT INTO users(username, password_hash, role, must_change_password) VALUES (?,?,\'admin\',1)', ['admin', hash]);
    // basic defaults
    await query('INSERT IGNORE INTO settings(`key`,`value`) VALUES (?,?), (?,?), (?,?), (?,?)', [
      'site_name', 'My Site',
      'line_url', process.env.LINE_OFFICIAL_ACCOUNT_URL || '',
      'default_bg_color', '#f7f7f7',
      'theme', 'default'
    ]);
  }
  // eslint-disable-next-line no-console
  console.log('Seed completed');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });


