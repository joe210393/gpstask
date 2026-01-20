#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增强版爬虫 - 防止中断和自动恢复
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import sys
from pathlib import Path
from datetime import datetime
import signal
import os


class RobustCrawler:
    """稳健的爬虫，能处理中断和自动恢复"""

    def __init__(self, codes_file='plant_codes.txt', output_dir='./plant_data', delay=1.5):
        self.base_url = "https://tai2.ntu.edu.tw"
        self.codes_file = codes_file
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.delay = delay

        # 设置 requests session
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Educational Research Bot)',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        })

        # 统计
        self.total = 0
        self.completed = 0
        self.skipped = 0
        self.failed = 0
        self.start_time = time.time()

        # 日志和状态文件
        self.log_file = self.output_dir / 'crawler.log'
        self.status_file = self.output_dir / 'crawler_status.json'
        self.failed_codes_file = self.output_dir / 'failed_codes.txt'

        # 处理中断信号
        signal.signal(signal.SIGINT, self.handle_interrupt)
        signal.signal(signal.SIGTERM, self.handle_interrupt)

    def log(self, message, level='INFO'):
        """记录日志"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_msg = f"[{timestamp}] [{level}] {message}"

        # 写入文件
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(log_msg + '\n')

        # 输出到控制台
        print(log_msg)
        sys.stdout.flush()

    def handle_interrupt(self, signum, frame):
        """处理中断信号"""
        self.log("⚠️  收到中断信号，正在保存状态...", 'WARN')
        self.save_status('interrupted')
        self.log(f"✅ 状态已保存。已完成: {self.completed}/{self.total}", 'INFO')
        sys.exit(0)

    def get_plant_data(self, code: str, max_retries=5):
        """获取植物数据，增强重试机制"""
        for attempt in range(max_retries):
            try:
                url = f"{self.base_url}/PlantInfo/species-name.php?code={code}"
                response = self.session.get(url, timeout=30)  # 增加超时时间

                if response.status_code != 200:
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt  # 指数退避: 1, 2, 4, 8, 16秒
                        self.log(f"⚠️  HTTP {response.status_code} [{code}] - 等待 {wait_time}s 后重试 ({attempt+1}/{max_retries})", 'WARN')
                        time.sleep(wait_time)
                        continue
                    return None

                soup = BeautifulSoup(response.text, 'html.parser')

                # 检查是否是有效页面
                title = soup.find('title')
                if title and 'Search-台灣植物資訊整合查詢系統' in title.text:
                    return None

                # 提取数据
                data = self.parse_plant_page(soup, code)
                return data

            except requests.exceptions.Timeout:
                wait_time = 5 * (attempt + 1)
                self.log(f"⏱️  超时 [{code}] - 等待 {wait_time}s 后重试 ({attempt+1}/{max_retries})", 'WARN')
                time.sleep(wait_time)

            except requests.exceptions.ConnectionError as e:
                wait_time = 10 * (attempt + 1)
                self.log(f"🔌 连接错误 [{code}] - {str(e)[:50]} - 等待 {wait_time}s 后重试 ({attempt+1}/{max_retries})", 'ERROR')
                time.sleep(wait_time)

            except Exception as e:
                self.log(f"❌ 未知错误 [{code}] - {str(e)}", 'ERROR')
                if attempt < max_retries - 1:
                    time.sleep(5)
                    continue
                return None

        return None

    def parse_plant_page(self, soup, code):
        """解析植物页面（简化版）"""
        data = {
            'code': code,
            'url': f"{self.base_url}/PlantInfo/species-name.php?code={code}",
            'crawled_at': datetime.now().isoformat()
        }

        # 提取标题/名称
        title = soup.find('title')
        if title:
            data['title'] = title.text.strip()

        # 提取学名
        name_tag = soup.find('span', class_='name')
        if name_tag:
            data['scientific_name'] = name_tag.text.strip()

        # 提取描述
        desc_tag = soup.find('div', class_='description')
        if desc_tag:
            data['description'] = desc_tag.text.strip()

        return data

    def save_plant_data(self, code, data):
        """保存植物数据"""
        # 将 + 转换为 _
        safe_code = code.replace('+', '_')
        file_path = self.output_dir / f"{safe_code}.json"

        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def save_status(self, status='running'):
        """保存当前状态"""
        elapsed = time.time() - self.start_time
        data = {
            'status': status,
            'total': self.total,
            'completed': self.completed,
            'skipped': self.skipped,
            'failed': self.failed,
            'progress': f"{self.completed}/{self.total}",
            'percentage': round(self.completed / self.total * 100, 2) if self.total > 0 else 0,
            'elapsed_seconds': round(elapsed, 2),
            'elapsed_hours': round(elapsed / 3600, 2),
            'updated_at': datetime.now().isoformat()
        }

        with open(self.status_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def load_codes(self):
        """加载植物编码列表"""
        with open(self.codes_file, 'r', encoding='utf-8') as f:
            codes = [line.strip() for line in f if line.strip()]
        return codes

    def get_completed_codes(self):
        """获取已完成的编码"""
        completed = set()
        if not self.output_dir.exists():
            return completed

        for file_path in self.output_dir.glob('*.json'):
            if file_path.name in ['crawler_status.json', 'all_plants.json']:
                continue
            # 从文件名还原编码
            code = file_path.stem.replace('_', '+')
            completed.add(code)

        return completed

    def crawl_all(self):
        """爬取所有植物"""
        self.log("=" * 80)
        self.log("🚀 启动稳健爬虫")
        self.log("=" * 80)

        # 加载编码
        all_codes = self.load_codes()
        self.total = len(all_codes)
        self.log(f"📝 总共 {self.total} 个植物编码")

        # 获取已完成的
        completed_codes = self.get_completed_codes()
        self.skipped = len(completed_codes)
        self.log(f"✅ 已完成 {self.skipped} 个，跳过")

        # 待处理的
        remaining_codes = [c for c in all_codes if c not in completed_codes]
        self.log(f"📋 待爬取 {len(remaining_codes)} 个")
        self.log(f"⏱️  预计耗时: {len(remaining_codes) * self.delay / 60:.1f} 分钟")
        self.log("=" * 80)

        # 开始爬取
        failed_codes = []

        for i, code in enumerate(remaining_codes, 1):
            self.log(f"\n[{i}/{len(remaining_codes)}] 爬取: {code}")

            # 获取数据
            data = self.get_plant_data(code)

            if data:
                self.save_plant_data(code, data)
                self.completed += 1
                self.log(f"  ✅ 成功保存", 'SUCCESS')
            else:
                self.failed += 1
                failed_codes.append(code)
                self.log(f"  ❌ 失败", 'ERROR')

            # 每10个保存一次状态
            if i % 10 == 0:
                self.save_status('running')
                self.log(f"📊 进度: {self.completed + self.skipped}/{self.total} ({(self.completed + self.skipped)/self.total*100:.1f}%)")

            # 延迟
            time.sleep(self.delay)

        # 保存失败的编码
        if failed_codes:
            with open(self.failed_codes_file, 'w', encoding='utf-8') as f:
                f.write('\n'.join(failed_codes))
            self.log(f"\n⚠️  {len(failed_codes)} 个失败的编码已保存到: {self.failed_codes_file}")

        # 完成
        self.save_status('completed')
        elapsed = time.time() - self.start_time

        self.log("\n" + "=" * 80)
        self.log("🎉 爬取完成！")
        self.log(f"✅ 成功: {self.completed} 个")
        self.log(f"⏭️  跳过: {self.skipped} 个（已存在）")
        self.log(f"❌ 失败: {self.failed} 个")
        self.log(f"📊 总计: {self.completed + self.skipped}/{self.total}")
        self.log(f"⏱️  总耗时: {elapsed/3600:.2f} 小时")
        self.log("=" * 80)


def main():
    codes_file = 'plant_codes.txt'
    delay = 1.5

    # 解析命令行参数
    if len(sys.argv) > 1:
        # 第一个参数可以是文件名或延迟时间
        arg1 = sys.argv[1]
        if arg1.endswith('.txt'):
            codes_file = arg1
            # 第二个参数是延迟时间
            if len(sys.argv) > 2:
                try:
                    delay = float(sys.argv[2])
                except:
                    pass
        else:
            # 第一个参数是延迟时间
            try:
                delay = float(arg1)
            except:
                pass

    print(f"📝 使用编码文件: {codes_file}")
    print(f"⏱️  请求延迟: {delay} 秒")
    print()

    crawler = RobustCrawler(codes_file=codes_file, delay=delay)
    crawler.crawl_all()


if __name__ == '__main__':
    main()
