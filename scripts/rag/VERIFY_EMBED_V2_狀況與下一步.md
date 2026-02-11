# verify-report-embed-v2 狀況判斷與下一步優化建議

## 一、目前狀況判斷

### 1.1 報告數字摘要

| 項目 | 數值 |
|------|------|
| 總筆數 | 100 |
| **通過（Top1 正確）** | **1**（光葉石楠） |
| Embedding-only vs Hybrid 統計 | **幫忙 0 / 不變 0 / 擾亂 0 / n/a 100** |

### 1.2 關鍵發現

- **全部 100 題的 RAG 類型都是 `embedding`，沒有任何一題是 `hybrid_traits`。**
  - 代表：線上 gps-task（Zeabur）在處理這 100 題時，**都沒有走「第二階段 hybrid」**，只用了第一階段 embedding 的結果。
- **因此 `embedding_only_plants` 永遠沒被寫入。**
  - 在我們設計裡，`embedding_only_plants` 只有在「有 traits + 有 queryTextZh + 成功呼叫 hybridSearch」的那條分支才會被塞進回傳。
  - 既然沒有題目走進那條分支，驗證腳本拿到的就全是 n/a。

### 1.3 可能原因（二擇一或並存）

1. **Zeabur 上的 Node 仍是舊版**
   - 尚未部署「第二階段 hybrid + embedding_only_plants」的 index.js，所以永遠只回第一階段 embedding 結果。
2. **Vision / traits 在線上環境幾乎沒通過**
   - 例如：Zeabur 用的 AI 模型或 prompt 與本機不同、或 traits 解析失敗，導致多數題目 `traits` 為空或 `isPlantFromTraits` 為 false，程式就不會組 queryTextZh、也不會呼叫 hybridSearch，自然就沒有 embedding_only_plants。

### 1.4 其他現象（與先前一致）

- **Top1 常客**：冇拱、鞭枝懸苔、八角蓮、羊蹄甲、南亞孔雀苔、株苔等反覆出現。
- **唯一通過**：光葉石楠（我們補的 7 筆之一），且該題回傳的候選名單裡光葉石楠排第 1，冇拱第 2。
- 推論：**Zeabur 打到的 embedding API / Qdrant 很可能仍是「補洞前」的索引**（或與你本機重建的索引不同），所以多數物種在「第一階段 embedding」就找不到正解，只能落在這些萬用條目上。

---

## 二、下一步優化建議（由你勾選後再執行）

以下分兩條線：**A. 讓資料一致、B. 讓 hybrid 有機會上場並可量測**。

---

### 建議 A：讓 Zeabur 使用你剛重建的 embedding 索引（強烈建議）

**目的**：你本機已用「主資料 + tlpg-manual-supplement」重建 Qdrant，20 題手動測試裡 16 題 Top10。若 Zeabur 的 gps-task 仍連到舊的 embedding API / 舊 Qdrant，TLPG-100 的結果會繼續偏爛且無法反映我們補洞的效果。

**步驟**：

1. 確認本機 embedding API 已用「含補充 7 筆」的索引跑過 `embed_plants_forest_jina.py`（你已完成）。
2. 本機啟動 embedding API + Cloudflare Tunnel，取得對外 URL（例如 `https://xxx.trycloudflare.com`）。
3. 在 **Zeabur 的 gps-task 服務**環境變數中，將 `EMBEDDING_API_URL` 設為上述 Tunnel URL，並重新部署。
4. 再跑一次 TLPG-100 驗證，看通過數是否提升、以及 Top1 是否仍被冇拱/鞭枝懸苔等霸榜。

**理由**：同一份索引、同一組 API，才能公平判斷「補洞 + 保守 prompt + 純 gate」在真實流程裡的效果。

**修改內容**：僅改 Zeabur 上 gps-task 的 `EMBEDDING_API_URL`，無需改程式碼。

---

### 建議 B：讓「第二階段 hybrid」有機會跑、並回傳 embedding_only_plants（便於日後量測）

**目的**：目前 100 題全部只走第一階段 embedding，所以報告裡幫忙/不變/擾亂無法計算。若讓部分請求能走進 hybrid 分支，並確保回傳帶 `embedding_only_plants`，之後我們才能用報告判斷「hybrid 相對於純 embedding」是幫忙還是擾亂。

**步驟**：

1. **確認 Zeabur 部署的 index.js 已包含「第二階段 hybrid + embedding_only_plants」邏輯**
   - 若尚未部署，請將目前 repo 的 index.js 部署上去（含 `embeddingOnlyPlants`、`newResults.embedding_only_plants`、合併時保留 `embedding_only_plants` 等）。
2. **（可選）暫時放寬「進入第二階段」的條件，讓更多題目有機會走 hybrid**
   - 例如：在 `isPlantFromTraits(traits)` 為 false 時，若第一階段 embedding 有結果，仍用 `detailedDescription` 或簡單從 description 抽出的關鍵詞組一個 `queryTextZh`，呼叫 hybridSearch，並同樣寫入 `embedding_only_plants`（與目前「有 traits 才組 queryTextZh」並行多一條路）。  
   - 這樣即使 traits 空或判斷非植物，仍可對「同一段文字」做一次 embedding-only 與一次 hybrid，報告就能出現非 n/a 的幫忙/不變/擾亂。

