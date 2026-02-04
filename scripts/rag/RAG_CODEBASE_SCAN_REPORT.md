# RAG 程式碼通盤掃描報告（2026-02-04）

> 施作 keyword-assist 前之一致性與錯誤檢查。

---

## 一、核心流程確認

### 1.1 資料流

```
使用者上傳圖片
  → index.js /api/vision-test
  → AI 回傳 description（含 traits JSON）
  → parseTraitsFromResponse(description) 或 parseVisionResponse(description)
  → traitsToFeatureList(traits) + extractFeaturesFromDescriptionKeywords(description) 合併
  → hybridSearch(query, features, guessNames, ...)
  → start_api.py POST /hybrid-search
  → Gate-A、scoring、排序
  → 回傳 plants
```

### 1.2 依賴關係

| 模組 | 被誰使用 | 狀態 |
|------|----------|------|
| traits-parser.js | index.js | ✅ 正確 require |
| start_api.py | Zeabur Docker, run_local_embedding_api.sh | ✅ |
| feature_weights.py | start_api.py | ✅ import |
| trait_tokenizer.py, normalize_features.py | start_api.py | ✅ 動態 import |

### 1.3 traits-parser 位置

- **路徑**：`scripts/rag/vectordb/traits-parser.js`
- **執行環境**：Node.js（index.js），非 Python Docker
- **匯出**：parseTraitsFromResponse, isPlantFromTraits, traitsToFeatureList, evaluateTraitQuality, extractFeaturesFromDescriptionKeywords

---

## 二、發現的問題與修正

### 2.1 羽狀裂誤判（需修正）

**位置**：`traits-parser.js` extractFeaturesFromDescriptionKeywords，約 line 595

**問題**：`/羽狀複葉|羽狀裂|羽狀/.test(text)` 會把「羽狀裂」當成「羽狀複葉」。  
羽狀裂為葉緣型態，非複葉。

**修正**：排除羽狀裂，改為更精準的 pattern，或先檢查 `/羽狀裂|羽狀葉脈/.test(text)` 時不加 羽狀複葉。

### 2.2 繖房 vs 聚繖（需修正）

**位置**：`traits-parser.js` line 616

**問題**：`繖房花序|繖房` 目前映射到 `聚繖花序`。繖房(corymb)與聚繖(cyme)不同，火筒樹為繖房花序。

**修正**：在 FEATURE_VOCAB 新增「繖房花序」，並在 keyword-assist 中將繖房/繖房花序對應到 繖房花序。

### 2.3 矛盾處理一致性

**traitsToFeatureList**：有複葉時移除單葉 ✅  
**extractFeaturesFromDescriptionKeywords**：產生的 features 會與 traits 合併，之後經過 traitsToFeatureList 時不會再處理 keyword-assist 的結果。  
合併發生在 index.js，合併後的 features 直接送 hybrid，不會再經 traitsToFeatureList。因此 keyword-assist 產生的「羽狀複葉」與 traits 的「單葉」可能同時存在。

**建議**：在 index.js 合併後、送 hybrid 前，對合併後的 features 跑一次矛盾處理（有複葉則移除單葉）。或於 extractFeaturesFromDescriptionKeywords 回傳前自行處理。

### 2.4 無嚴重錯誤

- Gate-A、PALM_COMPOUND、動態懲罰：邏輯正確
- keyword-assist 合併：index.js 有正確合併
- parseVisionResponse：index.js 內定義，與 parseTraitsFromResponse 分工明確

---

## 三、冗餘/可移除檔案

| 檔案 | 理由 |
|------|------|
| DOCKERFILE_FOR_ZEABUR.txt | 與 Dockerfile.embedding 重複，zeabur.yaml 使用後者 |

其他 .md 計畫文件保留，作為歷史與參考。

---

## 四、腳本角色確認

| 腳本 | 用途 | 保留 |
|------|------|------|
| run_local_embed.sh | 執行 embed_plants_forest_jina.py 向量化 | ✅ |
| run_local_embedding_api.sh | 啟動 start_api.py | ✅ |
| run_local_qdrant.sh | 啟動本機 Qdrant | ✅ |
| run_cloudflare_tunnel.sh | Cloudflare 隧道 | ✅ |
| verify_from_tlpg_url.js | RAG 驗證腳本 | ✅ |
| check_qdrant_count.py | 檢查 Qdrant 筆數 | ✅ |
| reset_qdrant_clean.py | 重置 Qdrant | ✅ |
| debug_embed_stepwise.py | 除錯用 | 可選保留 |

---

## 五、結論

- 核心流程與依賴正確，無重大架構問題
- 需修正：羽狀裂誤判、繖房/聚繖分離
- 建議：合併後 features 的複葉/單葉矛盾處理
- 可移除：DOCKERFILE_FOR_ZEABUR.txt
