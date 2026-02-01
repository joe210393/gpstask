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
ARG FORCE_REBUILD=2025-02-01-clean-v3

# 優先複製 clean 資料檔案（包含 morphology_summary_zh、trait_tokens 和正規化特徵）
# 注意：Zeabur 的構建上下文是專案根目錄
# 如果 clean 不存在，則使用 enhanced（向後兼容）
# 注意：COPY 指令會失敗如果檔案不存在，所以我們先複製 enhanced（因為我們已經替換了它）
COPY scripts/rag/data/plants-forest-gov-tw-enhanced.jsonl /app/data/plants-forest-gov-tw-enhanced.jsonl
# 如果 clean 檔案存在，也複製它（優先使用）
COPY scripts/rag/data/plants-forest-gov-tw-clean.jsonl /app/data/plants-forest-gov-tw-clean.jsonl

# 也複製原始資料作為備用（如果 enhanced 不存在時使用）
COPY scripts/rag/data/plants-forest-gov-tw.jsonl /app/data/plants-forest-gov-tw.jsonl

# 立即確認資料檔案已複製（優先檢查 clean，然後 enhanced）
RUN if [ -f /app/data/plants-forest-gov-tw-clean.jsonl ]; then \
        ls -lh /app/data/plants-forest-gov-tw-clean.jsonl && echo "✅ Clean 資料檔案已複製"; \
    else \
        ls -lh /app/data/plants-forest-gov-tw-enhanced.jsonl && echo "✅ Enhanced 資料檔案已複製" || \
        (echo "❌ 錯誤：資料檔案不存在！COPY 指令可能失敗" && \
         echo "   請檢查構建日誌中的 COPY 錯誤訊息" && \
         echo "   構建上下文應該是專案根目錄" && \
         exit 1); \
    fi

# 再次確認刪除舊檔案（防止從其他來源複製）
RUN rm -f /app/data/plants-enriched.jsonl && \
    ls -lh /app/data/ && \
    echo "✅ 確認資料檔案：enhanced 和原始資料都已複製"

# 不預先下載本地模型：本服務預期使用 Jina API（USE_JINA_API=true + JINA_API_KEY）

EXPOSE 8080

CMD ["python", "start_api.py"]
