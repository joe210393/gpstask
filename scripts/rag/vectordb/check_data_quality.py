#!/usr/bin/env python3
"""
檢查資料品質腳本
驗證 plants-forest-gov-tw-enhanced.jsonl 的資料完整性
"""

import json
from pathlib import Path
from collections import defaultdict

DATA_FILE = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw-enhanced.jsonl"

def check_data_quality():
    """檢查資料品質"""
    print("=" * 60)
    print("📊 資料品質檢查")
    print("=" * 60)
    
    if not DATA_FILE.exists():
        print(f"❌ 找不到資料檔案: {DATA_FILE}")
        return False
    
    stats = {
        "total": 0,
        "has_trait_tokens": 0,
        "has_key_features_norm": 0,
        "has_query_text_zh": 0,
        "has_must_traits": 0,
        "format_errors": [],
        "missing_data": []
    }
    
    source_stats = defaultdict(int)
    
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            
            try:
                plant = json.loads(line)
                stats["total"] += 1
                
                name = plant.get('chinese_name', '未知')
                source = plant.get('source', '未知')
                source_stats[source] += 1
                
                ident = plant.get('identification', {})
                
                # 檢查必要欄位
                has_tokens = bool(ident.get('trait_tokens'))
                has_norm = bool(ident.get('key_features_norm'))
                has_query = bool(ident.get('query_text_zh'))
                has_must = bool(ident.get('must_traits'))
                
                if has_tokens:
                    stats["has_trait_tokens"] += 1
                if has_norm:
                    stats["has_key_features_norm"] += 1
                if has_query:
                    stats["has_query_text_zh"] += 1
                if has_must:
                    stats["has_must_traits"] += 1
                
                # 記錄缺少的資料
                missing = []
                if not has_tokens:
                    missing.append('trait_tokens')
                if not has_norm:
                    missing.append('key_features_norm')
                if not has_query:
                    missing.append('query_text_zh')
                
                if missing:
                    stats["missing_data"].append({
                        "line": i,
                        "name": name,
                        "source": source,
                        "missing": missing
                    })
                
                # 檢查格式
                trait_tokens = ident.get('trait_tokens', [])
                for token in trait_tokens:
                    if not isinstance(token, str) or '=' not in token:
                        stats["format_errors"].append({
                            "line": i,
                            "name": name,
                            "error": f"trait_token 格式錯誤: {token}"
                        })
                        break
                
            except json.JSONDecodeError as e:
                stats["format_errors"].append({
                    "line": i,
                    "name": "未知",
                    "error": f"JSON 解析錯誤: {str(e)[:50]}"
                })
    
    # 輸出統計
    print(f"\n📈 統計資料")
    print(f"  總筆數: {stats['total']}")
    print(f"  有 trait_tokens: {stats['has_trait_tokens']} ({stats['has_trait_tokens']/stats['total']*100:.1f}%)")
    print(f"  有 key_features_norm: {stats['has_key_features_norm']} ({stats['has_key_features_norm']/stats['total']*100:.1f}%)")
    print(f"  有 query_text_zh: {stats['has_query_text_zh']} ({stats['has_query_text_zh']/stats['total']*100:.1f}%)")
    print(f"  有 must_traits: {stats['has_must_traits']} ({stats['has_must_traits']/stats['total']*100:.1f}%)")
    
    print(f"\n📂 資料來源分布")
    for source, count in sorted(source_stats.items(), key=lambda x: -x[1]):
        print(f"  {source}: {count} 筆")
    
    if stats["missing_data"]:
        print(f"\n⚠️  缺少資料的植物 ({len(stats['missing_data'])} 筆)")
        # 按來源分類
        missing_by_source = defaultdict(list)
        for item in stats["missing_data"]:
            missing_by_source[item["source"]].append(item)
        
        for source, items in sorted(missing_by_source.items(), key=lambda x: -len(x[1])):
            print(f"  {source}: {len(items)} 筆")
            for item in items[:5]:  # 只顯示前 5 個
                print(f"    - {item['name']} (缺少: {', '.join(item['missing'])})")
            if len(items) > 5:
                print(f"    ... 還有 {len(items) - 5} 筆")
    
    if stats["format_errors"]:
        print(f"\n❌ 格式錯誤 ({len(stats['format_errors'])} 筆)")
        for error in stats["format_errors"][:10]:
            print(f"  第 {error['line']} 筆 ({error['name']}): {error['error']}")
    else:
        print(f"\n✅ 格式檢查通過，沒有發現格式錯誤")
    
    # 總結
    print(f"\n{'=' * 60}")
    if stats["format_errors"]:
        print("❌ 資料有格式錯誤，需要修復")
        return False
    elif len(stats["missing_data"]) > stats["total"] * 0.1:  # 超過 10% 缺少資料
        print("⚠️  超過 10% 的資料缺少必要欄位，建議補齊")
        return False
    else:
        print("✅ 資料品質良好，可以使用")
        return True

if __name__ == "__main__":
    import sys
    success = check_data_quality()
    sys.exit(0 if success else 1)
