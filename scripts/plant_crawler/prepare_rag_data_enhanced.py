#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增強版 RAG 資料準備器
從植物描述中提取結構化的識別重點
"""

import json
import re
from pathlib import Path
from typing import List, Dict, Tuple


class PlantFeatureExtractor:
    """植物特徵提取器"""

    def __init__(self):
        # 形態特徵關鍵字
        self.morphology_keywords = {
            'leaf': ['leaf', 'leaves', 'lamina', 'laminae', 'frond', 'fronds', 'pinnae', 'pinnules', 'leaflet'],
            'flower': ['flower', 'flowers', 'petal', 'petals', 'corolla', 'calyx', 'inflorescence', 'raceme', 'panicle'],
            'fruit': ['fruit', 'fruits', 'berry', 'berries', 'capsule', 'pod', 'achene', 'drupe'],
            'stem': ['stem', 'stems', 'stipe', 'stipes', 'trunk', 'branch', 'branches', 'twig'],
            'root': ['root', 'roots', 'rhizome', 'tuber', 'rootstock'],
            'bark': ['bark', 'cortex'],
            'hair': ['hair', 'hairs', 'pubescent', 'hairy', 'tomentose', 'villous', 'glabrous', 'glabrescent'],
            'texture': ['herbaceous', 'coriaceous', 'membranous', 'chartaceous'],
        }

        # 顏色關鍵字
        self.color_keywords = [
            'white', 'red', 'pink', 'yellow', 'orange', 'purple', 'blue', 'green',
            'brown', 'black', 'gray', 'grey', 'golden', 'silvery', 'reddish',
            'brownish', 'greenish', 'yellowish', 'whitish'
        ]

        # 形狀關鍵字
        self.shape_keywords = [
            'ovate', 'lanceolate', 'oblong', 'elliptic', 'linear', 'orbicular',
            'cordate', 'reniform', 'triangular', 'rhombic', 'oblanceolate',
            'oval', 'round', 'rounded', 'acute', 'obtuse', 'truncate'
        ]

        # 尺寸模式
        self.size_pattern = re.compile(r'(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\s+(tall|long|wide|across|in diameter)', re.IGNORECASE)
        self.simple_size_pattern = re.compile(r'(\d+(?:\.\d+)?)\s*(mm|cm|m)\s+(tall|long|wide|across)', re.IGNORECASE)

    def extract_sentences_with_keyword(self, text: str, keywords: List[str]) -> List[str]:
        """提取包含關鍵字的句子"""
        # 分句
        sentences = re.split(r'[.;]\s*', text)

        matched_sentences = []
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            # 檢查是否包含任何關鍵字
            for keyword in keywords:
                if re.search(r'\b' + keyword + r'\b', sentence, re.IGNORECASE):
                    matched_sentences.append(sentence)
                    break

        return matched_sentences

    def extract_colors(self, text: str) -> List[str]:
        """提取顏色描述"""
        colors = []
        text_lower = text.lower()

        for color in self.color_keywords:
            if re.search(r'\b' + color + r'\b', text_lower):
                colors.append(color)

        return list(set(colors))

    def extract_shapes(self, text: str) -> List[str]:
        """提取形狀描述"""
        shapes = []
        text_lower = text.lower()

        for shape in self.shape_keywords:
            if re.search(r'\b' + shape + r'\b', text_lower):
                shapes.append(shape)

        return list(set(shapes))

    def extract_sizes(self, text: str) -> List[Dict[str, str]]:
        """提取尺寸描述"""
        sizes = []

        # 匹配範圍型尺寸：20-160 cm tall
        for match in self.size_pattern.finditer(text):
            sizes.append({
                'min': match.group(1),
                'max': match.group(2),
                'unit': match.group(3),
                'dimension': match.group(4),
                'text': match.group(0)
            })

        # 匹配簡單尺寸：1 m tall
        for match in self.simple_size_pattern.finditer(text):
            sizes.append({
                'value': match.group(1),
                'unit': match.group(2),
                'dimension': match.group(3),
                'text': match.group(0)
            })

        return sizes

    def extract_morphology(self, description: str) -> Dict[str, any]:
        """提取形態特徵"""
        features = {}

        for category, keywords in self.morphology_keywords.items():
            sentences = self.extract_sentences_with_keyword(description, keywords)
            if sentences:
                features[category] = {
                    'sentences': sentences,
                    'colors': self.extract_colors(' '.join(sentences)),
                    'shapes': self.extract_shapes(' '.join(sentences)),
                    'sizes': self.extract_sizes(' '.join(sentences))
                }

        return features

    def extract_key_features(self, description: str) -> List[str]:
        """提取關鍵識別特徵（最顯著的特徵）"""
        key_features = []

        # 1. 提取包含尺寸的重要描述
        sizes = self.extract_sizes(description)
        if sizes:
            # 選擇最大的尺寸（通常是整體大小）
            largest = max(sizes, key=lambda x: float(x.get('max', x.get('value', 0))))
            key_features.append(largest['text'])

        # 2. 提取顏色描述
        colors = self.extract_colors(description)
        if colors:
            color_sentence = self.extract_sentences_with_keyword(description, colors)
            if color_sentence:
                key_features.append(color_sentence[0][:100])

        # 3. 提取特殊形狀
        shapes = self.extract_shapes(description)
        if shapes:
            shape_sentence = self.extract_sentences_with_keyword(description, shapes)
            if shape_sentence:
                key_features.append(shape_sentence[0][:100])

        # 4. 提取獨特的毛被特徵
        hair_sentences = self.extract_sentences_with_keyword(description, self.morphology_keywords['hair'])
        if hair_sentences:
            key_features.append(hair_sentences[0][:100])

        return key_features[:5]  # 最多 5 個關鍵特徵


class EnhancedRAGPreparator:
    """增強版 RAG 資料準備器"""

    def __init__(self, input_file='./plant_data/rag_plants.json'):
        self.input_file = Path(input_file)
        self.extractor = PlantFeatureExtractor()

    def load_data(self) -> List[Dict]:
        """載入植物資料"""
        if not self.input_file.exists():
            raise FileNotFoundError(f"找不到資料檔案：{self.input_file}")

        with open(self.input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        plants = data.get('plants', [])
        print(f"✅ 載入了 {len(plants)} 個植物資料")

        return plants

    def create_identification_guide(self, plant: Dict) -> str:
        """創建識別指南（中文）"""
        guide_parts = []

        description = plant.get('description', {})
        desc_en = description.get('description_en', '')

        if not desc_en:
            return ""

        # 提取形態特徵
        morphology = self.extractor.extract_morphology(desc_en)

        # 1. 葉的特徵
        if 'leaf' in morphology:
            leaf_info = morphology['leaf']
            parts = ["【葉】"]

            if leaf_info['shapes']:
                parts.append(f"形狀：{', '.join(leaf_info['shapes'])}")
            if leaf_info['colors']:
                parts.append(f"顏色：{', '.join(leaf_info['colors'])}")
            if leaf_info['sizes']:
                size_texts = [s['text'] for s in leaf_info['sizes'][:2]]
                parts.append(f"尺寸：{'; '.join(size_texts)}")

            if len(parts) > 1:
                guide_parts.append(' | '.join(parts))

        # 2. 花的特徵
        if 'flower' in morphology:
            flower_info = morphology['flower']
            parts = ["【花】"]

            if flower_info['colors']:
                parts.append(f"顏色：{', '.join(flower_info['colors'])}")
            if flower_info['shapes']:
                parts.append(f"形狀：{', '.join(flower_info['shapes'])}")

            if len(parts) > 1:
                guide_parts.append(' | '.join(parts))

        # 3. 果的特徵
        if 'fruit' in morphology:
            fruit_info = morphology['fruit']
            parts = ["【果】"]

            if fruit_info['colors']:
                parts.append(f"顏色：{', '.join(fruit_info['colors'])}")
            if fruit_info['shapes']:
                parts.append(f"形狀：{', '.join(fruit_info['shapes'])}")

            if len(parts) > 1:
                guide_parts.append(' | '.join(parts))

        # 4. 莖的特徵
        if 'stem' in morphology:
            stem_info = morphology['stem']
            parts = ["【莖】"]

            if stem_info['sizes']:
                size_texts = [s['text'] for s in stem_info['sizes'][:2]]
                parts.append(f"尺寸：{'; '.join(size_texts)}")
            if stem_info['colors']:
                parts.append(f"顏色：{', '.join(stem_info['colors'])}")

            if len(parts) > 1:
                guide_parts.append(' | '.join(parts))

        # 5. 根的特徵
        if 'root' in morphology:
            root_info = morphology['root']
            parts = ["【根】"]

            if root_info['sentences']:
                # 提取第一句作為描述
                desc = root_info['sentences'][0][:80]
                parts.append(desc)

            if len(parts) > 1:
                guide_parts.append(' | '.join(parts))

        # 6. 毛被特徵
        if 'hair' in morphology:
            hair_info = morphology['hair']
            if hair_info['sentences']:
                guide_parts.append(f"【毛被】{hair_info['sentences'][0][:100]}")

        # 7. 質地
        if 'texture' in morphology:
            texture_info = morphology['texture']
            if texture_info['sentences']:
                guide_parts.append(f"【質地】{texture_info['sentences'][0][:80]}")

        return '\n'.join(guide_parts)

    def prepare_enhanced_documents(self, plants: List[Dict]) -> List[Dict]:
        """準備增強版 RAG 文件"""
        documents = []

        for plant in plants:
            nomenclature = plant.get('nomenclature', {})
            description = plant.get('description', {})
            distribution = plant.get('distribution', {})

            # 基本資訊
            name_zh = nomenclature.get('name_zh', '')
            name_latin = nomenclature.get('name_latin', '')
            family_zh = nomenclature.get('family_zh', '')
            desc_en = description.get('description_en', '')

            # 提取關鍵特徵
            key_features = self.extractor.extract_key_features(desc_en)

            # 創建識別指南
            identification_guide = self.create_identification_guide(plant)

            # 構建增強版搜尋文本
            text_parts = []

            # 第一部分：基本資訊
            text_parts.append("=== 基本資訊 ===")
            if name_zh:
                text_parts.append(f"植物名稱：{name_zh}")
            if name_latin:
                text_parts.append(f"學名：{name_latin}")
            if family_zh:
                text_parts.append(f"科：{family_zh}")

            # 第二部分：識別重點
            if identification_guide:
                text_parts.append("\n=== 識別重點 ===")
                text_parts.append(identification_guide)

            # 第三部分：關鍵特徵
            if key_features:
                text_parts.append("\n=== 顯著特徵 ===")
                for i, feature in enumerate(key_features, 1):
                    text_parts.append(f"{i}. {feature}")

            # 第四部分：完整描述
            if desc_en:
                text_parts.append("\n=== 詳細描述 ===")
                text_parts.append(desc_en)

            # 第五部分：分布資訊
            if distribution.get('has_distribution'):
                coords_count = len(distribution.get('coordinates', []))
                if coords_count > 0:
                    text_parts.append(f"\n=== 分布 ===")
                    text_parts.append(f"已記錄分布地點：{coords_count} 處")

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
                'has_photos': plant.get('photos', {}).get('has_photos', False),
                'photo_count': plant.get('photos', {}).get('count', 0),
                'completeness_score': plant.get('completeness', {}).get('score', 0),
                'crawled_at': plant.get('crawled_at', ''),
                'key_features_count': len(key_features),
                'has_identification_guide': bool(identification_guide)
            }

            # 創建文件
            doc = {
                'id': plant.get('code', '').replace('+', '_'),
                'text': search_text,
                'metadata': metadata,
                'key_features': key_features,
                'identification_guide': identification_guide
            }

            documents.append(doc)

        return documents

    def save_enhanced_documents(self, documents: List[Dict], output_file='./plant_data/rag_documents_enhanced.json'):
        """儲存增強版 RAG 文件"""
        output = {
            'metadata': {
                'total_documents': len(documents),
                'created_at': __import__('time').strftime('%Y-%m-%d %H:%M:%S'),
                'description': '台灣植物 RAG 文件集（增強版 - 含識別重點）',
                'format': 'Enhanced with identification guide and key features',
                'features': [
                    '結構化識別重點（葉、花、果、莖、根）',
                    '關鍵特徵提取',
                    '形態特徵分類',
                    '尺寸、顏色、形狀資訊'
                ]
            },
            'documents': documents
        }

        output_path = Path(output_file)
        output_path.parent.mkdir(exist_ok=True, parents=True)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"✅ 增強版 RAG 文件已儲存：{output_path}")
        print(f"   總文件數：{len(documents)}")

        # 同時儲存為 JSONL 格式
        jsonl_file = output_path.with_suffix('.jsonl')
        with open(jsonl_file, 'w', encoding='utf-8') as f:
            for doc in documents:
                f.write(json.dumps(doc, ensure_ascii=False) + '\n')

        print(f"✅ JSONL 格式已儲存：{jsonl_file}")

        return output_path

    def generate_summary(self, documents: List[Dict]):
        """生成資料摘要"""
        print("\n" + "=" * 70)
        print("增強版 RAG 資料摘要")
        print("=" * 70)

        total = len(documents)
        has_guide = sum(1 for d in documents if d.get('identification_guide'))
        has_features = sum(1 for d in documents if d.get('key_features'))
        avg_features = sum(len(d.get('key_features', [])) for d in documents) / total if total > 0 else 0

        print(f"\n總文件數：{total}")
        print(f"有識別指南：{has_guide} ({has_guide/total*100:.1f}%)")
        print(f"有關鍵特徵：{has_features} ({has_features/total*100:.1f}%)")
        print(f"平均特徵數：{avg_features:.1f} 個/植物")

        # 文本長度統計
        text_lengths = [len(d['text']) for d in documents]
        avg_length = sum(text_lengths) / len(text_lengths) if text_lengths else 0

        print(f"\n文本長度統計：")
        print(f"  平均：{avg_length:.0f} 字元")
        print(f"  最短：{min(text_lengths)} 字元")
        print(f"  最長：{max(text_lengths)} 字元")

    def show_sample(self, documents: List[Dict], num_samples=2):
        """顯示範例文件"""
        print("\n" + "=" * 70)
        print("範例文件")
        print("=" * 70)

        for i, doc in enumerate(documents[:num_samples], 1):
            print(f"\n【範例 {i}】")
            print(f"ID: {doc['id']}")
            print(f"名稱：{doc['metadata']['name_zh']} ({doc['metadata']['name_latin']})")
            print(f"關鍵特徵數：{len(doc.get('key_features', []))}")
            print(f"有識別指南：{'是' if doc.get('identification_guide') else '否'}")

            print(f"\n識別指南：")
            print("-" * 70)
            if doc.get('identification_guide'):
                print(doc['identification_guide'])
            else:
                print("（無）")
            print("-" * 70)

            print(f"\n關鍵特徵：")
            for j, feature in enumerate(doc.get('key_features', []), 1):
                print(f"  {j}. {feature}")


def main():
    """主函數"""
    print("=" * 70)
    print("增強版 RAG 資料準備器")
    print("提取植物識別重點")
    print("=" * 70)

    preparator = EnhancedRAGPreparator(input_file='./plant_data/rag_plants.json')

    try:
        # 載入資料
        plants = preparator.load_data()

        # 轉換為增強版 RAG 文件
        print("\n轉換為增強版 RAG 文件格式...")
        documents = preparator.prepare_enhanced_documents(plants)

        # 儲存
        preparator.save_enhanced_documents(documents, output_file='./plant_data/rag_documents_enhanced.json')

        # 顯示摘要
        preparator.generate_summary(documents)

        # 顯示範例
        preparator.show_sample(documents, num_samples=2)

        print("\n" + "=" * 70)
        print("✅ 增強版 RAG 資料準備完成！")
        print("=" * 70)
        print("\n新增功能：")
        print("1. ✅ 結構化識別重點（葉、花、果、莖、根）")
        print("2. ✅ 自動提取關鍵特徵")
        print("3. ✅ 顏色、形狀、尺寸資訊")
        print("4. ✅ 適合植物識別的 RAG 應用")

    except FileNotFoundError as e:
        print(f"\n❌ 錯誤：{e}")
        print("\n請先運行 batch_crawler.py 爬取植物資料")
    except Exception as e:
        print(f"\n❌ 發生錯誤：{e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()
