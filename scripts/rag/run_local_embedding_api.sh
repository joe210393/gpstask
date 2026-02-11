#!/bin/bash
# 本機 embedding-api (start_api.py) 啟動腳本
# 使用方式：從專案根目錄執行
#   ./scripts/rag/run_local_embedding_api.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VEC_DIR="$SCRIPT_DIR/vectordb"
# 優先使用專案 .venv-rag（本機模型需 sentence-transformers）
PYTHON="${PROJECT_ROOT}/.venv-rag/bin/python3"
[ -x "$PYTHON" ] || PYTHON="python3"

# 預設本機 Qdrant
export QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
export PORT="${PORT:-8100}"
# 預設改為本機模型（你也可以在外面 export USE_JINA_API=true 改回走 Jina API）
export USE_JINA_API="${USE_JINA_API:-false}"
# 使用你指定的本機 embedding 模型（若外面已 export EMBEDDING_MODEL，就用外面的）
export EMBEDDING_MODEL="${EMBEDDING_MODEL:-jinaai/jina-embeddings-v3}"
# 特徵權重計算資料檔（若外面已 export FEATURE_DATA_PATH，就用外面的）
export FEATURE_DATA_PATH="${FEATURE_DATA_PATH:-${PROJECT_ROOT}/scripts/rag/data/plants-forest-gov-tw-enriched-embed-dedup.taxonomy-v2.jsonl}"

if [ "$USE_JINA_API" = "true" ]; then
  if [ -z "$JINA_API_KEY" ]; then
    echo "❌ 請設定 JINA_API_KEY（或設 USE_JINA_API=false 使用本機模型）"
    echo "   export JINA_API_KEY='your_jina_api_key'"
    exit 1
  fi
else
  echo "✅ 使用本機模型（不需 JINA_API_KEY）"
  REQ="$SCRIPT_DIR/vectordb/requirements.txt"
  if [ -f "$REQ" ]; then
    if ! "$PYTHON" -c "import sentence_transformers" 2>/dev/null; then
      echo "⚠️ 請先安裝依賴："
      echo "   $PYTHON -m pip install -r scripts/rag/vectordb/requirements.txt"
      exit 1
    fi
  fi
fi

# 本機 Qdrant 不需 API Key
export QDRANT_API_KEY="${QDRANT_API_KEY:-}"

echo "🔗 Qdrant: $QDRANT_URL"
if [ "$USE_JINA_API" = "true" ]; then
  echo "🔑 模式: 使用 Jina API (EMBEDDING_MODEL=${EMBEDDING_MODEL})"
else
  echo "🧠 模式: 本機 embedding 模型 (EMBEDDING_MODEL=${EMBEDDING_MODEL})"
fi
echo "📄 FEATURE_DATA_PATH: ${FEATURE_DATA_PATH:-[未設定]}"
echo "🌐 Port: $PORT"
echo ""
echo "啟動 embedding-api（Ctrl+C 停止）..."
cd "$VEC_DIR" && "$PYTHON" start_api.py
