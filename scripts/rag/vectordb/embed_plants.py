#!/usr/bin/env python3
"""
植物資料向量化腳本
使用 JINA Embeddings v3 + Qdrant

使用方式：
1. 安裝依賴：pip install -r requirements.txt
2. 啟動 Qdrant：docker run -p 6333:6333 qdrant/qdrant
3. 執行：python embed_plants.py
"""

import json
import os
import sys
from pathlib import Path
from typing import List, Dict, Any
from tqdm import tqdm

from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    OptimizersConfigDiff,
)

# 設定
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", None)  # Zeabur Qdrant API Key
COLLECTION_NAME = "taiwan_plants"

def get_qdrant_client():
    """建立 Qdrant 客戶端，自動處理 HTTP/HTTPS"""
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
EMBEDDING_MODEL = "jinaai/jina-embeddings-v3"
BATCH_SIZE = 32  # 每批處理的資料數量
EMBEDDING_DIM = 1024  # jina-embeddings-v3 維度

# 資料路徑
SCRIPT_DIR = Path(__file__).parent
DATA_FILE = SCRIPT_DIR.parent / "data" / "plants-enriched.jsonl"
PROGRESS_FILE = SCRIPT_DIR / "embed_progress.json"


def load_progress() -> set:
    """載入已處理的植物代碼"""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, "r") as f:
            data = json.load(f)
            return set(data.get("processed", []))
    return set()


def save_progress(processed: set):
    """儲存進度"""
    with open(PROGRESS_FILE, "w") as f:
        json.dump({"processed": list(processed)}, f)


def create_plant_text(plant: Dict[str, Any]) -> str:
    """
    將植物資料轉換為用於 embedding 的文字
    包含：名稱、分類、特徵、分布等資訊
    """
    parts = []

    # 名稱
    names = plant.get("names", {})
    if names.get("chinese"):
        parts.append(f"中文名：{names['chinese']}")
    if names.get("scientific"):
        parts.append(f"學名：{names['scientific']}")

    # 俗名
    common_names = names.get("common_names", {})
    if common_names.get("chinese"):
        parts.append(f"別名：{'、'.join(common_names['chinese'])}")

    # 分類
    classification = plant.get("classification", {})
    if classification.get("chfamily"):
        parts.append(f"科：{classification['chfamily']} ({classification.get('family', '')})")
    if classification.get("chgenus"):
        parts.append(f"屬：{classification['chgenus']} ({classification.get('genus', '')})")

    # 特徵描述
    features = plant.get("features", {})
    if features.get("life_form"):
        parts.append(f"生活型：{features['life_form']}")

    if features.get("morphology"):
        morphology_text = " ".join(features["morphology"][:5])  # 取前5條
        parts.append(f"形態特徵：{morphology_text}")

    # AI 提取的識別特徵
    identification = plant.get("identification", {})
    if identification:
        # 葉特徵
        leaf = identification.get("morphology", {}).get("leaf", {})
        leaf_parts = []
        if leaf.get("shape"):
            leaf_parts.append(leaf["shape"])
        if leaf.get("arrangement"):
            leaf_parts.append(leaf["arrangement"])
        if leaf.get("margin"):
            leaf_parts.append(leaf["margin"])
        if leaf_parts:
            parts.append(f"葉：{'，'.join(leaf_parts)}")

        # 花特徵
        flower = identification.get("morphology", {}).get("flower", {})
        flower_parts = []
        if flower.get("color"):
            flower_parts.append(flower["color"])
        if flower.get("shape"):
            flower_parts.append(flower["shape"])
        if flower.get("season"):
            flower_parts.append(f"花期{flower['season']}")
        if flower_parts:
            parts.append(f"花：{'，'.join(flower_parts)}")

        # 果特徵
        fruit = identification.get("morphology", {}).get("fruit", {})
        fruit_parts = []
        if fruit.get("type"):
            fruit_parts.append(fruit["type"])
        if fruit.get("color"):
            fruit_parts.append(fruit["color"])
        if fruit_parts:
            parts.append(f"果：{'，'.join(fruit_parts)}")

        # 生態
        ecology = identification.get("ecology", {})
        if ecology.get("habitat"):
            parts.append(f"生長環境：{ecology['habitat']}")
        if ecology.get("elevation"):
            parts.append(f"海拔：{ecology['elevation']}")

        # 關鍵識別特徵
        key_features = identification.get("identification", {}).get("key_features", [])
        if key_features:
            parts.append(f"識別要點：{'、'.join(key_features[:3])}")

    # 分布
    distribution = plant.get("distribution", {})
    locations = distribution.get("locations", [])
    if locations:
        districts = list(set([loc.get("district", "").split()[0] for loc in locations[:10] if loc.get("district")]))
        if districts:
            parts.append(f"分布：{', '.join(districts[:5])}")

    return "\n".join(parts)


