# 🔍 安全審查報告回應與修復計劃

## 📋 問題確認與評估

### ✅ 確認屬實的問題（需要修復）

#### 1. User 角色 - API 缺少強制 JWT 認證 ⚠️ **高風險**

**問題描述**：
- `POST /api/user-tasks`、`PATCH /api/user-tasks/:id/answer`、`GET /api/user-tasks` 等 API 雖然有認證檢查，但允許使用 `x-username` header 作為備用方案
- 攻擊者可以偽造任何有效的手機號格式（`09xxxxxxxx`）來冒充其他用戶

**當前狀態**：
```javascript
// 優先使用 JWT 認證，如果沒有則嘗試從 header 獲取（兼容方案）
let username = req.user?.username;
if (!username) {
  const headerUsername = req.headers['x-username'];
  if (headerUsername && /^09\d{8}$/.test(headerUsername)) {
    username = headerUsername; // ⚠️ 可以被偽造
  }
}
```

**修復方案**：
- 強制使用 JWT 認證，移除 `x-username` header 備用方案
- 如果沒有 JWT，直接返回 401 錯誤
- **風險評估**：修復後不會損壞現有功能，因為前端已經使用 JWT cookie

---

#### 2. User 角色 - 快速登入設計漏洞 ⚠️ **中風險**

**問題描述**：
- 如果用戶設定了密碼，但前端沒有發送 `password` 參數，會跳過密碼驗證直接登入
- 這會導致有密碼保護的帳號失效

**當前狀態**：
```javascript
// 可選的密碼驗證：如果用戶提供了密碼且帳號有密碼，則驗證
if (password && user.password && user.password.trim() !== '') {
  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    return res.status(400).json({ success: false, message: '密碼錯誤' });
  }
}
// 如果沒有提供密碼或帳號沒有密碼，直接通過（符合快速登入設計）
```

**修復方案**：
- 如果帳號有密碼，必須提供並驗證密碼
- 只有當帳號沒有密碼時，才允許無密碼登入
- **風險評估**：修復後不會損壞現有功能，只是加強安全性

---

#### 3. Shop 角色 - 權限溢出 ⚠️ **中風險**

**問題描述**：
- `POST /api/user-tasks/:id/redeem` 允許 shop 核銷全部任務，不限制 `created_by`
- 這與一般商業邏輯（店家只能核銷自家的優惠券）相悖

**當前狀態**：
```javascript
// 新規則：shop 也可核銷全部任務（不限制 created_by）
```

**修復方案**：
- 如果這是設計需求（例如：所有店家可以互相核銷），則保留現狀
- 如果需要限制，則添加 `created_by` 檢查：shop 只能核銷自己創建的任務
- **風險評估**：需要確認業務需求，修復後可能影響現有流程

---

#### 4. 劇情任務刪除邏輯不完整 ⚠️ **低風險**

**問題描述**：
- 刪除 `quest_chains` 時，沒有清理 `point_transactions` 中的關聯紀錄
- `point_transactions.reference_type = 'quest_chain_completion'` 和 `reference_id = quest_chain_id` 會變成孤兒紀錄

**當前狀態**：
```javascript
// 先刪除用戶的劇情進度 (user_quests)
await conn.execute('DELETE FROM user_quests WHERE quest_chain_id = ?', [id]);
// 刪除劇情
await conn.execute('DELETE FROM quest_chains WHERE id = ?', [id]);
// ⚠️ 沒有清理 point_transactions
```

**修復方案**：
- 在刪除 `quest_chains` 前，先刪除或更新相關的 `point_transactions` 紀錄
- 可以選擇：刪除紀錄、將 `reference_id` 設為 NULL、或將 `reference_type` 改為 'deleted'
- **風險評估**：修復後不會損壞現有功能，只是改善數據一致性

---

#### 5. 檔案上傳限制過大 ⚠️ **中風險**

**問題描述**：
- 所有上傳都使用 100MB 限制（為了支援 3D 模型）
- 一般的照片上傳（`/api/upload`）應該有更嚴格的限制（例如 5MB）

**當前狀態**：
```javascript
limits: {
  fileSize: 100 * 1024 * 1024, // 100MB 限制 (為了支援 GLB 模型)
  files: 1
}
```

**修復方案**：
- 將 3D 模型上傳與一般圖片上傳的 API 拆分開來
- 3D 模型上傳：100MB
- 一般圖片上傳：5MB
- **風險評估**：修復後不會損壞現有功能，只是加強安全性

---

### ⚠️ 部分屬實的問題（需要確認）

#### 6. Staff 角色 - 無法接取任務

**問題描述**：
- `POST /api/user-tasks` 明確阻擋了 staff 角色接取任務
- 如果 Staff 本身是由一般 User 被指派而成的，他在擔任工作人員期間將無法參與任何遊戲活動

