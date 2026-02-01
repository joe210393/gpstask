# 重新向量化指南

## 概述

現在已經生成了增強資料（`plants-forest-gov-tw-enhanced.jsonl`），包含：
- `morphology_summary_zh`：乾淨的摘要（用於 embedding）
- `trait_tokens`：標準化的特徵 tokens（用於特徵匹配）

接下來需要重新向量化資料庫，讓系統使用新的改進。

## 前置準備

### 1. 確認環境變數

向量化需要以下環境變數：

```bash
export QDRANT_URL="https://gps-task-qdrant.zeabur.app"
export QDRANT_API_KEY="your_qdrant_api_key"
export JINA_API_KEY="your_jina_api_key"
```

### 2. 確認資料檔案

確認增強資料已生成：
```bash
ls -lh scripts/rag/data/plants-forest-gov-tw-enhanced.jsonl
```

應該看到約 11MB 的檔案。

## 執行向量化

### 方式一：本地執行

```bash
cd /Users/hung-weichen/gps-task
python3 scripts/rag/vectordb/embed_plants_forest_jina.py
```

### 方式二：在 Zeabur 上執行

1. 將增強資料加入 Dockerfile：
   ```dockerfile
   COPY scripts/rag/data/plants-forest-gov-tw-enhanced.jsonl /app/data/plants-forest-gov-tw-enhanced.jsonl
   ```

2. 重新部署服務

## Token 消耗估算

- 約 4,670 筆資料
- 每筆約 200-500 tokens（使用 morphology_summary 後會更少）
- 總計約 1,000,000 - 2,000,000 tokens
- 約佔免費額度（10,000,000 tokens）的 10-20%

## 注意事項

1. **進度保存**：腳本會自動保存進度到 `embed_plants_forest_jina_progress.json`
2. **中斷恢復**：如果中斷，重新執行會自動從上次進度繼續
3. **批次處理**：使用批次處理（batch_size=16）和重試機制，避免 API 限制

## 完成後

向量化完成後：
1. 檢查 Qdrant collection 中的資料數量
2. 測試 API 端點是否正常
3. 驗證檢索準確度是否提升
