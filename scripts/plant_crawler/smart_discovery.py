#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
智能编码发现 - 优化扫描策略
基于已知模式，智能扩展搜索
"""

import requests
from bs4 import BeautifulSoup
import time
import json
import sys
from pathlib import Path
from datetime import datetime
import signal


class SmartPlantDiscovery:
    """智能植物编码发现器"""

    def __init__(self, delay=0.5):
        self.base_url = "https://tai2.ntu.edu.tw"
        self.delay = delay
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Educational Research Bot)',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        })

        self.valid_codes = set()  # 使用集合避免重复
        self.tested_count = 0
        self.start_time = time.time()

        signal.signal(signal.SIGINT, self.handle_interrupt)
        signal.signal(signal.SIGTERM, self.handle_interrupt)

    def handle_interrupt(self, signum, frame):
        """处理中断信号"""
        print("\n\n⚠️  收到中断信号，正在保存进度...")
        self.save_codes('all_plant_codes_interrupted.txt')
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
            title = soup.find('title')
            if title and 'Search-台灣植物資訊整合查詢系統' in title.text:
                return False

            name_tag = soup.find('span', class_='name')
            if not name_tag:
                return False

            return True
        except:
            return False

    def scan_phase(self, phase_name, ranges, total_estimate):
        """扫描某个阶段"""
        print(f"\n{'='*80}")
        print(f"📍 阶段: {phase_name}")
        print(f"{'='*80}")

        p1_range, p2_range, p3_range, p4_range = ranges

        print(f"范围: [{p1_range[0]}-{p1_range[-1]}] x [{p2_range[0]}-{p2_range[-1]}] x [{p3_range[0]}-{p3_range[-1]}] x [{p4_range[0]}-{p4_range[-1]}]")
        print(f"预计: {total_estimate:,} 个测试, {total_estimate*self.delay/60:.1f} 分钟")
        print()

        phase_start = time.time()
        phase_found = 0
        phase_tested = 0

        for p1 in p1_range:
            for p2 in p2_range:
                for p3 in p3_range:
                    for p4 in p4_range:
                        code = f"{p1:03d}+{p2:03d}+{p3:02d}+{p4}"

                        is_valid = self.test_code(code)
                        self.tested_count += 1
                        phase_tested += 1

                        if is_valid and code not in self.valid_codes:
                            self.valid_codes.add(code)
                            phase_found += 1
                            print(f"  ✅ [{datetime.now().strftime('%H:%M:%S')}] {code} (阶段: +{phase_found}, 总计: {len(self.valid_codes)})")
                            sys.stdout.flush()

                        # 每100个显示进度
                        if phase_tested % 100 == 0:
                            elapsed = time.time() - phase_start
                            rate = phase_tested / elapsed if elapsed > 0 else 0
                            remaining = (total_estimate - phase_tested) / rate if rate > 0 else 0
                            print(f"  [{datetime.now().strftime('%H:%M:%S')}] "
                                  f"{phase_tested:,}/{total_estimate:,} ({phase_tested/total_estimate*100:.1f}%) | "
                                  f"阶段发现: {phase_found} | 剩余: {remaining/60:.0f}分")
                            sys.stdout.flush()

                        # 每500个自动保存
                        if self.tested_count % 500 == 0:
                            self.save_codes('all_plant_codes_progress.txt')

                        time.sleep(self.delay)

        phase_elapsed = time.time() - phase_start
        print(f"\n✅ 阶段完成: 发现 {phase_found} 个新编码, 耗时 {phase_elapsed/60:.1f} 分钟")

    def discover_smart(self):
        """智能多阶段发现"""
        print("=" * 80)
        print("🧠 智能多阶段编码发现")
        print("=" * 80)
        print()

        # 阶段1：基础扫描（最常见的模式）
        # 模式: XXX+001+01+0
        self.scan_phase(
            "阶段1 - 基础扫描 (XXX+001+01+0)",
            (
                range(100, 1001, 1),  # 100-1000, 每个都测试
                [1],                   # 固定001
                [1],                   # 固定01
                [0]                    # 固定0
            ),
            901  # 总测试数
        )

        # 阶段2：扩展第2段（XXX+YYY+01+0, YYY=1-10）
        self.scan_phase(
            "阶段2 - 扩展属编号 (XXX+YYY+01+0, YYY=1-10)",
            (
                range(100, 1001, 2),  # 100-1000, 步长2
                range(1, 11),          # 001-010
                [1],                   # 固定01
                [0]                    # 固定0
            ),
            4510  # 451 * 10
        )

        # 阶段3：扩展第3段（XXX+YYY+ZZ+0, ZZ=1-5）
        self.scan_phase(
            "阶段3 - 扩展种编号 (XXX+YYY+ZZ+0, ZZ=1-5)",
            (
                range(100, 1001, 5),  # 100-1000, 步长5
                range(1, 21),          # 001-020
                range(1, 6),           # 01-05
                [0]                    # 固定0
            ),
            18180  # 181 * 20 * 5
        )

        # 阶段4：扩展第4段（XXX+YYY+ZZ+W, W=0-2）
        self.scan_phase(
            "阶段4 - 扩展变种编号 (XXX+YYY+ZZ+W, W=0-2)",
            (
                range(100, 1001, 10), # 100-1000, 步长10
                range(1, 31),          # 001-030
                range(1, 6),           # 01-05
                range(0, 3)            # 0-2
            ),
            13680  # 91 * 30 * 5 * 3
        )

        print("\n" + "=" * 80)
        print("🎉 所有阶段完成！")
        print("=" * 80)

    def save_codes(self, filename='all_plant_codes.txt'):
        """保存编码"""
        output_file = Path(filename)
        sorted_codes = sorted(list(self.valid_codes))

        with open(output_file, 'w', encoding='utf-8') as f:
            for code in sorted_codes:
                f.write(code + '\n')

        json_file = output_file.with_suffix('.json')
        data = {
            'total_codes': len(self.valid_codes),
            'tested_count': self.tested_count,
            'created_at': datetime.now().isoformat(),
            'codes': sorted_codes
        }

        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"💾 已保存 {len(self.valid_codes):,} 个编码")

    def print_statistics(self):
        """打印统计"""
        elapsed = time.time() - self.start_time
        print("\n" + "=" * 80)
        print("📊 最终统计")
        print("=" * 80)
        print(f"🔍 测试总数: {self.tested_count:,}")
        print(f"✅ 有效编码: {len(self.valid_codes):,}")
        print(f"📈 有效率: {len(self.valid_codes)/self.tested_count*100:.2f}%")
        print(f"⏱️  总耗时: {elapsed/60:.1f} 分钟 ({elapsed/3600:.2f} 小时)")
        print(f"⚡ 平均速度: {self.tested_count/elapsed:.2f} 个/秒")
        print("=" * 80)


def main():
    print("=" * 80)
    print("🌿 智能植物编码发现器")
    print(f"🕐 启动时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    print()

    delay = 0.5
    if len(sys.argv) > 1:
        try:
            delay = float(sys.argv[1])
        except:
            pass

    print(f"⏱️  请求延迟: {delay} 秒")

    # 预估总时间
    total_tests = 901 + 4510 + 18180 + 13680  # 约 37,271 个
    print(f"📊 预计总测试: {total_tests:,} 个")
    print(f"⏱️  预计总耗时: {total_tests*delay/60:.1f} 分钟 ({total_tests*delay/3600:.2f} 小时)")
    print()

    # 自动开始（后台运行模式）
    print("🚀 自动开始扫描...")
    print()

    discovery = SmartPlantDiscovery(delay=delay)

    try:
        discovery.discover_smart()
        discovery.save_codes('all_plant_codes.txt')
        discovery.print_statistics()

        print("\n✅ 发现完成！")
        print(f"📝 下一步：python3 robust_crawler.py all_plant_codes.txt 1.5")

    except Exception as e:
        print(f"\n❌ 错误: {e}")
        discovery.save_codes('all_plant_codes_error.txt')


if __name__ == '__main__':
    main()
