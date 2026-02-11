# RAG 下一步優化方案（依 verify-report-embed-v2 報告）

報告時間: 2026-02-11T03:16:09 | APP_URL: https://gpstask.zeabur.app

---

## 一、目前報告數字與解讀

| 項目 | 數值 |
|------|------|
| 總筆數 | 100 |
| **通過（Top1 正確）** | **4**（越橘葉蔓榕、光葉石楠、西洋常春藤、珠蔥） |
| **幫忙**（hybrid 排名較前） | 16 |
| **不變** | 37 |
| **擾亂**（hybrid 排名較後） | 9 |
| **n/a**（無 embedding_only 資料） | 38 |

- **有意義題數**：62 題有 Embedding-only vs Hybrid 資料（16+37+9）；38 題仍只走第一階段 embedding，無 hybrid 比較。
- **Hybrid 效果**：幫忙 16、擾亂 9 → 約 16/(16+9) 在「有比較時」hybrid 是幫到忙的，但 9 題是 hybrid 把排名弄差。

---

## 二、問題歸類（從報告抽樣）

### 2.1 「擾亂」9 題：Embedding 已有正解，Hybrid 反而弄丟或變差

| 預期物種 | Embedding 排名 | Hybrid 排名 | 說明 |
|----------|----------------|-------------|------|
| 迷迭香 | **6** | 999 | 正解在 Emb Top6，hybrid 召回/過濾後變 999 |
| 黑種草 | **4** | 999 | 正解 Emb 4，hybrid 後消失 |
| 彩葉草 | **2** | 999 | 正解 Emb 2，hybrid 後消失 |
| 楓樹 | **3** | 999 | 正解 Emb 3，hybrid 後消失 |
| 麵包樹 | **8** | 999 | 正解 Emb 8，hybrid 後消失 |
| 呂宋毛蕊木 | **17** | 999 | 正解 Emb 17，hybrid 後消失 |
| 水竹芋 | **23** | 999 | 正解 Emb 23，hybrid 後消失 |
| 吊蘭 | 18 | 28 | 兩邊都錯，但 hybrid 更差 |
| 倒地鈴 | 12 | 28 | 同上 |

**結論**：多數擾亂是「hybrid 的候選池或合併策略」把 embedding 裡已有的正解排擠掉（或擠出 Top30），而不是單純分數算錯。可能原因：關鍵字召回（guess_names）沒帶到正解、或候選池過濾（如種子/苔蘚 gate）把正解濾掉、或合併時以 hybrid 為主覆蓋了 embedding 的好排名。

### 2.2 「不變」且雙 999：Embedding 與 Hybrid 都沒找到正解

多題為 999/999，代表正解不在兩邊的 Top30。可能原因：DB 缺該物種、名稱/別名未對上、或 query 描述與 DB 寫法差異大。

### 2.3 n/a 38 題

仍只有第一階段 embedding 結果、沒有跑第二階段 hybrid，因此沒有 embedding_only_plants。要嘛沒 traits、要嘛 isPlantFromTraits 未過，所以沒進 hybrid 分支。

### 2.4 錯誤 Top1 常客（霸榜）

報告裡錯誤 Top1 多次出現：**冇拱、八角蓮、鞭枝懸苔、草海桐、白檀** 等，代表這些條目在 embedding 或 hybrid 裡分數常偏高，容易搶走正解。

---

## 三、優化方案總覽（擇一或組合執行）

下面四個方案彼此可部分疊加，但建議**先選一個主軸**做一輪驗證，再視結果加選。

| 方案 | 目標 | 預期效果 | 改動範圍 |
|------|------|----------|----------|
| **A** | 減少「擾亂」：Hybrid 更保守 | 少 6～9 題被 hybrid 從有變無 | 權重/門檻 + 合併策略 |
| **B** | 補齊 n/a、補洞與別名 | 更多題可量測、部分 999→有排名 | index.js + 資料/別名 |
| **C** | 萬用條目輕度降權 | 減少霸榜、正解更容易 Top1 | start_api.py |
| **D** | 合併時 Embedding 優先（防擠掉正解） | 當 embedding 已 TopK 時，不讓 hybrid 完全覆蓋 | index.js 合併邏輯 |

---

## 四、方案 A：Hybrid 保守化（減少擾亂）

**思路**：擾亂多來自「hybrid 候選池或合併」把 embedding 裡已有的正解擠掉。讓 hybrid 只在「特徵明確、有鑑別力」時主導，其餘更依賴 embedding。

