#!/usr/bin/env python3
"""
自動補詞腳本 - 掃描全庫找出未映射的 key_features，自動建議補齊詞彙表

功能：
1. 掃描全庫的 key_features
2. 找出未被 trait_vocab.json 映射的 token
3. 使用規則建議分類
4. 產出 patch 檔和報表

輸出：
- unmapped_top.csv：最常見「未映射 token」Top N
- suggested_patch.json：自動建議要新增到 vocab 的同義詞
- mapping_report.csv：每個 token 的映射結果
"""

import json
import re
import collections
import csv
from pathlib import Path
from typing import Dict, List, Tuple, Optional

# 路徑設定
SCRIPT_DIR = Path(__file__).parent
JSONL_PATH = SCRIPT_DIR.parent / "data" / "plants-forest-gov-tw-enhanced.jsonl"
if not JSONL_PATH.exists():
    JSONL_PATH = SCRIPT_DIR.parent / "data" / "plants-forest-gov-tw.jsonl"

OUT_UNMAPPED_CSV = SCRIPT_DIR / "unmapped_top.csv"
OUT_PATCH_JSON = SCRIPT_DIR / "suggested_patch.json"
OUT_REPORT_CSV = SCRIPT_DIR / "mapping_report.csv"

# 載入詞彙表
VOCAB_PATH = SCRIPT_DIR / "trait_vocab.json"
with VOCAB_PATH.open("r", encoding="utf-8") as f:
    VOCAB = json.load(f)

# 建立反向映射表：zh token -> (trait, canon)
REVERSE_MAP: Dict[str, Tuple[str, str]] = {}
for trait, values in VOCAB.items():
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
        if "繖形" in tok or "傘形" in tok:
            return "inflorescence", "umbel", "rule:infl"
        if "頭狀" in tok:
            return "inflorescence", "capitulum", "rule:infl"
        if "繖房" in tok:
            return "inflorescence", "corymb", "rule:infl"
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
    
    # special features
    if "氣生根" in tok or "氣根" in tok:
        return "special_features", "aerial_root", "rule:special"
    if "板根" in tok:
        return "special_features", "buttress", "rule:special"
    if "胎生" in tok:
        return "special_features", "viviparous", "rule:special"
    if "紅苞" in tok or "苞葉" in tok:
        return "special_features", "bract_red", "rule:special"
    
    # 顏色 + 器官（常見變體）
    color_organs = {
        "紅果": ("fruit_color", "red"),
        "黃果": ("fruit_color", "yellow"),
        "黑果": ("fruit_color", "black"),
        "紫果": ("fruit_color", "purple"),
        "白果": ("fruit_color", "white"),
        "紅苞葉": ("special_features", "bract_red"),
        "紅苞": ("special_features", "bract_red"),
    }
    if tok in color_organs:
        trait, canon = color_organs[tok]
        return trait, canon, "rule:color_organ"
    
    # 果實型態
    fruit_types = {
        "球果": ("fruit_type", "cone"),
        "蒴果": ("fruit_type", "capsule"),
        "翅果": ("fruit_type", "samara"),
        "瘦果": ("fruit_type", "achene"),
        "長角果": ("fruit_type", "silique"),
    }
    if tok in fruit_types:
        trait, canon = fruit_types[tok]
        return trait, canon, "rule:fruit_type"
    
    return None


def parse_jsonl_line(line: str):
    """解析 JSONL 行（處理尾隨逗號）"""
    line = line.strip()
    if not line:
        return None
    if line.endswith(","):
        line = line[:-1]
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


# 掃描全庫：統計 token 次數
print(f"📖 讀取資料：{JSONL_PATH}")
counter = collections.Counter()
examples = collections.defaultdict(list)

with JSONL_PATH.open("r", encoding="utf-8") as f:
    for line_num, line in enumerate(f, 1):
        obj = parse_jsonl_line(line)
        if not obj:
            continue
        
        identification = obj.get("identification") or {}
        kf = identification.get("key_features") or []
        
        for t in kf:
            tok = normalize_token(t)
            if not tok or tok in ("未見描述", "未見", "不明", "未提供資訊"):
                continue
            
            counter[tok] += 1
            if len(examples[tok]) < 3:
                chinese_name = obj.get("chinese_name", "")
                if chinese_name:
                    examples[tok].append(chinese_name)

print(f"   總共掃描到 {len(counter)} 個唯一 token")

# 逐 token 做 mapping / 建議補詞
print(f"🔍 開始映射和建議...")
rows = []
unmapped = collections.Counter()

# patch 結構：把「新同義詞」加進現有 VOCAB
patch = {"add_synonyms": {}}

def patch_add(trait, canon, synonym):
    """將同義詞加入 patch"""
    patch["add_synonyms"].setdefault(trait, {})
    patch["add_synonyms"][trait].setdefault(canon, [])
    if synonym not in patch["add_synonyms"][trait][canon]:
        patch["add_synonyms"][trait][canon].append(synonym)

for tok, cnt in counter.items():
    # 先嘗試啟發式映射
    result = heuristic_map(tok)
    if result is None:
        # 再嘗試規則建議
        result = suggest_rule(tok)
    
    if result is None:
        unmapped[tok] = cnt
        rows.append([tok, cnt, "", "", "UNMAPPED", "|".join(examples[tok])])
        continue
    
    # mapped or suggested → 寫入 patch（把這個 tok 當同義詞收進去）
    trait, canon, how = result
    patch_add(trait, canon, tok)
    rows.append([tok, cnt, trait, canon, how, "|".join(examples[tok])])

# 輸出報表
print(f"📊 產生報表...")

# mapping report
with OUT_REPORT_CSV.open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["token", "count", "trait", "canonical", "how", "examples"])
    w.writerows(sorted(rows, key=lambda r: (-int(r[1]), r[0])))

# unmapped top
topN = 300
with OUT_UNMAPPED_CSV.open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["token", "count", "examples"])
    for tok, cnt in unmapped.most_common(topN):
        w.writerow([tok, cnt, "|".join(examples[tok])])

# patch json
OUT_PATCH_JSON.write_text(
    json.dumps(patch, ensure_ascii=False, indent=2),
    encoding="utf-8"
)

print(f"\n✅ 完成！")
print(f"   總 token 數：{sum(counter.values())}")
print(f"   唯一 token：{len(counter)}")
print(f"   未映射唯一 token：{len(unmapped)}")
print(f"   映射率：{(len(counter) - len(unmapped)) / len(counter) * 100:.1f}%")
print(f"\n📁 輸出檔案：")
print(f"   - 映射報表：{OUT_REPORT_CSV}")
print(f"   - 未映射 Top {topN}：{OUT_UNMAPPED_CSV}")
print(f"   - 建議 Patch：{OUT_PATCH_JSON}")
print(f"\n💡 下一步：")
print(f"   1. 檢查 unmapped_top.csv，查看未映射的 token")
print(f"   2. 檢查 suggested_patch.json，確認建議是否合理")
print(f"   3. 手動審核後，合併 patch 到 trait_vocab.json")
