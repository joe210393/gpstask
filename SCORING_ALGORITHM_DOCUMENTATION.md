# 分數計算演算法完整文檔
## Scoring Algorithm Complete Documentation

> 本文檔詳細記錄所有與分數計算相關的公式、加權值、閾值和演算法

---

## 📊 一、混合搜尋分數計算 (Hybrid Search Score)

### 1.1 核心公式

```
hybrid_score = base_score + enhancement + keyword_bonus
```

其中：
- `base_score` = 加權平均分數
- `enhancement` = 乘法增強分數
- `keyword_bonus` = 關鍵字匹配加分

### 1.2 基礎分數 (Base Score)

```
base_score = (EMBEDDING_WEIGHT × embedding_score) + (FEATURE_WEIGHT × feature_score)
```

**權重設定**：
- `EMBEDDING_WEIGHT = 0.6` (60%) - embedding 相似度權重
- `FEATURE_WEIGHT = 0.4` (40%) - 特徵匹配權重

**分數範圍**：
- `embedding_score`: 0.0 ~ 1.0 (來自 Qdrant 的餘弦相似度)
- `feature_score`: 0.0 ~ 1.0 (特徵匹配總分，見下方說明)

### 1.3 增強分數 (Enhancement Score)

```
enhancement = embedding_score × feature_score × 0.3
```

**增強係數**: `0.3` (30%)

**作用**：當 embedding 和 feature 都匹配時，使用乘法增強，放大同時匹配的情況

### 1.4 關鍵字匹配加分 (Keyword Bonus)

```
keyword_bonus = KEYWORD_BONUS_WEIGHT  (如果匹配) 或 0.0 (如果不匹配)
```

**權重設定**：
- `KEYWORD_BONUS_WEIGHT = 0.1` (10%)

**匹配條件**：
- 如果 `guess_names` 中的名稱匹配到植物的 `chinese_name` 或 `scientific_name`
- 使用部分匹配（包含關係）

### 1.5 最終混合分數

```
hybrid_score = min(1.0, base_score + enhancement + keyword_bonus)
```

**限制**：確保分數不超過 1.0

---

## 🌿 二、特徵匹配分數計算 (Feature Matching Score)

### 2.1 特徵權重計算公式

特徵權重使用 **TF-IDF 變體** 計算：

#### 步驟 1: 計算 IDF (Inverse Document Frequency)

```
IDF = ln((N + 1) / (df + 1))
```

其中：
- `N` = 總文件數（植物資料總數）
- `df` = 文件頻率（包含該特徵的植物數量）

#### 步驟 2: 計算 RareCoef (稀有度係數)

```
RareCoef = clamp(0.2, 2.5, IDF / 2)
```

**範圍限制**：
- 最小值：`0.2`
- 最大值：`2.5`
- 計算：`IDF / 2` 後限制在範圍內

#### 步驟 3: 計算最終特徵權重

```
FeatureWeight = min(BaseW × RareCoef, MaxCap)
```

其中：
- `BaseW` = 基礎權重（見下方特徵權重表）
- `RareCoef` = 稀有度係數（從步驟 2）
- `MaxCap` = 最大權重上限（見下方特徵權重表）

### 2.2 特徵匹配分數

```
feature_score = Σ(FeatureWeight_i)  (對於所有匹配的特徵 i)
```

**匹配條件**：
- 特徵名稱（中文）出現在植物描述文字中，或
- 特徵英文名稱出現在植物描述文字中（不區分大小寫）

---

## 📋 三、特徵權重表 (Feature Weight Table)

### 3.1 生命型態 (Life Form)

| 特徵 | 英文 | 基礎權重 (BaseW) | 最大上限 (MaxCap) |
|------|------|------------------|-------------------|
| 喬木 | tree | 0.05 | 0.05 |
| 灌木 | shrub | 0.05 | 0.05 |
| 草本 | herb | 0.05 | 0.05 |
| 藤本 | vine | 0.06 | 0.06 |

### 3.2 葉序 (Leaf Arrangement)

| 特徵 | 英文 | 基礎權重 (BaseW) | 最大上限 (MaxCap) |
|------|------|------------------|-------------------|
| 互生 | alternate | 0.05 | 0.06 |
| 對生 | opposite | 0.05 | 0.06 |
| 輪生 | whorled | 0.06 | 0.09 |

### 3.3 葉型 (Leaf Type)

