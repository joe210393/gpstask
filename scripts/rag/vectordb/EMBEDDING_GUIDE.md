# RAG 資料向量化指南

## 概述

本指南說明如何使用 Jina API 在本地將 `plants-forest-gov-tw.jsonl` 向量化，並上傳到 Zeabur 的 Qdrant。

## 前置準備

### 1. 安裝依賴

```bash
cd scripts/rag/vectordb
pip install -r requirements.txt
```

### 2. 設定環境變數

```bash
# Jina API Key（必須）
export JINA_API_KEY="jina_xxxxxxxxxxxxx"

# Zeabur Qdrant 設定（必須）
export QDRANT_URL="https://gps-task-qdrant.zeabur.app"
export QDRANT_API_KEY="your_qdrant_api_key"

# 可選：本地測試時使用本地 Qdrant
# export QDRANT_URL="http://localhost:6333"
# export QDRANT_API_KEY=""  # 本地不需要 API Key
```

### 3. 確認資料檔案

確認 `scripts/rag/data/plants-forest-gov-tw.jsonl` 存在且格式正確：

```bash
wc -l scripts/rag/data/plants-forest-gov-tw.jsonl
# 應該顯示約 4670 行
```

## 執行向量化

### 方式 1：直接執行（推薦）

```bash
cd /Users/hung-weichen/gps-task
python scripts/rag/vectordb/embed_plants_forest.py
```

### 方式 2：使用 Python 模組

```bash
cd scripts/rag/vectordb
python embed_plants_forest.py
```

## 執行過程

腳本會：

1. **連接 Qdrant**：測試與 Zeabur Qdrant 的連接
2. **初始化 Collection**：如果 `taiwan_plants` collection 不存在，會自動建立
3. **載入資料**：讀取 `plants-forest-gov-tw.jsonl`
4. **檢查進度**：讀取 `embed_plants_forest_progress.json`，跳過已處理的資料
5. **批次向量化**：
   - 每批 32 筆資料
   - 使用 Jina API 進行 embedding
   - 上傳到 Qdrant
   - 每 10 批儲存一次進度
6. **完成統計**：顯示向量數量、維度、預估 token 消耗

## 進度管理

- **進度檔案**：`scripts/rag/vectordb/embed_plants_forest_progress.json`
- **中斷恢復**：如果腳本中斷，重新執行會自動從上次停止的地方繼續
- **重新開始**：刪除進度檔案即可重新開始

```bash
# 重新開始（清除進度）
rm scripts/rag/vectordb/embed_plants_forest_progress.json
```

## Token 消耗估算

- **每筆資料**：約 200 tokens（取決於資料長度）
- **總資料量**：約 4670 筆
- **預估總消耗**：約 934,000 tokens

**注意**：實際消耗可能因資料長度而異，建議先用小批次測試。

## 測試建議

### 1. 先用小批次測試

修改腳本中的 `BATCH_SIZE = 32` 改為 `BATCH_SIZE = 5`，測試前 10 筆：

```python
# 在 load_plants() 後添加
plants = plants[:10]  # 只處理前 10 筆
```

### 2. 檢查結果

向量化完成後，檢查 Qdrant：

```bash
# 使用 Qdrant Dashboard
open https://gps-task-qdrant.zeabur.app/dashboard

# 或使用 API
curl -X GET "https://gps-task-qdrant.zeabur.app/collections/taiwan_plants" \
  -H "api-key: $QDRANT_API_KEY"
```

## 常見問題

### 1. Jina API 限流

如果遇到限流錯誤，增加 `REQUEST_DELAY`：

```python
REQUEST_DELAY = 0.5  # 增加到 0.5 秒
```

### 2. Qdrant 連接失敗

檢查：
- `QDRANT_URL` 是否正確
- `QDRANT_API_KEY` 是否有效
- 網路連接是否正常

### 3. 記憶體不足

如果本地記憶體不足，可以：
- 減少 `BATCH_SIZE`
- 分批執行（修改腳本只處理特定範圍）

## 驗證結果

向量化完成後，可以使用搜尋 API 測試：

```bash
# 測試搜尋
curl -X POST "http://localhost:8100/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "紅色的花", "top_k": 5}'
```

## 下一步

向量化完成後：

1. **驗證資料**：確認 Qdrant 中的向量數量正確
2. **測試搜尋**：使用搜尋 API 測試效果
3. **部署更新**：如果一切正常，可以部署到 Zeabur
