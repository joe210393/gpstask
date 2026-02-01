#!/usr/bin/env python3
"""
更新現有資料的 trait_tokens

功能：
1. 讀取 plants-forest-gov-tw-enhanced.jsonl
2. 從 key_features 和 morphology 重新生成 trait_tokens
3. 補齊缺失的特徵（如 flower_color, inflorescence 等）
4. 輸出更新後的檔案
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, List, Set
from trait_tokenizer import key_features_to_trait_tokens, REVERSE_MAP

# 輸入和輸出檔案
INPUT_JSONL = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw-enhanced.jsonl"
OUTPUT_JSONL = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw-enhanced.jsonl"
BACKUP_JSONL = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw-enhanced.jsonl.backup"


def extract_traits_from_text(text: str) -> List[str]:
    """從文字中提取可能的特徵詞（改進版：更積極地提取）"""
    if not text:
        return []
    
    traits = []
    
    # 檢查 trait_vocab 中的所有詞彙
    for zh_term, (trait, canon) in REVERSE_MAP.items():
        # 直接匹配
        if zh_term in text:
            traits.append(zh_term)
        # 部分匹配（例如「全緣」匹配「全緣葉」）
        elif len(zh_term) >= 2 and zh_term in text:
            traits.append(zh_term)
    
    # 額外檢查：從文字中提取常見特徵模式（更積極的匹配）
    # 葉緣（處理各種描述方式）
    if "全緣" in text or "全緣葉" in text or "葉全緣" in text or "葉緣全緣" in text or "全緣葉緣" in text:
        if "全緣" not in traits:
            traits.append("全緣")
    if "鋸齒" in text or "鋸齒緣" in text or "葉鋸齒" in text or "鋸齒葉" in text:
        if "鋸齒" not in traits:
            traits.append("鋸齒")
    if "波狀" in text or "波狀緣" in text or "葉波狀" in text:
        if "波狀緣" not in traits:
            traits.append("波狀緣")
    if "缺刻" in text or "缺刻緣" in text:
        if "缺刻" not in traits:
            traits.append("缺刻")
    
    # 葉序（處理各種描述方式）
    if "互生" in text or "互生葉" in text or "葉互生" in text:
        if "互生" not in traits:
            traits.append("互生")
    if "對生" in text or "對生葉" in text or "葉對生" in text:
        if "對生" not in traits:
            traits.append("對生")
    if "輪生" in text or "輪生葉" in text or "葉輪生" in text:
        if "輪生" not in traits:
            traits.append("輪生")
    if "叢生" in text or "叢生葉" in text:
        if "叢生" not in traits:
            traits.append("叢生")
    
    # 葉形（處理各種描述方式）
    if "卵形" in text or "卵形葉" in text or "葉卵形" in text:
        if "卵形" not in traits:
            traits.append("卵形")
    if "橢圓形" in text or "橢圓形葉" in text:
        if "橢圓形" not in traits:
            traits.append("橢圓形")
    if "披針形" in text or "披針形葉" in text:
        if "披針形" not in traits:
            traits.append("披針形")
    if "線形" in text or "線形葉" in text:
        if "線形" not in traits:
            traits.append("線形")
    if "心形" in text or "心形葉" in text:
        if "心形" not in traits:
            traits.append("心形")
    
    # 花色（更積極的匹配，處理各種描述方式）
    # 紫花
    if ("紫" in text and "花" in text) or "紫花" in text or "紫色花" in text or "花紫色" in text:
        if "紫花" not in traits:
            traits.append("紫花")
    # 紅花
    if ("紅" in text and "花" in text) or "紅花" in text or "紅色花" in text or "花紅色" in text:
        if "紅花" not in traits:
            traits.append("紅花")
    # 黃花
    if ("黃" in text and "花" in text) or "黃花" in text or "黃色花" in text or "花黃色" in text:
        if "黃花" not in traits:
            traits.append("黃花")
    # 白花
    if ("白" in text and "花" in text) or "白花" in text or "白色花" in text or "花白色" in text:
        if "白花" not in traits:
            traits.append("白花")
    # 粉花
    if ("粉" in text and "花" in text) or "粉花" in text or "粉色花" in text or "花粉色" in text:
        if "粉花" not in traits:
            traits.append("粉花")
    # 橙花
    if ("橙" in text and "花" in text) or "橙花" in text or "橙色花" in text:
        if "橙花" not in traits:
            traits.append("橙花")
    
    # 花序（處理各種描述方式）
    if "總狀花序" in text or "總狀" in text:
        if "總狀花序" not in traits:
            traits.append("總狀花序")
    if "圓錐花序" in text or "圓錐" in text:
        if "圓錐花序" not in traits:
            traits.append("圓錐花序")
    if "穗狀花序" in text or "穗狀" in text:
        if "穗狀花序" not in traits:
            traits.append("穗狀花序")
    if "聚繖花序" in text or "聚繖" in text:
        if "聚繖花序" not in traits:
            traits.append("聚繖花序")
    if "繖形花序" in text or "繖形" in text:
        if "繖形花序" not in traits:
            traits.append("繖形花序")
    if "頭狀花序" in text or "頭狀" in text:
        if "頭狀花序" not in traits:
            traits.append("頭狀花序")
    if "繖房花序" in text or "繖房" in text:
        if "繖房花序" not in traits:
            traits.append("繖房花序")
    if "單生" in text and "花" in text:
        if "單生" not in traits:
            traits.append("單生")
    
    # 生活型（處理各種描述方式）
    if "喬木" in text:
        if "喬木" not in traits:
            traits.append("喬木")
    if "灌木" in text:
        if "灌木" not in traits:
            traits.append("灌木")
    if "草本" in text or "草" in text:
        if "草本" not in traits:
            traits.append("草本")
    if "藤本" in text or "攀緣" in text or "蔓生" in text:
        if "藤本" not in traits:
            traits.append("藤本")
    
    return traits


def enhance_trait_tokens(plant: Dict[str, Any]) -> List[str]:
    """
    增強 trait_tokens：從所有可能的來源提取特徵
    來源包括：key_features, morphology, summary, raw_data.morphology 等
    """
    identification = plant.get("identification", {})
    if not isinstance(identification, dict):
        identification = {}
    
    # 1. 從 key_features 生成基礎 trait_tokens
    key_features = identification.get("key_features", [])
    if not isinstance(key_features, list):
        key_features = [key_features] if key_features else []
    
    trait_tokens = key_features_to_trait_tokens(key_features)
    seen_traits = {t.split("=")[0] for t in trait_tokens}  # 已包含的 trait 類別
    
    # 2. 收集所有可能的文字來源
    text_sources = []
    
    # 2.1 identification.morphology
    morphology = identification.get("morphology", [])
    if isinstance(morphology, list):
        text_sources.append(" ".join(morphology))
    elif morphology:
        text_sources.append(str(morphology))
    
    # 2.2 identification.summary
    summary = identification.get("summary", "")
    if isinstance(summary, list):
        text_sources.append(" ".join(summary))
    elif summary:
        text_sources.append(str(summary))
    
    # 2.3 raw_data.morphology（原始形態描述，通常更詳細）
    raw_data = plant.get("raw_data", {})
    if isinstance(raw_data, dict):
        raw_morphology = raw_data.get("morphology")
        if raw_morphology:
            text_sources.append(str(raw_morphology))
        
        # 2.4 raw_data 中的其他欄位
        for key in ["ecology", "usage", "distribution"]:
            value = raw_data.get(key)
            if value:
                text_sources.append(str(value))
    
    # 2.5 common_names（別名中可能包含特徵描述）
    common_names = plant.get("common_names", [])
    if isinstance(common_names, list):
        text_sources.append(" ".join(common_names))
    elif common_names:
        text_sources.append(str(common_names))
    
    # 合併所有文字來源
    combined_text = " ".join(text_sources)
    
    # 3. 從文字中提取額外的 trait_tokens（如果 key_features 中沒有）
    additional_traits = extract_traits_from_text(combined_text)
    for trait_zh in additional_traits:
        if trait_zh in REVERSE_MAP:
            trait, canon = REVERSE_MAP[trait_zh]
            token = f"{trait}={canon}"
            
            # 只添加尚未包含的 trait 類別（但允許同一類別有多個值，例如多種花色）
            # 對於 flower_color 和 inflorescence，允許有多個值
            if trait in ("flower_color", "inflorescence"):
                # 允許同一類別有多個值
                if token not in trait_tokens:
                    trait_tokens.append(token)
            else:
                # 其他類別：只添加尚未包含的 trait 類別
                if token not in trait_tokens and trait not in seen_traits:
                    trait_tokens.append(token)
                    seen_traits.add(trait)
    
    # 4. 確保 life_form 存在（從 life_form 欄位）
    life_form = identification.get("life_form", "")
    if life_form and "life_form" not in seen_traits:
        # 嘗試映射 life_form
        life_form_normalized = re.sub(r"[（）()、,，;；。\.]+", "", life_form).strip()
        if "喬木" in life_form_normalized:
            trait_tokens.append("life_form=tree")
            seen_traits.add("life_form")
        elif "灌木" in life_form_normalized:
            trait_tokens.append("life_form=shrub")
            seen_traits.add("life_form")
        elif "草本" in life_form_normalized:
            trait_tokens.append("life_form=herb")
            seen_traits.add("life_form")
        elif "藤本" in life_form_normalized:
            trait_tokens.append("life_form=vine")
            seen_traits.add("life_form")
    
    return trait_tokens


def process_plant(plant: Dict[str, Any]) -> Dict[str, Any]:
    """處理單筆植物資料，更新 trait_tokens"""
    identification = plant.get("identification", {})
    if not isinstance(identification, dict):
        identification = {}
        plant["identification"] = identification
    
    # 生成增強的 trait_tokens
    trait_tokens = enhance_trait_tokens(plant)
    
    # 更新 identification
    if trait_tokens:
        identification["trait_tokens"] = trait_tokens
    
    plant["identification"] = identification
    return plant


def main():
    """主函數：處理所有植物資料"""
    print(f"📖 讀取資料：{INPUT_JSONL}")
    
    if not INPUT_JSONL.exists():
        print(f"❌ 檔案不存在：{INPUT_JSONL}")
        return
    
    # 備份原檔案
    print(f"💾 備份原檔案：{BACKUP_JSONL}")
    import shutil
    shutil.copy2(INPUT_JSONL, BACKUP_JSONL)
    
    processed_count = 0
    updated_count = 0
    total_count = 0
    stats = {
        "life_form_added": 0,
        "flower_color_added": 0,
        "inflorescence_added": 0,
        "leaf_margin_added": 0,
    }
    
    plants = []
    
    # 第一遍：讀取所有資料
    with INPUT_JSONL.open("r", encoding="utf-8") as f_in:
        for line in f_in:
            line = line.strip()
            if not line:
                continue
            
            if line.endswith(","):
                line = line[:-1]
            
            try:
                plant = json.loads(line)
                plants.append(plant)
                total_count += 1
            except json.JSONDecodeError as e:
                print(f"⚠️ JSON 解析錯誤（跳過）：{e}")
                continue
    
    # 第二遍：處理並寫回
    with OUTPUT_JSONL.open("w", encoding="utf-8") as f_out:
        for plant in plants:
            old_trait_tokens = plant.get("identification", {}).get("trait_tokens", [])
            old_count = len(old_trait_tokens)
            
            # 處理植物資料
            plant_updated = process_plant(plant)
            
            new_trait_tokens = plant_updated.get("identification", {}).get("trait_tokens", [])
            new_count = len(new_trait_tokens)
            
            if new_count > old_count:
                updated_count += 1
                # 統計新增的特徵類型
                old_traits = {t.split("=")[0] for t in old_trait_tokens}
                new_traits = {t.split("=")[0] for t in new_trait_tokens}
                added_traits = new_traits - old_traits
                
                if "life_form" in added_traits:
                    stats["life_form_added"] += 1
                if "flower_color" in added_traits:
                    stats["flower_color_added"] += 1
                if "inflorescence" in added_traits:
                    stats["inflorescence_added"] += 1
                if "leaf_margin" in added_traits:
                    stats["leaf_margin_added"] += 1
            
            # 寫入輸出檔案
            f_out.write(json.dumps(plant_updated, ensure_ascii=False) + "\n")
            processed_count += 1
            
            if processed_count % 500 == 0:
                print(f"  已處理 {processed_count}/{total_count} 筆... (更新 {updated_count} 筆)")
    
    print(f"\n✅ 完成！")
    print(f"   總數：{total_count}")
    print(f"   成功：{processed_count}")
    print(f"   更新：{updated_count} 筆（補齊了 trait_tokens）")
    print(f"\n📊 統計：")
    print(f"   - 補齊 life_form: {stats['life_form_added']} 筆")
    print(f"   - 補齊 flower_color: {stats['flower_color_added']} 筆")
    print(f"   - 補齊 inflorescence: {stats['inflorescence_added']} 筆")
    print(f"   - 補齊 leaf_margin: {stats['leaf_margin_added']} 筆")
    print(f"\n💡 下一步：")
    print(f"   1. 檢查輸出檔案：{OUTPUT_JSONL}")
    print(f"   2. 備份檔案：{BACKUP_JSONL}")
    print(f"   3. 如果滿意，可以重新向量化（不需要重新向量化，因為只更新了 trait_tokens）")


if __name__ == "__main__":
    main()
