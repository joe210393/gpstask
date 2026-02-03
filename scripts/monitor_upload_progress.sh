#!/bin/bash
# Qdrant 上傳進度即時監控

LOG_FILE="/tmp/qdrant_reset_v2.log"
TOTAL_BATCHES=269
TARGET_COUNT=4302

# 顏色定義
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 清除螢幕
clear

echo "════════════════════════════════════════════════════════════════"
echo "           🌿 Qdrant 資料上傳即時監控"
echo "════════════════════════════════════════════════════════════════"
echo ""

# 持續監控
while true; do
    # 移動游標到第 5 行開始更新
    tput cup 4 0

    # 檢查日誌檔案是否存在
    if [ ! -f "$LOG_FILE" ]; then
        echo -e "${RED}❌ 日誌檔案不存在: $LOG_FILE${NC}"
        echo ""
        echo "請先執行上傳腳本"
        sleep 2
        continue
    fi

    # 提取最新進度
    latest_line=$(grep "上傳進度:" "$LOG_FILE" | tail -1)

    if [ -z "$latest_line" ]; then
        echo -e "${YELLOW}⏳ 等待上傳開始...${NC}"
        echo ""
        sleep 2
        continue
    fi

    # 解析進度百分比和批次資訊
    # 格式: 上傳進度:  XX%|███| 123/269 [time<time, speed]
    percent=$(echo "$latest_line" | grep -oP '\d+(?=%)' | head -1)
    current=$(echo "$latest_line" | grep -oP '\d+(?=/269)' | tail -1)

    if [ -z "$percent" ] || [ -z "$current" ]; then
        echo -e "${YELLOW}⏳ 解析進度中...${NC}"
        echo ""
        sleep 2
        continue
    fi

    # 計算已上傳筆數
    uploaded=$((current * 16))
    if [ $uploaded -gt $TARGET_COUNT ]; then
        uploaded=$TARGET_COUNT
    fi

    # 繪製進度條
    bar_length=50
    filled=$((percent * bar_length / 100))
    empty=$((bar_length - filled))

    bar=$(printf "${GREEN}%${filled}s${NC}" | tr ' ' '█')
    bar="${bar}$(printf "%${empty}s" | tr ' ' '░')"

    # 顯示資訊
    echo -e "📊 ${BLUE}總進度${NC}"
    echo -e "   [$bar] ${GREEN}${percent}%${NC}"
    echo ""
    echo -e "📦 ${BLUE}批次進度${NC}"
    echo -e "   當前批次: ${GREEN}${current}${NC} / ${TOTAL_BATCHES}"
    echo -e "   剩餘批次: $((TOTAL_BATCHES - current))"
    echo ""
    echo -e "🌿 ${BLUE}資料筆數${NC}"
    echo -e "   已上傳: ${GREEN}${uploaded}${NC} / ${TARGET_COUNT} 筆"
    echo -e "   剩餘: $((TARGET_COUNT - uploaded)) 筆"
    echo ""

    # 預估剩餘時間（假設每批次 9 秒）
    remaining_batches=$((TOTAL_BATCHES - current))
    remaining_seconds=$((remaining_batches * 9))
    remaining_minutes=$((remaining_seconds / 60))

    if [ $remaining_minutes -gt 0 ]; then
        echo -e "⏱️  ${BLUE}預估剩餘時間${NC}: ~${remaining_minutes} 分鐘"
    else
        echo -e "⏱️  ${BLUE}預估剩餘時間${NC}: < 1 分鐘"
    fi
    echo ""

    # 檢查是否完成
    if [ "$percent" -eq 100 ] || [ "$current" -eq "$TOTAL_BATCHES" ]; then
        echo ""
        echo "════════════════════════════════════════════════════════════════"
        echo -e "           ${GREEN}✅ 上傳完成！${NC}"
        echo "════════════════════════════════════════════════════════════════"
        echo ""
        echo "請執行驗證："
        echo "  python3 scripts/verify_qdrant.py"
        echo ""
        break
    fi

    # 檢查錯誤
    error_count=$(grep -c "❌ 錯誤:" "$LOG_FILE")
    if [ $error_count -gt 0 ]; then
        echo -e "${RED}⚠️  檢測到 ${error_count} 個錯誤${NC}"
        echo "   請檢查日誌: tail -50 $LOG_FILE"
        echo ""
    fi

    # 顯示最新日誌
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📋 最新活動 (按 Ctrl+C 退出監控)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    tail -3 "$LOG_FILE" | grep -v "^$"
    echo ""

    # 每 3 秒更新一次
    sleep 3
done
