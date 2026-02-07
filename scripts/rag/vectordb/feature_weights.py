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
    # 生命型態：改為主要作為 Gate，用於矛盾/排除，不再參與正向加分
    # （例如「灌木/喬木/草本」超高 df，適合當 must / penalty，而不是拉高 feature_score）
    "life_form": {
        "喬木": {"en": "tree", "base_w": 0.02, "max_cap": 0.03},
        "灌木": {"en": "shrub", "base_w": 0.02, "max_cap": 0.03},
        "草本": {"en": "herb", "base_w": 0.02, "max_cap": 0.03},
        "藤本": {"en": "vine", "base_w": 0.03, "max_cap": 0.04},
    },
    # 葉序
    "leaf_arrangement": {
        "互生": {"en": "alternate", "base_w": 0.05, "max_cap": 0.06},
        "對生": {"en": "opposite", "base_w": 0.05, "max_cap": 0.06},
        "輪生": {"en": "whorled", "base_w": 0.06, "max_cap": 0.09},
        "叢生": {"en": "fascicled", "base_w": 0.05, "max_cap": 0.07},
    },
    # 葉型（工項 C：強特徵權重提升，複葉區辨力高）
    "leaf_type": {
        "單葉": {"en": "simple leaf", "base_w": 0.05, "max_cap": 0.08},
        "複葉": {"en": "compound leaf", "base_w": 0.06, "max_cap": 0.10},
        "羽狀複葉": {"en": "pinnate leaves", "base_w": 0.07, "max_cap": 0.12},
        "二回羽狀": {"en": "bipinnate leaves", "base_w": 0.10, "max_cap": 0.15},
        "掌狀複葉": {"en": "palmate leaves", "base_w": 0.08, "max_cap": 0.12},
        "三出複葉": {"en": "trifoliate", "base_w": 0.08, "max_cap": 0.12},
    },
    # 葉緣
    "leaf_margin": {
        "全緣": {"en": "entire", "base_w": 0.05, "max_cap": 0.07},
        "鋸齒": {"en": "serrated", "base_w": 0.05, "max_cap": 0.07},
        "波狀": {"en": "undulate", "base_w": 0.05, "max_cap": 0.07},
    },
    # 花色（提升為強特徵，特別是紫花、粉紅花對野牡丹等植物鑑別力高）
    "flower_color": {
        "白花": {"en": "white flower", "base_w": 0.06, "max_cap": 0.09},
        "黃花": {"en": "yellow flower", "base_w": 0.06, "max_cap": 0.09},
        "紅花": {"en": "red flower", "base_w": 0.06, "max_cap": 0.09},
        "紫花": {"en": "purple flower", "base_w": 0.08, "max_cap": 0.12},  # 野牡丹等
        "粉紅花": {"en": "pink flower", "base_w": 0.08, "max_cap": 0.12},  # 野牡丹等
        "橙花": {"en": "orange flower", "base_w": 0.06, "max_cap": 0.09},
    },
    # 花型（強特徵，用於風鈴草等鐘形花植物鑑別）
    "flower_shape": {
        "鐘形花": {"en": "campanulate", "base_w": 0.08, "max_cap": 0.12},
        "漏斗形花": {"en": "funnel", "base_w": 0.07, "max_cap": 0.11},
        "唇形花": {"en": "labiate", "base_w": 0.07, "max_cap": 0.11},
        "蝶形花": {"en": "papilionaceous", "base_w": 0.07, "max_cap": 0.11},
        "十字形花": {"en": "cruciform", "base_w": 0.07, "max_cap": 0.11},
        "放射狀花": {"en": "radial", "base_w": 0.06, "max_cap": 0.09},
    },
    # 花位置（單生/成對/簇生）
    "flower_position": {
        "單生花": {"en": "solitary", "base_w": 0.06, "max_cap": 0.09},
        "成對花": {"en": "pair", "base_w": 0.06, "max_cap": 0.09},
        "簇生花": {"en": "cluster", "base_w": 0.05, "max_cap": 0.08},
    },
    # 花序方向（直立/下垂）
    "inflorescence_orientation": {
        "直立花序": {"en": "erect", "base_w": 0.05, "max_cap": 0.07},
        "下垂花序": {"en": "drooping", "base_w": 0.07, "max_cap": 0.10},
    },
    # 花序（工項 C：頭狀/繖形/穗狀較稀有；繖房用於火筒樹等）
    "flower_inflo": {
        "總狀花序": {"en": "raceme", "base_w": 0.06, "max_cap": 0.09},
        "圓錐花序": {"en": "panicle", "base_w": 0.06, "max_cap": 0.09},
        "聚繖花序": {"en": "cyme", "base_w": 0.06, "max_cap": 0.09},
        "繖房花序": {"en": "corymb", "base_w": 0.06, "max_cap": 0.09},
        "頭狀花序": {"en": "capitulum", "base_w": 0.08, "max_cap": 0.12},
        "繖形花序": {"en": "umbel", "base_w": 0.07, "max_cap": 0.11},
        "穗狀花序": {"en": "spike", "base_w": 0.07, "max_cap": 0.11},
        "佛焰花序": {"en": "spadix", "base_w": 0.07, "max_cap": 0.11},
    },
    # 果實（工項 C：強特徵權重提升）
    "fruit_type": {
        "莢果": {"en": "pod", "base_w": 0.08, "max_cap": 0.12},
        "漿果": {"en": "berry", "base_w": 0.08, "max_cap": 0.12},
        "核果": {"en": "drupe", "base_w": 0.07, "max_cap": 0.11},
        "蒴果": {"en": "capsule", "base_w": 0.07, "max_cap": 0.11},
        "翅果": {"en": "samara", "base_w": 0.07, "max_cap": 0.11},
        "瘦果": {"en": "achene", "base_w": 0.07, "max_cap": 0.11},
        "堅果": {"en": "nut", "base_w": 0.07, "max_cap": 0.11},
        "梨果": {"en": "pome", "base_w": 0.07, "max_cap": 0.11},
    },
    # 果實排列（單生/成串/總狀/腋生）
    "fruit_cluster": {
        "單生果": {"en": "solitary", "base_w": 0.06, "max_cap": 0.09},
        "成串果": {"en": "cluster", "base_w": 0.07, "max_cap": 0.10},
        "總狀果": {"en": "raceme", "base_w": 0.07, "max_cap": 0.10},
        "腋生果": {"en": "axillary", "base_w": 0.06, "max_cap": 0.09},
    },
    # 果面（光滑/有毛/粗糙/有棱）
    "fruit_surface": {
        "光滑果": {"en": "smooth", "base_w": 0.05, "max_cap": 0.07},
        "有毛果": {"en": "hairy", "base_w": 0.07, "max_cap": 0.10},
        "粗糙果": {"en": "rough", "base_w": 0.06, "max_cap": 0.09},
        "有棱果": {"en": "ridged", "base_w": 0.06, "max_cap": 0.09},
    },
    # 萼宿存
    "calyx_persistent": {
        "宿存萼": {"en": "persistent calyx", "base_w": 0.07, "max_cap": 0.10},
    },
    # 根/樹幹
    "trunk_root": {
        "板根": {"en": "buttress", "base_w": 0.12, "max_cap": 0.18},
        "氣生根": {"en": "aerial root", "base_w": 0.16, "max_cap": 0.22},
    },
    # 特殊特徵
    "special": {
        "有刺": {"en": "thorns", "base_w": 0.08, "max_cap": 0.12},
        "乳汁": {"en": "latex", "base_w": 0.08, "max_cap": 0.12},
        "胎生苗": {"en": "viviparous", "base_w": 0.22, "max_cap": 0.30},
        "棕櫚": {"en": "palm", "base_w": 0.10, "max_cap": 0.14},  # 棕櫚科/棕櫚類
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

# 僅作為 Gate 使用的類別：這些特徵主要用於 MUST / 矛盾排除，不參與正向加分
GATE_ONLY_CATEGORIES = {"life_form"}


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

            # 找出這個文件包含哪些特徵（對齊 FEATURE_INDEX）
            found_features = set()

            # 1. key_features_norm / key_features（中文特徵，直接對應 FEATURE_INDEX）
            kfn = identification.get("key_features_norm") or identification.get("key_features") or []
            kf_list = kfn if isinstance(kfn, list) else [kfn] if kfn else []
            for item in kf_list:
                if not item or not isinstance(item, str):
                    continue
                item = item.strip()
                if len(item) < 2:
                    continue
                # 精確匹配
                if item in FEATURE_INDEX:
                    found_features.add(FEATURE_INDEX[item]["name"])
                else:
                    # 部分匹配：穗狀→穗狀花序、總狀→總狀花序 等
                    for zh_name in FEATURE_INDEX:
                        if isinstance(zh_name, str) and (item in zh_name or zh_name.startswith(item)):
                            found_features.add(FEATURE_INDEX[zh_name]["name"])
                            break

            # 2. trait_tokens（k=v 格式 → 對應 FEATURE_INDEX 中文）
            tt = identification.get("trait_tokens") or []
            tt_list = tt if isinstance(tt, list) else []
            # trait_vocab 映射: inflorescence=spike -> 穗狀花序, fruit_type=capsule -> 蒴果
            TRAIT_TO_ZH = {
                "raceme": "總狀花序", "panicle": "圓錐花序", "cyme": "聚繖花序",
                "umbel": "繖形花序", "spike": "穗狀花序", "capitulum": "頭狀花序",
                "corymb": "繖房花序", "spadix": "佛焰花序", "solitary": "單生花",
                "alternate": "互生", "opposite": "對生", "whorled": "輪生", "basal": "叢生",
                "simple": "單葉", "compound": "複葉", "pinnate": "羽狀複葉",
                "bipinnate": "二回羽狀", "palmate": "掌狀複葉", "trifoliate": "三出複葉",
                "entire": "全緣", "serrate": "鋸齒", "serrated": "鋸齒", "wavy": "波狀",
                "pod": "莢果", "berry": "漿果", "drupe": "核果", "capsule": "蒴果",
                "samara": "翅果", "achene": "瘦果", "nut": "堅果", "pome": "梨果",
                "shrub": "灌木", "tree": "喬木", "herb": "草本", "vine": "藤本",
                "white": "白花", "yellow": "黃花", "red": "紅花", "purple": "紫花",
                "pink": "粉紅花", "orange": "橙花",
                "aerial_root": "氣生根", "aerial": "氣生根", "buttress": "板根",
                "viviparous": "胎生苗", "bract_red": "紅苞葉",
            }
            for tok in tt_list:
                if not tok or "=" not in str(tok):
                    continue
                k, v = str(tok).split("=", 1)
                v = v.strip().lower()
                zh = TRAIT_TO_ZH.get(v)
                if zh and zh in FEATURE_INDEX:
                    found_features.add(zh)

            # 3. life_form 備援
            if life_form:
                lf_str = " ".join(life_form) if isinstance(life_form, list) else str(life_form)
                lf_lower = lf_str.lower()
                if "喬木" in lf_str or "tree" in lf_lower:
                    found_features.add("喬木")
                if "灌木" in lf_str or "shrub" in lf_lower:
                    found_features.add("灌木")
                if "草本" in lf_str or "herb" in lf_lower:
                    found_features.add("草本")
                if "藤本" in lf_str or "vine" in lf_lower or "climber" in lf_lower:
                    found_features.add("藤本")

            # 4. 全文中文關鍵字（補充 key_features 遺漏，含花型讓風鈴草等可被匹配）
            zh_patterns = [
                "總狀花序", "圓錐花序", "穗狀花序", "聚繖花序", "繖房花序", "繖形花序", "頭狀花序",
                "漿果", "核果", "蒴果", "莢果", "翅果", "瘦果", "堅果", "梨果",
                "互生", "對生", "輪生", "叢生",
                "羽狀複葉", "掌狀複葉", "二回羽狀", "三出複葉", "複葉", "單葉",
                "全緣", "鋸齒", "波狀", "白花", "黃花", "紅花", "紫花", "棕櫚", "有刺", "乳汁",
                "氣生根", "板根", "胎生苗", "紅苞葉", "佛焰花序",
                "鐘形花", "鐘形", "鐘形花朵", "漏斗形花", "唇形花", "蝶形花",  # 花型：風鈴草等
            ]
            for zh in zh_patterns:
                if zh in text or zh in key_features_text:
                    found_features.add(zh)
            # 棕櫚科：椰子、掌狀裂、扇形葉 → 棕櫚（讓棕竹等可被匹配）
            if "棕櫚" not in found_features and ("椰子" in text or "掌狀深裂" in key_features_text or "扇形" in text):
                found_features.add("棕櫚")

            # 更新 df
            for feature in found_features:
                if feature in FEATURE_INDEX:
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
        """取得特徵的最終權重（使用 IDF 權重調整）"""
        # 找到標準化的特徵名稱
        info = FEATURE_INDEX.get(feature_name)
        if not info:
            return 0.0

        std_name = info["name"]
        base_w = info["base_w"]
        max_cap = info["max_cap"]

        # 如果沒有計算過 df，使用預設 coef=1.0
        coef = self.rare_coef.get(std_name, 1.0)
        
        # 🔥 IDF 權重調整：越常見的特徵（df 大 → idf 小 → coef 小）權重越低
        # 例如：「灌木」「互生」「全緣」「總狀花序」這些高頻特徵，coef 會接近 0.2-0.5
        # 而「鐘形花」「繖房花序」「下垂花序」這些稀有特徵，coef 會接近 1.5-2.5
        # 這樣可以讓稀有特徵的權重明顯高於常見特徵，避免「3 個通用特徵就滿分」

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

        # 欄位級計分：同一 category 只計一次分（避免同義詞重複加分）
        per_category_best = {}
        for f in features:
            weight = self.get_weight(f)
            if weight <= 0:
                continue
            info = FEATURE_INDEX.get(f, {})
            cat = info.get("category", "unknown")
            # Gate-only 類別（例如 life_form）只用於 MUST/Gate，不參與正向加分
            if cat in GATE_ONLY_CATEGORIES:
                continue
            prev = per_category_best.get(cat)
            if not prev or weight > prev["weight"]:
                per_category_best[cat] = {
                    "name": info.get("name", f),
                    "weight": weight,
                    "category": cat,
                }

        for cat, item in per_category_best.items():
            details.append(item)
            total += item["weight"]

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
        
        # 🔥 關鍵修復：正規化 query_features（僅用於 key_features 轉換）
        # 注意：花序/果實類（總狀花序、穗狀花序、蒴果等）不要過度正規化，否則 FEATURE_INDEX 查不到
        query_features_norm = query_features
        if use_normalize:
            query_features_norm = normalize_features(query_features)
        
        # 將 query_features 轉換為 trait_tokens（用原始特徵，避免 花序/果 被 strip 掉）
        query_trait_tokens = []
        if use_tokens:
            query_trait_tokens = key_features_to_trait_tokens(query_features)
        
        # 🔥 關鍵修復：直接從 query_features 中提取 trait token 格式的特徵
        # 如果 query_features 已經是 trait token 格式（如 "life_form=herb"），直接使用
        for f in query_features:
            if "=" in f:
                query_trait_tokens.append(f)
        
        # 定義 must traits（高信心、硬條件）
        # 🔥 修復：life_form 從 MUST_KEYS 移除，改為 soft penalty
        # 原因：life_form 最常被照片角度/尺度誤判，v2 補齊後會把正確答案 gate 掉（如風鈴草）
        # 只保留 leaf_arrangement（葉序較穩定，誤判較少）
        MUST_KEYS = {"leaf_arrangement"}
        
        # 🔥 關鍵修復：Value Canonicalization（統一值格式）
        def canon_value(key: str, val: str) -> str:
            """正規化 trait 值，特別是 life_form"""
            if key == "life_form":
                mapping = {
                    "草本": "herb", "herbaceous": "herb", "herb": "herb",
                    "喬木": "tree", "tree": "tree",
                    "灌木": "shrub", "shrub": "shrub",
                    "藤本": "vine", "vine": "vine"
                }
                return mapping.get(val.lower(), val.lower())
            return val.strip().lower()
        
        def normalize_token(token: str) -> str:
            """正規化 trait token（如 "life_form=herb"）"""
            if "=" not in token:
                return token.strip()
            k, v = token.split("=", 1)
            k = k.strip()
            v = v.strip()
            v = canon_value(k, v)
            return f"{k}={v}"
        
        # 🔥 關鍵修復：提取查詢中提供的 must traits（只檢查查詢中有的）
        must_traits_in_query = []
        for f in query_features:
            if "=" in f:
                k = f.split("=", 1)[0].strip()
                if k in MUST_KEYS:
                    must_traits_in_query.append(normalize_token(f))
        
        # 也從 query_trait_tokens 中提取（向後兼容）
        for token in query_trait_tokens:
            if "=" in token:
                trait, value = token.split("=", 1)
                if trait.strip() in MUST_KEYS:
                    normalized = normalize_token(token)
                    if normalized not in must_traits_in_query:
                        must_traits_in_query.append(normalized)
        
        must_traits_matched = []

        # 🔥 Fallback：苔蘚類等 key_features_norm 常為空，從 plant_text 用 zh_patterns 萃取
        valid_kfn = [x for x in (plant_key_features_norm or []) if x in FEATURE_INDEX] if plant_key_features_norm else []
        if plant_text and len(valid_kfn) < 2:
            zh_patterns_fallback = [
                "總狀花序", "圓錐花序", "穗狀花序", "聚繖花序", "繖房花序", "繖形花序", "頭狀花序",
                "漿果", "核果", "蒴果", "莢果", "翅果", "瘦果", "堅果", "梨果",
                "互生", "對生", "輪生", "叢生",
                "羽狀複葉", "掌狀複葉", "二回羽狀", "三出複葉", "複葉", "單葉",
                "全緣", "鋸齒", "波狀", "白花", "黃花", "紅花", "紫花", "粉紅花", "棕櫚", "有刺", "乳汁",
                "氣生根", "板根", "胎生苗", "紅苞葉", "佛焰花序", "宿存萼",
                "鐘形花", "鐘形", "鐘形花朵", "漏斗形花", "唇形花", "蝶形花",
                "成串果", "總狀果",
            ]
            fallback = []
            for zh in zh_patterns_fallback:
                if zh in plant_text and zh in FEATURE_INDEX:
                    fallback.append(zh)
            if ("齒緣" in plant_text or "細齒" in plant_text) and "鋸齒" in FEATURE_INDEX:
                fallback.append("鋸齒")
            plant_key_features_norm = list(set((plant_key_features_norm or []) + fallback))
        
        # 🔥 關鍵修復：用「原始」query_features 迭代，避免 normalize 把 總狀花序→總狀、蒴果→蒴 導致 FEATURE_INDEX 查不到
        for f in query_features:
            info = FEATURE_INDEX.get(f)
            if not info and use_normalize:
                norm_list = normalize_features([f])
                if norm_list:
                    info = FEATURE_INDEX.get(norm_list[0])
            if not info:
                continue

            std_name = info["name"]
            weight = self.get_weight(f)
            
            # 判斷是否為 must trait（備用方法，用於中文特徵名稱）
            # 🔥 life_form 已移除：照片角度/尺度易誤判，不再當 must
            is_must = False
            if "葉序" in std_name or "leaf_arrangement" in std_name.lower():
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
                query_token_normalized = normalize_token(f)
                query_trait, query_value = query_token_normalized.split("=", 1)
                if use_tokens and plant_trait_tokens:
                    # 檢查 plant_trait_tokens 中是否有匹配的 token（使用正規化後的值）
                    for plant_token in plant_trait_tokens:
                        if "=" in plant_token:
                            plant_token_normalized = normalize_token(plant_token)
                            plant_trait, plant_value = plant_token_normalized.split("=", 1)
                            if query_trait == plant_trait and query_value == plant_value:
                                matched_flag = True
                                # 記錄匹配的 must trait
                                if query_trait in MUST_KEYS and query_token_normalized not in must_traits_matched:
                                    must_traits_matched.append(query_token_normalized)
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
                if plant_key_features_norm:
                    if std_name in plant_key_features_norm or f in plant_key_features_norm:
                        matched_flag = True
                    # 部分匹配：植物端有「穗狀」可匹配 query「穗狀花序」、有「蒴」可匹配「蒴果」
                    elif any(
                        kfn in std_name or std_name.startswith(kfn) or (len(kfn) >= 2 and kfn in std_name)
                        for kfn in plant_key_features_norm
                    ):
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
        
        # 🔥 關鍵修復：Must Gate 檢查（只檢查查詢中提供的 must traits）
        # 如果查詢中沒有提供 must traits，不進行 gating
        must_matched = True
        if must_traits_in_query:
            # 正規化 plant_trait_tokens（建立集合以便快速查找）
            plant_set = set()
            if use_tokens and plant_trait_tokens:
                for plant_token in plant_trait_tokens:
                    if "=" in plant_token:
                        plant_set.add(normalize_token(plant_token))
            
            # 檢查所有查詢中的 must traits 是否都在 plant 中
            # 只要求查詢中提供的 must traits 全部匹配，不要求所有 must traits 都存在
            # 🔥 寬鬆檢查：如果植物資料中沒有該特徵的任何資訊（plant_set 中沒有該類別的任何特徵），則視為 unknown，不視為不匹配
            # 只有當植物資料中有該類別的其他特徵，但不包含查詢的特徵時，才視為不匹配
            
            # 首先，將 plant traits 按類別分組
            plant_traits_by_category = {}
            if use_tokens and plant_trait_tokens:
                for plant_token in plant_trait_tokens:
                    if "=" in plant_token:
                        k, v = plant_token.split("=", 1)
                        k = k.strip()
                        if k not in plant_traits_by_category:
                            plant_traits_by_category[k] = set()
                        plant_traits_by_category[k].add(normalize_token(plant_token))
            
            must_matched = True
            for query_token in must_traits_in_query:
                if "=" in query_token:
                    q_trait, q_val = query_token.split("=", 1)
                    q_trait = q_trait.strip()
                    
                    # 如果植物資料中完全沒有這個類別的特徵（例如缺失 leaf_arrangement），視為 unknown -> pass
                    if q_trait not in plant_traits_by_category:
                        continue
                        
                    # 如果有這個類別的特徵，則必須匹配其中之一
                    # 使用 normalize_token 確保格式一致
                    normalized_query = normalize_token(query_token)
                    
                    # 檢查是否有匹配
                    # 注意：這裡使用嚴格匹配（value 必須一致）
                    # 但考慮到 canon_value 可能已經處理了部分同義詞
                    if normalized_query not in plant_traits_by_category[q_trait]:
                        must_matched = False
                        break
                else:
                    # 對於非 token 格式的 must trait（向後兼容），保持原邏輯
                    if query_token not in plant_set:
                        must_matched = False
                        break

        return {
            "match_score": match_score,
            "matched_features": matched,
            "missing_features": missing,
            "coverage": coverage,
            "must_matched": must_matched,
            "must_traits_in_query": must_traits_in_query,
            "must_traits_matched": must_traits_matched,
        }


# Vision AI 的結構化 Prompt（對齊前端 ai-lab 自由探索模式的輸出規格）
# 目的：
# - 讓模型「判定」與「回覆」一致（<analysis>/<reply>）
# - 並穩定輸出 traits JSON，供後端 traits-parser/hybrid-search 使用
# - 僅用於「植物辨識」路徑，不影響一般 chat-text API
VISION_ROUTER_PROMPT = """你是一位專業的植物形態學家與生態研究員。

**重要：你必須按照以下步驟進行分析，絕對不能跳過任何步驟！**

請依照以下 XML 格式回答，並在最後輸出結構化的 traits JSON：

<analysis>
第一步：尺寸判斷（必須完成，用於驗證生活型）
- 請估算：整體高度、葉片長度、花朵直徑（若可見）
- 喬木通常 > 3m；灌木約 0.5–3m；草本通常 < 0.5m

第二步：詳細描述圖片細節（必須完成）
- 如果是植物，必須使用專業形態學術語描述（生活型、葉序、葉形、葉緣、花序、果實等）
- **花序類型必須仔細判斷**：請觀察花朵的排列方式，並在描述中明確說明
  * **總狀花序**：花朵沿主軸排列，下部的花先開，花梗長度相近。描述時請寫「總狀花序」或「沿主軸排列」
  * **繖房花序**：花朵排列在一個平面上，外圍的花先開，花梗長度不等（外長內短）。描述時請寫「繖房花序」或「花朵排列在一個平面上，外圍先開」
  * **聚繖花序**：中央的花先開，外圍的花後開。描述時請寫「聚繖花序」或「中央先開」
  * **圓錐花序**：總狀花序的分枝再形成總狀花序。描述時請寫「圓錐花序」或「總狀花序的分枝」
  * **繖形花序**：所有花梗從同一點發出，像雨傘骨架。描述時請寫「繖形花序」或「從同一點發出」
  * **頭狀花序**：花朵密集排列成頭狀，無明顯花梗。描述時請寫「頭狀花序」或「密集排列成頭狀」
  * **穗狀花序**：花朵無花梗，直接著生在主軸上。描述時請寫「穗狀花序」或「無花梗，直接著生」
  * **下垂花序**：花序向下垂掛（如長穗木）。描述時請寫「下垂花序」或「向下垂掛」或「花序向下」
- **重要**：在描述中必須明確寫出你觀察到的花序排列方式，不要只寫「花序」兩個字
- 如果花序類型不明確，請描述你看到的排列方式，不要隨便猜測

第三步：判斷類別（必須完成）
明確指出：植物 / 動物 / 人造物 / 其他

第四步：提取關鍵識別特徵（僅限植物）
**重要：只提取你能清楚觀察到的特徵，不確定就標註 unknown，絕對不要猜測**

- 生活型（與尺寸一致）
- 葉序（互生/對生/輪生）
  * **如果看不到葉片排列方式或角度不清楚** → 標註 unknown
  * 不要因為「看起來像」就猜測
- 葉形（披針/卵形/橢圓/心形/線形/圓形...）
  * **如果葉形不清楚** → 標註 unknown
- 葉緣（全緣/鋸齒/波狀/裂緣...）
  * **如果看不到葉緣細節** → 標註 unknown
  * 不要因為「看起來像」就猜測全緣或鋸齒
- **花序類型（必須仔細判斷，這是關鍵鑑別特徵，但不要猜測）**：
  * **如果看不到整個花序輪廓、看不到花梗排列方式、或無法判斷開花順序** → 必須標註 inflorescence=unknown
  * 觀察花朵排列：是沿主軸排列（總狀/穗狀）？還是從同一點發出（繖形）？還是排列在一個平面上（繖房）？
  * 觀察開花順序：外圍先開（繖房）？中央先開（聚繖）？下部先開（總狀）？
  * 觀察花序方向：是向上（直立）？還是向下（下垂）？
  * **如果花序向下垂掛且清楚可見**，必須標註 inflorescence_orientation=drooping
  * **如果花朵排列在一個平面上且外圍先開且清楚可見**，必須標註 inflorescence=corymb（繖房花序）
  * **如果不確定，請標註 unknown，不要用常識補完**
- 花色（只描述花朵顏色；沒有花就 unknown）
- 葉色（leaf_color）與花色（flower_color）是不同特徵

**強制檢查清單（必須逐項檢查，不可跳過）：**

**花（Flower）檢查：**
- 是否看得到花？看得到就必須填：
  - flower_color（花色）：white/yellow/red/purple/pink/orange/unknown
  - flower_shape（花形）：bell/tubular/funnel/flat/labiate/papilionaceous/cruciform/radial/unknown（鐘形/筒狀/漏斗/扁平/唇形/蝶形/十字/放射狀）
  - flower_position（花位置）：solitary/pair/cluster/unknown（單生/成對/簇生）
  - inflorescence_orientation（花序方向）：erect/drooping/unknown（直立/下垂）
- 看不到花 → 以上欄位填 unknown，confidence ≤ 0.3

**果（Fruit）檢查：**
- 是否看得到果？看得到就必須填：
  - fruit_type（果型）：berry/drupe/capsule/legume/samara/achene/nut/pome/unknown
  - fruit_color（果色）：red/orange/yellow/green/purple/black/brown/unknown
  - fruit_cluster（果實排列）：solitary/cluster/raceme/axillary/unknown（單生/成串/總狀/腋生）
  - fruit_surface（果面）：smooth/hairy/rough/ridged/unknown（光滑/有毛/粗糙/有棱）
  - calyx_persistent（萼宿存）：true/false/unknown（萼是否宿存）
- 看不到果 → 以上欄位填 unknown，confidence ≤ 0.3

**毛被（Trichome）檢查：**
- 葉/枝/果是否有毛？必須填：
  - surface_hair（表面毛被）：glabrous/pubescent_soft/tomentose/hirsute/spiny/scaly/unknown（無毛/柔毛/絨毛/粗毛/有刺/鱗片）
- 無法判斷 → unknown，confidence ≤ 0.3

第五步：尺寸驗證（僅限植物）
檢查生活型與尺寸是否一致，若不一致請修正。

第六步：特徵驗證與交叉檢查（僅限植物，新增步驟）
在輸出 JSON 之前，請**逐項檢查**以下項目，這是確保準確性的關鍵步驟：

- **花序類型驗證（最重要，這是火筒樹、長穗木等植物的關鍵鑑別特徵）**：
  * **首先檢查花序方向**：
    - 如果花序明顯向下垂掛、懸垂、或向下彎曲 → 必須標註 inflorescence_orientation=drooping，confidence ≥ 0.7
    - 這是長穗木等植物的關鍵特徵，絕對不能漏掉
  * **然後檢查花序排列方式**：
    - 如果你標註 inflorescence=raceme（總狀花序），請確認：
      * 花朵是否沿主軸排列？
      * 下部是否先開？
      * 花梗長度是否相近？
      * **如果不符合，請改為正確的類型（可能是 corymb 或 cyme）**
    - **如果你看到花朵排列在一個平面上，且外圍先開**：
      * 必須標註 inflorescence=corymb（繖房花序）
      * confidence 應該 ≥ 0.7
      * evidence 必須包含「花朵排列在一個平面上，外圍先開」或類似描述
      * 這是火筒樹等植物的關鍵特徵，絕對不能標註為 raceme
    - 如果你標註 inflorescence=cyme（聚繖花序），請確認：
      * 中央是否先開？
      * 外圍是否後開？
  * **重要提醒**：
    - 繖房花序（corymb）和總狀花序（raceme）容易混淆，但判斷標準不同
    - 繖房花序：花朵排列在一個平面上，外圍先開，花梗長度不等（外長內短）
    - 總狀花序：花朵沿主軸排列，下部先開，花梗長度相近
    - 如果不確定，請標註 unknown，不要隨便猜測

- **花色驗證**：
  * 如果你看到紫色或粉紅色花朵，請確認：
    - 深紫/濃紫 → flower_color=purple
    - 粉紅/淡粉 → flower_color=pink
    - 不要標註為 red 或 unknown
  * 如果花朵很大或很顯眼（如野牡丹），請確認是否標註了 flower_shape 或 flower_position

- **葉序驗證**：
  * 互生：葉片交替排列在莖的兩側（每節只有一片葉）
  * 對生：葉片成對排列在莖的兩側（每節有兩片葉相對）
  * 輪生：三片或以上葉片排列在同一節上
  * 如果不確定，請標註 unknown，不要隨便猜測

- **葉緣驗證**：
  * 全緣：葉緣平滑，無鋸齒或波狀
  * 鋸齒：葉緣有明顯的鋸齒狀
  * 波狀：葉緣有波浪狀起伏

- **交叉檢查**：
  * 檢查所有特徵的 evidence 是否包含足夠的描述
  * 檢查 confidence 是否與觀察的清晰度一致
  * 如果發現不一致，請修正後再輸出 JSON

第七步：初步猜測（僅限植物）
可提出 1–3 個候選名稱（中文為主），但要標註為「猜測」。
</analysis>

<reply>
用親切、專業但通俗的語氣介紹你看到的東西。
重要：在 <reply> 中只能根據 <analysis> 的細節來介紹，不要把「猜測」當成定論。
</reply>

第八步：最後檢查（僅限植物，輸出 JSON 前的最後一步）
在輸出 JSON 之前，請再次檢查以下關鍵項目：

1. **花序方向檢查**：
   - 如果照片中明顯看到花序向下垂掛、懸垂、或向下彎曲
   - → 必須確保 inflorescence_orientation=drooping，confidence ≥ 0.7
   - → evidence 必須包含「向下垂掛」「懸垂」「向下彎曲」等描述
   - 這是長穗木等植物的關鍵特徵，絕對不能漏掉

2. **花序類型檢查**：
   - 如果照片中看到花朵排列在一個平面上，且外圍先開
   - → 必須確保 inflorescence=corymb（繖房花序），confidence ≥ 0.7
   - → evidence 必須包含「花朵排列在一個平面上，外圍先開」或類似描述
   - 這是火筒樹等植物的關鍵特徵，絕對不能標註為 raceme

3. **如果以上檢查發現問題，請修正後再輸出 JSON**

第九步：輸出結構化特徵（僅限植物，必須輸出 JSON）
如果第三步判斷為「植物」，請在最後輸出。**果實必須遵守兩段式 Gate：**

### 果實 Gate（必做，禁止跳過）

**必填欄位（不可整段省略）：** fruit_visible、fruit_type、fruit_color 必須永遠出現在 JSON 中；看不到果實則填 value=unknown，不可省略這三個欄位。

**第一步（可見性判斷）— Fruit Visibility Gate：**
你先判斷照片中「果實是否清楚可見」。
- 若看不到果實、果實太小、被遮擋、像素不足、或無法確定是否為果 → 直接輸出 fruit_visible=false，fruit_type 與 fruit_color 必須為 unknown，confidence ≤ 0.3
- 只有當你能指出果實的**位置**（例如：右下/枝條末端/成串）、**形狀**（球形/橢圓）、並且確定是果實時，才允許 fruit_visible=true

**第二步（僅當 fruit_visible=true 時）— Fruit Classification：**
fruit_type 只能從：berry/drupe/capsule/legume/samara/achene/nut/pome/unknown 選
fruit_color 只能從：red/orange/yellow/green/purple/black/brown/unknown 選
fruit_arrangement（可選）：solitary/cluster/raceme/unknown，描述果實為單生、成串或總狀排列
若無法分辨類型或顏色 → 填 unknown

**證據檢查：** 若 fruit_type != unknown，evidence 必須同時包含「果/果實/結實」任一字 + 位置或形狀描述，否則一律改回 unknown。

```json
{
  "fruit_visible": {"value":"false","confidence":0.2,"evidence":"照片未見果實"},
  "life_form": {"value":"shrub","confidence":0.8,"evidence":"..."},
  "phenology": {"value":"unknown","confidence":0.2,"evidence":"..."},
  "leaf_arrangement": {"value":"opposite","confidence":0.9,"evidence":"..."},
  "leaf_shape": {"value":"ovate","confidence":0.8,"evidence":"..."},
  "leaf_type": {"value":"simple","confidence":0.6,"evidence":"..."},
  "leaf_margin": {"value":"entire","confidence":0.85,"evidence":"..."},
  "leaf_texture": {"value":"glabrous","confidence":0.6,"evidence":"..."},
  "leaf_color": {"value":"green","confidence":0.7,"evidence":"..."},
  "inflorescence": {"value":"corymb","confidence":0.8,"evidence":"花朵排列在一個平面上，外圍先開"},
  "flower_color": {"value":"purple","confidence":0.8,"evidence":"..."},
  "flower_shape": {"value":"unknown","confidence":0.1,"evidence":"照片未見花朵或無法判斷花形"},
  "flower_position": {"value":"unknown","confidence":0.1,"evidence":"照片未見花朵或無法判斷位置"},
  "inflorescence_orientation": {"value":"drooping","confidence":0.8,"evidence":"花序向下垂掛"},
  "fruit_type": {"value":"unknown","confidence":0.1,"evidence":"照片未見果實"},
  "fruit_color": {"value":"unknown","confidence":0.1,"evidence":"照片未見果實"},
  "fruit_arrangement": {"value":"unknown","confidence":0.1,"evidence":"照片未見果實"},
  "fruit_cluster": {"value":"unknown","confidence":0.1,"evidence":"照片未見果實"},
  "fruit_surface": {"value":"unknown","confidence":0.1,"evidence":"照片未見果實"},
  "calyx_persistent": {"value":"unknown","confidence":0.1,"evidence":"照片未見果實或無法判斷"},
  "root_type": {"value":"unknown","confidence":0.1,"evidence":"照片未見根部"},
  "stem_type": {"value":"unknown","confidence":0.1,"evidence":"..."},
  "seed_type": {"value":"unknown","confidence":0.1,"evidence":"照片未見種子"},
  "seed_color": {"value":"unknown","confidence":0.1,"evidence":"照片未見種子"},
  "surface_hair": {"value":"unknown","confidence":0.1,"evidence":"..."}
}
```

重要規則（嚴格遵守，違反會導致辨識錯誤）：
1) 每個 trait 都要有 value、confidence(0~1)、evidence
2) **看不到/無法判斷請用 value=unknown 並給低 confidence（0.1–0.3）**
3) **只填能清楚觀察到的特徵，不確定就 unknown；絕對禁止猜測補齊**
4) **寧可輸出 2–4 個有證據的強特徵，不要湊滿 5 個通用特徵（灌木/單葉/全緣/圓錐）**
5) **錯的特徵比漏掉更致命**：如果你不確定花序類型，請標註 unknown，不要隨便猜測「總狀花序」或「圓錐花序」
6) **強特徵優先**：複葉類型、果實、花序型（特別是繖房花序、下垂花序）、葉緣鋸齒等比生活型更具鑑別力
7) **花序類型特別重要（這是火筒樹、長穗木等植物的關鍵鑑別特徵）**：
   * **如果看不到整個花序輪廓、看不到花梗排列方式、或無法判斷開花順序** → 必須標註 inflorescence=unknown，confidence ≤ 0.3
   * **如果看到花序向下垂掛、懸垂、或向下彎曲** → 必須標註 inflorescence_orientation=drooping（下垂花序），confidence ≥ 0.7
   * **如果看到花朵排列在一個平面上且外圍先開** → 必須標註 inflorescence=corymb（繖房花序），confidence ≥ 0.7
   * 如果看到中央先開 → 必須標註 inflorescence=cyme（聚繖花序）
   * **不要隨便標註 inflorescence=raceme（總狀花序）**，除非你真的看到：
     - 花朵沿主軸排列（不是平面排列）
     - 下部先開（不是外圍先開）
     - 花梗長度相近（不是外長內短）
   * **如果花序類型不明確，請標註 unknown，不要用常識補完（例如很多花就說總狀）**
8) **葉序/葉緣判斷**：
   * 如果看不到葉片排列方式或葉緣細節 → 標註 unknown
   * 不要因為「看起來像」就猜測互生/對生或全緣/鋸齒
9) 若第三步判斷為「動物/人造物/其他」，請輸出空 JSON：{}
10) fruit_visible=false 時，fruit_type 與 fruit_color 必須為 unknown

### 果實輸出範例（照做可避免亂猜）

例1：看不到果實（只有葉、花）→ fruit_visible=false，fruit_type/color=unknown，evidence：「照片未見果實」

例2：疑似有小點但無法確認 → fruit_visible=false，fruit_type/color=unknown，evidence：「右上有疑似小點但無法確認為果實」

例3：清楚看到紅色圓形漿果於枝條末端 → fruit_visible=true，fruit_type=berry，fruit_color=red，evidence：「枝條末端有成串紅色球形漿果」
"""


def get_vision_prompt():
    """取得 Vision Router Prompt"""
    return VISION_ROUTER_PROMPT


# 測試用
if __name__ == "__main__":
    # 測試計算器
    data_path = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw-final-4302.jsonl"

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
