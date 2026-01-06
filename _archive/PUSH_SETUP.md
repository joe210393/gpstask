# 推送通知設定指南

## 📋 前置需求

推送通知功能需要 VAPID（Voluntary Application Server Identification）金鑰對。

## 🔑 生成 VAPID 金鑰

### 方法 1：使用 npm 命令（推薦）

```bash
npx web-push generate-vapid-keys
```

這會輸出類似以下的內容：

```
Public Key:
BElGCi8xS2lY1JR2bFNFQ2xE1iRntsV...

Private Key:
4K2tM8clPAdBrlUJvR7_9x3tY1nR5sT...

```

### 方法 2：使用 Node.js 腳本

創建一個臨時文件 `generate-vapid.js`：

```javascript
const webpush = require('web-push');
const vapidKeys = webpush.generateVAPIDKeys();

console.log('Public Key:');
console.log(vapidKeys.publicKey);
console.log('\nPrivate Key:');
console.log(vapidKeys.privateKey);
```

然後運行：

```bash
node generate-vapid.js
```

## ⚙️ 設定環境變數

將生成的 VAPID 金鑰設定為環境變數：

### Zeabur 環境

在 Zeabur Dashboard 的環境變數設定中添加：

```
VAPID_PUBLIC_KEY=你的公鑰
VAPID_PRIVATE_KEY=你的私鑰
VAPID_SUBJECT=mailto:your-email@example.com
```

### 本地開發環境

創建或更新 `.env` 文件：

```env
VAPID_PUBLIC_KEY=你的公鑰
VAPID_PRIVATE_KEY=你的私鑰
VAPID_SUBJECT=mailto:your-email@example.com
```

**注意**：`VAPID_SUBJECT` 應該是有效的郵件地址格式（`mailto:` 開頭），用於識別推送服務的發送者。

## ✅ 驗證設定

1. 啟動伺服器後，檢查控制台是否顯示：
   ```
   ✅ Web Push (VAPID) 已初始化
   ```

2. 如果看到警告訊息：
   ```
   ⚠️  警告: 未設定 VAPID 金鑰，推送通知功能將無法使用
   ```
   請確認環境變數已正確設定。

3. 訪問 `/api/push/vapid-public-key` 端點，應該返回公鑰：
   ```json
   {
     "success": true,
     "publicKey": "BElGCi8xS2lY1JR2bFNFQ2xE1iRntsV..."
   }
   ```

## 🧪 測試推送通知

1. **用戶訂閱**：
   - 用戶登入後，系統會自動嘗試訂閱推送通知
   - 瀏覽器會彈出權限請求，用戶需要點擊「允許」

2. **觸發推送**：
   - 完成任務時，系統會自動發送推送通知
   - 推送內容包含任務名稱、獲得的道具、稱號等資訊

3. **查看推送**：
   - 即使瀏覽器關閉，推送通知也會顯示（取決於瀏覽器設定）
   - 點擊通知會自動打開對應的任務詳情頁

## 🔍 故障排除

### 問題：推送通知沒有收到

1. **檢查 VAPID 金鑰**：
   - 確認環境變數已正確設定
   - 確認伺服器已重新啟動

2. **檢查用戶訂閱狀態**：
   - 查看瀏覽器控制台是否有錯誤訊息
   - 確認用戶已授予通知權限

3. **檢查資料庫**：
   - 確認 `push_subscriptions` 表已建立
   - 檢查是否有該用戶的訂閱記錄

### 問題：推送訂閱失敗

1. **檢查 HTTPS**：
   - 推送通知需要 HTTPS（本地開發可以使用 `localhost`）

2. **檢查 Service Worker**：
   - 確認 `sw.js` 已正確註冊
   - 查看 DevTools > Application > Service Workers

3. **檢查瀏覽器支援**：
   - Chrome/Edge：完全支援
   - Firefox：完全支援
   - Safari：iOS 16.4+ 支援

## 📝 API 端點說明

### GET `/api/push/vapid-public-key`
獲取 VAPID 公鑰（前端訂閱時需要）

**回應**：
```json
{
  "success": true,
  "publicKey": "BElGCi8xS2lY1JR2bFNFQ2xE1iRntsV..."
}
```

### POST `/api/push/subscribe`
訂閱推送通知（需要登入）

**請求體**：
```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/...",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}
```

### POST `/api/push/unsubscribe`
取消推送訂閱（需要登入）

**請求體**：
```json
{
  "endpoint": "https://fcm.googleapis.com/..."
}
```

## 🎯 推送通知觸發時機

目前系統會在以下情況自動發送推送通知：

1. **任務完成**：
   - 標題：`✅ 任務完成！`
   - 內容：任務名稱、獲得的道具

2. **劇情線完成**：
   - 標題：`🎉 劇情線完成！`
   - 內容：任務名稱、獲得的稱號、額外積分

## 🔐 安全性注意事項

1. **私鑰保護**：
   - ⚠️ **絕對不要**將 `VAPID_PRIVATE_KEY` 提交到 Git
   - 確保 `.env` 文件在 `.gitignore` 中

2. **HTTPS 要求**：
   - 生產環境必須使用 HTTPS
   - 本地開發可以使用 `localhost`

3. **用戶隱私**：
   - 推送訂閱資訊存儲在資料庫中
   - 用戶可以隨時取消訂閱