| 特徵 | 英文 | 基礎權重 (BaseW) | 最大上限 (MaxCap) |
|------|------|------------------|-------------------|
| 單葉 | simple leaf | 0.05 | 0.08 |
| 複葉 | compound leaf | 0.05 | 0.08 |
| 羽狀複葉 | pinnate leaves | 0.05 | 0.07 |
| 二回羽狀 | bipinnate leaves | 0.08 | 0.12 |
| 掌狀複葉 | palmate leaves | 0.07 | 0.10 |

### 3.4 葉緣 (Leaf Margin)

| 特徵 | 英文 | 基礎權重 (BaseW) | 最大上限 (MaxCap) |
|------|------|------------------|-------------------|
| 全緣 | entire | 0.05 | 0.07 |
| 鋸齒 | serrated | 0.05 | 0.07 |

### 3.5 花色 (Flower Color)

| 特徵 | 英文 | 基礎權重 (BaseW) | 最大上限 (MaxCap) |
|------|------|------------------|-------------------|
| 白花 | white flower | 0.05 | 0.07 |
| 黃花 | yellow flower | 0.05 | 0.07 |
| 紅花 | red flower | 0.05 | 0.07 |
| 紫花 | purple flower | 0.05 | 0.07 |

### 3.6 花序 (Flower Inflorescence)

| 特徵 | 英文 | 基礎權重 (BaseW) | 最大上限 (MaxCap) |
|------|------|------------------|-------------------|
| 總狀花序 | raceme | 0.06 | 0.09 |
| 圓錐花序 | panicle | 0.06 | 0.09 |

### 3.7 果實 (Fruit Type)

| 特徵 | 英文 | 基礎權重 (BaseW) | 最大上限 (MaxCap) |
|------|------|------------------|-------------------|
| 莢果 | pod | 0.08 | 0.12 |

### 3.8 根/樹幹 (Trunk/Root)

| 特徵 | 英文 | 基礎權重 (BaseW) | 最大上限 (MaxCap) |
|------|------|------------------|-------------------|
| 板根 | buttress | 0.12 | 0.18 |
| 氣生根 | aerial root | 0.16 | 0.22 |

### 3.9 特殊特徵 (Special Features)

| 特徵 | 英文 | 基礎權重 (BaseW) | 最大上限 (MaxCap) |
|------|------|------------------|-------------------|
| 有刺 | thorns | 0.08 | 0.12 |
| 胎生苗 | viviparous | 0.22 | 0.30 |

**注意**：實際權重會根據資料庫中的 `df`（文件頻率）動態調整，使用 `FeatureWeight = min(BaseW × RareCoef, MaxCap)` 公式。

---

## 🎯 四、LM 信心度加成 (LM Confidence Boost)

### 4.1 匹配條件

LM 與 RAG 匹配時，給予信心度加成：

**嚴格匹配規則**：
```
isExactMatch = 
  (plantNameLower === lmNameLower) ||                    // 完全匹配
  (scientificNameLower === lmNameLower) ||              // 學名完全匹配
  (plantNameLower.includes(lmNameLower) && lmNameLower.length >= 3) ||  // 包含匹配（長度 >= 3）
  (lmNameLower.includes(plantNameLower) && plantNameLower.length >= 3)  // 反向包含匹配（長度 >= 3）
```

**加成值**：
- `lmConfidenceBoost = 0.4` (40%) - 當匹配成功時

### 4.2 應用條件

**閾值檢查**：
```
if (topScore >= 0.5) {
  // 應用 LM 加成
}
```

**條件**：只有當最高分數 >= 0.5 (50%) 時，才應用 LM 加成

### 4.3 分數調整公式

```
maxBoost = score × 0.5  // 最多加成原始分數的 50%
actualBoost = min(lmConfidenceBoost, maxBoost)
adjusted_score = min(1.0, score + actualBoost)
```

**範例**：
- 原始分數 63.5%：`maxBoost = 0.635 × 0.5 = 0.3175`，`actualBoost = min(0.4, 0.3175) = 0.3175`，調整後 = `min(1.0, 0.635 + 0.3175) = 0.9525` (95.25%)
- 原始分數 59.9%：`maxBoost = 0.599 × 0.5 = 0.2995`，`actualBoost = min(0.4, 0.2995) = 0.2995`，調整後 = `min(1.0, 0.599 + 0.2995) = 0.8985` (89.85%)

