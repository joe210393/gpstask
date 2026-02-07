#!/usr/bin/env python3
"""
植物資料向量化腳本（支援 Jina API 或本機模型）
適配新的 plants-forest-gov-tw.jsonl 格式

**重要：**
- USE_JINA_API=true 會使用 Jina API（會消耗 token）
- USE_JINA_API=false 會使用本機模型（不消耗 token）

**執行方式：**
- 使用虛擬環境：source ../../.venv-rag/bin/activate && python embed_plants_forest_jina.py
- 或直接：../../.venv-rag/bin/python embed_plants_forest_jina.py

使用方式：
1. 設定環境變數：
   export QDRANT_URL="http://localhost:6333"
   export QDRANT_API_KEY="your_qdrant_api_key"  # 若本機可省略
   export USE_JINA_API="false"                  # 使用本機模型
   export EMBEDDING_MODEL="jinaai/jina-embeddings-v3"

2. 執行：
   python embed_plants_forest_jina.py

3. 生產環境設定（Zeabur）：
   - 在 embedding-api 服務中設定：USE_JINA_API=true（或 auto）
   - 這樣生產環境也會使用 Jina API（1024 維），與向量化資料匹配

Token 消耗估算（僅 Jina API 模式）：
   - 約 4,670 筆資料
   - 每筆約 200-500 tokens
   - 總計約 1,000,000 - 2,000,000 tokens（約 10-20% 的免費額度）
"""

import json
import os
import sys
import time
import random
import requests

# 建議使用 DEBUG_EMBED=1 或 python -u 執行，避免輸出緩衝導致終端機「看起來卡住」
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
_use_jina_env = os.environ.get("USE_JINA_API", "true").lower()
USE_JINA_API = _use_jina_env == "true"
JINA_API_KEY = os.environ.get("JINA_API_KEY", None)
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "jinaai/jina-embeddings-v3")
_default_dim = 1024 if "jina-embeddings-v3" in EMBEDDING_MODEL else 768
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", str(_default_dim)))
COLLECTION_NAME = "taiwan_plants"

BATCH_SIZE = 16  # 每批處理的資料數量（降低以避免速率限制：每分鐘 100K tokens）

# 資料路徑
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"
# 優先順序：taxonomy-v2（最新，已補齊 taxonomy）> enriched-embed-dedup（舊版）> 其他備用檔案
TAXONOMY_V2_FILE = DATA_DIR / "plants-forest-gov-tw-enriched-embed-dedup.taxonomy-v2.jsonl"
EMBED_DEDUP_FILE = DATA_DIR / "plants-forest-gov-tw-enriched-embed-dedup.jsonl"
ENRICHED_FILE = DATA_DIR / "plants-forest-gov-tw-enriched.jsonl"
DEDUP_FILE = DATA_DIR / "plants-forest-gov-tw-dedup.jsonl"
CLEAN_FILE = DATA_DIR / "plants-forest-gov-tw-clean.jsonl"
FINAL_4302_FILE = DATA_DIR / "plants-forest-gov-tw-final-4302.jsonl"
PROGRESS_FILE = SCRIPT_DIR / "embed_plants_forest_jina_progress.json"

if TAXONOMY_V2_FILE.exists():
    DATA_FILE = TAXONOMY_V2_FILE
    print(f"✅ 使用 Taxonomy V2 資料（已補齊 taxonomy）: {DATA_FILE}")
elif EMBED_DEDUP_FILE.exists():
    DATA_FILE = EMBED_DEDUP_FILE
    print(f"✅ 使用 Enriched-Embed-Dedup 資料: {DATA_FILE}")
elif ENRICHED_FILE.exists():
    DATA_FILE = ENRICHED_FILE
    print(f"✅ 使用 P0.6 強化後資料: {DATA_FILE}")
elif DEDUP_FILE.exists():
    DATA_FILE = DEDUP_FILE
    print(f"✅ 使用 P0.5 去重後資料: {DATA_FILE}")
elif CLEAN_FILE.exists():
    DATA_FILE = CLEAN_FILE
    print(f"✅ 使用 P0 清理後資料: {DATA_FILE}")
elif FINAL_4302_FILE.exists():
    DATA_FILE = FINAL_4302_FILE
    print(f"✅ 使用 Final-4302 資料檔案: {DATA_FILE}")
else:
    DATA_FILE = TAXONOMY_V2_FILE  # 會在下文檢查時失敗
    print(f"❌ 資料檔案不存在，請先執行 enrich_taxonomy.js 產生 taxonomy-v2.jsonl")


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


_local_model = None


