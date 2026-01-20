#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
測試增強版 RAG 資料品質
比較原始版本與增強版本的差異
"""

import json
from pathlib import Path


def test_enhanced_rag():
    """測試增強版 RAG 資料"""

    print("=" * 70)
    print("增強版 RAG 資料品質測試")
    print("=" * 70)

    # 載入原始版本
    original_file = Path('./plant_data/rag_documents.json')
    enhanced_file = Path('./plant_data/rag_documents_enhanced.json')

    if not original_file.exists() or not enhanced_file.exists():
        print("❌ 找不到資料檔案")
        return

    with open(original_file, 'r', encoding='utf-8') as f:
        original_data = json.load(f)

    with open(enhanced_file, 'r', encoding='utf-8') as f:
        enhanced_data = json.load(f)

    original_docs = original_data.get('documents', [])
    enhanced_docs = enhanced_data.get('documents', [])

    print(f"\n📊 基本統計比較")
    print(f"{'項目':<30} {'原始版本':<15} {'增強版本':<15} {'改進':<10}")
    print("-" * 70)

    # 1. 文件數量
    print(f"{'文件數量':<30} {len(original_docs):<15} {len(enhanced_docs):<15} {'=':<10}")

    # 2. 平均文本長度
    orig_avg_len = sum(len(d['text']) for d in original_docs) / len(original_docs)
    enh_avg_len = sum(len(d['text']) for d in enhanced_docs) / len(enhanced_docs)
    improvement = (enh_avg_len - orig_avg_len) / orig_avg_len * 100

    print(f"{'平均文本長度（字元）':<30} {orig_avg_len:<15.0f} {enh_avg_len:<15.0f} {improvement:>+.1f}%")

    # 3. 結構化程度
    print(f"\n📋 新增功能統計")
    print("-" * 70)

    has_guide = sum(1 for d in enhanced_docs if d.get('identification_guide'))
    has_features = sum(1 for d in enhanced_docs if d.get('key_features'))
    avg_features = sum(len(d.get('key_features', [])) for d in enhanced_docs) / len(enhanced_docs)

    print(f"有識別指南的文件：{has_guide}/{len(enhanced_docs)} ({has_guide/len(enhanced_docs)*100:.1f}%)")
    print(f"有關鍵特徵的文件：{has_features}/{len(enhanced_docs)} ({has_features/len(enhanced_docs)*100:.1f}%)")
    print(f"平均關鍵特徵數：{avg_features:.1f} 個/植物")

    # 4. 識別指南覆蓋率統計
    print(f"\n🔍 識別指南特徵覆蓋率")
    print("-" * 70)

    feature_types = {
        '葉': 0, '花': 0, '果': 0, '莖': 0, '根': 0,
        '毛被': 0, '質地': 0, '樹皮': 0
    }

    for doc in enhanced_docs:
        guide = doc.get('identification_guide', '')
        for feature_type in feature_types.keys():
            if f'【{feature_type}】' in guide:
                feature_types[feature_type] += 1

    for feature_type, count in sorted(feature_types.items(), key=lambda x: x[1], reverse=True):
        if count > 0:
            percentage = count / len(enhanced_docs) * 100
            print(f"{feature_type}：{count}/{len(enhanced_docs)} ({percentage:.1f}%)")

    # 5. 對比範例
    print(f"\n📄 對比範例")
    print("=" * 70)

    # 選擇一個有豐富特徵的文件
    sample_id = enhanced_docs[2]['id']  # 第三個文件

    orig_doc = next(d for d in original_docs if d['id'] == sample_id)
    enh_doc = next(d for d in enhanced_docs if d['id'] == sample_id)

    print(f"\n植物：{enh_doc['metadata']['name_zh']} ({enh_doc['metadata']['name_latin']})")

    print(f"\n【原始版本】文本長度：{len(orig_doc['text'])} 字元")
    print("-" * 70)
    print(orig_doc['text'][:300] + "..." if len(orig_doc['text']) > 300 else orig_doc['text'])

    print(f"\n【增強版本】文本長度：{len(enh_doc['text'])} 字元")
    print("-" * 70)
    print(enh_doc['text'][:500] + "..." if len(enh_doc['text']) > 500 else enh_doc['text'])

    print("\n" + "-" * 70)
    print("新增識別指南：")
    print(enh_doc.get('identification_guide', '（無）'))

    print("\n新增關鍵特徵：")
    for i, feature in enumerate(enh_doc.get('key_features', []), 1):
        print(f"  {i}. {feature}")

    # 6. 品質評分
    print(f"\n" + "=" * 70)
    print("品質評分")
    print("=" * 70)

    score = 0
    max_score = 6

    # 評分標準
    if has_guide == len(enhanced_docs):
        score += 1
        print("✅ 所有文件都有識別指南")
    else:
        print(f"⚠️  識別指南覆蓋率：{has_guide/len(enhanced_docs)*100:.1f}%")

    if has_features == len(enhanced_docs):
        score += 1
        print("✅ 所有文件都有關鍵特徵")
    else:
        print(f"⚠️  關鍵特徵覆蓋率：{has_features/len(enhanced_docs)*100:.1f}%")

    if avg_features >= 3:
        score += 1
        print(f"✅ 平均關鍵特徵數充足（{avg_features:.1f}）")
    else:
        print(f"⚠️  平均關鍵特徵數偏少（{avg_features:.1f}）")

    if feature_types['葉'] > 0:
        score += 1
        print(f"✅ 有葉特徵資訊（{feature_types['葉']} 個）")

    if feature_types['莖'] > 0:
        score += 1
        print(f"✅ 有莖特徵資訊（{feature_types['莖']} 個）")

    if enh_avg_len > orig_avg_len:
        score += 1
        print(f"✅ 文本長度增加（+{improvement:.1f}%）")

    print(f"\n最終評分：{score}/{max_score}")

    if score >= 5:
        print("🎉 增強版 RAG 資料品質優秀！")
        print("\n✅ 主要改進：")
        print("1. 新增結構化識別指南（葉、花、果、莖、根）")
        print("2. 自動提取關鍵特徵（形狀、顏色、尺寸）")
        print("3. 文本長度增加，資訊更豐富")
        print("4. 更適合植物識別應用")
    elif score >= 4:
        print("⚠️  增強版 RAG 資料品質良好，仍有改進空間")
    else:
        print("❌ 增強版 RAG 資料需要進一步改進")

    print("\n" + "=" * 70)
    print("建議使用方式")
    print("=" * 70)
    print("\n1. 使用增強版資料進行植物識別")
    print("   - 中文查詢：「橢圓形葉子」→ 匹配 【葉】形狀資訊")
    print("   - 英文查詢：「lanceolate leaves」→ 匹配詳細描述")
    print("   - 混合查詢：「綠色的莖」→ 匹配 【莖】顏色資訊")

    print("\n2. 向量模型建議")
    print("   - jinaai/jina-embeddings-v2-base-zh（跨語言）")
    print("   - 或 text-embedding-3-small（OpenAI）")

    print("\n3. RAG 檢索策略")
    print("   - 先用向量搜尋找到候選植物（Top 5-10）")
    print("   - 根據「識別指南」進行二次篩選")
    print("   - 使用「關鍵特徵」生成回答")

    print("\n" + "=" * 70)


def compare_specific_examples():
    """比較具體範例"""
    print("\n" + "=" * 70)
    print("詳細範例對比")
    print("=" * 70)

    enhanced_file = Path('./plant_data/rag_documents_enhanced.jsonl')

    if not enhanced_file.exists():
        return

    with open(enhanced_file, 'r', encoding='utf-8') as f:
        docs = [json.loads(line) for line in f]

    # 找出特徵最豐富的 3 個
    sorted_docs = sorted(docs, key=lambda d: len(d.get('identification_guide', '')), reverse=True)

    print(f"\n特徵最豐富的 3 個植物：\n")

    for i, doc in enumerate(sorted_docs[:3], 1):
        print(f"{i}. {doc['metadata']['name_zh']} ({doc['metadata']['name_latin']})")
        print(f"   識別指南長度：{len(doc.get('identification_guide', ''))} 字元")
        print(f"   關鍵特徵數：{len(doc.get('key_features', []))} 個")

        guide = doc.get('identification_guide', '')
        if guide:
            # 統計特徵類型
            types = []
            for t in ['葉', '花', '果', '莖', '根', '毛被', '質地']:
                if f'【{t}】' in guide:
                    types.append(t)
            print(f"   特徵類型：{', '.join(types)}")

        print()


if __name__ == '__main__':
    test_enhanced_rag()
    compare_specific_examples()
