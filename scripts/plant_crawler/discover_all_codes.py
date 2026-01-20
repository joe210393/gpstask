#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全面植物编码发现器
自动发现台湾植物资料库中所有有效的植物编码
"""

import requests
from bs4 import BeautifulSoup
import time
import json
import sys
from pathlib import Path
from datetime import datetime


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
            print(f"  ⚠️  错误: {str(e)[:50]}")
            return False

    def discover_range(self, part1_range, part2_range, part3_range, part4_range):
        """
        发现指定范围内的有效编码

        编码格式：AAA+BBB+CC+D
        例如：105+001+01+0
        """
        print(f"\n🔍 开始扫描范围:")
        print(f"   第1段: {part1_range}")
        print(f"   第2段: {part2_range}")
        print(f"   第3段: {part3_range}")
        print(f"   第4段: {part4_range}")
        print()

        total_tests = len(part1_range) * len(part2_range) * len(part3_range) * len(part4_range)
        print(f"📊 预计测试: {total_tests} 个编码")
        print(f"⏱️  预计耗时: {total_tests * self.delay / 60:.1f} 分钟 ({total_tests * self.delay / 3600:.2f} 小时)")
        print("=" * 80)

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
                            print(f"📊 进度: {current_test}/{total_tests} ({current_test/total_tests*100:.1f}%) "
                                  f"| 有效: {len(self.valid_codes)} | "
                                  f"剩余: {remaining/60:.1f}分钟")

                        # 测试编码
                        is_valid = self.test_code(code)
                        self.tested_count += 1

                        if is_valid:
                            self.valid_codes.append(code)
                            print(f"  ✅ 找到: {code} (总计: {len(self.valid_codes)})")

                        # 延迟
                        time.sleep(self.delay)

    def save_codes(self, filename='all_plant_codes.txt'):
        """保存发现的编码"""
        output_file = Path(filename)

        # 保存为文本文件
        with open(output_file, 'w', encoding='utf-8') as f:
            for code in sorted(self.valid_codes):
                f.write(code + '\n')

        print(f"\n✅ 已保存 {len(self.valid_codes)} 个编码到: {output_file}")

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

        # 生成统计信息
        self.print_statistics()

    def print_statistics(self):
        """打印统计信息"""
        elapsed = time.time() - self.start_time

        print("\n" + "=" * 80)
        print("📊 发现统计")
        print("=" * 80)
        print(f"🔍 测试编码数: {self.tested_count}")
        print(f"✅ 有效编码数: {len(self.valid_codes)}")
        print(f"📈 有效率: {len(self.valid_codes)/self.tested_count*100:.2f}%")
        print(f"⏱️  总耗时: {elapsed/3600:.2f} 小时")
        print(f"⚡ 平均速度: {self.tested_count/elapsed:.2f} 个/秒")
        print("=" * 80)


def main():
    """主函数"""
    print("=" * 80)
    print("🌿 台湾植物编码全面发现器")
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

    # 用户确认
    print("⚠️  注意事项:")
    print("   - 全面扫描需要较长时间（可能数小时到数天）")
    print("   - 请确保网络连接稳定")
    print("   - 请确保电脑不会进入睡眠")
    print("   - 建议先运行快速扫描模式测试")
    print()

    # 选择模式
    print("请选择扫描模式:")
    print("1. 快速模式（约 1-2 小时，扫描主要范围）")
    print("2. 标准模式（约 4-8 小时，扫描常见范围）")
    print("3. 完整模式（约 24-48 小时，扫描所有可能范围）")
    print("4. 自定义模式")
    print()

    choice = input("请输入选择 (1-4): ").strip()

    discovery = PlantCodeDiscovery(delay=delay)

    if choice == '1':
        # 快速模式：扫描主要范围
        print("\n🚀 快速模式")
        discovery.discover_range(
            part1_range=range(100, 601, 5),     # 100-600, 步长5
            part2_range=range(1, 51),           # 001-050
            part3_range=range(1, 11),           # 01-10
            part4_range=range(0, 2)             # 0-1
        )

    elif choice == '2':
        # 标准模式：扫描常见范围
        print("\n⚡ 标准模式")
        discovery.discover_range(
            part1_range=range(100, 1001, 5),    # 100-1000, 步长5
            part2_range=range(1, 101),          # 001-100
            part3_range=range(1, 21),           # 01-20
            part4_range=range(0, 3)             # 0-2
        )

    elif choice == '3':
        # 完整模式：扫描所有可能范围
        print("\n🔥 完整模式 - 这将需要很长时间！")
        confirm = input("确定要继续吗？(yes/no): ").strip().lower()
        if confirm != 'yes':
            print("已取消")
            return

        discovery.discover_range(
            part1_range=range(100, 1001, 1),    # 100-1000, 步长1
            part2_range=range(1, 201),          # 001-200
            part3_range=range(1, 51),           # 01-50
            part4_range=range(0, 10)            # 0-9
        )

    elif choice == '4':
        # 自定义模式
        print("\n⚙️  自定义模式")
        print("编码格式: AAA+BBB+CC+D")
        print("例如: 105+001+01+0")
        print()

        try:
            p1_start = int(input("第1段起始值 (默认100): ") or "100")
            p1_end = int(input("第1段结束值 (默认600): ") or "600")
            p1_step = int(input("第1段步长 (默认5): ") or "5")

            p2_start = int(input("第2段起始值 (默认1): ") or "1")
            p2_end = int(input("第2段结束值 (默认50): ") or "50")

            p3_start = int(input("第3段起始值 (默认1): ") or "1")
            p3_end = int(input("第3段结束值 (默认10): ") or "10")

            p4_start = int(input("第4段起始值 (默认0): ") or "0")
            p4_end = int(input("第4段结束值 (默认1): ") or "1")

            discovery.discover_range(
                part1_range=range(p1_start, p1_end + 1, p1_step),
                part2_range=range(p2_start, p2_end + 1),
                part3_range=range(p3_start, p3_end + 1),
                part4_range=range(p4_start, p4_end + 1)
            )

        except ValueError:
            print("❌ 输入错误，已取消")
            return

    else:
        print("❌ 无效选择")
        return

    # 保存结果
    discovery.save_codes('all_plant_codes.txt')

    print("\n✅ 发现完成！")
    print(f"📝 下一步：使用 robust_crawler.py 爬取所有植物数据")
    print(f"   python3 robust_crawler.py all_plant_codes.txt")


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  用户中断")
        print("💡 提示：已发现的编码不会丢失，可以查看临时文件")
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()