def get_local_model():
    global _local_model
    if _local_model is not None:
        return _local_model
    try:
        from sentence_transformers import SentenceTransformer
        _local_model = SentenceTransformer(EMBEDDING_MODEL, trust_remote_code=True)
        return _local_model
    except Exception as e:
        raise RuntimeError(f"本機模型載入失敗: {e}")


def encode_text_local(texts: List[str]) -> List[List[float]]:
    model = get_local_model()
    embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
    return [emb.tolist() for emb in embeddings]


def encode_text_jina(texts: List[str], max_retries: int = 3) -> List[List[float]]:
    """
    使用 Jina API 將文字編碼為向量（帶重試機制）
    
    Args:
        texts: 文字列表
        max_retries: 最大重試次數
        
    Returns:
        向量列表
    """
    if not JINA_API_KEY:
        raise ValueError("JINA_API_KEY 未設定")
    
    # 過濾空字串並檢查長度
    valid_texts = [t for t in texts if t and t.strip()]
    if not valid_texts:
        raise ValueError("沒有有效的文字輸入")
    
    # 檢查文字長度（Jina API 可能有長度限制）
    for i, text in enumerate(valid_texts):
        if len(text) > 8192:  # Jina API 通常限制在 8192 tokens
            print(f"⚠️  警告：文字 {i} 過長 ({len(text)} 字符)，將截斷")
            valid_texts[i] = text[:8000]  # 截斷到安全長度
    
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
                    "task": "retrieval.passage",  # 修正：使用 retrieval.passage 而非 retrieval.document
                    "dimensions": 1024,
                    "input": valid_texts
                },
                timeout=60
            )
            
            # 處理速率限制（429）
            if response.status_code == 429:
                error_data = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
                retry_after = int(response.headers.get('Retry-After', 60))  # 預設 60 秒
                
                if attempt < max_retries - 1:
                    wait_time = retry_after + random.uniform(5, 15)  # 額外隨機延遲 5-15 秒
                    print(f"   ⏳ 速率限制，等待 {wait_time:.1f} 秒後重試（嘗試 {attempt + 1}/{max_retries}）...")
                    time.sleep(wait_time)
                    continue
                else:
                    print(f"   ❌ 達到最大重試次數，放棄此批次")
                    response.raise_for_status()
            
            # 詳細錯誤處理
            if response.status_code != 200:
                print(f"❌ Jina API 錯誤: {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   錯誤詳情: {json.dumps(error_data, indent=2, ensure_ascii=False)}")
                    # 顯示第一個輸入文字（用於除錯）
                    if valid_texts:
                        print(f"   第一個輸入文字（前 200 字符）: {valid_texts[0][:200]}")
                except:
                    print(f"   錯誤回應: {response.text[:500]}")
                response.raise_for_status()
            
            data = response.json()
            
            # 記錄實際使用的 tokens（如果 API 有回傳）
            usage = data.get("usage", {})
            if usage:
                tokens_used = usage.get("total_tokens", 0)
                print(f"   ✅ Jina API 成功，使用 tokens: {tokens_used:,}")
            
            # 提取向量
            embeddings = [item["embedding"] for item in data["data"]]
            return embeddings
            
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 429 and attempt < max_retries - 1:
                continue  # 繼續重試
            raise
        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = (attempt + 1) * 5  # 指數退避
                print(f"   ⚠️  錯誤: {e}，等待 {wait_time} 秒後重試...")
                time.sleep(wait_time)
                continue
            raise
    
    raise Exception("達到最大重試次數，無法完成請求")


