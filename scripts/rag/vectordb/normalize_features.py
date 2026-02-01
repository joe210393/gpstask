#!/usr/bin/env python3
"""
特徵正規化工具
根據 normalize_rules_zh.json 將中文特徵詞正規化
"""

import json
import re
from pathlib import Path
from typing import List, Dict, Set

# 載入正規化規則
NORMALIZE_RULES_PATH = Path(__file__).parent.parent.parent.parent / "Downloads" / "normalize_rules_zh.json"

def load_normalize_rules() -> Dict:
    """載入正規化規則"""
    if NORMALIZE_RULES_PATH.exists():
        with open(NORMALIZE_RULES_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    else:
        # 預設規則（從檔案內容提取）
        return {
            "strip_prefixes": [
                "小", "大", "多年生", "一年生", "二年生", "一二年生", "多年", "一年", "二年", "小型", "大型"
            ],
            "strip_suffixes": [
                "葉序", "葉緣", "葉邊", "葉片", "葉", "花序", "果實", "果", "種子", "莖", "根", "枝", "樹皮"
            ],
            "raw_to_normalized_example": {}
        }

def normalize_feature(feature: str, rules: Dict) -> str:
    """
    正規化單個特徵詞
    
    規則優先順序：
    1. 直接映射（raw_to_normalized_example）
    2. 去除前綴
    3. 去除後綴
    """
    if not feature or not isinstance(feature, str):
        return feature
    
    feature = feature.strip()
    if not feature:
        return feature
    
    # 1. 直接映射（優先）
    direct_map = rules.get("raw_to_normalized_example", {})
    if feature in direct_map:
        return direct_map[feature]
    
    # 2. 去除前綴
    prefixes = rules.get("strip_prefixes", [])
    for prefix in sorted(prefixes, key=len, reverse=True):  # 先匹配長的
        if feature.startswith(prefix):
            normalized = feature[len(prefix):]
            if normalized:  # 確保去除前綴後還有內容
                return normalized
    
    # 3. 去除後綴
    suffixes = rules.get("strip_suffixes", [])
    for suffix in sorted(suffixes, key=len, reverse=True):  # 先匹配長的
        if feature.endswith(suffix):
            normalized = feature[:-len(suffix)]
            if normalized:  # 確保去除後綴後還有內容
                return normalized
    
    # 4. 如果都沒有匹配，返回原值
    return feature

def normalize_features(features: List[str], rules: Dict = None) -> List[str]:
    """
    正規化特徵列表
    
    Args:
        features: 原始特徵列表
        rules: 正規化規則（如果為 None，會自動載入）
    
    Returns:
        正規化後的特徵列表（去重）
    """
    if not features:
        return []
    
    if rules is None:
        rules = load_normalize_rules()
    
    normalized = []
    seen = set()
    
    for feature in features:
        if not feature or not isinstance(feature, str):
            continue
        
        norm_feature = normalize_feature(feature, rules)
        if norm_feature and norm_feature not in seen:
            normalized.append(norm_feature)
            seen.add(norm_feature)
    
    return normalized

def normalize_key_features(key_features: List[str]) -> List[str]:
    """
    正規化 key_features（便捷函數）
    """
    return normalize_features(key_features)

if __name__ == "__main__":
    # 測試
    rules = load_normalize_rules()
    test_features = [
        "互生葉序", "互生葉", "互生",
        "卵形葉", "卵形",
        "多年生草本", "草本",
        "全緣葉緣", "全緣",
        "總狀花序", "總狀",
        "小喬木", "喬木"
    ]
    
    print("原始特徵:", test_features)
    normalized = normalize_features(test_features, rules)
    print("正規化後:", normalized)
