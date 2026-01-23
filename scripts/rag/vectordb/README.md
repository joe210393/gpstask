# 植物向量資料庫

使用 JINA Embeddings v3 + Qdrant 建立植物語意搜尋系統。

## 功能

1. **智慧分類**：自動判斷查詢是植物/動物/人造物/食物/其他
2. **植物 RAG**：只有植物相關查詢才搜尋向量資料庫
3. **9272 種台灣植物**：完整的台灣植物資料庫

## 架構

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Node.js Server │ --> │  Embedding API  │ --> │  Qdrant         │
│                 │     │  (Python)       │     │  (向量資料庫)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                        ┌─────┴─────┐
                        │ 1. 分類查詢 │
                        │ 2. 植物搜尋 │
                        └───────────┘
```

## API 端點

| 端點 | 方法 | 說明 |
|------|------|------|
| `/health` | GET | 健康檢查 |
| `/classify?q=...` | GET/POST | 分類查詢（植物/動物/人造物等） |
| `/search?q=...&smart=true` | GET/POST | 智慧搜尋（先分類再搜尋） |

### 分類 API 範例

```bash
curl "http://localhost:8100/classify?q=紅色的花"
```

回應：
```json
{
  "category": "plant",
  "confidence": 0.65,
  "is_plant": true,
  "plant_score": 0.65
}
```

### 智慧搜尋 API 範例

```bash
curl "http://localhost:8100/search?q=紅色的花&smart=true"
```

回應（植物查詢）：
```json
{
  "query": "紅色的花",
  "classification": { "category": "plant", "is_plant": true },
  "results": [
    { "chinese_name": "川紅花", "scientific_name": "...", "score": 0.67 }
  ],
  "message": "識別為植物相關查詢"
}
```

回應（非植物查詢）：
```json
{
  "query": "小狗",
  "classification": { "category": "animal", "is_plant": false },
  "results": [],
  "message": "非植物相關查詢，識別為: animal"
}
```

## 本地開發

### 1. 啟動 Qdrant

```bash
docker-compose up -d
```

### 2. 安裝依賴 + 向量化

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python embed_plants.py
```

### 3. 啟動 API

```bash
python start_api.py
```

## Zeabur 部署

### 1. 部署 Qdrant
- Zeabur Marketplace → "Qdrant"
- 設定環境變數:
  - `PASSWORD=你的API金鑰`
  - `QDRANT__SERVICE__API_KEY=${PASSWORD}`
- 加 Volume 持久化

### 2. 部署 Embedding API
- 從 `scripts/rag` 目錄部署
- Dockerfile 路徑: `vectordb/Dockerfile`
- 環境變數：
  - `QDRANT_URL=https://your-qdrant.zeabur.app` (使用 Zeabur 內部 URL 或公開 URL)
  - `QDRANT_API_KEY=你的API金鑰` (與 Qdrant 的 PASSWORD 相同)

## Node.js 整合

```javascript
const { smartSearch, classify } = require('./plant-search-client');

// 智慧搜尋（自動判斷是否為植物）
const result = await smartSearch('紅色的花');
if (result.classification.is_plant) {
  console.log('找到植物:', result.results);
} else {
  console.log('非植物查詢:', result.classification.category);
}

// 分類查詢
const cls = await classify('小狗');
console.log(cls.category); // "animal"
```

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant 位址 |
| `QDRANT_API_KEY` | (無) | Qdrant API Key (Zeabur 需要) |
| `EMBEDDING_API_PORT` | `8100` | API Port |
| `EMBEDDING_API_URL` | `http://localhost:8100` | 給 Node.js 用的 API URL |
