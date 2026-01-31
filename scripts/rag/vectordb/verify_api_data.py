#!/usr/bin/env python3
"""
驗證 Embedding API 是否使用新的向量資料
"""
import os
import sys
import json
from urllib.parse import urlparse
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# 從環境變數或預設值取得 API URL
EMBEDDING_API_URL = os.environ.get("EMBEDDING_API_URL", "http://gpstask-ooffix:8080")
# 如果沒有設定，嘗試從常見的 Zeabur URL 格式推測
if not EMBEDDING_API_URL or EMBEDDING_API_URL == "null":
    EMBEDDING_API_URL = "https://gps-task-embedding.zeabur.app"

def check_api_health():
    """檢查 API 健康狀態"""
    print("=" * 60)
    print("方法 1: 檢查 Embedding API 健康狀態")
    print("=" * 60)
    print()
    
    try:
        url = f"{EMBEDDING_API_URL}/health"
        print(f"📡 請求: {url}")
        req = Request(url)
        with urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            print("✅ API 健康狀態：")
            print(f"   狀態: {data.get('status', 'unknown')}")
            print(f"   模型: {data.get('model', 'unknown')}")
            print(f"   使用 Jina API: {data.get('use_jina_api', False)}")
            print(f"   Qdrant 連線: {data.get('qdrant_connected', False)}")
            print(f"   Qdrant URL: {data.get('qdrant_url', 'unknown')}")
            print(f"   就緒: {data.get('ready', False)}")
            return True
    except HTTPError as e:
        print(f"❌ API 回應錯誤: HTTP {e.code}")
        return False
    except Exception as e:
        print(f"❌ 無法連接到 API: {e}")
        print(f"   URL: {EMBEDDING_API_URL}")
        return False

def check_api_stats():
    """檢查 API 統計資訊（Qdrant 資料）"""
    print()
    print("=" * 60)
    print("方法 2: 檢查 Embedding API 的 Qdrant 統計")
    print("=" * 60)
    print()
    
    try:
        url = f"{EMBEDDING_API_URL}/stats"
        print(f"📡 請求: {url}")
        req = Request(url)
        with urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            if data.get("ok"):
                print("✅ Qdrant 統計資訊：")
                print(f"   Collection: {data.get('collection', 'unknown')}")
                print(f"   向量數量: {data.get('points_count', 0):,} 筆")
                print(f"   Qdrant URL: {data.get('qdrant_url', 'unknown')}")
                
                # 檢查向量數量是否符合預期
                points_count = data.get('points_count', 0)
                if points_count == 4302:
                    print(f"\n✅ 向量數量正確！正好是 4,302 筆唯一資料")
                elif points_count > 4302:
                    print(f"\n⚠️  向量數量 ({points_count:,}) 比預期多，可能還有重複")
                else:
                    print(f"\n⚠️  向量數量 ({points_count:,}) 比預期少")
                
                return True
            else:
                print(f"❌ API 回應錯誤: {data.get('error', 'unknown')}")
                return False
    except HTTPError as e:
        print(f"❌ API 回應錯誤: HTTP {e.code}")
        try:
            error_data = json.loads(e.read().decode())
            print(f"   錯誤訊息: {error_data.get('error', 'unknown')}")
        except:
            pass
        return False
    except Exception as e:
        print(f"❌ 無法連接到 API: {e}")
        return False

def test_search():
    """執行測試搜尋"""
    print()
    print("=" * 60)
    print("方法 3: 執行測試搜尋")
    print("=" * 60)
    print()
    
    test_queries = [
        "一品紅",
        "狗骨柴",
        "菴摩落迦果"
    ]
    
    for query in test_queries:
        try:
            url = f"{EMBEDDING_API_URL}/search"
            print(f"📡 搜尋: {query}")
            req_data = json.dumps({"query": query, "top_k": 3, "smart": True}).encode()
            req = Request(url, data=req_data, headers={"Content-Type": "application/json"})
            with urlopen(req, timeout=30) as response:
                data = json.loads(response.read().decode())
                if data.get("classification", {}).get("is_plant"):
                    results = data.get("results", [])
                    print(f"   ✅ 找到 {len(results)} 筆結果")
                    for i, result in enumerate(results[:2], 1):
                        chinese_name = result.get("chinese_name", "")
                        scientific_name = result.get("scientific_name", "")
                        source = result.get("source", "")
                        print(f"      {i}. {chinese_name} ({scientific_name})")
                        if source:
                            print(f"         來源: {source}")
                else:
                    print(f"   ⚠️  未識別為植物查詢")
        except HTTPError as e:
            print(f"   ❌ 搜尋失敗: HTTP {e.code}")
        except Exception as e:
            print(f"   ❌ 搜尋錯誤: {e}")
        print()

def main():
    print("=" * 60)
    print("🔍 驗證 Embedding API 是否使用新的向量資料")
    print("=" * 60)
    print()
    print(f"📡 Embedding API URL: {EMBEDDING_API_URL}")
    print()
    
    # 方法 1: 健康檢查
    health_ok = check_api_health()
    
    # 方法 2: 統計資訊
    stats_ok = check_api_stats()
    
    # 方法 3: 測試搜尋
    if health_ok:
        test_search()
    
    print()
    print("=" * 60)
    print("📊 驗證總結")
    print("=" * 60)
    print()
    
    if health_ok and stats_ok:
        print("✅ Embedding API 正常運作")
        print("✅ 可以檢查向量數量是否為 4,302 筆")
        print()
        print("💡 如果向量數量是 4,302 筆，表示已使用新的向量資料")
    else:
        print("⚠️  無法完整驗證，請檢查：")
        print("   1. Embedding API 是否正常運行")
        print("   2. 網路連線是否正常")
        print("   3. API URL 是否正確")
    
    print()
    print("=" * 60)

if __name__ == "__main__":
    main()
