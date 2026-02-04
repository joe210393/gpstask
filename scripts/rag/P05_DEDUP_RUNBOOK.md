# P0.5 資料去重與重新向量化 Runbook

依 `scientific_name` 合併同物種多筆紀錄，減少 Top30 被同種佔據、提升辨識效果。

---

## 一、前置條件

- 已執行 P0 清理：`plants-forest-gov-tw-clean.jsonl` 存在
- 若尚未執行 P0，先跑：`npm run clean:plant-data`

---

## 二、執行步驟

### 步驟 1：執行去重腳本

```bash
npm run dedup:plant-data
# 或
node scripts/rag/dedup_plant_data.js
```

**輸出**：`scripts/rag/data/plants-forest-gov-tw-dedup.jsonl`

**說明**：依學名分組合併，無學名紀錄保留不併。

---

### 步驟 2：重置 Qdrant（本機）

```bash
./scripts/rag/reset_local_qdrant.sh
```

若無此腳本或 Qdrant 非本機，改為：
- Zeabur：刪除 taiwan_plants collection 後重新建立
- 或執行 embed 時加上 `FORCE_RECREATE=1`

---

### 步驟 3：刪除向量化進度檔

```bash
rm -f scripts/rag/vectordb/embed_plants_forest_jina_progress.json
```

避免沿用舊進度、漏掉新筆數。

---

### 步驟 4：重新向量化

```bash
FORCE_RECREATE=1 ./scripts/rag/run_local_embed.sh
```

或（若用 Zeabur 部署）：
- 在 embed 腳本所在環境設定 `FORCE_RECREATE=1`
- 執行向量化（依你們 Zeabur 流程）

---

### 步驟 5：重建 plant-name-mapping

```bash
npm run build:plant-mapping
```

---

## 三、驗收

| 項目 | 預期 |
|------|------|
| dedup 後筆數 | 少於 clean 筆數（約 4188 → 3800+） |
| Qdrant collection | 僅 dedup 後筆數的 points |
| Top30 搜尋 | 同物種不再重複出現多筆 |

---

## 四、本機完整指令（一次執行）

```bash
# 1. 去重
npm run dedup:plant-data

# 2. 重置 Qdrant
./scripts/rag/reset_local_qdrant.sh

# 3. 刪除進度
rm -f scripts/rag/vectordb/embed_plants_forest_jina_progress.json

# 4. 重新向量化（會自動使用 dedup 檔案）
FORCE_RECREATE=1 ./scripts/rag/run_local_embed.sh

# 5. 重建 mapping
npm run build:plant-mapping
```

---

## 五、Zeabur 部署注意

若 embedding-api 在 Zeabur：
1. 將 `plants-forest-gov-tw-dedup.jsonl` 一併部署（需在 Dockerfile 中 COPY）
2. 或於建置流程中從 clean 產出 dedup 後再 embed
3. Qdrant 需重建 collection 以載入新向量
