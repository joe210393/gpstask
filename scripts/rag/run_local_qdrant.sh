#!/bin/bash
# 本機 Qdrant 啟動腳本
# 使用方式：從專案根目錄執行 ./scripts/rag/run_local_qdrant.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STORAGE_DIR="${SCRIPT_DIR}/qdrant_storage"
CONTAINER_NAME="gps-task-qdrant-local"

mkdir -p "$STORAGE_DIR"

# 檢查是否已運行
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "✅ Qdrant 已在運行 (${CONTAINER_NAME})"
  echo "   http://localhost:6333"
  exit 0
fi

# 若存在但已停止，先移除
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
fi

echo "🚀 啟動本機 Qdrant..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p 6333:6333 \
  -p 6334:6334 \
  -v "${STORAGE_DIR}:/qdrant/storage" \
  qdrant/qdrant

echo "✅ Qdrant 已啟動"
echo "   http://localhost:6333"
echo "   資料儲存: $STORAGE_DIR"
