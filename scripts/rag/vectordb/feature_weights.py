#!/usr/bin/env python3
"""
植物特徵權重計算模組

核心公式：
- IDF = ln((N+1)/(df+1))
- RareCoef = clamp(0.2, 2.5, idf/2)
- FeatureWeight = min(BaseW × RareCoef, MaxCap)

這個模組會：
1. 從植物資料庫統計每個特徵的 df（文件頻率）
2. 自動計算 IDF 和 RareCoef
3. 提供特徵匹配和加權評分功能
"""

import json
import math
import re
from collections import defaultdict
from pathlib import Path

# 特徵詞庫（固定詞彙，與 Vision Prompt 對應）
FEATURE_VOCAB = {
    # 生命型態
    "life_form": {
        "喬木": {"en": "tree", "base_w": 0.05, "max_cap": 0.05},
        "灌木": {"en": "shrub", "base_w": 0.05, "max_cap": 0.05},
        "草本": {"en": "herb", "base_w": 0.05, "max_cap": 0.05},
        "藤本": {"en": "vine", "base_w": 0.06, "max_cap": 0.06},
    },
    # 葉序
    "leaf_arrangement": {
        "互生": {"en": "alternate", "base_w": 0.05, "max_cap": 0.06},
        "對生": {"en": "opposite", "base_w": 0.05, "max_cap": 0.06},
        "輪生": {"en": "whorled", "base_w": 0.06, "max_cap": 0.09},
    },
    # 葉型
    "leaf_type": {
        "單葉": {"en": "simple leaf", "base_w": 0.05, "max_cap": 0.08},
        "複葉": {"en": "compound leaf", "base_w": 0.05, "max_cap": 0.08},
        "羽狀複葉": {"en": "pinnate leaves", "base_w": 0.05, "max_cap": 0.07},
        "二回羽狀": {"en": "bipinnate leaves", "base_w": 0.08, "max_cap": 0.12},
        "掌狀複葉": {"en": "palmate leaves", "base_w": 0.07, "max_cap": 0.10},
    },
    # 葉緣
    "leaf_margin": {
        "全緣": {"en": "entire", "base_w": 0.05, "max_cap": 0.07},
        "鋸齒": {"en": "serrated", "base_w": 0.05, "max_cap": 0.07},
    },
    # 花色
    "flower_color": {
        "白花": {"en": "white flower", "base_w": 0.05, "max_cap": 0.07},
        "黃花": {"en": "yellow flower", "base_w": 0.05, "max_cap": 0.07},
        "紅花": {"en": "red flower", "base_w": 0.05, "max_cap": 0.07},
        "紫花": {"en": "purple flower", "base_w": 0.05, "max_cap": 0.07},
    },
    # 花序
    "flower_inflo": {
        "總狀花序": {"en": "raceme", "base_w": 0.06, "max_cap": 0.09},
        "圓錐花序": {"en": "panicle", "base_w": 0.06, "max_cap": 0.09},
    },
    # 果實
    "fruit_type": {
        "莢果": {"en": "pod", "base_w": 0.08, "max_cap": 0.12},
    },
    # 根/樹幹
    "trunk_root": {
        "板根": {"en": "buttress", "base_w": 0.12, "max_cap": 0.18},
        "氣生根": {"en": "aerial root", "base_w": 0.16, "max_cap": 0.22},
    },
    # 特殊特徵
    "special": {
        "有刺": {"en": "thorns", "base_w": 0.08, "max_cap": 0.12},
        "胎生苗": {"en": "viviparous", "base_w": 0.22, "max_cap": 0.30},
    },
}

# 建立反向索引（中文/英文 → 類別+特徵）
def build_feature_index():
    """建立特徵名稱到類別的索引"""
    index = {}
    for category, features in FEATURE_VOCAB.items():
        for zh_name, info in features.items():
            index[zh_name] = {"category": category, "name": zh_name, **info}
            index[info["en"]] = {"category": category, "name": zh_name, **info}
            # 也加入一些變體
            index[info["en"].lower()] = {"category": category, "name": zh_name, **info}
    return index

FEATURE_INDEX = build_feature_index()


