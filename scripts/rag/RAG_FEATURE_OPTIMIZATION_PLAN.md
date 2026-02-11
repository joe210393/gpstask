# RAG 特徵優化計畫：43 → 12–18 高品質特徵

> 依據 transcript 建議撰寫。目標：特徵數量不增反減，透過「類別上限 / 去雜訊 / Must Gate / 矛盾淘汰」提升 Top1/Top5 命中率。

---

## 一、現狀與問題

### 1.1 現有架構

| 組件 | 檔案 | 職責 |
|------|------|------|
| 特徵詞庫 | `feature_weights.py` FEATURE_VOCAB | 43 個特徵，約 17 個類別 |
| 特徵解析 | `traits-parser.js` traitsToFeatureList | Vision traits → 中文特徵列表 |
| 類別上限 | `traits-parser.js` capByCategoryAndResolveContradictions | 已有部分實作 |
| 混合搜尋 | `start_api.py` hybrid_search | embedding + feature + Gate-A 降權 |

### 1.2 現有 43 特徵的類別分布（FEATURE_VOCAB）

| 類別 | 特徵數 | 說明 |
|------|--------|------|
| life_form | 4 | 喬木/灌木/草本/藤本 |
| leaf_arrangement | 4 | 互生/對生/輪生/叢生 |
| leaf_type | 6 | 單葉/複葉/羽狀複葉/掌狀複葉/二回羽狀/三出複葉 |
| leaf_margin | 3 | 全緣/鋸齒/波狀 |
| flower_color | 6 | 白花/黃花/紅花/紫花/粉紅花/橙花 |
| flower_shape | 6 | 鐘形花/漏斗形花/唇形花/蝶形花/十字形花/放射狀花 |
| flower_position | 3 | 單生花/成對花/簇生花 |
| inflorescence_orientation | 2 | 直立花序/下垂花序 |
| flower_inflo | 8 | 總狀/圓錐/聚繖/繖房/頭狀/繖形/穗狀/佛焰花序 |
| fruit_type | 8 | 莢果/漿果/核果/蒴果/翅果/瘦果/堅果/梨果 |
| fruit_cluster | 4 | 單生果/成串果/總狀果/腋生果 |
| fruit_surface | 4 | 光滑果/有毛果/粗糙果/有棱果 |
| calyx_persistent | 1 | 宿存萼 |
| trunk_root | 2 | 板根/氣生根 |
| special | 4 | 有刺/乳汁/胎生苗/棕櫚 |

**總計約 64 個特徵值，跨 15 個類別。**

### 1.3 核心問題

1. **雜訊淹沒強特徵**：query 帶 30–40 個 feature 時，candidate 普遍能吃到一部分，分數差距拉不開。
2. **Gate 只降權不淘汰**：棕櫚/複葉 Gate-A 用 `*0.6` 或 `*0.25` 降權，錯誤候選仍可能進 Top5。
3. **矛盾規則不全**：目前僅做「複葉→移除單葉」，leaf_margin/leaf_arrangement/surface_hair 尚未系統化。
4. **信心門檻偏低**：traits-parser 用 0.65 入 hybrid，強特徵（fruit/inflo/special）建議提高到 0.55–0.65（分群）。

---

## 二、改進計畫與設計邏輯

### 2.1 類別上限（Cap by Category）

**目的**：將 43 個特徵壓成 12–18 個高品質特徵，減少雜訊、提高鑑別力。

**設計邏輯**：

- 每個類別最多保留 N 個特徵，依「區辨力」或「confidence」擇優。
- 超過上限時：優先保留 confidence 高、evidence 有內容的特徵。
- 總數若仍 > 18：再依 GENERIC_VALUES 或 base_w 較低者剔除。

**建議類別上限表**（對齊 FEATURE_VOCAB）：

| 類別 | 上限 | 備註 |
|------|------|------|
| life_form | 1 | 低權重，控量 |
| leaf_arrangement | 1 | 互斥 |
| leaf_margin | 1 | 互斥 |
| leaf_type | 1 | 細類優先，複葉細類優先於「複葉」 |
| flower_color | 1 | 花色互斥 |
| flower_shape | 1 | 花型互斥 |
| flower_position | 1 | - |
| inflorescence_orientation | 1 | - |
| flower_inflo | 1 | 繖房/聚繖等優先於總狀/圓錐 |
| fruit_type | 1 | - |
| fruit_cluster | 1 | - |
| fruit_surface | 1 | - |
| calyx_persistent | 1 | - |
| trunk_root | 1 | - |
| special | 2 | 乳汁/有刺/棕櫚/胎生苗 可共存 |

**實作位置**：`traits-parser.js` 的 `capByCategoryAndResolveContradictions`（已有 FEATURE_CATEGORY、CATEGORY_CAP，需補齊所有類別與上限）。

**執行順序**：先做「包含關係」，再做「互斥 + 類別上限」。

---

### 2.2 矛盾表擴充（互斥 + 包含）

**目的**：避免同類互斥特徵共存，細類優先於粗類。

**A. 互斥（同一類只能留一個）**：

| 類別 | 互斥組 |
|------|--------|
| leaf_margin | 全緣 vs 鋸齒 vs 波狀 |
| leaf_arrangement | 互生 vs 對生 vs 輪生 vs 叢生 |
| leaf_type | 單葉 vs 複葉（已有） |
| surface_hair | 無毛 vs 有毛（若納入） |

