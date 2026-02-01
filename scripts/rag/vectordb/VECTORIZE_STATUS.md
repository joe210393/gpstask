# 向量化狀態

## 當前狀態

向量化腳本正在背景執行中。

## 檢查進度

```bash
# 檢查進度檔案
python3 -c "
import json
with open('scripts/rag/vectordb/embed_plants_forest_jina_progress.json', 'r') as f:
    data = json.load(f)
    processed = data.get('processed', [])
    print(f'已處理：{len(processed)} / 4670 筆 ({len(processed)/4670*100:.1f}%)')
"

# 檢查進程
ps aux | grep embed_plants_forest_jina | grep -v grep

# 查看日誌（如果有的話）
tail -f /tmp/vectorize.log
```

## 環境變數

已設定的環境變數：
- ✅ QDRANT_URL: https://gps-task-qdrant.zeabur.app
- ✅ QDRANT_API_KEY: 已設定
- ✅ JINA_API_KEY: 已設定
- ✅ AUTO_CONFIRM: true

## 預估

- 總資料：4,670 筆
- 預估 tokens：約 701,434 tokens（約 7% 免費額度）
- 批次大小：16 筆/批次
- 預估批次數：約 292 批次

## 注意事項

1. 腳本會自動保存進度，中斷後可以繼續
2. 使用批次處理和重試機制，避免 API 限制
3. 完成後會自動更新 Qdrant collection

## 完成後

向量化完成後：
1. 檢查 Qdrant collection 中的資料數量
2. 測試 API 端點是否正常
3. 驗證檢索準確度是否提升
