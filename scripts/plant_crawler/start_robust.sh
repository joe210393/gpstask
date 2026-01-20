#!/bin/bash
# 稳健爬虫启动脚本 - 防止系统睡眠

cd /home/user/gpstask/scripts/plant_crawler

echo "🚀 准备启动稳健爬虫..."
echo ""

# 检测操作系统
OS=$(uname -s)

# 清理旧日志
if [ -f "plant_data/crawler.log" ]; then
    echo "📝 归档旧日志..."
    mv plant_data/crawler.log "plant_data/crawler_$(date +%Y%m%d_%H%M%S).log"
fi

# 根据操作系统选择防睡眠方法
case "$OS" in
    Linux*)
        echo "🐧 检测到 Linux 系统"
        # 检查是否有 systemd-inhibit
        if command -v systemd-inhibit &> /dev/null; then
            echo "✅ 使用 systemd-inhibit 防止系统睡眠"
            systemd-inhibit --what=idle:sleep --who="Plant Crawler" --why="正在爬取植物数据" \
                python3 -u robust_crawler.py 1.5
        # 检查是否有 caffeinate (某些Linux发行版)
        elif command -v caffeinate &> /dev/null; then
            echo "✅ 使用 caffeinate 防止系统睡眠"
            caffeinate -i python3 -u robust_crawler.py 1.5
        else
            echo "⚠️  未找到防睡眠工具，直接运行"
            echo "💡 建议手动设置：系统设置 > 电源 > 关闭自动睡眠"
            python3 -u robust_crawler.py 1.5
        fi
        ;;
    Darwin*)
        echo "🍎 检测到 macOS 系统"
        echo "✅ 使用 caffeinate 防止系统睡眠"
        caffeinate -i python3 -u robust_crawler.py 1.5
        ;;
    CYGWIN*|MINGW*|MSYS*)
        echo "🪟 检测到 Windows 系统"
        echo "💡 建议手动设置：控制面板 > 电源选项 > 睡眠设为'从不'"
        python -u robust_crawler.py 1.5
        ;;
    *)
        echo "❓ 未知操作系统: $OS"
        echo "直接运行爬虫..."
        python3 -u robust_crawler.py 1.5
        ;;
esac

echo ""
echo "✅ 爬虫执行完成！"