def create_plant_text(plant: Dict[str, Any]) -> str:
    """
    從植物資料建立搜尋文字（優化版：優先使用 summary 和 key_features）
    適配 plants-forest-gov-tw.jsonl 格式
    
    改進策略：
    1. 優先使用 morphology_summary（如果存在）- 乾淨的摘要
    2. 其次使用 summary 和 key_features
    3. 減少原始 morphology 的權重（避免常見詞淹沒）
    
    ⚠️ 重要：taxonomy.genus / taxonomy.family 不要放進 embedding text
    （會讓語意召回偏到拉丁名/科屬群，與照片萃取的中文形態特徵不一致）
    """
    parts = []
    
    # 基本資訊（保留，但權重較低）
    if plant.get("chinese_name"):
        parts.append(f"中文名：{plant['chinese_name']}")
    if plant.get("scientific_name"):
        parts.append(f"學名：{plant['scientific_name']}")
    
    # 分類資訊（優先使用乾淨的摘要）
    identification = plant.get("identification", {})
    if isinstance(identification, dict):
        # 0. 最優先使用 query_text_zh（清理後的簡短描述，用於 embedding）
        if identification.get("query_text_zh"):
            parts.append(identification["query_text_zh"])
        # 1. 其次使用 morphology_summary（階段二：如果存在）
        elif identification.get("morphology_summary_zh"):
            parts.append(identification["morphology_summary_zh"])
        # 2. 再次使用 summary（較乾淨）
        elif identification.get("summary"):
            summary = identification["summary"]
            if isinstance(summary, list):
                parts.append(" ".join(summary))
            else:
                parts.append(summary)
        
        # 3. 加入 trait_tokens（如果存在，階段二）
        trait_tokens = identification.get("trait_tokens", [])
        if trait_tokens and isinstance(trait_tokens, list):
            # 只取前 20 個 token，避免過長
            trait_tokens_limited = trait_tokens[:20]
            # 轉換為可讀文字（用於 embedding）
            trait_text = " ".join(trait_tokens_limited)
            parts.append(f"特徵：{trait_text}")
        
        # 4. 加入 key_features（高辨識度特徵，如果沒有 trait_tokens）
        elif identification.get("key_features"):
            key_features = identification["key_features"]
            if isinstance(key_features, list):
                # 只取前 10 個關鍵特徵，避免過長
                key_features_limited = key_features[:10]
                parts.append(f"關鍵特徵：{', '.join(key_features_limited)}")
            else:
                parts.append(f"關鍵特徵：{key_features}")
        
        # 5. 生活型（重要識別特徵）
        if identification.get("life_form"):
            life_form = identification["life_form"]
            if isinstance(life_form, list):
                parts.append(f"生活型：{', '.join(life_form)}")
            else:
                parts.append(f"生活型：{life_form}")
        
        # 6. 原始 morphology（備用，權重較低）
        # 只在沒有 summary 和 morphology_summary 時才使用
        if not identification.get("morphology_summary_zh") and not identification.get("summary"):
            if identification.get("morphology"):
                morphology = identification["morphology"]
                if isinstance(morphology, list):
                    # 只取前 3 條，避免過長
                    morphology_limited = morphology[:3]
                    parts.append(f"形態：{', '.join(morphology_limited)}")
                else:
                    parts.append(f"形態：{morphology}")
    
    # 分布資訊（移除，避免干擾）
    # distribution = plant.get("distribution", {})
    # if isinstance(distribution, dict) and distribution.get("taiwan"):
    #     parts.append(f"台灣分布：{distribution['taiwan']}")
    
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


FORCE_RECREATE = os.environ.get("FORCE_RECREATE", "").lower() in ("1", "true", "yes")


