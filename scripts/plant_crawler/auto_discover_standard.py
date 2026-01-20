#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动化标准模式编码发现
无需交互，直接运行标准模式扫描
"""

import requests
from bs4 import BeautifulSoup
import time
import json
import sys
from pathlib import Path
from datetime import datetime
import signal


class PlantCodeDiscovery:
    """植物编码发现器"""

    def __init__(self, delay=0.5):
        self.base_url = "https://tai2.ntu.edu.tw"
        self.delay = delay
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Educational Research Bot)',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        })

        self.valid_codes = []
        self.tested_count = 0
        self.start_time = time.time()
        self.last_save_time = time.time()

        # 处理中断信号
        signal.signal(signal.SIGINT, self.handle_interrupt)
        signal.signal(signal.SIGTERM, self.handle_interrupt)

    def handle_interrupt(self, signum, frame):
        """处理中断信号，保存当前进度"""
        print("\n\n⚠️  收到中断信号，正在保存进度...")
        self.save_codes('all_plant_codes_partial.txt')
        print("✅ 进度已保存")
        sys.exit(0)

    def test_code(self, code):
        """测试编码是否有效"""
        try:
            url = f"{self.base_url}/PlantInfo/species-name.php?code={code}"
            response = self.session.get(url, timeout=15)

            if response.status_code != 200:
                return False

            soup = BeautifulSoup(response.text, 'html.parser')

            # 检查是否是有效页面（不是搜索页）
            title = soup.find('title')
            if title and 'Search-台灣植物資訊整合查詢系統' in title.text:
                return False

            # 检查是否有植物名称
            name_tag = soup.find('span', class_='name')
            if not name_tag:
                return False

            return True

        except Exception as e:
            return False

    def discover_standard(self):
        """标准模式：扫描常见范围"""
        print("=" * 80)
        print("⚡ 标准模式 - 自动运行")
        print("=" * 80)

        part1_range = range(100, 1001, 5)     # 100-1000, 步长5
        part2_range = range(1, 101)           # 001-100
        part3_range = range(1, 21)            # 01-20
        part4_range = range(0, 3)             # 0-2

        print(f"\n🔍 扫描范围:")
        print(f"   第1段: 100-1000 (步长5)")
        print(f"   第2段: 001-100")
        print(f"   第3段: 01-20")
        print(f"   第4段: 0-2")
        print()

        total_tests = len(part1_range) * len(part2_range) * len(part3_range) * len(part4_range)
        print(f"📊 预计测试: {total_tests:,} 个编码")
        print(f"⏱️  预计耗时: {total_tests * self.delay / 60:.1f} 分钟 ({total_tests * self.delay / 3600:.2f} 小时)")
        print("=" * 80)
        print()

        current_test = 0

        for p1 in part1_range:
            for p2 in part2_range:
                for p3 in part3_range:
                    for p4 in part4_range:
                        current_test += 1
                        code = f"{p1:03d}+{p2:03d}+{p3:02d}+{p4}"

                        # 每100个显示进度
                        if current_test % 100 == 0:
                            elapsed = time.time() - self.start_time
                            rate = current_test / elapsed if elapsed > 0 else 0
                            remaining = (total_tests - current_test) / rate if rate > 0 else 0
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] "
                                  f"进度: {current_test:,}/{total_tests:,} ({current_test/total_tests*100:.1f}%) | "
                                  f"有效: {len(self.valid_codes):,} | "
                                  f"剩余: {remaining/60:.0f}分钟")
                            sys.stdout.flush()

                        # 每1000个自动保存一次
                        if current_test % 1000 == 0:
                            self.save_codes('all_plant_codes_progress.txt')

                        # 测试编码
                        is_valid = self.test_code(code)
                        self.tested_count += 1

                        if is_valid:
                            self.valid_codes.append(code)
                            print(f"  ✅ [{datetime.now().strftime('%H:%M:%S')}] 找到: {code} (总计: {len(self.valid_codes)})")
                            sys.stdout.flush()

                        # 延迟
                        time.sleep(self.delay)

    def save_codes(self, filename='all_plant_codes.txt'):
        """保存发现的编码"""
        output_file = Path(filename)

        # 保存为文本文件
        with open(output_file, 'w', encoding='utf-8') as f:
            for code in sorted(self.valid_codes):
                f.write(code + '\n')

        print(f"\n✅ 已保存 {len(self.valid_codes):,} 个编码到: {output_file}")

        # 同时保存为 JSON（包含元数据）
        json_file = output_file.with_suffix('.json')
        data = {
            'total_codes': len(self.valid_codes),
            'tested_count': self.tested_count,
            'created_at': datetime.now().isoformat(),
            'codes': sorted(self.valid_codes)
        }

        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"✅ 已保存 JSON 格式到: {json_file}")

    def print_statistics(self):
        """打印统计信息"""
        elapsed = time.time() - self.start_time

        print("\n" + "=" * 80)
        print("📊 发现统计")
        print("=" * 80)
        print(f"🔍 测试编码数: {self.tested_count:,}")
        print(f"✅ 有效编码数: {len(self.valid_codes):,}")
        print(f"📈 有效率: {len(self.valid_codes)/self.tested_count*100:.2f}%")
        print(f"⏱️  总耗时: {elapsed/3600:.2f} 小时")
        print(f"⚡ 平均速度: {self.tested_count/elapsed:.2f} 个/秒")
        print("=" * 80)


def main():
    """主函数"""
    print("=" * 80)
    print("🌿 台湾植物编码发现器 - 标准模式")
    print(f"🕐 启动时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    print()

    # 获取延迟参数
    delay = 0.5
    if len(sys.argv) > 1:
        try:
            delay = float(sys.argv[1])
        except:
            pass

    print(f"⏱️  请求延迟: {delay} 秒")
    print()

    discovery = PlantCodeDiscovery(delay=delay)

    try:
        discovery.discover_standard()

        # 保存结果
        discovery.save_codes('all_plant_codes.txt')
        discovery.print_statistics()

        print("\n✅ 编码发现完成！")
        print(f"📝 下一步：使用 robust_crawler.py 爬取所有植物数据")
        print(f"   python3 robust_crawler.py all_plant_codes.txt 1.5")

    except KeyboardInterrupt:
        print("\n\n⚠️  用户中断")
        discovery.save_codes('all_plant_codes_interrupted.txt')
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        discovery.save_codes('all_plant_codes_error.txt')
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()
