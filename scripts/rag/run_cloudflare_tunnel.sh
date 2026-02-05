#!/bin/bash
# Cloudflare Tunnel 啟動腳本 - 暴露本機 embedding-api 給 Zeabur 呼叫
# 使用方式：
#   1. 先啟動 Embedding API：./scripts/rag/run_local_embedding_api.sh（另開 terminal）
#   2. 安裝 cloudflared: brew install cloudflared
#   3. ./scripts/rag/run_cloudflare_tunnel.sh
# 執行後會顯示公開 URL，將此 URL 設為 Zeabur 的 EMBEDDING_API_URL

set -e
# start_api.py 預設 8100，與 run_local_embedding_api.sh 保持一致
PORT="${1:-8100}"

# 啟動前檢查：本機 Embedding API 必須先跑在該 port
if ! curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q "200"; then
  echo "❌ localhost:$PORT 無服務回應（Embedding API 未啟動）"
  echo "   請先執行：./scripts/rag/run_local_embedding_api.sh"
  echo "   確認有「背景初始化完成」後，再執行此腳本"
  exit 1
fi
echo "✅ localhost:$PORT Embedding API 可連線，開始建立 tunnel..."

if ! command -v cloudflared &> /dev/null; then
  echo "❌ 請先安裝 cloudflared"
  echo "   macOS: brew install cloudflared"
  echo "   或至 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

echo "🚇 啟動 Cloudflare Tunnel，暴露 localhost:$PORT"
echo "   取得 URL 後，在 Zeabur 設定 EMBEDDING_API_URL 為該 URL"
echo ""
cloudflared tunnel --url "http://localhost:$PORT"
