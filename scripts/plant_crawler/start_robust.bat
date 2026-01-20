@echo off
REM Windows 批处理脚本 - 稳健爬虫启动

cd /d %~dp0

echo 🚀 准备启动稳健爬虫...
echo.

REM 归档旧日志
if exist "plant_data\crawler.log" (
    echo 📝 归档旧日志...
    for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c%%a%%b)
    for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a%%b)
    move "plant_data\crawler.log" "plant_data\crawler_%mydate%_%mytime%.log"
)

echo.
echo ⚠️  重要提示：
echo    请手动设置电脑不要睡眠：
echo    控制面板 ^> 电源选项 ^> 更改计划设置 ^> 使睡眠设为'从不'
echo.
echo    或者在 PowerShell 中运行（管理员权限）：
echo    powercfg -change -standby-timeout-ac 0
echo.

pause

echo.
echo 🚀 开始爬取...
python -u robust_crawler.py 1.5

echo.
echo ✅ 爬虫执行完成！
pause
