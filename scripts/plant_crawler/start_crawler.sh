#!/bin/bash
# 穩定運行爬蟲的啟動腳本

cd /home/user/gpstask/scripts/plant_crawler

# 清理舊日誌
rm -f crawler.log nohup.out

# 使用 nohup 在後台運行，並將輸出重定向
nohup python -u background_crawler.py 1.5 > nohup.out 2>&1 &

# 獲取進程 ID
PID=$!
echo "爬蟲已啟動，進程 ID: $PID"
echo $PID > crawler.pid

# 等待幾秒確認啟動
sleep 5

# 檢查進程狀態
if ps -p $PID > /dev/null; then
    echo "✅ 爬蟲正在運行中"
    echo "📊 查看進度: tail -f crawler.log"
    echo "📄 查看輸出: tail -f nohup.out"
    echo "🛑 停止爬蟲: kill $PID"
else
    echo "❌ 爬蟲啟動失敗"
    cat nohup.out
fi
