# 多 Collection RAG 架構設計

## 架構概述

將原本單一的 `taiwan_plants` collection 擴展為多個 collection，每個生物類別使用獨立的 collection。

## Collection 規劃

1. **`taiwan_plants`** - 台灣植物（現有）
2. **`terrestrial_animals`** - 陸地生物（新增）
3. **`marine_organisms`** - 海洋生物（新增）

## 分類邏輯

### Vision AI 分類 → Collection 對應

```javascript
const COLLECTION_MAP = {
  'plant': 'taiwan_plants',
  'terrestrial_animal': 'terrestrial_animals',
  'marine_organism': 'marine_organisms',
  // 未來可擴展
  'insect': 'insects',
  'bird': 'birds',
  // ...
};
```

### 搜尋流程

1. Vision AI 分析圖片 → 判斷類別（植物/陸地生物/海洋生物）
2. 根據類別選擇對應的 collection
3. 在該 collection 中進行 RAG 搜尋
4. 返回結果

## 優點

1. **精準度提升**：不會在植物資料庫中搜尋動物
2. **效能提升**：各 collection 資料量小，搜尋更快
3. **擴展性**：新增類別不影響現有資料
4. **成本降低**：只搜尋相關 collection，減少 token 消耗
5. **維護性**：各類別獨立管理

## 實作步驟

### 1. 修改 `start_api.py`
- 支援多 collection 搜尋
- 根據分類結果選擇 collection
- 新增 `category` 參數到搜尋 API

### 2. 修改 `plant-search-client.js`
- 新增 `category` 參數
- 根據 Vision AI 的分類結果選擇 collection

### 3. 修改 `index.js`
- 從 Vision AI 回應中提取 `category`
- 傳遞 `category` 給 RAG 搜尋

### 4. 建立新的 collection
- 使用 `embed_plants.py` 作為範本
- 建立 `embed_terrestrial_animals.py` 和 `embed_marine_organisms.py`

## 向後相容

- 如果未指定 `category`，預設使用 `taiwan_plants`（保持現有行為）
- 現有的植物資料不受影響
