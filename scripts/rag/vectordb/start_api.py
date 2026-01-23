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

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
COLLECTION_NAME = "taiwan_plants"
EMBEDDING_MODEL = "jinaai/jina-embeddings-v3"
API_PORT = int(os.environ.get("EMBEDDING_API_PORT", "8100"))

# 分類閾值
PLANT_THRESHOLD = 0.68  # 與「植物」相似度超過此值才認為是植物查詢

# 全域變數（啟動時載入）
model = None
qdrant_client = None
category_embeddings = None  # 預計算的類別向量


def init():
    """初始化模型和連接"""
    global model, qdrant_client, category_embeddings

    print(f"連接 Qdrant: {QDRANT_URL}")
    qdrant_client = QdrantClient(url=QDRANT_URL)

    print(f"載入 embedding 模型: {EMBEDDING_MODEL}")
    model = SentenceTransformer(EMBEDDING_MODEL, trust_remote_code=True)

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
    """搜尋植物"""
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
            self._send_json({"status": "ok", "model": EMBEDDING_MODEL})

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
    print(f"   GET  /classify?q=紅色的花")
    print(f"   GET  /search?q=紅色的花&top_k=5&smart=true")
    print(f"   POST /search  {{\"query\": \"...\", \"top_k\": 5, \"smart\": true}}")
    print(f"   POST /classify {{\"query\": \"...\"}}")
    print(f"\n智慧搜尋會先判斷是否為植物，只有植物才搜尋 RAG")
    print(f"植物判斷閾值: {PLANT_THRESHOLD}")
    print(f"\n按 Ctrl+C 停止...")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止服務")
        server.shutdown()


if __name__ == "__main__":
    main()
