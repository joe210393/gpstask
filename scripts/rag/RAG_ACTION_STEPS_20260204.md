# RAG 下一步可修改步驟（2026-02-04 整合版）

> 依 reviewer 建議整合為可執行的具體步驟。報告基準：test-report-12.md (14:50)，2/12 通過。

---

## 現況摘要

- **通過**：棕竹、小金雀花
- **已有進步**：強特徵進 query、長穗木 #7 紫花長穗木、野牡丹 #7 野牡丹
- **卡點**：Gate-A 對黃椰子無效（冇拱仍 Top1）；果實 keyword 未補齊（金露花「橙紅色的果實」）

---

## P0：Gate-A Debug Log（優先：驗證是否生效）

**目標**：釐清 Gate-A 是否套用、`_plant_has_palm_compound` 是否誤判。

**實作**：在 `start_api.py` Gate-A 區塊加入條件 log，僅當 query 有棕櫚/複葉時印出 top10。

**位置**：`scripts/rag/vectordb/start_api.py`，約 line 1068–1077。

**修改前**：
```python
        if query_has_palm_compound and not _plant_has_palm_compound(r.payload):
            hybrid_score *= 0.6
            if hybrid_score > 0.3:
                print(f"[API] Gate-A 棕櫚/複葉降權: {c['plant_name']} - 無複葉/棕櫚描述 (x0.6)")
```

**修改後**（加 debug，Gate 觸發時印出每筆候選，可 grep 冇拱/榕樹）：

```python
        gate_triggered = query_has_palm_compound
        has_palm = _plant_has_palm_compound(r.payload)
        before = hybrid_score
        if gate_triggered and not has_palm:
            hybrid_score *= 0.6
        if gate_triggered:
            print(f"[API] Gate-A debug {c['plant_name']}: has_palm_compound={has_palm} penalty_applied={not has_palm} before={before:.4f} after={hybrid_score:.4f}")
        if gate_triggered and not has_palm and hybrid_score > 0.3:
            print(f"[API] Gate-A 棕櫚/複葉降權: {c['plant_name']} - 無複葉/棕櫚描述 (x0.6)")
```

**驗證**：跑黃椰子一題，檢查冇拱的 `has_palm_compound`。若為 True → 關鍵字過寬（例如「掌狀」讓烏桕誤判）；若為 False 且 `penalty_applied=True` 但冇拱仍排前面 → 0.6 不夠強。

---

## P1：Gate-A 動態強度（強複葉用更重懲罰）

**目標**：query 有羽狀/掌狀/二回/三出複葉時，對無棕櫚/複葉訊號的候選更狠。

**邏輯**：

| query 特徵 | 懲罰倍率 |
|------------|----------|
| 羽狀複葉、掌狀複葉、二回羽狀、三出複葉（強特徵） | ×0.35 |
| 僅「複葉」「棕櫚」（泛用） | ×0.6 |

**位置**：`start_api.py` Gate-A 區塊。

**實作**：
```python
        STRONG_PALM_TOKENS = frozenset({"羽狀複葉", "掌狀複葉", "二回羽狀", "三出複葉"})
        has_strong = features and any(f in STRONG_PALM_TOKENS for f in features)
        penalty = 0.35 if has_strong else 0.6
        if gate_triggered and not has_palm:
            hybrid_score *= penalty
```

**驗證**：黃椰子（有羽狀複葉）應改為 ×0.35，冇拱/榕樹分數明顯下降。

---

## P1b：修正 _plant_has_palm_compound 誤判（若 debug 顯示冇拱 has_palm=True）

**問題**：烏桕（冇拱）有「掌狀葉」，「掌狀」單字會命中，造成誤判為有棕櫚/複葉。

**解法**：從 `PALM_COMPOUND_PLANT_KEYWORDS` 移除單一「掌狀」，或改為更精準的詞（如「掌狀複葉」「掌狀裂」）。

**位置**：`start_api.py` line 680–682。

**修改**：
```python
# 原：「掌狀」會命中烏桕等掌狀葉植物
PALM_COMPOUND_PLANT_KEYWORDS = (
    "羽狀複葉", "掌狀複葉", "棕櫚", "扇形", "複葉", "棕櫚科", "掌狀", "三出複"
)
# 改：移除單一「掌狀」，改為「掌狀複葉」「掌狀裂」等
PALM_COMPOUND_PLANT_KEYWORDS = (
    "羽狀複葉", "掌狀複葉", "棕櫚", "扇形", "複葉", "棕櫚科", "掌狀複", "三出複"
)
```

---

## P2：果實 Keyword 正則修正（橙紅色 的 果實）

**目標**：讓「橙紅色的果實」等描述也能抽出 漿果。

**位置**：`traits-parser.js` 的 `extractFeaturesFromDescriptionKeywords`。

**現有**：`(?:紅色|鮮紅|紫黑|深紅|橙紅)色?果實` 無法匹配「橙紅色的果實」（中間有「的」）。

**修改**：
```javascript
  // 原
  if (/(?:紅色|鮮紅|紫黑|深紅|橙紅)色?果實|紅果|鮮紅色果|紫黑色果|橙紅色果/.test(text) && ...)
  // 改：允許「的」 between 顏色與果實
  if (/(?:紅色|鮮紅|紫黑|深紅|橙紅)色的?果實|紅果|鮮紅色果|紫黑色果|橙紅色的果實|橙紅色果/.test(text) && ...)
```

或更廣：`/橙紅.*果實|(?:紅|紫黑|深紅|鮮紅).*果實/.test(text)`，但要避免過度匹配。

**驗證**：金露花描述含「橙紅色的果實」時，query 應出現 漿果。

---

## P3：Top30 後驗證 Rerank（長穗木、野牡丹類）

**目標**：正解已在 top10 但非 Top1 時，用輕量 rerank 拉上來。

**做法**（簡易版）：
- 輸入：query_features + top10 的 (name, key_features, summary)
- 規則：若候選的 key_features/summary 明確缺少 query 的強特徵 → 扣分
- 實作：可在 `start_api.py` 或 Node 端，對 top10 做一輪 rule-based 微調，不動 embedding / hybrid 主流程

**複雜版**：呼叫 LM 做「一致性打分」，成本較高，建議先做 P0/P1/P2 再評估。

---

## 建議執行順序

1. **P0**：加 Gate-A debug log → 跑黃椰子 → 確認 has_palm、penalty 是否正確。
2. **P1b**（若 debug 顯示冇拱 has_palm=True）：調整 `PALM_COMPOUND_PLANT_KEYWORDS`。
3. **P1**：實作動態 Gate-A 強度（×0.35 / ×0.6）。
4. **P2**：修正果實 keyword 正則。
5. **P3**：視結果決定是否做 rerank。

---

## 預期成效

| 步驟 | 預期 |
|------|------|
| P0 | 釐清 Gate-A 問題根源 |
| P1 + P1b | 黃椰子 冇拱/榕樹 被壓下，棕竹/黃椰子類排前 |
| P2 | 金露花、西印度櫻桃 query 帶漿果 |
| P1–P2 合併 | 通過數有機會 2/12 → 3–4/12 |
