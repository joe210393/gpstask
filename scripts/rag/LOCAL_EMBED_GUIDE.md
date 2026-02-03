# 本機向量化指南

> **完整本機 RAG 部署**（Qdrant + embedding-api + Cloudflare Tunnel）請見  
> `scripts/LOCAL_RAG_DEPLOYMENT_WORKPLAN.md`

## 為什麼要用本機向量化？

- **Zeabur Egress**：在 Zeabur 上跑向量化會產生大量 egress（呼叫 Jina API 的流量）
- **本機執行**：Jina API 流量從你的電腦發出，不經 Zeabur → **不計 Zeabur egress**
- **上傳到 Qdrant**：本機 → Qdrant（本機或 Zeabur）屬於 **ingress**，不計 Zeabur egress

---

## 與 Qdrant 的關係

本機向量化可寫入：

- **本機 Qdrant**：`QDRANT_URL=http://localhost:6333`，不需 API Key
- **Zeabur Qdrant**：`QDRANT_URL=https://gps-task-qdrant.zeabur.app`，需 API Key

只做 upsert（新增/覆蓋點），資料格式一致，搜尋邏輯不用改。

---

## 什麼時候需要重新向量化？

| 情況 | 是否需要 |
|------|----------|
| 向量化已完成，只是改成本機流程 | **否**，不用重跑 |
| 未來新增/刪除植物、改 jsonl | **是**，需要重跑一次 |
| 只是改 traits-parser、演算法 | **否**，不需重新向量化 |

---

## 本機執行步驟

### 1. 安裝依賴

```bash
cd scripts/rag/vectordb
pip install -r requirements.txt
```

### 2. 設定環境變數

**本機 Qdrant + 本機模型（不扣 token）**：
```bash
export USE_JINA_API="false"
export EMBEDDING_MODEL="jinaai/jina-embeddings-v3"
# QDRANT_URL 預設為 http://localhost:6333，不需 API Key
```

**Zeabur Qdrant + Jina API**（上傳到雲端）：
```bash
export QDRANT_URL="https://gps-task-qdrant.zeabur.app"
export QDRANT_API_KEY="你的_Qdrant_API_Key"
export JINA_API_KEY="你的_Jina_API_Key"
export USE_JINA_API="true"
```

### 3. 執行向量化

**本機 Qdrant**：請先執行 `./scripts/rag/run_local_qdrant.sh` 啟動 Qdrant

```bash
./scripts/rag/run_local_embed.sh
```

或手動：
```bash
cd /path/to/gps-task
python scripts/rag/vectordb/embed_plants_forest_jina.py
```

---

## Jina API Token 消耗

- **同一次向量化**：本機 vs Zeabur 消耗的 Jina token **一樣**（4300 筆 × 約 500 tokens ≈ 200 萬 tokens）
- **差異在執行次數**：Zeabur 上容易因部署、測試反覆執行 → token 累積暴增
- **本機**：只在 jsonl 更新時手動執行 → 總 token 消耗會明顯減少

你這兩天約 800 萬 tokens，推測是多次完整向量化或反覆重試造成的；改成本機後，只在必要時跑，token 使用會大幅下降。
