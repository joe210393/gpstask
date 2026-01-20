#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
測試 RAG 資料品質
檢查 RAG 文件的完整性和可用性
"""

import json
from pathlib import Path


def test_rag_documents():
    """測試 RAG 文件品質"""

    print("=" * 70)
    print("RAG 資料品質測試")
    print("=" * 70)

    # 載入資料
    rag_file = Path('./plant_data/rag_documents.json')
    if not rag_file.exists():
        print("❌ 找不到 rag_documents.json")
        return

    with open(rag_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    documents = data.get('documents', [])
    metadata = data.get('metadata', {})

    print(f"\n📋 基本資訊：")
    print(f"   總文件數：{metadata.get('total_documents', 0)}")
    print(f"   建立時間：{metadata.get('created_at', 'N/A')}")

    # 測試 1：檢查文件結構
    print(f"\n🔍 測試 1：文件結構檢查")
    issues = []

    for i, doc in enumerate(documents, 1):
        # 檢查必要欄位
        if 'id' not in doc:
            issues.append(f"文件 {i} 缺少 id")
        if 'text' not in doc:
            issues.append(f"文件 {i} 缺少 text")
        if 'metadata' not in doc:
            issues.append(f"文件 {i} 缺少 metadata")

        # 檢查文本不為空
        if doc.get('text', '').strip() == '':
            issues.append(f"文件 {i} ({doc.get('id', 'unknown')}) 文本為空")

    if issues:
        print(f"   ❌ 發現 {len(issues)} 個問題：")
        for issue in issues[:5]:  # 只顯示前 5 個
            print(f"      - {issue}")
    else:
        print(f"   ✅ 所有文件結構完整")

    # 測試 2：文本品質分析
    print(f"\n📊 測試 2：文本品質分析")

    text_lengths = [len(doc['text']) for doc in documents]
    avg_length = sum(text_lengths) / len(text_lengths) if text_lengths else 0

    # 檢查是否有足夠的描述文本
    short_texts = [doc for doc in documents if len(doc.get('text', '')) < 100]
    long_texts = [doc for doc in documents if len(doc.get('text', '')) > 500]

    print(f"   平均文本長度：{avg_length:.0f} 字元")
    print(f"   過短文本（<100 字元）：{len(short_texts)} 個")
    print(f"   良好長度（>500 字元）：{len(long_texts)} 個")

    if len(short_texts) > len(documents) * 0.3:
        print(f"   ⚠️  警告：{len(short_texts)/len(documents)*100:.1f}% 的文本過短")
    else:
        print(f"   ✅ 文本長度品質良好")

    # 測試 3：中英文內容檢查
    print(f"\n🌐 測試 3：中英文內容檢查")

    has_chinese = 0
    has_english = 0
    has_both = 0

    for doc in documents:
        text = doc.get('text', '')
        chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
        english_chars = sum(1 for c in text if c.isalpha() and ord(c) < 128)

        if chinese_chars > 0:
            has_chinese += 1
        if english_chars > 20:  # 至少 20 個英文字母
            has_english += 1
        if chinese_chars > 0 and english_chars > 20:
            has_both += 1

    print(f"   包含中文：{has_chinese}/{len(documents)} ({has_chinese/len(documents)*100:.1f}%)")
    print(f"   包含英文：{has_english}/{len(documents)} ({has_english/len(documents)*100:.1f}%)")
    print(f"   中英混合：{has_both}/{len(documents)} ({has_both/len(documents)*100:.1f}%)")

    if has_both > len(documents) * 0.8:
        print(f"   ✅ 大部分文件都有中英文內容，適合跨語言檢索")
    else:
        print(f"   ⚠️  部分文件缺少中文或英文內容")

    # 測試 4：元資料完整性
    print(f"\n📝 測試 4：元資料完整性")

    has_name_zh = sum(1 for doc in documents if doc.get('metadata', {}).get('name_zh'))
    has_name_latin = sum(1 for doc in documents if doc.get('metadata', {}).get('name_latin'))
    has_url = sum(1 for doc in documents if doc.get('metadata', {}).get('url'))

    print(f"   有中文名：{has_name_zh}/{len(documents)} ({has_name_zh/len(documents)*100:.1f}%)")
    print(f"   有學名：{has_name_latin}/{len(documents)} ({has_name_latin/len(documents)*100:.1f}%)")
    print(f"   有 URL：{has_url}/{len(documents)} ({has_url/len(documents)*100:.1f}%)")

    if has_name_zh > len(documents) * 0.9 and has_name_latin > len(documents) * 0.9:
        print(f"   ✅ 元資料完整性良好")
    else:
        print(f"   ⚠️  部分元資料不完整")

    # 測試 5：範例展示
    print(f"\n📄 測試 5：隨機範例展示")

    import random
    sample_doc = random.choice(documents)

    print(f"\n   文件 ID：{sample_doc['id']}")
    print(f"   植物名稱：{sample_doc['metadata'].get('name_zh', 'N/A')} ({sample_doc['metadata'].get('name_latin', 'N/A')})")
    print(f"   完整度評分：{sample_doc['metadata'].get('completeness_score', 'N/A')}/5.0")
    print(f"   文本長度：{len(sample_doc['text'])} 字元")
    print(f"\n   文本預覽：")
    print(f"   {'-'*66}")
    preview = sample_doc['text'][:200] + "..." if len(sample_doc['text']) > 200 else sample_doc['text']
    print(f"   {preview}")
    print(f"   {'-'*66}")

    # 總結
    print(f"\n" + "=" * 70)
    print("測試總結")
    print("=" * 70)

    score = 0
    max_score = 5

    if not issues:
        score += 1
    if len(short_texts) < len(documents) * 0.3:
        score += 1
    if has_both > len(documents) * 0.8:
        score += 1
    if has_name_zh > len(documents) * 0.9:
        score += 1
    if has_name_latin > len(documents) * 0.9:
        score += 1

    print(f"\n✅ 品質評分：{score}/{max_score}")

    if score >= 4:
        print("🎉 RAG 資料品質優秀，可以使用！")
        print("\n建議的使用方式：")
        print("1. 使用 jinaai/jina-embeddings-v2-base-zh 建立向量索引")
        print("2. 支援中文查詢自動匹配英文描述（跨語言檢索）")
        print("3. 可直接部署到生產環境")
    elif score >= 3:
        print("⚠️  RAG 資料品質尚可，建議改進後使用")
    else:
        print("❌ RAG 資料品質不足，需要改進")

    print("\n" + "=" * 70)


if __name__ == '__main__':
    test_rag_documents()
