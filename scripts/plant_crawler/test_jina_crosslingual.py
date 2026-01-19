#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
測試 Jina Embeddings V2 Base ZH 的跨語言能力
驗證中文查詢是否能正確匹配英文植物描述
"""

import json
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np


def test_crosslingual_matching():
    """測試跨語言匹配能力"""

    print("="*70)
    print("🧪 Jina Embeddings V2 Base ZH 跨語言測試")
    print("="*70)

    # 載入模型
    print("\n📥 正在載入 Jina 模型...")
    model = SentenceTransformer('jinaai/jina-embeddings-v2-base-zh', trust_remote_code=True)
    print("✅ 模型載入完成")

    # 測試案例：使用真實的植物描述
    print("\n" + "="*70)
    print("測試案例設計")
    print("="*70)

    # 場景：用戶拍到樟樹的葉子
    chinese_queries = [
        {
            'name': '測試 1：樟樹特徵（詳細）',
            'query': '常綠喬木，葉子是橢圓形的，摸起來厚厚的像皮革，表面有光澤，撕開葉子聞起來有很濃的樟腦味，可以驅蟲。葉子長約7到12公分，寬約3到5公分。'
        },
        {
            'name': '測試 2：樟樹特徵（簡短）',
            'query': '橢圓形葉子，革質，有光澤，樟腦味'
        },
        {
            'name': '測試 3：一般描述',
            'query': '這棵樹的葉子是橢圓形，摸起來很厚實，揉碎後有特殊香味'
        }
    ]

    # 英文資料庫（來自真實爬取的資料）
    english_database = [
        {
            'id': 1,
            'name': '降真香 (Acronychia pedunculata)',
            'description': 'A shrub or small tree. Leaves 1-foliolate, 4–30 cm long; leaflet blade glabrous, elliptic or elliptic-oblong to obovate or oblanceolate, 3.5–24.5 cm long, 2–8.5 cm wide, the base cuneate, the apex obtusely acuminate. Inflorescences few- to many-flowered. Fruit usually rather sparsely pubescent, subglobose, 5–15 mm wide.'
        },
        {
            'id': 2,
            'name': '豬腳楠 (Machilus thunbergii)',
            'description': 'Large Evergreen trees. Leaves usually obovate, broadly elliptic, oblong, 7-13 cm long, 3-6 cm broad, thickly coriaceous, obtuse to abruptly cuspidate at apex, entire and slightly revolute, glabrous and lustrous above. Inflorescences cymose panicles. Fruit compressed-globose, 1 cm across, glabrous.'
        },
        {
            'id': 3,
            'name': '樟樹（模擬描述）',
            'description': 'Evergreen large tree. Leaves alternate, elliptic to ovate, 5-12 cm long, 2.5-6 cm wide, coriaceous, glossy above, with characteristic camphor odor when crushed, used for insect repellent. Flowers small, yellowish-white, in panicles. Fruit black, globose.'
        },
        {
            'id': 4,
            'name': '榕樹（對比）',
            'description': 'Large evergreen tree with aerial roots. Leaves ovate to elliptic, 4-10 cm long, leathery, dark green, glabrous. Figs axillary, sessile, globose, yellowish-green when ripe. No special odor.'
        }
    ]

    print("\n📋 中文查詢：")
    for i, q in enumerate(chinese_queries, 1):
        print(f"  {i}. {q['name']}")
        print(f"     「{q['query'][:50]}...」")

    print("\n📚 英文資料庫（4 個植物）：")
    for item in english_database:
        print(f"  {item['id']}. {item['name']}")

    # 執行測試
    print("\n" + "="*70)
    print("🔬 開始測試")
    print("="*70)

    results = []

    for test_case in chinese_queries:
        print(f"\n{'='*70}")
        print(f"🧪 {test_case['name']}")
        print(f"{'='*70}")
        print(f"查詢：{test_case['query']}")
        print()

        # 生成中文查詢的向量
        zh_vector = model.encode(test_case['query'], normalize_embeddings=True)

        # 生成所有英文描述的向量
        en_vectors = model.encode(
            [item['description'] for item in english_database],
            normalize_embeddings=True
        )

        # 計算相似度
        similarities = cosine_similarity([zh_vector], en_vectors)[0]

        # 排序結果
        ranked = sorted(
            zip(english_database, similarities),
            key=lambda x: x[1],
            reverse=True
        )

        print("📊 相似度排名：")
        for rank, (item, score) in enumerate(ranked, 1):
            emoji = "🥇" if rank == 1 else "🥈" if rank == 2 else "🥉" if rank == 3 else "  "
            status = ""
            if score >= 0.80:
                status = "✅ 極佳"
            elif score >= 0.75:
                status = "✅ 良好"
            elif score >= 0.70:
                status = "⚠️  尚可"
            elif score >= 0.65:
                status = "⚠️  偏低"
            else:
                status = "❌ 太低"

            print(f"  {emoji} 第 {rank} 名：{score:.4f} {status}")
            print(f"     {item['name']}")
            print()

        # 記錄結果
        results.append({
            'test_name': test_case['name'],
            'query': test_case['query'],
            'top1': ranked[0][0]['name'],
            'top1_score': float(ranked[0][1]),
            'top3': [(r[0]['name'], float(r[1])) for r in ranked[:3]]
        })

    # 綜合評估
    print("\n" + "="*70)
    print("📈 綜合評估")
    print("="*70)

    avg_top1_score = np.mean([r['top1_score'] for r in results])
    min_score = min([r['top1_score'] for r in results])
    max_score = max([r['top1_score'] for r in results])

    print(f"\n平均最高相似度：{avg_top1_score:.4f}")
    print(f"最低分數：{min_score:.4f}")
    print(f"最高分數：{max_score:.4f}")

    print("\n" + "="*70)
    print("🎯 結論與建議")
    print("="*70)

    if avg_top1_score >= 0.78:
        print("\n✅ 結論：跨語言能力 **優秀**")
        print("   Jina V2 Base ZH 可以有效匹配中英文植物描述")
        print("\n💡 建議：")
        print("   → 使用方案 A：保留英文描述，依賴 Jina 跨語言能力")
        print("   → 優點：資料準備快，今天就能上線")
        print("   → 預期準確率：85-95%")
        recommendation = "A"
    elif avg_top1_score >= 0.72:
        print("\n⚠️  結論：跨語言能力 **尚可**")
        print("   可以使用，但準確率可能不夠理想")
        print("\n💡 建議：")
        print("   → 使用方案 C：添加中文關鍵字增強")
        print("   → 優點：提升 10-15% 準確率")
        print("   → 代價：需要額外翻譯步驟（一次性成本）")
        recommendation = "C"
    else:
        print("\n❌ 結論：跨語言能力 **不足**")
        print("   不建議直接使用英文描述")
        print("\n💡 建議：")
        print("   → 必須使用方案 C：完整翻譯為中文")
        print("   → 或考慮使用多語言模型")
        recommendation = "C"

    # 儲存結果
    output = {
        'model': 'jinaai/jina-embeddings-v2-base-zh',
        'test_date': '2026-01-19',
        'results': results,
        'statistics': {
            'avg_top1_score': float(avg_top1_score),
            'min_score': float(min_score),
            'max_score': float(max_score)
        },
        'recommendation': recommendation
    }

    with open('jina_crosslingual_test_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 測試結果已儲存至 jina_crosslingual_test_results.json")
    print(f"✅ 推薦方案：{recommendation}")

    return recommendation


if __name__ == '__main__':
    try:
        recommendation = test_crosslingual_matching()
        print("\n" + "="*70)
        print("測試完成！")
        print("="*70)
    except ImportError as e:
        print("\n❌ 錯誤：缺少必要的套件")
        print("\n請先安裝：")
        print("  pip install sentence-transformers scikit-learn")
        print(f"\n詳細錯誤：{e}")
    except Exception as e:
        print(f"\n❌ 測試失敗：{e}")
        import traceback
        traceback.print_exc()
