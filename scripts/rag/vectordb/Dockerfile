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

# 建立資料目錄並複製資料檔案（用於特徵權重計算，實際搜尋使用 Qdrant）
RUN mkdir -p /app/data
# 先刪除可能存在的舊檔案
RUN rm -f /app/data/plants-enriched.jsonl
# 複製新資料檔案
COPY scripts/rag/data/plants-forest-gov-tw.jsonl /app/data/plants-forest-gov-tw.jsonl
# 再次確認刪除舊檔案（防止從其他來源複製）
RUN rm -f /app/data/plants-enriched.jsonl && \
    ls -lh /app/data/ && \
    echo "✅ 確認只保留新檔案"

# 不預先下載本地模型：本服務預期使用 Jina API（USE_JINA_API=true + JINA_API_KEY）

EXPOSE 8080

CMD ["python", "start_api.py"]
