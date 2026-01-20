#!/bin/bash
# 进度监控脚本

LOG_FILE="smart_discovery.log"
PROGRESS_FILE="all_plant_codes_progress.txt"

echo "📊 编码发现进度监控"
echo "===================="
echo ""

# 检查进程是否在运行
if ps aux | grep -q "[s]mart_discovery.py"; then
    echo "✅ 状态: 正在运行"
else
    echo "⚠️  状态: 未运行"
fi

echo ""

# 显示已发现的编码数量
if [ -f "$PROGRESS_FILE" ]; then
    COUNT=$(wc -l < "$PROGRESS_FILE")
    echo "✅ 已发现编码: $COUNT 个"
else
    echo "⏳ 还未生成进度文件"
fi

echo ""

# 显示最新日志（最后30行）
echo "📝 最新日志:"
echo "--------------------"
if [ -f "$LOG_FILE" ]; then
    tail -30 "$LOG_FILE"
else
    echo "⚠️  日志文件不存在"
fi

echo ""
echo "===================="
echo "💡 提示: 定期运行此脚本查看进度"
echo "   bash monitor_progress.sh"
