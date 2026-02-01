#!/usr/bin/env python3
"""
清理並正規化植物資料
1. 清理 null 欄位
2. 正規化 key_features
3. 生成乾淨的 query_text_zh（用於 embedding）
4. 確保 trait_tokens 完整
"""

import json
import sys
from pathlib import Path
from typing import Dict, Any, List, Set
from normalize_features import normalize_features, load_normalize_rules

# 資料檔案路徑
DATA_DIR = Path(__file__).parent.parent / "data"
INPUT_FILE = DATA_DIR / "plants-forest-gov-tw-enhanced.jsonl"
OUTPUT_FILE = DATA_DIR / "plants-forest-gov-tw-clean.jsonl"
BACKUP_FILE = DATA_DIR / "plants-forest-gov-tw-enhanced.jsonl.backup"

# Must traits（高信心度且關鍵的特徵）
MUST_TRAITS = {
    "life_form",  # 生活型（喬木/灌木/草本）是關鍵
    "leaf_arrangement",  # 葉序（互生/對生）是關鍵
}

def clean_null_fields(plant: Dict[str, Any]) -> Dict[str, Any]:
    """
    清理 null 欄位
    移除所有值為 null 的欄位
    """
    def clean_dict(d: Any) -> Any:
        if isinstance(d, dict):
            return {k: clean_dict(v) for k, v in d.items() if v is not None}
        elif isinstance(d, list):
            return [clean_dict(item) for item in d if item is not None]
        else:
            return d
    
    return clean_dict(plant)

def build_query_text_zh(plant: Dict[str, Any]) -> str:
    """
    構建簡短的 query_text_zh（只用於 embedding）
    
    只包含：
    - 1-2 句簡潔的形態描述
    - 關鍵特徵（正規化後）
    
    絕對不包含：
    - 步驟文字（第一步、第二步...）
    - 不確定語句（推測、估計...）
    - 流程詞
    """
    parts = []
    
    # 1. 生活型（最重要）
    identification = plant.get("identification", {})
    life_form = identification.get("life_form")
    if life_form:
        parts.append(life_form)
    
    # 2. 形態摘要（如果存在且簡潔）
    morphology_summary = identification.get("morphology_summary_zh", "")
    if morphology_summary:
        # 只取前 100 字，確保簡潔
        summary_clean = morphology_summary[:100].strip()
        if summary_clean:
            parts.append(summary_clean)
    
    # 3. 關鍵特徵（正規化後，最多 10 個）
    key_features = identification.get("key_features", [])
    if key_features:
        # 展平嵌套列表
        flattened_features = []
        for item in key_features:
            if isinstance(item, str):
                flattened_features.append(item)
            elif isinstance(item, list):
                flattened_features.extend([str(x) for x in item if x])
            else:
                flattened_features.append(str(item))
        
        rules = load_normalize_rules()
        normalized = normalize_features(flattened_features, rules)
        # 只取前 10 個最重要的，確保都是字符串
        normalized_clean = [str(n) for n in normalized[:10] if n]
        key_features_text = " ".join(normalized_clean)
        if key_features_text:
            parts.append(key_features_text)
    
    # 組合（用句號分隔，確保簡潔）
    # 確保所有 parts 都是字符串
    parts_clean = [str(p) for p in parts if p]
    query_text = "。".join(parts_clean)
    
    # 限制長度（最多 200 字元）
    if len(query_text) > 200:
        query_text = query_text[:200]
    
    return query_text.strip()

def extract_must_traits(trait_tokens: List[str]) -> List[str]:
    """
    從 trait_tokens 中提取 must traits（高信心度且關鍵）
    """
    must = []
    for token in trait_tokens:
        if "=" in token:
            trait, value = token.split("=", 1)
            if trait in MUST_TRAITS:
                must.append(token)
    return must

