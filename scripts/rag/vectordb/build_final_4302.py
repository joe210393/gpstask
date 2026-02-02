#!/usr/bin/env python
import os
import json
from pathlib import Path
from urllib.parse import urlparse
from qdrant_client import QdrantClient

QDRANT_URL = os.environ.get("QDRANT_URL", "https://gps-task-qdrant.zeabur.app")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "s659vbjm0Tf2q8WUw1oInr3PK74uycLd")
COLLECTION_NAME = "taiwan_plants"

DATA_FILE = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw-clean.jsonl"
FINAL_FILE = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw-final-4302.jsonl"
MISSING_FILE = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw-missing.jsonl"

print(f"📄 DATA_FILE: {DATA_FILE}")
if not DATA_FILE.exists():
    raise SystemExit(f"❌ 資料檔不存在: {DATA_FILE}")

# 讀取所有植物
plants = []
with DATA_FILE.open("r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            plants.append(json.loads(line))
        except json.JSONDecodeError:
            continue

print(f"📊 檔案中植物筆數: {len(plants)}")

# 連接 Qdrant
parsed = urlparse(QDRANT_URL)
client = QdrantClient(
    host=parsed.hostname,
    port=parsed.port or 443,
    api_key=QDRANT_API_KEY,
    https=True,
    timeout=60,  # 增加 timeout
)

print("🔍 從 Qdrant 載入現有 plant_id...")
print("   注意：Qdrant 中每個植物可能有多個 chunks，需要掃描所有點...")
existing_ids = set()
offset = None
batch = 0
total_scanned = 0
target_count = 4302  # 預期目標數量
consecutive_no_new = 0  # 連續沒有新 ID 的批次數

while True:
    try:
        scroll_res, offset = client.scroll(
            collection_name=COLLECTION_NAME,
            limit=1000,  # 增加批次大小
            with_payload=True,
            with_vectors=False,
            offset=offset,
        )
        if not scroll_res:
            break
        
        batch += 1
        batch_start_count = len(existing_ids)
        
        for p in scroll_res:
            total_scanned += 1
            payload = p.payload or {}
            # 嘗試多種方式取得 plant_id
            pid = payload.get("plant_id")
            if not pid:
                # 如果沒有 plant_id，用其他欄位組合
                source_url = payload.get("source_url", "")
                chinese_name = payload.get("chinese_name", "")
                scientific_name = payload.get("scientific_name", "")
                if source_url or chinese_name or scientific_name:
                    pid = f"{source_url}|{chinese_name}|{scientific_name}"
            if pid:
                existing_ids.add(pid)
        
        # 檢查這批次是否有新 ID
        if len(existing_ids) == batch_start_count:
            consecutive_no_new += 1
        else:
            consecutive_no_new = 0
        
        # 如果已經找到目標數量，且連續 5 批次沒有新 ID，可以提前停止
        if len(existing_ids) >= target_count and consecutive_no_new >= 5:
            print(f"   ✅ 已找到 {len(existing_ids)} 個 unique plant_id，提前停止掃描")
            break
        
        if batch % 10 == 0:
            print(f"   已掃描 {total_scanned} 個點，找到 {len(existing_ids)} 個 unique plant_id...")
    except Exception as e:
        print(f"⚠️ Scroll 錯誤: {e}")
        break

print(f"✅ Qdrant 中 unique plant_id 數量: {len(existing_ids)} (總共掃描 {total_scanned} 個點)")

# 使用相同的 plant_id 規則
def get_plant_id(plant):
    source_url = plant.get("source_url", "")
    chinese_name = plant.get("chinese_name", "")
    scientific_name = plant.get("scientific_name", "")
    return f"{source_url}|{chinese_name}|{scientific_name}"

final_plants = []
missing_plants = []
seen_pids = set()  # 用於去重

for p in plants:
    pid = get_plant_id(p)
    if pid in existing_ids:
        # 只保留第一次出現的 plant_id（去重）
        if pid not in seen_pids:
            final_plants.append(p)
            seen_pids.add(pid)
        else:
            # 重複的 plant_id，記錄到 missing（實際上是重複，不是真的 missing）
            missing_plants.append(p)
    else:
        missing_plants.append(p)

print(f"✅ final_plants (去重後): {len(final_plants)}")
print(f"⚠️ missing_plants (包含重複): {len(missing_plants)}")
print(f"📊 unique plant_id 數量: {len(seen_pids)}")

with FINAL_FILE.open("w", encoding="utf-8") as f:
    for p in final_plants:
        f.write(json.dumps(p, ensure_ascii=False) + "\n")

with MISSING_FILE.open("w", encoding="utf-8") as f:
    for p in missing_plants:
        f.write(json.dumps(p, ensure_ascii=False) + "\n")

print(f"💾 已輸出 FINAL_FILE: {FINAL_FILE} ({len(final_plants)} 筆)")
print(f"💾 已輸出 MISSING_FILE: {MISSING_FILE} ({len(missing_plants)} 筆)")
