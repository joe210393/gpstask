#!/usr/bin/env python3
"""
植物資料向量化腳本（使用本地模型）
適配新的 plants-forest-gov-tw.jsonl 格式

使用方式：
1. 設定環境變數：
   export QDRANT_URL="https://gps-task-qdrant.zeabur.app"
   export QDRANT_API_KEY="your_qdrant_api_key"

2. 執行：
   python embed_plants_forest.py
"""

import json
import os
import sys
import time
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
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", None)
COLLECTION_NAME = "taiwan_plants"
# 使用多語言模型，避免 transformers 版本問題
EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
EMBEDDING_DIM = 768  # paraphrase-multilingual-mpnet-base-v2 維度

BATCH_SIZE = 32  # 每批處理的資料數量

# 資料路徑
SCRIPT_DIR = Path(__file__).parent
DATA_FILE = SCRIPT_DIR.parent / "data" / "plants-forest-gov-tw.jsonl"
PROGRESS_FILE = SCRIPT_DIR / "embed_plants_forest_progress.json"


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


def encode_text_local(model: SentenceTransformer, texts: List[str]) -> List[List[float]]:
    """
    使用本地模型將文字編碼為向量
    
    Args:
        model: SentenceTransformer 模型
        texts: 文字列表
        
    Returns:
        向量列表
    """
    embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
    return embeddings.tolist()


def get_plant_id(plant: Dict[str, Any]) -> str:
    """產生植物的唯一識別碼（使用 source_url + chinese_name + scientific_name）"""
    source_url = plant.get("source_url", "")
    chinese_name = plant.get("chinese_name", "")
    scientific_name = plant.get("scientific_name", "")
    return f"{source_url}|||{chinese_name}|||{scientific_name}"


def load_progress() -> set:
    """載入已處理的植物 ID（使用完整的 plant_id 作為唯一識別）"""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, "r") as f:
            data = json.load(f)
            processed = data.get("processed", [])
            # 向後兼容：如果是舊格式（只有 source_url），轉換為新格式
            if processed and isinstance(processed[0], str) and "|||" not in processed[0]:
                # 舊格式，需要重新處理所有資料
                print("⚠️  檢測到舊格式進度檔案，將重新處理所有資料")
                return set()
            return set(processed)
    return set()


def save_progress(processed: set):
    """儲存進度"""
    with open(PROGRESS_FILE, "w") as f:
        json.dump({"processed": list(processed)}, f)


def create_plant_text(plant: Dict[str, Any]) -> str:
    """
    將植物資料轉換為用於 embedding 的文字
    適配新的 plants-forest-gov-tw.jsonl 格式
    """
    parts = []

    # 中文名
    if plant.get("chinese_name"):
        parts.append(f"中文名：{plant['chinese_name']}")
    
    # 學名
    if plant.get("scientific_name"):
        parts.append(f"學名：{plant['scientific_name']}")
    
    # 俗名
    common_names = plant.get("common_names", [])
    if common_names:
        parts.append(f"別名：{'、'.join(common_names[:5])}")  # 最多 5 個

    # 分類
    taxonomy = plant.get("taxonomy", {})
    if taxonomy.get("family"):
        parts.append(f"科：{taxonomy['family']}")
    if taxonomy.get("genus"):
        parts.append(f"屬：{taxonomy['genus']}")

    # 識別資訊
    identification = plant.get("identification", {})
    
    # 摘要
    if identification.get("summary"):
        parts.append(f"摘要：{identification['summary']}")
    
    # 生活型
    if identification.get("life_form"):
        parts.append(f"生活型：{identification['life_form']}")

    # 形態特徵
    morphology = identification.get("morphology", [])
    if morphology:
        morphology_text = " ".join(morphology[:5])  # 取前 5 條
        parts.append(f"形態特徵：{morphology_text}")

    # 關鍵特徵
    key_features = identification.get("key_features", [])
    if key_features:
        parts.append(f"關鍵特徵：{'、'.join(key_features[:5])}")

    # 原始資料（如果有）
    raw_data = plant.get("raw_data", {})
    if raw_data.get("morphology"):
        parts.append(f"形態描述：{raw_data['morphology'][:200]}")  # 截取前 200 字
    if raw_data.get("ecology"):
        parts.append(f"生態：{raw_data['ecology'][:200]}")
    if raw_data.get("distribution"):
        parts.append(f"分布：{raw_data['distribution'][:200]}")

    return "\n".join(parts)


def load_plants() -> List[Dict[str, Any]]:
    """載入植物資料"""
    plants = []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            if line.strip():
                try:
                    plants.append(json.loads(line))
                except json.JSONDecodeError as e:
                    print(f"⚠️  第 {line_num} 行 JSON 解析失敗: {e}")
                    continue
    return plants


