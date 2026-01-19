#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
植物資料完整性統計工具
快速掃描大量植物，統計資料完整性
"""

import time
import json
import random
from plant_parser import PlantPageParser
from typing import List, Dict


class PlantStatistics:
    """植物資料統計"""

    def __init__(self):
        self.parser = PlantPageParser()
        self.results = []
        self.stats = {
            'total': 0,
            'complete': 0,  # 描述 + 照片
            'partial': 0,   # 只有描述
            'empty': 0,     # 缺描述
            'photo_complete': 0,
            'photo_building': 0,
            'photo_none': 0,
            'has_description': 0,
            'usable': 0  # 可用於 RAG
        }

    def analyze_sample(self, codes: List[str], sample_size: int = 100):
        """
        分析植物樣本

        Args:
            codes: 植物 code 列表
            sample_size: 抽樣數量
        """
        print(f"\n開始統計分析（樣本數：{sample_size}）")
        print("="*60)

        # 隨機抽樣
        if len(codes) > sample_size:
            sampled_codes = random.sample(codes, sample_size)
        else:
            sampled_codes = codes

        # 逐一分析
        for i, code in enumerate(sampled_codes, 1):
            print(f"\n[{i}/{len(sampled_codes)}] ", end='')

            plant_data = self.parser.parse_plant(code)

            if plant_data:
                self.results.append(plant_data)
                self._update_stats(plant_data)

            # 禮貌性延遲
            time.sleep(0.5)

        # 計算百分比
        self._calculate_percentages()

        # 顯示統計結果
        self.print_summary()

    def _update_stats(self, plant_data: Dict):
        """更新統計數據"""
        self.stats['total'] += 1

        # 描述狀態
        if plant_data['description']['has_description']:
            self.stats['has_description'] += 1

        # 照片狀態
        photo_status = plant_data['photos']['status']
        if photo_status == 'complete':
            self.stats['photo_complete'] += 1
        elif photo_status == 'building':
            self.stats['photo_building'] += 1
        else:
            self.stats['photo_none'] += 1

        # 完整性分類
        completeness = plant_data['completeness']

        if completeness['is_complete']:
            self.stats['complete'] += 1
        elif completeness['is_usable']:
            self.stats['partial'] += 1
        else:
            self.stats['empty'] += 1

        if completeness['is_usable']:
            self.stats['usable'] += 1

    def _calculate_percentages(self):
        """計算百分比"""
        total = self.stats['total']
        if total == 0:
            return

        self.stats['percentages'] = {
            'complete': round(self.stats['complete'] / total * 100, 1),
            'partial': round(self.stats['partial'] / total * 100, 1),
            'empty': round(self.stats['empty'] / total * 100, 1),
            'usable': round(self.stats['usable'] / total * 100, 1),
            'has_description': round(self.stats['has_description'] / total * 100, 1),
            'photo_complete': round(self.stats['photo_complete'] / total * 100, 1),
            'photo_building': round(self.stats['photo_building'] / total * 100, 1),
            'photo_none': round(self.stats['photo_none'] / total * 100, 1),
        }

    def print_summary(self):
        """列印統計摘要"""
        print("\n" + "="*60)
        print("統計結果摘要")
        print("="*60)

        total = self.stats['total']
        pct = self.stats.get('percentages', {})

        print(f"\n📊 樣本總數：{total}")

        print(f"\n✅ 資料完整性：")
        print(f"  完整（描述+照片）：{self.stats['complete']} ({pct.get('complete', 0)}%)")
        print(f"  部分（只有描述）：{self.stats['partial']} ({pct.get('partial', 0)}%)")
        print(f"  空白（缺描述）  ：{self.stats['empty']} ({pct.get('empty', 0)}%)")
        print(f"  可用於 RAG      ：{self.stats['usable']} ({pct.get('usable', 0)}%)")

        print(f"\n📝 特徵描述：")
        print(f"  有描述：{self.stats['has_description']} ({pct.get('has_description', 0)}%)")

        print(f"\n📷 數位照片：")
        print(f"  完整：{self.stats['photo_complete']} ({pct.get('photo_complete', 0)}%)")
        print(f"  建置中：{self.stats['photo_building']} ({pct.get('photo_building', 0)}%)")
        print(f"  無照片：{self.stats['photo_none']} ({pct.get('photo_none', 0)}%)")

        # 推算全站資料
        print(f"\n🔮 假設全站資料（約 5,400 種植物）：")
        if total > 0:
            ratio = 5400 / total
            print(f"  完整資料：約 {int(self.stats['complete'] * ratio)} 種")
            print(f"  可用資料：約 {int(self.stats['usable'] * ratio)} 種")

    def save_results(self, filename='statistics_results.json'):
        """儲存統計結果"""
        output = {
            'statistics': self.stats,
            'sample_data': self.results,
            'analyzed_at': time.strftime('%Y-%m-%d %H:%M:%S')
        }

        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"\n✅ 統計結果已儲存至 {filename}")


def quick_test():
    """快速測試幾個已知的植物"""
    print("快速測試模式")
    print("="*60)

    test_codes = [
        "417+001+01+0",  # 降真香
        "333+010+05+0",  # 豬腳楠
        "333+019+01+0",  # 樟樹（猜測）
    ]

    stats = PlantStatistics()
    stats.analyze_sample(test_codes, sample_size=len(test_codes))
    stats.save_results('quick_test_results.json')


def main():
    """主函數"""
    import sys

    if len(sys.argv) < 2:
        print("用法：")
        print("  python statistics.py quick          # 快速測試")
        print("  python statistics.py codes.txt 100  # 從檔案讀取 code，分析 100 個樣本")
        sys.exit(1)

    if sys.argv[1] == 'quick':
        quick_test()
    else:
        # 從檔案讀取 codes
        codes_file = sys.argv[1]
        sample_size = int(sys.argv[2]) if len(sys.argv) > 2 else 100

        with open(codes_file, 'r', encoding='utf-8') as f:
            codes = [line.strip() for line in f if line.strip()]

        print(f"從 {codes_file} 讀取了 {len(codes)} 個 code")

        stats = PlantStatistics()
        stats.analyze_sample(codes, sample_size=sample_size)
        stats.save_results(f'statistics_results_{int(time.time())}.json')


if __name__ == '__main__':
    quick_test()  # 預設執行快速測試
