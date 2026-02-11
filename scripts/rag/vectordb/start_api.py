#!/usr/bin/env python3
"""
植物向量搜尋 API 服務
提供 REST API 給 Node.js server 呼叫

功能：
1. 自動判斷查詢類型（植物/動物/人造物/其他）
2. 只有植物相關查詢才進行 RAG 搜尋

啟動方式：
  python start_api.py
  (Trigger redeploy: 2026-02-02)

API 端點：
  POST /search
  Body: { "query": "紅色的花", "top_k": 5 }

  POST /classify
  Body: { "query": "這是什麼" }

  GET /health
"""

import os
import sys
import json
import threading
import numpy as np
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs
from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny, MatchText

# 延遲載入重量級模組
SentenceTransformer = None
QdrantClient = None
FeatureWeightCalculator = None
get_vision_prompt = None
FEATURE_INDEX = {}

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", None)  # Zeabur Qdrant API Key
COLLECTION_NAME = "taiwan_plants"
# 允許用環境變數覆蓋模型，避免在 Zeabur 上因為記憶體不足造成反覆重啟
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "jinaai/jina-embeddings-v3")
_default_dim = 1024 if "jina-embeddings-v3" in EMBEDDING_MODEL else 768
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", str(_default_dim)))
JINA_API_KEY = os.environ.get("JINA_API_KEY", None)  # Jina AI API Key
# 可選：指定特徵權重計算用的資料檔路徑（只影響 df/idf 統計，不影響 Qdrant 向量）
FEATURE_DATA_PATH = os.environ.get("FEATURE_DATA_PATH", "").strip()
# USE_JINA_API:
# - "true": 強制使用 Jina API
# - "false": 強制本地模型
# - "auto": 若有 JINA_API_KEY 則使用 Jina API（避免忘了設定）
_use_jina_env = os.environ.get("USE_JINA_API", "auto").lower()
FORCE_JINA_API = (_use_jina_env == "true")
AUTO_JINA_API = (_use_jina_env == "auto")
USE_JINA_API = FORCE_JINA_API or (AUTO_JINA_API and bool(JINA_API_KEY))
# Zeabur 用 PORT，本地開發用 EMBEDDING_API_PORT
API_PORT = int(os.environ.get("PORT", os.environ.get("EMBEDDING_API_PORT", "8100")))

def get_qdrant_client():
    """建立 Qdrant 客戶端，自動處理 HTTP/HTTPS"""
    import warnings
    from urllib.parse import urlparse
    parsed = urlparse(QDRANT_URL)

    is_https = parsed.scheme == 'https'
    host = parsed.hostname or 'localhost'
    port = parsed.port or (443 if is_https else 6333)

    # 如果是內部網路 HTTP 連線，不使用 API Key
    use_api_key = QDRANT_API_KEY if is_https else None

    if use_api_key:
        return QdrantClient(
            host=host,
            port=port,
            api_key=use_api_key,
            https=is_https,
            prefer_grpc=False,
            timeout=30
        )
    else:
        # 內部連線不需要 API Key，忽略警告
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return QdrantClient(
                host=host,
                port=port,
                https=is_https,
                prefer_grpc=False,
            timeout=30
            )

# 分類閾值
PLANT_THRESHOLD = 0.40  # 與「植物」相似度超過此值才認為是植物查詢（降低以減少誤判）

# 全域變數（啟動時載入）
model = None
qdrant_client = None
category_embeddings = None  # 預計算的類別向量
feature_calculator = None  # 特徵權重計算器

# 混合評分權重（初始預設：embedding 稍高，特徵為輔）
EMBEDDING_WEIGHT = 0.78  # embedding 為主，避免特徵主導排序
FEATURE_WEIGHT = 0.22    # 特徵只做 gate + 有限加分
KEYWORD_BONUS_WEIGHT = 0.18  # 關鍵字匹配加分（Vision 猜的物種名是強訊號，提高以對抗 feature 資料不全）

# 常錯當 Top1 的「萬用條目」：輕度降權，降低霸榜機率
# 注意：這是短期止血，不是長期解法（長期應改善資料/特徵/權重）
GENERIC_TOP1_BLACKLIST = frozenset({"冇拱", "南亞孔雀苔", "鞭枝懸苔", "株苔", "八角蓮", "草海桐", "白檀"})
GENERIC_TOP1_PENALTY = float(os.environ.get("GENERIC_TOP1_PENALTY", "0.80"))


def apply_generic_top1_penalty(rows: list[dict], penalty: float = GENERIC_TOP1_PENALTY) -> list[dict]:
    """對萬用條目做輕度降權（就地修改 + 回傳，方便 chain）。"""
    if not rows:
        return rows
    try:
        p = float(penalty)
    except Exception:
        p = 0.88
    # 夾住，避免環境變數設錯造成極端結果
    if p <= 0:
        p = 0.01
    if p > 1:
        p = 1.0

    for item in rows:
        try:
            name = (item.get("chinese_name") or "").strip()
            if name in GENERIC_TOP1_BLACKLIST:
                item["score"] = float(item.get("score") or 0.0) * p
        except Exception:
            continue
    return rows


