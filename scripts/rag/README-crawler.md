# 林務局植物資料爬蟲

## 使用說明

### 1. 啟動爬蟲

```bash
# 背景執行（推薦）
nohup node scripts/rag/crawl-forest-gov-tw.js > scripts/rag/data/crawl-forest.log 2>&1 &

# 或前景執行（可看到即時輸出）
node scripts/rag/crawl-forest-gov-tw.js
```

### 2. 查看進度

```bash
# 快速查看進度
node scripts/rag/check-crawl-progress.js

# 查看即時日誌
tail -f scripts/rag/data/crawl-forest.log
```

### 3. 停止爬蟲

```bash
# 找到進程 ID
ps aux | grep "crawl-forest-gov-tw.js" | grep -v grep

# 停止進程（替換 PID）
kill <PID>
```

## 資料檔案

- **輸出檔案**: `scripts/rag/data/plants-forest-gov-tw.jsonl`
- **進度檔案**: `scripts/rag/data/crawl-forest-progress.json`
- **日誌檔案**: `scripts/rag/data/crawl-forest.log`

## 進度說明

- 總共需要處理：**2612 個植物**
- 每個植物需要：
  - 爬取詳細頁面：~1 秒
  - AI 轉換格式：~5-10 秒
- 預計總時間：**數小時**（取決於 AI API 速度）

## 中斷與恢復

爬蟲支援中斷後繼續：
- 進度每 5 筆自動保存
- 重新啟動會從上次中斷的地方繼續
- 已處理的植物不會重複處理

## 後續擴展

完成樹木資料後，可以擴展到：
- 蕨類植物
- 水生植物（水草）
- 花卉植物
- 其他植物分類

只需修改 `CHINESE_INDEX_PAGES` 或添加新的索引頁面 URL 即可。
