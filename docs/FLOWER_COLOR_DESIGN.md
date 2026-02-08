# 花色統一與 Fallback 萃取設計

## 問題陳述

花色（flower_color）是重要的鑑別特徵（野牡丹、山茶花等），但現有系統容易漏掉：

1. **植物資料端**：`key_features_norm` 用語不一致
   - 如：`白色小花`、`紫白色花朵`、`小型紅/粉紅色花朵` ≠ `白花`、`紫花`、`粉紅花`
   - FEATURE_INDEX 與 trait 比對期望的是：`白花`、`黃花`、`紅花`、`紫花`、`粉紅花`、`橙花`

2. **morphology 文字**：常有 `花色：白色`、`花白色`、`花瓣紫白色`，但 zh_patterns 只檢查完整詞 `白花`，無法萃取

3. **trait_tokens**：雖有 `flower_color=white`，但若 `key_features_norm` 有值，fallback 不一定會觸發；且 trait_tokens 比對需 query 端有對應特徵才會計分

---

## 設計一：花色統一（Enrichment / 比對前正規化）

### 目標

將各種花色描述統一為 FEATURE_INDEX 可識別的標準詞：`白花`、`黃花`、`紅花`、`紫花`、`粉紅花`、`橙花`。

### 方案 A：在 `feature_weights.py` 的 `match_plant_features` 中做正規化

**位置**：`scripts/rag/vectordb/feature_weights.py`，`match_plant_features` 函數內，在建立 `plant_key_features_norm` 之後、進行比對之前。

**邏輯**：擴充 `plant_key_features_norm`，將花色相關變體對應到標準詞。

```python
# 花色變體 → 標準詞（FEATURE_INDEX 可識別）
FLOWER_COLOR_ALIASES = {
    "白花": ["白色花", "白色小花", "白色花瓣", "花白色", "花色白色", "花色白"],
    "黃花": ["黃色花", "黃色小花", "黃白色花", "花黃色", "花色黃色", "花色黃"],
    "紅花": ["紅色花", "紅色小花", "花紅色", "花色紅色", "花色紅", "朱紅色"],
    "紫花": ["紫色花", "紫色小花", "紫白色花", "紫白色花朵", "花紫色", "花色紫色", "花色紫"],
    "粉紅花": ["粉紅色花", "粉色花", "小型紅/粉紅色花朵", "紅/粉紅色", "淡粉", "淺粉"],
    "橙花": ["橙色花", "橘色花", "花橙色", "花色橙色"],
}

def normalize_flower_color_in_features(plant_key_features_norm: list) -> list:
    """將 key_features_norm 中的花色變體統一為標準詞"""
    if not plant_key_features_norm:
        return plant_key_features_norm
    result = list(plant_key_features_norm)
    for std, aliases in FLOWER_COLOR_ALIASES.items():
        for alias in aliases:
            if alias in result and std not in result:
                result = [std if x == alias else x for x in result]
                break
    return result
```

**呼叫時機**：在 `plant_key_features_norm = list(set(...))` 之後，對 `plant_key_features_norm` 呼叫 `normalize_flower_color_in_features`。

---

### 方案 B：從 `trait_tokens` 補花色到 `plant_key_features_norm`

**位置**：同 `match_plant_features`。

**邏輯**：若 `plant_trait_tokens` 有 `flower_color=white` 等，且 `plant_key_features_norm` 沒有對應花色，則補入標準詞。

```python
# trait value → 標準中文（FEATURE_INDEX）
FLOWER_COLOR_FROM_TOKEN = {
    "white": "白花", "yellow": "黃花", "red": "紅花",
    "purple": "紫花", "pink": "粉紅花", "orange": "橙花", "blue": "藍花",
}

def add_flower_color_from_trait_tokens(plant_key_features_norm: list, plant_trait_tokens: list) -> list:
    """從 trait_tokens 的 flower_color 補入 key_features_norm"""
    if not plant_trait_tokens:
        return plant_key_features_norm
    result = list(plant_key_features_norm or [])
    has_flower_color = any("白花" in r or "黃花" in r or "紅花" in r or "紫花" in r or "粉紅花" in r for r in result)
    if has_flower_color:
        return result
    for token in plant_trait_tokens:
        if "=" in token and token.startswith("flower_color="):
            val = token.split("=", 1)[1].strip().lower()
            std = FLOWER_COLOR_FROM_TOKEN.get(val)
            if std and std in FEATURE_INDEX and std not in result:
                result.append(std)
            break
    return result
```

