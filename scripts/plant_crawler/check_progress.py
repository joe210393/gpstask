#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
查看爬虫进度
"""

import json
from pathlib import Path
from datetime import datetime


def check_progress():
    """检查爬虫进度"""

    plant_data_dir = Path('./plant_data')
    status_file = plant_data_dir / 'crawler_status.json'
    log_file = plant_data_dir / 'crawler.log'

    print("=" * 80)
    print("📊 爬虫进度检查")
    print("=" * 80)
    print()

    # 检查状态文件
    if status_file.exists():
        with open(status_file, 'r', encoding='utf-8') as f:
            status = json.load(f)

        print("📋 当前状态:")
        print(f"   状态: {status['status']}")
        print(f"   进度: {status['progress']} ({status['percentage']}%)")
        print(f"   完成: {status['completed']} 个")
        print(f"   跳过: {status['skipped']} 个（已存在）")
        print(f"   失败: {status['failed']} 个")
        print(f"   总计: {status['total']} 个")
        print(f"   耗时: {status['elapsed_hours']} 小时")
        print(f"   更新: {status['updated_at']}")
        print()
    else:
        print("⚠️  未找到状态文件")
        print()

    # 统计已爬取的文件
    if plant_data_dir.exists():
        json_files = list(plant_data_dir.glob('*.json'))
        # 排除特殊文件
        plant_files = [f for f in json_files
                      if f.name not in ['crawler_status.json', 'all_plants.json',
                                       'rag_plants.json', 'rag_documents.json',
                                       'rag_documents_enhanced.json']]

        print(f"💾 已保存的数据文件: {len(plant_files)} 个")
        print()

    # 显示最新日志
    if log_file.exists():
        print("📝 最新日志（最后 10 行）:")
        print("-" * 80)
        with open(log_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            for line in lines[-10:]:
                print(line.rstrip())
        print("-" * 80)
    else:
        print("⚠️  未找到日志文件")

    print()
    print("=" * 80)

    # 计算预估剩余时间
    if status_file.exists() and status['completed'] > 0:
        remaining = status['total'] - status['completed'] - status['skipped']
        avg_time_per_item = status['elapsed_seconds'] / status['completed']
        estimated_remaining_seconds = remaining * avg_time_per_item

        if remaining > 0:
            print(f"⏱️  预估剩余时间: {estimated_remaining_seconds/60:.1f} 分钟 ({estimated_remaining_seconds/3600:.2f} 小时)")
            print(f"   还需爬取: {remaining} 个")
        else:
            print("🎉 已完成所有爬取！")

        print("=" * 80)


if __name__ == '__main__':
    try:
        check_progress()
    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback
        traceback.print_exc()
