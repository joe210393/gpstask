#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台灣植物資訊整合查詢系統 - 植物頁面解析器
解析單個植物頁面的所有資訊
"""

import requests
from bs4 import BeautifulSoup
import json
import re
import time
from typing import Dict, Optional, List


class PlantPageParser:
    """植物頁面解析器"""

    def __init__(self, timeout=10):
        self.timeout = timeout
        self.base_url = "https://tai2.ntu.edu.tw"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Educational Research Bot)',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        })

    def parse_plant(self, code: str) -> Optional[Dict]:
        """
        解析單個植物頁面

        Args:
            code: 植物編碼，例如 "417+001+01+0"

        Returns:
            植物資料字典，如果失敗則返回 None
        """
        url = f"{self.base_url}/PlantInfo/species-name.php?code={code}"

        try:
            print(f"正在抓取：{code} ...")
            response = self.session.get(url, timeout=self.timeout)
            response.encoding = 'utf-8'

            if response.status_code != 200:
                print(f"  ❌ HTTP {response.status_code}")
                return None

            soup = BeautifulSoup(response.text, 'lxml')

            # 檢查頁面是否有效（不是 404 或錯誤頁）
            if not self._is_valid_page(soup):
                print(f"  ❌ 無效頁面")
                return None

            # 解析各個區塊
            plant_data = {
                'code': code,
                'url': url,
                'crawled_at': time.strftime('%Y-%m-%d %H:%M:%S'),

                # 名彙資訊
                'nomenclature': self._parse_nomenclature(soup),

                # 特徵描述
                'description': self._parse_description(soup),

                # 數位照片
                'photos': self._parse_photos(soup, response.text),

                # 分布位置
                'distribution': self._parse_distribution(soup, response.text),

                # 標本資料
                'specimens': self._parse_specimens(response.text),

                # 資料完整性評估
                'completeness': {}
            }

            # 評估完整性
            plant_data['completeness'] = self._assess_completeness(plant_data)

            print(f"  ✅ {plant_data['nomenclature'].get('name_zh', 'N/A')} - "
                  f"完整度: {plant_data['completeness']['score']}")

            return plant_data

        except requests.RequestException as e:
            print(f"  ❌ 網路錯誤: {e}")
            return None
        except Exception as e:
            print(f"  ❌ 解析錯誤: {e}")
            return None

    def _is_valid_page(self, soup: BeautifulSoup) -> bool:
        """檢查是否為有效的植物頁面"""
        # 檢查是否有植物名稱
        title = soup.find('title')
        if not title:
            print(f"    調試：找不到 title 標籤")
            return False

        print(f"    調試：title = {title.text[:50] if title.text else 'empty'}")

        # 放寬檢查條件：只要有 title 就可以
        if 'TAIWAN' in title.text or 'taiwan' in title.text or 'Plants' in title.text:
            return True

        # 或者有學名
        if soup.find('i') or soup.find('em'):
            return True

        return False

    def _parse_nomenclature(self, soup: BeautifulSoup) -> Dict:
        """解析名彙資訊"""
        data = {
            'name_zh': '',
            'name_latin': '',
            'family': '',
            'family_zh': '',
            'aliases': [],
            'common_names': {}
        }

        try:
            # 中文名（通常在標題或 h1）
            h1 = soup.find('h1')
            if h1:
                text = h1.get_text(strip=True)
                # 通常格式：「學名 中文名」或「中文名 學名」
                parts = text.split()
                for part in parts:
                    if not re.match(r'^[A-Z][a-z]+', part):  # 不是學名
                        data['name_zh'] = part
                        break

            # 學名（斜體或在標題中）
            italic = soup.find('i') or soup.find('em')
            if italic:
                data['name_latin'] = italic.get_text(strip=True)

            # 科名
            family_link = soup.find('a', href=re.compile(r'family='))
            if family_link:
                data['family'] = family_link.get('href').split('family=')[1].split('&')[0]
                data['family_zh'] = family_link.get_text(strip=True)

            # TODO: 解析別名、俗名等詳細資訊

        except Exception as e:
            print(f"    警告：名彙資訊解析失敗 - {e}")

        return data

    def _parse_description(self, soup: BeautifulSoup) -> Dict:
        """解析特徵描述"""
        data = {
            'has_description': False,
            'description_en': '',
            'description_zh': '',
            'life_form': '',
            'morphology': '',
            'distribution_text': ''
        }

        try:
            # 尋找特徵描述區塊
            # 通常在 id="description" 或包含 "Morphological" 的標題後
            desc_section = soup.find(id='description')
            if not desc_section:
                # 尋找包含 "特徵描述" 或 "Morphological" 的標題
                headers = soup.find_all(['h2', 'h3', 'h4'])
                for header in headers:
                    if '特徵' in header.text or 'Morphological' in header.text:
                        desc_section = header.find_next_sibling()
                        break

            if desc_section:
                text = desc_section.get_text(strip=True)

                if text and len(text) > 20:  # 確保有實質內容
                    data['has_description'] = True
                    data['description_en'] = text  # 預設為英文

                    # 提取生活型（Life form）
                    life_match = re.search(r'Life form:?\s*([^.]+)', text, re.IGNORECASE)
                    if life_match:
                        data['life_form'] = life_match.group(1).strip()

        except Exception as e:
            print(f"    警告：特徵描述解析失敗 - {e}")

        return data

    def _parse_photos(self, soup: BeautifulSoup, html: str) -> Dict:
        """解析數位照片資訊"""
        data = {
            'status': 'unknown',  # 'complete', 'building', 'none'
            'has_photos': False,
            'photo_urls': [],
            'count': 0
        }

        try:
            # 檢查是否顯示「資料建置中」
            if '資料建置中' in html:
                data['status'] = 'building'
                print(f"    ⚠️  照片：資料建置中")

            # 從 JSON 資料中提取照片路徑
            # 頁面通常會有 JavaScript 包含標本資料的 JSON
            json_match = re.search(r'var\s+specimens\s*=\s*(\[.*?\]);', html, re.DOTALL)
            if json_match:
                try:
                    specimens_json = json.loads(json_match.group(1))

                    for specimen in specimens_json:
                        if 'image' in specimen and specimen['image']:
                            photo_url = f"{self.base_url}{specimen['image']}"
                            data['photo_urls'].append({
                                'url': photo_url,
                                'specimen_id': specimen.get('TAIID', ''),
                                'type': 'specimen'
                            })

                    data['count'] = len(data['photo_urls'])

                    if data['count'] > 0:
                        data['has_photos'] = True
                        if data['status'] == 'unknown':
                            data['status'] = 'complete'
                    elif data['status'] != 'building':
                        data['status'] = 'none'

                except json.JSONDecodeError:
                    pass

        except Exception as e:
            print(f"    警告：照片資訊解析失敗 - {e}")

        return data

    def _parse_distribution(self, soup: BeautifulSoup, html: str) -> Dict:
        """解析分布位置"""
        data = {
            'has_distribution': False,
            'taiwan_distribution': '',
            'world_distribution': '',
            'coordinates': []
        }

        try:
            # 從 JSON 提取座標資料
            json_match = re.search(r'var\s+specimens\s*=\s*(\[.*?\]);', html, re.DOTALL)
            if json_match:
                try:
                    specimens_json = json.loads(json_match.group(1))

                    for specimen in specimens_json:
                        if specimen.get('X') and specimen.get('Y'):
                            data['coordinates'].append({
                                'lat': specimen['Y'],
                                'lng': specimen['X'],
                                'location': specimen.get('locality', ''),
                                'locality_zh': specimen.get('locality_c', '')
                            })

                    if data['coordinates']:
                        data['has_distribution'] = True

                except json.JSONDecodeError:
                    pass

            # TODO: 解析文字描述的分布資訊

        except Exception as e:
            print(f"    警告：分布資訊解析失敗 - {e}")

        return data

    def _parse_specimens(self, html: str) -> Dict:
        """解析標本資料"""
        data = {
            'count': 0,
            'specimens': []
        }

        try:
            # 從 JavaScript 變數提取標本資料
            json_match = re.search(r'var\s+specimens\s*=\s*(\[.*?\]);', html, re.DOTALL)
            if json_match:
                try:
                    specimens_json = json.loads(json_match.group(1))
                    data['count'] = len(specimens_json)
                    # 只保存摘要資訊，避免資料過大
                    data['specimens'] = [
                        {
                            'id': s.get('TAIID', ''),
                            'collector': s.get('collector', ''),
                            'date': s.get('collectdate', ''),
                            'location': s.get('locality_c', s.get('locality', ''))
                        }
                        for s in specimens_json[:10]  # 只取前 10 筆
                    ]
                except json.JSONDecodeError:
                    pass
        except Exception as e:
            print(f"    警告：標本資料解析失敗 - {e}")

        return data

    def _assess_completeness(self, plant_data: Dict) -> Dict:
        """評估資料完整性"""
        score = 0
        max_score = 5
        issues = []

        # 1. 名稱資訊（必要）
        if plant_data['nomenclature']['name_zh']:
            score += 1
        else:
            issues.append('缺少中文名')

        if plant_data['nomenclature']['name_latin']:
            score += 0.5
        else:
            issues.append('缺少學名')

        # 2. 特徵描述（重要）
        if plant_data['description']['has_description']:
            score += 2
        else:
            issues.append('缺少特徵描述')

        # 3. 照片（重要）
        if plant_data['photos']['has_photos']:
            score += 1
        elif plant_data['photos']['status'] == 'building':
            score += 0.3
            issues.append('照片建置中')
        else:
            issues.append('無照片')

        # 4. 分布資訊（加分項）
        if plant_data['distribution']['has_distribution']:
            score += 0.5

        return {
            'score': round(score, 1),
            'max_score': max_score,
            'percentage': round(score / max_score * 100, 1),
            'is_complete': score >= 4,
            'is_usable': score >= 2.5,  # 至少有名稱和描述
            'issues': issues
        }


def test_parser():
    """測試解析器"""
    parser = PlantPageParser()

    # 測試已知的植物
    test_codes = [
        "417+001+01+0",  # 降真香
        "333+010+05+0",  # 豬腳楠
    ]

    results = []
    for code in test_codes:
        result = parser.parse_plant(code)
        if result:
            results.append(result)
        time.sleep(1)  # 禮貌性延遲

    # 輸出結果
    print("\n" + "="*60)
    print("測試結果摘要")
    print("="*60)

    for result in results:
        print(f"\n植物：{result['nomenclature']['name_zh']} ({result['nomenclature']['name_latin']})")
        print(f"編碼：{result['code']}")
        print(f"完整度：{result['completeness']['percentage']}% ({result['completeness']['score']}/{result['completeness']['max_score']})")
        print(f"可用性：{'✅ 可用' if result['completeness']['is_usable'] else '❌ 不可用'}")
        if result['completeness']['issues']:
            print(f"問題：{', '.join(result['completeness']['issues'])}")

    # 儲存 JSON
    with open('test_results.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n✅ 測試結果已儲存至 test_results.json")


if __name__ == '__main__':
    test_parser()
