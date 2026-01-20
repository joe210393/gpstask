#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完整植物編碼發現器
系統化地探索所有可能的植物編碼組合
"""

import requests
from bs4 import BeautifulSoup
import re
import json
import time
from typing import Set, List
from pathlib import Path


class ComprehensiveCodeDiscovery:
    """完整的植物編碼發現器"""

    def __init__(self, delay=2.0):
        self.base_url = "https://tai2.ntu.edu.tw"
        self.delay = delay  # 延遲時間（秒）
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Educational Research Bot)',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        })
        self.valid_codes = set()
        self.tested_codes = 0
        self.failed_codes = 0

    def test_code(self, code: str) -> bool:
        """測試單個編碼是否有效"""
        url = f"{self.base_url}/PlantInfo/species-name.php?code={code}"

        try:
            response = self.session.get(url, timeout=10)

            if response.status_code != 200:
                return False

            # 檢查是否是有效頁面（不是搜尋頁面）
            if 'Search-台灣植物資訊整合查詢系統' in response.text:
                return False

            # 檢查是否有實際內容
            soup = BeautifulSoup(response.text, 'html.parser')
            title = soup.find('title')

            if title and title.text.strip() != 'Search-台灣植物資訊整合查詢系統':
                return True

            return False

        except Exception as e:
            print(f"    ⚠️  測試錯誤：{e}")
            return False

    def discover_by_range(self,
                         family_start: int, family_end: int,
                         genus_start: int = 1, genus_end: int = 999,
                         species_start: int = 1, species_end: int = 99,
                         variety: int = 0) -> Set[str]:
        """
        按範圍系統化探索

        Args:
            family_start: 科號起始（第一部分）
            family_end: 科號結束
            genus_start: 屬號起始（第二部分）
            genus_end: 屬號結束
            species_start: 種號起始（第三部分）
            species_end: 種號結束
            variety: 變種號（第四部分，通常是 0）
        """
        found_codes = set()

        print(f"\n探索範圍：")
        print(f"  科號：{family_start:03d} - {family_end:03d}")
        print(f"  屬號：{genus_start:03d} - {genus_end:03d}")
        print(f"  種號：{species_start:02d} - {species_end:02d}")
        print(f"  變種：{variety}")

        total_combinations = (family_end - family_start + 1) * \
                           (genus_end - genus_start + 1) * \
                           (species_end - species_start + 1)

        print(f"  總組合數：{total_combinations:,}")

        start_time = time.time()

        for family in range(family_start, family_end + 1):
            family_found = 0

            for genus in range(genus_start, genus_end + 1):
                for species in range(species_start, species_end + 1):
                    code = f"{family:03d}+{genus:03d}+{species:02d}+{variety}"

                    self.tested_codes += 1

                    if self.test_code(code):
                        found_codes.add(code)
                        family_found += 1
                        print(f"  ✅ [{len(found_codes)}] {code}")
                    else:
                        self.failed_codes += 1

                    # 禮貌性延遲
                    time.sleep(self.delay)

                    # 每 50 個測試顯示進度
                    if self.tested_codes % 50 == 0:
                        self._print_progress(start_time, total_combinations)

            if family_found > 0:
                print(f"\n  📊 科 {family:03d} 找到 {family_found} 個植物")

        return found_codes

    def _print_progress(self, start_time: float, total: int):
        """顯示進度"""
        elapsed = time.time() - start_time
        progress = self.tested_codes / total * 100 if total > 0 else 0
        speed = self.tested_codes / elapsed if elapsed > 0 else 0
        remaining = (total - self.tested_codes) / speed if speed > 0 else 0

        print(f"\n  📊 進度：{self.tested_codes}/{total} ({progress:.1f}%)")
        print(f"     找到：{len(self.valid_codes)} | 失敗：{self.failed_codes}")
        print(f"     速度：{speed:.2f} 個/秒 | 已用時：{elapsed/60:.1f} 分鐘")
        print(f"     預計剩餘：{remaining/60:.1f} 分鐘")

    def smart_discovery(self) -> Set[str]:
        """
        智能探索策略
        先測試稀疏採樣，找到有效範圍後再密集探索
        """
        print("=" * 70)
        print("智能植物編碼發現器")
        print("=" * 70)

        all_codes = set()

        # 階段 1：快速掃描找到有效的科號範圍
        print("\n【階段 1】快速掃描有效科號（每 5 個測試一次）")
        print("-" * 70)

        active_families = set()

        for family in range(100, 600, 5):  # 每 5 個測試
            test_code = f"{family:03d}+001+01+0"
            self.tested_codes += 1

            if self.test_code(test_code):
                active_families.add(family)
                print(f"  ✅ 科 {family:03d} 有效")

            time.sleep(self.delay)

        print(f"\n找到 {len(active_families)} 個有效科號")

        # 階段 2：擴展有效科號範圍
        print("\n【階段 2】擴展有效科號範圍（前後各 5 個）")
        print("-" * 70)

        expanded_families = set()
        for family in active_families:
            # 向前擴展
            for f in range(max(100, family - 5), family):
                expanded_families.add(f)
            # 向後擴展
            for f in range(family + 1, min(600, family + 6)):
                expanded_families.add(f)
            expanded_families.add(family)

        print(f"擴展後共 {len(expanded_families)} 個科號需要探索")

        # 階段 3：完整探索每個有效科號
        print("\n【階段 3】完整探索每個有效科號")
        print("-" * 70)

        for i, family in enumerate(sorted(expanded_families), 1):
            print(f"\n[{i}/{len(expanded_families)}] 探索科號 {family:03d}")

            # 對每個科，探索所有可能的屬和種
            family_codes = self.discover_by_range(
                family_start=family,
                family_end=family,
                genus_start=1,
                genus_end=50,  # 先探索前 50 個屬
                species_start=1,
                species_end=20,  # 先探索前 20 個種
                variety=0
            )

            all_codes.update(family_codes)

            if len(family_codes) > 0:
                print(f"  ✅ 科 {family:03d} 找到 {len(family_codes)} 個植物")

            # 保存中間結果
            self._save_intermediate_results(all_codes)

        return all_codes

    def _save_intermediate_results(self, codes: Set[str]):
        """保存中間結果"""
        output = {
            'total': len(codes),
            'codes': sorted(list(codes)),
            'discovered_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'tested_codes': self.tested_codes,
            'failed_codes': self.failed_codes
        }

        with open('plant_codes_progress.json', 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

    def save_results(self, codes: Set[str]):
        """保存最終結果"""
        output = {
            'total': len(codes),
            'codes': sorted(list(codes)),
            'discovered_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'statistics': {
                'tested_codes': self.tested_codes,
                'failed_codes': self.failed_codes,
                'success_rate': len(codes) / self.tested_codes * 100 if self.tested_codes > 0 else 0
            }
        }

        # 保存 JSON
        with open('plant_codes_complete.json', 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        # 保存文本檔
        with open('plant_codes_complete.txt', 'w', encoding='utf-8') as f:
            for code in sorted(codes):
                f.write(f"{code}\n")

        print("\n" + "=" * 70)
        print("發現完成！")
        print("=" * 70)
        print(f"總發現：{len(codes)} 個植物編碼")
        print(f"總測試：{self.tested_codes} 次")
        print(f"成功率：{len(codes)/self.tested_codes*100:.2f}%")
        print(f"\n✅ 已保存至：")
        print(f"  - plant_codes_complete.json")
        print(f"  - plant_codes_complete.txt")


def main():
    """主函數"""
    import sys

    # 設定延遲時間（秒）
    delay = 2.0  # 預設 2 秒

    if len(sys.argv) > 1:
        try:
            delay = float(sys.argv[1])
        except:
            print("⚠️  無效的延遲時間，使用預設值 2.0 秒")

    print(f"\n延遲時間設定：{delay} 秒/請求")
    print("這將是一個漫長的過程，請耐心等待...")
    print("中間結果會定期保存到 plant_codes_progress.json\n")

    # 創建發現器
    discoverer = ComprehensiveCodeDiscovery(delay=delay)

    # 開始發現
    try:
        codes = discoverer.smart_discovery()
        discoverer.save_results(codes)
    except KeyboardInterrupt:
        print("\n\n⚠️  用戶中斷")
        print(f"已發現 {len(discoverer.valid_codes)} 個植物編碼")
        discoverer.save_results(discoverer.valid_codes)
    except Exception as e:
        print(f"\n❌ 發生錯誤：{e}")
        import traceback
        traceback.print_exc()
        discoverer.save_results(discoverer.valid_codes)


if __name__ == '__main__':
    main()
