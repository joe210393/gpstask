# RAG 與向量化除錯指南

## 一、RAG 搜尋無結果（兩階段都回傳空陣列）

### 可能原因

| 原因 | 檢查方式 |
|------|----------|
| Node.js 無法連到 Embedding API | 確認 `EMBEDDING_API_URL` 設定正確 |
| Embedding API 無法連到 Qdrant | 檢查 embedding-api 的 `QDRANT_URL`、`QDRANT_API_KEY` |
| Qdrant collection 為空或維度錯誤 | 執行 `check_qdrant_count.py` |
| Jina API 未設定 | 確認 `JINA_API_KEY` 已設定於 embedding-api |

### 1. 確認 EMBEDDING_API_URL

- **本地開發**：若 embedding-api 跑在 8100 埠，應為 `http://localhost:8100`
- **ngrok**：主 app 用一個 ngrok，embedding-api 需**另一個** ngrok tunnel 指向 8100
- **Zeabur**：通常為 `http://embedding-api:8080`（內部服務名）

```bash
# 測試 Embedding API 是否可達
curl "http://localhost:8100/health"
# 或
curl "https://你的-embedding-ngrok-url/health"
```

### 2. 已加入 HTTP 逾時

`index.js` 的 `httpRequest` 已加入 **60 秒逾時**（可透過 `EMBEDDING_REQUEST_TIMEOUT_MS` 調整）。

若 Embedding API 無法連線，現在會在約 60 秒後回傳逾時錯誤，而不會無限等待。

### 3. 快速驗證 RAG 連線

```bash
# 設定你的 embedding API URL
export EMBEDDING_API_URL="http://localhost:8100"

# 執行診斷
python scripts/diagnose_rag_system.py
```

---

## 二、向量化腳本卡住、終端機沒反應

### 可能卡住的環節

1. **連接 Qdrant**：網路慢、防火牆、API Key 錯誤
2. **第一筆 Jina API 呼叫**：Jina 服務或網路問題
3. **等待使用者輸入**：非互動模式請設 `AUTO_CONFIRM=true`

### 使用逐步除錯腳本

```bash
export QDRANT_URL="https://gps-task-qdrant.zeabur.app"
export QDRANT_API_KEY="你的_Qdrant_API_Key"
export JINA_API_KEY="你的_Jina_API_Key"

python scripts/rag/vectordb/debug_embed_stepwise.py
```

腳本會依序執行：

1. Jina API 連線測試  
2. Qdrant 連線測試  
3. 單筆資料向量化  
4. 上傳到 Qdrant  

**卡住的那一步就是問題來源。**

### 強制即時輸出（避免看起來卡住）

```bash
# 方式 1：使用 -u (unbuffered)
python -u scripts/rag/vectordb/embed_plants_forest_jina.py

# 方式 2：設定環境變數
PYTHONUNBUFFERED=1 python scripts/rag/vectordb/embed_plants_forest_jina.py

# 方式 3：自動確認，跳過互動
AUTO_CONFIRM=true python -u scripts/rag/vectordb/embed_plants_forest_jina.py
```

### 若卡在「連接 Qdrant」

- 檢查 `QDRANT_URL` 是否可從本機訪問（Zeabur 的 Qdrant 通常需用公網 URL）
- 測試：`curl -I "https://gps-task-qdrant.zeabur.app"`

### 若卡在「Jina API」

- 確認 `JINA_API_KEY` 正確
- 測試：`curl -X POST https://api.jina.ai/v1/embeddings -H "Authorization: Bearer $JINA_API_KEY" -H "Content-Type: application/json" -d '{"model":"jina-embeddings-v3","input":["test"]}'`

---

## 三、ngrok 本地開發設定

若主 app 使用 `tactually-venerable-inez.ngrok-free.dev`：

1. **主 app**：一個 ngrok tunnel（例如 3000 埠）
2. **Embedding API**：需要**第二個** ngrok tunnel 指向 8100 埠

```bash
# Terminal 1: 啟動 embedding-api
cd scripts/rag/vectordb && python start_api.py

# Terminal 2: ngrok 暴露 8100
ngrok http 8100

# 複製 ngrok 給的 https URL，設到 Node.js
export EMBEDDING_API_URL="https://xxxx.ngrok-free.app"
```

然後重新啟動 Node.js 主 app，讓它使用新的 `EMBEDDING_API_URL`。
