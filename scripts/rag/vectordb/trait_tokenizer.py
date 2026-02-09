#!/usr/bin/env python3
"""
Trait Tokenizer - 將 key_features 轉換為標準化的 trait_tokens

功能：
1. 從 key_features（中文）映射到標準化的 trait_tokens（k=v 格式）
2. 建立反向映射表（zh -> (trait, canonical)）
3. 提供規則匹配和建議功能
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Set

# 載入詞彙表
VOCAB_PATH = Path(__file__).parent / "trait_vocab.json"
with VOCAB_PATH.open("r", encoding="utf-8") as f:
    TRAIT_VOCAB = json.load(f)

# 建立反向映射表：zh token -> (trait, canonical)
REVERSE_MAP: Dict[str, Tuple[str, str]] = {}
for trait, values in TRAIT_VOCAB.items():
    for canon, data in values.items():
        for zh in data.get("zh", []):
            REVERSE_MAP[zh] = (trait, canon)


def normalize_token(t: str) -> str:
    """正規化 token（去除標點、空白）"""
    if not t:
        return ""
    t = re.sub(r"[（）()、,，;；。\.]+", "", t)
    t = re.sub(r"\s+", "", t)
    return t.strip()


def heuristic_map(tok: str) -> Optional[Tuple[str, str, str]]:
    """
    啟發式映射：direct -> strip -> contains
    
    Returns:
        (trait, canonical, method) 或 None
    """
    tok = normalize_token(tok)
    if not tok:
        return None
    
    # 1. Direct match
    if tok in REVERSE_MAP:
        trait, canon = REVERSE_MAP[tok]
        return trait, canon, "direct"
    
    # 2. Strip common suffixes
    stripped = re.sub(r"(葉序|葉緣|葉邊|葉片|葉|花序|果實|花|果)$", "", tok)
    stripped = re.sub(r"^小", "", stripped)  # 小喬木 -> 喬木
    if stripped != tok and stripped in REVERSE_MAP:
        trait, canon = REVERSE_MAP[stripped]
        return trait, canon, f"strip:{stripped}"
    
    # 3. Contains match（特別針對「互生葉序」「對生葉」這種）
    leaf_arr_subs = {
        "alternate": ["互生"],
        "opposite": ["對生"],
        "whorled": ["輪生"],
        "basal": ["基生", "蓮座", "叢生"]
    }
    for canon, subs in leaf_arr_subs.items():
        for s in subs:
            if s in tok:
                return "leaf_arrangement", canon, f"contains:{s}"
    
    return None


def suggest_rule(tok: str) -> Optional[Tuple[str, str, str]]:
    """
    規則建議：根據常見模式推斷 trait 類別
    
    Returns:
        (trait, canonical, method) 或 None
    """
    tok = normalize_token(tok)
    if not tok:
        return None
    
    # leaf margin variants
    if "全緣" in tok:
        return "leaf_margin", "entire", "rule:margin"
    if "鋸齒" in tok:
        return "leaf_margin", "serrate", "rule:margin"
    if "波狀" in tok:
        return "leaf_margin", "wavy", "rule:margin"
    if "裂" in tok and "葉" in tok:
        return "leaf_margin", "lobed", "rule:margin"
    
    # texture
    if "革質" in tok:
        return "leaf_texture", "coriaceous", "rule:texture"
    if "紙質" in tok:
        return "leaf_texture", "papery", "rule:texture"
    if "肉質" in tok:
        return "leaf_texture", "succulent", "rule:texture"
    
    # phenology
    if tok in ("落葉", "落葉性"):
        return "phenology", "deciduous", "rule:phenology"
    if tok in ("常綠", "常綠性"):
        return "phenology", "evergreen", "rule:phenology"
    if tok == "半常綠":
        return "phenology", "semi_evergreen", "rule:phenology"
    
    # endemism
    if "特有" in tok:
        return "endemism", "endemic", "rule:endemism"
    
    # reproductive system
    repro_map = {
        "雌雄異株": "dioecious",
        "雌雄同株": "monoecious",
        "兩性花": "bisexual_flower",
        "單性花": "unisexual_flower"
    }
    if tok in repro_map:
        return "reproductive_system", repro_map[tok], "rule:repro"
    
    # inflorescence
    if "花序" in tok or tok in ("單生花", "單生"):
        if "總狀" in tok:
            return "inflorescence", "raceme", "rule:infl"
        if "圓錐" in tok:
            return "inflorescence", "panicle", "rule:infl"
        if "聚繖" in tok or "聚傘" in tok:
            return "inflorescence", "cyme", "rule:infl"
        if "繖形" in tok or "傘形" in tok:
            return "inflorescence", "umbel", "rule:infl"
        if "穗狀" in tok:
            return "inflorescence", "spike", "rule:infl"
        if "頭狀" in tok:
            return "inflorescence", "capitulum", "rule:infl"
        if "繖房" in tok:
            return "inflorescence", "corymb", "rule:infl"
        if "佛焰" in tok:
            return "inflorescence", "spadix", "rule:infl"
        if "單生" in tok:
            return "inflorescence", "solitary", "rule:infl"
    
    # fruit shape
    if "果" in tok:
        if "球形" in tok:
            return "fruit_shape", "globose", "rule:fruit"
        if "卵形" in tok and "果" in tok:
            return "fruit_shape", "ovoid", "rule:fruit"
        if "橢圓" in tok and "果" in tok:
            return "fruit_shape", "ellipsoid", "rule:fruit"
    
    # leaf base
    if "基部" in tok:
        if "楔形" in tok:
            return "leaf_base", "cuneate", "rule:base"
        if "心形" in tok:
            return "leaf_base", "cordate", "rule:base"
        if "圓形" in tok:
            return "leaf_base", "rounded", "rule:base"
    
    # flower color (簡單匹配，因為 trait_vocab 中已有完整映射)
    if "花" in tok and ("白" in tok or tok.startswith("白")):
        return "flower_color", "white", "rule:flower_color"
    if "花" in tok and ("黃" in tok or tok.startswith("黃")):
        return "flower_color", "yellow", "rule:flower_color"
    if "花" in tok and ("紅" in tok or tok.startswith("紅")):
        return "flower_color", "red", "rule:flower_color"
    if "花" in tok and ("紫" in tok or tok.startswith("紫")):
        return "flower_color", "purple", "rule:flower_color"
    if "花" in tok and ("粉" in tok or tok.startswith("粉")):
        return "flower_color", "pink", "rule:flower_color"
    if "花" in tok and ("橙" in tok or tok.startswith("橙")):
        return "flower_color", "orange", "rule:flower_color"
    
    # special features
    if "氣生根" in tok or "氣根" in tok:
        return "special_features", "aerial_root", "rule:special"
    if "板根" in tok:
        return "special_features", "buttress", "rule:special"
    if "胎生" in tok:
        return "special_features", "viviparous", "rule:special"
    if "紅苞" in tok or "苞葉" in tok:
        return "special_features", "bract_red", "rule:special"
    
    return None


def key_features_to_trait_tokens(key_features: List[str]) -> List[str]:
    """
    將 key_features（中文列表）轉換為標準化的 trait_tokens
    
    Args:
        key_features: 中文特徵列表，如 ["灌木", "互生", "卵形", "鋸齒緣"]
    
    Returns:
        trait_tokens: 標準化 token 列表，如 ["life_form=shrub", "leaf_arrangement=alternate", ...]
    """
    trait_tokens = []
    seen = set()  # 避免重複
    
    for kf in key_features:
        if not kf or kf in ("未見描述", "未見", "不明"):
            continue
        
        # 先嘗試啟發式映射
        result = heuristic_map(kf)
        if result is None:
            # 再嘗試規則建議
            result = suggest_rule(kf)
        
        if result:
            trait, canon, method = result
            token = f"{trait}={canon}"
            if token not in seen:
                trait_tokens.append(token)
                seen.add(token)
        # else: unmapped，暫時跳過（後續可以統計）
    
    return trait_tokens


def traits_json_to_trait_tokens(traits_json: Dict) -> List[str]:
    """
    將 Vision AI 產出的 traits JSON 轉換為 trait_tokens
    
    Args:
        traits_json: {
            "life_form": {"value": "shrub", "confidence": 0.9, ...},
            "leaf_arrangement": {"value": "alternate", ...},
            ...
        }
    
    Returns:
        trait_tokens: 只包含 confidence >= 0.55 的特徵
    """
    trait_tokens = []
    MIN_CONFIDENCE = 0.55

    # 🔒 嚴格可見性規則：
    # - 若 visible_parts 未包含 "flower"，則一律忽略所有 flower_* 類型特徵
    # - 若 visible_parts 未包含 "fruit"，則一律忽略所有 fruit_* 類型特徵
    visible_parts = traits_json.get("visible_parts") or []
    if isinstance(visible_parts, dict):
        visible_parts = visible_parts.get("value") or []
    if not isinstance(visible_parts, list):
        visible_parts = []
    visible_set: Set[str] = set(str(x).lower() for x in visible_parts)

    def _is_flower_trait(k: str) -> bool:
        return k.startswith("flower_") or k in {"inflorescence", "flower_inflo", "flower_position", "inflorescence_orientation"}

    def _is_fruit_trait(k: str) -> bool:
        return k.startswith("fruit_") or k in {"fruit_type", "fruit_color", "fruit_cluster", "fruit_surface"}

    for trait_key, trait_data in traits_json.items():
        if not isinstance(trait_data, dict):
            continue

        # 嚴格可見性：看不到花/果就直接跳過相關特徵（即使 LM 給了高信心值）
        if _is_flower_trait(trait_key) and "flower" not in visible_set:
            continue
        if _is_fruit_trait(trait_key) and "fruit" not in visible_set:
            continue

        value = trait_data.get("value")
        confidence = trait_data.get("confidence", 0.0)

        if value in ("unknown", None, "") or confidence < MIN_CONFIDENCE:
            continue

        # 直接使用 canonical value（已經是英文標準值）
        token = f"{trait_key}={value}"
        trait_tokens.append(token)

    return trait_tokens


def get_trait_tokens_zh(trait_tokens: List[str]) -> List[str]:
    """
    將 trait_tokens 轉換為中文版本（用於可讀性/debug）
    
    Args:
        trait_tokens: ["life_form=shrub", "leaf_arrangement=alternate", ...]
    
    Returns:
        trait_tokens_zh: ["生活型=灌木", "葉序=互生", ...]
    """
    tokens_zh = []
    
    for token in trait_tokens:
        if "=" not in token:
            continue
        
        trait, canon = token.split("=", 1)
        
        # 從詞彙表取得中文
        if trait in TRAIT_VOCAB and canon in TRAIT_VOCAB[trait]:
            zh_list = TRAIT_VOCAB[trait][canon].get("zh", [])
            if zh_list:
                tokens_zh.append(f"{trait}={zh_list[0]}")
    
    return tokens_zh


# 測試
if __name__ == "__main__":
    # 測試 key_features 轉換
    test_key_features = ["灌木", "互生", "卵形", "鋸齒緣", "總狀花序", "白花"]
    tokens = key_features_to_trait_tokens(test_key_features)
    print("Key features:", test_key_features)
    print("Trait tokens:", tokens)
    print("Trait tokens (ZH):", get_trait_tokens_zh(tokens))
    
    # 測試 traits JSON 轉換
    test_traits = {
        "life_form": {"value": "shrub", "confidence": 0.9},
        "leaf_arrangement": {"value": "alternate", "confidence": 0.8},
        "flower_color": {"value": "unknown", "confidence": 0.3}
    }
    tokens2 = traits_json_to_trait_tokens(test_traits)
    print("\nTraits JSON:", test_traits)
    print("Trait tokens:", tokens2)
