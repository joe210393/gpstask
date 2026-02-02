#!/usr/bin/env python3
"""
向量化除錯腳本 - 逐步測試每個環節，找出卡住的位置

使用方式：
  export QDRANT_URL="https://gps-task-qdrant.zeabur.app"
  export QDRANT_API_KEY="your_key"
  export JINA_API_KEY="your_jina_key"
  python debug_embed_stepwise.py

此腳本會：
1. 測試 Jina API 連線
2. 測試 Qdrant 連線
3. 測試單筆資料向量化 + 上傳
4. 顯示每個步驟耗時，方便找出瓶頸
"""

import os
import sys
import time
import json
from pathlib import Path

# 強制 unbuffered 輸出，確保即時看到進度
os.environ["PYTHONUNBUFFERED"] = "1"

def log(msg):
    print(msg, flush=True)

def step(name, fn):
    """執行一個步驟並計時"""
    log(f"\n{'='*50}")
    log(f"📍 步驟: {name}")
    log(f"{'='*50}")
    t0 = time.perf_counter()
    try:
        result = fn()
        elapsed = time.perf_counter() - t0
        log(f"✅ 完成，耗時 {elapsed:.2f} 秒")
        return result
    except Exception as e:
        elapsed = time.perf_counter() - t0
        log(f"❌ 失敗（{elapsed:.2f} 秒）: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

def main():
    log("🔧 向量化除錯腳本 - 逐步測試")
    log("   找出卡住的環節\n")

    # 檢查環境變數
    QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
    QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")
    JINA_API_KEY = os.environ.get("JINA_API_KEY")

    log(f"QDRANT_URL: {QDRANT_URL}")
    log(f"QDRANT_API_KEY: {'已設定' if QDRANT_API_KEY else '❌ 未設定'}")
    log(f"JINA_API_KEY: {'已設定' if JINA_API_KEY else '❌ 未設定'}")

    if not JINA_API_KEY:
        log("\n❌ 請設定 JINA_API_KEY：export JINA_API_KEY='your_key'")
        sys.exit(1)

    # Step 1: 測試 Jina API
    def test_jina():
        import requests
        log("   呼叫 Jina API...")
        response = requests.post(
            "https://api.jina.ai/v1/embeddings",
            headers={
                "Authorization": f"Bearer {JINA_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "jina-embeddings-v3",
                "task": "retrieval.passage",
                "dimensions": 1024,
                "input": ["測試文字：台灣常見植物"]
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        emb = data["data"][0]["embedding"]
        log(f"   取得向量維度: {len(emb)}")
        return emb

    step("1. Jina API 連線與單次 embedding", test_jina)

    # Step 2: 測試 Qdrant 連線
    def test_qdrant():
        from urllib.parse import urlparse
        from qdrant_client import QdrantClient

        parsed = urlparse(QDRANT_URL)
        is_https = parsed.scheme == 'https'
        host = parsed.hostname or 'localhost'
        port = parsed.port or (443 if is_https else 6333)

        log(f"   連線到 {host}:{port} (https={is_https})...")
        client = QdrantClient(
            host=host,
            port=port,
            api_key=QDRANT_API_KEY if QDRANT_API_KEY else None,
            https=is_https,
            prefer_grpc=False,
            timeout=30
        )
        collections = client.get_collections()
        log(f"   Collections: {[c.name for c in collections.collections]}")
        return client

    client = step("2. Qdrant 連線", test_qdrant)

    # Step 3: 讀取一筆資料並向量化
    def test_one_embed():
        script_dir = Path(__file__).parent
        data_file = script_dir.parent / "data" / "plants-forest-gov-tw-clean.jsonl"
        if not data_file.exists():
            data_file = script_dir.parent / "data" / "plants-forest-gov-tw.jsonl"
        if not data_file.exists():
            log("   ⚠️ 找不到資料檔案，跳過此步驟")
            return None

        log("   讀取第一筆植物資料...")
        with open(data_file, 'r', encoding='utf-8') as f:
            first_line = f.readline()
        plant = json.loads(first_line)

        # 建立文字
        parts = []
        if plant.get("chinese_name"):
            parts.append(f"中文名：{plant['chinese_name']}")
        if plant.get("scientific_name"):
            parts.append(f"學名：{plant['scientific_name']}")
        ident = plant.get("identification", {}) or {}
        if ident.get("query_text_zh"):
            parts.append(ident["query_text_zh"])
        elif ident.get("summary"):
            s = ident["summary"]
            parts.append(" ".join(s) if isinstance(s, list) else s)
        text = "\n".join(parts) if parts else "未知植物"
        log(f"   文字長度: {len(text)} 字元")

        # 呼叫 Jina
        log("   呼叫 Jina API 向量化...")
        import requests
        resp = requests.post(
            "https://api.jina.ai/v1/embeddings",
            headers={"Authorization": f"Bearer {JINA_API_KEY}", "Content-Type": "application/json"},
            json={"model": "jina-embeddings-v3", "task": "retrieval.passage", "dimensions": 1024, "input": [text]},
            timeout=60
        )
        resp.raise_for_status()
        vector = resp.json()["data"][0]["embedding"]
        log(f"   向量維度: {len(vector)}")
        return (plant, vector)

    result = step("3. 單筆資料向量化", test_one_embed)

    if result:
        plant, vector = result
        # Step 4: 上傳到 Qdrant（可選，不影響 collection）
        def test_upsert():
            from qdrant_client.models import PointStruct
            test_id = 999999999  # 測試用 ID
            point = PointStruct(
                id=test_id,
                vector=vector,
                payload={"chinese_name": plant.get("chinese_name", ""), "test": True}
            )
            log("   上傳測試 point 到 taiwan_plants...")
            client.upsert(collection_name="taiwan_plants", points=[point])
            log("   上傳成功（測試 point 已加入）")
            # 可選：刪除測試 point
            # client.delete(collection_name="taiwan_plants", points_selector=[test_id])

        try:
            step("4. 上傳到 Qdrant", test_upsert)
        except Exception as e:
            log(f"   ⚠️ 上傳失敗: {e}")
            log("   可能原因：collection 'taiwan_plants' 不存在，需先執行 embed 腳本建立")

    log("\n" + "="*50)
    log("✅ 除錯完成！若某步驟卡住，即為問題所在")
    log("   - 步驟 1 卡住：Jina API 或網路問題")
    log("   - 步驟 2 卡住：Qdrant 連線或網路問題")
    log("   - 步驟 3 卡住：讀檔或 Jina API 批次問題")
    log("   - 步驟 4 卡住：Qdrant 寫入問題")
    log("="*50)

if __name__ == "__main__":
    main()
