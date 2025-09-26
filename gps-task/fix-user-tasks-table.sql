-- 修復 user_tasks 表格，添加缺少的欄位

USE zeabur;

-- 為現有的 user_tasks 表格添加缺少的欄位
ALTER TABLE user_tasks
ADD COLUMN redeemed BOOLEAN DEFAULT FALSE AFTER finished_at,
ADD COLUMN redeemed_at TIMESTAMP NULL AFTER redeemed,
ADD COLUMN redeemed_by VARCHAR(100) NULL AFTER redeemed_at,
ADD COLUMN answer TEXT NULL AFTER redeemed_by;

-- 檢查更新結果
DESCRIBE user_tasks;