**具體步驟與修改**：

1. **提高「才做 hybrid 合併」的門檻**  
   - 在 **index.js** 中，當第二階段 `hybridResult.results` 有結果時，若 **feature 總分或匹配數很低**（例如 `feature_info` 總分 < 某閾值、或多數候選 feature_score 都很接近），則**不替換**第一階段結果，只回傳第一階段 + `embedding_only_plants`（或合併時以第一階段順序為底，hybrid 只做微調）。  
   - 實作方式：在現有「合併兩階段結果」的區塊前，若 `hybridResult.feature_info` 總分 < 0.15 或 匹配數 < 2，則 `plantResults = preSearchResults`（並帶上 `embedding_only_plants`），不執行 merge。

2. **（可選）提高 traits 品質門檻**  
   - 在 **traits-parser.js** 或呼叫 hybrid 前，若 `evaluateTraitQuality` 的 coverage 很低或 generic_ratio 過高，則**不呼叫 hybrid**，直接使用第一階段結果；這樣可減少「弱特徵」觸發的 hybrid 覆蓋。

3. **（可選）start_api 權重**  
   - 在 **start_api.py** 已用 E:0.75/F:0.25 的前提下，可再微調為 E:0.8/F:0.2，讓 embedding 主導力更強，減少 feature 把錯誤候選推上去。

**預期**：擾亂 9 題中，約 6 題原本 embedding 在 Top2～23，實施後有機會保留 embedding 排名或只做輕微合併，減少「有正解卻被 hybrid 洗掉」。

---

## 五、方案 B：補齊 n/a、補洞與別名

**思路**：38 題 n/a 無法評估；另有多題 999/999 可能是缺物種或名稱對不上。補齊資料與比對方式，讓通過率與可量測題數一起提升。

**具體步驟與修改**：

1. **第一階段也回傳 embedding_only_plants**（已在先前建議）  
   - 在 **index.js**：當**沒有進第二階段**（沒 traits 或 traits 判非植物）時，用 `detailedDescription` 或 description 前 80 字組一個簡短 query，呼叫一次 `smartSearch`，將結果寫入 `plant_rag.embedding_only_plants` 再回傳。  
   - 這樣 38 題 n/a 中多數會變成「有 Embedding-only 排名」，可與實際 Top1 比較（Hybrid 標 999 或 n/a）。

2. **依報告補物種/別名**  
   - 從報告挑「預期物種」在 DB 可能缺或名稱不一致的（例如 迷迭香、黑種草、彩葉草、楓樹、麵包樹、水竹芋、呂宋毛蕊木、吊蘭、倒地鈴 等），檢查是否在 **tlpg-manual-supplement.jsonl** 或主資料中；缺則補一筆簡要條目。  
   - 在 **verify_from_tlpg_url.js** 的 **COMMON_NAME_SYNONYMS** 中，為 TLPG 常用名與 DB 名不一致的加一組別名（例如 珠蔥↔某學名、越橘葉蔓榕↔瓜子蔓榕 若尚未存在）。

3. **（可選）放寬「進入第二階段」的條件**  
   - 當第一階段有結果但 traits 為空時，用 description 關鍵字組 query 仍呼叫一次 hybrid（並寫入 embedding_only_plants），可增加「有 hybrid 比較」的題數；若擔心擾亂，可與方案 A 並用（弱特徵不覆蓋）。

**預期**：n/a 從 38 降至約 10 以內；部分 999/999 因補洞或別名出現排名；通過數有機會從 4 提升。

---

## 六、方案 C：萬用條目輕度降權

**思路**：冇拱、八角蓮、鞭枝懸苔、草海桐、白檀 等反覆當錯誤 Top1，在分數上輕度壓制，讓其他候選有機會超前。

**具體步驟與修改**：

1. 在 **scripts/rag/vectordb/start_api.py** 的 hybrid 計分迴圈（以及若有純 embedding 後處理）中，對 `chinese_name` 屬於預設黑名單的候選，將 **最終分數 \* 0.88**（或 0.85～0.9 自訂），再排序。  
2. 黑名單建議初始名單：**冇拱、南亞孔雀苔、鞭枝懸苔、株苔、八角蓮、草海桐、白檀**（可依報告再增減）。  
3. 實作：在回傳前、排序前，對每個 result 若 `chinese_name in BLACKLIST_GENERIC` 則 `score *= 0.88`。

