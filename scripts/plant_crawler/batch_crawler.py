#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量植物爬蟲
從植物編碼列表批量爬取所有植物資料，準備 RAG 資料
"""

import json
import time
import os
from pathlib import Path
from typing import List, Dict
from plant_parser import PlantPageParser


class BatchCrawler:
    """批量爬蟲"""

    def __init__(self, output_dir='./plant_data'):
        self.parser = PlantPageParser()
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)

        # 統計資料
        self.stats = {
            'total': 0,
            'success': 0,
            'failed': 0,
            'skipped': 0,
            'usable': 0,
            'start_time': time.time()
        }

    def load_codes(self, codes_file: str) -> List[str]:
        """載入植物編碼列表"""
        codes = []

        if codes_file.endswith('.json'):
            with open(codes_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                codes = data.get('codes', [])
        else:
            # 文本檔，每行一個 code
            with open(codes_file, 'r', encoding='utf-8') as f:
                codes = [line.strip() for line in f if line.strip()]

        return codes

    def crawl_all(self, codes: List[str], resume=True, delay=0.5):
        """
        批量爬取所有植物

        Args:
            codes: 植物編碼列表
            resume: 是否跳過已經爬取的（支援斷點續傳）
            delay: 每次請求之間的延遲（秒）
        """
        self.stats['total'] = len(codes)

        print("=" * 70)
        print("批量植物爬蟲")
        print("=" * 70)
        print(f"總數：{len(codes)} 個植物")
        print(f"輸出目錄：{self.output_dir}")
        print(f"斷點續傳：{'是' if resume else '否'}")
        print(f"請求延遲：{delay} 秒")
        print("=" * 70)

        all_plants = []

        for i, code in enumerate(codes, 1):
            print(f"\n[{i}/{len(codes)}] ", end='')

            # 檢查是否已經爬取過
            output_file = self.output_dir / f"{code.replace('+', '_')}.json"
            if resume and output_file.exists():
                print(f"⏭️  跳過（已存在）：{code}")
                self.stats['skipped'] += 1

                # 載入已有的資料
                try:
                    with open(output_file, 'r', encoding='utf-8') as f:
                        plant_data = json.load(f)
                        all_plants.append(plant_data)
                        if plant_data.get('completeness', {}).get('is_usable'):
                            self.stats['usable'] += 1
                except:
                    pass

                continue

            # 爬取植物資料
            plant_data = self.parser.parse_plant(code)

            if plant_data:
                self.stats['success'] += 1

                # 儲存單個植物資料
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(plant_data, f, ensure_ascii=False, indent=2)

                all_plants.append(plant_data)

                # 統計可用資料
                if plant_data.get('completeness', {}).get('is_usable'):
                    self.stats['usable'] += 1
            else:
                self.stats['failed'] += 1
                print(f"  ⚠️  爬取失敗")

            # 禮貌性延遲
            time.sleep(delay)

            # 每 10 個植物顯示一次進度
            if i % 10 == 0:
                self._print_progress()

        # 儲存合併的資料集
        self._save_combined_dataset(all_plants)

        # 顯示最終統計
        self._print_final_stats()

        return all_plants

    def _print_progress(self):
        """顯示進度"""
        completed = self.stats['success'] + self.stats['failed'] + self.stats['skipped']
        progress = completed / self.stats['total'] * 100 if self.stats['total'] > 0 else 0
        elapsed = time.time() - self.stats['start_time']

        print(f"\n  📊 進度：{completed}/{self.stats['total']} ({progress:.1f}%)")
        print(f"     成功：{self.stats['success']} | 失敗：{self.stats['failed']} | 跳過：{self.stats['skipped']}")
        print(f"     可用資料：{self.stats['usable']}")
        print(f"     已用時：{elapsed:.1f} 秒")

    def _print_final_stats(self):
        """顯示最終統計"""
        elapsed = time.time() - self.stats['start_time']

        print("\n" + "=" * 70)
        print("爬取完成！")
        print("=" * 70)
        print(f"總數：{self.stats['total']}")
        print(f"成功：{self.stats['success']}")
        print(f"失敗：{self.stats['failed']}")
        print(f"跳過：{self.stats['skipped']}")
        print(f"可用資料：{self.stats['usable']} ({self.stats['usable']/self.stats['total']*100:.1f}%)")
        print(f"總用時：{elapsed:.1f} 秒")
        print(f"平均速度：{self.stats['total']/elapsed:.2f} 個/秒" if elapsed > 0 else "")
        print("=" * 70)

    def _save_combined_dataset(self, plants: List[Dict]):
        """儲存合併的資料集"""
        # 完整資料集
        full_dataset = {
            'metadata': {
                'total': len(plants),
                'usable': sum(1 for p in plants if p.get('completeness', {}).get('is_usable')),
                'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                'source': 'https://tai2.ntu.edu.tw',
                'description': '台灣植物資訊整合查詢系統'
            },
            'plants': plants
        }

        output_file = self.output_dir / 'all_plants.json'
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(full_dataset, f, ensure_ascii=False, indent=2)

        print(f"\n✅ 完整資料集已儲存：{output_file}")

        # 只保存可用的植物（用於 RAG）
        usable_plants = [p for p in plants if p.get('completeness', {}).get('is_usable')]

        rag_dataset = {
            'metadata': {
                'total': len(usable_plants),
                'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                'source': 'https://tai2.ntu.edu.tw',
                'description': '台灣植物資訊 - RAG 可用資料集',
                'filter': 'is_usable=True (有中文名或學名 + 有特徵描述)'
            },
            'plants': usable_plants
        }

        rag_file = self.output_dir / 'rag_plants.json'
        with open(rag_file, 'w', encoding='utf-8') as f:
            json.dump(rag_dataset, f, ensure_ascii=False, indent=2)

        print(f"✅ RAG 資料集已儲存：{rag_file} ({len(usable_plants)} 個可用植物)")


def main():
    """主函數"""
    import sys

    # 預設參數
    codes_file = 'plant_codes.txt'
    output_dir = './plant_data'
    delay = 0.5

    # 從命令列參數讀取
    if len(sys.argv) > 1:
        codes_file = sys.argv[1]
    if len(sys.argv) > 2:
        output_dir = sys.argv[2]
    if len(sys.argv) > 3:
        delay = float(sys.argv[3])

    # 檢查檔案是否存在
    if not os.path.exists(codes_file):
        print(f"❌ 錯誤：找不到植物編碼檔案 {codes_file}")
        print("\n用法：")
        print("  python batch_crawler.py [codes_file] [output_dir] [delay]")
        print("\n範例：")
        print("  python batch_crawler.py plant_codes.txt ./plant_data 0.5")
        sys.exit(1)

    # 創建爬蟲
    crawler = BatchCrawler(output_dir=output_dir)

    # 載入編碼
    codes = crawler.load_codes(codes_file)
    print(f"✅ 載入了 {len(codes)} 個植物編碼")

    # 開始爬取
    crawler.crawl_all(codes, resume=True, delay=delay)


if __name__ == '__main__':
    main()
