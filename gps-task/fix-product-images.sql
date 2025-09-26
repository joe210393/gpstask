-- 修復商品圖片路徑腳本
-- 將不存在的圖片檔案替換為現有的圖片

USE zeabur;

-- 更新商品圖片路徑
UPDATE products SET image_url = '/images/feature-reward.png' WHERE image_url = '/images/starbucks.jpg';
UPDATE products SET image_url = '/images/mascot.png' WHERE image_url = '/images/mcdonalds.jpg';
UPDATE products SET image_url = '/images/feature-community.png' WHERE image_url = '/images/7eleven.jpg';
UPDATE products SET image_url = '/images/feature-culture.png' WHERE image_url = '/images/eslite.jpg';
UPDATE products SET image_url = '/images/feature-map.png' WHERE image_url = '/images/gym.jpg';

-- 檢查更新結果
SELECT id, name, image_url FROM products ORDER BY id;
