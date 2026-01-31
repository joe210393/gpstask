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

            # 直接檢查 life_form
            if life_form:
                life_form_lower = life_form.lower()
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

    def match_plant_features(self, query_features: list, plant_text: str) -> dict:
        """
        比對查詢特徵與植物描述的匹配程度

        Args:
            query_features: Vision AI 提取的特徵列表
            plant_text: 植物的描述文字

        Returns:
            {
                "match_score": 0.xx,
                "matched_features": [...],
                "missing_features": [...],
            }
        """
        matched = []
        missing = []
        match_score = 0.0

        for f in query_features:
            info = FEATURE_INDEX.get(f)
            if not info:
                continue

            std_name = info["name"]
            weight = self.get_weight(f)

            # 檢查植物描述中是否有這個特徵
            if std_name in plant_text or info["en"] in plant_text.lower():
                matched.append({"name": std_name, "weight": weight})
                match_score += weight
            else:
                missing.append({"name": std_name, "weight": weight})

        return {
            "match_score": match_score,
            "matched_features": matched,
            "missing_features": missing,
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