def load_plants() -> List[Dict[str, Any]]:
    """載入植物資料"""
    plants = []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                plants.append(json.loads(line))
    return plants


def init_qdrant(client: QdrantClient):
    """初始化 Qdrant collection"""
    collections = client.get_collections().collections
    collection_names = [c.name for c in collections]

    if COLLECTION_NAME not in collection_names:
        print(f"建立 collection: {COLLECTION_NAME}")
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=EMBEDDING_DIM,
                distance=Distance.COSINE,
            ),
            optimizers_config=OptimizersConfigDiff(
                indexing_threshold=0,  # 立即建立索引
            ),
        )
    else:
        print(f"Collection {COLLECTION_NAME} 已存在")


def main():
    print("=" * 60)
    print("🌿 植物資料向量化")
    print("=" * 60)

    # 連接 Qdrant
    print(f"\n連接 Qdrant: {QDRANT_URL}")
    if QDRANT_API_KEY:
        print("  使用 API Key 認證")
    try:
        client = get_qdrant_client()
        client.get_collections()  # 測試連接
        print("✅ Qdrant 連接成功")
    except Exception as e:
        print(f"❌ 無法連接 Qdrant: {e}")
        print("\n請確認 Qdrant 已啟動：")
        print("  docker run -p 6333:6333 qdrant/qdrant")
        sys.exit(1)

    # 初始化 collection
    init_qdrant(client)

    # 載入 embedding 模型
    print(f"\n載入 embedding 模型: {EMBEDDING_MODEL}")
    print("（首次執行會下載模型，約 2GB）")
    model = SentenceTransformer(EMBEDDING_MODEL, trust_remote_code=True)
    print("✅ 模型載入成功")

    # 載入植物資料
    print(f"\n載入植物資料: {DATA_FILE}")
    plants = load_plants()
    print(f"總共 {len(plants)} 筆資料")

    # 載入進度
    processed = load_progress()
    print(f"已處理: {len(processed)} 筆")

    # 篩選未處理的
    plants_to_process = [p for p in plants if p["code"] not in processed]
    print(f"待處理: {len(plants_to_process)} 筆")

    if not plants_to_process:
        print("\n✅ 所有資料已處理完成！")
        return

    # 批次處理
    print(f"\n開始向量化（批次大小: {BATCH_SIZE}）")

    for i in tqdm(range(0, len(plants_to_process), BATCH_SIZE), desc="處理中"):
        batch = plants_to_process[i:i + BATCH_SIZE]

        # 產生文字
        texts = [create_plant_text(p) for p in batch]

        # 產生 embeddings
        embeddings = model.encode(texts, show_progress_bar=False)

        # 建立 points
        points = []
        for j, (plant, embedding) in enumerate(zip(batch, embeddings)):
            point = PointStruct(
                id=hash(plant["code"]) & 0x7FFFFFFFFFFFFFFF,  # 正整數 ID
                vector=embedding.tolist(),
                payload={
                    "code": plant["code"],
                    "chinese_name": plant.get("names", {}).get("chinese", ""),
                    "scientific_name": plant.get("names", {}).get("scientific", ""),
                    "family": plant.get("classification", {}).get("chfamily", ""),
                    "family_en": plant.get("classification", {}).get("family", ""),
                    "genus": plant.get("classification", {}).get("chgenus", ""),
                    "life_form": plant.get("features", {}).get("life_form", ""),
                    "has_features": plant.get("features", {}).get("has_data", False),
                    "location_count": len(plant.get("distribution", {}).get("locations", [])),
                    # 用於顯示的摘要文字
                    "summary": texts[j][:500],  # 截取前500字
                }
            )
            points.append(point)

        # 寫入 Qdrant
        client.upsert(collection_name=COLLECTION_NAME, points=points)

        # 更新進度
        for plant in batch:
            processed.add(plant["code"])

        # 每 10 批儲存一次進度
        if (i // BATCH_SIZE) % 10 == 0:
            save_progress(processed)

    # 最終儲存進度
    save_progress(processed)

    # 統計
    collection_info = client.get_collection(COLLECTION_NAME)
    print(f"\n{'=' * 60}")
    print("✅ 向量化完成！")
    print(f"   Collection: {COLLECTION_NAME}")
    print(f"   向量數量: {collection_info.points_count}")
    print(f"   向量維度: {EMBEDDING_DIM}")
    print(f"\nQdrant Dashboard: {QDRANT_URL.replace(':6333', ':6333')}/dashboard")


if __name__ == "__main__":
    main()
