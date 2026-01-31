#!/usr/bin/env python3
"""
植物資料向量化腳本（使用 Jina API）
適配新的 plants-forest-gov-tw.jsonl 格式

使用方式：
1. 設定環境變數：
   export QDRANT_URL="https://gps-task-qdrant.zeabur.app"
   export QDRANT_API_KEY="your_qdrant_api_key"
   export JINA_API_KEY="your_jina_api_key"

2. 執行：
   python embed_plants_forest_jina.py
"""

import json
import os
import sys
import time
import requests
from pathlib import Path
from typing import List, Dict, Any
from tqdm import tqdm

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
JINA_API_KEY = os.environ.get("JINA_API_KEY", None)
COLLECTION_NAME = "taiwan_plants"
EMBEDDING_DIM = 1024  # Jina embeddings-v3 維度

BATCH_SIZE = 32  # 每批處理的資料數量

# 資料路徑
SCRIPT_DIR = Path(__file__).parent
DATA_FILE = SCRIPT_DIR.parent / "data" / "plants-forest-gov-tw.jsonl"
PROGRESS_FILE = SCRIPT_DIR / "embed_plants_forest_jina_progress.json"


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


def encode_text_jina(texts: List[str]) -> List[List[float]]:
    """
    使用 Jina API 將文字編碼為向量
    
    Args:
        texts: 文字列表
        
    Returns:
        向量列表
    """
    if not JINA_API_KEY:
        raise ValueError("JINA_API_KEY 未設定")
    
    response = requests.post(
        "https://api.jina.ai/v1/embeddings",
        headers={
            "Authorization": f"Bearer {JINA_API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "jina-embeddings-v3",
            "task": "retrieval.document",
            "dimensions": 1024,
            "input": texts
        },
        timeout=60
    )
    response.raise_for_status()
    data = response.json()
    
    # 提取向量
    embeddings = [item["embedding"] for item in data["data"]]
    return embeddings


def create_plant_text(plant: Dict[str, Any]) -> str:
    """
    從植物資料建立搜尋文字
    適配 plants-forest-gov-tw.jsonl 格式
    """
    parts = []
    
    # 基本資訊
    if plant.get("chinese_name"):
        parts.append(f"中文名：{plant['chinese_name']}")
    if plant.get("scientific_name"):
        parts.append(f"學名：{plant['scientific_name']}")
    if plant.get("family"):
        parts.append(f"科：{plant['family']}")
    
    # 分類資訊
    identification = plant.get("identification", {})
    if isinstance(identification, dict):
        if identification.get("life_form"):
            life_form = identification["life_form"]
            if isinstance(life_form, list):
                parts.append(f"生活型：{', '.join(life_form)}")
            else:
                parts.append(f"生活型：{life_form}")
        
        if identification.get("morphology"):
            morphology = identification["morphology"]
            if isinstance(morphology, list):
                parts.append(f"形態：{', '.join(morphology)}")
            else:
                parts.append(f"形態：{morphology}")
        
        if identification.get("summary"):
            summary = identification["summary"]
            if isinstance(summary, list):
                parts.append(f"摘要：{', '.join(summary)}")
            else:
                parts.append(f"摘要：{summary}")
        
        if identification.get("key_features"):
            key_features = identification["key_features"]
            if isinstance(key_features, list):
                parts.append(f"關鍵特徵：{', '.join(key_features)}")
            else:
                parts.append(f"關鍵特徵：{key_features}")
    
    # 分布資訊
    distribution = plant.get("distribution", {})
    if isinstance(distribution, dict) and distribution.get("taiwan"):
        parts.append(f"台灣分布：{distribution['taiwan']}")
    
    return "\n".join(parts)


def load_progress() -> set:
    """載入已處理的進度"""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # 檢查是否為舊格式（使用 source_url）
            processed = data.get("processed", [])
            if processed and isinstance(processed[0], str):
                # 舊格式，返回空集合以重新處理
                print("⚠️  檢測到舊格式的進度檔案，將重新處理所有資料")
                return set()
            return set(processed)
    return set()


def save_progress(processed: set):
    """儲存進度"""
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump({"processed": list(processed)}, f, ensure_ascii=False, indent=2)