def encode_text(text):
    """
    編碼文字為向量，根據設定選擇使用本地模型或 Jina API

    Args:
        text: 單一文字字串或文字列表

    Returns:
        numpy array 或 list of numpy arrays
    """
    # 強制 Jina 模式：即使 key 沒有設，也不應嘗試回退到本地模型（避免 Zeabur OOM/下載模型）
    if FORCE_JINA_API and not JINA_API_KEY:
        raise RuntimeError("USE_JINA_API=true 但未設定 JINA_API_KEY（已禁止回退到本地模型）")

    if USE_JINA_API and JINA_API_KEY:
        # 使用 Jina API
        import requests

        is_batch = isinstance(text, list)
        texts = text if is_batch else [text]
        
        # 記錄每次 API 調用（用於追蹤 token 消耗）
        print(f"[Jina API] 調用 embedding: batch={is_batch}, texts_count={len(texts)}, sample={texts[0][:20] if texts else 'empty'}...")
        sys.stdout.flush()

        try:
            response = requests.post(
                "https://api.jina.ai/v1/embeddings",
                headers={
                    "Authorization": f"Bearer {JINA_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "jina-embeddings-v3",
                    "task": "retrieval.query",
                    "dimensions": 1024,
                    "input": texts
                },
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            # 記錄 tokens 使用量（如果 API 有回傳）
            usage = data.get("usage", {})
            if usage:
                print(f"[Jina API] ✅ 成功: tokens={usage.get('total_tokens', 'unknown')}")
            else:
                print(f"[Jina API] ✅ 成功: {len(data.get('data', []))} 個 embeddings")
            sys.stdout.flush()

            embeddings = [item["embedding"] for item in data["data"]]

            if is_batch:
                return [np.array(emb) for emb in embeddings]
            else:
                return np.array(embeddings[0])

        except Exception as e:
            print(f"⚠️ Jina API 錯誤: {e}")
            sys.stdout.flush()
            # 強制 Jina 模式時，不回退到本地模型（避免 OOM/下載模型）
            if FORCE_JINA_API:
                raise RuntimeError(f"Jina API 失敗（且 USE_JINA_API=true 禁止回退本地模型）: {e}")
            # 非強制時，才允許回退到本地模型（若可用）
            if model:
                return model.encode(text)
            raise RuntimeError("Jina API 和本地模型都不可用")

    elif model:
        # 使用本地模型
        return model.encode(text)

    else:
        raise RuntimeError("沒有可用的 embedding 方法（需要設定 USE_JINA_API=true 或載入本地模型）")


def init_background():
    """背景初始化模型和連接（在獨立線程中執行）"""
    global model, qdrant_client, category_embeddings, feature_calculator
    global SentenceTransformer, QdrantClient, FeatureWeightCalculator, get_vision_prompt, FEATURE_INDEX

    try:
        print("🚀 開始背景初始化...")
        sys.stdout.flush()
        _init_background_impl()
    except Exception as e:
        print(f"❌ 背景初始化失敗: {e}")
        import traceback
        traceback.print_exc()
        sys.stdout.flush()


def _init_background_impl():
    """實際的背景初始化實作（由 init_background 包裝）"""
    global model, qdrant_client, category_embeddings, feature_calculator
    global SentenceTransformer, QdrantClient, FeatureWeightCalculator, get_vision_prompt, FEATURE_INDEX

    # 1. 載入 Qdrant 客戶端模組
    try:
        print("  載入 qdrant_client 模組...")
        sys.stdout.flush()
        from qdrant_client import QdrantClient as QC
        QdrantClient = QC
    except Exception as e:
        print(f"  ⚠️ 無法載入 qdrant_client: {e}")
        sys.stdout.flush()

    # 2. 連接 Qdrant
    print(f"  連接 Qdrant: {QDRANT_URL}")
    if QDRANT_API_KEY:
        print("    API Key 已設定")
    sys.stdout.flush()

    try:
        qdrant_client = get_qdrant_client()
        collections = qdrant_client.get_collections()
        print(f"  ✅ Qdrant 連線成功，共 {len(collections.collections)} 個 collections")
        
        # 檢查 collection 維度是否匹配
        if COLLECTION_NAME in [c.name for c in collections.collections]:
            collection_info = qdrant_client.get_collection(COLLECTION_NAME)
            existing_dim = collection_info.config.params.vectors.size
            
            # 依模型設定的維度，避免本機模型與 Jina v3 不一致
            expected_dim = EMBEDDING_DIM
            
            if existing_dim != expected_dim:
                print(f"  ⚠️ Collection '{COLLECTION_NAME}' 維度不匹配！")
                print(f"     現有維度: {existing_dim}")
                print(f"     期望維度: {expected_dim}")
                print(f"  ⚠️ 這會導致搜尋失敗，請重新向量化資料或更新 collection")
                print(f"     建議：運行 embed_plants_forest.py 重新向量化（會自動處理維度）")
    except Exception as e:
        print(f"  ⚠️ Qdrant 連線失敗: {e}")
        print(f"    應用將繼續運行，但搜尋功能不可用")
        qdrant_client = None
    sys.stdout.flush()

    # 3. 載入 embedding 模型（如果不使用 Jina API）
    # FORCE_JINA_API=true 時，就算 key 缺失也不載本地模型（避免 Zeabur 下載/記憶體問題）
    if FORCE_JINA_API or (USE_JINA_API and JINA_API_KEY):
        print(f"  使用 Jina AI API: {EMBEDDING_MODEL}")
        print(f"    API Key: {'*' * 20}{JINA_API_KEY[-4:] if JINA_API_KEY else 'None'}")
        print("  ⏩ 跳過本地模型載入")
        model = None
    else:
        try:
            print(f"  載入本地 embedding 模型: {EMBEDDING_MODEL}")
            print("    這可能需要幾分鐘...")
            sys.stdout.flush()

            from sentence_transformers import SentenceTransformer as ST
            SentenceTransformer = ST

            print("    正在下載/載入模型權重...")
            sys.stdout.flush()

            model = SentenceTransformer(EMBEDDING_MODEL, trust_remote_code=True)

            print("  ✅ 模型載入成功")
        except MemoryError as e:
            print(f"  ❌ 記憶體不足，無法載入模型: {e}")
            import traceback
            traceback.print_exc()
            model = None
        except Exception as e:
            print(f"  ⚠️ 模型載入失敗: {e}")
            import traceback
            traceback.print_exc()
            model = None
    sys.stdout.flush()

    # 4. 載入特徵權重計算器
    try:
        print("  載入特徵權重計算器...")
        sys.stdout.flush()
        from feature_weights import FeatureWeightCalculator as FWC, get_vision_prompt as gvp, FEATURE_INDEX as FI
        FeatureWeightCalculator = FWC
        get_vision_prompt = gvp
        FEATURE_INDEX = FI
    except Exception as e:
        print(f"  ⚠️ 特徵權重計算器載入失敗: {e}")
    sys.stdout.flush()

    # 5. 載入特徵資料
    import os.path
    # 優先順序：taxonomy-v2（最新，已補齊 taxonomy）> enriched-embed-dedup > enriched > dedup > clean > final-4302
    taxonomy_v2_paths = [
        "/app/data/plants-forest-gov-tw-enriched-embed-dedup.taxonomy-v2.jsonl",
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-forest-gov-tw-enriched-embed-dedup.taxonomy-v2.jsonl"),
        os.path.join(os.path.dirname(__file__), "data", "plants-forest-gov-tw-enriched-embed-dedup.taxonomy-v2.jsonl"),
    ]
    embed_dedup_paths = [
        "/app/data/plants-forest-gov-tw-enriched-embed-dedup.jsonl",
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-forest-gov-tw-enriched-embed-dedup.jsonl"),
        os.path.join(os.path.dirname(__file__), "data", "plants-forest-gov-tw-enriched-embed-dedup.jsonl"),
    ]
    enriched_paths = [
        "/app/data/plants-forest-gov-tw-enriched.jsonl",
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-forest-gov-tw-enriched.jsonl"),
        os.path.join(os.path.dirname(__file__), "data", "plants-forest-gov-tw-enriched.jsonl"),
    ]
    dedup_paths = [
        "/app/data/plants-forest-gov-tw-dedup.jsonl",
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-forest-gov-tw-dedup.jsonl"),
        os.path.join(os.path.dirname(__file__), "data", "plants-forest-gov-tw-dedup.jsonl"),
    ]
    final_4302_paths = [
        "/app/data/plants-forest-gov-tw-final-4302.jsonl",
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-forest-gov-tw-final-4302.jsonl"),
        os.path.join(os.path.dirname(__file__), "data", "plants-forest-gov-tw-final-4302.jsonl"),
    ]
    clean_paths = [
        "/app/data/plants-forest-gov-tw-clean.jsonl",
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-forest-gov-tw-clean.jsonl"),
        os.path.join(os.path.dirname(__file__), "data", "plants-forest-gov-tw-clean.jsonl"),
    ]
    
    enhanced_paths = [
        "/app/data/plants-forest-gov-tw-enhanced.jsonl",  # Docker 容器中的路徑（備用）
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-forest-gov-tw-enhanced.jsonl"),
        os.path.join(os.path.dirname(__file__), "data", "plants-forest-gov-tw-enhanced.jsonl"),
    ]
    
    # 備用路徑：原始資料（如果 enhanced 不存在時使用）
    fallback_paths = [
        "/app/data/plants-forest-gov-tw.jsonl",
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-forest-gov-tw.jsonl"),
        os.path.join(os.path.dirname(__file__), "data", "plants-forest-gov-tw.jsonl"),
    ]
    
    # 舊檔案路徑（不建議使用）
    old_paths = [
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-enriched.jsonl"),
        os.path.join(os.path.dirname(__file__), "data", "plants-enriched.jsonl"),
        "/app/data/plants-enriched.jsonl",
    ]
    
    data_path = None
    # 若有指定 FEATURE_DATA_PATH，優先使用（只影響特徵權重統計）
    if FEATURE_DATA_PATH:
        exists = os.path.exists(FEATURE_DATA_PATH)
        print(f"  FEATURE_DATA_PATH 指定檔案: {FEATURE_DATA_PATH} -> {'✅ 存在' if exists else '❌ 不存在'}")
        if exists:
            data_path = FEATURE_DATA_PATH
    # 否則依預設優先順序：taxonomy-v2 > enriched-embed-dedup > P0.6 強化 > P0.5 去重 > P0 clean > final-4302
    if not data_path:
        print(f"  搜尋資料檔案（taxonomy-v2 > enriched-embed-dedup > P0.6 強化 > P0.5 去重 > P0 clean > final-4302）...")
        # 優先使用 taxonomy-v2（已補齊 taxonomy）
        for p in taxonomy_v2_paths:
            exists = os.path.exists(p)
            print(f"    檢查: {p} -> {'✅ 存在' if exists else '❌ 不存在'}")
            if exists:
                data_path = p
                print(f"    ✅ 找到 Taxonomy V2 資料（已補齊 taxonomy）: {p}")
                break
    if not data_path:
        # 其次使用 enriched-embed-dedup
        for p in embed_dedup_paths:
            exists = os.path.exists(p)
            print(f"    檢查: {p} -> {'✅ 存在' if exists else '❌ 不存在'}")
            if exists:
                data_path = p
                print(f"    ✅ 找到 Enriched-Embed-Dedup 資料: {p}")
                break
    if not data_path:
        for p in enriched_paths:
            exists = os.path.exists(p)
            print(f"    檢查: {p} -> {'✅ 存在' if exists else '❌ 不存在'}")
            if exists:
                data_path = p
                print(f"    ✅ 找到 P0.6 強化後資料: {p}")
                break
    if not data_path:
        for p in dedup_paths:
            exists = os.path.exists(p)
            print(f"    檢查: {p} -> {'✅ 存在' if exists else '❌ 不存在'}")
            if exists:
                data_path = p
                print(f"    ✅ 找到 P0.5 去重後資料: {p}")
                break
    if not data_path:
        for p in clean_paths:
            exists = os.path.exists(p)
            print(f"    檢查: {p} -> {'✅ 存在' if exists else '❌ 不存在'}")
            if exists:
                data_path = p
                print(f"    ✅ 找到 P0 清理後資料: {p}")
                break
    if not data_path:
        for path in final_4302_paths:
            exists = os.path.exists(path)
            print(f"    檢查: {path} -> {'✅ 存在' if exists else '❌ 不存在'}")
            if exists:
                data_path = path
                print(f"    ✅ 找到 Final-4302 資料檔案: {path}")
                break
    
    # 如果 clean 不存在，搜尋 enhanced 檔案
    if not data_path:
        print(f"  搜尋 Enhanced 資料檔案...")
        for path in enhanced_paths:
            exists = os.path.exists(path)
            print(f"    檢查: {path} -> {'✅ 存在' if exists else '❌ 不存在'}")
            if exists:
                data_path = path
                print(f"    ✅ 找到 Enhanced 資料檔案: {path}")
                break
    
    # 如果 enhanced 檔案不存在，使用原始資料
    if not data_path:
        print(f"  ⚠️  Enhanced 檔案不存在，搜尋原始資料檔案...")
        for path in fallback_paths:
            exists = os.path.exists(path)
            print(f"    檢查: {path} -> {'✅ 存在' if exists else '❌ 不存在'}")
            if exists:
                data_path = path
                print(f"    ⚠️  使用原始資料檔案: {path}")
                break
    
    # 如果原始資料也不存在，才使用舊檔案
    if not data_path:
        print(f"  ⚠️  新檔案不存在，搜尋備用檔案...")
        for path in fallback_paths:
            exists = os.path.exists(path)
            print(f"    檢查: {path} -> {'✅ 存在' if exists else '❌ 不存在'}")
            if exists:
                data_path = path
                print(f"    ⚠️  使用備用檔案: {path}")
                break
    
    # 強制檢查：如果找到舊檔案但新檔案也應該存在，發出警告
    if data_path and "plants-enriched.jsonl" in data_path:
        new_file_path = "/app/data/plants-forest-gov-tw.jsonl"
        if os.path.exists(new_file_path):
            print(f"  ⚠️  警告：找到舊檔案 {data_path}，但新檔案 {new_file_path} 也存在！")
            print(f"  🔧 強制使用新檔案: {new_file_path}")
            data_path = new_file_path

    if data_path and FeatureWeightCalculator:
        try:
            print(f"  資料檔: {data_path}")
            feature_calculator = FeatureWeightCalculator(data_path)
            print("  ✅ 特徵權重計算器載入成功")
        except Exception as e:
            print(f"  ⚠️ 特徵權重計算器初始化失敗: {e}")
            feature_calculator = None
    else:
        print("  ⚠️ 找不到資料檔或模組，使用空的計算器")
        feature_calculator = None
    sys.stdout.flush()

    # 6. 計算類別向量（如果模型可用或使用 Jina API）
    # 優化：合併所有關鍵字為一次 batch 調用，減少 Jina API 調用次數（從 5 次降到 1 次）
    if model or (USE_JINA_API and JINA_API_KEY):
        try:
            print("  計算類別向量（優化：單次 batch 調用）...")
            sys.stdout.flush()
            categories = {
                "plant": ["植物", "花", "樹", "草", "葉子", "果實"],
                "animal": ["動物", "鳥", "魚", "蟲", "獸"],
                "artifact": ["建築", "房子", "車", "機器", "工具"],
                "food": ["食物", "料理", "菜", "飲料"],
                "other": ["風景", "天氣", "地形", "山", "河"]
            }
            
            # 收集所有關鍵字和對應的類別索引
            all_keywords = []
            keyword_to_category = {}  # {index: category}
            category_keyword_indices = {}  # {category: [indices]}
            
            idx = 0
            for cat, keywords in categories.items():
                category_keyword_indices[cat] = list(range(idx, idx + len(keywords)))
                for kw in keywords:
                    all_keywords.append(kw)
                    keyword_to_category[idx] = cat
                    idx += 1
            
            # 一次性 batch 調用（所有關鍵字一起）
            print(f"    批次處理 {len(all_keywords)} 個關鍵字（5 個類別）...")
            sys.stdout.flush()
            all_embeddings = encode_text(all_keywords)
            
            # 處理回傳結果
            if isinstance(all_embeddings, np.ndarray):
                embeddings_array = all_embeddings  # (N, D)
            elif isinstance(all_embeddings, list):
                embeddings_array = np.array(all_embeddings)  # list[np.ndarray] -> (N, D)
            else:
                embeddings_array = np.array([all_embeddings])
            
            # 確保是 (N, D)
            if embeddings_array.ndim == 1:
                embeddings_array = embeddings_array.reshape(1, -1)
            
            # 按類別分組並計算平均向量
            category_embeddings = {}
            for cat, indices in category_keyword_indices.items():
                cat_vectors = embeddings_array[indices]  # (len(keywords), D)
                category_embeddings[cat] = np.mean(cat_vectors, axis=0)  # (D,)
                print(f"    ✅ {cat}: {len(indices)} 個關鍵字")
            
            print("  ✅ 類別向量計算完成（僅 1 次 API 調用）")
        except MemoryError as e:
            print(f"  ❌ 記憶體不足，無法計算類別向量: {e}")
            import traceback
            traceback.print_exc()
            category_embeddings = None
        except Exception as e:
            print(f"  ⚠️ 類別向量計算失敗: {e}")
            import traceback
            traceback.print_exc()
            category_embeddings = None
    sys.stdout.flush()

    print("🎉 背景初始化完成！")
    sys.stdout.flush()


def init():
    """啟動背景初始化線程，立即返回讓 HTTP 服務器啟動"""
    print("=" * 60)
    print("🌿 植物向量搜尋 API (版本: NO_MUST_GATE_V2)")
    print("=" * 60)
    sys.stdout.flush()

    # 在背景線程中執行初始化
    init_thread = threading.Thread(target=init_background, daemon=True)
    init_thread.start()

    print("📡 HTTP 服務器正在啟動...")
    print("   初始化將在背景執行")
    sys.stdout.flush()


def classify_query(query: str) -> dict:
    """
    分類查詢類型
    返回: { "category": "plant/animal/artifact/food/other", "confidence": 0.xx, "is_plant": true/false }
    """
    if category_embeddings is None:
        return {
            "category": "unknown",
            "confidence": 0,
            "scores": {},
            "is_plant": False,
            "plant_score": 0,
            "error": "模型尚未載入完成"
        }

    query_vector = encode_text(query)
    if isinstance(query_vector, list):
        query_vector = np.array(query_vector)
    if isinstance(query_vector, np.ndarray) and query_vector.ndim > 1:
        # 保險：若意外回傳 (N, D)，取平均變成 (D,)
        query_vector = np.mean(query_vector, axis=0)

    # 計算與各類別的相似度
    scores = {}
    for cat, cat_vector in category_embeddings.items():
        # 餘弦相似度
        similarity = np.dot(query_vector, cat_vector) / (
            np.linalg.norm(query_vector) * np.linalg.norm(cat_vector)
        )
        scores[cat] = float(similarity)

    # 找出最高分的類別
    best_category = max(scores, key=scores.get)
    best_score = scores[best_category]

    # 判斷是否為植物相關
    is_plant = scores["plant"] >= PLANT_THRESHOLD

    return {
        "category": best_category,
        "confidence": best_score,
        "scores": scores,
        "is_plant": is_plant,
        "plant_score": scores["plant"]
    }


def search_plants(query: str, top_k: int = 5):
    """搜尋植物（純 embedding）"""
    if qdrant_client is None:
        print("[API] ⚠️ search_plants: Qdrant 未連線")
        return []  # Qdrant 未連線，返回空結果
        
    try:
        t0 = time.perf_counter()
        query_vector = encode_text(query)
        t1 = time.perf_counter()
        if not isinstance(query_vector, list):
            query_vector = query_vector.tolist()

        # 增加 timeout 處理
        raw_results = qdrant_client.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            limit=top_k,
        ).points
        t2 = time.perf_counter()
        print(f"[API] /search encode={(t1 - t0):.3f}s qdrant={(t2 - t1):.3f}s total={(t2 - t0):.3f}s top_k={top_k} results={len(raw_results)}")
        sys.stdout.flush()

        # 物種層級去重：同一 canonical key 只保留一筆候選（避免同物種重複出現在第一階段列表）
        seen_canonical = set()
        dedup_results = []
        for r in raw_results:
            key = _canonical_name(r.payload or {})
            if not key:
                key = str(r.id)
            if key in seen_canonical:
                continue
            seen_canonical.add(key)
            dedup_results.append(r)
            if len(dedup_results) >= top_k:
                break

        out = [
            {
                "code": r.payload.get("code"),
                "chinese_name": r.payload.get("chinese_name"),
                "scientific_name": r.payload.get("scientific_name"),
                "family": r.payload.get("family"),
                "family_en": r.payload.get("family_en"),
                "genus": r.payload.get("genus"),
                "life_form": r.payload.get("life_form"),
                "score": r.score,
                "summary": r.payload.get("summary", "")[:300],
            }
            for r in dedup_results
        ]
        # 萬用條目輕度降權（與 hybrid 一致），再依分數排序
        apply_generic_top1_penalty(out)
        out.sort(key=lambda x: x["score"], reverse=True)
        return out
    except Exception as e:
        print(f"[API] ❌ search_plants 錯誤: {e}")
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        return []


