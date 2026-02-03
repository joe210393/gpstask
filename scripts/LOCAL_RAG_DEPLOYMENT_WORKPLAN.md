# 本機 RAG 部署工項計畫

目標：將 embedding-api 與 Qdrant 遷至本機，降低 Zeabur egress 與初期費用。  
若採用本機 embedding 模型，可再省去 Jina API 費用（需重新向量化）。

---

## 工項清單（先確認後再製作）

### 階段一：本機 Qdrant + embedding-api（維持 Jina API）

| 步驟 | 工項 | 說明 |
|------|------|------|
| 1.1 | 本機安裝並啟動 Qdrant | Docker 或 binary，port 6333，資料卷持久化 |
| 1.2 | 本機向量化並上傳至本機 Qdrant | 執行 embed 腳本，QDRANT_URL=localhost |
| 1.3 | 本機執行 embedding-api (start_api.py) | 連線本機 Qdrant，使用 Jina API |
| 1.4 | 設定 Cloudflare Tunnel 暴露 embedding-api | 暴露 port 8080，取得公開 URL |
| 1.5 | Zeabur 設定 EMBEDDING_API_URL | 改為 Cloudflare Tunnel 的 URL |
| 1.6 | 驗證端對端流程 | Zeabur gps-task → Tunnel → 本機 embedding-api → 本機 Qdrant → Jina |

**預期結果**：Zeabur 無 embedding/Qdrant 相關 egress；搜尋仍使用 Jina API（從本機呼叫）。

---

### 階段二：本機 embedding 模型（可選，省 Jina 費用）

| 步驟 | 工項 | 說明 |
|------|------|------|
| 2.1 | 選定本機 embedding 模型 | 例：sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2（384 維）或 其他 1024 維模型 |
| 2.2 | 修改 start_api.py 支援本機模型 | 當 USE_JINA_API=false 時改用 sentence-transformers |
| 2.3 | 修改 embed 腳本支援本機模型 | 可選用 Jina 或本機模型，輸出維度需一致 |
| 2.4 | 重新向量化 | 使用本機模型對 jsonl 做 embedding，上傳至本機 Qdrant |
| 2.5 | 確認維度與 collection 設定 | Qdrant collection 維度需與新模型一致 |
| 2.6 | 關閉 Jina API | 環境變數 USE_JINA_API=false，移除 JINA_API_KEY 依賴 |

**注意**：若選用 384 維模型，需刪除舊 collection 或新建不同 collection，因現有為 1024 維。

**預期結果**：完全不用 Jina API，無 embedding 相關雲端費用。

---

### 階段三：維運與文檔

| 步驟 | 工項 | 說明 |
|------|------|------|
| 3.1 | 撰寫啟動腳本 | 一鍵啟動 Qdrant + embedding-api + Tunnel（可選） |
| 3.2 | 撰寫關機/重啟 SOP | 本機服務重啟後如何恢復 |
| 3.3 | 更新 LOCAL_EMBED_GUIDE.md | 納入本機 Qdrant + Cloudflare Tunnel 說明 |
| 3.4 | 環境變數清單 | 本機與 Zeabur 需設定的變數整理 |

---

## 架構圖

### 階段一完成後
```
使用者
  ↓
Zeabur (gps-task, Node)
  ↓ EMBEDDING_API_URL = Cloudflare Tunnel URL
Cloudflare Tunnel
  ↓
本機 embedding-api :8080
  ├→ localhost:6333 (本機 Qdrant)
  └→ Jina API（本機對外，不經 Zeabur）
```

### 階段二完成後（可選）
```
同上，但 embedding-api 不再呼叫 Jina，改使用本機 embedding 模型
```

---

## 前置需求

- 本機可安裝 Docker 或下載 Qdrant binary  
- 本機可安裝 Python 3.11+ 與專案依賴  
- 本機需可連外（Jina API，或階段二則不需要）  
- Cloudflare 帳號（Tunnel 免費）或使用 ngrok 代替  
- Zeabur 專案有權限修改 gps-task 的 EMBEDDING_API_URL  

---

## 待討論／確認事項

1. **階段二是否要做？**  
   - 做：需重新向量化、改程式，可省 Jina 費用  
   - 不做：沿用 Jina，只省 Zeabur egress  

2. **本機 embedding 模型選擇**  
   - **Jina v3 本機**：`jinaai/jina-embeddings-v3` 在 Hugging Face，可用 sentence-transformers 載入，**1024 維與現有 Qdrant 一致，不需重新向量化**  
   - 384 維：模型小、速度快，但需重建 Qdrant  
   - 768 維：需找相容的開源模型  

3. **Cloudflare Tunnel vs ngrok**  
   - 目前 ngrok 給 LM 用，embedding-api 建議用 Cloudflare Tunnel  
   - 或兩者都用 ngrok（不同 subdomain/port）  

4. **本機開機自啟**  
   - 是否需設定開機自動啟動 Qdrant + embedding-api + Tunnel？  

---

## 工項狀態

| 階段 | 狀態 |
|------|------|
| 階段一 | ✅ 腳本已建立 |
| 階段二 | 待確認 |
| 階段三 | 待確認 |

---

## 階段一執行步驟（腳本已就緒）

```bash
# 1.1 啟動本機 Qdrant
./scripts/rag/run_local_qdrant.sh

# 1.2 本機向量化（首次或重置時）
# 若要「本機模型」：不需 JINA API
export USE_JINA_API="false"
export EMBEDDING_MODEL="jinaai/jina-embeddings-v3"
./scripts/rag/run_local_embed.sh

# 1.3 啟動 embedding-api（另開終端）
# 若要「本機模型」：不需 JINA API
export USE_JINA_API="false"
export EMBEDDING_MODEL="jinaai/jina-embeddings-v3"
./scripts/rag/run_local_embedding_api.sh

# 1.4 啟動 Cloudflare Tunnel（另開終端，暴露 8080）
./scripts/rag/run_cloudflare_tunnel.sh
# 取得 URL 後，複製備用

# 1.5 Zeabur 設定
# 在 gps-task 的環境變數中，將 EMBEDDING_API_URL 改為 Tunnel 顯示的 URL
# 例：https://xxx-xxx-xxx.trycloudflare.com

# 1.6 驗證
# 使用 App 進行植物辨識，確認 RAG 搜尋正常
```

**注意**：本機 Qdrant 為新建、尚無資料時，必須執行 1.2 向量化。  
若先前已在本機跑過向量化且 `qdrant_storage` 未刪除，可略過 1.2。
