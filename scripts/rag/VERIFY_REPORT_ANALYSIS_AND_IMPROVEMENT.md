# 驗證報告分析與改進方案

## 📊 當前狀況

### 統計摘要（verify-report-embed-v2.md）
- **總筆數**: 100
- **通過**: 1（1%）
- **Embedding-only vs Hybrid**:
  - 幫忙: 7
  - 不變: 52
  - 擾亂: 9
  - **n/a: 32**（仍有32個案例缺少 embedding_only_plants）

### 主要問題

#### 1. **通過率極低（1%）**
- 只有1個案例正確識別（荔枝）
- 99個案例都失敗，說明核心問題不在 n/a，而在**識別準確率本身**

#### 2. **n/a 仍有 32 個**
雖然我們補了很多路徑的 `embedding_only_plants`，但仍有32個案例缺少此欄位，說明還有路徑未覆蓋到。

#### 3. **錯誤 Top1 常客仍出現**
- 冇拱、八角蓮、鞭枝懸苔、南亞孔雀苔、株苔、草海桐、白檀等仍頻繁出現在錯誤 Top1
- 黑名單降權（0.88）可能不夠強，或這些物種的 embedding 分數本身就很高

#### 4. **Embedding-only 排名 999**
許多案例顯示「Embedding-only 排名: 999」，表示：
- `embedding_only_plants` 欄位存在但為空陣列，或
- 陣列中沒有預期物種（說明 embedding 搜尋本身就不準確）

---

## 🔍 問題根源分析

### 問題 A: n/a 仍有 32 個

**可能原因**：
1. **某些路徑未補齊**：雖然我們補了大部分路徑，但可能還有邊緣情況
2. **`embeddingOnlyPlants` 變數作用域問題**：在 4047 行使用 `embeddingOnlyPlants`，但這個變數只在 traits-based hybrid 路徑中定義（3953行），如果走其他路徑（如 classify 路徑）可能未定義
3. **空陣列被視為 n/a**：`verify_from_tlpg_url.js` 中 `embeddingOnlyPlants.length > 0` 才計算排名，空陣列會被視為 n/a

**檢查點**：
- [ ] 4047 行的 `embeddingOnlyPlants` 是否在所有路徑都有定義？
- [ ] 是否有路徑在設置 `plantResults` 時沒有保留 `embedding_only_plants`？
- [ ] 空陣列是否應該從 `preSearchResults.plants` 生成 `embedding_only_plants`？

### 問題 B: 通過率極低（1%）

**可能原因**：
1. **Embedding 模型不夠準確**：Jina embedding 可能對中文植物名稱的語義理解不夠好
2. **資料庫品質問題**：植物資料可能不完整、有錯誤、或缺少關鍵特徵
3. **特徵提取不準確**：Vision 提取的特徵可能與實際不符
4. **Hybrid 搜尋權重問題**：特徵權重可能過高，導致錯誤匹配
5. **黑名單降權不夠**：0.88 可能不足以將錯誤物種排到後面

**證據**：
- 許多案例的 Top1 都是明顯錯誤的物種（如「冇拱」出現在很多不相關案例的 Top1）
- 「Embedding-only 排名: 999」表示 embedding 搜尋本身就不準確

### 問題 C: 擾亂案例（9個）

**定義**：Hybrid 排名比 Embedding-only 排名更後（變差）

**可能原因**：
1. **特徵匹配錯誤**：提取的特徵與實際不符，導致 hybrid 搜尋匹配到錯誤物種
2. **特徵權重過高**：特徵分數加成過多，覆蓋了 embedding 的正確排序
3. **擾亂止血機制不夠強**：`featureTotal < 0.15 || topMatched < 2` 的門檻可能不夠嚴格

---

## 🎯 改進方案

### 方案 1: 完全消除 n/a（優先級：高）

#### 1.1 修復 `embeddingOnlyPlants` 作用域問題

**問題**：在 4047 行使用 `embeddingOnlyPlants`，但這個變數只在 traits-based hybrid 路徑中定義。

**解決方案**：
```javascript
// 在 4047 行改為：
plantResults = {
  ...preSearchResults,
  embedding_only_plants: (preSearchResults.embedding_only_plants || preSearchResults.plants || []).map(p => ({
    chinese_name: p.chinese_name,
    scientific_name: p.scientific_name,
    score: p.score
  })),
  plants: reorderPlantsByLifeFormGate(preSearchResults.plants || [], traits)
};
```

#### 1.2 確保所有路徑都有 `embedding_only_plants`

