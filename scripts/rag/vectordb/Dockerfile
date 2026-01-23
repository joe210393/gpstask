# Embedding API 服務 Dockerfile
# 用於部署到 Zeabur 或其他平台
#
# 建置方式（從 scripts/rag 目錄）：
#   docker build -f vectordb/Dockerfile -t embedding-api .
#
# 或從 vectordb 目錄：
#   docker build -t embedding-api --build-context data=../data .

FROM python:3.11-slim

WORKDIR /app

# 安裝依賴
COPY vectordb/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 複製程式碼
COPY vectordb/start_api.py .
COPY vectordb/search_plants.py .
COPY vectordb/embed_plants.py .
COPY vectordb/feature_weights.py .

# 建立資料目錄並複製資料檔案
RUN mkdir -p /app/data
COPY data/plants-enriched.jsonl /app/data/plants-enriched.jsonl

# 預先下載模型（build 時下載，避免啟動時下載）
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('jinaai/jina-embeddings-v3', trust_remote_code=True)"

# 環境變數（會被 Zeabur 環境變數覆蓋）
ENV QDRANT_URL=http://qdrant:6333
ENV QDRANT_API_KEY=
ENV EMBEDDING_API_PORT=8100

EXPOSE 8100

CMD ["python", "start_api.py"]
