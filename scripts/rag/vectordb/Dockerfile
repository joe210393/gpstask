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

# 不預先下載本地模型：本服務預期使用 Jina API（USE_JINA_API=true + JINA_API_KEY）

EXPOSE 8080

CMD ["python", "start_api.py"]