class FeatureWeightCalculator:
    """特徵權重計算器"""

    def __init__(self, plants_data_path: str = None):
        self.N = 0  # 總文件數
        self.df = defaultdict(int)  # 每個特徵的文件頻率
        self.idf = {}  # 計算後的 IDF
        self.rare_coef = {}  # 計算後的 RareCoef

        if plants_data_path:
            self.load_and_calculate(plants_data_path)

    def load_and_calculate(self, plants_data_path: str):
        """從植物資料載入並計算 df/idf"""
        path = Path(plants_data_path)
        if not path.exists():
            print(f"警告: 找不到資料檔 {plants_data_path}")
            return

        # 讀取植物資料
        plants = []
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    plants.append(json.loads(line))

        self.N = len(plants)
        print(f"載入 {self.N} 筆植物資料")

        # 統計每個特徵在多少文件中出現
        for plant in plants:
            # 取得所有相關文字
            # 支援新格式（identification）和舊格式（features）
            identification = plant.get("identification", {})
            features = plant.get("features", {})
            
            # 新格式使用 identification，舊格式使用 features
            if identification:
                morphology = identification.get("morphology", [])
                life_form = identification.get("life_form", "")
                description = identification.get("summary", "")
                # 也從 key_features 取得特徵
                key_features = identification.get("key_features", [])
            else:
                morphology = features.get("morphology", [])
                life_form = features.get("life_form", "")
                description = features.get("description_zh", "")
                key_features = []

            # 合併所有文字欄位（包含英文描述）
            # 確保所有欄位都是字串
            life_form_str = ""
            if life_form:
                if isinstance(life_form, list):
                    life_form_str = " ".join([str(lf) for lf in life_form])
                else:
                    life_form_str = str(life_form)
            
            morphology_text = ""
            if morphology:
                if isinstance(morphology, list):
                    # 確保所有元素都是字串
                    morphology_text = " ".join([str(m) for m in morphology])
                else:
                    morphology_text = str(morphology)
            
            description_str = ""
            if description:
                if isinstance(description, list):
                    description_str = " ".join([str(d) for d in description])
                else:
                    description_str = str(description)
            
            # key_features 也是列表
            key_features_text = ""
            if key_features:
                if isinstance(key_features, list):
                    key_features_text = " ".join([str(k) for k in key_features])
                else:
                    key_features_text = str(key_features)
            
            text = " ".join([
                life_form_str,
                morphology_text,
                description_str,
                key_features_text,
            ]).lower()

            # 找出這個文件包含哪些特徵
            found_features = set()

            # 直接檢查 life_form（確保是字串）
            if life_form:
                # 確保 life_form 是字串
                if isinstance(life_form, list):
                    life_form_str = " ".join([str(lf) for lf in life_form])
                else:
                    life_form_str = str(life_form)
                
                life_form_lower = life_form_str.lower()
                if "tree" in life_form_lower or life_form_lower == "喬木":
                    found_features.add("喬木")
                elif "shrub" in life_form_lower or life_form_lower == "灌木":
                    found_features.add("灌木")
                elif "herb" in life_form_lower or life_form_lower == "草本":
                    found_features.add("草本")
                elif "vine" in life_form_lower or "climber" in life_form_lower or life_form_lower == "藤本":
                    found_features.add("藤本")

            # 用英文關鍵字搜尋
            en_patterns = {
                # 葉序
                "alternate": "互生",
                "opposite": "對生",
                "whorled": "輪生",
                # 葉型
                "simple lea": "單葉",
                "compound lea": "複葉",
                "pinnate": "羽狀複葉",
                "bipinnate": "二回羽狀",
                "palmate": "掌狀複葉",
                # 葉緣
                "entire": "全緣",
                "serrat": "鋸齒",
                "dentate": "鋸齒",
                # 花色 (需要更精確的匹配)
                "white flower": "白花",
                "yellow flower": "黃花",
                "red flower": "紅花",
                "purple flower": "紫花",
                # 花序
                "raceme": "總狀花序",
                "panicle": "圓錐花序",
                # 果實
                "pod": "莢果",
                "legume": "莢果",
                # 根/樹幹
                "buttress": "板根",
                "aerial root": "氣生根",
                "prop root": "氣生根",
                # 特殊
                "thorn": "有刺",
                "spine": "有刺",
                "prickl": "有刺",
                "vivipar": "胎生苗",
            }

            for pattern, feature in en_patterns.items():
                if pattern in text:
                    found_features.add(feature)

            # 更新 df
            for feature in found_features:
                self.df[feature] += 1

        # 計算 IDF 和 RareCoef
        for feature in self.df:
            self.idf[feature] = math.log((self.N + 1) / (self.df[feature] + 1))
            self.rare_coef[feature] = max(0.2, min(2.5, self.idf[feature] / 2))

        print(f"計算完成，共 {len(self.df)} 個特徵")
        self._print_stats()

    def _print_stats(self):
        """印出統計資訊"""
        print("\n特徵統計 (依 RareCoef 排序):")
        print("-" * 60)
        sorted_features = sorted(self.rare_coef.items(), key=lambda x: x[1], reverse=True)
        for feature, coef in sorted_features[:15]:
            df = self.df[feature]
            idf = self.idf[feature]
            info = FEATURE_INDEX.get(feature, {})
            base_w = info.get("base_w", 0.05)
            max_cap = info.get("max_cap", 0.10)
            weight = min(base_w * coef, max_cap)
            print(f"  {feature:12} df={df:4} idf={idf:.3f} coef={coef:.3f} → 權重={weight:.4f}")

    def get_weight(self, feature_name: str) -> float:
        """取得特徵的最終權重"""
        # 找到標準化的特徵名稱
        info = FEATURE_INDEX.get(feature_name)
        if not info:
            return 0.0

        std_name = info["name"]
        base_w = info["base_w"]
        max_cap = info["max_cap"]

        # 如果沒有計算過 df，使用預設 coef=1.0
        coef = self.rare_coef.get(std_name, 1.0)

        return min(base_w * coef, max_cap)

    def calculate_feature_score(self, features: list) -> dict:
        """
        計算一組特徵的總分

        Args:
            features: 特徵列表，如 ["羽狀複葉", "互生", "白花"]

        Returns:
            {
                "total_score": 0.xx,
                "feature_details": [
                    {"name": "羽狀複葉", "weight": 0.035, "category": "leaf_type"},
                    ...
                ],
                "matched_count": 3
            }
        """
        details = []
        total = 0.0

        for f in features:
            weight = self.get_weight(f)
            if weight > 0:
                info = FEATURE_INDEX.get(f, {})
                details.append({
                    "name": info.get("name", f),
                    "weight": weight,
                    "category": info.get("category", "unknown"),
                })
                total += weight

        return {
            "total_score": total,
            "feature_details": details,
            "matched_count": len(details),
        }

    def match_plant_features(self, query_features: list, plant_text: str = None, plant_trait_tokens: list = None, plant_key_features_norm: list = None) -> dict:
        """
        比對查詢特徵與植物描述的匹配程度（改進版：優先使用 trait_tokens + 正規化特徵）

        Args:
            query_features: Vision AI 提取的特徵列表（中文，如 ["灌木", "互生", "卵形"]）
            plant_text: 植物的描述文字（備用，如果沒有 trait_tokens 才用）
            plant_trait_tokens: 植物的標準化 trait_tokens（優先使用，如 ["life_form=shrub", "leaf_arrangement=alternate"]）
            plant_key_features_norm: 植物的正規化 key_features（新增：正規化後的中文特徵）

        Returns:
            {
                "match_score": 0.xx,
                "matched_features": [...],
                "missing_features": [...],
                "coverage": 0.xx,  # 新增：覆蓋率
                "must_matched": True/False,  # 新增：must 條件是否全部匹配
            }
        """
        matched = []
        missing = []
        match_score = 0.0
        
        # 嘗試載入 trait_tokenizer 和 normalize_features（如果可用）
        try:
            import sys
            from pathlib import Path
            # 確保可以導入 trait_tokenizer（從同目錄）
            tokenizer_path = Path(__file__).parent / "trait_tokenizer.py"
            normalize_path = Path(__file__).parent / "normalize_features.py"
            if tokenizer_path.exists():
                from trait_tokenizer import key_features_to_trait_tokens
                use_tokens = True
            else:
                use_tokens = False
            
            if normalize_path.exists():
                from normalize_features import normalize_features
                use_normalize = True
            else:
                use_normalize = False
        except (ImportError, Exception):
            use_tokens = False
            use_normalize = False
        
        # 🔥 關鍵修復：正規化 query_features
        query_features_norm = query_features
        if use_normalize:
            query_features_norm = normalize_features(query_features)
        
        # 將 query_features 轉換為 trait_tokens（如果使用新方法）
        query_trait_tokens = []
        if use_tokens:
            query_trait_tokens = key_features_to_trait_tokens(query_features_norm)
        
        # 🔥 關鍵修復：直接從 query_features 中提取 trait token 格式的特徵
        # 如果 query_features 已經是 trait token 格式（如 "life_form=herb"），直接使用
        for f in query_features:
            if "=" in f and f.split("=")[0] in ["life_form", "leaf_arrangement", "leaf_shape", "leaf_margin", "flower_color", "fruit_type"]:
                query_trait_tokens.append(f)
        
        # 定義 must traits（高信心、硬條件）
        # 注意：只有 life_form 和 leaf_arrangement 是真正的 must traits
        # 其他特徵（leaf_shape, leaf_margin, flower_color, fruit_type）雖然重要，但不是必須匹配的
        MUST_TRAITS = {"life_form", "leaf_arrangement"}
        
        # 🔥 關鍵修復：直接從 query_trait_tokens 提取 must traits
        must_traits_in_query = []
        for token in query_trait_tokens:
            if "=" in token:
                trait, value = token.split("=", 1)
                if trait in MUST_TRAITS:
                    must_traits_in_query.append(token)
        
        must_traits_matched = []
        
        # 🔥 關鍵修復：使用正規化後的特徵進行匹配
        for f in query_features_norm:
            info = FEATURE_INDEX.get(f)
            if not info:
                # 如果正規化後的特徵不在索引中，嘗試原始特徵
                info = FEATURE_INDEX.get(f)
                if not info:
                    continue

            std_name = info["name"]
            weight = self.get_weight(f)
            
            # 判斷是否為 must trait（備用方法，用於中文特徵名稱）
            is_must = False
            if "生活型" in std_name or "life_form" in std_name.lower():
                is_must = True
            elif "葉序" in std_name or "leaf_arrangement" in std_name.lower():
                is_must = True
            elif "葉形" in std_name or "leaf_shape" in std_name.lower():
                is_must = True
            elif "葉緣" in std_name or "leaf_margin" in std_name.lower():
                is_must = True
            elif "花色" in std_name or "flower_color" in std_name.lower():
                is_must = True
            elif "果實類型" in std_name or "fruit_type" in std_name.lower():
                is_must = True
            
            if is_must:
                # 將中文特徵名稱轉換為 token 格式（如果可能）
                trait_token = None
                if use_tokens:
                    for token in query_trait_tokens:
                        if std_name.lower() in token.lower() or token.lower() in std_name.lower():
                            trait_token = token
                            break
                if trait_token and trait_token not in must_traits_in_query:
                    must_traits_in_query.append(trait_token)
                elif not trait_token and std_name not in [t.split("=")[1] if "=" in t else t for t in must_traits_in_query]:
                    # 如果無法轉換為 token，使用 std_name（向後兼容）
                    must_traits_in_query.append(std_name)

            # 優先使用 trait_tokens 匹配
            matched_flag = False
            
            # 🔥 關鍵修復：直接檢查 query_features 是否已經是 trait token 格式
            if "=" in f:
                # query_features 已經是 trait token 格式（如 "life_form=herb"）
                query_trait, query_value = f.split("=", 1)
                if use_tokens and plant_trait_tokens:
                    # 檢查 plant_trait_tokens 中是否有匹配的 token
                    for plant_token in plant_trait_tokens:
                        if "=" in plant_token:
                            plant_trait, plant_value = plant_token.split("=", 1)
                            if query_trait == plant_trait and query_value == plant_value:
                                matched_flag = True
                                break
            
            if not matched_flag and use_tokens and plant_trait_tokens:
                # 將 query feature 轉換為 token 格式
                query_token = None
                for token in query_trait_tokens:
                    # 簡單匹配：檢查 token 是否包含對應的 canonical value
                    if info.get("en") and info["en"].lower() in token.lower():
                        query_token = token
                        break
                
                if query_token:
                    # 檢查 plant_trait_tokens 中是否有匹配的 token
                    for plant_token in plant_trait_tokens:
                        if query_token == plant_token:
                            matched_flag = True
                            break
                        # 部分匹配：trait 相同即可（例如 life_form=shrub 匹配 life_form=shrub）
                        if "=" in query_token and "=" in plant_token:
                            q_trait, q_canon = query_token.split("=", 1)
                            p_trait, p_canon = plant_token.split("=", 1)
                            if q_trait == p_trait and q_canon == p_canon:
                                matched_flag = True
                                break
            
            # 🔥 關鍵修復：優先使用正規化後的 key_features_norm 進行匹配
            if not matched_flag:
                # 優先：使用正規化後的 key_features_norm
                if use_normalize and plant_key_features_norm:
                    if std_name in plant_key_features_norm:
                        matched_flag = True
                    # 也檢查原始特徵（向後兼容）
                    elif f in plant_key_features_norm:
                        matched_flag = True
                
                # 備用：全文掃描（向後兼容）
                if not matched_flag and plant_text:
                    # 檢查中文名稱（完整匹配）
                    if std_name in plant_text:
                        matched_flag = True
                    # 檢查英文名稱
                    elif info.get("en") and info["en"].lower() in plant_text.lower():
                        matched_flag = True
                    # 檢查部分匹配（例如「全緣」匹配「全緣葉」）
                    elif std_name in plant_text:
                        matched_flag = True
                    # 更積極的部分匹配：檢查特徵詞是否在文字中
                    elif len(std_name) >= 2:
                        # 對於短詞（2-4字），直接檢查是否在文字中
                        if len(std_name) <= 4 and std_name in plant_text:
                            matched_flag = True
                        # 對於長詞，檢查關鍵部分
                        elif any(part in plant_text for part in std_name.split() if len(part) >= 2):
                            matched_flag = True
            
            if matched_flag:
                matched.append({"name": std_name, "weight": weight, "is_must": is_must})
                match_score += weight
                if is_must:
                    # 🔥 關鍵修復：如果 query_features 已經是 trait token 格式，直接使用
                    if "=" in f:
                        if f not in must_traits_matched:
                            must_traits_matched.append(f)
                    else:
                        # 將 std_name 轉換為 token 格式（如果可能）
                        trait_token = None
                        if use_tokens:
                            for token in query_trait_tokens:
                                if std_name.lower() in token.lower() or token.lower() in std_name.lower():
                                    trait_token = token
                                    break
                        if trait_token:
                            if trait_token not in must_traits_matched:
                                must_traits_matched.append(trait_token)
                        else:
                            if std_name not in must_traits_matched:
                                must_traits_matched.append(std_name)
            else:
                missing.append({"name": std_name, "weight": weight, "is_must": is_must})
        
        # 🔥 關鍵修復：計算覆蓋率（只算 confidence>=0.55 的特徵）
        # 過濾掉低信心度的特徵（避免 coverage 被拉低）
        # 這裡假設所有 query_features 都是高信心度的（由前端過濾）
        total_query_traits = len(query_features_norm)
        matched_count = len(matched)
        coverage = matched_count / total_query_traits if total_query_traits > 0 else 0.0
        
        # 🔥 關鍵修復：檢查 must traits 是否全部匹配
        # 重要：如果查詢中有 must traits，但植物沒有對應的 trait_tokens，視為不匹配
        must_matched = True
        if must_traits_in_query:
            # 如果查詢中有 must traits，必須全部匹配
            # 比較時，需要處理 token 格式（"life_form=herb"）和中文名稱（"草本"）的差異
            matched_count = 0
            for query_must in must_traits_in_query:
                # 提取 trait 名稱（例如 "life_form=herb" -> "life_form"）
                if "=" in query_must:
                    query_trait = query_must.split("=")[0]
                    query_value = query_must.split("=")[1]
                else:
                    query_trait = None
                    query_value = query_must
                
                # 檢查是否匹配
                found = False
                for matched_must in must_traits_matched:
                    if "=" in matched_must:
                        matched_trait = matched_must.split("=")[0]
                        matched_value = matched_must.split("=")[1]
                        if query_trait and matched_trait == query_trait and matched_value == query_value:
                            found = True
                            break
                    elif matched_must == query_value or query_value in matched_must:
                        found = True
                        break
                
                if found:
                    matched_count += 1
            
            must_matched = matched_count == len(must_traits_in_query)
            
            # 額外檢查：如果查詢有 life_form，但植物沒有 life_form token，且沒有匹配到，視為不匹配
            if use_tokens and plant_trait_tokens:
                query_has_life_form = any(t.startswith("life_form=") for t in query_trait_tokens)
                plant_has_life_form = any(t.startswith("life_form=") for t in plant_trait_tokens)
                if query_has_life_form and not plant_has_life_form:
                    # 查詢有 life_form，但植物沒有，且沒有匹配到（matched_flag=False）
                    life_form_matched = any("life_form" in m["name"].lower() for m in matched)
                    if not life_form_matched:
                        must_matched = False
                
                # 同樣檢查 leaf_arrangement
                query_has_leaf_arr = any(t.startswith("leaf_arrangement=") for t in query_trait_tokens)
                plant_has_leaf_arr = any(t.startswith("leaf_arrangement=") for t in plant_trait_tokens)
                if query_has_leaf_arr and not plant_has_leaf_arr:
                    leaf_arr_matched = any("leaf_arrangement" in m["name"].lower() or "葉序" in m["name"] for m in matched)
                    if not leaf_arr_matched:
                        must_matched = False

        return {
            "match_score": match_score,
            "matched_features": matched,
            "missing_features": missing,
            "coverage": coverage,
            "must_matched": must_matched,
            "must_traits_in_query": must_traits_in_query,
            "must_traits_matched": must_traits_matched,
        }


