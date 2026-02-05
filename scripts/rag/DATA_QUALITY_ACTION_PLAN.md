# 資料品質與 Feature Matching 行動方案

> 對照建議與實際程式碼後，逐項驗證並給出可執行方案。

---

## 一、建議是否合理？逐項驗證

### 問題 1：沒有 trait_tokens / must_traits / life_form

**現況驗證**：
- `plants-forest-gov-tw-dedup.jsonl` 中 **金絲梅**（小金雀花 Top1 的競品）：
  - `identification.trait_tokens`：**不存在**
  - `identification.key_features`：`["常見植物","缺乏詳細描述資料","生活型：草本（推測，基於常見植物的特性）"]`
  - 幾乎沒有可匹配的形態特徵

**結論**：✅ 成立。低品質筆會讓 feature matching 落空，只能靠 embedding 排序。

---

### 問題 2：embed 腳本 payload 未 flatten trait_tokens / key_features_norm

**現況驗證**：

| 腳本 | payload 欄位 | trait_tokens | key_features_norm |
|------|-------------|--------------|-------------------|
| `embed_plants_forest_jina.py` | key_features ✅ | ❌ 無 | ❌ 無 |
| `reset_qdrant_clean.py` | 同上 + trait_tokens + key_features_norm | ✅ | ✅ |

**start_api.py** 讀取方式：
```python
plant_trait_tokens = r.payload.get("trait_tokens", [])   # 若無 → []
plant_key_features_norm = r.payload.get("key_features_norm", [])  # 若無 → []
# fallback: 用 key_features 動態轉換
```

若使用 **embed_plants_forest_jina.py** 作為主流程，payload 確實沒有 `trait_tokens`、`key_features_norm`，只能依賴 fallback。fallback 能運作，但：
- 每筆都要在 runtime 做 `key_features_to_trait_tokens`、`normalize_features`
- 若 `key_features` 為空或品質差（如金絲梅），fallback 也救不了

**結論**：✅ 成立。建議在 embed 時就把 `trait_tokens`、`key_features_norm` 寫入 payload。

---

### 問題 3：trait_tokens 多值/矛盾（同一 prefix 多個值）

**現況**：如一品紅 `flower_color=red` 與 `flower_color=white` 並存；七日暈 `flower_color` 有 purple/red/white/orange。

**影響**：候選變成「什麼都中」的萬用模板，易成為聚類中心。

**結論**：✅ 成立。應限制「同一 prefix 只保留一個值」。

---

### 問題 4：key_features_norm 非原子、含 `/`、截斷

**現況**：如 `互生/叢生`、`波狀緣/鈍齒緣`、`三出複`（缺「葉」）。

**影響**：query 用「三出複葉」時，候選「三出複」 match 不到。

**結論**：✅ 成立。需要正規化與補全。

---

### 問題 5：苔蘚/藻類混入、scientific_name 缺失

**結論**：✅ 可選。若主場景是園藝/維管束植物，可考慮分庫或主庫排除苔蘚藻類。

---

## 二、邏輯、方法與為何這樣做

### P0-A：Payload 補齊（embed 時寫入 trait_tokens、key_features_norm）

**為什麼**：
- 避免 runtime fallback，且 payload 與 indexing 邏輯一致
- 之後若要做 trait 清洗，只需在寫入前處理一次

**怎麼做**：
- 在 `embed_plants_forest_jina.py` 的 payload 建構處，加入：
  - `trait_tokens`: `plant.get("identification", {}).get("trait_tokens", [])`
  - `key_features_norm`: `plant.get("identification", {}).get("key_features_norm", [])`
- 若沒有，再 fallback 到從 `key_features` 動態產生（與 start_api 邏輯一致）

**是否需要重跑向量**：❌ 不需要。只改 payload，不改 embedding 文字與向量。

---

### P0-B：trait_tokens 瘦身（同一 prefix 只留一值）

**為什麼**：
- 多值會讓候選變成萬用模板，降低區辨力

**怎麼做**：
- 對每筆 `trait_tokens`，依 prefix 分組（如 `life_form=`, `flower_color=`）
- 每個 prefix 只保留一個值（可選：留第一個、或挑 evidence/confidence 較高的）
- 建議在 **資料 pipeline**（如 clean / dedup 後、embed 前）做一次

**實施位置**：可在 `dedup_plant_data.js` 或新建 `enrich_plant_traits.js` 中處理。

---

### P0-C：key_features_norm 原子化與同義詞正規化

**為什麼**：
- `三出複`、`互生/叢生` 等會造成 match 失敗

**怎麼做**：
- 建立 normalize dict，例如：
  - `三出複` → `三出複葉`
  - `羽狀複` → `羽狀複葉`
  - `互生/叢生` → 拆成二選一（依 evidence 或預設取第一個）
- 含 `/` 的拆開後只保留一個
- 執行時機：clean 或 dedup 階段

---

### P0-D：低品質筆 Gate（排除或降權）

