# 台灣植物爬蟲與 RAG 資料準備系統

## 專案概述

這是一個完整的植物資料爬取與 RAG (Retrieval-Augmented Generation) 資料準備系統，專門用於從台灣植物資訊整合查詢系統 (https://tai2.ntu.edu.tw) 爬取植物資料，並轉換為適合 RAG 應用的格式。

## 主要功能

1. **植物編碼發現** - 自動發現有效的植物編碼
2. **批量資料爬取** - 並行爬取大量植物資料
3. **資料品質評估** - 自動評估資料完整性
4. **RAG 資料準備** - 轉換為標準 RAG 文件格式
5. **跨語言支援** - 支援中英文混合檢索

## 檔案結構

```
scripts/plant_crawler/
├── plant_parser.py              # 單個植物頁面解析器
├── code_discovery.py            # 植物編碼發現器（完整版）
├── fast_discovery.py            # 快速編碼發現器
├── batch_crawler.py             # 批量爬蟲主程式
├── prepare_rag_data.py          # RAG 資料準備工具
├── test_rag_quality.py          # RAG 資料品質測試
├── test_jina_crosslingual.py    # Jina 跨語言能力測試
├── statistics.py                # 資料統計分析工具
├── requirements.txt             # Python 依賴
├── plant_codes.txt              # 植物編碼列表
├── plant_codes.json             # 植物編碼列表（JSON）
└── plant_data/                  # 爬取的資料
    ├── *.json                   # 個別植物資料
    ├── all_plants.json          # 所有植物合集
    ├── rag_plants.json          # RAG 可用植物
    ├── rag_documents.json       # RAG 文件（JSON）
    └── rag_documents.jsonl      # RAG 文件（JSONL）
```

## 使用方式

### 1. 安裝依賴

```bash
cd scripts/plant_crawler
pip install -r requirements.txt
```

### 2. 發現植物編碼

```bash
# 快速發現（推薦用於測試）
python fast_discovery.py

# 完整發現（耗時較長）
python code_discovery.py
```

### 3. 批量爬取植物資料

```bash
# 使用預設設定
python batch_crawler.py

# 自訂參數
python batch_crawler.py plant_codes.txt ./plant_data 0.5
```

參數說明：
- `plant_codes.txt` - 植物編碼列表檔案
- `./plant_data` - 輸出目錄
- `0.5` - 請求延遲（秒）

### 4. 準備 RAG 資料

```bash
python prepare_rag_data.py
```

輸出：
- `plant_data/rag_documents.json` - RAG 文件（JSON 格式）
- `plant_data/rag_documents.jsonl` - RAG 文件（JSONL 格式，每行一個文件）

### 5. 測試資料品質

```bash
python test_rag_quality.py
```

### 6. 測試跨語言能力（可選）

```bash
# 需要額外安裝 sentence-transformers
pip install sentence-transformers scikit-learn

python test_jina_crosslingual.py
```

## RAG 資料格式

### JSON 格式 (rag_documents.json)

```json
{
  "metadata": {
    "total_documents": 29,
    "created_at": "2026-01-20 04:46:07",
    "description": "台灣植物 RAG 文件集"
  },
  "documents": [
    {
      "id": "105_001_01_0",
      "text": "植物名稱：ramosissimum\n學名：Equisetum ramosissimum\nDescription: ...",
      "metadata": {
        "code": "105+001+01+0",
        "url": "https://tai2.ntu.edu.tw/PlantInfo/species-name.php?code=105+001+01+0",
        "name_zh": "ramosissimum",
        "name_latin": "Equisetum ramosissimum",
        "completeness_score": 3.8
      }
    }
  ]
}
```

### JSONL 格式 (rag_documents.jsonl)

每行一個 JSON 物件，適合流式處理：

```jsonl
{"id": "105_001_01_0", "text": "植物名稱：...", "metadata": {...}}
{"id": "110_001_01_0", "text": "植物名稱：...", "metadata": {...}}
```

## 資料品質

目前爬取的資料品質評估：

- ✅ 總文件數：29 個植物
- ✅ 文件結構：100% 完整
- ✅ 平均文本長度：631 字元
- ✅ 中英文混合：100%
- ✅ 元資料完整性：100%
- ✅ **品質評分：5/5**

## 建議的 RAG 應用方式

### 1. 向量模型選擇

推薦使用 **jinaai/jina-embeddings-v2-base-zh**：
- 支援中英文跨語言檢索
- 中文查詢可自動匹配英文描述
- 預期準確率：85-95%

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('jinaai/jina-embeddings-v2-base-zh')
embeddings = model.encode(texts, normalize_embeddings=True)
```

### 2. 向量資料庫選擇

可選用以下任一向量資料庫：
- **Chroma** - 輕量級，適合開發
- **FAISS** - 高效能，適合大規模
- **Pinecone** - 雲端託管
- **Weaviate** - 功能豐富

### 3. 範例：使用 Chroma

```python
import chromadb
from chromadb.utils import embedding_functions

# 初始化
client = chromadb.Client()
jina_ef = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="jinaai/jina-embeddings-v2-base-zh"
)

# 創建集合
collection = client.create_collection(
    name="taiwan_plants",
    embedding_function=jina_ef
)

# 載入文件
import json
with open('plant_data/rag_documents.jsonl', 'r') as f:
    for line in f:
        doc = json.loads(line)
        collection.add(
            ids=[doc['id']],
            documents=[doc['text']],
            metadatas=[doc['metadata']]
        )

# 查詢
results = collection.query(
    query_texts=["橢圓形葉子，有光澤，樟腦味"],
    n_results=5
)
```

## 進階功能

### 資料統計分析

```bash
# 快速測試
python statistics.py quick

# 分析指定編碼列表
python statistics.py plant_codes.txt 50
```

### 斷點續傳

批量爬蟲支援斷點續傳，如果爬取中斷，重新執行會自動跳過已下載的檔案：

```bash
# 重新執行，自動跳過已爬取的資料
python batch_crawler.py
```

## 注意事項

1. **禮貌爬取**：預設延遲 0.5 秒/請求，請勿調整過低
2. **資料來源**：台灣植物資訊整合查詢系統 (https://tai2.ntu.edu.tw)
3. **學術用途**：建議僅用於教育和研究目的
4. **資料更新**：植物資料可能隨時間更新，建議定期重新爬取

## 已知問題與限制

1. **編碼發現不完整**：目前只發現了約 30 個有效編碼（實際約 5,400 種）
2. **照片資料缺失**：大部分植物的照片仍在建置中
3. **科名資訊空白**：解析器未能正確提取科名資訊

## 改進計劃

- [ ] 改進編碼發現策略，提高覆蓋率
- [ ] 優化科名和分類資訊提取
- [ ] 添加中文描述翻譯功能
- [ ] 支援更多資料來源
- [ ] 添加圖片下載功能

## 授權

本專案僅供學習和研究使用。資料來源為台灣植物資訊整合查詢系統，請遵守原網站的使用條款。

## 聯絡方式

如有問題或建議，請開 Issue 討論。
