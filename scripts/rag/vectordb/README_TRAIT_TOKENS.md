# Trait Tokens 系統說明

## 概述

Trait Tokens 系統是為了解決「常見詞淹沒」問題而設計的改進方案。它將特徵匹配從「全文掃描」改為「欄位級別比對」，大幅提升檢索準確度。

## 核心改進

### 問題診斷

1. **常見詞淹沒**：embedding 主要靠「常見描述」相似，永遠被同一群「描述很完整/很通用」的植物霸榜
2. **特徵匹配不精確**：feature_score 目前是「特徵詞出現在描述文字」就加分，缺欄位的植物吃不到分
3. **混合公式放大問題**：enhancement 乘法增強讓「本來就常見、又剛好撞到幾個特徵詞」的候選更穩

### 解決方案

1. **分離語意比對和特徵比對**
   - `morphology_summary_zh`：給 embedding 用（短、乾淨、同一套術語）
   - `trait_tokens`：給特徵比對用（標準化 token，不掃全文）

2. **改用 trait_tokens 做特徵匹配**
   - 從 `key_features` 生成標準化的 `trait_tokens`（如 `life_form=shrub`）
   - 匹配時只比對 tokens，不掃全文

3. **加入 Coverage 和 Must Gate**
   - **Coverage**：`coverage = matched_traits / total_query_traits`，避免部分匹配高分
   - **Must Gate**：關鍵特徵（`life_form`、`leaf_arrangement`）不匹配時降權 35%

## 檔案結構

```
scripts/rag/vectordb/
├── trait_vocab.json              # Trait 詞彙表（中英對照）
├── trait_tokenizer.py            # Token 轉換工具
├── generate_morphology_summary.py # 生成 morphology_summary 和 trait_tokens
├── feature_weights.py            # 特徵匹配邏輯（已更新）
└── start_api.py                  # API 端點（已更新）
```

## 使用方式

### 階段一：快速改善（不改資料格式）

1. **使用現有資料**：系統會自動從 `key_features` 生成 `trait_tokens`
2. **向後兼容**：如果沒有 `trait_tokens`，會回退到全文掃描

### 階段二：完整優化（需要重新向量化）

1. **生成增強資料**：
   ```bash
   python scripts/rag/vectordb/generate_morphology_summary.py
   ```
   這會生成 `plants-forest-gov-tw-enhanced.jsonl`，包含：
   - `morphology_summary_zh`：乾淨的摘要
   - `trait_tokens`：標準化的特徵 tokens

2. **重新向量化**：
   ```bash
   python scripts/rag/vectordb/embed_plants_forest_jina.py
   ```
   向量化流程會自動使用 `morphology_summary_zh` 和 `trait_tokens`

3. **替換資料**：
   - 將 `plants-forest-gov-tw-enhanced.jsonl` 替換原檔案
   - 或更新 Dockerfile 使用新檔案

## Trait 詞彙表

`trait_vocab.json` 包含以下 trait 類別：

- `life_form`：生活型（喬木、灌木、草本、藤本等）
- `leaf_arrangement`：葉序（互生、對生、輪生等）
- `leaf_type`：葉型（單葉、複葉、羽狀複葉等）
- `leaf_shape`：葉形（卵形、橢圓形、披針形等）
- `leaf_margin`：葉緣（全緣、鋸齒、波狀等）
- `surface_hair`：表面特徵（無毛、有毛、絨毛等）
- `inflorescence`：花序（總狀、圓錐、聚繖等）
- `flower_color`：花色（白、黃、紅、紫等）
- `fruit_type`：果實類型（莢果、漿果、核果等）
- 其他：`leaf_texture`、`phenology`、`reproductive_system` 等

## 分數計算改進

### 新的混合分數公式

```python
# 1. 基礎分數（加權平均）
base_score = (EMBEDDING_WEIGHT * embedding_score) + (FEATURE_WEIGHT * feature_score)

# 2. 增強分數（乘法增強）
enhancement = embedding_score * feature_score * 0.3

# 3. 應用 Coverage
feature_score = feature_score_raw * coverage

# 4. Must Gate（關鍵特徵不匹配時降權）
if not must_matched:
    hybrid_score *= 0.65

# 5. 最終分數
hybrid_score = base_score + enhancement + keyword_bonus
```

### Coverage 計算

```python
coverage = matched_traits / total_query_traits
```

- 只計算 `must + soft` traits，不計算 `avoid`
- 如果查詢有 8 個特徵，只匹配到 1 個，`coverage = 0.125`，會大幅降低分數

### Must Gate

- **Must traits**：`life_form`、`leaf_arrangement`（關鍵識別特徵）
- **規則**：如果查詢中的 must traits 沒有全部匹配，分數降權 35%
- **目的**：避免「生活型錯誤但其他特徵匹配」的情況

## 測試

### 測試 trait_tokenizer

```bash
python scripts/rag/vectordb/trait_tokenizer.py
```

### 測試 generate_morphology_summary

```bash
python scripts/rag/vectordb/generate_morphology_summary.py
```

## 向後兼容

系統完全向後兼容：

1. **如果沒有 `trait_tokens`**：自動從 `key_features` 生成
2. **如果沒有 `morphology_summary_zh`**：使用 `summary` 或原始 `morphology`
3. **如果 trait_tokenizer 不可用**：回退到全文掃描

## 下一步優化

1. **Query Builder**：將 traits JSON 轉換為結構化查詢（可選）
2. **自動補詞**：掃描全庫找出未映射的 key_features，自動補齊詞彙表
3. **多語言支援**：擴展詞彙表支援英文、日文等

## 參考資料

- 原始建議來源：ChatGPT 分析
- 分數計算文檔：`SCORING_ALGORITHM_DOCUMENTATION.md`
- Trait 詞彙表：`trait_vocab.json`
