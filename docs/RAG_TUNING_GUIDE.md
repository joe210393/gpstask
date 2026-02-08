# RAG 調參指南：症狀 → 根因 → 可改參數

本文件對應 log 分析結論，整理可落地的調參順序與快速測試方法。

## 四大核心問題與對應修改

### 1. Feature 權重太高 + 強特徵加成觸發太寬

**症狀**：山茶花 embedding=0.76 卻輸給 山橘 embedding=0.64，因 feature 主導。

**已實作**：
- 權重改為 **E=0.70 / F=0.30**（embedding 主導）
- 強特徵加成上限 **0.50 → 0.40**

**可再調**：`index.js` DYNAMIC_WEIGHT_SEGMENTS、`start_api.py` effective_feature_weight

---

### 2. Fruit-only 召回太容易啟動、候選池污染

**症狀**：一有果實詞就 +50 候選，合併後 108~111 筆，rerank 被污染。

**已實作**：
- **高門檻**：至少 2 個果實特徵才觸發（單一漿果不觸發）
- **降量**：50 → 20 筆（可設 `FRUIT_ONLY_LIMIT` 調整）
- **可關閉**：`DISABLE_FRUIT_ONLY_RECALL=1` 做 A/B 測試

**快速測試**：
```bash
DISABLE_FRUIT_ONLY_RECALL=1 python start_api.py
# 若山茶花/能高山茶排名立刻上來 → Fruit-only 是主要污染源
```

---

### 3. 共通特徵無罕見度處理

**現狀**：`feature_weights.py` 已有 IDF（`get_weight` 使用 `rare_coef`），互生/灌木等常見特徵權重會自動壓低。

**可再調**：在 `match_plant_features` 對 互生、灌木、全緣 等設單項貢獻上限 0.05~0.10。

---

### 4. 非物種條目混入候選

**症狀**：`蕁麻科 (施炳霖著)`、`桑科 (林志忠著)` 等科名/書名進候選。

**已實作**：`_is_non_species()` 過濾 `chinese_name` 含 `著)` 或 `科/屬 (xxx著)` 的條目。

---

## 環境變數一覽

| 變數 | 說明 | 預設 |
|------|------|------|
| `DISABLE_FRUIT_ONLY_RECALL` | 關閉 Fruit-only 第二路召回 | 0 |
| `FRUIT_ONLY_LIMIT` | Fruit-only 補召回筆數 | 20 |

---

## 建議驗證順序

1. **關閉 Fruit-only** 跑同一批 query → 若正確率上升，代表其為主要污染
2. **E=0.75 / F=0.25** 跑同一批 → 若 top1 更貼近 guess_names，代表 feature 仍偏高
3. 觀察 log 中 **候選池大小**：主路 60 + Fruit路 20 ≈ 80 比原先 110 乾淨
