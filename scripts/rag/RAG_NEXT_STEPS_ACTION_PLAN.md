# RAG 優化：下一步完整執行計畫

> 融合 reviewer 建議與實測結果，提供可執行的具體步驟、邏輯與驗證方式。

---

## 一、現況摘要

### 已完成的工項
| 工項 | 狀態 | 效果 |
|------|------|------|
| 矛盾處理 v0（複葉時移除單葉） | ✅ | 減少 query 自相矛盾 |
| feature_score 標準化（matched/query_total） | ✅ | 拉開分數差距 |
| P0：棕竹/黃椰子進 hybrid | ✅ | 棕竹 Top1 正確，黃椰子在 Top6 |

### 2/12 測試結果（最新）
- ✅ 棕竹、小金雀花 正確
- 黃椰子：Top1 華盛頓椰子，正解在 #6（66.7%），差距極小
- 其餘：traits 仍偏通用（灌木/單葉/全緣/圓錐），鑑別力不足

### 核心瓶頸（依影響排序）
1. **棕櫚/複葉 Gate 未啟用**：黃椰子正解已在 Top6，缺少「壓榕樹/山茶」的 gate
2. **生活型佔用特徵額度**：灌木/喬木幾乎每筆都有，拉高 generic_ratio
3. **強特徵未被抽取**：果實、花序型、葉緣鋸齒等在 LM 有提但 query 無

---

## 二、下一步工項（按優先級與影響力）

---

### 工項 A：輕量 Must Gate（棕櫚/複葉 Gate）

**目標**：當 query 有棕櫚/複葉特徵時，對「無棕櫚/複葉相關描述」的候選降權，把榕樹/山茶壓下去。

**邏輯**：
- Query 有 `羽狀複葉`、`掌狀複葉`、`棕櫚`（或 keyword fallback 擷取的類似詞）→ 啟用 Gate-A
- 候選植物的 `key_features` / `summary` / `key_features_norm` 中**完全沒有**棕櫚/複葉相關詞 → `hybrid_score *= 0.6`
- 採用乘法降權（不淘汰），避免誤殺

**實作位置**：`scripts/rag/vectordb/start_api.py`，在 `hybrid_score` 計算完成、`results.append` 之前，與現有 Must Gate、SOFT 矛盾並列。

**判斷條件**：
```
query_has_palm_compound = any(f in features for f in ['羽狀複葉','掌狀複葉','二回羽狀','三出複葉','複葉']) 
  or '棕櫚' in (query or '') 
  or (traits and 從 traits 推斷有 compound/pinnate)

plant_has_palm_compound = 檢查 payload 的 key_features/summary/key_features_norm 是否含：
  '羽狀複葉','掌狀複葉','棕櫚','扇形','複葉','棕櫚科' 等
```

**驗證**：黃椰子案例，正解應從 Top6 推進至 Top2 或 Top1。

---

### 工項 B：生活型降權

**目標**：降低「灌木/喬木/草本」對特徵匹配的影響，避免佔用鑑別力。

**邏輯**：
- 在 `feature_weights.py` 的 `FEATURE_VOCAB` 中，將 `life_form` 的 base_w 從 0.05 調至 0.02，max_cap 同步調低
- 或：當 query 特徵數 ≥ 4 時，生活型權重減半（僅在 match 時套用）

**實作位置**：`scripts/rag/vectordb/feature_weights.py`，修改 `life_form` 對應的 `base_w` / `max_cap`。

**驗證**：12 筆中，強特徵（複葉/果實/花序型）的權重占比上升，generic_ratio 下降。

---

### 工項 C：強特徵權重提升

**目標**：讓複葉、果實、花序型等「高區辨力」特徵在 scoring 中更有影響力。

**邏輯**：
- 在 `FEATURE_VOCAB` 中提高以下特徵的 base_w / max_cap：
  - 羽狀複葉、掌狀複葉、二回羽狀、三出複葉
  - 漿果、核果、蒴果（若 LM 有提果實）
  - 頭狀花序、繖形花序、穗狀花序（相較於圓錐/總狀更稀有）

**實作位置**：`scripts/rag/vectordb/feature_weights.py`。

**驗證**：有強特徵的 query（如棕櫚、果實）分數拉開更明顯。

---

### 工項 D：extractFeaturesFromDescriptionKeywords 擴充

**目標**：當 traits JSON 失敗時，從 LM 描述擷取更多強特徵（果實、花序型等）。

**邏輯**：
- 擴充 `extractFeaturesFromDescriptionKeywords` 的關鍵字列表
- 新增：漿果、核果、蒴果、頭狀花序、繖形花序、穗狀花序、鋸齒 等
- 當 description 含「紅色果實」「漿果」「頭狀花序」等，加入對應 features