**檢查所有設置 `plantResults` 的地方**：
- [ ] 4045-4049 行：回退使用第一階段（已修復）
- [ ] 4053-4059 行：兩階段都無結果但 Traits 判斷為植物（需要補）
- [ ] 4122 行：keyword fallback 合併結果（需要檢查）
- [ ] 4204-4207 行：vision parsed hybrid 路徑（已補）
- [ ] 4343-4346 行：classify 路徑（已補）
- [ ] 4354-4372 行：非植物路徑（不需要，因為不是植物）
- [ ] 4382-4386 行：RAG 搜尋失敗但 Vision 判斷為植物（需要補）

**需要補的路徑**：
1. **4053-4059 行**：兩階段都無結果但 Traits 判斷為植物
   ```javascript
   plantResults = {
     is_plant: true,
     category: 'plant',
     search_type: 'traits_only',
     traits: traits,
     traits_decision: traitsBasedDecision,
     message: '檢測到植物特徵，但資料庫中未找到匹配植物',
     embedding_only_plants: (preSearchResults?.embedding_only_plants || preSearchResults?.plants || []).map(p => ({
       chinese_name: p.chinese_name,
       scientific_name: p.scientific_name,
       score: p.score
     })),
     plants: []
   };
   ```

2. **4382-4386 行**：RAG 搜尋失敗但 Vision 判斷為植物
   ```javascript
   plantResults = {
     is_plant: true,
     category: 'plant',
     message: 'Vision AI 判斷為植物，但 RAG 搜尋失敗',
     embedding_only_plants: (preSearchResults?.embedding_only_plants || preSearchResults?.plants || []).map(p => ({
       chinese_name: p.chinese_name,
       scientific_name: p.scientific_name,
       score: p.score
     })) || [],
     plants: []
   };
   ```

3. **4122 行**：keyword fallback 合併結果
   ```javascript
   // 檢查是否已有 embedding_only_plants
   plantResults = { 
     ...newResults, 
     plants: merged,
     embedding_only_plants: newResults.embedding_only_plants || (preSearchResults?.embedding_only_plants || preSearchResults?.plants || []).map(p => ({
       chinese_name: p.chinese_name,
       scientific_name: p.scientific_name,
       score: p.score
     }))
   };
   ```

#### 1.3 處理空陣列情況

**問題**：如果 `embedding_only_plants` 是空陣列，`verify_from_tlpg_url.js` 會視為 n/a。

**解決方案**：
- 如果第一階段有結果但 `embedding_only_plants` 為空，應該從 `preSearchResults.plants` 生成
- 如果完全沒有第一階段結果，`embedding_only_plants` 應該是空陣列（這是合理的 n/a）

---

### 方案 2: 提高識別準確率（優先級：最高）

#### 2.1 加強黑名單降權

**當前**：黑名單物種在 hybrid_search 和 search_plants 中 `score *= 0.88`

**改進**：
1. **降低降權係數**：從 0.88 改為 0.7 或 0.75
2. **增加黑名單物種**：根據報告統計，將更多頻繁錯誤的物種加入黑名單
3. **動態降權**：根據錯誤頻率動態調整降權係數

**實作**（`start_api.py`）：
```python
# 黑名單降權係數（從 0.88 改為 0.7）
BLACKLIST_PENALTY = 0.7

# 擴充黑名單（根據報告統計）
BLACKLIST_NAMES = [
    '冇拱', '南亞孔雀苔', '鞭枝懸苔', '株苔', '八角蓮', 
    '草海桐', '白檀', '羊蹄甲', '石楠', '七寶樹',  # 新增常見錯誤
]
```

#### 2.2 調整 Hybrid 搜尋權重

**當前**：動態權重，但可能特徵權重過高

**改進**：
1. **降低特徵權重上限**：確保 embedding 權重始終 > 0.6
2. **加強擾亂止血**：提高門檻（`featureTotal < 0.2 || topMatched < 3`）
3. **特徵品質檢查**：如果特徵太通用（如只有「互生」「喬木」），降低權重

**實作**（`index.js`）：
```javascript
// 加強擾亂止血門檻
const featureTotal = hybridResult.feature_info?.total_score ?? 0;
const topMatched = Math.max(0, ...(hybridResult.results.slice(0, 5).map(p => (p.matched_features || []).length)));
const weakFeature = featureTotal < 0.2 || topMatched < 3; // 從 0.15/2 改為 0.2/3
```

#### 2.3 改進特徵提取

**問題**：Vision 提取的特徵可能不準確（如「互生」「喬木」太通用）

