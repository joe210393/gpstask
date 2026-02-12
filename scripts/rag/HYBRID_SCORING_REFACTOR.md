# Hybrid 計分重構紀錄

> 依據建議完成：統一資料欄位、統一計分公式、驗證報告拆分、traits→features、morphology bug 修正。

---

## 1. 統一 payload 資料欄位（Step 1）

- 新增 `_get_ident(payload)`：無論 payload 是平鋪、或在 `identification`、或在 `raw_data.identification`，都從同一個入口取得 `trait_tokens`、`key_features_norm`、`key_features`
- 新增 `_get_list(x)`：統一取得 list 型態
- `_get_plant_leaf_arrangement`、`_get_plant_leaf_type`、`_plant_has_palm_compound`、`_is_bryophyte_pteridophyte`、`_get_plant_flower_color` 皆改為透過 `_get_ident` 讀取
- `hybrid_search` 內 plant 特徵讀取改為使用 `ident = _get_ident(r.payload)`

---

## 2. 統一 Hybrid 計分公式（Step 2–3）

**原本問題**：`hybrid_score = embedding_score`，feature 與 keyword_bonus 完全未加入，RAG 等同只做扣分。

**修改後公式**：
```
hybrid_score = embedding_weight × embedding_score
             + effective_feature_weight × feature_score
             + keyword_bonus
```
之後再套用各項懲罰（Must Gate、Gate-A、SOFT 矛盾、蕨苔蘚 Gate、泛用懲罰等）。

**Must Gate**：從 0.3 改為 0.7（較保守的軟降權），僅在 `len(features) >= 2` 時啟用。

---

## 3. 泛用霸榜懲罰（Step 4）

- `GENERIC_TOP1_BLACKLIST` 新增：`水漆`、`凹葉柃木`、`棕樹`
- `apply_generic_top1_penalty` 已在計分流程中統一呼叫，無額外修改

---

## 4. 驗證報告拆分（Step 5）

`verify_from_tlpg_url.js` 的 `writeReport` 調整：

- **有效樣本**：`!r.error && r.expected && r.top1 !== undefined` → 納入 accuracy
- **no-image**：`r.error === 'no images'` → 不算 accuracy
- **其他跳過**：parse 失敗、API 錯誤等 → 不算 accuracy

報告顯示：
- 有效樣本數、Accuracy（僅有效樣本）、無圖數、其他跳過數
- 每筆結果標註 `[no-image]` 或 `[skip]`

---

---

## 5. traits→features 通路（修正建議）

- **問題**：`traits` (dict) 傳入但未轉成 `features`，若 Node 端只送 traits 或 features 為空，feature_score 全 0
- **改法**：新增 `_traits_to_features(traits)`，當 `features` 為空且 `traits` 有資料時，從 traits 擷取 value 補成 features
- **schema**：`{"leaf_arrangement": {"value": "opposite", "confidence": 0.9}, ...}` → 擷取非 unknown 的 value

---

## 6. plant_text morphology bug 修正

- **問題**：`raw.get("raw_data", {}).get("morphology", "")` 多了一層 `raw_data`，morphology 幾乎取不到
- **改法**：改為 `raw.get("morphology", "")`，並加入 `raw.get("ecology", "")` 提高 plant_text 完整性

---

## 檔案變更

| 檔案 | 變更 |
|------|------|
| `start_api.py` | `_get_ident`、`_get_list`、payload 讀取統一、hybrid_score 公式修正、Must Gate 0.7、黑名單擴充、`_traits_to_features`、morphology/ecology bug 修正 |
| `verify_from_tlpg_url.js` | 報告拆分 valid / no-image / 其他 |
