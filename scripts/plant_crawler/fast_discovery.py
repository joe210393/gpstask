#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
快速植物編碼發現器
從網站的完整列表頁面提取所有植物編碼
"""

import requests
from bs4 import BeautifulSoup
import re
import json
import time


def discover_all_plants():
    """嘗試從網站發現所有植物"""

    base_url = "https://tai2.ntu.edu.tw"
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Educational Research Bot)',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    })

    all_codes = set()

    print("=" * 70)
    print("快速植物編碼發現器")
    print("=" * 70)

    # 策略：嘗試訪問完整的植物名錄頁面
    possible_urls = [
        f"{base_url}/PlantInfo/species-name-list.php",
        f"{base_url}/PlantInfo/species-list.php",
        f"{base_url}/PlantInfo/plant-list.php",
        f"{base_url}/PlantInfo/",
        f"{base_url}/",
    ]

    for url in possible_urls:
        try:
            print(f"\n嘗試：{url}")
            response = session.get(url, timeout=10)

            if response.status_code == 200:
                # 提取所有 species-name.php?code= 的連結
                pattern = r'species-name\.php\?code=([0-9+]+)'
                codes = re.findall(pattern, response.text)

                # 過濾有效格式
                valid_codes = set()
                for code in codes:
                    if re.match(r'^\d{3}\+\d{3}\+\d{2}\+\d$', code):
                        valid_codes.add(code)

                if valid_codes:
                    print(f"  ✅ 找到 {len(valid_codes)} 個植物編碼")
                    all_codes.update(valid_codes)
                else:
                    print(f"  ℹ️  頁面存在但未找到植物編碼")
            else:
                print(f"  ❌ HTTP {response.status_code}")

        except Exception as e:
            print(f"  ⚠️  {e}")

        time.sleep(0.5)

    # 如果上述方法失敗，嘗試系統化探索
    if len(all_codes) < 100:
        print("\n" + "=" * 70)
        print("系統化探索植物編碼範圍")
        print("=" * 70)
        print("這可能需要一些時間...")

        # 基於已知的編碼格式，系統化探索
        # 已知：417+001+01+0, 333+010+05+0
        # 第一部分（科號）：通常在 100-999 範圍
        # 第二部分（屬號）：通常在 001-999 範圍
        # 第三部分（種號）：通常在 01-99 範圍
        # 第四部分：通常是 0

        # 為了快速測試，我們採用抽樣策略
        tested = 0
        found = 0

        # 先測試科號（第一部分）的範圍
        for family_code in range(100, 600, 5):  # 每 5 個測試一次
            if tested >= 100:  # 限制測試次數
                break

            code = f"{family_code:03d}+001+01+0"
            url = f"{base_url}/PlantInfo/species-name.php?code={code}"

            try:
                response = session.head(url, timeout=3, allow_redirects=True)
                if response.status_code == 200:
                    all_codes.add(code)
                    found += 1
                    print(f"  ✅ [{found}] {code}")
            except:
                pass

            tested += 1
            time.sleep(0.1)

        print(f"\n測試了 {tested} 個編碼，找到 {found} 個有效編碼")

    # 輸出結果
    print("\n" + "=" * 70)
    print(f"總共發現 {len(all_codes)} 個植物編碼")
    print("=" * 70)

    if all_codes:
        # 儲存為 JSON
        output = {
            'total': len(all_codes),
            'codes': sorted(list(all_codes)),
            'discovered_at': time.strftime('%Y-%m-%d %H:%M:%S')
        }

        with open('plant_codes.json', 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"✅ 已儲存至 plant_codes.json")

        # 同時儲存為文本檔（每行一個 code）
        with open('plant_codes.txt', 'w', encoding='utf-8') as f:
            for code in sorted(all_codes):
                f.write(f"{code}\n")

        print(f"✅ 已儲存至 plant_codes.txt")

        # 顯示前 10 個
        print(f"\n前 10 個編碼：")
        for code in sorted(list(all_codes))[:10]:
            print(f"  {code}")
    else:
        print("⚠️  未找到任何植物編碼")

    return all_codes


if __name__ == '__main__':
    codes = discover_all_plants()
    print(f"\n完成！共發現 {len(codes)} 個植物編碼")
