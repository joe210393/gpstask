# 改進建議檢視報告

對照改進建議與目前程式碼現況，評估合理性、補充點、以及與既有實作的衝突。

---

## 1) TraitsParser 映射缺失補齊

### 建議內容
- 補齊 racemose→總狀、spiral→螺旋葉序
- 新增 leaf_type / compound_type（單葉/複葉、羽狀/掌狀）
- 阻擋 flower_color 誤塞種子顏色（紅種子/白種子→丟棄或移到 seed_color）

### 現況
- **traits-parser.js** 有 traitValueMap，但缺少：racemose、spiral、pinnate（作為 leaf_type）、pinnately_compound
- 已有 seed_color 映射（黑種子、紅種子等），但 Vision 可能把種子顏色填到 flower_color
- validTraits 有 leaf_arrangement、leaf_shape，沒有獨立的 leaf_type

### 評估：✅ 合理，建議執行
- 映射缺失與測試案例一致
- flower_color/seed_color 混淆有實際案例
- leaf_type 對單葉/複葉區分很重要（棕竹、黃椰子、火筒樹等）

### 補充
- 可一併補：`pinnately_compound`、`racemose`、`spiral`
- leaf_type：`simple`→單葉、`compound`→複葉、`pinnate`→羽狀複葉、`palmate`→掌狀複葉

---

## 2) top_k 擴大到 30~50 + union + 第三段 rerank

### 建議內容
- Stage1、Stage2 各取 30~50
- 合併候選後做第三段 rerank（規則或 LLM）

### 現況
- **index.js**：smartSearch(…, 3)、hybridSearch(…, topK: 3) → 只取 3 筆
- **start_api.py**：search_plants 用 `limit=top_k`，hybrid_search 內部 candidate_limit=max(60, top_k*10)，即 top_k=3 時仍取 60 候選，但只回傳前 top_k

### 評估：✅ 合理，建議執行
- 正確答案常落在 4~60 名，擴大 top_k 有助提升召回
- 瓶頸在 Node 端只傳 topK: 3，需改為 30~50

### 注意
- 擴大 top_k 會增加後續 rerank 負擔，需考慮延遲

---

## 3) 拿掉固定 +0.15 gate，改合併打分

### 建議內容
- 不要「先選一段再替換」，改為兩段候選合併後用同一 final_score 排序

### 現況
- **index.js** 約 3672 行：`if (newTopScore > preTopScore + 0.15)` 才替換
- 案例 3（金雀花）即因 gate 未被採用

### 評估：✅ 合理，建議執行
- 與測試案例觀察一致
- 合併打分可避免「第二階段找到正確答案卻被擋」的情況

---

## 4) must_traits 矛盾淘汰（負向邏輯）

### 建議內容
- 若 query traits 與候選 must_traits 矛盾 → 淘汰或重罰

### 現況
- **start_api.py** 約 795 行：**Must Gate 已禁用**（註解：「先把 must Gate 拿掉」）
- 僅保留軟性懲罰：`must_matched=False` 時 hybrid_score *= 0.3
- **feature_weights.py** 的 match_plant_features 會算 must_matched，但 start_api 沒有用來過濾，只做降權

### 評估：⚠️ 部分衝突
- 之前曾關閉 Must Gate，推測是過度過濾導致結果過少
- 建議改為「矛盾淘汰」而非「must 全匹配才過」：
  - 例如 query=opposite、plant=alternate → 淘汰
  - 只擋明確矛盾，不要求全部 must 都匹配

### 補充
- 植物資料有 must_traits（如 `["life_form=shrub","leaf_arrangement=opposite"]`）
- 可實作：query 與 plant 的 leaf_arrangement、leaf_type 等若明顯矛盾則淘汰

---

## 5) IDF 加權 + 動態權重

### 建議內容
- 依 traits 品質動態調整 embed/feature 權重
- feature 內部用 IDF：稀有特徵權重提高

### 現況
- **feature_weights.py** 已有 IDF：`idf = ln((N+1)/(df+1))`，RareCoef，get_weight 使用
- 但 **FEATURE_VOCAB / FEATURE_INDEX** 詞彙有限，不少 key_features_norm 不在內，會被略過
- **start_api.py**：EMBEDDING_WEIGHT=0.6、FEATURE_WEIGHT=0.4 為固定值

### 評估：✅ 合理，可強化
- IDF 機制已存在，問題在詞彙覆蓋與權重使用方式
- 動態權重（traits 多且信心高時提高 feature 權重）尚未實作

### 補充
- 可擴充 FEATURE_VOCAB，納入更多 key_features_norm
- 或改為從植物資料動態建立 df，對不在 FEATURE_VOCAB 的詞也計算 IDF

---

## 6) Popularity penalty + MMR 多樣化

### 建議內容
- 對近期常被選中的物種（錦帶花、美蕊花等）施加懲罰
- 回傳時加入 MMR，避免結果過度相似

### 現況
- 無 popularity 懲罰
- 無 MMR 或多樣化邏輯

### 評估：✅ 合理，可作為進階優化
- 適合在 1–3 做完、辨識率提升後再導入

---

## 7) Vision 提示詞：「沒看到就不要猜」

### 建議內容
- 要求 evidence 必須指向可見線索
- 不確定就填 unknown，減少亂猜

### 現況
- Vision 的 traits 分析 prompt 在 **ai-lab.js** 或 API 端，需再確認
- **feature_weights.py** 的 VISION_ROUTER_PROMPT 為路由用，非 traits 分析

### 評估：✅ 合理
- 有助減少花色/葉色混淆與亂填特徵
- 需找到實際負責 traits 分析的 prompt 並修改

---

## 已做過、需注意的實作

| 項目 | 現況 | 與建議的關係 |
|------|------|--------------|
| Must Gate | 已禁用，改為 0.3x 懲罰 | 建議 4 的「矛盾淘汰」與舊 Must Gate 不同，可並存 |
| 第一階段候選傳入第二階段 | guessNames 已傳第一階段植物名 | 與建議 2 的 union 概念相容 |
| 長查詢 POST | 已改為 POST 避免 URL 過長 | 無衝突 |
| Content-Length | POST 已帶 Content-Length | 無衝突 |

---

## 建議實作順序（與原建議對齊）

1. **TraitsParser 補齊**（映射、leaf_type、flower/seed 混淆處理）
2. **top_k 擴大**（Node 端改為 30~50）+ 合併候選
3. **移除 +0.15 gate**，改為合併打分
4. **矛盾淘汰**（query vs plant 的 leaf_arrangement、leaf_type 等）
5. **動態權重**（依 traits 品質調整 embed/feature）
6. **Popularity penalty + MMR**（進階優化）
7. **Vision prompt 調整**（「沒看到就 unknown」）

---

## 可再強化的地方

1. **FEATURE_VOCAB 擴充**：加入更多 key_features_norm（四方形枝條、掌狀深裂、稜角鉤刺等）
2. **矛盾規則具體化**：明確定義 leaf_arrangement、leaf_type、生活型等何種組合視為矛盾
3. **LLM Reranker**：若規則 rerank 效果有限，可評估用 Gemma 3 12B 做第三段 rerank
