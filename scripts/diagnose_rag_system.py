#!/usr/bin/env python3
"""
RAG 系統診斷腳本
檢查 Qdrant、Embedding API 和資料檔案的一致性
"""

import os
import sys
import json
import requests
from pathlib import Path

# 設定
QDRANT_URL = os.environ.get("QDRANT_URL", "https://gps-task-qdrant.zeabur.app")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "s659vbjm0Tf2q8WUw1oInr3PK74uycLd")
EMBEDDING_API_URL = os.environ.get("EMBEDDING_API_URL", "http://gpstask-ooffix:8080")
DATA_FILE = Path(__file__).parent / "rag" / "data" / "plants-forest-gov-tw-final-4302.jsonl"

print("=" * 60)
print("🔍 RAG 系統診斷")
print("=" * 60)

# 1. 檢查資料檔案
print("\n1️⃣ 檢查資料檔案...")
if DATA_FILE.exists():
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        lines = [l for l in f if l.strip()]
    print(f"   ✅ 資料檔案存在: {DATA_FILE}")
    print(f"   📊 總筆數: {len(lines)}")
    
    # 檢查第一筆資料的格式
    try:
        first_plant = json.loads(lines[0])
        has_trait_tokens = bool(first_plant.get("identification", {}).get("trait_tokens"))
        has_query_text_zh = bool(first_plant.get("identification", {}).get("query_text_zh"))
        print(f"   ✅ 格式檢查:")
        print(f"      - trait_tokens: {'✅' if has_trait_tokens else '❌'}")
        print(f"      - query_text_zh: {'✅' if has_query_text_zh else '❌'}")
    except Exception as e:
        print(f"   ⚠️ 格式檢查失敗: {e}")
else:
    print(f"   ❌ 資料檔案不存在: {DATA_FILE}")

# 2. 檢查 Embedding API 健康狀態
print("\n2️⃣ 檢查 Embedding API...")
try:
    health_url = f"{EMBEDDING_API_URL}/health"
    print(f"   🔗 連線: {health_url}")
    response = requests.get(health_url, timeout=10)
    if response.status_code == 200:
        health = response.json()
        print(f"   ✅ API 正常運作")
        print(f"   📊 狀態:")
        print(f"      - ready: {health.get('ready')}")
        print(f"      - qdrant_connected: {health.get('qdrant_connected')}")
        print(f"      - use_jina_api: {health.get('use_jina_api')}")
        print(f"      - model: {health.get('model')}")
    else:
        print(f"   ❌ API 回應錯誤: {response.status_code}")
        print(f"      {response.text[:200]}")
except requests.exceptions.ConnectionError:
    print(f"   ❌ 無法連線到 Embedding API")
    print(f"      💡 提示: 請確認 EMBEDDING_API_URL 設定正確")
except Exception as e:
    print(f"   ❌ 錯誤: {e}")

# 3. 檢查 Embedding API 的 Qdrant 統計
print("\n3️⃣ 檢查 Qdrant 統計（透過 Embedding API）...")
try:
    stats_url = f"{EMBEDDING_API_URL}/stats"
    print(f"   🔗 連線: {stats_url}")
    response = requests.get(stats_url, timeout=10)
    if response.status_code == 200:
        stats = response.json()
        print(f"   ✅ 取得統計資料")
        print(f"   📊 Collection 狀態:")
        print(f"      - collection: {stats.get('collection')}")
        print(f"      - points_count: {stats.get('points_count')}")
        print(f"      - vectors_config: {stats.get('vectors_config')}")
        
        # 檢查點數是否匹配
        if stats.get('points_count'):
            expected_count = len(lines) if DATA_FILE.exists() else 0
            actual_count = stats.get('points_count')
            if actual_count == expected_count:
                print(f"   ✅ 點數匹配: {actual_count} 筆")
            elif actual_count < expected_count:
                print(f"   ⚠️ 點數不足: {actual_count} / {expected_count} (缺少 {expected_count - actual_count} 筆)")
            else:
                print(f"   ⚠️ 點數過多: {actual_count} / {expected_count} (可能是舊資料)")
    else:
        print(f"   ❌ API 回應錯誤: {response.status_code}")
        print(f"      {response.text[:200]}")
except requests.exceptions.ConnectionError:
    print(f"   ❌ 無法連線到 Embedding API")
except Exception as e:
    print(f"   ❌ 錯誤: {e}")

# 4. 直接檢查 Qdrant（如果可能）
print("\n4️⃣ 直接檢查 Qdrant...")
try:
    from qdrant_client import QdrantClient
    from urllib.parse import urlparse
    
    parsed = urlparse(QDRANT_URL)
    is_https = parsed.scheme == 'https'
    host = parsed.hostname or 'localhost'
    port = parsed.port or (443 if is_https else 6333)
    
    client = QdrantClient(
        host=host,
        port=port,
        api_key=QDRANT_API_KEY if is_https else None,
        https=is_https,
        timeout=30
    )
    
    collections = client.get_collections()
    print(f"   ✅ Qdrant 連線成功")
    print(f"   📊 Collections: {[c.name for c in collections.collections]}")
    
    if "taiwan_plants" in [c.name for c in collections.collections]:
        info = client.get_collection("taiwan_plants")
        count = client.count("taiwan_plants", exact=True)
        print(f"   📊 taiwan_plants Collection:")
        print(f"      - 狀態: {info.status}")
        print(f"      - 向量維度: {info.config.params.vectors.size}")
        print(f"      - 點數: {count.count if hasattr(count, 'count') else count}")
        
        # 檢查維度
        expected_dim = 1024  # Jina API
        actual_dim = info.config.params.vectors.size
        if actual_dim == expected_dim:
            print(f"   ✅ 維度正確: {actual_dim}")
        else:
            print(f"   ❌ 維度不匹配: {actual_dim} (期望: {expected_dim})")
            print(f"      💡 需要重新向量化資料")
    else:
        print(f"   ❌ Collection 'taiwan_plants' 不存在")
        
except ImportError:
    print(f"   ⚠️ 無法載入 qdrant_client，跳過直接檢查")
except Exception as e:
    print(f"   ❌ Qdrant 連線失敗: {e}")

# 5. 測試搜尋
print("\n5️⃣ 測試搜尋功能...")
try:
    search_url = f"{EMBEDDING_API_URL}/search"
    test_query = "灌木 互生 卵形 紫花"
    print(f"   🔍 測試查詢: {test_query}")
    
    response = requests.post(
        search_url,
        json={"query": test_query, "top_k": 5},
        timeout=30
    )
    
    if response.status_code == 200:
        result = response.json()
        results = result.get("results", [])
        print(f"   ✅ 搜尋成功")
        print(f"   📊 結果數量: {len(results)}")
        if results:
            print(f"   📋 Top 3 結果:")
            for i, r in enumerate(results[:3], 1):
                print(f"      {i}. {r.get('chinese_name', '未知')} (score: {r.get('score', 0):.4f})")
        else:
            print(f"   ⚠️ 搜尋結果為空（可能是資料庫問題）")
    else:
        print(f"   ❌ 搜尋失敗: {response.status_code}")
        print(f"      {response.text[:200]}")
except Exception as e:
    print(f"   ❌ 搜尋測試失敗: {e}")

print("\n" + "=" * 60)
print("✅ 診斷完成")
print("=" * 60)