**呼叫時機**：在 `plant_key_features_norm` 處理完 fallback 之後，再呼叫 `add_flower_color_from_trait_tokens(plant_key_features_norm, plant_trait_tokens)`。

---

## 設計二：花色 Fallback 萃取（從 plant_text / morphology）

### 目標

當 `key_features_norm` 與 `trait_tokens` 都沒有花色時，從 `plant_text`（morphology 等）萃取花色。

### 位置

`scripts/rag/vectordb/feature_weights.py`，`match_plant_features` 內，與現有 `zh_patterns_fallback` 同一區塊（約 531–550 行）。

### 邏輯

在現有 zh_patterns fallback 之後，新增「花色專用」的正則萃取，處理 morphology 常見寫法。

```python
# 花色專用：從 plant_text 萃取 morphology 常見寫法
FLOWER_COLOR_PATTERNS = [
    (r"花色[：:]\s*([白黃紅紫粉橙藍綠]+)", {"白": "白花", "黃": "黃花", "紅": "紅花", "紫": "紫花", "粉": "粉紅花", "橙": "橙花", "藍": "藍花", "綠": "綠花"}),
    (r"花\s*([白黃紅紫粉橙藍綠]+)(?:色|色花)?", {"白": "白花", "黃": "黃花", "紅": "紅花", "紫": "紫花", "粉": "粉紅花", "橙": "橙花", "藍": "藍花", "綠": "綠花"}),
    (r"花瓣\s*([白黃紅紫粉橙藍綠]+)", {"白": "白花", "黃": "黃花", "紅": "紅花", "紫": "紫花", "粉": "粉紅花", "橙": "橙花", "藍": "藍花", "綠": "綠花"}),
    (r"([白黃紅紫粉橙藍綠]+)色(?:小花|花朵?|花瓣?)", {"白": "白花", "黃": "黃花", "紅": "紅花", "紫": "紫花", "粉": "粉紅花", "橙": "橙花", "藍": "藍花", "綠": "綠花"}),
    (r"紫白", None),  # 紫白 → 紫花
    (r"淡红|淡紅|淺紅", None),  # 淡紅/淺紅 → 粉紅花
    (r"淡紫|淺紫", None),  # 淡紫/淺紫 → 紫花
]
```

實作時可用一組「pattern → 標準詞」映射，對 `plant_text` 做正則匹配，將結果加入 fallback 的 `plant_key_features_norm`。

### 實作細節

- 只萃取 `FEATURE_INDEX` 中存在的標準詞（如 `白花`、`黃花`、`紅花`、`紫花`、`粉紅花`、`橙花`、`藍花`，若有定義）。
- 避免與種子顏色混淆：若同時出現「種子」與花色描述，則不萃取該區段的花色，或優先採用「花」「花瓣」「花色」旁的描述。

---

## 實作順序建議

| 步驟 | 項目 | 檔案 | 說明 |
|------|------|------|------|
| 1 | 花色變體正規化 | `feature_weights.py` | 在 `match_plant_features` 中，對 `plant_key_features_norm` 做 `normalize_flower_color_in_features` |
| 2 | 從 trait_tokens 補花色 | `feature_weights.py` | 呼叫 `add_flower_color_from_trait_tokens`，讓有 `flower_color` 的植物一定有對應花色詞 |
| 3 | 花色 fallback 萃取 | `feature_weights.py` | 在 zh_patterns 之後，加入花色專用正則，從 `plant_text` 萃取並補入 `plant_key_features_norm` |

---

## 驗證方式

1. **單元測試**：對 `normalize_flower_color_in_features`、`add_flower_color_from_trait_tokens` 及花色 fallback 函數撰寫測試。
2. **查詢測試**：用「紫花」「粉紅花」「白花」等作為 query features，檢查野牡丹、山茶花、七里香等物種的 feature_score 與匹配特徵是否正確。
3. **log 檢查**：在 rerank 日誌中確認 `matched_features` 是否出現 `白花`、`紫花`、`粉紅花` 等。

---

## 注意事項

1. **藍花、綠花**：若 `FEATURE_INDEX` 未定義，需先補上或略過萃取。
2. **紫白色**：可統一視為 `紫花`，因 FEATURE_INDEX 有 `紫花`。
3. **紅/粉紅**：`小型紅/粉紅色花朵` 建議對應 `粉紅花`，因野牡丹等常見粉紅。