**理由**：不改的話，報告永遠是 100% n/a，無法優化 hybrid；適度放寬可增加可量測樣本，又不強制依賴不穩的 traits。

**修改內容**：

- **必要**：確保 index.js 內有 `embedding_only_plants` 的賦值與回傳（你本機應已有，需確認已部署到 Zeabur）。
- **可選**：在 index.js 的 vision-test 流程中，當「第一階段有結果但沒有走 hybrid 分支」時，補一次用 `detailedDescription`（或簡短 query）呼叫 `smartSearch`，將結果寫入 `plant_rag.embedding_only_plants`，這樣該題就不會是 n/a，且可與實際回傳的 `plants`（第一階段結果）比較排名。

---

### 建議 C：針對「萬用條目」做輕量壓制（可選、進階）

**目的**：冇拱、鞭枝懸苔、南亞孔雀苔、八角蓮等在多題中霸榜，可能因為它們在 DB 裡 summary/key_features 寫得過於泛用，容易被各種 query 命中。若在 embedding 或 hybrid 層對這類條目做輕度降權（例如在 start_api 裡對固定 id 或 chinese_name 黑名單乘數 < 1），有機會讓正確物種更容易進 Top1。

**步驟**：在 `start_api.py` 的 hybrid 計分迴圈（或 embedding-only 的後處理）中，若 `chinese_name` 在預設黑名單（如 冇拱、南亞孔雀苔、鞭枝懸苔、株苔）內，則 `hybrid_score *= 0.85`（或 0.9），再排序。

**理由**：實測顯示這些名字反覆出現在錯誤的 Top1，適度壓制可減少「明明有更好候選卻被萬用條目擋住」的情況。

**修改內容**：在 `scripts/rag/vectordb/start_api.py` 中，於計算完 `hybrid_score` 後、排序前，對黑名單物種乘上 0.85～0.9 的係數。

---

## 三、建議優先順序（由你決定）

| 優先 | 建議 | 說明 |
|------|------|------|
| 1 | **A** | 先讓 Zeabur 用你重建的 embedding，再測 TLPG-100，才能反映補洞效果。 |
| 2 | **B（必要部分）** | 確認 Zeabur 已部署含 `embedding_only_plants` 的 index.js，之後報告才有機會出現幫忙/不變/擾亂。 |
| 3 | **B（可選）** | 在「沒走 hybrid 分支」時也補寫 `embedding_only_plants`，增加可量測題數。 |
| 4 | **C** | 若 A+B 做完後仍大量冇拱/鞭枝懸苔霸榜，再考慮黑名單降權。 |

請你勾選要執行哪些（A / B 必要 / B 可選 / C），確認後我再依你的選擇給出對應的具體修改片段或指令。

---

## 四、從這次跑完的結果，得到的調整方向（直接回答）

**有。** 這次報告無法做「embedding 已經 Top1～Top3、但整體結果還是錯」的分析，是因為 **報告裡完全沒有 embedding_only 的排名**（100% n/a）。所以下一步必須先讓「同一 query 的純 embedding 排名」出現在報告裡，之後你才能：

1. 用新 embedding 再跑一輪 TLPG-100（建議 A），或  
2. 先改程式讓報告有資料（下面兩點），再跑一輪。

**具體調整方向：**

- **方向 1（必做）**：只要最後回傳的是「植物結果」，就盡量帶上 `embedding_only_plants`。  
  - **情況 A**：有進第二階段、但 hybrid 無結果 → 回退用 `preSearchResults` 時，**不要丟掉已算好的 `embeddingOnlyPlants`**，要一併塞進回傳（例如 `plantResults = { ...preSearchResults, embedding_only_plants: embeddingOnlyPlants }`）。  
  - **情況 B**：根本沒進第二階段（沒 traits 或 traits 判非植物）→ 目前完全沒算、也沒回傳 embedding_only。要在「只走第一階段 embedding」的分支裡，用 `detailedDescription`（或 description 前 80 字）組一個簡短 query，**多打一次** `smartSearch`，把結果寫進 `plant_rag.embedding_only_plants` 再回傳。  
- 這樣報告就會有「Embedding-only 排名」與「實際 Top1 排名」（可能來自第一階段或 hybrid），才能算幫忙/不變/擾亂（沒跑 hybrid 的題可標 Hybrid 排名 999 或 n/a）。

- **方向 2（建議 A 仍要做）**：Zeabur 改指到新 embedding（Tunnel 或正式新索引），再跑一次 TLPG-100，通過數與 Top1 分布才會反映補洞效果；同時報告有 embedding_only 資料後，才能做你要的「embedding Top1～Top3 但整體錯」的 B 向分析。
