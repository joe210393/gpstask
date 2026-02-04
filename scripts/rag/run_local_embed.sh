#!/bin/bash
# 本機向量化腳本
# 使用方式：從專案根目錄執行
#   ./scripts/rag/run_local_embed.sh
# 或：
#   bash scripts/rag/run_local_embed.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VEC_DIR="$SCRIPT_DIR/vectordb"

# 若有 .venv 則使用其 Python（確保使用已安裝 sentence_transformers 的環境）
if [ -f "$PROJECT_ROOT/.venv/bin/python" ]; then
  PYTHON="$PROJECT_ROOT/.venv/bin/python"
elif [ -f "$PROJECT_ROOT/.venv/bin/python3" ]; then
  PYTHON="$PROJECT_ROOT/.venv/bin/python3"
else
  PYTHON="python3"
fi

# 檢查環境變數
export USE_JINA_API="${USE_JINA_API:-false}"
if [ "$USE_JINA_API" = "true" ]; then
  if [ -z "$JINA_API_KEY" ]; then
    echo "❌ 請設定 JINA_API_KEY（或設 USE_JINA_API=false 使用本機模型）"
    echo "   export JINA_API_KEY='your_jina_api_key'"
    exit 1
  fi
else
  echo "✅ 使用本機模型（不需 JINA_API_KEY）"
fi

if [ -z "$QDRANT_URL" ]; then
  export QDRANT_URL="http://localhost:6333"
  echo "📌 使用本機 Qdrant: $QDRANT_URL（請先執行 ./scripts/rag/run_local_qdrant.sh）"
fi

if [ -z "$QDRANT_API_KEY" ]; then
  echo "📌 本機 Qdrant 不需 API Key"
fi

echo "🔗 Qdrant: $QDRANT_URL"
if [ "$USE_JINA_API" = "true" ]; then
  echo "🔑 Jina API: 已設定"
else
  echo "🧠 本機模型: ${EMBEDDING_MODEL:-jinaai/jina-embeddings-v3}"
fi
echo ""
echo "開始本機向量化..."
"$PYTHON" "$VEC_DIR/embed_plants_forest_jina.py"
