FROM python:3.11-slim
LABEL "language"="python"

WORKDIR /app

# 安裝依賴
COPY scripts/rag/vectordb/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 複製程式碼
COPY scripts/rag/vectordb/start_api.py .
COPY scripts/rag/vectordb/search_plants.py .
COPY scripts/rag/vectordb/feature_weights.py .
# 複製 Trait Tokens 相關檔案（階段一和階段二改進）
COPY scripts/rag/vectordb/trait_tokenizer.py .
COPY scripts/rag/vectordb/trait_vocab.json .
# 複製特徵正規化相關檔案
COPY scripts/rag/vectordb/normalize_features.py .

# 建立資料目錄並複製資料檔案（用於特徵權重計算，實際搜尋使用 Qdrant）
RUN mkdir -p /app/data

# 先刪除可能存在的舊檔案（強制清除，避免快取問題）
RUN rm -rf /app/data/*.jsonl || true

# 添加 ARG 強制重新執行 COPY（避免構建快取問題）
ARG FORCE_REBUILD=2025-02-02-no-gate-v1

# 複製資料檔案（embed/start_api 會優先使用 clean 若存在）
COPY scripts/rag/data/plants-forest-gov-tw-final-4302.jsonl /app/data/plants-forest-gov-tw-final-4302.jsonl
# P0：若已執行 npm run clean:plant-data 並提交 clean.jsonl，可取消下行註解
# COPY scripts/rag/data/plants-forest-gov-tw-clean.jsonl /app/data/plants-forest-gov-tw-clean.jsonl

RUN ls -lh /app/data/*.jsonl 2>/dev/null || true && echo "✅ 資料檔案已複製"

# 不預先下載本地模型：本服務預期使用 Jina API（USE_JINA_API=true + JINA_API_KEY）

EXPOSE 8080

CMD ["python", "start_api.py"]
