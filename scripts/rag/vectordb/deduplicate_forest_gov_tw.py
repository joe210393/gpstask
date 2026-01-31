#!/usr/bin/env python3
"""
清理 forest-gov-tw 資料中的重複
根據 plant_id (source_url + chinese_name + scientific_name) 去重
只保留每個唯一 plant_id 的第一筆資料
"""
import os
import sys
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
from urllib.parse import urlparse
from collections import defaultdict
from tqdm import tqdm

QDRANT_URL = os.environ.get("QDRANT_URL", "https://gps-task-qdrant.zeabur.app")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")
COLLECTION_NAME = "taiwan_plants"

def get_qdrant_client():
    """建立 Qdrant 客戶端"""
    parsed = urlparse(QDRANT_URL)
    is_https = parsed.scheme == 'https'
    host = parsed.hostname or 'localhost'
    port = parsed.port or (443 if is_https else 6333)
    
    if not QDRANT_API_KEY:
        print("❌ 請設定 QDRANT_API_KEY 環境變數")
        sys.exit(1)
    
    return QdrantClient(
        host=host,
        port=port,
        api_key=QDRANT_API_KEY,
        https=is_https,
        prefer_grpc=False,
        timeout=120
    )

def get_plant_id(payload):
    """產生植物的唯一識別碼"""
    source_url = payload.get("source_url", "") or ""
    chinese_name = payload.get("chinese_name", "") or ""
    scientific_name = payload.get("scientific_name") or ""
    # 如果 scientific_name 是 None，轉換為空字串
    if scientific_name is None:
        scientific_name = ""
    return f"{source_url}|||{chinese_name}|||{scientific_name}"

def deduplicate_forest_gov_tw(client, dry_run=True):
    """清理 forest-gov-tw 資料中的重複"""
    print("=" * 60)
    print("🔍 分析 forest-gov-tw 資料中的重複")
    print("=" * 60)
    
    # 只查詢 forest-gov-tw 的資料
    filter_condition = Filter(
        must=[
            FieldCondition(key="source", match=MatchValue(value="forest-gov-tw"))
        ]
    )
    
    # 取得所有 forest-gov-tw 的資料
    print("\n📥 正在載入所有 forest-gov-tw 資料...")
    all_points = []
    offset = None
    batch_size = 100
    
    while True:
        try:
            result = client.scroll(
                collection_name=COLLECTION_NAME,
                scroll_filter=filter_condition,
                limit=batch_size,
                offset=offset,
                with_payload=True
            )
            points, next_offset = result
            
            if len(points) == 0:
                break
            
            all_points.extend(points)
            offset = next_offset
            
            if next_offset is None:
                break
        except Exception as e:
            print(f"   ⚠️  載入時發生錯誤: {e}")
            break
    
    print(f"   載入完成：{len(all_points):,} 筆")
    
    # 分析重複
    print("\n🔍 分析重複資料...")
    plant_id_to_points = defaultdict(list)
    for point in all_points:
        plant_id = get_plant_id(point.payload)
        plant_id_to_points[plant_id].append(point)
    
    # 找出重複的
    duplicates = {pid: points for pid, points in plant_id_to_points.items() if len(points) > 1}
    unique_count = len([pid for pid, points in plant_id_to_points.items() if len(points) == 1])
    
    print(f"\n📊 分析結果：")
    print(f"   唯一 plant_id: {len(plant_id_to_points):,} 筆")
    print(f"   重複的 plant_id: {len(duplicates):,} 個")
    print(f"   總向量數: {len(all_points):,} 筆")
    print(f"   重複的向量: {len(all_points) - len(plant_id_to_points):,} 筆")
    
    if len(duplicates) > 0:
        print(f"\n📋 重複範例（前 5 個）：")
        for i, (plant_id, points) in enumerate(list(duplicates.items())[:5]):
            parts = plant_id.split('|||')
            print(f"   {i+1}. {parts[1]} ({parts[2]})")
            print(f"      重複 {len(points)} 次")
    
    # 決定要保留和刪除的
    points_to_delete = []
    points_to_keep = []
    
    for plant_id, points in plant_id_to_points.items():
        if len(points) == 1:
            points_to_keep.append(points[0])
        else:
            # 保留第一個，刪除其他的
            points_to_keep.append(points[0])
            points_to_delete.extend(points[1:])
    
    print(f"\n📊 清理計劃：")
    print(f"   保留: {len(points_to_keep):,} 筆")
    print(f"   刪除: {len(points_to_delete):,} 筆")
    
    if dry_run:
        print(f"\n⚠️  這是模擬模式（dry-run），不會實際刪除資料")
        print(f"   實際執行時請使用 --execute 參數")
    else:
        print(f"\n⚠️  這將實際刪除 {len(points_to_delete):,} 筆重複資料")
        response = input("   輸入 'YES' 確認刪除: ")
        if response != 'YES':
            print("   已取消")
            return
        
        # 分批刪除
        print(f"\n🗑️  開始刪除重複資料...")
        delete_ids = [p.id for p in points_to_delete]
        batch_size = 100
        
        for i in tqdm(range(0, len(delete_ids), batch_size), desc="刪除中"):
            batch = delete_ids[i:i+batch_size]
            try:
                client.delete(
                    collection_name=COLLECTION_NAME,
                    points_selector=batch
                )
            except Exception as e:
                print(f"\n   ⚠️  批次 {i//batch_size + 1} 刪除失敗: {e}")
        
        print(f"\n✅ 清理完成！")
        print(f"   刪除了 {len(delete_ids):,} 筆重複資料")
        
        # 驗證
        new_count = client.count(
            collection_name=COLLECTION_NAME,
            count_filter=filter_condition,
            exact=True
        )
        new_count_value = new_count.count if hasattr(new_count, 'count') else new_count
        print(f"   清理後 forest-gov-tw 數量: {new_count_value:,} 筆")
        print(f"   預期: {len(plant_id_to_points):,} 筆（唯一 plant_id）")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="清理 forest-gov-tw 資料中的重複")
    parser.add_argument("--execute", action="store_true", help="實際執行刪除（預設為模擬模式）")
    args = parser.parse_args()
    
    try:
        client = get_qdrant_client()
        deduplicate_forest_gov_tw(client, dry_run=not args.execute)
    except Exception as e:
        print(f"\n❌ 錯誤: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