**實作位置**：`scripts/rag/vectordb/traits-parser.js`。

**驗證**：西印度櫻桃、金露花等有果實描述的 case，query 應出現果實特徵。

---

### 工項 E：Vision Prompt 強化（選做，後置）

**目標**：從源頭減少「補齊成通用模板」的狀況。

**邏輯**：
- 在 `VISION_ROUTER_PROMPT` 中加入：「看不到就填 unknown，禁止猜測」「寧可 2–4 個有證據的特徵，不要湊滿 5 個通用特徵」
- 特別強調：葉序、花序、果實需有明確證據才填

**實作位置**：`scripts/rag/vectordb/feature_weights.py`。

**驗證**：下一輪測試中，generic 模板比例下降。

---

## 三、建議執行順序

```
A（Gate-A）→ B（生活型降權）→ C（強特徵權重）
     ↓
  驗證黃椰子、棕竹
     ↓
D（keyword 擴充）→ E（Vision prompt，選做）
```

**理由**：Gate-A 可直接驗證黃椰子 Top1；B、C 提升整體區辨力；D、E 從輸入端改善，需較長驗證週期。

---

## 四、各工項實作細節

### 工項 A 實作細節

**插入點**：`start_api.py` 約 1052 行，在 `# SOFT 矛盾重罰` 之前。

**偽碼**：
```python
# Gate-A: 棕櫚/複葉 gate（query 有則候選需有）
PALM_COMPOUND_QUERY_TOKENS = {'羽狀複葉', '掌狀複葉', '二回羽狀', '三出複葉', '複葉'}
PALM_COMPOUND_PLANT_KEYWORDS = ['羽狀複葉', '掌狀複葉', '棕櫚', '扇形', '複葉', '棕櫚科', '掌狀', '三出複']

def _plant_has_palm_compound(payload) -> bool:
    text = " ".join(_to_str(x) for x in [
        payload.get("key_features", []),
        payload.get("key_features_norm", []),
        payload.get("summary", ""),
    ])
    return any(kw in text for kw in PALM_COMPOUND_PLANT_KEYWORDS)

# 在計算 hybrid_score 後：
if features and any(f in PALM_COMPOUND_QUERY_TOKENS for f in features):
    if not _plant_has_palm_compound(r.payload):
        hybrid_score *= 0.6  # 降權
```

**注意**：traits 可能為 null（keyword fallback 路徑），故 gate 判斷應以 `features` 為主，必要時可檢查 query 字串是否含「棕櫚」。

---

### 工項 B 實作細節

**修改**：`feature_weights.py` 第 25–29 行。

```python
# 原
"喬木": {"en": "tree", "base_w": 0.05, "max_cap": 0.05},
"灌木": {"en": "shrub", "base_w": 0.05, "max_cap": 0.05},
"草本": {"en": "herb", "base_w": 0.05, "max_cap": 0.05},
"藤本": {"en": "vine", "base_w": 0.06, "max_cap": 0.06},

# 改
"喬木": {"en": "tree", "base_w": 0.02, "max_cap": 0.03},
"灌木": {"en": "shrub", "base_w": 0.02, "max_cap": 0.03},
"草本": {"en": "herb", "base_w": 0.02, "max_cap": 0.03},
"藤本": {"en": "vine", "base_w": 0.03, "max_cap": 0.04},
```

---

### 工項 C 實作細節

**修改**：`feature_weights.py` 的 leaf_type、花序、果實。

```python
# leaf_type - 複葉提高
"羽狀複葉": base_w 0.07, max_cap 0.12
"掌狀複葉": base_w 0.08, max_cap 0.12
"二回羽狀": base_w 0.10, max_cap 0.15

# 果實（若有）
"漿果": base_w 0.08, max_cap 0.12
"核果": base_w 0.07, max_cap 0.11
```

---

## 五、不執行的項目（已決策）

| 項目 | 原因 |
|------|------|
| Popularity penalty | 需辨識所有植物，不宜懲罰高頻物種 |

---

## 六、驗證 KPI

1. **黃椰子**：正解從 Top6 推至 Top2 或 Top1
2. **棕竹**：維持 Top1 正確
3. **強特徵多樣性**：12 筆中 >6 筆 query 含非通用特徵（複葉/果實/花序型）
4. **Top1 通過數**：目標 3/12 以上

---

若確認此計畫，將依序實作：**A → B → C**，完成後可進行一輪驗證，再決定是否執行 D、E。