# SOFT 矛盾規則（只取最嚴重 2 條扣分）
SOFT_RULES = [
    {"id": "S1", "trait": "leaf_arrangement", "conf_min": 0.5, "penalty": 0.20},
    {"id": "S2", "trait": "life_form", "conf_min": 0.6, "penalty": 0.12},
    {"id": "S3", "trait": "leaf_type", "conf_min": 0.7, "penalty": 0.25},
    {"id": "S4", "trait": "flower_color", "conf_min": 0.6, "penalty": 0.18},  # 紫花/粉紅 vs 紅花
]
MAX_SOFT_COUNT = 2

# 花色互斥群組：紫/粉 vs 紅（野牡丹紫花 vs 火筒樹紅花）
FLOWER_COLOR_GROUPS = {
    "purple": "gp", "pink": "gp", "purple_pink": "gp",
    "red": "gr",
    "white": "gw", "yellow": "gy", "orange": "go",
}

# 葉序互斥群組：同群組=一致，不同群組=矛盾
LEAF_ARRANGEMENT_GROUP_IDS = {
    "alternate": "g1",
    "spiral": "g1",
    "opposite": "g2",
    "whorled": "g3",
    "fascicled": "g4",
    "basal": "g5",
}

LIFE_FORM_GROUPS = {
    "herb": ["草本"],
    "herbaceous": ["草本"],
    "annual_herb": ["草本"],
    "perennial_herb": ["草本"],
    "shrub": ["灌木", "亞灌木"],
    "subshrub": ["灌木", "亞灌木"],
    "tree": ["喬木", "小喬木"],
    "small_tree": ["喬木", "小喬木"],
    "vine": ["藤本"],
    "climbing_vine": ["藤本"],
    "aquatic": ["水生", "水生植物"],
}