**限制**：
- 最多加成原始分數的 50%
- 最終分數不超過 1.0 (100%)

---

## 🔍 五、兩階段搜尋結果比較

### 5.1 第一階段：傳統搜尋（Embedding Only）

**搜尋方式**：純 embedding 相似度搜尋

**分數**：
```
score = embedding_score  (直接使用 Qdrant 的餘弦相似度)
```

**結果保存**：保存到 `preSearchResults` 作為基準

### 5.2 第二階段：Traits-based 混合搜尋

**搜尋方式**：混合搜尋（embedding + feature matching）

**分數**：使用上述混合搜尋公式計算

### 5.3 結果比較與選擇

**比較邏輯**：
```
if (newTopScore > preTopScore + 0.15) {
  // 使用第二階段結果
  plantResults = newResults;
} else {
  // 保留第一階段結果
  plantResults = preSearchResults;
}
```

**閾值**：`0.15` (15%) - 只有當新結果分數明顯更高（>15%）時才替換

---

## 🚦 六、植物判斷閾值 (Plant Classification Thresholds)

### 6.1 Embedding API 分類閾值

**位置**：`scripts/rag/vectordb/start_api.py`

```
PLANT_THRESHOLD = 0.4  (40%)
```

**判斷邏輯**：
```
is_plant = (plant_score >= PLANT_THRESHOLD)
```

### 6.2 Vision API 分類閾值

**位置**：`index.js`

**動態閾值**：
```
PLANT_SCORE_THRESHOLD = 
  visionSaysPlant ? 0.4 :           // 如果 Vision 明確說是植物
  (finishReason === 'length' ? 0.45 : 0.5)  // 如果回應被截斷，降低閾值
```

**判斷邏輯**：
```
if (classification.plant_score >= PLANT_SCORE_THRESHOLD) {
  // 進行 RAG 搜尋
}
```

---

## 📈 七、分數計算流程圖

```
1. Embedding 搜尋
   └─> embedding_score (0.0 ~ 1.0)

2. 特徵匹配
   └─> 計算每個特徵的權重
       └─> IDF = ln((N+1)/(df+1))
       └─> RareCoef = clamp(0.2, 2.5, IDF/2)
       └─> FeatureWeight = min(BaseW × RareCoef, MaxCap)
   └─> feature_score = Σ(FeatureWeight_i) (匹配的特徵)

3. 關鍵字匹配
   └─> keyword_bonus = 0.1 (如果匹配) 或 0.0

4. 混合分數計算
   └─> base_score = 0.6 × embedding_score + 0.4 × feature_score
   └─> enhancement = embedding_score × feature_score × 0.3
   └─> hybrid_score = min(1.0, base_score + enhancement + keyword_bonus)

5. LM 信心度加成（如果匹配）
   └─> 檢查：topScore >= 0.5
   └─> maxBoost = score × 0.5
   └─> actualBoost = min(0.4, maxBoost)
   └─> adjusted_score = min(1.0, score + actualBoost)
```

---

## 🔢 八、數值範圍總結

### 8.1 各類分數範圍

| 分數類型 | 範圍 | 說明 |
|---------|------|------|
| embedding_score | 0.0 ~ 1.0 | Qdrant 餘弦相似度 |
| feature_score | 0.0 ~ 1.0 | 特徵匹配總分（理論上可超過 1.0，但實際會受 MaxCap 限制） |
| keyword_bonus | 0.0 或 0.1 | 關鍵字匹配加分 |
| base_score | 0.0 ~ 1.0 | 加權平均分數 |
| enhancement | 0.0 ~ 0.3 | 乘法增強分數（embedding × feature × 0.3） |
| hybrid_score | 0.0 ~ 1.0 | 最終混合分數 |
| adjusted_score | 0.0 ~ 1.0 | LM 加成後的分數 |

### 8.2 權重係數總結

| 係數名稱 | 數值 | 說明 |
|---------|------|------|
| EMBEDDING_WEIGHT | 0.6 | Embedding 相似度權重 |
| FEATURE_WEIGHT | 0.4 | 特徵匹配權重 |
| ENHANCEMENT_COEFFICIENT | 0.3 | 乘法增強係數 |
| KEYWORD_BONUS_WEIGHT | 0.1 | 關鍵字匹配加分 |
| LM_CONFIDENCE_BOOST | 0.4 | LM 匹配時的基礎加成 |
| MAX_BOOST_RATIO | 0.5 | 最多加成原始分數的 50% |
| RESULT_COMPARISON_THRESHOLD | 0.15 | 結果比較閾值（15%） |
| PLANT_THRESHOLD | 0.4 | 植物判斷閾值（40%） |

