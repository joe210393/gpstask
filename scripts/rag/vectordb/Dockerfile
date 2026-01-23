# Embedding API 服務 Dockerfile
# 用於部署到 Zeabur 或其他平台

FROM python:3.11-slim

WORKDIR /app

# 安裝依賴
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製程式碼
COPY start_api.py .
COPY search_plants.py .
COPY embed_plants.py .

# 預先下載模型（build 時下載，避免啟動時下載）
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('jinaai/jina-embeddings-v3', trust_remote_code=True)"

# 環境變數
ENV QDRANT_URL=http://qdrant:6333
ENV EMBEDDING_API_PORT=8100

EXPOSE 8100

CMD ["python", "start_api.py"]