**預期**：錯誤 Top1 中由上述萬用條目霸榜的比例下降，正解有機會進 Top1；需監控是否誤傷（若某題正解剛好是 八角蓮 等則會吃虧，可把「僅在 embedding 路徑」或「僅在 hybrid 路徑」做降權以減少誤傷）。

---

## 七、方案 D：合併時 Embedding 優先（防 hybrid 擠掉正解）

**思路**：當第一階段 embedding 的 Top1（或 Top3）已經不錯時，不讓第二階段 hybrid 的結果「完全覆蓋」；改為以第一階段為底，只讓 hybrid 在「有明確特徵匹配」時提升某些候選，避免把 embedding 裡的正解擠出榜單。

**具體步驟與修改**：

1. **在 index.js 合併邏輯**：  
   - 目前是 `mergePlantResults(preSearchResults.plants, newResults.plants)` 後可能以合併結果為新順序。  
   - 改為：若 **第一階段 Top1 的 embedding_score 已 > 某閾值（如 0.64）且第二階段 Top1 的 feature_score 不高（如 < 0.2）**，則採用「以第一階段順序為主，只將第二階段中有明顯 feature 匹配且不在第一階段 Top10 的插入到合適位置」，而不是完全依合併後分數重排。  
   - 或更簡單：當 `hybridResult.results` 的 Top1 的 `feature_score < 0.15` 時，**不採用 hybrid 的順序**，直接回傳 `preSearchResults`（並帶上 `embedding_only_plants`），這樣可避免「弱特徵 hybrid」覆蓋掉 embedding 的好結果。

2. **（可選）帶入 embedding 排名**  
   - 若 API 回傳的 hybrid 結果中附帶「該候選在 embedding_only 的排名」，則合併時可寫規則：若某候選在 embedding 排名 ≤5 且 hybrid 未給它明顯加分，則不讓它被擠出 Top5。

**預期**：與方案 A 類似，減少「embedding 已有正解卻被 hybrid 洗掉」的擾亂題數。

---

## 八、建議選擇方式

- **若優先「止血擾亂」**：先做 **方案 A**（或 **方案 D**，二擇一或 A+D 一起做）。  
- **若優先「可量測與補洞」**：先做 **方案 B**。  
- **若優先「快速壓制霸榜」**：先做 **方案 C**。  
- 可組合：例如 **B + A**（補齊 n/a 並減少擾亂），或 **A + C**（保守 hybrid + 萬用降權）。

請直接回覆要執行的方案編號（例如：**A**、**B**、**A+B**、**A+C** 等），我會依你的選擇給出對應的具體修改片段與檔案位置，再由你確認後執行。

---

## 九、產品原則：不準確可以，錯誤放大不行（辨識導覽系統）

**你的需求**：這支程式會變成**辨識導覽系統**，要給使用者**正確或相對正確的資訊**。  
**紅線**：**花草→灌木、灌木→苔類** 這類「大類錯置」不能發生。可以不準確（例如錯的物種但同為灌木），但不能把大類搞錯。

**依此原則的建議**：

1. **優先做「大類一致」防錯（建議必做）**  
   - 當 Vision/traits 判斷為**種子植物**（灌木/草本/喬木/藤本）時，**絕不讓苔蘚/蕨類當 Top1**。  
   - 實作：在合併/產出最終候選名單後，若 traits 表示種子植物，則把候選名單中「苔蘚/蕨類」排到種子植物後面，讓 Top1 一定是種子植物（或至少不會是苔蘚蕨類）。  
   - 這樣可直接避免報告裡「迷迭香(灌木)→Top1 鞭枝懸苔(苔)」這類錯誤。

2. **方案 A + D（Hybrid 保守 + Embedding 優先）**  
   - 減少 hybrid 把「embedding 已有正解」洗掉，等於減少「對的變錯」的放大。  
   - 弱特徵時不讓 hybrid 覆蓋第一階段；必要時以第一階段順序為準。

3. **方案 C（萬用條目降權）可選**  
   - 鞭枝懸苔、株苔、南亞孔雀苔 等常錯當 Top1，適度降權可減少「灌木/草本照片→苔類 Top1」的機率，與大類防錯一致。

4. **不建議**在未加「大類一致」防錯前，單獨依賴 hybrid 或放寬 trait 門檻，以免更多 種子植物→苔類 的案例。

**建議執行順序**：先做 **大類一致防錯**（見下節實作），再視需要加 **A+D** 或 **C**。
