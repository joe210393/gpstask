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
import json
import numpy as np
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from feature_weights import FeatureWeightCalculator, get_vision_prompt, FEATURE_INDEX

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", None)  # Zeabur Qdrant API Key
COLLECTION_NAME = "taiwan_plants"
EMBEDDING_MODEL = "jinaai/jina-embeddings-v3"
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


def init():
    """初始化模型和連接"""
    global model, qdrant_client, category_embeddings, feature_calculator

    print(f"連接 Qdrant: {QDRANT_URL}")
    if QDRANT_API_KEY:
        print("  API Key 已設定")

    try:
        qdrant_client = get_qdrant_client()
        # 測試連線
        collections = qdrant_client.get_collections()
        print(f"  ✅ Qdrant 連線成功，共 {len(collections.collections)} 個 collections")
    except Exception as e:
        print(f"  ⚠️ Qdrant 連線失敗: {e}")
        print(f"  QDRANT_URL={QDRANT_URL}")
        print(f"  應用將繼續運行，但搜尋功能不可用")
        qdrant_client = None  # 設為 None，讓應用繼續運行

    print(f"載入 embedding 模型: {EMBEDDING_MODEL}")
    model = SentenceTransformer(EMBEDDING_MODEL, trust_remote_code=True)

    # 載入特徵權重計算器
    print("載入特徵權重計算器...")
    import os.path
    # 檢查多個可能的資料路徑 (本地開發 vs Docker 部署)
    possible_paths = [
        os.path.join(os.path.dirname(__file__), "..", "data", "plants-enriched.jsonl"),  # 本地開發
        os.path.join(os.path.dirname(__file__), "data", "plants-enriched.jsonl"),  # Docker 同層目錄
        "/app/data/plants-enriched.jsonl",  # Docker 絕對路徑
    ]
    data_path = None
    for path in possible_paths:
        if os.path.exists(path):
            data_path = path
            break

    if data_path:
        print(f"  資料檔: {data_path}")
        feature_calculator = FeatureWeightCalculator(data_path)
    else:
        print(f"警告: 找不到資料檔，使用預設權重")
        feature_calculator = FeatureWeightCalculator()

    # 預計算類別向量
    print("計算類別向量...")
    categories = {
        "plant": [
            "植物", "花", "樹", "草", "葉子", "果實", "種子", "樹木", "灌木", "藤蔓",
            "蕨類", "苔蘚", "藻類", "植物特徵", "開花植物", "園藝植物", "野生植物",
            "plant", "flower", "tree", "leaf", "fruit", "botanical"
        ],
        "animal": [
            "動物", "鳥", "魚", "蟲", "獸", "哺乳類", "爬蟲類", "兩棲類", "昆蟲",
            "野生動物", "寵物", "海洋生物", "animal", "bird", "fish", "insect"
        ],
        "artifact": [
            "建築", "房子", "車", "機器", "工具", "家具", "電器", "人造物",
            "建築物", "橋", "道路", "雕像", "藝術品", "building", "machine", "tool"
        ],
        "food": [
            "食物", "料理", "菜", "飲料", "水果", "蔬菜", "肉類", "甜點",
            "food", "dish", "cuisine", "meal"
        ],
        "other": [
            "風景", "天氣", "地形", "山", "河", "海", "天空", "雲",
            "landscape", "weather", "nature", "geography"
        ]
    }

    category_embeddings = {}
    for cat, keywords in categories.items():
        embeddings = model.encode(keywords)
        # 取平均作為類別向量
        category_embeddings[cat] = np.mean(embeddings, axis=0)

    print("✅ 初始化完成")


def classify_query(query: str) -> dict:
    """
    分類查詢類型
    返回: { "category": "plant/animal/artifact/food/other", "confidence": 0.xx, "is_plant": true/false }
    """
    query_vector = model.encode(query)

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

    query_vector = model.encode(query).tolist()

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

    query_vector = model.encode(search_query).tolist()

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
            self._send_json({
                "status": "ok",
                "model": EMBEDDING_MODEL,
                "qdrant_connected": qdrant_client is not None,
                "qdrant_url": QDRANT_URL
            })

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
        print(f"[API] {args[0]}")


def main():
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
    print(f"\n混合搜尋權重: embedding={EMBEDDING_WEIGHT}, feature={FEATURE_WEIGHT}")
    print(f"植物判斷閾值: {PLANT_THRESHOLD}")
    print(f"\n按 Ctrl+C 停止...")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止服務")
        server.shutdown()


if __name__ == "__main__":
    main()
