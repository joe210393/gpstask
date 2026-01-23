#!/usr/bin/env python3
"""
植物向量搜尋測試腳本

使用方式：
  python search_plants.py "紅色的花"
  python search_plants.py "海邊的植物"
  python search_plants.py "羽狀複葉 喬木"
"""

import os
import sys
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
COLLECTION_NAME = "taiwan_plants"
EMBEDDING_MODEL = "jinaai/jina-embeddings-v3"


def search(query: str, top_k: int = 5):
    """搜尋植物"""
    # 連接 Qdrant
    client = QdrantClient(url=QDRANT_URL)

    # 載入模型
    print(f"載入模型...")
    model = SentenceTransformer(EMBEDDING_MODEL, trust_remote_code=True)

    # 產生查詢向量
    print(f"搜尋: {query}\n")
    query_vector = model.encode(query).tolist()

    # 搜尋
    results = client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=top_k,
    ).points

    # 顯示結果
    print("=" * 60)
    print(f"找到 {len(results)} 個結果：")
    print("=" * 60)

    for i, result in enumerate(results, 1):
        payload = result.payload
        print(f"\n{i}. {payload.get('chinese_name', '未知')} ({payload.get('scientific_name', '')})")
        print(f"   科：{payload.get('family', '')} | 屬：{payload.get('genus', '')}")
        print(f"   相似度：{result.score:.4f}")
        print(f"   ---")
        # 顯示摘要的前200字
        summary = payload.get('summary', '')[:200]
        print(f"   {summary}...")


def main():
    if len(sys.argv) < 2:
        print("使用方式: python search_plants.py <查詢關鍵字>")
        print("範例:")
        print('  python search_plants.py "紅色的花"')
        print('  python search_plants.py "海邊生長的植物"')
        print('  python search_plants.py "羽狀複葉的喬木"')
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    search(query)


if __name__ == "__main__":
    main()
