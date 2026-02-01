#!/usr/bin/env python3
"""
為資料庫生成 morphology_summary 和 trait_tokens

功能：
1. 從原始資料提取並生成 morphology_summary_zh（乾淨的摘要）
2. 從 key_features 生成 trait_tokens（標準化）
3. 輸出更新後的 JSONL 檔案
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, List
from trait_tokenizer import key_features_to_trait_tokens

# 輸入和輸出檔案
INPUT_JSONL = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw.jsonl"
OUTPUT_JSONL = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw-enhanced.jsonl"


def extract_morphology_summary(plant: Dict[str, Any]) -> str:
    """
    從植物資料提取 morphology_summary
    
    策略：
    1. 優先使用 identification.summary（如果存在且完整）
    2. 其次從 identification.morphology 提取關鍵資訊
    3. 最後從 raw_data.morphology 提取
    """
    identification = plant.get("identification", {})
    if not isinstance(identification, dict):
        return ""
    
    # 1. 優先使用 summary
    summary = identification.get("summary")
    if summary:
        if isinstance(summary, list):
            summary = " ".join(summary)
        # 清理 summary：移除冗長描述，保留關鍵特徵
        summary = clean_summary(summary)
        if len(summary) > 50:  # 確保有足夠內容
            return summary
    
    # 2. 從 morphology 提取
    morphology = identification.get("morphology")
    if morphology:
        if isinstance(morphology, list):
            morphology_text = " ".join(morphology)
        else:
            morphology_text = str(morphology)
        
        # 提取關鍵資訊
        summary = extract_key_info(morphology_text)
        if summary:
            return summary
    
    # 3. 從 raw_data.morphology 提取
    raw_data = plant.get("raw_data", {})
    if isinstance(raw_data, dict):
        raw_morphology = raw_data.get("morphology")
        if raw_morphology:
            summary = extract_key_info(raw_morphology)
            if summary:
                return summary
    
    return ""


def clean_summary(text: str) -> str:
    """清理摘要：移除冗長描述，保留關鍵特徵"""
    if not text:
        return ""
    
    # 移除常見的冗長描述
    text = re.sub(r"廣泛分布於.*?。", "", text)
    text = re.sub(r"原產於.*?。", "", text)
    text = re.sub(r"分布於.*?。", "", text)
    text = re.sub(r"常見於.*?。", "", text)
    
    # 保留關鍵特徵描述
    # 提取：生活型、葉、花、果實等關鍵資訊
    sentences = text.split("。")
    key_sentences = []
    
    for sent in sentences:
        sent = sent.strip()
        if not sent:
            continue
        
        # 保留包含關鍵特徵的句子
        if any(keyword in sent for keyword in [
            "生活型", "喬木", "灌木", "草本", "藤本",
            "葉", "花", "果實", "花序", "葉序", "葉形", "葉緣"
        ]):
            key_sentences.append(sent)
    
    if key_sentences:
        return "。".join(key_sentences[:5])  # 最多 5 句
    else:
        return text[:200]  # 如果沒有關鍵句子，取前 200 字


def extract_key_info(text: str) -> str:
    """從原始 morphology 文字提取關鍵資訊"""
    if not text:
        return ""
    
    # 提取關鍵句子
    sentences = text.split("。")
    key_sentences = []
    
    for sent in sentences:
        sent = sent.strip()
        if not sent:
            continue
        
        # 保留包含形態特徵的句子
        if any(keyword in sent for keyword in [
            "生活型", "喬木", "灌木", "草本", "藤本",
            "葉", "花", "果實", "花序", "葉序", "葉形", "葉緣",
            "互生", "對生", "輪生", "卵形", "橢圓形", "披針形"
        ]):
            key_sentences.append(sent)
    
    if key_sentences:
        return "。".join(key_sentences[:5])
    else:
        return text[:200]


def process_plant(plant: Dict[str, Any]) -> Dict[str, Any]:
    """處理單筆植物資料，生成 morphology_summary 和 trait_tokens"""
    # 生成 morphology_summary
    morphology_summary = extract_morphology_summary(plant)
    
    # 生成 trait_tokens
    identification = plant.get("identification", {})
    key_features = []
    if isinstance(identification, dict):
        kf = identification.get("key_features", [])
        if isinstance(kf, list):
            key_features = kf
        elif kf:
            key_features = [kf]
    
    trait_tokens = key_features_to_trait_tokens(key_features)
    
    # 更新 identification
    if not isinstance(identification, dict):
        identification = {}
    
    if morphology_summary:
        identification["morphology_summary_zh"] = morphology_summary
    
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
    
    processed_count = 0
    total_count = 0
    
    with INPUT_JSONL.open("r", encoding="utf-8") as f_in, \
         OUTPUT_JSONL.open("w", encoding="utf-8") as f_out:
        
        for line in f_in:
            line = line.strip()
            if not line:
                continue
            
            # 處理 JSON 行尾逗號
            if line.endswith(","):
                line = line[:-1]
            
            try:
                plant = json.loads(line)
                total_count += 1
                
                # 處理植物資料
                plant_enhanced = process_plant(plant)
                
                # 寫入輸出檔案
                f_out.write(json.dumps(plant_enhanced, ensure_ascii=False) + "\n")
                processed_count += 1
                
                if processed_count % 100 == 0:
                    print(f"  已處理 {processed_count} 筆...")
            
            except json.JSONDecodeError as e:
                print(f"⚠️ JSON 解析錯誤（跳過）：{e}")
                continue
    
    print(f"\n✅ 完成！")
    print(f"   總數：{total_count}")
    print(f"   成功：{processed_count}")
    print(f"   輸出：{OUTPUT_JSONL}")
    print(f"\n💡 下一步：")
    print(f"   1. 檢查輸出檔案：{OUTPUT_JSONL}")
    print(f"   2. 如果滿意，可以替換原檔案或重新向量化")


if __name__ == "__main__":
    main()
