# 改進建議評估報告 V2

依你提供的 (A) 動態權重、(B) Must Gate / 矛盾淘汰、以及 RAG 重複植物問題，進行評估與實作建議。

---

## 一、重複植物問題（應最優先處理）

### 現況

| 項目 | 數值 |
|------|------|
| clean.jsonl 總筆數 | 4,188 |
| 唯一 chinese_name | 3,834 |
| **重複筆數** | **354 (~8.5%)** |

高頻重複例：大冇樹(4)、七里香(4)、鳳凰木(3)、鐵樹(3)、虎爪豆(3)、羊蹄甲(3)、紫藤(3)、楮樹(3) 等。

### 影響

1. **Top30 被同物種多筆佔據**：搜尋時同一物種多個 vector 同時進候選，mergePlantResults 雖會以 chinese_name 去重，但已浪費候選 slot。
2. **向量空間稀釋**：同物種多筆 embedding 分散相似度，正確答案排名被壓低。
3. **特徵匹配分散**：同一植物若有不同來源描述，特徵會被拆到多筆，影響 feature 分數。

### 建議對策

**階段 1：資料層去重（需重新向量化）**

- 依 `scientific_name` 或 `chinese_name` 合併同物種多筆：
  - 合併 `identification.summary`、`key_features` 等，形成一筆主檔。
  - 若同種異名（如 七里香／海桐），可保留 common_names 串接，但只留一筆向量。
- 產出 `plants-forest-gov-tw-dedup.jsonl`，再重新 embed → Qdrant。

**階段 2：查詢端去重（不改向量，立即可做）**

- `mergePlantResults` 已用 `chinese_name` 去重，可考慮擴展為：
  - 以 `scientific_name` 為次要鍵：同學名不同中文名也視為同種，取最高分保留。
- 這只影響合併結果，不影響 Qdrant 內重複，但可減少 UI 顯示重複。

**結論**：重複植物會直接影響排序與召回，應列為 **P0.5**（P0 資料清理之後、其他演算法優化之前）處理。

---

## 二、A) 動態權重 — 評估與建議

### 建議公式 vs 現況

| 面向 | 建議內容 | 現況 | 評估 |
|------|----------|------|------|
| **Q 組成** | `Q = 0.4*coverage + 0.4*conf + 0.2*spec` | `Q = 0.55*keyAvg + 0.25*secAvg + 0.20*coverage`，無 spec | 建議較完整 |
| **coverage** | `clamp(n/6, 0, 1)` | `min(1, n/6)` | 實質相同 |
| **spec** | `generic_ratio` 懲罰，generic 清單明確 | 有 `genericRatio`，GENERIC_TRAITS 定義不同 | 建議的 generic 清單更貼合實際 |
| **權重區間** | Q&lt;0.30 → wF=0.10；0.55–0.75 → 0.5/0.5；Q≥0.75 → wF=0.70 | Q&lt;0.4→wF=0.25；…；Q≥0.75→wF=0.70 | 建議在低 Q 時更保守 |

### 建議的 generic 清單（可直接採用）

```text
互生、對生、喬木、灌木、草本、全緣、鋸齒、卵形、橢圓形、披針形、常綠、落葉
```

目前 GENERIC_TRAITS 是 key 層級（life_form, phenology…），建議改為 **value 層級**（轉成中文後比對），才能對應「互生、灌木、全緣」等實際高頻詞。

### 建議的權重區間表

| Q 區間 | w_feat | w_embed | 說明 |
|--------|--------|---------|------|
| Q < 0.30 | 0.10 | 0.90 | traits 很不可靠，幾乎不看 feature |
| 0.30 ≤ Q < 0.55 | 0.30 | 0.70 | 與現況接近 |
| 0.55 ≤ Q < 0.75 | 0.50 | 0.50 | 平衡 |
| Q ≥ 0.75 | 0.70 | 0.30 | 高品質 traits 主導 |

### 可加強之處

