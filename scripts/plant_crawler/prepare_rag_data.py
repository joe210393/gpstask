#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
準備 RAG 資料
將爬取的植物資料轉換為適合 RAG 的格式
生成用於向量搜尋的文本片段
"""

import json
import os
from pathlib import Path
from typing import List, Dict


class RAGDataPreparator:
    """RAG 資料準備器"""

    def __init__(self, input_file='./plant_data/rag_plants.json'):
        self.input_file = Path(input_file)
        self.documents = []

    def load_data(self) -> List[Dict]:
        """載入植物資料"""
        if not self.input_file.exists():
            raise FileNotFoundError(f"找不到資料檔案：{self.input_file}")

        with open(self.input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        plants = data.get('plants', [])
        print(f"✅ 載入了 {len(plants)} 個植物資料")

        return plants

    def prepare_documents(self, plants: List[Dict]) -> List[Dict]:
        """
        將植物資料轉換為 RAG 文件格式

        每個植物生成一個文件，包含：
        - id: 唯一識別碼
        - text: 用於搜尋的文本（英文描述 + 中文關鍵字）
        - metadata: 元資料（名稱、分類、URL 等）
        """
        documents = []

        for plant in plants:
            # 提取關鍵資訊
            nomenclature = plant.get('nomenclature', {})
            description = plant.get('description', {})
            photos = plant.get('photos', {})
            distribution = plant.get('distribution', {})

            # 構建搜尋文本
            text_parts = []

            # 1. 名稱資訊（中英文）
            name_zh = nomenclature.get('name_zh', '')
            name_latin = nomenclature.get('name_latin', '')
            family_zh = nomenclature.get('family_zh', '')

            if name_zh:
                text_parts.append(f"植物名稱：{name_zh}")
            if name_latin:
                text_parts.append(f"學名：{name_latin}")
            if family_zh:
                text_parts.append(f"科：{family_zh}")

            # 2. 特徵描述（英文）
            desc_en = description.get('description_en', '')
            if desc_en:
                text_parts.append(f"Description: {desc_en}")

            # 3. 生活型（如果有）
            life_form = description.get('life_form', '')
            if life_form:
                text_parts.append(f"Life form: {life_form}")

            # 4. 分布資訊（如果有）
            if distribution.get('has_distribution'):
                coords_count = len(distribution.get('coordinates', []))
                if coords_count > 0:
                    text_parts.append(f"分布地點數：{coords_count}")

            # 合併文本
            search_text = '\n'.join(text_parts)

            # 構建元資料
            metadata = {
                'code': plant.get('code', ''),
                'url': plant.get('url', ''),
                'name_zh': name_zh,
                'name_latin': name_latin,
                'family_zh': family_zh,
                'family': nomenclature.get('family', ''),
                'has_photos': photos.get('has_photos', False),
                'photo_count': photos.get('count', 0),
                'completeness_score': plant.get('completeness', {}).get('score', 0),
                'crawled_at': plant.get('crawled_at', '')
            }

            # 創建文件
            doc = {
                'id': plant.get('code', '').replace('+', '_'),
                'text': search_text,
                'metadata': metadata
            }

            documents.append(doc)

        return documents

    def save_rag_documents(self, documents: List[Dict], output_file='./plant_data/rag_documents.json'):
        """儲存 RAG 文件"""
        output = {
            'metadata': {
                'total_documents': len(documents),
                'created_at': __import__('time').strftime('%Y-%m-%d %H:%M:%S'),
                'description': '台灣植物 RAG 文件集',
                'format': 'Each document contains id, text (searchable), and metadata'
            },
            'documents': documents
        }

        output_path = Path(output_file)
        output_path.parent.mkdir(exist_ok=True, parents=True)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"✅ RAG 文件已儲存：{output_path}")
        print(f"   總文件數：{len(documents)}")

        # 同時儲存為 JSONL 格式（每行一個 JSON 物件，方便某些 RAG 框架使用）
        jsonl_file = output_path.with_suffix('.jsonl')
        with open(jsonl_file, 'w', encoding='utf-8') as f:
            for doc in documents:
                f.write(json.dumps(doc, ensure_ascii=False) + '\n')

        print(f"✅ JSONL 格式已儲存：{jsonl_file}")

        return output_path

    def generate_summary(self, documents: List[Dict]):
        """生成資料摘要"""
        print("\n" + "=" * 70)
        print("RAG 資料摘要")
        print("=" * 70)

        total = len(documents)
        with_photos = sum(1 for d in documents if d['metadata']['has_photos'])
        avg_score = sum(d['metadata']['completeness_score'] for d in documents) / total if total > 0 else 0

        print(f"\n總文件數：{total}")
        print(f"有照片：{with_photos} ({with_photos/total*100:.1f}%)")
        print(f"平均完整度：{avg_score:.2f}/5.0")

        # 按科統計
        families = {}
        for doc in documents:
            family = doc['metadata'].get('family_zh', '未知')
            families[family] = families.get(family, 0) + 1

        print(f"\n科別統計（前 10）：")
        for i, (family, count) in enumerate(sorted(families.items(), key=lambda x: x[1], reverse=True)[:10], 1):
            print(f"  {i}. {family}: {count} 種")

        # 文本長度統計
        text_lengths = [len(d['text']) for d in documents]
        avg_length = sum(text_lengths) / len(text_lengths) if text_lengths else 0
        min_length = min(text_lengths) if text_lengths else 0
        max_length = max(text_lengths) if text_lengths else 0

        print(f"\n文本長度統計：")
        print(f"  平均：{avg_length:.0f} 字元")
        print(f"  最短：{min_length} 字元")
        print(f"  最長：{max_length} 字元")

    def show_sample(self, documents: List[Dict], num_samples=3):
        """顯示範例文件"""
        print("\n" + "=" * 70)
        print("範例文件")
        print("=" * 70)

        for i, doc in enumerate(documents[:num_samples], 1):
            print(f"\n【範例 {i}】")
            print(f"ID: {doc['id']}")
            print(f"名稱：{doc['metadata']['name_zh']} ({doc['metadata']['name_latin']})")
            print(f"科：{doc['metadata']['family_zh']}")
            print(f"\n搜尋文本：")
            print("-" * 70)
            print(doc['text'][:300] + "..." if len(doc['text']) > 300 else doc['text'])
            print("-" * 70)


def main():
    """主函數"""
    print("=" * 70)
    print("準備 RAG 資料")
    print("=" * 70)

    # 創建準備器
    preparator = RAGDataPreparator(input_file='./plant_data/rag_plants.json')

    try:
        # 載入資料
        plants = preparator.load_data()

        # 轉換為 RAG 文件
        print("\n轉換為 RAG 文件格式...")
        documents = preparator.prepare_documents(plants)

        # 儲存
        preparator.save_rag_documents(documents, output_file='./plant_data/rag_documents.json')

        # 顯示摘要
        preparator.generate_summary(documents)

        # 顯示範例
        preparator.show_sample(documents, num_samples=3)

        print("\n" + "=" * 70)
        print("✅ RAG 資料準備完成！")
        print("=" * 70)
        print("\n下一步：")
        print("1. 使用 rag_documents.json 或 rag_documents.jsonl 建立向量資料庫")
        print("2. 可使用的向量模型：jinaai/jina-embeddings-v2-base-zh")
        print("3. 向量資料庫選擇：Chroma, FAISS, Pinecone, Weaviate 等")

    except FileNotFoundError as e:
        print(f"\n❌ 錯誤：{e}")
        print("\n請先運行 batch_crawler.py 爬取植物資料")
    except Exception as e:
        print(f"\n❌ 發生錯誤：{e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()