def load_plants() -> List[Dict[str, Any]]:
    """載入植物資料"""
    if not DATA_FILE.exists():
        raise FileNotFoundError(f"資料檔案不存在: {DATA_FILE}")
    
    plants = []
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                plant = json.loads(line)
                plants.append(plant)
            except json.JSONDecodeError as e:
                print(f"⚠️  跳過無效的 JSON 行: {e}")
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
    print("🌿 植物資料向量化（使用 Jina API）")
    print("=" * 60)
    
    if not JINA_API_KEY:
        print("❌ 錯誤：JINA_API_KEY 未設定")
        print("   請設定環境變數：export JINA_API_KEY='your_key'")
        sys.exit(1)
    
    print(f"\n📦 資料檔案: {DATA_FILE}")
    print(f"📊 Collection: {COLLECTION_NAME}")
    print(f"🔗 Qdrant URL: {QDRANT_URL}")
    print(f"   向量維度: {EMBEDDING_DIM}")
    
    # 載入資料
    print(f"\n📖 載入植物資料...")
    plants = load_plants()
    print(f"✅ 載入 {len(plants)} 筆植物資料")
    
    # 載入進度
    processed = load_progress()
    print(f"📋 已處理: {len(processed)} 筆")
    
    # 連接 Qdrant
    print(f"\n🔗 連接 Qdrant...")
    client = get_qdrant_client()
    init_qdrant(client)
    
    # 處理資料
    remaining = [p for p in plants if get_plant_id(p) not in processed]
    print(f"\n🚀 開始向量化 {len(remaining)} 筆資料...")
    
    if not remaining:
        print("✅ 所有資料已處理完成！")
        return
    
    # 批次處理
    for i in range(0, len(remaining), BATCH_SIZE):
        batch = remaining[i:i + BATCH_SIZE]
        batch_texts = [create_plant_text(p) for p in batch]
        batch_ids = [get_plant_id(p) for p in batch]
        
        try:
            # 使用 Jina API 編碼
            print(f"\n📊 處理批次 {i // BATCH_SIZE + 1}/{(len(remaining) + BATCH_SIZE - 1) // BATCH_SIZE}...")
            vectors = encode_text_jina(batch_texts)
            
            # 建立 Qdrant points
            points = []
            for j, plant in enumerate(batch):
                plant_id = batch_ids[j]
                vector = vectors[j]
                
                points.append(PointStruct(
                    id=hash(plant_id) % (2**63),  # Qdrant ID 必須是 int64
                    vector=vector,
                    payload={
                        "chinese_name": plant.get("chinese_name", ""),
                        "scientific_name": plant.get("scientific_name", ""),
                        "family": plant.get("family", ""),
                        "life_form": plant.get("identification", {}).get("life_form", ""),
                        "summary": plant.get("identification", {}).get("summary", ""),
                        "key_features": plant.get("identification", {}).get("key_features", []),
                        "source": plant.get("source", "forest-gov-tw"),
                        "source_url": plant.get("source_url", ""),
                        "plant_id": plant_id,
                        "raw_data": plant
                    }
                ))
            
            # 上傳到 Qdrant
            client.upsert(
                collection_name=COLLECTION_NAME,
                points=points
            )
            
            # 更新進度
            processed.update(batch_ids)
            save_progress(processed)
            
            print(f"✅ 批次完成，已處理 {len(processed)}/{len(plants)} 筆")
            
            # 避免 API 限流
            time.sleep(0.5)
            
        except Exception as e:
            print(f"❌ 批次處理失敗: {e}")
            import traceback
            traceback.print_exc()
            print(f"   已處理 {len(processed)} 筆，可重新執行以繼續")
            break
    
    print(f"\n🎉 向量化完成！共處理 {len(processed)} 筆資料")


def get_plant_id(plant: Dict[str, Any]) -> str:
    """取得植物的唯一 ID"""
    source_url = plant.get("source_url", "")
    chinese_name = plant.get("chinese_name", "")
    scientific_name = plant.get("scientific_name", "")
    return f"{source_url}|{chinese_name}|{scientific_name}"


if __name__ == "__main__":
    main()
