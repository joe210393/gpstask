FROM python:3.11-slim
LABEL "language"="python"

WORKDIR /app

# 安裝依賴
COPY scripts/rag/vectordb/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 複製程式碼
COPY scripts/rag/vectordb/start_api.py .
COPY scripts/rag/vectordb/search_plants.py .
COPY scripts/rag/vectordb/embed_plants.py .
COPY scripts/rag/vectordb/feature_weights.py .

# 建立資料目錄並複製資料檔案
RUN mkdir -p /app/data
COPY scripts/rag/data/plants-enriched.jsonl /app/data/plants-enriched.jsonl

# 預先下載模型（build 時下載，避免啟動時下載）
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('jinaai/jina-embeddings-v3', trust_remote_code=True)"

EXPOSE 8080

CMD ["python", "start_api.py"]
