#!/bin/bash
# 本機 embedding-api (start_api.py) 啟動腳本
# 使用方式：從專案根目錄執行
#   ./scripts/rag/run_local_embedding_api.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VEC_DIR="$SCRIPT_DIR/vectordb"

# 預設本機 Qdrant
export QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
export PORT="${PORT:-8080}"
export USE_JINA_API="${USE_JINA_API:-true}"

if [ "$USE_JINA_API" = "true" ]; then
  if [ -z "$JINA_API_KEY" ]; then
    echo "❌ 請設定 JINA_API_KEY（或設 USE_JINA_API=false 使用本機模型）"
    echo "   export JINA_API_KEY='your_jina_api_key'"
    exit 1
  fi
else
  echo "✅ 使用本機模型（不需 JINA_API_KEY）"
fi

# 本機 Qdrant 不需 API Key
export QDRANT_API_KEY="${QDRANT_API_KEY:-}"

echo "🔗 Qdrant: $QDRANT_URL"
echo "🔑 Jina API: 已設定"
echo "🌐 Port: $PORT"
echo ""
echo "啟動 embedding-api（Ctrl+C 停止）..."
cd "$VEC_DIR" && python3 start_api.py