1. **generic 清單**：建議再納入 `革質、光滑、無毛、木質莖、草質莖` 等常見描述。
2. **conf 公式**：`(avg_conf - 0.45) / 0.35` 會把 0.45 以下壓成 0，邊界可再微調（例如 0.4）。
3. **debug log**：建議輸出的 `Q, n, avg_conf, generic_ratio, wE, wF` 非常有幫助，應保留並納入正式 log。

**結論**：建議採納整體設計，並：
- 實作 spec 與建議的 generic 清單；
- 調整 Q 公式與權重區間；
- 強化日誌輸出以便調參。

---

## 三、B) Must Gate / 矛盾淘汰 — 評估與建議

### 核心結論

> traits 來源為 Vision+LLM，易出錯，因此：**Hard Gate 少用、Soft Penalty 為主**。

這點與目前做法一致，方向正確。

### Hard Must Gate（硬門）

| 規則 | 建議 | 評估 | 備註 |
|------|------|------|------|
| Gate-1 棕櫚/掌狀 | query 有掌狀/扇形/palm → 候選無相關特徵則淘汰 | ✅ 合理 | 棕竹、黃椰子案例直接相關 |
| Gate-2 複葉 vs 單葉 | query 羽狀複葉 → 候選單葉則淘汰 | ✅ 合理 | 火筒樹案例相關；需確認 payload 有複葉資訊 |
| Gate-3 葉序對立 | query 對生/互生、conf≥0.75 → 候選相反則淘汰 | ⚠️ 謹慎 | 葉序誤提取多（對生→互生），conf 門檻必須嚴格 |

**實作注意**：

- payload 需能解析「掌狀、羽狀複葉、單葉」：檢查 `key_features`、`key_features_norm`、`identification.morphology` 等。
- Gate-3 建議 `conf_min ≥ 0.80`，並先以 soft penalty 觀察，再考慮升級為 hard gate。

### Soft Contradiction（軟矛盾）

**現況**：`SOFT_RULES` 僅 2 條：

- leaf_arrangement（conf≥0.5, penalty 0.20）
- life_form（conf≥0.6, penalty 0.12）

**建議擴充**：

| 優先級 | 規則 | severity | 評估 |
|--------|------|----------|------|
| P1 | 複葉 vs 單葉 | 0.8 | ✅ 高鑑別力 |
| P1 | 棕櫚類缺失 | 0.8 | ✅ 高鑑別力 |
| P1 | 葉序對立 | 0.6 | ✅ 已有，可考慮提高 penalty |
| P2 | 花序類型對立 | 0.5 | ⚠️ 易混淆，先觀察 |
| P2 | 毛被對立 | 0.4 | ⚠️ 火筒樹案例顯示 Vision 易錯 |
| P3 | 常綠/落葉 | 0.3 | 低優先 |
| P3 | 花色 | 0.2 | 易誤用，僅作弱訊號 |

**penalty 計算**：建議的 `penalty_i = severity * query_conf * candidate_conf` 合理；若 candidate_conf 難取得，可簡化為 `severity * query_conf`。

### 可加強之處

1. **規則表 config 化**：以 JSON 定義 id、trait、conf_min、penalty、條件，便於調參與開關。
2. **payload 結構**：需明確哪些欄位用來判斷「掌狀、羽狀複葉、單葉、棕櫚」。
3. **分階段上線**：先上 P1 soft，觀察 12 筆測試案例；再考慮 Gate-1、Gate-2 的 hard gate。

**結論**：建議採納規則設計，分階段實作；Hard Gate 僅先上棕櫚/掌狀、複葉，葉序以 soft 為主。

---

## 四、Config 檔設計建議

建議新增 `scripts/rag/config/contradiction_rules.json`（或類似路徑）：

