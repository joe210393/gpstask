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
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

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
USE_JINA_API = (_use_jina_env == "true") or (_use_jina_env == "auto" and bool(JINA_API_KEY))
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
            timeout=120
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
                timeout=120
            )

# 分類閾值
PLANT_THRESHOLD = 0.68  # 與「植物」相似度超過此值才認為是植物查詢

# 全域變數（啟動時載入）
model = None
qdrant_client = None
category_embeddings = None  # 預計算的類別向量
feature_calculator = None  # 特徵權重計算器

# 混合評分權重
EMBEDDING_WEIGHT = 0.6  # embedding 相似度權重
FEATURE_WEIGHT = 0.4    # 特徵匹配權重


def encode_text(text):
    """
    編碼文字為向量，根據設定選擇使用本地模型或 Jina API

    Args:
        text: 單一文字字串或文字列表

    Returns:
        numpy array 或 list of numpy arrays
    """
    if USE_JINA_API and JINA_API_KEY:
        # 使用 Jina API
        import requests

        is_batch = isinstance(text, list)
        texts = text if is_batch else [text]

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

            embeddings = [item["embedding"] for item in data["data"]]

            if is_batch:
                return [np.array(emb) for emb in embeddings]
            else:
                return np.array(embeddings[0])

        except Exception as e:
            print(f"⚠️ Jina API 錯誤: {e}")
            sys.stdout.flush()
            # 如果 API 失敗，嘗試使用本地模型（如果可用）
            if model:
                return model.encode(text)
            else:
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
    except Exception as e:
        print(f"  ⚠️ Qdrant 連線失敗: {e}")
        print(f"    應用將繼續運行，但搜尋功能不可用")
        qdrant_client = None
    sys.stdout.flush()

    # 3. 載入 embedding 模型（如果不使用 Jina API）
    if USE_JINA_API and JINA_API_KEY:
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
    possible_paths = [
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-enriched.jsonl"),
        os.path.join(os.path.dirname(__file__), "data", "plants-enriched.jsonl"),
        "/app/data/plants-enriched.jsonl",
    ]
    data_path = None
    for path in possible_paths:
        if os.path.exists(path):
            data_path = path
            break

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
    if model or (USE_JINA_API and JINA_API_KEY):
        try:
            print("  計算類別向量...")
            sys.stdout.flush()
            categories = {
                "plant": ["植物", "花", "樹", "草", "葉子", "果實"],
                "animal": ["動物", "鳥", "魚", "蟲", "獸"],
                "artifact": ["建築", "房子", "車", "機器", "工具"],
                "food": ["食物", "料理", "菜", "飲料"],
                "other": ["風景", "天氣", "地形", "山", "河"]
            }
            category_embeddings = {}
            for cat, keywords in categories.items():
                print(f"    處理類別: {cat}")
                sys.stdout.flush()
                embeddings = encode_text(keywords)
                # SentenceTransformer.encode(list) 會回傳 np.ndarray (N, D)
                # Jina API 的 encode_text(list) 會回傳 list[np.ndarray] (N 個 D 向量)
                if isinstance(embeddings, np.ndarray):
                    embeddings_array = embeddings  # (N, D) 或 (D,)
                elif isinstance(embeddings, list):
                    # list[np.ndarray] 或 list[list[float]] 或 list[np.ndarray(D,)]
                    embeddings_array = np.array(embeddings)
                else:
                    embeddings_array = np.array([embeddings])

                # 確保是 (N, D)
                if embeddings_array.ndim == 1:
                    embeddings_array = embeddings_array.reshape(1, -1)

                # 類別向量要是 (D,)
                category_embeddings[cat] = np.mean(embeddings_array, axis=0)
            print("  ✅ 類別向量計算完成")
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

    query_vector = encode_text(query)
    if not isinstance(query_vector, list):
        query_vector = query_vector.tolist()

    results = qdrant_client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=top_k,
    ).points

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
    混合搜尋：結合 embedding 相似度 + 特徵權重

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

    # 1. 先用 embedding 取得候選
    # 如果有猜測名稱，加入查詢
    search_query = query
    if guess_names:
        search_query = f"{query} {' '.join(guess_names)}"

    query_vector = encode_text(search_query)
    if not isinstance(query_vector, list):
        query_vector = query_vector.tolist()

    # 取更多候選再重新排序
    candidates = qdrant_client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=top_k * 3,  # 取 3 倍候選
    ).points

    # 2. 計算每個候選的混合分數
    results = []
    for r in candidates:
        embedding_score = r.score  # 0~1

        # 計算特徵匹配分數
        feature_score = 0.0
        matched_features = []

        if features and feature_calculator:
            # 取得植物的描述文字（處理 None 值）
            plant_text = " ".join(filter(None, [
                r.payload.get("summary") or "",
                r.payload.get("life_form") or "",
                r.payload.get("morphology") or "",
            ]))

            # 計算特徵匹配
            match_result = feature_calculator.match_plant_features(features, plant_text)
            feature_score = match_result["match_score"]
            matched_features = [f["name"] for f in match_result["matched_features"]]

        # 3. 計算混合分數
        # 如果沒有特徵，純用 embedding
        if features:
            hybrid_score = (EMBEDDING_WEIGHT * embedding_score) + (FEATURE_WEIGHT * feature_score)
        else:
            hybrid_score = embedding_score

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
            "matched_features": matched_features,
            "summary": r.payload.get("summary", "")[:300],
        })

    # 4. 按混合分數重新排序
    results.sort(key=lambda x: x["score"], reverse=True)

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