def init_qdrant(client: QdrantClient):
    """初始化 Qdrant collection"""
    collections = client.get_collections().collections
    collection_names = [c.name for c in collections]

    if COLLECTION_NAME in collection_names:
        # P0 整庫重建：FORCE_RECREATE=1 時刪除舊 collection
        if FORCE_RECREATE:
            print(f"⚠️  FORCE_RECREATE=1，刪除舊 collection 並重建...")
            client.delete_collection(collection_name=COLLECTION_NAME)
            print(f"   ✅ 舊 collection 已刪除")
        else:
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
    mode_text = "Jina API" if USE_JINA_API else "本機模型"
    print(f"🌿 植物資料向量化（使用 {mode_text}）")
    print("=" * 60)
    
    if USE_JINA_API and not JINA_API_KEY:
        print("❌ 錯誤：JINA_API_KEY 未設定")
        print("   請設定環境變數：export JINA_API_KEY='your_key'")
        sys.exit(1)
    
    if not USE_JINA_API:
        # 檢查本地模型依賴
        try:
            import sentence_transformers
        except ImportError:
            print("❌ 錯誤：未安裝 sentence_transformers")
            print("   選項 1：安裝依賴：pip install sentence-transformers")
            print("   選項 2：使用 Jina API（推薦）：export USE_JINA_API=true && export JINA_API_KEY='your_key'")
            sys.exit(1)
    
    print(f"\n📦 資料檔案: {DATA_FILE}")
    print(f"📊 Collection: {COLLECTION_NAME}")
    print(f"🔗 Qdrant URL: {QDRANT_URL}")
    print(f"   向量維度: {EMBEDDING_DIM}")
    
    # 載入資料
    print(f"\n📖 載入植物資料...")
    plants = load_plants()
    print(f"✅ 載入 {len(plants)} 筆植物資料")
    
    # 步驟 5：資料庫去重（以 canonical key 為主鍵，同一物種只保留一筆）
    print(f"\n🔍 執行資料去重（以學名為主鍵）...")
    canonical_seen = {}
    deduplicated_plants = []
    duplicates_removed = 0
    for plant in plants:
        canonical_key = get_canonical_key(plant)
        if not canonical_key:
            # 沒有 canonical key 的資料保留（可能是資料品質問題）
            deduplicated_plants.append(plant)
            continue
        if canonical_key not in canonical_seen:
            canonical_seen[canonical_key] = plant
            deduplicated_plants.append(plant)
        else:
            duplicates_removed += 1
            # 保留資料品質較高的（有 summary/key_features 的優先）
            existing = canonical_seen[canonical_key]
            existing_quality = len(existing.get("identification", {}).get("summary", "") or "")
            new_quality = len(plant.get("identification", {}).get("summary", "") or "")
            if new_quality > existing_quality:
                # 替換成品質更高的
                deduplicated_plants.remove(existing)
                deduplicated_plants.append(plant)
                canonical_seen[canonical_key] = plant
    print(f"   ✅ 去重完成：原始 {len(plants)} 筆 → 去重後 {len(deduplicated_plants)} 筆（移除 {duplicates_removed} 筆重複）")
    # 將去重後的資料寫入專用檔案，方便後續特徵權重等模組共用同一批資料（約 2759 筆）
    try:
        with open(EMBED_DEDUP_FILE, "w", encoding="utf-8") as f:
            for plant in deduplicated_plants:
                f.write(json.dumps(plant, ensure_ascii=False) + "\n")
        print(f"   💾 已將去重後資料寫入: {EMBED_DEDUP_FILE}（{len(deduplicated_plants)} 筆）")
    except Exception as e:
        print(f"   ⚠️ 寫入去重後資料檔失敗（不影響向量化流程）: {e}")
    plants = deduplicated_plants
    
    # 載入進度
    processed = load_progress()
    print(f"📋 已處理: {len(processed)} 筆")
    
    # 連接 Qdrant
    print(f"\n🔗 連接 Qdrant...", flush=True)
    sys.stdout.flush()
    client = get_qdrant_client()
    print(f"   ✅ Qdrant 連線成功", flush=True)
    init_qdrant(client)
    
    # 處理資料
    remaining = [p for p in plants if get_plant_id(p) not in processed]
    print(f"\n🚀 開始向量化 {len(remaining)} 筆資料...")
    
    if not remaining:
        print("✅ 所有資料已處理完成！")
        return
    
    if USE_JINA_API:
        # 估算總 tokens（粗略估算）
        print(f"\n💰 Token 消耗估算：")
        sample_texts = [create_plant_text(p) for p in remaining[:10]]
        avg_chars = sum(len(t) for t in sample_texts) / len(sample_texts) if sample_texts else 0
        estimated_total_tokens = int(len(remaining) * avg_chars / 1.5)  # 中文字符約 1.5 字符 = 1 token
        print(f"   預估總 tokens：{estimated_total_tokens:,} tokens")
        print(f"   您目前剩餘：10,000,000 tokens（免費額度）")
        print(f"   預估消耗比例：{estimated_total_tokens / 10_000_000 * 100:.2f}%")
        print(f"   剩餘 tokens：{10_000_000 - estimated_total_tokens:,} tokens")
    # 支援非互動模式（環境變數 AUTO_CONFIRM=true 或 CI=true）
    auto_confirm = os.environ.get("AUTO_CONFIRM", "").lower() == "true" or os.environ.get("CI", "").lower() == "true"
    
    if auto_confirm:
        print(f"\n   ✅ 自動確認模式，開始向量化...")
        response = "yes"
    else:
        print(f"\n   繼續向量化？(yes/no): ", end="")
        try:
            response = input().strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n   ⚠️  非互動模式，使用自動確認")
            response = "yes"
    
    if response != 'yes':
        print("   已取消操作")
        sys.exit(0)
    
    # 批次處理
    for i in range(0, len(remaining), BATCH_SIZE):
        batch = remaining[i:i + BATCH_SIZE]
        batch_texts = [create_plant_text(p) for p in batch]
        batch_ids = [get_plant_id(p) for p in batch]
        
        # 過濾空文字，保持索引對應
        valid_indices = []
        valid_texts = []
        for idx, text in enumerate(batch_texts):
            if text and text.strip():
                valid_indices.append(idx)
                valid_texts.append(text)
        
        if not valid_texts:
            print(f"⚠️  批次 {i // BATCH_SIZE + 1} 沒有有效文字，跳過")
            continue
        
        try:
            # 使用 Jina API 編碼
            batch_num = i // BATCH_SIZE + 1
            total_batches = (len(remaining) + BATCH_SIZE - 1) // BATCH_SIZE
            print(f"\n📊 處理批次 {batch_num}/{total_batches} ({len(valid_texts)} 筆有效/{len(batch)} 筆總計)...", flush=True)
            sys.stdout.flush()
            if USE_JINA_API:
                vectors = encode_text_jina(valid_texts)
            else:
                vectors = encode_text_local(valid_texts)
            
            # 建立 Qdrant points（只處理有效的）
            points = []
            for vec_idx, text_idx in enumerate(valid_indices):
                plant = batch[text_idx]
                plant_id = batch_ids[text_idx]
                vector = vectors[vec_idx]
                
                ident = plant.get("identification", {})
                payload = {
                    "chinese_name": plant.get("chinese_name", ""),
                    "scientific_name": plant.get("scientific_name", ""),
                    "family": plant.get("family", ""),
                    "life_form": ident.get("life_form", ""),
                    "summary": ident.get("summary", ""),
                    "key_features": ident.get("key_features", []),
                    "key_features_norm": ident.get("key_features_norm", []),
                    "trait_tokens": ident.get("trait_tokens", []),
                    "source": plant.get("source", "forest-gov-tw"),
                    "source_url": plant.get("source_url", ""),
                    "plant_id": plant_id,
                    "raw_data": plant
                }
                qs = plant.get("_quality_score")
                if qs is not None:
                    payload["quality_score"] = float(qs)
                points.append(PointStruct(id=hash(plant_id) % (2**63), vector=vector, payload=payload))
            
            # 上傳到 Qdrant
            client.upsert(
                collection_name=COLLECTION_NAME,
                points=points
            )
            
            # 更新進度
            processed.update(batch_ids)
            save_progress(processed)
            
            print(f"✅ 批次完成，已處理 {len(processed)}/{len(plants)} 筆")
            
            # 批次之間添加延遲，避免速率限制（每分鐘 100K tokens）
            # 估算：每批次約 10K tokens，所以每批次間隔約 6 秒
            if batch_num < total_batches:  # 最後一批不需要延遲
                delay = random.uniform(6, 10)  # 隨機延遲 6-10 秒
                print(f"   ⏸️  等待 {delay:.1f} 秒以避免速率限制...")
                time.sleep(delay)
            
        except Exception as e:
            print(f"❌ 批次處理失敗: {e}")
            import traceback
            traceback.print_exc()
            print(f"   已處理 {len(processed)} 筆，可重新執行以繼續")
            break
    
    print(f"\n🎉 向量化完成！共處理 {len(processed)} 筆資料")


