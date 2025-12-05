## 補習班網站專案（Static HTML + Express API + MySQL）

前端為 HTML/CSS/原生 JS，後端以 Node.js(Express) 提供 JSON API，資料存於 MySQL。支援完整後台管理（頁面/文章/最新消息/傳奇榜/方案/試讀/選單/設定/媒體），右下角 LINE 浮動按鈕可於設定管理。已加入 CSP/CSRF、Session 強化、受保護下載與速率限制。

### 安裝與啟動

1) 建立資料庫
```sql
CREATE DATABASE site_cms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

2) 建立 .env（參考下方範例）
```env
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=pass
DB_NAME=site_cms
SESSION_SECRET=change_this_secret
LINE_OFFICIAL_ACCOUNT_URL=https://lin.ee/xxxxxxxx
```

3) 安裝套件
```bash
npm i
```

4) 建表/種子
```bash
node src/scripts/seed.js
```

5) 啟動伺服器
```bash
node src/server.js
```

- 前台首頁：`/`
- 會員中心：`/user.html`（需登入）
- 後台登入：`/admin/login.html`（預設 admin/admin；首次登入強制修改密碼）

### 目錄結構
```
project-root/
├─ src/                  # 伺服端 API + 設定
│  ├─ server.js          # Express：靜態檔 + API + Session + CSRF + 限流
│  ├─ config/
│  ├─ middleware/
│  ├─ routes/
│  └─ scripts/seed.js
├─ public/               # 靜態前/後台 HTML + JS + CSS
│  ├─ admin/
│  ├─ js/
│  ├─ css/
│  └─ uploads/
├─ private_member_uploads/  # 會員上傳（私有，受保護下載）
├─ logs/                    # 事件日誌（登入失敗/上傳錯誤）
└─ README.md
```

### 前台（CSR 注入）
- `public/js/cms.js`：
  - 根據 `<body data-page>` 載入對應 API，渲染列表與內文
  - 讀取 `/api/public/settings`，設定站名、LINE 浮動按鈕（若 `line_url` 為空則隱藏）、背景圖/背景色
  - 列表頁支援分頁（查詢參數 `?page=1&limit=10`）
  - 根據 `settings.theme` 動態載入 `/css/theme-*.css` 變更整體配色

### 後台（Admin）
- 登入：session + CSRF（所有寫入需附加 `CSRF-Token`）
- `public/js/admin.js`：各資源 CRUD 與 `menus` 拖拉排序
- 媒體上傳：`/api/admin/media/upload`（限制 10MB、基本 MIME 白名單），影像自動產生縮圖（使用 `sharp`）

### 安全
- CSP（禁止 inline script；允許 YouTube/Vimeo iframe）
- Helmet 安全標頭、`express-session` Cookie、`csurf` CSRF 防護
- 登入時 Session regenerate，避免 Session 固化；前/後台可並存
- 會員上傳改存私有目錄 + 受保護下載路由
- 登入/上傳/聯絡表單具基本速率限制
- 後台富文字以 `sanitize-html` 清洗

### 常見操作
- 設定 LINE 官方帳號 URL：後台 Settings → `line_url`
- 設定各頁背景：在對應頁面的 `background_image_id` 選擇媒體 ID 即可（或預設背景色）
- 更換整體配色：後台 Settings `theme` 選擇主題會讓前台套用 `/css/theme-{theme}.css`
- 匯入內容：未內建介面，後續可加上 CSV/JSON 匯入器

### 已知事項
- 若未設 SMTP，聯絡表單僅寫入 DB，不寄信（頁面會顯示已送出）
- 可以改用雲端物件儲存（S3/R2）：上傳處回傳 URL 即可

### 開發
- API 串接文件（繁中）：`api串接.txt`
- 建議以 nodemon 啟動：`npx nodemon src/server.js`
- 種子腳本可重跑；會補齊欄位與 UNIQUE 索引（members.email/username）
- 推薦透過 nodemon 啟動：`npx nodemon src/server.js`
- 種子腳本可重跑，會檢查/新增欄位 `must_change_password`