def init_qdrant(client: QdrantClient):
    """初始化 Qdrant collection"""
    collections = client.get_collections().collections
    collection_names = [c.name for c in collections]

    if COLLECTION_NAME in collection_names:
        # 檢查現有 collection 的維度
        existing_collection = client.get_collection(COLLECTION_NAME)
        existing_dim = existing_collection.config.params.vectors.size
        
        if existing_dim != EMBEDDING_DIM:
            print(f"⚠️  Collection {COLLECTION_NAME} 已存在，但維度不匹配（現有: {existing_dim}, 需要: {EMBEDDING_DIM}）")
            print(f"   刪除舊 collection 並重新建立...")
            print(f"   ⚠️  警告：這會刪除所有現有資料！")
            response = input(f"   確認刪除並重新建立？(yes/no): ")
            if response.lower() != 'yes':
                print("   已取消操作")
                sys.exit(1)
            client.delete_collection(collection_name=COLLECTION_NAME)
            print(f"   ✅ 舊 collection 已刪除")
        else:
            print(f"✅ Collection {COLLECTION_NAME} 已存在（維度: {EMBEDDING_DIM}）")
            return

    # 建立新的 collection
    print(f"建立 collection: {COLLECTION_NAME}（維度: {EMBEDDING_DIM}）")
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
    print(f"✅ Collection {COLLECTION_NAME} 已建立")


def main():
    print("=" * 60)
    print("🌿 植物資料向量化（使用本地模型）")
    print("=" * 60)

    # 檢查環境變數
    print("\n📋 檢查環境變數...")
    print(f"  QDRANT_URL: {QDRANT_URL}")
    if QDRANT_API_KEY:
        print(f"  QDRANT_API_KEY: {'*' * 20}{QDRANT_API_KEY[-4:]}")
    else:
        print("  QDRANT_API_KEY: 未設定（本地 Qdrant 不需要）")
    
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
        print("\n請確認 Qdrant 設定正確：")
        print("  export QDRANT_URL='https://gps-task-qdrant.zeabur.app'")
        print("  export QDRANT_API_KEY='your_qdrant_api_key'")
        sys.exit(1)

    # 載入 embedding 模型
    print(f"\n載入 embedding 模型: {EMBEDDING_MODEL}")
    print("（首次執行會下載模型，約 2GB，請稍候...）")
    try:
        model = SentenceTransformer(EMBEDDING_MODEL, trust_remote_code=True)
        print("✅ 模型載入成功")
    except Exception as e:
        print(f"❌ 模型載入失敗: {e}")
        print("\n請確認：")
        print("  1. 已安裝 sentence-transformers: pip install sentence-transformers")
        print("  2. 網路連接正常（首次需要下載模型）")
        sys.exit(1)

    # 初始化 collection
    init_qdrant(client)

    # 載入植物資料
    print(f"\n載入植物資料: {DATA_FILE}")
    plants = load_plants()
    print(f"總共 {len(plants)} 筆資料")

    # 載入進度
    processed = load_progress()
    print(f"已處理: {len(processed)} 筆")

    # 篩選未處理的（使用完整的 plant_id 作為唯一識別）
    plants_to_process = []
    for p in plants:
        plant_id = get_plant_id(p)
        if plant_id not in processed:
            plants_to_process.append(p)
    print(f"待處理: {len(plants_to_process)} 筆")
    
    # 如果檢測到舊格式，顯示提示
    if len(processed) > 0 and len(plants_to_process) == 0 and len(plants) > len(processed):
        print("⚠️  檢測到舊格式進度檔案，將重新處理所有資料")
        processed = set()  # 清空已處理記錄
        plants_to_process = plants  # 處理所有資料

    if not plants_to_process:
        print("\n✅ 所有資料已處理完成！")
        return

    # 批次處理
    print(f"\n開始向量化（批次大小: {BATCH_SIZE}，使用本地模型）")
    print("⚠️  注意：本地模型處理速度較慢，請耐心等待")

    for i in tqdm(range(0, len(plants_to_process), BATCH_SIZE), desc="處理中"):
        batch = plants_to_process[i:i + BATCH_SIZE]

        # 產生文字
        texts = [create_plant_text(p) for p in batch]

        # 使用本地模型產生 embeddings
        try:
            embeddings = encode_text_local(model, texts)
        except Exception as e:
            print(f"\n❌ 批次 {i // BATCH_SIZE + 1} 失敗: {e}")
            print("   跳過此批次，繼續處理下一批...")
            continue

        # 建立 points
        points = []
        for j, (plant, embedding) in enumerate(zip(batch, embeddings)):
            # 使用完整的 plant_id 的 hash 作為 Qdrant ID
            plant_id_str = get_plant_id(plant)
            plant_id = hash(plant_id_str) & 0x7FFFFFFFFFFFFFFF
            
            point = PointStruct(
                id=plant_id,
                vector=embedding,
                payload={
                    "source": plant.get("source", ""),
                    "source_url": plant.get("source_url", ""),
                    "chinese_name": plant.get("chinese_name", ""),
                    "scientific_name": plant.get("scientific_name", ""),
                    "common_names": plant.get("common_names", []),
                    "family": plant.get("taxonomy", {}).get("family", ""),
                    "genus": plant.get("taxonomy", {}).get("genus", ""),
                    "life_form": plant.get("identification", {}).get("life_form", ""),
                    "summary": plant.get("identification", {}).get("summary", "")[:300],
                    "key_features": plant.get("identification", {}).get("key_features", []),
                }
            )
            points.append(point)

        # 寫入 Qdrant
        try:
            client.upsert(collection_name=COLLECTION_NAME, points=points)
        except Exception as e:
            print(f"\n❌ 寫入 Qdrant 失敗: {e}")
            print("   跳過此批次，繼續處理下一批...")
            continue

        # 更新進度
        for plant in batch:
            if plant.get("source_url"):
                processed.add(get_plant_id(plant))

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
    print(f"\nQdrant Dashboard: {QDRANT_URL.replace(':6333', '')}/dashboard")


if __name__ == "__main__":
    main()