def _to_str(v):
    if v is None:
        return ""
    if isinstance(v, list):
        return " ".join(str(x) for x in v if x is not None)
    return str(v)


def _get_plant_leaf_arrangement(payload):
    kf = payload.get("key_features") or []
    kf_norm = payload.get("key_features_norm") or []
    text = " ".join(_to_str(x) for x in kf + kf_norm)
    if "對生" in text:
        return "opposite"
    if "輪生" in text:
        return "whorled"
    if "互生" in text or "螺旋" in text:
        return "alternate"
    return None


def _get_plant_life_form_group(payload):
    lf = _to_str(payload.get("life_form", "")).strip()
    if not lf:
        return None
    for en, zh_list in LIFE_FORM_GROUPS.items():
        if any(z in lf for z in zh_list):
            return en
    if "草本" in lf:
        return "herb"
    if "灌木" in lf or "亞灌木" in lf:
        return "shrub"
    if "喬木" in lf:
        return "tree"
    if "藤本" in lf:
        return "vine"
    if "水生" in lf:
        return "aquatic"
    return None


def _get_plant_leaf_type(payload):
    """從 payload 推斷葉型：simple(單葉) 或 compound(複葉)。"""
    raw = payload.get("raw_data") or {}
    ident = raw.get("identification") or {}
    kf = ident.get("key_features") or []
    kf_norm = ident.get("key_features_norm") or []
    text = " ".join(_to_str(x) for x in kf + kf_norm)
    if any(x in text for x in ["羽狀複葉", "掌狀複葉", "掌狀", "三出複", "複葉"]):
        return "compound"
    if any(x in text for x in ["單葉"]):
        return "simple"
    return None


# Gate-A：棕櫚/複葉 gate 關鍵字（query 有則候選需有）
PALM_COMPOUND_QUERY_TOKENS = frozenset({"羽狀複葉", "掌狀複葉", "二回羽狀", "三出複葉", "複葉", "棕櫚"})
# 候選「是否為棕櫚類」：僅用棕櫚特有關鍵字，不含羽狀複葉（銀合歡/豆科也有羽狀複葉）
PALM_SPECIFIC_PLANT_KEYWORDS = ("棕櫚", "棕櫚科", "扇形", "扇形葉", "椰子", "扇葉")


def _plant_has_palm_compound(payload) -> bool:
    """候選植物是否為棕櫚類（棕櫚科/椰子/扇形葉等），非僅有羽狀複葉。"""
    kf = payload.get("key_features") or []
    kf_norm = payload.get("key_features_norm") or []
    summary = _to_str(payload.get("summary", ""))
    text = " ".join(_to_str(x) for x in kf + kf_norm) + " " + summary
    return any(kw in text for kw in PALM_SPECIFIC_PLANT_KEYWORDS)


def _is_bryophyte_pteridophyte(payload) -> bool:
    """候選是否為苔蘚蕨類（與種子植物分開，查詢為灌木/草本/花時強降權）。"""
    cname = (payload.get("chinese_name") or "").strip()
    if cname:
        if cname.endswith("苔") or cname.endswith("蘚") or cname.endswith("蕨"):
            return True
    family = _to_str(payload.get("family", "")).strip()
    if family and ("苔" in family or "蘚" in family or "蕨" in family):
        return True
    summary = _to_str(payload.get("summary", ""))
    kf = payload.get("key_features") or []
    kf_norm = payload.get("key_features_norm") or []
    text = summary + " " + " ".join(_to_str(x) for x in kf + kf_norm)
    if any(kw in text for kw in ("苔綱", "蘚綱", "蕨類", "地錢", "角苔", "真蘚", "泥炭蘚", "孔雀苔", "懸苔", "紫萼苔")):
        return True
    return False


def compute_soft_contradiction_penalty(traits, payload):
    if not traits or not isinstance(traits, dict):
        return []
    penalties = []
    for rule in SOFT_RULES:
        trait_key = rule["trait"]
        conf_min = rule["conf_min"]
        penalty_val = rule["penalty"]
        t = traits.get(trait_key)
        if not t or not isinstance(t, dict):
            continue
        conf = t.get("confidence", 0) or 0
        if conf < conf_min:
            continue
        q_val = (t.get("value") or "").strip().lower()
        if not q_val:
            continue
        if trait_key == "leaf_arrangement":
            q_gid = LEAF_ARRANGEMENT_GROUP_IDS.get(q_val)
            if not q_gid:
                continue
            plant_val = _get_plant_leaf_arrangement(payload)
            if plant_val is None:
                continue
            plant_gid = LEAF_ARRANGEMENT_GROUP_IDS.get(plant_val)
            if not plant_gid:
                continue
            if q_gid == plant_gid:
                continue
            penalties.append((rule["id"], penalty_val))
        elif trait_key == "life_form":
            q_group = LIFE_FORM_GROUPS.get(q_val)
            if not q_group:
                continue
            plant_group = _get_plant_life_form_group(payload)
            if plant_group is None:
                continue
            if q_val == plant_group:
                continue
            plant_zh = LIFE_FORM_GROUPS.get(plant_group, [])
            if set(q_group) & set(plant_zh):
                continue
            penalties.append((rule["id"], penalty_val))
        elif trait_key == "leaf_type":
            plant_lt = _get_plant_leaf_type(payload)
            if plant_lt is None:
                continue
            q_compound = q_val in ("compound", "pinnate", "pinnately_compound", "palmate", "trifoliate")
            plant_compound = plant_lt == "compound"
            if q_compound == plant_compound:
                continue
            penalties.append((rule["id"], penalty_val))
        elif trait_key == "flower_color":
            plant_fc = _get_plant_flower_color(payload)
            if plant_fc is None:
                continue
            q_gid = FLOWER_COLOR_GROUPS.get(q_val) or FLOWER_COLOR_GROUPS.get(q_val.replace(" ", "_"))
            plant_gid = FLOWER_COLOR_GROUPS.get(plant_fc) or FLOWER_COLOR_GROUPS.get(plant_fc.replace(" ", "_"))
            if not q_gid or not plant_gid:
                continue
            if q_gid == plant_gid:
                continue
            # 僅在 query 紫/粉、plant 紅 時懲罰（野牡丹紫花→火筒樹紅花應降權；反向不懲罰，避免 LM 抽錯紅花時懲到正確紫花物種）
            if q_gid == "gp" and plant_gid == "gr":
                penalties.append((rule["id"], penalty_val))
    return sorted(penalties, key=lambda x: -x[1])[:MAX_SOFT_COUNT]


def _get_plant_flower_color(payload) -> str | None:
    """從 payload 推斷花色（英文）。"""
    kf = payload.get("key_features") or []
    kf_norm = payload.get("key_features_norm") or []
    text = " ".join(_to_str(x) for x in kf + kf_norm)
    if "紫花" in text or "紫色" in text:
        return "purple"
    if "粉紅花" in text or "粉紅色" in text:
        return "pink"
    if "紅花" in text or "紅色" in text:
        return "red"
    if "白花" in text or "白色" in text:
        return "white"
    if "黃花" in text or "黃色" in text:
        return "yellow"
    if "橙花" in text or "橙色" in text:
        return "orange"
    return None


def resolve_weights(weights):
    if not weights:
        return EMBEDDING_WEIGHT, FEATURE_WEIGHT

    raw_embedding = weights.get("embedding")
    raw_feature = weights.get("feature")

    if isinstance(raw_embedding, (int, float)) and isinstance(raw_feature, (int, float)):
        total = raw_embedding + raw_feature
        if total > 0:
            embedding = raw_embedding / total
            feature = raw_feature / total
            embedding = max(0.1, min(0.9, embedding))
            feature = max(0.1, min(0.9, feature))
            norm_total = embedding + feature
            embedding /= norm_total
            feature /= norm_total
            return float(embedding), float(feature)

    return EMBEDDING_WEIGHT, FEATURE_WEIGHT


def _normalize_scientific_name(sci: str) -> str:
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


def _canonical_name(payload: dict) -> str:
    """以學名優先建立物種 canonical key，學名缺失時退回中文名+科+屬。"""
    if not isinstance(payload, dict):
        return ""
    sci = (payload.get("scientific_name") or "").strip()
    if sci:
        # 正規化學名（移除變種標記）
        sci_normalized = _normalize_scientific_name(sci)
        if sci_normalized:
            parts = sci_normalized.split()
            if len(parts) >= 2:
                # 只取 genus + species（忽略變種、亞種等）
                return f"{parts[0]} {parts[1]}"
            return sci_normalized
    # Fallback：中文名 + 科 + 屬（正規化：移除空格/標點）
    cname = (payload.get("chinese_name") or "").strip()
    family = (payload.get("family") or "").strip()
    genus = (payload.get("genus") or "").strip()
    # 正規化中文名（移除空格、標點）
    if cname:
        import re
        cname = re.sub(r'[\s\-_]+', '', cname)
    key_parts = [p for p in (cname, family, genus) if p]
    return " | ".join(key_parts)


