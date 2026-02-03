#!/usr/bin/env python3
"""
重置 Qdrant Collection 並上傳乾淨的 4302 筆資料

使用方式：
1. 設定環境變數：
   export QDRANT_URL="https://gps-task-qdrant.zeabur.app"
   export QDRANT_API_KEY="your_qdrant_api_key"
   export JINA_API_KEY="your_jina_api_key"

2. 執行：
   python reset_qdrant_clean.py

這個腳本會：
1. 刪除舊的 taiwan_plants collection
2. 建立新的 collection（1024 維，Cosine 距離）
3. 從 final-4302.jsonl 上傳 4302 筆正確資料
"""

import json
import os
import sys
import time
import random
import requests
from pathlib import Path
from typing import List, Dict, Any
from tqdm import tqdm

try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        Distance,
        VectorParams,
        PointStruct,
        OptimizersConfigDiff,
    )
except ImportError:
    print("❌ 錯誤：無法載入 qdrant_client")
    print("   請執行: pip install qdrant-client")
    sys.exit(1)

# 設定
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", None)
JINA_API_KEY = os.environ.get("JINA_API_KEY", None)
COLLECTION_NAME = "taiwan_plants"
EMBEDDING_DIM = 1024  # Jina embeddings-v3 維度
BATCH_SIZE = 16  # 每批處理的資料數量

# 資料路徑
SCRIPT_DIR = Path(__file__).parent
DATA_FILE = SCRIPT_DIR.parent / "data" / "plants-forest-gov-tw-final-4302.jsonl"

if not DATA_FILE.exists():
    print(f"❌ 錯誤：找不到資料檔案 {DATA_FILE}")
    sys.exit(1)

if not JINA_API_KEY:
    print("❌ 錯誤：請設定 JINA_API_KEY 環境變數")
    sys.exit(1)

print("=" * 60)
print("🔄 重置 Qdrant Collection")
print("=" * 60)
print(f"\n📊 配置:")
print(f"   Qdrant URL: {QDRANT_URL}")
print(f"   Collection: {COLLECTION_NAME}")
print(f"   資料檔案: {DATA_FILE}")
print(f"   Jina API Key: {'*' * 20}{JINA_API_KEY[-4:] if JINA_API_KEY else 'None'}")


def get_qdrant_client():
    """建立 Qdrant 客戶端"""
    from urllib.parse import urlparse
    parsed = urlparse(QDRANT_URL)
    is_https = parsed.scheme == 'https'
    host = parsed.hostname or 'localhost'
    port = parsed.port or (443 if is_https else 6333)

    if QDRANT_API_KEY:
        return QdrantClient(
            host=host,
            port=port,
            api_key=QDRANT_API_KEY,
            https=is_https,
            prefer_grpc=False,
            timeout=120
        )
    else:
        return QdrantClient(
            host=host,
            port=port,
            https=is_https,
            prefer_grpc=False,
            timeout=120
        )


def encode_text_jina(texts: List[str], max_retries: int = 3) -> List[List[float]]:
    """使用 Jina API 將文字編碼為向量"""
    valid_texts = [t for t in texts if t and t.strip()]
    if not valid_texts:
        raise ValueError("沒有有效的文字輸入")

    # 檢查文字長度
    for i, text in enumerate(valid_texts):
        if len(text) > 8192:
            print(f"⚠️  警告：文字 {i} 過長 ({len(text)} 字符)，將截斷")
            valid_texts[i] = text[:8000]

    # 重試機制
    for attempt in range(max_retries):
        try:
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
                    "input": valid_texts
                },
                timeout=60
            )

            # 處理速率限制
            if response.status_code == 429:
                retry_after = int(response.headers.get('Retry-After', 60))
                if attempt < max_retries - 1:
                    print(f"⚠️  速率限制，等待 {retry_after} 秒...")
                    time.sleep(retry_after)
                    continue
                else:
                    raise Exception("達到最大重試次數")

            response.raise_for_status()
            data = response.json()

            embeddings = [item["embedding"] for item in data["data"]]
            return embeddings

        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt
                print(f"⚠️  錯誤: {e}，{wait_time} 秒後重試...")
                time.sleep(wait_time)
            else:
                raise