**改進**：
1. **特徵過濾**：過濾掉太通用的特徵（如只有「互生」「喬木」而無其他特徵）
2. **特徵品質評分**：根據特徵的獨特性給予不同權重
3. **加強 Vision Prompt**：要求提取更具體、更獨特的特徵

**實作**（`feature_weights.py`）：
```python
# 通用特徵列表（這些特徵太常見，如果只有這些特徵，降低權重）
GENERIC_FEATURES = ['互生', '喬木', '草本', '灌木']

def calculate_feature_quality(features):
    """計算特徵品質（獨特性）"""
    if not features:
        return 0.0
    generic_count = sum(1 for f in features if f in GENERIC_FEATURES)
    unique_count = len(features) - generic_count
    # 如果只有通用特徵，品質較低
    if unique_count == 0:
        return 0.3
    # 獨特特徵越多，品質越高
    return min(1.0, 0.3 + (unique_count / len(features)) * 0.7)
```

#### 2.4 改進 Embedding 搜尋

**問題**：Embedding 搜尋本身就不準確（很多 999）

**改進**：
1. **Query 優化**：使用更完整的描述作為 query（包含更多上下文）
2. **多階段搜尋**：先用簡短 query 搜尋，再用詳細描述搜尋，合併結果
3. **重新訓練 Embedding**：如果可能，使用更多植物相關資料訓練

---

### 方案 3: 減少擾亂案例（優先級：中）

#### 3.1 加強擾亂止血機制

**當前**：`featureTotal < 0.15 || topMatched < 2`

**改進**：
1. **提高門檻**：`featureTotal < 0.2 || topMatched < 3`
2. **檢查排名變化**：如果 hybrid 的 Top1 與 embedding 的 Top1 不同，且 hybrid Top1 分數提升 < 0.1，則不合併
3. **特徵品質檢查**：如果特徵太通用，不合併

**實作**：
```javascript
const weakFeature = featureTotal < 0.2 || topMatched < 3;
const embeddingTop1 = preSearchResults?.plants?.[0];
const hybridTop1 = hybridResult.results[0];
const rankChanged = embeddingTop1 && hybridTop1 && 
  embeddingTop1.chinese_name !== hybridTop1.chinese_name;
const scoreBoost = hybridTop1.score - (embeddingTop1?.score || 0);

// 如果排名改變但分數提升不明顯，不合併
if (rankChanged && scoreBoost < 0.1) {
  console.log(`[RAG] Hybrid Top1 改變但分數提升不明顯 (${scoreBoost.toFixed(3)})，沿用第一階段`);
  weakFeature = true;
}
```

---

## 📋 實作優先順序

### Phase 1: 完全消除 n/a（立即）
1. ✅ 修復 4047 行的 `embeddingOnlyPlants` 作用域問題
2. ✅ 補齊 4053-4059 行的 `embedding_only_plants`
3. ✅ 補齊 4382-4386 行的 `embedding_only_plants`
4. ✅ 檢查 4122 行的 keyword fallback

### Phase 2: 提高識別準確率（高優先級）
1. 加強黑名單降權（0.88 → 0.7，擴充黑名單）
2. 調整 Hybrid 搜尋權重（確保 embedding 權重 > 0.6）
3. 加強擾亂止血（門檻 0.15/2 → 0.2/3）
4. 改進特徵提取（過濾通用特徵）

### Phase 3: 長期優化（中優先級）
1. 改進 Embedding 搜尋（Query 優化、多階段搜尋）
2. 重新訓練 Embedding 模型（如果可能）
3. 改進資料庫品質（檢查、修正錯誤資料）

---

## 🧪 測試計劃

### 測試 1: n/a 消除驗證
- 重新運行 `verify_from_tlpg_url.js`
- 確認 n/a 數量從 32 降至 0 或接近 0

### 測試 2: 識別準確率驗證
- 重新運行驗證腳本
- 確認通過率是否提升（目標：> 10%）
- 確認錯誤 Top1 常客是否減少

### 測試 3: 擾亂案例驗證
- 確認擾亂案例是否減少（目標：< 5 個）
- 確認「幫忙」案例是否增加

---

## 📝 備註

1. **通過率 1% 是核心問題**：即使完全消除 n/a，如果識別準確率不提升，系統仍然無法使用
2. **黑名單是短期方案**：長期應該改進 Embedding 模型和資料庫品質
3. **特徵提取是關鍵**：如果 Vision 提取的特徵不準確，Hybrid 搜尋會更差
4. **需要更多資料**：建議收集更多正確識別的案例，分析成功模式
