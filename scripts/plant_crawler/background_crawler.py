#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
後台爬蟲運行腳本
專為長時間穩定運行設計，含錯誤恢復和完成通知
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import sys
from pathlib import Path
from datetime import datetime


class BackgroundCrawler:
    """後台穩定爬蟲"""

    def __init__(self, delay=1.5, output_dir='./'):
        self.base_url = "https://tai2.ntu.edu.tw"
        self.delay = delay
        self.output_dir = Path(output_dir)

        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Educational Research Bot)',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        })

        self.tested = 0
        self.found = 0
        self.errors = 0
        self.start_time = time.time()

        # 日誌文件
        self.log_file = self.output_dir / 'crawler.log'
        self.progress_file = self.output_dir / 'plant_codes_progress.json'
        self.complete_file = self.output_dir / 'plant_codes_complete.json'

    def log(self, message):
        """寫入日誌"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_msg = f"[{timestamp}] {message}\n"

        # 寫入文件
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(log_msg)

        # 同時輸出到 stdout（會被捕獲）
        print(log_msg.strip())
        sys.stdout.flush()

    def test_code(self, code: str) -> bool:
        """測試編碼，含錯誤重試"""
        max_retries = 3

        for attempt in range(max_retries):
            try:
                url = f"{self.base_url}/PlantInfo/species-name.php?code={code}"
                response = self.session.get(url, timeout=15)
                self.tested += 1

                if response.status_code != 200:
                    return False

                if 'Search-台灣植物資訊整合查詢系統' in response.text:
                    return False

                soup = BeautifulSoup(response.text, 'html.parser')
                title = soup.find('title')

                if title and title.text.strip() != 'Search-台灣植物資訊整合查詢系統':
                    return True

                return False

            except requests.exceptions.Timeout:
                self.log(f"⚠️  超時 (嘗試 {attempt+1}/{max_retries}): {code}")
                if attempt < max_retries - 1:
                    time.sleep(5)  # 等待 5 秒後重試
                else:
                    self.errors += 1
                    return False

            except Exception as e:
                self.log(f"⚠️  錯誤 (嘗試 {attempt+1}/{max_retries}): {code} - {str(e)}")
                if attempt < max_retries - 1:
                    time.sleep(5)
                else:
                    self.errors += 1
                    return False

        return False

    def discover_all(self):
        """完整發現流程"""
        self.log("=" * 70)
        self.log("開始植物編碼發現")
        self.log(f"延遲: {self.delay} 秒/請求")
        self.log("=" * 70)

        all_codes = set()

        try:
            # 階段 1: 發現科號
            self.log("\n階段 1/3: 發現有效科號")
            families = self.discover_families()
            self.log(f"✅ 找到 {len(families)} 個科號")
            self.save_progress(all_codes, "階段1完成")

            # 階段 2: 發現屬號
            self.log("\n階段 2/3: 發現有效屬號")
            family_genus_map = {}

            for i, family in enumerate(sorted(families), 1):
                self.log(f"\n[{i}/{len(families)}] 探索科號 {family:03d}")
                genera = self.discover_genera(family)

                if genera:
                    family_genus_map[family] = genera
                    self.log(f"  ✅ 找到 {len(genera)} 個屬號")

                if i % 5 == 0:
                    self.save_progress(all_codes, f"階段2: {i}/{len(families)}")

            total_genera = sum(len(g) for g in family_genus_map.values())
            self.log(f"✅ 總共 {total_genera} 個科-屬組合")

            # 階段 3: 發現種號
            self.log("\n階段 3/3: 完整探索種號")

            total_combinations = total_genera
            completed = 0

            for family, genera in sorted(family_genus_map.items()):
                for genus in sorted(genera):
                    completed += 1
                    self.log(f"\n[{completed}/{total_combinations}] {family:03d}+{genus:03d}")

                    species_codes = self.discover_species(family, genus)
                    all_codes.update(species_codes)

                    if species_codes:
                        self.log(f"  ✅ {len(species_codes)} 個植物")

                    # 每 10 個保存一次
                    if completed % 10 == 0:
                        self.save_progress(all_codes, f"階段3: {completed}/{total_combinations}")

            # 完成
            self.save_final(all_codes)
            self.log("\n" + "=" * 70)
            self.log("✅ 發現完成！")
            self.log(f"總發現: {len(all_codes)} 個植物")
            self.log(f"總測試: {self.tested} 次")
            self.log(f"錯誤數: {self.errors}")
            self.log(f"總耗時: {(time.time() - self.start_time)/3600:.2f} 小時")
            self.log("=" * 70)

        except Exception as e:
            self.log(f"\n❌ 發生嚴重錯誤: {str(e)}")
            import traceback
            self.log(traceback.format_exc())
            self.save_progress(all_codes, "錯誤中斷")
            raise

    def discover_families(self):
        """發現科號"""
        families = set()

        # 快速掃描
        for family in range(100, 600, 5):
            if self.test_code(f"{family:03d}+001+01+0"):
                families.add(family)
                self.log(f"  ✅ 科 {family:03d}")
            time.sleep(self.delay)

        # 擴展
        expanded = set()
        for family in families:
            for offset in range(-5, 6):
                f = family + offset
                if 100 <= f < 600:
                    expanded.add(f)

        for family in sorted(expanded - families):
            if self.test_code(f"{family:03d}+001+01+0"):
                families.add(family)
                self.log(f"  ✅ 科 {family:03d} (擴展)")
            time.sleep(self.delay)

        return families

    def discover_genera(self, family: int):
        """發現屬號"""
        genera = set()

        for genus in range(1, 101, 5):
            if self.test_code(f"{family:03d}+{genus:03d}+01+0"):
                genera.add(genus)
            time.sleep(self.delay)

        if genera:
            expanded = set()
            for genus in genera:
                for offset in range(-5, 6):
                    g = genus + offset
                    if 1 <= g <= 999:
                        expanded.add(g)

            for genus in sorted(expanded - genera):
                if self.test_code(f"{family:03d}+{genus:03d}+01+0"):
                    genera.add(genus)
                time.sleep(self.delay)

        return genera

    def discover_species(self, family: int, genus: int):
        """發現種號"""
        codes = set()
        no_result_count = 0

        for species in range(1, 100):
            code = f"{family:03d}+{genus:03d}+{species:02d}+0"

            if self.test_code(code):
                codes.add(code)
                self.found += 1
                no_result_count = 0
            else:
                no_result_count += 1

            time.sleep(self.delay)

            # 優化: 連續 10 個沒找到就停止
            if no_result_count >= 10 and species > 10:
                break

        return codes

    def save_progress(self, codes, stage):
        """保存進度"""
        data = {
            'stage': stage,
            'total': len(codes),
            'codes': sorted(list(codes)),
            'timestamp': datetime.now().isoformat(),
            'statistics': {
                'tested': self.tested,
                'found': self.found,
                'errors': self.errors,
                'elapsed_hours': (time.time() - self.start_time) / 3600
            }
        }

        with open(self.progress_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def save_final(self, codes):
        """保存最終結果"""
        data = {
            'total': len(codes),
            'codes': sorted(list(codes)),
            'completed_at': datetime.now().isoformat(),
            'statistics': {
                'tested': self.tested,
                'found': self.found,
                'errors': self.errors,
                'total_hours': (time.time() - self.start_time) / 3600,
                'success_rate': self.found / self.tested * 100 if self.tested > 0 else 0
            }
        }

        # JSON
        with open(self.complete_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        # TXT
        txt_file = self.complete_file.with_suffix('.txt')
        with open(txt_file, 'w', encoding='utf-8') as f:
            for code in sorted(codes):
                f.write(f"{code}\n")


def main():
    delay = 1.5

    if len(sys.argv) > 1:
        try:
            delay = float(sys.argv[1])
        except:
            pass

    crawler = BackgroundCrawler(delay=delay)
    crawler.discover_all()


if __name__ == '__main__':
    main()
