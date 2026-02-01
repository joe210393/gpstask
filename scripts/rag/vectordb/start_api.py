#!/usr/bin/env python3
"""
植物向量搜尋 API 服務
提供 REST API 給 Node.js server 呼叫

功能：
1. 自動判斷查詢類型（植物/動物/人造物/其他）
2. 只有植物相關查詢才進行 RAG 搜尋

啟動方式：
  python start_api.py

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
JINA_API_KEY = os.environ.get("JINA_API_KEY", None)  # Jina AI API Key
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

# 混合評分權重
EMBEDDING_WEIGHT = 0.6  # embedding 相似度權重
FEATURE_WEIGHT = 0.4    # 特徵匹配權重
KEYWORD_BONUS_WEIGHT = 0.1  # 關鍵字匹配加分權重（較小，避免過度偏向名稱匹配）


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
            
            # Jina API 返回 1024 維，本地模型可能是 768 維
            expected_dim = 1024 if USE_JINA_API else 768
            
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
    # 優先使用 enhanced 資料檔案（包含 morphology_summary_zh 和 trait_tokens）
    enhanced_paths = [
        "/app/data/plants-forest-gov-tw-enhanced.jsonl",  # Docker 容器中的路徑（優先）
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
    # 先搜尋 enhanced 檔案
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
    print("🌿 植物向量搜尋 API")
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
        return []  # Qdrant 未連線，返回空結果
    t0 = time.perf_counter()
    query_vector = encode_text(query)
    t1 = time.perf_counter()
    if not isinstance(query_vector, list):
        query_vector = query_vector.tolist()

    results = qdrant_client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=top_k,
    ).points
    t2 = time.perf_counter()
    print(f"[API] /search encode={(t1 - t0):.3f}s qdrant={(t2 - t1):.3f}s total={(t2 - t0):.3f}s top_k={top_k}")
    sys.stdout.flush()

    return [
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
        for r in results
    ]


def hybrid_search(query: str, features: list = None, guess_names: list = None, top_k: int = 5):
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
    if qdrant_client is None:
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
    # 如果有猜測名稱，加入查詢
    search_query = query
    if guess_names:
        search_query = f"{query} {' '.join(guess_names)}"

    t0 = time.perf_counter()
    query_vector = encode_text(search_query)
    t1 = time.perf_counter()
    if not isinstance(query_vector, list):
        query_vector = query_vector.tolist()

    # 取更多候選再重新排序
    candidates = qdrant_client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=top_k * 3,  # 取 3 倍候選
    ).points
    t2 = time.perf_counter()
    print(f"[API] /hybrid-search encode={(t1 - t0):.3f}s qdrant={(t2 - t1):.3f}s total={(t2 - t0):.3f}s top_k={top_k} features={len(features or [])} guess_names={len(guess_names or [])}")
    sys.stdout.flush()

    # 2. 計算每個候選的混合分數
    results = []
    for r in candidates:
        embedding_score = r.score  # 0~1
        
        # 關鍵字匹配加分（如果 guess_names 匹配到 chinese_name 或 scientific_name）
        # 注意：這只是輔助加分，不會過度影響整體匹配結果
        keyword_bonus = 0.0
        if r.id in keyword_matched_ids:
            keyword_bonus = KEYWORD_BONUS_WEIGHT  # 關鍵字匹配給予較小的加分（0.1），避免過度偏向名稱匹配
            print(f"[API] 關鍵字匹配: {r.payload.get('chinese_name', '未知')} (id={r.id}, bonus={keyword_bonus})")

        # 計算特徵匹配分數（改進版：使用 trait_tokens）
        feature_score = 0.0
        matched_features = []
        coverage = 1.0
        must_matched = True

        if features and feature_calculator:
            # 取得植物的 trait_tokens（優先使用）
            plant_trait_tokens = r.payload.get("trait_tokens", [])
            if not plant_trait_tokens:
                # 如果沒有 trait_tokens，從 key_features 生成（階段一：向後兼容）
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
            
            # 取得植物的描述文字（備用，如果沒有 trait_tokens 才用）
            key_features = r.payload.get("key_features", [])
            key_features_text = ""
            if key_features:
                if isinstance(key_features, list):
                    key_features_text = " ".join([str(kf) for kf in key_features])
                else:
                    key_features_text = str(key_features)
            
            plant_text = " ".join(filter(None, [
                r.payload.get("summary") or "",
                r.payload.get("life_form") or "",
                r.payload.get("morphology") or "",
                key_features_text,
            ]))

            # 計算特徵匹配（使用 trait_tokens 優先）
            match_result = feature_calculator.match_plant_features(
                features, 
                plant_text=plant_text, 
                plant_trait_tokens=plant_trait_tokens
            )
            feature_score_raw = match_result["match_score"]
            matched_features = [f["name"] for f in match_result["matched_features"]]
            coverage = match_result.get("coverage", 1.0)
            must_matched = match_result.get("must_matched", True)
            
            # 應用 Coverage 調整
            feature_score = feature_score_raw * coverage

        # 3. 計算混合分數（加入 Coverage 和 Must Gate）
        if features:
            # 基礎分數：加權平均
            base_score = (EMBEDDING_WEIGHT * embedding_score) + (FEATURE_WEIGHT * feature_score)
            
            # 增強分數：如果 embedding 和 feature 都匹配，使用乘法增強
            enhancement = embedding_score * feature_score * 0.3  # 增強係數 0.3
            
            # 基礎混合分數
            hybrid_score = base_score + enhancement + keyword_bonus
            
            # Must Gate：如果關鍵特徵（life_form、leaf_arrangement）不匹配，降權
            if not must_matched:
                hybrid_score *= 0.65  # 降權 35%
                print(f"[API] Must Gate 觸發: {r.payload.get('chinese_name', '未知')} - 關鍵特徵不匹配，分數降權")
            
            # 確保分數不超過 1.0
            hybrid_score = min(1.0, hybrid_score)
        else:
            hybrid_score = embedding_score + keyword_bonus

        # 記錄詳細資訊（用於調試）- 顯示所有候選植物
        plant_name = r.payload.get("chinese_name", "未知")
        scientific_name = r.payload.get("scientific_name", "")
        print(f"[API] 候選植物 {len(results)+1}: {plant_name}" + (f" ({scientific_name})" if scientific_name else "") + f" - embedding={embedding_score:.3f}, feature={feature_score:.3f}, coverage={coverage:.2f}, must_matched={must_matched}, hybrid={hybrid_score:.3f}, matched_features={matched_features}")
        sys.stdout.flush()
        
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
            "coverage": coverage,
            "must_matched": must_matched,
            "matched_features": matched_features,
            "summary": r.payload.get("summary", "")[:300],
        })

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
            features = data.get("features", [])  # Vision AI 提取的特徵
            guess_names = data.get("guess_names", [])  # Vision AI 猜測的名稱
            top_k = data.get("top_k", 5)

            if not query and not features and not guess_names:
                self._send_json({"error": "Missing 'query', 'features', or 'guess_names'"}, 400)
                return

            # 計算特徵總分（用於信心度）
            feature_info = None
            if features and feature_calculator:
                feature_info = feature_calculator.calculate_feature_score(features)

            # 執行混合搜尋
            results = hybrid_search(
                query=query or " ".join(guess_names),
                features=features,
                guess_names=guess_names,
                top_k=top_k
            )

            self._send_json({
                "query": query,
                "features": features,
                "guess_names": guess_names,
                "feature_info": feature_info,
                "results": results,
                "weights": {
                    "embedding": EMBEDDING_WEIGHT,
                    "feature": FEATURE_WEIGHT
                }
            })

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


def main():
    try:
        init()

        server = HTTPServer(("0.0.0.0", API_PORT), RequestHandler)
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
