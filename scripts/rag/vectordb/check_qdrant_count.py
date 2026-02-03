#!/usr/bin/env python
"""檢查 Qdrant 中的實際資料筆數和 unique plant_id 數量"""
import os
from urllib.parse import urlparse
from qdrant_client import QdrantClient

QDRANT_URL = os.environ.get("QDRANT_URL", "https://gps-task-qdrant.zeabur.app")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "s659vbjm0Tf2q8WUw1oInr3PK74uycLd")
COLLECTION_NAME = "taiwan_plants"

print("🔍 連接 Qdrant...")
parsed = urlparse(QDRANT_URL)
client = QdrantClient(
    host=parsed.hostname,
    port=parsed.port or 443,
    api_key=QDRANT_API_KEY,
    https=True,
    timeout=60,
)

print("📊 檢查 Collection 資訊...")
try:
    # 1. 取得總點數（包含所有 chunks）
    count_result = client.count(collection_name=COLLECTION_NAME, exact=True)
    total_points = count_result.count
    print(f"   ✅ 總點數（包含所有 chunks）: {total_points}")
    
    # 2. 取得 Collection 資訊
    info = client.get_collection(collection_name=COLLECTION_NAME)
    print(f"   📋 Collection 名稱: {COLLECTION_NAME}")
    print(f"   📋 向量維度: {info.config.params.vectors.size}")
    print(f"   📋 距離計算: {info.config.params.vectors.distance}")
    print(f"   📋 狀態: {info.status}")
    
    # 3. 快速掃描前幾批來估算（避免超時）
    print("\n🔍 快速掃描前 5000 個點來估算 unique plant_id...")
    existing_ids = set()
    offset = None
    batch = 0
    total_scanned = 0
    max_scan = min(5000, total_points)  # 最多掃描 5000 個點
    
    while total_scanned < max_scan:
        try:
            scroll_res, offset = client.scroll(
                collection_name=COLLECTION_NAME,
                limit=min(1000, max_scan - total_scanned),
                with_payload=True,
                with_vectors=False,
                offset=offset,
            )
            if not scroll_res:
                break
            
            batch += 1
            for p in scroll_res:
                total_scanned += 1
                payload = p.payload or {}
                pid = payload.get("plant_id")
                if not pid:
                    source_url = payload.get("source_url", "")
                    chinese_name = payload.get("chinese_name", "")
                    scientific_name = payload.get("scientific_name", "")
                    if source_url or chinese_name or scientific_name:
                        pid = f"{source_url}|{chinese_name}|{scientific_name}"
                if pid:
                    existing_ids.add(pid)
            
            print(f"   已掃描 {total_scanned}/{max_scan} 個點，找到 {len(existing_ids)} 個 unique plant_id...")
        except Exception as e:
            print(f"⚠️ Scroll 錯誤: {e}")
            break
    
    # 如果掃描的點數少於總點數，用比例估算
    if total_scanned < total_points:
        estimated_unique = int(len(existing_ids) * (total_points / total_scanned))
        print(f"\n📊 統計結果（基於前 {total_scanned} 個點的估算）:")
        print(f"   ✅ 總點數（chunks）: {total_points}")
        print(f"   ✅ 已掃描點數: {total_scanned}")
        print(f"   ✅ 掃描範圍內的 unique plant_id: {len(existing_ids)}")
        print(f"   📈 估算總 unique plant_id: ~{estimated_unique}")
        print(f"   📈 平均每個植物約有 {total_points / estimated_unique if estimated_unique > 0 else 0:.2f} 個 chunks")
        
        if estimated_unique == 4302:
            print(f"\n✅ 估算結果符合預期（4302 個 unique plant_id）")
        elif 4200 <= estimated_unique <= 4400:
            print(f"\n✅ 估算結果接近預期（4302），差異在可接受範圍內")
        else:
            print(f"\n⚠️  注意：估算 unique plant_id ({estimated_unique}) 與預期的 4302 差異較大")
    else:
        # 掃描了全部點
        print(f"\n📊 統計結果:")
        print(f"   ✅ 總點數（chunks）: {total_points}")
        print(f"   ✅ Unique plant_id: {len(existing_ids)}")
        print(f"   📈 平均每個植物有 {total_points / len(existing_ids) if existing_ids else 0:.2f} 個 chunks")
        
        if len(existing_ids) == 4302:
            print(f"\n✅ 完美！正好是 4302 個 unique plant_id，符合預期")
        else:
            print(f"\n⚠️  注意：unique plant_id 數量 ({len(existing_ids)}) 與預期的 4302 不符")
        
except Exception as e:
    print(f"❌ 錯誤: {e}")
    import traceback
    traceback.print_exc()
