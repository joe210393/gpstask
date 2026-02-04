# P0 資料清理執行手冊

移除 XX屬／XX科 及無效分類階層，讓 Top30 不再出現垃圾結果。

---

## 一、清理規則

剔除 `chinese_name` 結尾為以下字樣的紀錄：

| 字樣 | 說明 |
|------|------|
| 屬 | 屬級（如柃木屬、榕樹屬） |
| 科 | 科級（如柏科、紅豆杉科） |
| 亞科 | 亞科級 |
| 族 | 族級 |
| 亞屬 | 亞屬級 |
| 綱 | 綱級 |
| 目 | 目級 |

---

## 二、執行步驟（本機）

### 1. 執行清理

```bash
npm run clean:plant-data
```

或：

```bash
node scripts/rag/clean_plant_data.js
```

**輸出**：`scripts/rag/data/plants-forest-gov-tw-clean.jsonl`

### 2. 重置 Qdrant 並清除進度（整庫重建時必做）

本機 Qdrant 若出現 `delete_collection` 500 錯誤（`failed to create directory .deleted`），請用 reset 腳本：

```bash
./scripts/rag/reset_local_qdrant.sh
rm -f scripts/rag/vectordb/embed_plants_forest_jina_progress.json
```

### 3. 重新向量化

本機 Qdrant（reset 後 collection 已清空，不需 FORCE_RECREATE）：

```bash
./scripts/rag/run_local_embed.sh
```

Zeabur Qdrant 請使用 `FORCE_RECREATE=1`。

Zeabur Qdrant（需設定 `QDRANT_URL`、`QDRANT_API_KEY`）：

```bash
export QDRANT_URL="https://gps-task-qdrant.zeabur.app"
export QDRANT_API_KEY="your_key"
# 若用 Jina API
export USE_JINA_API=true
export JINA_API_KEY="your_jina_key"

cd scripts/rag/vectordb && python embed_plants_forest_jina.py
```

**重要**：若 Qdrant 已有舊資料，需先刪除 collection 再重新上傳。embed 腳本會在維度不符時自動刪除舊 collection，但若維度相同會增量上傳。整庫重建時可手動刪除 collection 或清空 progress 後重新跑（腳本會依 plant_id 去重）。

### 4. 重建 plant-name-mapping

```bash
npm run build:plant-mapping
```

### 5. 驗收

- 任意測試圖的 Top30：**不得再出現「XX屬／XX科」**
- 目標：0% 出現率

---

## 三、Zeabur 部署（使用 P0 清理後資料）

若 embedding-api 部署在 Zeabur，需讓 Docker 镜像包含 `plants-forest-gov-tw-clean.jsonl`：

1. 執行 `npm run clean:plant-data`
2. 提交 `scripts/rag/data/plants-forest-gov-tw-clean.jsonl`
3. 取消 `scripts/rag/vectordb/Dockerfile` 中對 `COPY plants-forest-gov-tw-clean.jsonl` 的註解
4. 重新部署

---

## 四、資料流說明

| 步驟 | 輸入 | 輸出 |
|------|------|------|
| clean | final-4302.jsonl | clean.jsonl |
| embed | clean.jsonl（若存在） | Qdrant points |
| start_api | clean.jsonl（若存在） | 特徵權重、候選比對 |
| build:plant-mapping | clean.jsonl（若存在） | plant-name-mapping.json |
