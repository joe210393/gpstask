# 從 tlpg 網址驗證 RAG 辨識

使用 [台灣景觀植物介紹](https://tlpg.hsiliu.org.tw/) 網址，自動抓圖 → **三張合成一大張**（不足三張時以局部放大補滿）→ Vision → RAG → 比對結果。

需安裝 **sharp**（`npm install` 已含）以啟用合成；未安裝時僅送第一張圖。

---

## 前置條件

1. **主程式運行中**（Node gps-task）
2. **Embedding API 運行中**（Qdrant + start_api）
3. **AI API 可連**（LM Studio / OpenAI 等）

---

## 使用方式

### 指定網址

```bash
APP_URL=http://localhost:3000 node scripts/rag/verify_from_tlpg_url.js \
  https://tlpg.hsiliu.org.tw/search/view/307 \
  https://tlpg.hsiliu.org.tw/search/view/286 \
  https://tlpg.hsiliu.org.tw/search/view/543
```

### 或使用 npm

```bash
APP_URL=http://localhost:3000 npm run verify:tlpg -- \
  https://tlpg.hsiliu.org.tw/search/view/307 \
  https://tlpg.hsiliu.org.tw/search/view/286
```

### 預設 12 筆（不帶網址即跑預設清單）

```bash
APP_URL=http://localhost:3000 npm run verify:tlpg
```

預設清單含：火筒樹、長穗木、風鈴草、以及 view/136, 284, 285, 288, 291, 296, 297, 298, 310。

---

## 環境變數

| 變數 | 說明 | 預設 |
|------|------|------|
| APP_URL | gps-task 主程式位址 | http://localhost:3000 |

---

## 輸出說明

- 每個網址會顯示：預期物種、RAG Top1、是否符合
- 最後彙總：通過數 / 總數
- 不修改主程式，僅呼叫 `/api/vision-test`

### 詳細模式 `--verbose` / `-v`

輸出更多資訊，便於除錯與優化 RAG：

- **LM 猜測**：Vision 模型從圖片推測的植物名稱
- **快速特徵**：第一階段特徵摘要
- **Query 特徵**：送進 hybrid search 的特徵
- **Top5**：前五名候選、分數、匹配特徵

```bash
APP_URL=https://你的zeabur.zeabur.app npm run verify:tlpg -- -v \
  https://tlpg.hsiliu.org.tw/search/view/307
```

### 寫入完整報告 `--report`（對齊 test-report.md，便於決定下一步修改與權重）

報告內容包含：預期物種、網址、RAG Top1、LM/描述摘要、快速特徵、Query 特徵、特徵總分、**完整候選名單**（每筆含分數、embedding%、feature%、匹配特徵）。可依此調整權重與邏輯。

```bash
# 自動檔名：scripts/rag/verify-report-<timestamp>.md
APP_URL=https://gpstask.zeabur.app npm run verify:tlpg -- --report

# 指定路徑
APP_URL=https://gpstask.zeabur.app npm run verify:tlpg -- --report ./my-report.md
```
