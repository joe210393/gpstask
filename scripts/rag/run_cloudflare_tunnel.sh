#!/bin/bash
# Cloudflare Tunnel 啟動腳本 - 暴露本機 embedding-api 給 Zeabur 呼叫
# 使用方式：
#   1. 安裝 cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
#   2. ./scripts/rag/run_cloudflare_tunnel.sh
# 執行後會顯示一個公開 URL，將此 URL 設為 Zeabur 的 EMBEDDING_API_URL

set -e
PORT="${1:-8080}"

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
