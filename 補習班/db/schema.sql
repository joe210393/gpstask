-- 資料庫 Schema（繁體中文註解）
-- 用途：全新環境一次建立所有資料表（InnoDB / utf8mb4）
-- 使用方式：
--  1) 於 MySQL CLI 或 phpMyAdmin 執行此檔
--  2) 如已存在相同資料表，MySQL 會忽略 CREATE TABLE IF NOT EXISTS

SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS site_cms
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE site_cms;

-- 後台使用者
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE,
  password_hash VARCHAR(191) NOT NULL,
  role ENUM('admin','editor') DEFAULT 'admin',
  must_change_password TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 站台設定（key-value）
CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  `key` VARCHAR(100) UNIQUE,
  `value` TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 導覽選單
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

-- 單一頁面（含關於頁）
CREATE TABLE IF NOT EXISTS pages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  slug VARCHAR(100) UNIQUE,
  title VARCHAR(150),
  content_html MEDIUMTEXT,
  background_image_id INT NULL,
  is_published TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 部落格文章
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

-- 最新消息
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

-- 傳奇榜（文章型）
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

-- 課程方案（含文章欄位）
CREATE TABLE IF NOT EXISTS plans (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120),
  price DECIMAL(10,2),
  tagline VARCHAR(150) NULL,
  features_json JSON,
  is_active TINYINT(1) DEFAULT 1,
  title VARCHAR(150) NULL,
  slug VARCHAR(150) UNIQUE NULL,
  excerpt TEXT NULL,
  content_html MEDIUMTEXT NULL,
  cover_media_id INT NULL,
  published_at DATETIME NULL,
  is_published TINYINT(1) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 課程試讀
CREATE TABLE IF NOT EXISTS trial_contents (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(150),
  type ENUM('video','article'),
  content_html MEDIUMTEXT NULL,
  video_url VARCHAR(255) NULL,
  is_public TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 聯絡表單
CREATE TABLE IF NOT EXISTS contacts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100),
  email VARCHAR(150),
  phone VARCHAR(30),
  message TEXT,
  created_at DATETIME,
  processed TINYINT(1) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 媒體庫
CREATE TABLE IF NOT EXISTS media (
  id INT PRIMARY KEY AUTO_INCREMENT,
  file_name VARCHAR(191),
  file_path VARCHAR(255),
  mime_type VARCHAR(100),
  file_size INT,
  alt_text VARCHAR(150) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 會員
CREATE TABLE IF NOT EXISTS members (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(191) UNIQUE,
  username VARCHAR(191) UNIQUE NULL,
  password_hash VARCHAR(191),
  name VARCHAR(150) NULL,
  chinese_name VARCHAR(150) NULL,
  english_name VARCHAR(150) NULL,
  gender ENUM('male','female','other') NULL,
  birth_date DATE NULL,
  id_number VARCHAR(50) NULL,
  passport_number VARCHAR(50) NULL,
  phone_mobile VARCHAR(30) NULL,
  phone_landline VARCHAR(30) NULL,
  address VARCHAR(255) NULL,
  line_id VARCHAR(100) NULL,
  wechat_id VARCHAR(100) NULL,
  special_needs TEXT NULL,
  referrer VARCHAR(150) NULL,
  password_hint_question VARCHAR(255) NULL,
  password_hint_answer_hash VARCHAR(191) NULL,
  tier ENUM('free','basic','advanced','platinum') DEFAULT 'free',
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 首頁輪播
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

-- 上課內容（YouTube 連結）
CREATE TABLE IF NOT EXISTS course_contents (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(150) NOT NULL,
  video_url VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT 'general',
  min_tier ENUM('free','basic','advanced','platinum') DEFAULT 'free',
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 上課教材（媒體檔案）
CREATE TABLE IF NOT EXISTS course_materials (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(150) NOT NULL,
  media_id INT NOT NULL,
  min_tier ENUM('free','basic','advanced','platinum') DEFAULT 'free',
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX(media_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 預設關於頁（若尚無資料時可執行）
INSERT IGNORE INTO pages(slug, title, content_html, background_image_id, is_published)
VALUES
 ('about-teacher','關於院長','',NULL,1),
 ('about-us','關於我們','',NULL,1),
 ('about-ftmo','關於 FTMO','',NULL,1);


