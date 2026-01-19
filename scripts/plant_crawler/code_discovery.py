#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
植物編碼發現器
用於找出所有有效的植物 code
"""

import requests
from bs4 import BeautifulSoup
import re
import time
import json
from typing import List, Set
from urllib.parse import urljoin, parse_qs, urlparse


class CodeDiscovery:
    """植物編碼發現器"""

    def __init__(self):
        self.base_url = "https://tai2.ntu.edu.tw"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Educational Research Bot)',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        })
        self.found_codes = set()

    def discover_from_family_index(self) -> Set[str]:
        """從科名索引頁面發現植物 code"""
        print("策略 1：從科名索引發現...")

        # 嘗試訪問科名檢索頁面
        family_index_url = f"{self.base_url}/PlantInfo/family-list.php"

        try:
            response = self.session.get(family_index_url, timeout=10)
            soup = BeautifulSoup(response.text, 'lxml')

            # 尋找所有科名連結
            family_links = soup.find_all('a', href=re.compile(r'family='))

            print(f"  找到 {len(family_links)} 個科名連結")

            for link in family_links[:5]:  # 先測試前 5 個
                family_name = link.get_text(strip=True)
                family_url = urljoin(self.base_url, link['href'])

                print(f"  正在處理科名：{family_name}")
                codes = self._extract_codes_from_family_page(family_url)
                self.found_codes.update(codes)
                time.sleep(0.5)

        except Exception as e:
            print(f"  ❌ 科名索引策略失敗：{e}")

        return self.found_codes

    def discover_from_search(self, keywords: List[str]) -> Set[str]:
        """從搜尋結果發現植物 code"""
        print("\n策略 2：從搜尋結果發現...")

        search_url = f"{self.base_url}/PlantInfo/plant-search.php"

        for keyword in keywords:
            try:
                print(f"  搜尋關鍵字：{keyword}")
                response = self.session.get(
                    search_url,
                    params={'keyword': keyword},
                    timeout=10
                )

                codes = self._extract_codes_from_html(response.text)
                self.found_codes.update(codes)
                print(f"    找到 {len(codes)} 個 code")

                time.sleep(1)

            except Exception as e:
                print(f"    ❌ 搜尋失敗：{e}")

        return self.found_codes

    def discover_by_sampling(self, sample_size=100) -> Set[str]:
        """
        透過取樣探索有效的 code 範圍

        Code 格式：XXX+XXX+XX+X
        策略：隨機或系統化嘗試可能的組合
        """
        print("\n策略 3：取樣探索...")

        # 從已知的 code 推測範圍
        # 417+001+01+0
        # 333+010+05+0

        tested = 0
        found = 0

        # 嘗試前三位數從 100-999，其他設為 001+01+0
        for first_part in range(100, 1000, 10):  # 每 10 個測試一次
            if tested >= sample_size:
                break

            code = f"{first_part:03d}+001+01+0"

            if self._test_code_exists(code):
                self.found_codes.add(code)
                found += 1
                print(f"  ✅ 找到：{code}")

            tested += 1
            time.sleep(0.2)

        print(f"  測試 {tested} 個，找到 {found} 個有效 code")

        return self.found_codes

    def discover_from_genus_pages(self) -> Set[str]:
        """從屬頁面發現植物"""
        print("\n策略 4：從屬頁面發現...")

        # 嘗試訪問屬列表
        genus_list_url = f"{self.base_url}/PlantInfo/genus-list.php"

        try:
            response = self.session.get(genus_list_url, timeout=10)
            codes = self._extract_codes_from_html(response.text)
            self.found_codes.update(codes)
            print(f"  找到 {len(codes)} 個 code")

        except Exception as e:
            print(f"  ❌ 屬頁面策略失敗：{e}")

        return self.found_codes

    def _extract_codes_from_family_page(self, url: str) -> Set[str]:
        """從科名頁面提取所有植物 code"""
        codes = set()

        try:
            response = self.session.get(url, timeout=10)
            codes = self._extract_codes_from_html(response.text)

        except Exception as e:
            print(f"    警告：{e}")

        return codes

    def _extract_codes_from_html(self, html: str) -> Set[str]:
        """從 HTML 中提取所有 species-name.php 的 code 參數"""
        codes = set()

        # 正則匹配：species-name.php?code=XXX+XXX+XX+X
        pattern = r'species-name\.php\?code=([0-9+]+)'
        matches = re.findall(pattern, html)

        for match in matches:
            # 驗證格式
            if re.match(r'^\d{3}\+\d{3}\+\d{2}\+\d$', match):
                codes.add(match)

        return codes

    def _test_code_exists(self, code: str) -> bool:
        """測試某個 code 是否存在（不下載完整頁面，只檢查 HTTP 狀態）"""
        url = f"{self.base_url}/PlantInfo/species-name.php?code={code}"

        try:
            response = self.session.head(url, timeout=5, allow_redirects=True)
            return response.status_code == 200
        except:
            return False

    def save_codes(self, filename='plant_codes.txt'):
        """儲存找到的 code"""
        with open(filename, 'w', encoding='utf-8') as f:
            for code in sorted(self.found_codes):
                f.write(f"{code}\n")

        print(f"\n✅ 已儲存 {len(self.found_codes)} 個 code 到 {filename}")


def main():
    """主函數"""
    discoverer = CodeDiscovery()

    print("="*60)
    print("植物編碼發現器")
    print("="*60)

    # 策略 1：科名索引
    discoverer.discover_from_family_index()

    # 策略 2：搜尋常見植物
    common_plants = ['樟樹', '榕樹', '台灣欒樹', '相思樹', '木棉']
    discoverer.discover_from_search(common_plants)

    # 策略 3：取樣探索
    discoverer.discover_by_sampling(sample_size=50)

    # 策略 4：屬頁面
    discoverer.discover_from_genus_pages()

    print("\n" + "="*60)
    print(f"總共發現 {len(discoverer.found_codes)} 個植物 code")
    print("="*60)

    # 儲存結果
    discoverer.save_codes('plant_codes.txt')

    # 同時儲存 JSON 格式
    with open('plant_codes.json', 'w', encoding='utf-8') as f:
        json.dump({
            'total': len(discoverer.found_codes),
            'codes': sorted(list(discoverer.found_codes)),
            'discovered_at': time.strftime('%Y-%m-%d %H:%M:%S')
        }, f, ensure_ascii=False, indent=2)

    print("✅ 也儲存為 plant_codes.json")


if __name__ == '__main__':
    main()
