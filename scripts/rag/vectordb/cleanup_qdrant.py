#!/usr/bin/env python3
"""
清理 Qdrant 向量資料
選項：
1. 只保留新資料（forest-gov-tw），刪除所有舊資料
2. 刪除重複的新資料（只保留唯一的）
"""
import os
import sys
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
from urllib.parse import urlparse
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

def analyze_data(client):
    """分析資料來源"""
    print("=" * 60)
    print("📊 分析 Qdrant 資料")
    print("=" * 60)
    
    total_count = client.count(collection_name=COLLECTION_NAME, exact=True)
    total = total_count.count if hasattr(total_count, 'count') else total_count
    print(f"\n總向量數量: {total:,} 筆")
    
    # 統計各來源
    sources = [
        "forest-gov-tw",
        "moa-plant-illustration",
        "vascular-local",
        "aquaplants-local",
        "seaweeds-local",
        "mosses-local",
        "liverworts-local",
        "wetland-local"
    ]
    
    source_counts = {}
    for source in sources:
        try:
            filter_condition = Filter(
                must=[
                    FieldCondition(key="source", match=MatchValue(value=source))
                ]
            )
            count_result = client.count(
                collection_name=COLLECTION_NAME,
                count_filter=filter_condition,
                exact=True
            )
            count = count_result.count if hasattr(count_result, 'count') else count_result
            source_counts[source] = count
        except Exception as e:
            print(f"   ⚠️  無法統計 {source}: {e}")
            source_counts[source] = 0
    
    print(f"\n📊 資料來源統計：")
    for source, cnt in sorted(source_counts.items(), key=lambda x: x[1], reverse=True):
        percentage = (cnt / total) * 100 if total > 0 else 0
        print(f"   {source}: {cnt:,} 筆 ({percentage:.1f}%)")
    
    return source_counts, total

def delete_old_data(client, dry_run=True):
    """刪除舊資料（只保留 forest-gov-tw）"""
    print("\n" + "=" * 60)
    print("🗑️  清理舊資料")
    print("=" * 60)
    
    if dry_run:
        print("\n⚠️  這是模擬模式（dry-run），不會實際刪除資料")
    else:
        print("\n⚠️  這將實際刪除資料，請確認！")
        response = input("   輸入 'YES' 確認刪除: ")
        if response != 'YES':
            print("   已取消")
            return
    
    # 要刪除的來源
    sources_to_delete = [
        "moa-plant-illustration",
        "vascular-local",
        "aquaplants-local",
        "seaweeds-local",
        "mosses-local",
        "liverworts-local",
        "wetland-local"
    ]
    
    total_deleted = 0
    for source in sources_to_delete:
        try:
            filter_condition = Filter(
                must=[
                    FieldCondition(key="source", match=MatchValue(value=source))
                ]
            )
            
            # 先統計要刪除的數量
            count_result = client.count(
                collection_name=COLLECTION_NAME,
                count_filter=filter_condition,
                exact=True
            )
            count = count_result.count if hasattr(count_result, 'count') else count_result
            
            if count > 0:
                print(f"\n   刪除 {source}: {count:,} 筆")
                if not dry_run:
                    try:
                        from qdrant_client.models import PointsSelector, FilterSelector
                        # 使用 FilterSelector 刪除符合條件的點
                        client.delete(
                            collection_name=COLLECTION_NAME,
                            points_selector=FilterSelector(filter=filter_condition)
                        )
                        print(f"   ✅ 已刪除 {count:,} 筆")
                    except Exception as e:
                        print(f"   ❌ 刪除失敗: {e}")
                        # 嘗試使用 scroll + delete by IDs 的方式
                        try:
                            print(f"   嘗試使用備用方法...")
                            points_to_delete = []
                            offset = None
                            while len(points_to_delete) < count:
                                result = client.scroll(
                                    collection_name=COLLECTION_NAME,
                                    scroll_filter=filter_condition,
                                    limit=min(100, count - len(points_to_delete)),
                                    offset=offset,
                                    with_payload=False
                                )
                                points, next_offset = result
                                if len(points) == 0:
                                    break
                                points_to_delete.extend([p.id for p in points])
                                offset = next_offset
                                if next_offset is None:
                                    break
                            
                            if points_to_delete:
                                # 分批刪除
                                batch_size = 100
                                for i in range(0, len(points_to_delete), batch_size):
                                    batch = points_to_delete[i:i+batch_size]
                                    client.delete(
                                        collection_name=COLLECTION_NAME,
                                        points_selector=batch
                                    )
                                print(f"   ✅ 已刪除 {len(points_to_delete):,} 筆（使用備用方法）")
                        except Exception as e2:
                            print(f"   ❌ 備用方法也失敗: {e2}")
                total_deleted += count
            else:
                print(f"   跳過 {source}: 0 筆")
        except Exception as e:
            print(f"   ⚠️  刪除 {source} 時發生錯誤: {e}")
    
    print(f"\n📊 總共將刪除: {total_deleted:,} 筆")
    if not dry_run:
        print(f"✅ 清理完成！")
    else:
        print(f"💡 這是模擬模式，實際執行時請使用 --execute 參數")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="清理 Qdrant 向量資料")
    parser.add_argument("--execute", action="store_true", help="實際執行刪除（預設為模擬模式）")
    parser.add_argument("--analyze-only", action="store_true", help="只分析，不刪除")
    args = parser.parse_args()
    
    try:
        client = get_qdrant_client()
        
        # 分析資料
        source_counts, total = analyze_data(client)
        
        if args.analyze_only:
            print("\n✅ 分析完成（只分析模式）")
            return
        
        # 刪除舊資料
        delete_old_data(client, dry_run=not args.execute)
        
        # 再次統計
        if args.execute:
            print("\n" + "=" * 60)
            print("📊 清理後的統計")
            print("=" * 60)
            new_total = client.count(collection_name=COLLECTION_NAME, exact=True)
            new_total_count = new_total.count if hasattr(new_total, 'count') else new_total
            print(f"\n清理後總向量數量: {new_total_count:,} 筆")
            print(f"刪除了: {total - new_total_count:,} 筆")
        
    except Exception as e:
        print(f"\n❌ 錯誤: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