```json
{
  "version": "1.0",
  "hard_gates": [
    {
      "id": "G1",
      "name": "palm_or_palmate",
      "query_triggers": ["掌狀", "掌狀深裂", "扇形", "palm", "棕櫚"],
      "candidate_reject_if": "no_palm_related_features",
      "enabled": true
    },
    {
      "id": "G2",
      "name": "compound_vs_simple",
      "query_triggers": ["羽狀複葉", "掌狀複葉", "pinnate", "compound"],
      "candidate_reject_if": "explicitly_simple_leaf",
      "enabled": true
    }
  ],
  "soft_rules": [
    {"id": "S1", "trait": "leaf_arrangement", "conf_min": 0.75, "penalty": 0.25},
    {"id": "S2", "trait": "life_form", "conf_min": 0.6, "penalty": 0.12},
    {"id": "S3", "trait": "compound_leaf", "conf_min": 0.7, "penalty": 0.5}
  ],
  "dynamic_weight_segments": [
    {"q_min": 0, "q_max": 0.30, "w_embed": 0.90, "w_feat": 0.10},
    {"q_min": 0.30, "q_max": 0.55, "w_embed": 0.70, "w_feat": 0.30},
    {"q_min": 0.55, "q_max": 0.75, "w_embed": 0.50, "w_feat": 0.50},
    {"q_min": 0.75, "q_max": 1.01, "w_embed": 0.30, "w_feat": 0.70}
  ]
}
```

Node 與 Python 皆可載入，便於 A/B 測試與調參。

---

## 五、實作順序與步驟

### 階段 0：重複植物處理（P0.5）

1. 撰寫 `scripts/rag/dedup_plant_data.js`：依 scientific_name 或 chinese_name 合併同物種。
2. 產出 `plants-forest-gov-tw-dedup.jsonl`。
3. 更新 embed 流程優先使用 dedup 檔，執行 `FORCE_RECREATE=1` 重新向量化。
4. 驗收：同一物種在 Top30 中不再出現多筆。

### 階段 1：快速收益（不需重算向量）

1. **LM 加成僅對匹配候選**（P3-2a）
2. **LM 加成門檻**（P3-2b）：feature match ≥ 2 才加成
3. **TraitsParser 映射補齊**：lavender, prostrate, racemose, paniculate, terminal_paniculate, spring_flowering 等

### 階段 2：動態權重與矛盾規則

1. **動態權重改版**：
   - 實作建議的 Q 公式（含 spec、generic 清單）
   - 更新 `DYNAMIC_WEIGHT_SEGMENTS` 為建議區間
   - 加上 debug log
2. **Soft 矛盾擴充**：
   - 補上複葉 vs 單葉、棕櫚類缺失等規則
   - 可先以 config 檔驅動
3. **Hard Gate（可選）**：
   - 先實作 Gate-1 棕櫚/掌狀、Gate-2 複葉
   - Gate-3 葉序暫以 soft 為主

### 階段 3：Config 與進階

1. 將規則與權重抽成 config JSON
2. Vision prompt 強化（複葉/掌狀/葉序等關鍵特徵）

---

## 六、是否需重新向量化？

| 變更類型 | 需重算向量？ |
|----------|--------------|
| 動態權重、矛盾規則、LM 加成、TraitsParser 映射 | ❌ 否 |
| 學名對照表、mergePlantResults 邏輯 | ❌ 否 |
| **移除 XX屬/XX科（P0）** | ✅ 是（已完成） |
| **重複植物去重** | ✅ 是（合併後為新文件） |
| 修改植物描述的 embedding 原文 | ✅ 是 |

---

## 七、總結

| 建議項目 | 合理性 | 可調整處 | 建議 |
|----------|--------|----------|------|
| 重複植物優先處理 | ✅ 高 | 合併策略需定義 | 列為 P0.5，先做資料去重 |
| A) 動態權重 | ✅ 高 | generic 清單、conf 邊界 | 採納並實作 spec |
| B) Hard Must Gate | ✅ 中高 | 葉序 gate 需保守 | 棕櫚、複葉先上；葉序用 soft |
| B) Soft 矛盾 | ✅ 高 | 分階段上線 | 擴充 P1 規則，再觀察 |
| Config 檔 | ✅ 高 | - | 建議納入實作 |

整體建議方向正確，可依上述順序分階段實作，並以 12 筆測試案例作為每次變更的驗收基準。
