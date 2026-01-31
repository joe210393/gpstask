#!/usr/bin/env python3
"""
檢查 Qdrant 向量資料狀態
用於確認是否使用正確的向量資料
"""
import os
import sys
from qdrant_client import QdrantClient
from urllib.parse import urlparse

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
        timeout=30
    )

def main():
    print("=" * 60)
    print("📊 Qdrant 向量資料檢查")
    print("=" * 60)
    print(f"\n🔗 Qdrant URL: {QDRANT_URL}")
    print(f"📦 Collection: {COLLECTION_NAME}")
    
    try:
        client = get_qdrant_client()
        
        # 檢查 collection 是否存在
        collections = client.get_collections().collections
        collection_names = [c.name for c in collections]
        
        if COLLECTION_NAME not in collection_names:
            print(f"\n❌ Collection '{COLLECTION_NAME}' 不存在！")
            print(f"   現有的 collections: {', '.join(collection_names)}")
            sys.exit(1)
        
        # 取得 collection 資訊
        collection = client.get_collection(COLLECTION_NAME)
        count_result = client.count(collection_name=COLLECTION_NAME, exact=True)
        count = count_result.count if hasattr(count_result, 'count') else count_result
        
        print(f"\n✅ Collection 狀態：")
        print(f"   📊 向量數量: {count:,} 筆")
        print(f"   📐 向量維度: {collection.config.params.vectors.size}")
        print(f"   📏 距離度量: {collection.config.params.vectors.distance}")
        
        # 取樣檢查資料來源
        print(f"\n🔍 資料來源檢查（取樣 5 筆）：")
        results = client.scroll(
            collection_name=COLLECTION_NAME,
            limit=5,
            with_payload=True
        )
        
        sources = {}
        for point in results[0]:
            payload = point.payload
            source = payload.get('source', 'unknown')
            sources[source] = sources.get(source, 0) + 1
            
            print(f"\n   • 中文名: {payload.get('chinese_name', 'N/A')}")
            print(f"     學名: {payload.get('scientific_name', 'N/A')}")
            print(f"     來源: {source}")
            if payload.get('source_url'):
                url = payload.get('source_url', '')
                if 'forest.gov.tw' in url:
                    print(f"     ✅ 新資料來源（forest.gov.tw）")
                else:
                    print(f"     ⚠️  舊資料來源")
        
        print(f"\n📈 資料來源統計（取樣）：")
        for source, cnt in sources.items():
            print(f"   {source}: {cnt} 筆")
        
        # 檢查預期的向量數量
        print(f"\n💡 預期狀態：")
        print(f"   - 新資料（plants-forest-gov-tw.jsonl）: 4,670 筆")
        print(f"   - 唯一植物 ID: 4,302 筆")
        print(f"   - 實際 Qdrant 向量: {count:,} 筆")
        
        # 使用 filter 精確統計 forest-gov-tw 的數量
        print(f"\n📊 精確統計資料來源...")
        try:
            from qdrant_client.models import Filter, FieldCondition, MatchValue
            
            # 查詢 forest-gov-tw 的數量
            forest_gov_tw_filter = Filter(
                must=[
                    FieldCondition(key="source", match=MatchValue(value="forest-gov-tw"))
                ]
            )
            
            forest_gov_tw_count_result = client.count(
                collection_name=COLLECTION_NAME,
                count_filter=forest_gov_tw_filter,
                exact=True
            )
            forest_gov_tw_count = forest_gov_tw_count_result.count if hasattr(forest_gov_tw_count_result, 'count') else forest_gov_tw_count_result
            
            print(f"\n📊 資料來源統計（精確）：")
            print(f"   forest-gov-tw（新資料）: {forest_gov_tw_count:,} 筆")
            print(f"   其他來源: {count - forest_gov_tw_count:,} 筆")
            print(f"   總計: {count:,} 筆")
            
            forest_gov_tw_percentage = (forest_gov_tw_count / count) * 100 if count > 0 else 0
            print(f"\n📈 新資料比例: {forest_gov_tw_percentage:.1f}%")
            print(f"   預期新資料: 4,670 筆（唯一植物 ID: 4,302 筆）")
            
            if forest_gov_tw_count >= 4000:
                print(f"\n✅ 新資料（forest-gov-tw）已存在於 Qdrant 中")
                if forest_gov_tw_count > 5000:
                    print(f"   ⚠️  數量比預期多（{forest_gov_tw_count:,} vs 4,670），可能包含重複資料")
                    print(f"   💡 這是因為之前使用舊格式時，重複的 source_url 被多次處理")
                else:
                    print(f"   ✅ 數量符合預期範圍")
            elif count >= 4000:
                print(f"\n⚠️  向量數量足夠，但新資料比例較低（{forest_gov_tw_percentage:.1f}%）")
            else:
                print(f"\n⚠️  向量數量較少，可能是舊資料")
                
        except Exception as e:
            print(f"\n⚠️  無法精確統計（可能不支援 filter）: {e}")
            print(f"   使用取樣方式...")
            
            # 備用方案：取樣統計
            sample_size = min(100, count)
            results = client.scroll(
                collection_name=COLLECTION_NAME,
                limit=sample_size,
                with_payload=True
            )
            
            if len(results[0]) > 0:
                source_stats = {}
                forest_gov_tw_count = 0
                for point in results[0]:
                    payload = point.payload
                    source = payload.get('source', 'unknown')
                    source_stats[source] = source_stats.get(source, 0) + 1
                    if source == 'forest-gov-tw':
                        forest_gov_tw_count += 1
                
                print(f"\n📊 資料來源統計（取樣 {len(results[0])} 筆）：")
                for source, cnt in sorted(source_stats.items(), key=lambda x: x[1], reverse=True):
                    percentage = (cnt / len(results[0])) * 100
                    print(f"   {source}: {cnt} 筆 ({percentage:.1f}%)")
                
                estimated = int(count * (forest_gov_tw_count / len(results[0])))
                print(f"\n📈 估算 forest-gov-tw: 約 {estimated:,} 筆")
        
    except Exception as e:
        print(f"\n❌ 錯誤: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
