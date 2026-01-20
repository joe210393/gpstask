#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
優化的植物編碼發現器
使用多層採樣策略，大幅減少請求次數
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import sys
from typing import Set, Dict, Tuple


class OptimizedCodeDiscovery:
    """優化的植物編碼發現器"""

    def __init__(self, delay=1.5):
        self.base_url = "https://tai2.ntu.edu.tw"
        self.delay = delay
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Educational Research Bot)',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        })
        self.tested = 0
        self.found = 0
        self.start_time = time.time()

    def test_code(self, code: str) -> bool:
        """測試單個編碼"""
        url = f"{self.base_url}/PlantInfo/species-name.php?code={code}"

        try:
            response = self.session.get(url, timeout=10)
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

        except Exception:
            self.tested += 1
            return False

    def discover_all(self) -> Set[str]:
        """完整發現流程"""
        all_codes = set()

        print("=" * 70)
        print("優化的植物編碼發現器")
        print(f"延遲：{self.delay} 秒/請求")
        print("=" * 70)

        # 階段 1：發現有效科號（每 5 個測試）
        print("\n【階段 1/3】發現有效科號")
        print("-" * 70)

        families = self.discover_families()
        print(f"\n✅ 找到 {len(families)} 個有效科號")
        self.save_progress(all_codes, f"階段 1 完成，找到 {len(families)} 個科號")

        # 階段 2：對每個科號，發現有效屬號（每 5 個測試）
        print(f"\n【階段 2/3】發現有效屬號")
        print("-" * 70)

        family_genus_map = {}
        for i, family in enumerate(sorted(families), 1):
            print(f"\n[{i}/{len(families)}] 探索科號 {family:03d} 的屬號...")
            genera = self.discover_genera(family)

            if genera:
                family_genus_map[family] = genera
                print(f"  ✅ 找到 {len(genera)} 個有效屬號")
            else:
                print(f"  ⚠️  未找到有效屬號")

            self.save_progress(all_codes, f"階段 2 進度：{i}/{len(families)}")

        print(f"\n✅ 總共找到 {sum(len(g) for g in family_genus_map.values())} 個科-屬組合")

        # 階段 3：對每個科-屬組合，完整探索種號
        print(f"\n【階段 3/3】完整探索種號")
        print("-" * 70)

        total_combinations = sum(len(g) for g in family_genus_map.values())
        completed = 0

        for family, genera in sorted(family_genus_map.items()):
            for genus in sorted(genera):
                completed += 1
                print(f"\n[{completed}/{total_combinations}] 探索 {family:03d}+{genus:03d}+XX+0")

                species_codes = self.discover_species(family, genus)
                all_codes.update(species_codes)

                if species_codes:
                    print(f"  ✅ 找到 {len(species_codes)} 個植物")

                # 每 10 個組合保存一次進度
                if completed % 10 == 0:
                    self.save_progress(all_codes, f"階段 3 進度：{completed}/{total_combinations}")

        return all_codes

    def discover_families(self) -> Set[int]:
        """發現有效科號（第一部分）"""
        families = set()

        # 快速掃描：每 5 個測試
        for family in range(100, 600, 5):
            test_code = f"{family:03d}+001+01+0"

            if self.test_code(test_code):
                families.add(family)
                print(f"  ✅ 科 {family:03d}")

            time.sleep(self.delay)

            # 顯示進度
            if self.tested % 20 == 0:
                self._print_stats()

        # 擴展：在每個有效科號前後各測試 5 個
        print("\n擴展科號範圍...")
        expanded = set()

        for family in families:
            for offset in range(-5, 6):
                f = family + offset
                if 100 <= f < 600:
                    expanded.add(f)

        # 測試擴展的科號
        for family in sorted(expanded - families):
            test_code = f"{family:03d}+001+01+0"

            if self.test_code(test_code):
                families.add(family)
                print(f"  ✅ 科 {family:03d} (擴展發現)")

            time.sleep(self.delay)

        return families

    def discover_genera(self, family: int) -> Set[int]:
        """發現某科下的有效屬號（第二部分）"""
        genera = set()

        # 快速掃描：每 5 個測試，範圍 1-100
        for genus in range(1, 101, 5):
            test_code = f"{family:03d}+{genus:03d}+01+0"

            if self.test_code(test_code):
                genera.add(genus)

            time.sleep(self.delay)

        # 擴展：在每個有效屬號前後各測試 5 個
        if genera:
            expanded = set()
            for genus in genera:
                for offset in range(-5, 6):
                    g = genus + offset
                    if 1 <= g <= 999:
                        expanded.add(g)

            # 測試擴展的屬號
            for genus in sorted(expanded - genera):
                test_code = f"{family:03d}+{genus:03d}+01+0"

                if self.test_code(test_code):
                    genera.add(genus)

                time.sleep(self.delay)

        return genera

    def discover_species(self, family: int, genus: int) -> Set[str]:
        """發現某科某屬下的所有種號（第三部分）"""
        codes = set()

        # 完整探索種號：1-99
        for species in range(1, 100):
            code = f"{family:03d}+{genus:03d}+{species:02d}+0"

            if self.test_code(code):
                codes.add(code)
                self.found += 1
                print(f"    ✅ [{self.found}] {code}")

            time.sleep(self.delay)

            # 優化：如果連續 10 個都沒找到，停止搜尋
            if species > 10:
                recent_codes = [c for c in codes if c.startswith(f"{family:03d}+{genus:03d}+")]
                if len(recent_codes) == 0:
                    break

        return codes

    def _print_stats(self):
        """顯示統計資訊"""
        elapsed = time.time() - self.start_time
        speed = self.tested / elapsed if elapsed > 0 else 0

        print(f"  📊 已測試：{self.tested} | 找到：{self.found} | "
              f"速度：{speed:.2f}/秒 | 用時：{elapsed/60:.1f}分")

    def save_progress(self, codes: Set[str], stage: str):
        """保存進度"""
        output = {
            'stage': stage,
            'total': len(codes),
            'codes': sorted(list(codes)),
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
            'statistics': {
                'tested': self.tested,
                'found': self.found,
                'success_rate': self.found / self.tested * 100 if self.tested > 0 else 0,
                'elapsed_minutes': (time.time() - self.start_time) / 60
            }
        }

        with open('plant_codes_progress.json', 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

    def save_final(self, codes: Set[str]):
        """保存最終結果"""
        output = {
            'total': len(codes),
            'codes': sorted(list(codes)),
            'completed_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'statistics': {
                'tested': self.tested,
                'found': self.found,
                'success_rate': self.found / self.tested * 100 if self.tested > 0 else 0,
                'total_minutes': (time.time() - self.start_time) / 60
            }
        }

        # JSON
        with open('plant_codes_complete.json', 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        # TXT
        with open('plant_codes_complete.txt', 'w', encoding='utf-8') as f:
            for code in sorted(codes):
                f.write(f"{code}\n")

        print("\n" + "=" * 70)
        print("✅ 發現完成！")
        print("=" * 70)
        print(f"總發現：{len(codes)} 個植物")
        print(f"總測試：{self.tested} 次")
        print(f"成功率：{self.found/self.tested*100:.2f}%")
        print(f"總用時：{(time.time() - self.start_time)/60:.1f} 分鐘")
        print(f"\n已保存：")
        print(f"  - plant_codes_complete.json")
        print(f"  - plant_codes_complete.txt")


def main():
    delay = 1.5  # 預設 1.5 秒

    if len(sys.argv) > 1:
        try:
            delay = float(sys.argv[1])
        except:
            pass

    print(f"\n⏱️  延遲時間：{delay} 秒/請求")
    print("💾 進度會自動保存到 plant_codes_progress.json")
    print("⏸️  可隨時按 Ctrl+C 中斷，進度已保存\n")

    discoverer = OptimizedCodeDiscovery(delay=delay)

    try:
        codes = discoverer.discover_all()
        discoverer.save_final(codes)
    except KeyboardInterrupt:
        print("\n\n⚠️  用戶中斷")
        print("保存當前進度...")
        # 從進度文件讀取已發現的編碼
        try:
            with open('plant_codes_progress.json', 'r') as f:
                data = json.load(f)
                codes = set(data.get('codes', []))
            discoverer.save_final(codes)
        except:
            print("無法保存進度")
    except Exception as e:
        print(f"\n❌ 錯誤：{e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()