def normalize_scientific_name(sci: str) -> str:
    """正規化學名：移除變種標記（var./subsp./f.）並標準化格式"""
    if not sci:
        return ""
    sci = sci.strip()
    # 移除常見的變種標記（var. / subsp. / f. / cv. / '）
    import re
    # 移除 var. / subsp. / f. / cv. 及其後面的內容（保留到 species 為止）
    sci = re.sub(r'\s+(var\.|subsp\.|ssp\.|f\.|cv\.|cultivar)', '', sci, flags=re.IGNORECASE)
    # 移除單引號（栽培種標記）
    sci = sci.replace("'", "").replace('"', '')
    # 移除多餘空格
    sci = " ".join(sci.split())
    return sci.lower()


def get_canonical_key(plant: Dict[str, Any]) -> str:
    """取得植物的 canonical key（用於去重）：優先學名，fallback 到中文名+科+屬"""
    sci = (plant.get("scientific_name") or "").strip()
    if sci:
        sci_normalized = normalize_scientific_name(sci)
        if sci_normalized:
            parts = sci_normalized.split()
            if len(parts) >= 2:
                # 只取 genus + species（忽略變種、亞種等）
                return f"{parts[0]} {parts[1]}"
            return sci_normalized
    # Fallback：中文名 + 科 + 屬
    cname = (plant.get("chinese_name") or "").strip()
    family = (plant.get("family") or "").strip()
    genus = (plant.get("genus") or "").strip()
    import re
    if cname:
        cname = re.sub(r'[\s\-_]+', '', cname)
    key_parts = [p for p in (cname, family, genus) if p]
    return " | ".join(key_parts) if key_parts else ""


def get_plant_id(plant: Dict[str, Any]) -> str:
    """取得植物的唯一 ID（保留原始邏輯用於進度追蹤，但去重改用 canonical_key）"""
    source_url = plant.get("source_url", "")
    chinese_name = plant.get("chinese_name", "")
    scientific_name = plant.get("scientific_name", "")
    return f"{source_url}|{chinese_name}|{scientific_name}"


if __name__ == "__main__":
    main()