def hybrid_search(query: str, features: list = None, guess_names: list = None, top_k: int = 5, weights: dict | None = None, traits: dict | None = None):
    """
    混合搜尋：結合 embedding 相似度 + 特徵權重 + 關鍵字匹配

    Args:
        query: 自然語言描述
        features: Vision AI 提取的結構化特徵列表，如 ["羽狀複葉", "互生", "白花"]
        guess_names: Vision AI 猜測的植物名稱，如 ["榕樹", "茄苳"]
        top_k: 返回結果數量

    Returns:
        搜尋結果列表，包含混合分數
    """
    features = features or []
    # 清洗 guess_names（再次保險，Node 端已做初步清洗）
    raw_guess_names = guess_names or []
    guess_names = []
    bad_descriptive = ("例如", "比如", "像是", "這是一株", "這種植物", "整體呈現", "但需要更多", "否向下垂掛", "無法完全確定", "解析度有限", "類似")
    bad_markdown = ("*", "#", "_", "`", "[", "]")
    for name in raw_guess_names:
        if not name:
            continue
        n = str(name).strip()
        if not n:
            continue
        if n.lower() == "unknown":
            continue
        if len(n) < 2 or len(n) > 12:
            continue
        if any(bad in n for bad in bad_descriptive):
            continue
        if any(bad in n for bad in bad_markdown):
            continue
        # 排除阿拉伯文、西里爾文等混合語
        if any("\u0600" <= c <= "\u06FF" or "\u0400" <= c <= "\u04FF" for c in n):
            continue
        guess_names.append(n)
    guess_names = list(dict.fromkeys(guess_names))  # 去重保序
    weights = weights or {}
    embedding_weight = float(weights.get("embedding", EMBEDDING_WEIGHT))
    feature_weight = float(weights.get("feature", FEATURE_WEIGHT))

    # Phase 2：保護性 clamp + 正規化，避免特徵權重過高造成擾亂
    if not features:
        feature_weight = 0.0
        embedding_weight = 1.0
    embedding_weight = max(0.65, min(0.95, embedding_weight))
    feature_weight = max(0.05, min(0.35, feature_weight)) if features else 0.0
    total_w = embedding_weight + feature_weight
    if total_w <= 0:
        embedding_weight, feature_weight = 1.0, 0.0
    else:
        embedding_weight = embedding_weight / total_w
        feature_weight = feature_weight / total_w
    print(f"[API] hybrid_search 入參: query_len={len(query or '')}, features={len(features)}, guess_names={len(guess_names)}, top_k={top_k}, weights=E:{embedding_weight:.2f}/F:{feature_weight:.2f}")
    sys.stdout.flush()

    if qdrant_client is None:
        print(f"[API] hybrid_search 跳過: Qdrant 未連線，回傳空結果")
        sys.stdout.flush()
        return []  # Qdrant 未連線，返回空結果

    # 0. 如果有 guess_names，先進行關鍵字匹配（輔助提高辨識率）
    # 注意：關鍵字匹配只是輔助，主要還是依賴 embedding 和特徵匹配
    keyword_matched_ids = set()
    if guess_names:
        try:
            # 使用 scroll 取得所有資料，然後在記憶體中過濾
            # 這對於小資料集（<10K）是可行的
            # 只執行一次 scroll，然後檢查所有 guess_names
            scroll_result = qdrant_client.scroll(
                collection_name=COLLECTION_NAME,
                limit=10000,  # 假設資料不超過 10K
                with_payload=True,
                with_vectors=False
            )
            
            # 在記憶體中過濾匹配的植物
            for point in scroll_result[0]:
                chinese_name = point.payload.get("chinese_name", "") or ""
                scientific_name = point.payload.get("scientific_name", "") or ""
                
                # 檢查是否匹配任一 guess_name（部分匹配）
                for name in guess_names:
                    if name and name.strip():
                        name_clean = name.strip()
                        # 檢查是否包含該名稱（部分匹配）
                        if name_clean in chinese_name or name_clean in scientific_name:
                            keyword_matched_ids.add(point.id)
                            break  # 匹配到一個就夠了
            
            if keyword_matched_ids:
                print(f"[API] 關鍵字匹配找到 {len(keyword_matched_ids)} 個候選（guess_names: {guess_names}）")
        except Exception as e:
            print(f"[API] 關鍵字匹配失敗: {e}，繼續使用 embedding 搜尋")

    # 1. 先用 embedding 取得候選
    # 🔥 關鍵修復：只使用簡短的 query_text_zh，絕對不要用整段分析文字
    # 如果 query 太長（>200 字），只取前 200 字
    # 如果 query 包含步驟文字（第一步、第二步...），只提取實際描述部分
    search_query = (query or "").strip()
    if not search_query and guess_names:
        search_query = " ".join(str(n).strip() for n in guess_names[:3] if n)
    if not search_query and features:
        search_query = " ".join(str(f).strip() for f in features[:15] if f)
    if not search_query:
        print(f"[API] hybrid_search 警告: query 為空且無 guess_names/features 可兜底，無法 embedding")
        sys.stdout.flush()
        return []

    # 移除步驟文字和不確定語句
    if "第一步" in search_query or "第二步" in search_query or "第三步" in search_query:
        # 嘗試提取實際描述部分（在 <analysis> 標籤內，或去除步驟文字）
        import re
        # 移除所有「第X步：」開頭的行
        lines = search_query.split('\n')
        clean_lines = []
        for line in lines:
            if not re.match(r'^\s*第[一二三四五六七八九十\d]+步[：:]', line):
                if not re.match(r'^\s*\*\*第[一二三四五六七八九十\d]+步', line):
                    clean_lines.append(line)
        search_query = '\n'.join(clean_lines).strip()
    
    # 限制長度（最多 200 字元）
    if len(search_query) > 200:
        search_query = search_query[:200]
    
    # 如果有猜測名稱，加入查詢（但保持簡短）
    if guess_names:
        guess_text = ' '.join(guess_names[:2])  # 最多 2 個名稱
        if len(search_query) + len(guess_text) + 1 <= 200:
            search_query = f"{search_query} {guess_text}"
        else:
            # 如果太長，只保留名稱
            search_query = guess_text[:200]

    t0 = time.perf_counter()
    try:
        query_vector = encode_text(search_query)
    except Exception as e:
        print(f"[API] ❌ hybrid_search encode_text 失敗: {e}")
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        return []
    t1 = time.perf_counter()
    if not isinstance(query_vector, list):
        query_vector = query_vector.tolist()

    # 取更多候選再重新排序
    # 擴大候選池至 100，讓 embedding 排名較後的物種（如風鈴草）也能進入 hybrid 重排
    candidate_limit = max(100, top_k * 10)
    
    try:
        candidates = qdrant_client.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            limit=candidate_limit,
        ).points
    except Exception as e:
        print(f"[API] ❌ hybrid_search Qdrant 查詢錯誤: {e}")
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        return []
    
    if not candidates:
        print(f"[API] hybrid_search 空候選: Qdrant 回傳 0 筆 (query 前 50 字: {search_query[:50]!r})")
        sys.stdout.flush()
        return []
    
    # B. Fruit-only 第二路召回：延遲+高門檻+少量補召回，避免污染候選池
    # 可設 DISABLE_FRUIT_ONLY_RECALL=1 關閉，用於 A/B 測試
    fruit_candidates = []
    disable_fruit = os.environ.get("DISABLE_FRUIT_ONLY_RECALL", "").strip().lower() in ("1", "true", "yes")
    if not disable_fruit and features and FEATURE_INDEX:
        fruit_features = [
            f for f in features
            if (FEATURE_INDEX.get(f) or {}).get("category") in {"fruit_type", "fruit_cluster", "fruit_surface", "calyx_persistent"}
        ]
        # 高門檻：至少 2 個果實特徵才觸發（避免單一漿果誤召）
        if len(fruit_features) >= 2:
            print(f"[API] Fruit-only 召回: Query 含果實特徵 {fruit_features}，啟動第二路召回")
            fruit_query_text = " ".join(fruit_features)
            try:
                fruit_vector = encode_text(fruit_query_text)
                if not isinstance(fruit_vector, list):
                    fruit_vector = fruit_vector.tolist()
                # 少量補召回：20 筆（原 50 易污染候選池）
                fruit_limit = int(os.environ.get("FRUIT_ONLY_LIMIT", "20"))
                fruit_candidates = qdrant_client.query_points(
                    collection_name=COLLECTION_NAME,
                    query=fruit_vector,
                    limit=fruit_limit,
                ).points
                print(f"[API] Fruit-only 召回找到 {len(fruit_candidates)} 個候選")
            except Exception as e:
                print(f"[API] Fruit-only 召回失敗: {e}，繼續使用主路召回")
                fruit_candidates = []
    
    # 合併兩路候選（去重）
    main_count = len(candidates)
    candidate_dict = {}
    for c in candidates:
        key = _canonical_name(c.payload or {}) or str(c.id)
        candidate_dict[key] = c
    
    for c in fruit_candidates:
        key = _canonical_name(c.payload or {}) or str(c.id)
        if key not in candidate_dict:
            candidate_dict[key] = c
        else:
            # 如果已存在，保留 embedding 分數較高的（主路優先）
            existing_score = candidate_dict[key].score
            if c.score > existing_score:
                candidate_dict[key] = c
    
    candidates = list(candidate_dict.values())
    print(f"[API] 合併兩路召回: 主路 {main_count} + Fruit路 {len(fruit_candidates)} = 總計 {len(candidate_dict)} 個候選")

    # 候選池過濾：查詢為種子植物時，直接排除苔蘚蕨類（避免污染 Top1）
    query_has_bryo_fern = bool(search_query and ("苔" in search_query or "蘚" in search_query or "蕨" in search_query))
    query_features_str = " ".join(features or [])
    if not query_has_bryo_fern and ("苔" in query_features_str or "蘚" in query_features_str or "蕨" in query_features_str):
        query_has_bryo_fern = True
    if not query_has_bryo_fern:
        before_count = len(candidates)
        candidates = [c for c in candidates if not _is_bryophyte_pteridophyte(c.payload or {})]
        removed = before_count - len(candidates)
        if removed > 0:
            print(f"[API] 候選池過濾: 查詢為種子植物，排除 {removed} 筆苔蘚蕨類候選，剩 {len(candidates)} 筆")

    t2 = time.perf_counter()
    print(f"[API] /hybrid-search encode={(t1 - t0):.3f}s qdrant={(t2 - t1):.3f}s total={(t2 - t0):.3f}s top_k={top_k} limit={candidate_limit} candidates={len(candidates)}")
    sys.stdout.flush()

    # 預先計算 query 特徵總權重（用於 feature_score 標準化：matched/query_total 拉開差距）
    query_total_weight = 0.0
    if features and feature_calculator:
        fi = feature_calculator.calculate_feature_score(features)
        query_total_weight = fi.get("total_score", 0) or 0
        if query_total_weight > 0:
            print(f"[API] feature_score 標準化: query_total_weight={query_total_weight:.4f}")

    # A. 動態權重：根據 Query 特徵的「鑑別力」調整 feature_weight
    # 強特徵（高鑑別力）：flower_shape, flower_color（特別是紫花、粉紅花）, fruit_cluster, fruit_surface, calyx_persistent, compound_leaf, trichome
    STRONG_DISCRIMINATIVE_CATEGORIES = frozenset({
        "flower_shape", "flower_position", "inflorescence_orientation",
        "flower_color",  # 花色（特別是紫花、粉紅花）對野牡丹等植物鑑別力高
        "fruit_type", "fruit_cluster", "fruit_surface", "calyx_persistent",
        "leaf_type",  # 複葉類型（羽狀/掌狀）鑑別力高
        "trunk_root", "special", "surface_hair"
    })
    # 弱特徵（通用）：life_form, leaf_arrangement, leaf_margin, flower_inflo（容易誤判）
    WEAK_GENERIC_CATEGORIES = frozenset({
        "life_form", "leaf_arrangement", "leaf_margin", "flower_inflo"
    })
    
    # 統計 Query 中強/弱特徵的數量
    strong_count = 0
    weak_count = 0
    if features and FEATURE_INDEX:
        for f in features:
            cat = (FEATURE_INDEX.get(f) or {}).get("category")
            if cat in STRONG_DISCRIMINATIVE_CATEGORIES:
                strong_count += 1
            elif cat in WEAK_GENERIC_CATEGORIES:
                weak_count += 1
    
    # 固定權重：不以強/弱特徵動態提升 feature，避免特徵主導排序（寧可 RAG 少出手）
    effective_feature_weight = feature_weight
    if weak_count >= 3 and strong_count == 0:
        effective_feature_weight = min(feature_weight, 0.18)
        print(f"[API] 弱特徵 Gate: Query 只有通用特徵（{weak_count} 個），feature 權重壓低為 {effective_feature_weight:.2f}")
    else:
        print(f"[API] 權重固定 E:{embedding_weight:.2f}/F:{effective_feature_weight:.2f}（強特徵 {strong_count}、弱特徵 {weak_count}）")

    # 2. 計算每個候選的混合分數（先在物種層級去重，再排序）
    results = []
    scored_candidates = []
    seen_canonical = set()
    
    def _is_non_species(payload) -> bool:
        """排除科名/屬名/書名等非物種條目（如 蕁麻科 (施炳霖著)、桑科 (林志忠著)、XX屬）"""
        import re
        cname = (payload.get("chinese_name") or "").strip()
        if not cname:
            return False
        if "著)" in cname or cname.endswith("著)"):
            return True
        if re.search(r"科\s*\([^)]*著", cname) or re.search(r"屬\s*\([^)]*著", cname):
            return True
        if re.search(r"[科屬]\s*\([^)]*著\s*\)\s*$", cname):
            return True
        # 科/屬結尾或單獨出現 → 非物種
        if cname.endswith("科") or cname.endswith("屬"):
            return True
        if re.match(r"^[^\s]+\s*科\s*$", cname) or re.match(r"^[^\s]+\s*屬\s*$", cname):
            return True
        return False

    for r in candidates:
        if _is_non_species(r.payload or {}):
            continue
        key = _canonical_name(r.payload or {})
        if not key:
            key = str(r.id)
        if key in seen_canonical:
            continue
        seen_canonical.add(key)
        embedding_score = r.score  # 0~1
        
        # 關鍵字匹配加分
        keyword_bonus = 0.0
        if r.id in keyword_matched_ids:
            keyword_bonus = KEYWORD_BONUS_WEIGHT
            print(f"[API] 關鍵字匹配: {r.payload.get('chinese_name', '未知')} (id={r.id}, bonus={keyword_bonus})")

        # 計算特徵匹配分數
        feature_score = 0.0
        matched_features = []
        coverage = 1.0
        must_matched = True
        match_result = {}

        if features and feature_calculator:
            # ... (特徵提取代碼省略，保持不變) ...
            # 取得植物的 trait_tokens（優先使用）
            plant_trait_tokens = r.payload.get("trait_tokens", [])
            if not plant_trait_tokens:
                try:
                    from pathlib import Path
                    tokenizer_path = Path(__file__).parent / "trait_tokenizer.py"
                    if tokenizer_path.exists():
                        from trait_tokenizer import key_features_to_trait_tokens
                        key_features = r.payload.get("key_features", [])
                        if key_features and isinstance(key_features, list):
                            plant_trait_tokens = key_features_to_trait_tokens(key_features)
                except (ImportError, Exception):
                    plant_trait_tokens = []
            
            # 取得正規化後的 key_features_norm（D. 只保留合法 FEATURE_VOCAB，避免亂碼導致匹配失真）
            plant_key_features_norm = r.payload.get("key_features_norm", [])
            if plant_key_features_norm and FEATURE_INDEX:
                plant_key_features_norm = [
                    x for x in plant_key_features_norm
                    if isinstance(x, str) and x.strip() and x in FEATURE_INDEX and "\ufffd" not in x
                ]
            if not plant_key_features_norm:
                try:
                    from pathlib import Path
                    normalize_path = Path(__file__).parent / "normalize_features.py"
                    if normalize_path.exists():
                        from normalize_features import normalize_features
                        key_features = r.payload.get("key_features", [])
                        if key_features and isinstance(key_features, list):
                            plant_key_features_norm = normalize_features(key_features)
                except (ImportError, Exception):
                    plant_key_features_norm = []
            
            # 取得植物的描述文字（payload 欄位可能為 str 或 list，統一轉成 str）
            def _to_str(v):
                if v is None:
                    return ""
                if isinstance(v, list):
                    return " ".join(str(x) for x in v if x is not None)
                return str(v)

            key_features = r.payload.get("key_features", [])
            key_features_text = ""
            if key_features:
                if isinstance(key_features, list):
                    key_features_text = " ".join([str(kf) for kf in key_features])
                else:
                    key_features_text = str(key_features)

            # 納入 raw_data 的 morphology（苔蘚類等 payload 無 morphology 時，raw 含 全緣/鋸齒 等）
            raw = r.payload.get("raw_data") or {}
            raw_morph = _to_str(raw.get("raw_data", {}).get("morphology", ""))
            ident = raw.get("identification", {})
            ident_morph = _to_str(ident.get("morphology", []))
            ident_summary = _to_str(ident.get("summary", ""))

            plant_text = " ".join(filter(None, [
                _to_str(r.payload.get("summary")),
                _to_str(r.payload.get("life_form")),
                _to_str(r.payload.get("morphology")),
                key_features_text,
                raw_morph,
                ident_morph,
                ident_summary,
            ]))

            # 計算特徵匹配
            match_result = feature_calculator.match_plant_features(
                features, 
                plant_text=plant_text, 
                plant_trait_tokens=plant_trait_tokens,
                plant_key_features_norm=plant_key_features_norm
            )
            feature_score_raw = match_result["match_score"]
            matched_features = [f["name"] for f in match_result["matched_features"]]
            missing_features = [f["name"] for f in match_result.get("missing_features", [])]
            coverage = match_result.get("coverage", 1.0)
            must_matched = match_result.get("must_matched", True)
            
            # Feature score 標準化：matched / query_total 拉開差距（0~1）
            if query_total_weight > 0:
                feature_score = min(1.0, feature_score_raw / query_total_weight)
            else:
                feature_score = feature_score_raw * coverage
            
            # 🔥 防飽和機制：當 Query traits 太少時，feature_score 上限封頂
            # 避免「3 個特徵就滿分」導致錯誤候選霸榜（如馬纓丹 case 中水漆 100%）
            if features:
                trait_count = len(features)
                # 如果 traits < 4，feature_score 上限遞減
                if trait_count < 4:
                    max_feature_score = 0.55 + (trait_count - 1) * 0.15  # 1個→0.55, 2個→0.70, 3個→0.85
                    if feature_score > max_feature_score:
                        feature_score = max_feature_score
                        print(f"[API] 防飽和: Query 只有 {trait_count} 個特徵，feature_score 封頂為 {max_feature_score:.2f}")
                elif trait_count == 4:
                    # 4 個特徵時，上限為 0.90
                    if feature_score > 0.90:
                        feature_score = 0.90
                # 5 個以上特徵時，允許達到 1.0
        else:
            feature_score = 0.0
            coverage = 0.0
            must_matched = True
            matched_features = []
            match_result = {}

        # 暫存結果，稍後進行過濾和排序
        hard_reject = match_result.get("hard_reject", False)
        scored_candidates.append({
            "point": r,
            "embedding_score": embedding_score,
            "feature_score": feature_score,
            "keyword_bonus": keyword_bonus,
            "coverage": coverage,
            "must_matched": must_matched,
            "hard_reject": hard_reject,
            "match_result": match_result,
            "matched_features": matched_features,
            "plant_name": r.payload.get("chinese_name", "未知"),
            "scientific_name": r.payload.get("scientific_name", "")
        })

    # Must Gate 硬淘汰：排除強區辨特徵完全不匹配的候選
    before_gate = len(scored_candidates)
    final_candidates = [c for c in scored_candidates if not c.get("hard_reject")]
    rejected = before_gate - len(final_candidates)
    if rejected > 0:
        print(f"[API] Must Gate 硬淘汰: 排除 {rejected} 個候選（強特徵完全不匹配），剩 {len(final_candidates)} 個")

    # B. 高 embedding 時維持固定權重，不再提高 feature 比例（設計：embedding 為主）
    max_emb = max((c["embedding_score"] for c in final_candidates), default=0)
    if max_emb >= 0.75:
        print(f"[API] 高 embedding 候選 max_emb={max_emb:.2f}，維持 E:{embedding_weight:.2f}/F:{effective_feature_weight:.2f}")

    # 過度通用物種懲罰：匹配特徵數遠高於中位數者（資料寫太雜、百科型）略降權，避免霸榜
    matched_counts = [len(c.get("matched_features") or []) for c in final_candidates]
    median_matched = sorted(matched_counts)[len(matched_counts) // 2] if matched_counts else 0

    # 計算最終分數並排序
    for c in final_candidates:
        r = c["point"]
        embedding_score = c["embedding_score"]
        feature_score = c["feature_score"]
        keyword_bonus = c["keyword_bonus"]
        match_result = c["match_result"]
        
        # 純 Gate 模式：以 embedding 為基準，不做任何正向加分
        # 設計目標：寧可少出手，也不要把錯的物種推到 Top1
        hybrid_score = embedding_score
        
        # 應用 Must Gate 懲罰（軟性降權，而非過濾）
        # 如果關鍵特徵不匹配，分數打折，但仍然保留在列表中
        if not c["must_matched"]:
            # 🔥 關鍵修復：加重懲罰，從 0.5 (5折) 改為 0.3 (3折)
            # 這樣可以避免喬木因為 Embedding 相似而排在正確草本（但 Embedding 稍低）的前面
            # 但仍保留「完全找不到時，至少給個結果」的退路
            MUST_GATE_PENALTY = 0.3
            hybrid_score *= MUST_GATE_PENALTY
            # 僅在分數較高時顯示日誌，避免刷屏
            if hybrid_score > 0.4:
                print(f"[API] ⚠️ Must Gate 懲罰: {c['plant_name']} - 關鍵特徵不匹配，分數大幅降權 (x0.3)")

        # Gate-A：棕櫚/複葉 gate（query 有複葉/棕櫚則候選需有，否則降權）
        query_has_palm_compound = (
            (features and any(f in PALM_COMPOUND_QUERY_TOKENS for f in features))
            or ("棕櫚" in (query or ""))
        )
        gate_triggered = query_has_palm_compound
        has_palm = _plant_has_palm_compound(r.payload)
        before_score = hybrid_score
        # P1: 動態強度 - 羽狀複葉+棕櫚 用 0.25，其他強複葉 0.35，泛用 0.6
        STRONG_PALM_TOKENS = frozenset({"羽狀複葉", "掌狀複葉", "二回羽狀", "三出複葉"})
        has_strong = bool(features and any(f in STRONG_PALM_TOKENS for f in features))
        has_palm_in_query = bool(features and "棕櫚" in features)
        if has_strong and has_palm_in_query:
            gate_penalty = 0.25  # 黃椰子等：query 明確有羽狀複葉+棕櫚，非棕櫚候選重罰
        elif has_strong:
            gate_penalty = 0.35
        else:
            gate_penalty = 0.6
        if gate_triggered and not has_palm:
            hybrid_score *= gate_penalty
        if gate_triggered:
            print(f"[API] Gate-A debug {c['plant_name']}: has_palm={has_palm} penalty={gate_penalty} before={before_score:.4f} after={hybrid_score:.4f}")
        if gate_triggered and not has_palm and hybrid_score > 0.3:
            print(f"[API] Gate-A 棕櫚/複葉降權: {c['plant_name']} - 無複葉/棕櫚描述 (x{gate_penalty})")

        # Gate-A 逆邏輯：query 無棕櫚/複葉證據時，棕櫚候選重罰（避免鳥尾花/九重葛/迷迭香等一直被棕樹霸榜）
        if not query_has_palm_compound and has_palm:
            hybrid_score *= 0.18
            if hybrid_score > 0.2:
                print(f"[API] Gate-A 逆：{c['plant_name']} - 查詢無棕櫚/複葉，棕櫚候選降權 (x0.18)")

        # SOFT 矛盾重罰：life_form / leaf_arrangement / flower_color 不一致時扣分（取最嚴重 2 條）
        if traits:
            soft_penalties = compute_soft_contradiction_penalty(traits, r.payload)
            if soft_penalties:
                total_penalty = sum(p for _, p in soft_penalties)
                hybrid_score = max(0.0, hybrid_score - total_penalty)
                if hybrid_score > 0.2:
                    print(f"[API] SOFT 矛盾懲罰: {c['plant_name']} - {[rid for rid, _ in soft_penalties]}, 共扣 {total_penalty:.2f}")

        # 蕨苔蘚 vs 種子植物 Gate：查詢為種子植物（灌木/草本/花/喬木）時，苔蘚蕨類強降權，分開大類避免誤匹配
        query_has_bryo_fern = bool(query and ("苔" in query or "蘚" in query or "蕨" in query))
        query_features_str = " ".join(features or [])
        if not query_has_bryo_fern and ("苔" in query_features_str or "蘚" in query_features_str or "蕨" in query_features_str):
            query_has_bryo_fern = True
        if not query_has_bryo_fern and _is_bryophyte_pteridophyte(r.payload):
            hybrid_score *= 0.06
            if hybrid_score > 0.15:
                print(f"[API] 蕨苔蘚 Gate: {c['plant_name']} - 查詢為種子植物，苔蘚蕨類強降權 (x0.06)")

        # 資料品質降權：低品質筆（缺乏描述、推測等）乘 quality_score
        qs = r.payload.get("quality_score")
        if qs is not None and isinstance(qs, (int, float)) and 0 < qs < 1:
            hybrid_score *= qs

        # 過度通用物種懲罰：匹配數遠高於中位數（百科型條目）略降權，打掉青皮木式霸榜
        n_matched = len(c.get("matched_features") or [])
        if median_matched and n_matched > max(median_matched * 2, 6):
            hybrid_score *= 0.95
            if hybrid_score > 0.3:
                print(f"[API] 過度通用懲罰: {c['plant_name']} - 匹配數 {n_matched} > 2*中位數 {median_matched} (x0.95)")
        
        # 確保分數不超過 1.0
        hybrid_score = min(1.0, hybrid_score)
        
        # 記錄結果
        results.append({
            "code": r.payload.get("code"),
            "chinese_name": r.payload.get("chinese_name"),
            "scientific_name": r.payload.get("scientific_name"),
            "family": r.payload.get("family"),
            "family_en": r.payload.get("family_en"),
            "genus": r.payload.get("genus"),
            "life_form": r.payload.get("life_form"),
            "score": hybrid_score,
            "embedding_score": embedding_score,
            "feature_score": feature_score,
            "coverage": c["coverage"],
            "must_matched": c["must_matched"],
            "matched_features": c["matched_features"],
            "summary": r.payload.get("summary", "")[:300],
        })

    # 萬用條目輕度降權：常錯當 Top1 的物種 ×0.88，減少霸榜、讓正解有機會超前
    apply_generic_top1_penalty(results)

    # 4. 按混合分數重新排序
    results.sort(key=lambda x: x["score"], reverse=True)
    
    # 記錄最終結果（Top K）
    print(f"\n[API] 🔍 混合搜尋結果（Top {top_k}）：")
    for i, result in enumerate(results[:top_k], 1):
        plant_name = result.get("chinese_name", "未知")
        scientific_name = result.get("scientific_name", "")
        score = result.get("score", 0.0)
        embedding_score = result.get("embedding_score", 0.0)
        feature_score = result.get("feature_score", 0.0)
        matched_features = result.get("matched_features", [])
        print(f"  {i}. {plant_name}" + (f" ({scientific_name})" if scientific_name else "") + f" - 總分={score:.3f} (embedding={embedding_score:.3f}, feature={feature_score:.3f}), 匹配特徵={matched_features}")
    print()  # 空行分隔
    sys.stdout.flush()

    return results[:top_k]


def smart_search(query: str, top_k: int = 5):
    """
    智慧搜尋：先分類，只有植物相關才搜尋
    """
    classification = classify_query(query)

    result = {
        "query": query,
        "classification": classification,
        "results": []
    }

    if classification["is_plant"]:
        result["results"] = search_plants(query, top_k)
        result["message"] = f"識別為植物相關查詢 (信心度: {classification['plant_score']:.2f})"
    else:
        result["message"] = f"非植物相關查詢，識別為: {classification['category']} (信心度: {classification['confidence']:.2f})"

    return result


class RequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            # 檢查 embedding 是否可用（本地模型或 Jina API）
            embedding_ready = model is not None or (USE_JINA_API and JINA_API_KEY)

            self._send_json({
                "ok": True,
                "status": "ok",
                "model": EMBEDDING_MODEL,
                "use_jina_api": USE_JINA_API,
                "jina_api_configured": JINA_API_KEY is not None,
                "model_loaded": model is not None,
                "qdrant_connected": qdrant_client is not None,
                "qdrant_url": QDRANT_URL,
                "ready": embedding_ready and qdrant_client is not None
            })

        elif parsed.path == "/stats":
            # 回傳 Qdrant collection 狀態，確認向量索引是否真的建好了
            if qdrant_client is None:
                self._send_json({
                    "ok": False,
                    "error": "Qdrant not connected",
                    "collection": COLLECTION_NAME,
                    "qdrant_url": QDRANT_URL,
                }, 503)
                return

            try:
                info = qdrant_client.get_collection(collection_name=COLLECTION_NAME)
                count = qdrant_client.count(collection_name=COLLECTION_NAME, exact=True)

                # vectors 設定資訊（不同版本的 qdrant_client 可能結構稍不同，這裡做保守處理）
                vectors_cfg = getattr(info, "config", None)
                vectors_cfg = getattr(vectors_cfg, "params", None) if vectors_cfg else None
                vectors_cfg = getattr(vectors_cfg, "vectors", None) if vectors_cfg else None

                self._send_json({
                    "ok": True,
                    "collection": COLLECTION_NAME,
                    "points_count": getattr(count, "count", None),
                    "vectors_config": str(vectors_cfg) if vectors_cfg is not None else None,
                    "qdrant_url": QDRANT_URL,
                })
            except Exception as e:
                self._send_json({
                    "ok": False,
                    "error": str(e),
                    "collection": COLLECTION_NAME,
                    "qdrant_url": QDRANT_URL,
                }, 500)

        elif parsed.path == "/vision-prompt":
            # 取得 Vision AI 用的結構化 Prompt
            self._send_json({
                "prompt": get_vision_prompt(),
                "feature_vocab": list(FEATURE_INDEX.keys())
            })

        elif parsed.path == "/search":
            params = parse_qs(parsed.query)
            query = params.get("q", [""])[0]
            top_k = int(params.get("top_k", [5])[0])
            smart = params.get("smart", ["true"])[0].lower() == "true"

            if not query:
                self._send_json({"error": "Missing query parameter 'q'"}, 400)
                return

            if smart:
                result = smart_search(query, top_k)
            else:
                result = {"query": query, "results": search_plants(query, top_k)}

            self._send_json(result)

        elif parsed.path == "/classify":
            params = parse_qs(parsed.query)
            query = params.get("q", [""])[0]

            if not query:
                self._send_json({"error": "Missing query parameter 'q'"}, 400)
                return

            result = classify_query(query)
            result["query"] = query
            self._send_json(result)

        else:
            self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")

        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON"}, 400)
            return

        if parsed.path == "/search":
            query = data.get("query", "")
            top_k = data.get("top_k", 5)
            smart = data.get("smart", True)

            if not query:
                self._send_json({"error": "Missing 'query' field"}, 400)
                return

            if smart:
                result = smart_search(query, top_k)
            else:
                result = {"query": query, "results": search_plants(query, top_k)}

            self._send_json(result)

        elif parsed.path == "/classify":
            query = data.get("query", "")

            if not query:
                self._send_json({"error": "Missing 'query' field"}, 400)
                return

            result = classify_query(query)
            result["query"] = query
            self._send_json(result)

        elif parsed.path == "/hybrid-search":
            # 混合搜尋：結合 embedding + 特徵權重
            query = data.get("query", "")
            features = data.get("features", []) or []
            guess_names = data.get("guess_names", []) or []
            top_k = data.get("top_k", 5)
            requested_weights = data.get("weights")
            embedding_weight, feature_weight = resolve_weights(requested_weights)
            print(f"[API] POST /hybrid-search 收到: query_len={len(query) if query else 0}, features={len(features)}, guess_names={len(guess_names)}, top_k={top_k}")
            sys.stdout.flush()

            if not query and not features and not guess_names:
                print(f"[API] POST /hybrid-search 400: 缺少 query/features/guess_names (body keys: {list(data.keys())})")
                sys.stdout.flush()
                self._send_json({"error": "Missing 'query', 'features', or 'guess_names'"}, 400)
                return

            # 計算特徵總分（用於信心度）與混合搜尋；任何例外都回傳 500 避免連線 EOF
            feature_info = None
            try:
                if features and feature_calculator:
                    feature_info = feature_calculator.calculate_feature_score(features)

                traits = data.get("traits")
                results = hybrid_search(
                    query=query or " ".join(guess_names),
                    features=features,
                    guess_names=guess_names,
                    top_k=top_k,
                    weights={
                        "embedding": embedding_weight,
                        "feature": feature_weight
                    },
                    traits=traits
                )

                self._send_json({
                    "query": query,
                    "features": features,
                    "guess_names": guess_names,
                    "feature_info": feature_info,
                    "results": results,
                    "weights": {
                        "embedding": embedding_weight,
                        "feature": feature_weight
                    }
                })
            except Exception as e:
                print(f"[API] POST /hybrid-search 500: {e}")
                import traceback
                traceback.print_exc()
                sys.stdout.flush()
                self._send_json({
                    "error": str(e),
                    "query": query,
                    "features": features,
                    "guess_names": guess_names,
                    "feature_info": feature_info,
                    "results": [],
                    "weights": {"embedding": embedding_weight, "feature": feature_weight}
                }, 500)

        else:
            self._send_json({"error": "Not found"}, 404)

    def log_message(self, format, *args):
        # Zeabur 會頻繁打 health check，避免日誌刷屏讓人誤以為「無限循環」
        try:
            if getattr(self, "path", "").startswith("/health"):
                return
        except Exception:
            pass
        print(f"[API] {args[0]}")


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """多執行緒 HTTP 服務，避免單一請求卡住或崩潰導致其他連線 EOF"""
    pass


def main():
    try:
        init()

        server = ThreadedHTTPServer(("0.0.0.0", API_PORT), RequestHandler)
        print(f"\n🌿 植物向量搜尋 API 啟動")
        print(f"   http://localhost:{API_PORT}")
        print(f"\n端點：")
        print(f"   GET  /health")
        print(f"   GET  /vision-prompt          - 取得 Vision AI 結構化 Prompt")
        print(f"   GET  /classify?q=紅色的花")
        print(f"   GET  /search?q=紅色的花&top_k=5&smart=true")
        print(f"   POST /search       {{\"query\": \"...\", \"top_k\": 5, \"smart\": true}}")
        print(f"   POST /classify     {{\"query\": \"...\"}}")
        print(f"   POST /hybrid-search {{\"query\": \"...\", \"features\": [...], \"guess_names\": [...]}}")
        print(f"\nEmbedding 方式: {'Jina AI API' if USE_JINA_API else '本地模型'}")
        print(f"混合搜尋權重: embedding={EMBEDDING_WEIGHT}, feature={FEATURE_WEIGHT}")
        print(f"植物判斷閾值: {PLANT_THRESHOLD}")
        print(f"\n按 Ctrl+C 停止...")
        sys.stdout.flush()

        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n停止服務")
            server.shutdown()

    except Exception as e:
        print(f"❌ 致命錯誤: {e}")
        import traceback
        traceback.print_exc()
        sys.stdout.flush()

        # 保持容器運行，不要退出
        print("\n⚠️  服務發生錯誤，但保持運行以便檢查日誌")
        print("   容器將保持運行狀態...")
        sys.stdout.flush()

        import time
        while True:
            time.sleep(60)


if __name__ == "__main__":
    main()
