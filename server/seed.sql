-- 建立資料庫
CREATE DATABASE IF NOT EXISTS zeabur DEFAULT CHARACTER SET utf8mb4;
USE zeabur;
SET NAMES utf8mb4;

-- 建立 users 資料表
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NULL,
  role ENUM('user', 'staff', 'admin') NOT NULL
);

-- 建立 tasks 資料表
CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  radius INT NOT NULL,
  points INT NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  photoUrl VARCHAR(255) NOT NULL,
  iconUrl VARCHAR(255) NOT NULL DEFAULT '/images/flag-red.png',
  youtubeUrl VARCHAR(500) NULL,
  created_by VARCHAR(100), -- 記錄創建此任務的工作人員帳號
  task_type ENUM('qa', 'multiple_choice', 'photo') NOT NULL DEFAULT 'qa',
  options JSON NULL,
  correct_answer VARCHAR(255) NULL
);

-- 建立 products 資料表（兌換商品）
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  image_url VARCHAR(255),
  points_required INT NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR(100), -- 記錄創建此商品的工作人員帳號
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 建立 product_redemptions 資料表（商品兌換記錄）
CREATE TABLE IF NOT EXISTS product_redemptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  points_used INT NOT NULL,
  redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status ENUM('pending', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- 建立 point_transactions 資料表（積分交易記錄）
CREATE TABLE IF NOT EXISTS point_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('earned', 'spent') NOT NULL,
  points INT NOT NULL,
  description VARCHAR(255),
  reference_type ENUM('task_completion', 'product_redemption', 'redemption_cancelled') NOT NULL,
  reference_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 插入測試帳號（密碼已 bcrypt hash）
INSERT IGNORE INTO users (username, password, role) VALUES
('user1', '$2a$10$wQv8QwQwQwQwQwQwQwQwQeQwQwQwQwQwQwQwQwQwQwQwQwQwQwQw', 'user'), -- 密碼: user123
('user2', '$2a$10$wQv8QwQwQwQwQwQwQwQwQeQwQwQwQwQwQwQwQwQwQwQwQwQw', 'user'), -- 密碼: user123
('staff1', '$2a$10$wQv8QwQwQwQwQwQwQwQwQeQwQwQwQwQwQwQwQwQwQwQwQwQw', 'staff'), -- 密碼: user123
('staff2', '$2a$10$wQv8QwQwQwQwQwQwQwQwQeQwQwQwQwQwQwQwQwQwQwQwQwQw', 'staff'); -- 密碼: user123

-- 插入 admin 帳號（密碼: admin，bcrypt hash）
INSERT IGNORE INTO users (username, password, role) VALUES
('admin', '$2b$10$qlLJ615JyK/cJrG3DaSxduwEoE55cIT/.6npuRsBMgIvozJAQXxGO', 'admin');

-- 注意：資料庫結構已在上面的 CREATE TABLE 語句中定義完成
-- 如需遷移，請參考專門的遷移腳本

-- 插入測試商品
INSERT IGNORE INTO products (name, description, image_url, points_required, stock) VALUES
('星巴克咖啡券', '星巴克中杯咖啡飲品兌換券', '/images/feature-reward.png', 50, 100),
('麥當勞優惠券', '麥當勞大麥克套餐兌換券', '/images/mascot.png', 80, 50),
('7-11購物金', '7-11 $100 購物金', '/images/feature-community.png', 100, 200),
('誠品書店購書券', '誠品書店 $200 購書券', '/images/feature-culture.png', 150, 30),
('健身房月卡', '健身房一個月會員卡', '/images/feature-map.png', 300, 20);

-- 建立 user_tasks 資料表（用戶任務記錄）
CREATE TABLE IF NOT EXISTS user_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  task_id INT NOT NULL,
  status ENUM('進行中', '完成', '放棄') NOT NULL DEFAULT '進行中',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  redeemed BOOLEAN DEFAULT FALSE,
  redeemed_at TIMESTAMP NULL,
  redeemed_by VARCHAR(100) NULL,
  answer TEXT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  UNIQUE KEY unique_user_task (user_id, task_id)
);

-- 建立 user_points 資料表（用戶積分）
CREATE TABLE IF NOT EXISTS user_points (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  total_points INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY unique_user_points (user_id)
);

-- 插入測試任務
INSERT IGNORE INTO tasks (name, lat, lng, radius, points, description, photoUrl, iconUrl, youtubeUrl) VALUES
('宜蘭傳藝園區', 24.7525, 121.7489, 100, 50, '探索宜蘭傳藝園區，體驗傳統文化之美', '/images/feature-culture.png', '/images/mascot.png', 'https://www.youtube.com/watch?v=example1'),
('台北101', 25.0330, 121.5654, 100, 75, '登上台北101觀景台，俯瞰台北市全景', '/images/feature-map.png', '/images/mascot.png', 'https://www.youtube.com/watch?v=example2'),
('台中夜市', 24.1477, 120.6736, 150, 60, '體驗台中最熱鬧的夜市文化', '/images/feature-community.png', '/images/mascot.png', 'https://www.youtube.com/watch?v=example3'),
('高雄夢時代', 22.5950, 120.3065, 120, 55, '參觀高雄最大的購物中心', '/images/feature-reward.png', '/images/mascot.png', 'https://www.youtube.com/watch?v=example4'),
('台南孔廟', 22.9927, 120.2042, 80, 45, '參觀台灣最古老的孔廟建築', '/images/feature-culture.png', '/images/mascot.png', 'https://www.youtube.com/watch?v=example5');

-- 建議實際使用時用 bcrypt 產生不同密碼 hash