def enhance_plant(plant: Dict[str, Any]) -> Dict[str, Any]:
    """
    增強植物資料
    """
    # 1. 清理 null 欄位
    plant = clean_null_fields(plant)
    
    # 2. 正規化 key_features
    identification = plant.get("identification", {})
    key_features = identification.get("key_features", [])
    if key_features:
        # 展平嵌套列表（處理某些資料中 key_features 可能是嵌套列表的情況）
        flattened_features = []
        for item in key_features:
            if isinstance(item, str):
                flattened_features.append(item)
            elif isinstance(item, list):
                flattened_features.extend([str(x) for x in item if x])
            else:
                flattened_features.append(str(item))
        
        rules = load_normalize_rules()
        key_features_norm = normalize_features(flattened_features, rules)
        identification["key_features_norm"] = key_features_norm
        plant["identification"] = identification
    
    # 3. 生成 query_text_zh
    query_text_zh = build_query_text_zh(plant)
    identification["query_text_zh"] = query_text_zh
    plant["identification"] = identification
    
    # 4. 提取 must traits
    trait_tokens = identification.get("trait_tokens", [])
    if trait_tokens:
        must_traits = extract_must_traits(trait_tokens)
        identification["must_traits"] = must_traits
        plant["identification"] = identification
    
    return plant

def main():
    """主函數"""
    print("=" * 60)
    print("🧹 清理並正規化植物資料")
    print("=" * 60)
    
    if not INPUT_FILE.exists():
        print(f"❌ 找不到輸入檔案: {INPUT_FILE}")
        sys.exit(1)
    
    # 備份原檔案
    print(f"📦 備份原檔案: {BACKUP_FILE}")
    import shutil
    shutil.copy2(INPUT_FILE, BACKUP_FILE)
    
    # 載入資料
    print(f"📂 載入資料: {INPUT_FILE}")
    plants = []
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                plant = json.loads(line)
                plants.append(plant)
            except json.JSONDecodeError as e:
                print(f"⚠️ 跳過無效 JSON: {e}")
                continue
    
    print(f"✅ 載入 {len(plants)} 筆資料")
    
    # 處理每筆資料
    print("🔧 處理資料...")
    cleaned_plants = []
    stats = {
        "total": len(plants),
        "cleaned": 0,
        "with_query_text": 0,
        "with_norm_features": 0,
        "with_must_traits": 0
    }
    
    for i, plant in enumerate(plants):
        try:
            enhanced = enhance_plant(plant)
            cleaned_plants.append(enhanced)
            stats["cleaned"] += 1
            
            if enhanced.get("identification", {}).get("query_text_zh"):
                stats["with_query_text"] += 1
            if enhanced.get("identification", {}).get("key_features_norm"):
                stats["with_norm_features"] += 1
            if enhanced.get("identification", {}).get("must_traits"):
                stats["with_must_traits"] += 1
            
            if (i + 1) % 500 == 0:
                print(f"  處理進度: {i + 1}/{len(plants)}")
        except Exception as e:
            print(f"⚠️ 處理第 {i + 1} 筆資料時發生錯誤: {e}")
            continue
    
    # 寫入輸出檔案
    print(f"💾 寫入輸出檔案: {OUTPUT_FILE}")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for plant in cleaned_plants:
            f.write(json.dumps(plant, ensure_ascii=False) + '\n')
    
    # 統計報告
    print("\n" + "=" * 60)
    print("📊 處理統計")
    print("=" * 60)
    print(f"總筆數: {stats['total']}")
    print(f"成功清理: {stats['cleaned']}")
    print(f"有 query_text_zh: {stats['with_query_text']}")
    print(f"有正規化特徵: {stats['with_norm_features']}")
    print(f"有 must_traits: {stats['with_must_traits']}")
    print("\n✅ 完成！")
    print(f"📁 輸出檔案: {OUTPUT_FILE}")
    print(f"📦 備份檔案: {BACKUP_FILE}")

if __name__ == "__main__":
    main()