# Vision AI 的結構化 Prompt
VISION_ROUTER_PROMPT = """你是一位植物辨識專家。請分析這張圖片，輸出 JSON 格式的結構化資訊。

**只輸出 JSON，不要加任何其他文字。**

{
  "intent": "plant 或 animal 或 object 或 unknown",
  "confidence": 0.0 到 1.0,
  "short_caption": "一句話描述畫面",
  "plant": {
    "guess_names": ["候選名稱1", "候選名稱2"],
    "features": ["從詞庫選擇的特徵"]
  }
}

**特徵詞庫（只能從這裡選，看不清楚就不要填）：**
- 生命型態：喬木, 灌木, 草本, 藤本
- 葉序：互生, 對生, 輪生
- 葉型：單葉, 複葉, 羽狀複葉, 二回羽狀, 掌狀複葉
- 葉緣：全緣, 鋸齒
- 花色：白花, 黃花, 紅花, 紫花
- 花序：總狀花序, 圓錐花序
- 特殊：莢果, 板根, 氣生根, 有刺, 胎生苗

**規則：**
1. intent=plant 時才填 plant 欄位
2. features 只填看得清楚的，不確定就留空
3. guess_names 給 1~3 個候選（中文為主）
4. 看不清楚時降低 confidence"""


def get_vision_prompt():
    """取得 Vision Router Prompt"""
    return VISION_ROUTER_PROMPT


# 測試用
if __name__ == "__main__":
    # 測試計算器
    data_path = Path(__file__).parent.parent / "data" / "plants-enriched.jsonl"

    if data_path.exists():
        calc = FeatureWeightCalculator(str(data_path))

        # 測試特徵評分
        test_features = ["羽狀複葉", "互生", "白花", "氣生根"]
        result = calc.calculate_feature_score(test_features)
        print(f"\n測試特徵: {test_features}")
        print(f"總分: {result['total_score']:.4f}")
        for d in result["feature_details"]:
            print(f"  - {d['name']}: {d['weight']:.4f} ({d['category']})")
    else:
        print(f"找不到資料檔: {data_path}")
        # 使用預設值測試
        calc = FeatureWeightCalculator()
        test_features = ["胎生苗", "氣生根", "羽狀複葉"]
        for f in test_features:
            w = calc.get_weight(f)
            print(f"{f}: {w:.4f}")
