#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
实时进度监控 - 带进度条
"""

import json
import time
import sys
import os
from pathlib import Path
from datetime import datetime, timedelta


def clear_screen():
    """清屏"""
    os.system('clear' if os.name != 'nt' else 'cls')


def get_terminal_width():
    """获取终端宽度"""
    try:
        return os.get_terminal_size().columns
    except:
        return 80


def draw_progress_bar(current, total, width=50, prefix='', suffix=''):
    """绘制进度条"""
    if total == 0:
        percent = 0
    else:
        percent = current / total * 100

    filled = int(width * current / total) if total > 0 else 0
    bar = '█' * filled + '░' * (width - filled)

    return f'{prefix} |{bar}| {percent:.1f}% {suffix}'


def format_time(seconds):
    """格式化时间"""
    if seconds < 60:
        return f"{int(seconds)}秒"
    elif seconds < 3600:
        return f"{int(seconds/60)}分{int(seconds%60)}秒"
    else:
        hours = int(seconds / 3600)
        minutes = int((seconds % 3600) / 60)
        return f"{hours}小时{minutes}分"


def monitor_progress():
    """监控进度"""
    crawler_dir = Path('/home/user/gpstask/scripts/plant_crawler')
    log_file = crawler_dir / 'smart_discovery.log'
    progress_file = crawler_dir / 'all_plant_codes_progress.txt'
    status_file = crawler_dir / 'crawler_status.json'

    # 预定义的阶段
    phases = [
        {"name": "阶段1: 基础扫描", "total": 901},
        {"name": "阶段2: 扩展属编号", "total": 4510},
        {"name": "阶段3: 扩展种编号", "total": 18180},
        {"name": "阶段4: 扩展变种编号", "total": 13680}
    ]
    total_tests = sum(p['total'] for p in phases)

    start_time = None

    while True:
        clear_screen()

        # 标题
        width = get_terminal_width()
        print("=" * width)
        print("🌿 台湾植物编码发现 - 实时进度监控".center(width))
        print("=" * width)
        print()

        # 当前时间
        now = datetime.now()
        print(f"⏰ 当前时间: {now.strftime('%Y-%m-%d %H:%M:%S')}")
        print()

        # 检查进程状态
        import subprocess
        try:
            result = subprocess.run(['pgrep', '-f', 'smart_discovery.py'],
                                   capture_output=True, text=True)
            is_running = bool(result.stdout.strip())
        except:
            is_running = False

        if is_running:
            print("✅ 状态: 正在运行")
        else:
            print("⚠️  状态: 未运行")
            print("\n💡 启动命令: python3 smart_discovery.py 0.5 > smart_discovery.log 2>&1 &")

        print()
        print("-" * width)
        print()

        # 读取日志分析进度
        current_phase = 0
        phase_progress = 0
        total_progress = 0
        discovered_count = 0

        if log_file.exists():
            with open(log_file, 'r', encoding='utf-8') as f:
                log_content = f.read()

                # 分析当前阶段
                if '阶段1' in log_content:
                    current_phase = 1
                if '阶段2' in log_content:
                    current_phase = 2
                if '阶段3' in log_content:
                    current_phase = 3
                if '阶段4' in log_content:
                    current_phase = 4

                # 提取进度信息
                lines = log_content.split('\n')
                for line in reversed(lines):
                    if '进度:' in line and '/' in line:
                        try:
                            # 提取类似 "100/901" 的进度
                            parts = line.split('进度:')[1].split('|')[0].strip()
                            if '/' in parts:
                                current, total = parts.split('/')[0:2]
                                current = int(current.replace(',', ''))
                                total = int(total.replace(',', ''))
                                phase_progress = current
                                break
                        except:
                            pass

                    # 提取发现的编码数
                    if '阶段发现:' in line:
                        try:
                            count = line.split('阶段发现:')[1].split('|')[0].strip()
                            discovered_count = int(count)
                        except:
                            pass

                # 读取启动时间
                for line in lines:
                    if '启动时间:' in line:
                        try:
                            time_str = line.split('启动时间:')[1].strip()
                            start_time = datetime.strptime(time_str, '%Y-%m-%d %H:%M:%S')
                        except:
                            pass
                        break

        # 计算总进度
        if current_phase > 0:
            # 前面阶段的总测试数
            completed_phases = sum(phases[i]['total'] for i in range(current_phase - 1))
            total_progress = completed_phases + phase_progress

        # 读取已发现的编码
        if progress_file.exists():
            try:
                with open(progress_file, 'r') as f:
                    discovered_count = len(f.readlines())
            except:
                pass

        # 显示总体进度
        print("📊 总体进度:")
        print(draw_progress_bar(total_progress, total_tests, 60,
                               f"  {total_progress:,}/{total_tests:,}",
                               f"({total_progress/total_tests*100:.2f}%)"))
        print()

        # 显示各阶段进度
        print("📍 阶段进度:")
        for i, phase in enumerate(phases, 1):
            if i < current_phase:
                # 已完成的阶段
                print(f"  ✅ {phase['name']}: " +
                      draw_progress_bar(phase['total'], phase['total'], 40, '', '已完成'))
            elif i == current_phase:
                # 当前阶段
                print(f"  🔄 {phase['name']}: " +
                      draw_progress_bar(phase_progress, phase['total'], 40,
                                       f"{phase_progress}/{phase['total']}", ''))
            else:
                # 未开始的阶段
                print(f"  ⏳ {phase['name']}: " +
                      draw_progress_bar(0, phase['total'], 40, '', '待开始'))

        print()
        print("-" * width)
        print()

        # 已发现的编码数量
        print(f"✅ 已发现编码: {discovered_count:,} 个")
        print()

        # 时间统计
        if start_time:
            elapsed = (now - start_time).total_seconds()
            print(f"⏱️  已运行时间: {format_time(elapsed)}")

            # 预估剩余时间
            if total_progress > 0:
                avg_time_per_test = elapsed / total_progress
                remaining_tests = total_tests - total_progress
                remaining_time = remaining_tests * avg_time_per_test

                print(f"⏳ 预计剩余: {format_time(remaining_time)}")

                # 预计完成时间
                finish_time = now + timedelta(seconds=remaining_time)
                print(f"🎯 预计完成: {finish_time.strftime('%H:%M:%S')} ({finish_time.strftime('%m月%d日')})")

        print()
        print("-" * width)
        print()

        # 显示最新日志（最后3行）
        print("📝 最新日志:")
        if log_file.exists():
            with open(log_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                recent_lines = [line.strip() for line in lines[-5:] if line.strip() and not line.startswith('=')]
                for line in recent_lines[-3:]:
                    if len(line) > width - 5:
                        line = line[:width-8] + '...'
                    print(f"  {line}")

        print()
        print("=" * width)
        print("💡 按 Ctrl+C 退出监控 | 自动刷新中...")
        print()

        # 等待后刷新
        try:
            time.sleep(5)  # 每5秒刷新一次
        except KeyboardInterrupt:
            print("\n\n👋 监控已停止")
            sys.exit(0)


if __name__ == '__main__':
    try:
        monitor_progress()
    except KeyboardInterrupt:
        print("\n\n👋 监控已停止")
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()