**B. 包含（出現細類則刪粗類）**：

| 粗類 | 細類 | 動作 |
|------|------|------|
| 複葉 | 羽狀複葉/掌狀複葉/二回羽狀/三出複葉 | 刪「複葉」 |
| 花序 | 繖房/頭狀/穗狀/繖形/佛焰… | 若 Vocab 有泛用「花序」則刪 |
| 果實 | 漿果/核果/蒴果/翅果… | 若 Vocab 有泛用「果實」則刪 |

**實作位置**：

- `traits-parser.js`：在 `capByCategoryAndResolveContradictions` 內，先做包含、再做互斥。
- 互斥時：保留 confidence 較高且 evidence 有內容者；另一側移除或降級。

---

### 2.3 提高強特徵門檻（品質過濾）

**目的**：減少「猜的特徵」進入 query，提升每個特徵可信度。

**設計邏輯**：

- 弱特徵（life_form / leaf_arrangement / leaf_margin）：維持 0.35–0.45。
- 強特徵（fruit_type / flower_inflo / special / trunk_root / flower_shape）：提高到 0.55–0.65。
- 若 evidence 過短（例如 < 6 字）：confidence × 0.8 再比對門檻。

**建議門檻表**（依 key 分群）：

| 類別 | 建議 conf_min |
|------|---------------|
| life_form, leaf_arrangement, leaf_margin | 0.35–0.45 |
| flower_color, flower_position, inflorescence_orientation | 0.40–0.50 |
| leaf_type | 0.45–0.55 |
| fruit_type, flower_inflo, special, trunk_root | 0.55–0.65 |
| flower_shape | 0.50（鐘形花保底規則維持） |

**實作位置**：`traits-parser.js` 的 `traitsToFeatureList`、`PER_KEY_MIN_CONF`、`STRONG_TRAIT_KEYS`、`WEAK_MIN`、`STRONG_MIN`。

---

### 2.4 Must Gate 升級（兩層：硬淘汰 + 軟降權）

**目的**：對高信心、強區辨特徵，候選若完全無描述 → 淘汰；其餘維持軟降權。

**第一層（硬淘汰）**：只對下列「高置信、強區辨」特徵啟用。

| 類別 | 特徵 | conf 門檻 |
|------|------|----------|
| leaf_type | 羽狀複葉/掌狀複葉/二回羽狀/三出複葉 | ≥ 0.65 |
| special | 棕櫚、乳汁、有刺 | ≥ 0.65 |
| trunk_root | 氣生根、板根 | ≥ 0.65 |
| fruit_type | 蒴果/漿果/核果/翅果/莢果 | ≥ 0.65 |
| flower_inflo | 佛焰花序、頭狀花序 | ≥ 0.65 |

**規則**：

- 若 query 中該特徵 confidence ≥ 0.65 且 evidence 非空；
- 候選端（key_features_norm / trait_tokens / summary）完全找不到同義詞；
- → 直接淘汰（不回傳該候選）。

**第二層（軟降權）**：confidence 在 0.45–0.65 之間，維持現有 `*0.6` 或 `*0.75` 降權。

**實作位置**：

- `feature_weights.py` 的 `match_plant_features`：回傳 `hard_reject`（bool）欄位。
- `start_api.py` 的 `hybrid_search`：若 `hard_reject=True`，將該候選從 final_candidates 移除（或設為 exclude）。
- 需定義 HARD_GATE_TRAITS、HARD_GATE_CONF_MIN 常數。

---

### 2.5 觀測指標調整

**目的**：用更細的指標觀察優化效果。

**建議觀測**：

1. **Top1 命中率**：Ground truth 是否在 Top1。
2. **Top5 命中率**：Ground truth 是否在 Top5。
3. **強特徵命中率**：query 有蒴果時，Top30 裡至少 5 筆含蒴果。
4. **Query 特徵數**：平均從 traits 出來的特徵數量（目標 12–18）。

---

## 三、實作順序與依賴

```
Phase 1（最快見效）
├── 1. 類別上限 capByCategoryAndResolveContradictions 補齊
└── 2. 矛盾表擴充（包含 + 互斥）

Phase 2
├── 3. 提高強特徵門檻（traits-parser PER_KEY_MIN_CONF）
└── 4. 確認 traitsToFeatureList 最終呼叫 capByCategoryAndResolveContradictions

Phase 3（需改 feature_weights + start_api）
└── 5. Must Gate 兩層（硬淘汰 + 軟降權）
```

**不重跑向量的條件**：僅改 traits / Gate / 矛盾規則、不改 text_for_embedding 或向量模型，則**無需重跑 embedding**。

---

## 四、驗證報告

- **對比基準**：`scripts/rag/verify-report-embed-v2.md`（67 筆 tlpg 網址，通過 1 筆）
- 優化後可重跑 `verify_from_tlpg_url.js` 產生新報告，對比 Top1/Top5 命中率

---

## 五、狀態（已執行）

✅ **已執行**（2025-02-05）：
1. Phase 1：類別上限 + leaf_type/flower_color 優先順序
2. Phase 2：強特徵門檻提高（PER_KEY_MIN_CONF、STRONG_MIN 0.58）
3. Phase 3：Must Gate 硬淘汰啟用（feature_weights.py HARD_GATE_TRAITS + start_api.py 過濾）