**為什麼**：
- 如金絲梅這種「缺乏詳細描述」「推測」的筆，會拖累排序

**怎麼做**：
1. **排除主庫**（較嚴格）：`trait_tokens` 為空或過短、`key_features_norm` 含「推測」「缺乏」「不明」「未見」等 → 不寫入主庫
2. **或降權**（較溫和）：仍寫入，但在 hybrid 計分時對「低品質」標記的筆乘 0.3～0.5

**實施位置**：在 embed 前 filter，或 payload 加 `quality_score` 供 start_api 使用。

---

### P1（可選）：苔蘚/藻類分庫、scientific_name 完整性

**為什麼**：語彙與維管束植物差異大，易干擾；scientific_name 缺漏會影響去重與對照。

**怎麼做**：主庫只收 `scientific_name` 較完整、且非苔蘚藻類的筆；其餘可放副庫或延後處理。

---

## 三、建議實施順序與成本

| 優先 | 項目 | 成本 | 影響 | 需重跑向量？ |
|------|------|------|------|-------------|
| P0-A | Payload 補齊 trait_tokens / key_features_norm | 低 | 高 | ❌ 否（需 re-upsert payload） |
| P0-B | trait_tokens 瘦身 | 中 | 高 | ❌ 否 |
| P0-C | key_features_norm 原子化 | 中 | 高 | ❌ 否 |
| P0-D | 低品質筆 Gate | 低 | 中 | ❌ 否（僅 filter 或降權） |
| P1 | 苔蘚分庫 / scientific_name | 高 | 中 | 視是否改主庫而定 |

---

## 四、執行前需確認的兩件事

1. **目前生產環境的 Qdrant 是用哪個腳本寫入的？**
   - `embed_plants_forest_jina.py`：主流程，payload 缺 trait_tokens / key_features_norm
   - `reset_qdrant_clean.py`：有完整 payload，但未必是日常使用腳本

2. **Embedding 用的欄位是哪一個？**
   - `embed_plants_forest_jina.py` 的 `build_search_text()` 使用：summary、key_features、trait_tokens、query_text_zh
   - 若只改 payload、不改 `build_search_text` 的輸入，則 **不需要重跑向量**

---

## 五、最小可行方案（建議先做）

### Step 1：修改 embed_plants_forest_jina.py payload（P0-A）

在 payload 中加入：
```python
"trait_tokens": plant.get("identification", {}).get("trait_tokens", []),
"key_features_norm": plant.get("identification", {}).get("key_features_norm", []),
```

之後需 **re-upsert** 到 Qdrant（payload 更新，向量可沿用）。

### Step 2：建立 enrich 腳本（P0-B + P0-C）

- 讀取 dedup 後的 jsonl
- 對每筆：trait_tokens 瘦身、key_features_norm 原子化
- 輸出新的 jsonl 供 embed 使用

### Step 3：低品質 Gate（P0-D）

- 在 embed 前：跳過或標記 trait_tokens 為空、key_features 含「推測」「缺乏」的筆

---

## 六、你需要決定的項目

請依優先級勾選：

- [ ] **P0-A**：embed 時補齊 trait_tokens、key_features_norm
- [ ] **P0-B**：trait_tokens 瘦身（同 prefix 只留一值）
- [ ] **P0-C**：key_features_norm 原子化與同義詞正規化
- [ ] **P0-D**：低品質筆排除或降權
- [ ] **P1**：苔蘚分庫、scientific_name 完整性（可延後）

回覆勾選項目後，可依此產出對應的實作腳本與程式修改。

---

## 七、執行 Runbook（已實作）

### 完整流程（以效果最佳為目標）

```bash
# 1. 資料強化（trait 瘦身、原子化、低品質 Gate）
npm run enrich:plant-data

# 2. 重置 Qdrant（清空舊資料）
./scripts/rag/reset_local_qdrant.sh

# 3. 刪除 embed 進度檔（強制從頭跑）
rm -f scripts/rag/vectordb/embed_plants_forest_jina_progress.json

# 4. 重新向量化（會自動使用 enriched 資料）
USE_JINA_API=false ./scripts/rag/run_local_embed.sh
# 或使用 Jina API：USE_JINA_API=true JINA_API_KEY=xxx ./scripts/rag/run_local_embed.sh

# 5. 驗證
APP_URL=http://localhost:3000 npm run verify:tlpg -- -v --report ./test-report-12.md
```

### 已實作項目

| 項目 | 檔案 | 說明 |
|------|------|------|
| P0.6 資料強化 | `enrich_plant_data.js` | trait_tokens 瘦身、key_features_norm 原子化、低品質 Gate |
| Payload 補齊 | `embed_plants_forest_jina.py` | 寫入 trait_tokens、key_features_norm、quality_score |
| 資料來源優先 | `embed_plants_forest_jina.py` | 優先使用 enriched > dedup > clean |
| 低品質降權 | `start_api.py` | hybrid_score *= quality_score（0.3） |
| npm script | `package.json` | `npm run enrich:plant-data` |