**當前狀態**：
```javascript
// 阻擋管理員或工作人員接取任務
if (user.role === 'admin' || user.role === 'shop' || user.role === 'staff') {
  return res.status(403).json({ success: false, message: '管理員或工作人員無法接取任務' });
}
```

**評估**：
- 這是**設計問題**，不是 bug
- 需要確認業務需求：Staff 是否應該可以接取任務？
- 如果需要，可以允許 Staff 以 User 身份接取任務（例如：檢查是否有另一個 User 帳號）

---

#### 7. 資料庫結構異常檢查

**問題描述**：
- `GET /api/products` 和 `POST /api/products` 會動態檢查 `is_active` 和 `created_by` 欄位是否存在
- 如果資料庫遷移未完全成功，可能會導致問題

**當前狀態**：
```javascript
// 檢查 products 表是否有 is_active 欄位
const [isActiveCols] = await conn.execute("SHOW COLUMNS FROM products LIKE 'is_active'");
const hasIsActive = isActiveCols.length > 0;
```

**評估**：
- 這是**防禦性編程**，不是 bug
- 動態檢查可以確保向後兼容性
- 如果遷移未完成，系統會自動處理，不會導致 500 錯誤
- **建議**：確保所有遷移腳本都正確執行

---

#### 8. 時區計算偏差

**問題描述**：
- `getRank` 函數計算等級時，假設資料庫存儲的是 UTC 時間
- 如果 Zeabur 伺服器與 MySQL 設定的時區不同，玩家獲得的等級將會錯誤

**當前狀態**：
```javascript
// 注意：此函數假設資料庫 TIMESTAMP 存儲的是 UTC 時間
// 如果 MySQL 的 time_zone 設定為 UTC，則此假設正確
function getRank(started, finished) {
  // JavaScript Date 對象會自動處理時區
  const diff = (finishedDate.getTime() - startedDate.getTime()) / (1000 * 60 * 60);
  // ...
}
```

**評估**：
- 代碼中有詳細註解說明時區問題
- JavaScript `Date` 對象會自動處理時區轉換
- **建議**：確認資料庫和伺服器的時區設定是否一致

---

### ❌ 不屬實的問題

#### 9. JWT 密鑰風險

**問題描述**：
- 審查報告提到開發環境的 fallback 密鑰風險

**實際狀態**：
```javascript
// 強制生產環境檢查
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  console.error('❌ 嚴重錯誤: 生產環境未設定 JWT_SECRET，拒絕啟動。');
  process.exit(1);
}
// 開發環境 fallback
const FINAL_JWT_SECRET = JWT_SECRET || 'dev-secret-key-do-not-use-in-prod';
```

**評估**：
- ✅ 生產環境已強制檢查，未設定 JWT_SECRET 會直接退出
- ✅ 開發環境使用 fallback 是合理的（方便開發）
- **結論**：此問題已正確處理，不需要修復

---

## 🔧 修復優先級與計劃

### 優先級 1: 高風險（立即修復）

1. **強制 JWT 認證** - 移除 `x-username` header 備用方案
2. **快速登入漏洞** - 如果帳號有密碼，必須驗證

### 優先級 2: 中風險（近期修復）

3. **Shop 權限溢出** - 確認業務需求後修復
4. **檔案上傳限制** - 拆分 3D 模型和一般圖片上傳

### 優先級 3: 低風險（可選修復）

5. **劇情任務刪除邏輯** - 清理 point_transactions 紀錄
6. **時區計算** - 確認時區設定一致性

### 需要確認的問題

7. **Staff 無法接取任務** - 確認業務需求
8. **資料庫結構檢查** - 確保遷移腳本正確執行

---

## ⚠️ 修復風險評估

### 修復後不會損壞的情況

1. ✅ **強制 JWT 認證** - 前端已經使用 JWT cookie，不會影響現有功能
2. ✅ **快速登入漏洞** - 只是加強安全性，不影響無密碼帳號
3. ✅ **劇情任務刪除邏輯** - 只是改善數據一致性
4. ✅ **檔案上傳限制** - 只是加強安全性，不影響現有上傳

### 需要謹慎修復的情況

1. ⚠️ **Shop 權限溢出** - 需要確認業務需求，可能影響現有流程
2. ⚠️ **Staff 無法接取任務** - 需要確認業務需求，可能影響 Staff 用戶體驗

---

## 📝 建議修復步驟

1. **立即修復**（高風險）：
   - 強制 JWT 認證
   - 快速登入漏洞

2. **確認後修復**（中風險）：
   - Shop 權限溢出（確認業務需求）
   - 檔案上傳限制（拆分 API）

3. **可選修復**（低風險）：
   - 劇情任務刪除邏輯
   - 時區計算確認

---

## 🎯 結論

審查報告中提到的問題**大部分屬實**，需要修復。但大部分修復**不會損壞現有功能**，只是加強安全性和數據一致性。

建議按照優先級逐步修復，並在修復前確認業務需求（特別是 Shop 權限和 Staff 接取任務的問題）。