### 8.3 特徵權重範圍

| 特徵類別 | BaseW 範圍 | MaxCap 範圍 | 說明 |
|---------|-----------|-------------|------|
| 生命型態 | 0.05 ~ 0.06 | 0.05 ~ 0.06 | 較低權重，常見特徵 |
| 葉序 | 0.05 ~ 0.06 | 0.06 ~ 0.09 | 中等權重 |
| 葉型 | 0.05 ~ 0.08 | 0.07 ~ 0.12 | 中等權重，複葉類型較高 |
| 葉緣 | 0.05 | 0.07 | 較低權重 |
| 花色 | 0.05 | 0.07 | 較低權重 |
| 花序 | 0.06 | 0.09 | 中等權重 |
| 果實 | 0.08 | 0.12 | 較高權重 |
| 根/樹幹 | 0.12 ~ 0.16 | 0.18 ~ 0.22 | 高權重，稀有特徵 |
| 特殊特徵 | 0.08 ~ 0.22 | 0.12 ~ 0.30 | 高權重，非常稀有 |

---

## 📝 九、計算範例

### 範例 1：基本混合搜尋

**輸入**：
- `embedding_score = 0.65`
- `feature_score = 0.30` (匹配了 3 個特徵：互生 0.05、鋸齒 0.05、白花 0.05、總狀花序 0.06、有刺 0.09)
- `keyword_bonus = 0.0` (無關鍵字匹配)

**計算**：
```
base_score = 0.6 × 0.65 + 0.4 × 0.30 = 0.39 + 0.12 = 0.51
enhancement = 0.65 × 0.30 × 0.3 = 0.0585
hybrid_score = min(1.0, 0.51 + 0.0585 + 0.0) = 0.5685 (56.85%)
```

### 範例 2：帶關鍵字匹配

**輸入**：
- `embedding_score = 0.70`
- `feature_score = 0.25`
- `keyword_bonus = 0.1` (關鍵字匹配)

**計算**：
```
base_score = 0.6 × 0.70 + 0.4 × 0.25 = 0.42 + 0.10 = 0.52
enhancement = 0.70 × 0.25 × 0.3 = 0.0525
hybrid_score = min(1.0, 0.52 + 0.0525 + 0.1) = 0.6725 (67.25%)
```

### 範例 3：LM 信心度加成

**輸入**：
- `hybrid_score = 0.635` (63.5%)
- `lmConfidenceBoost = 0.4` (LM 匹配成功)

**計算**：
```
maxBoost = 0.635 × 0.5 = 0.3175
actualBoost = min(0.4, 0.3175) = 0.3175
adjusted_score = min(1.0, 0.635 + 0.3175) = 0.9525 (95.25%)
```

---

## 🔧 十、實現位置

### 10.1 Python 後端 (Embedding API)

- **文件**：`scripts/rag/vectordb/start_api.py`
- **函數**：`hybrid_search()` (第 516 行)
- **權重設定**：第 101-103 行
- **特徵權重計算**：`scripts/rag/vectordb/feature_weights.py`

### 10.2 Node.js 後端 (Main API)

- **文件**：`index.js`
- **LM 信心度加成**：第 3619-3725 行
- **兩階段搜尋比較**：第 3306-3443 行
- **分數調整**：第 3704-3721 行

---

## 📌 十一、注意事項

1. **特徵權重是動態的**：根據資料庫中的 `df`（文件頻率）計算，不同資料庫可能會有不同的權重值
2. **分數上限**：所有最終分數都會限制在 0.0 ~ 1.0 範圍內
3. **LM 加成條件**：只有當原始分數 >= 0.5 時才應用，避免低分數結果被過度提升
4. **結果比較**：只有當新結果分數明顯更高（>15%）時才替換，避免高分數結果被低分數結果覆蓋
5. **關鍵字匹配**：只是輔助加分，不會過度影響整體匹配結果

---

## 🔄 十二、更新記錄

- **2026-02-01**: 優化分數調整機制，限制加成幅度，保留分數差異
- **2026-02-01**: 改進混合搜尋公式，加入乘法增強
- **2026-02-01**: 實現兩階段搜尋系統，智能結果比較