def main():
    try:
        # 1. 連接 Qdrant
        print("\n1️⃣ 連接 Qdrant...")
        client = get_qdrant_client()
        collections = client.get_collections()
        print(f"   ✅ 連接成功，目前有 {len(collections.collections)} 個 collections")

        # 2. 檢查並刪除舊的 collection
        collection_names = [c.name for c in collections.collections]
        if COLLECTION_NAME in collection_names:
            print(f"\n2️⃣ 刪除舊的 collection '{COLLECTION_NAME}'...")

            # 先檢查舊資料數量
            old_count = client.count(COLLECTION_NAME, exact=True).count
            print(f"   舊資料筆數: {old_count}")

            confirm = input(f"   ⚠️  確定要刪除 {old_count} 筆舊資料嗎？ (yes/no): ")
            if confirm.lower() != 'yes':
                print("   ❌ 已取消操作")
                sys.exit(0)

            client.delete_collection(COLLECTION_NAME)
            print(f"   ✅ 已刪除舊的 collection")
        else:
            print(f"\n2️⃣ Collection '{COLLECTION_NAME}' 不存在，將建立新的")

        # 3. 建立新的 collection
        print(f"\n3️⃣ 建立新的 collection '{COLLECTION_NAME}'...")
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=EMBEDDING_DIM,
                distance=Distance.COSINE
            ),
            optimizers_config=OptimizersConfigDiff(
                indexing_threshold=0  # 立即建立索引
            )
        )
        print(f"   ✅ Collection 建立成功")
        print(f"      - 向量維度: {EMBEDDING_DIM}")
        print(f"      - 距離計算: Cosine")

        # 4. 載入資料
        print(f"\n4️⃣ 載入資料...")
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            plants = [json.loads(line) for line in f if line.strip()]
        print(f"   ✅ 載入 {len(plants)} 筆植物資料")

        # 5. 分批上傳
        print(f"\n5️⃣ 開始向量化並上傳資料...")
        print(f"   批次大小: {BATCH_SIZE}")

        total_batches = (len(plants) + BATCH_SIZE - 1) // BATCH_SIZE

        for batch_num in tqdm(range(total_batches), desc="上傳進度"):
            start_idx = batch_num * BATCH_SIZE
            end_idx = min(start_idx + BATCH_SIZE, len(plants))
            batch = plants[start_idx:end_idx]

            # 準備文字（用於向量化）
            texts = []
            for plant in batch:
                # 使用 morphology_summary_zh（如果有）或組合其他欄位
                text_parts = []

                summary = plant.get("identification", {}).get("morphology_summary_zh") or \
                         plant.get("identification", {}).get("summary", "")
                if summary:
                    # 確保 summary 是字串
                    if isinstance(summary, list):
                        summary = " ".join(str(s) for s in summary)
                    text_parts.append(str(summary))

                # 添加中文名和學名
                chinese_name = plant.get("chinese_name", "")
                if chinese_name:
                    text_parts.append(str(chinese_name))

                scientific_name = plant.get("scientific_name", "")
                if scientific_name:
                    text_parts.append(str(scientific_name))

                # 添加生活型
                life_form = plant.get("identification", {}).get("life_form", "")
                if life_form:
                    # 確保 life_form 是字串
                    if isinstance(life_form, list):
                        life_form = " ".join(str(lf) for lf in life_form)
                    text_parts.append(str(life_form))

                text = " ".join(text_parts)
                texts.append(text)

            # 向量化
            try:
                vectors = encode_text_jina(texts)
            except Exception as e:
                print(f"\n❌ 批次 {batch_num + 1} 向量化失敗: {e}")
                print(f"   跳過此批次...")
                continue

            # 準備 points
            points = []
            for i, (plant, vector) in enumerate(zip(batch, vectors)):
                plant_id = f"{plant.get('source', 'unknown')}|{plant.get('chinese_name', '')}|{plant.get('scientific_name', '')}"

                points.append(PointStruct(
                    id=hash(plant_id) % (2**63),
                    vector=vector,
                    payload={
                        "code": plant.get("code", ""),
                        "chinese_name": plant.get("chinese_name", ""),
                        "scientific_name": plant.get("scientific_name", ""),
                        "family": plant.get("family", ""),
                        "family_en": plant.get("family_en", ""),
                        "genus": plant.get("genus", ""),
                        "life_form": plant.get("identification", {}).get("life_form", ""),
                        "summary": plant.get("identification", {}).get("summary", ""),
                        "morphology_summary_zh": plant.get("identification", {}).get("morphology_summary_zh", ""),
                        "key_features": plant.get("identification", {}).get("key_features", []),
                        "key_features_norm": plant.get("identification", {}).get("key_features_norm", []),
                        "trait_tokens": plant.get("identification", {}).get("trait_tokens", []),
                        "source": plant.get("source", "forest-gov-tw"),
                        "source_url": plant.get("source_url", ""),
                        "plant_id": plant_id,
                    }
                ))

            # 上傳到 Qdrant
            try:
                client.upsert(
                    collection_name=COLLECTION_NAME,
                    points=points
                )
            except Exception as e:
                print(f"\n❌ 批次 {batch_num + 1} 上傳失敗: {e}")
                print(f"   跳過此批次...")
                continue

            # 批次之間添加延遲，避免速率限制
            if batch_num < total_batches - 1:
                delay = random.uniform(6, 10)
                time.sleep(delay)

        # 6. 驗證結果
        print(f"\n6️⃣ 驗證上傳結果...")
        final_count = client.count(COLLECTION_NAME, exact=True).count
        print(f"   ✅ 最終資料筆數: {final_count}")

        if final_count == len(plants):
            print(f"   ✅ 所有資料上傳成功！")
        else:
            print(f"   ⚠️  預期 {len(plants)} 筆，實際 {final_count} 筆")
            print(f"   可能有部分批次上傳失敗")

        # 檢查索引狀態
        info = client.get_collection(COLLECTION_NAME)
        print(f"   📊 Collection 資訊:")
        print(f"      - 向量維度: {info.config.params.vectors.size}")
        print(f"      - 距離計算: {info.config.params.vectors.distance}")
        print(f"      - 狀態: {info.status}")

        print("\n" + "=" * 60)
        print("✅ 重置完成！")
        print("=" * 60)
        print("\n💡 接下來的步驟：")
        print("   1. 更新 zeabur.yaml 添加 JINA_API_KEY 配置")
        print("   2. 在 Zeabur 環境變數設定 JINA_API_KEY")
        print("   3. 推送更改並重新部署")
        print("   4. 測試 RAG 搜尋功能")

    except Exception as e:
        print(f"\n❌ 錯誤: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
