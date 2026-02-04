#!/bin/bash
# 重置本機 Qdrant：停止容器、清除儲存、重新啟動
# 用於 P0 整庫重建時，避免 delete_collection API 的 500 錯誤
# 使用方式：./scripts/rag/reset_local_qdrant.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STORAGE_DIR="${SCRIPT_DIR}/qdrant_storage"
CONTAINER_NAME="gps-task-qdrant-local"

echo "🔄 重置本機 Qdrant..."

# 停止並移除容器
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "  停止並移除容器..."
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
fi

# 清除儲存
if [ -d "$STORAGE_DIR" ]; then
  echo "  清除儲存目錄..."
  rm -rf "${STORAGE_DIR:?}"/*
fi

# 重新啟動
echo "  重新啟動 Qdrant..."
mkdir -p "$STORAGE_DIR"
docker run -d \
  --name "$CONTAINER_NAME" \
  -p 6333:6333 \
  -p 6334:6334 \
  -v "${STORAGE_DIR}:/qdrant/storage" \
  qdrant/qdrant

echo "✅ 重置完成"
echo "   接下來執行: rm -f scripts/rag/vectordb/embed_plants_forest_jina_progress.json"
echo "            ./scripts/rag/run_local_embed.sh"
echo "   （不需 FORCE_RECREATE，collection 已清空）"
