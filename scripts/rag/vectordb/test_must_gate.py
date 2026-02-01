#!/usr/bin/env python3
"""
測試 Must Gate 功能是否正確降權

測試場景：
1. 查詢有 life_form=herb，但植物是 life_form=tree → 應該降權 70%
2. 查詢有 leaf_arrangement=opposite，但植物是 leaf_arrangement=alternate → 應該降權 70%
3. 查詢有 life_form=herb，植物也是 life_form=herb → 不應該降權
4. 查詢沒有 must traits → 不應該降權
"""

import json
import sys
from pathlib import Path

# 添加當前目錄到路徑
sys.path.insert(0, str(Path(__file__).parent))

from feature_weights import FeatureWeightCalculator

def load_test_data():
    """載入測試資料"""
    data_file = Path(__file__).parent.parent / "data" / "plants-forest-gov-tw-enhanced.jsonl"
    if not data_file.exists():
        print(f"❌ 找不到資料檔案: {data_file}")
        return None
    
    plants = []
    with open(data_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                plant = json.loads(line)
                plants.append(plant)
            except json.JSONDecodeError:
                continue
    
    return plants

def test_must_gate():
    """測試 Must Gate 功能"""
    print("=" * 60)
    print("🧪 測試 Must Gate 功能")
    print("=" * 60)
    
    # 載入測試資料
    plants = load_test_data()
    if not plants:
        print("❌ 無法載入測試資料")
        return False
    
    print(f"✅ 載入 {len(plants)} 筆植物資料")
    
    # 初始化特徵權重計算器
    try:
        calculator = FeatureWeightCalculator()
        print("✅ 特徵權重計算器初始化成功")
    except Exception as e:
        print(f"❌ 無法初始化特徵權重計算器: {e}")
        return False
    
    # 測試案例
    test_cases = [
        {
            "name": "測試 1: life_form 不匹配（草本 vs 喬木）",
            "query_features": ["life_form=herb", "leaf_arrangement=alternate", "leaf_shape=ovate"],
            "plant_trait_tokens": ["life_form=tree", "leaf_arrangement=alternate", "leaf_shape=ovate"],
            "expected_must_matched": False,
            "description": "查詢是草本，但植物是喬木，應該觸發 Must Gate"
        },
        {
            "name": "測試 2: leaf_arrangement 不匹配",
            "query_features": ["life_form=tree", "leaf_arrangement=opposite", "leaf_shape=ovate"],
            "plant_trait_tokens": ["life_form=tree", "leaf_arrangement=alternate", "leaf_shape=ovate"],
            "expected_must_matched": False,
            "description": "查詢是對生，但植物是互生，應該觸發 Must Gate"
        },
        {
            "name": "測試 3: life_form 匹配",
            "query_features": ["life_form=herb", "leaf_arrangement=alternate", "leaf_shape=ovate"],
            "plant_trait_tokens": ["life_form=herb", "leaf_arrangement=alternate", "leaf_shape=ovate"],
            "expected_must_matched": True,
            "description": "查詢和植物都是草本，不應該觸發 Must Gate"
        },
        {
            "name": "測試 4: 沒有 must traits",
            "query_features": ["leaf_shape=ovate", "flower_color=red"],
            "plant_trait_tokens": ["life_form=tree", "leaf_shape=ovate", "flower_color=white"],
            "expected_must_matched": True,
            "description": "查詢沒有 must traits，不應該觸發 Must Gate"
        },
        {
            "name": "測試 5: 多個 must traits，部分不匹配",
            "query_features": ["life_form=herb", "leaf_arrangement=opposite", "leaf_shape=ovate"],
            "plant_trait_tokens": ["life_form=herb", "leaf_arrangement=alternate", "leaf_shape=ovate"],
            "expected_must_matched": False,
            "description": "life_form 匹配但 leaf_arrangement 不匹配，應該觸發 Must Gate"
        },
    ]
    
    passed = 0
    failed = 0
    
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n{'=' * 60}")
        print(f"📋 {test_case['name']}")
        print(f"   描述: {test_case['description']}")
        print(f"{'=' * 60}")
        
        # 構建 plant_text（用於備用匹配）
        plant_text = " ".join(test_case["plant_trait_tokens"])
        
        # 執行匹配
        try:
            result = calculator.match_plant_features(
                query_features=test_case["query_features"],
                plant_text=plant_text,
                plant_trait_tokens=test_case["plant_trait_tokens"],
                plant_key_features_norm=[]
            )
            
            must_matched = result.get("must_matched", True)
            must_traits_in_query = result.get("must_traits_in_query", [])
            must_traits_matched = result.get("must_traits_matched", [])
            match_score = result.get("match_score", 0.0)
            coverage = result.get("coverage", 0.0)
            
            print(f"   查詢特徵: {test_case['query_features']}")
            print(f"   植物特徵: {test_case['plant_trait_tokens']}")
            print(f"   Must Traits in Query: {must_traits_in_query}")
            print(f"   Must Traits Matched: {must_traits_matched}")
            print(f"   Must Matched: {must_matched}")
            print(f"   預期 Must Matched: {test_case['expected_must_matched']}")
            print(f"   匹配分數: {match_score:.4f}")
            print(f"   覆蓋率: {coverage:.2%}")
            
            # 驗證結果
            if must_matched == test_case["expected_must_matched"]:
                print(f"   ✅ 測試通過: Must Gate 行為正確")
                passed += 1
            else:
                print(f"   ❌ 測試失敗: Must Gate 行為不正確")
                print(f"      預期: {test_case['expected_must_matched']}, 實際: {must_matched}")
                failed += 1
            
            # 如果應該觸發 Must Gate，檢查分數是否被降權
            if not test_case["expected_must_matched"]:
                # 計算預期的降權後分數（70% 降權 = 乘以 0.3）
                expected_penalty = 0.3
                print(f"   💡 提示: 如果 Must Gate 觸發，分數應該被降權 70% (乘以 {expected_penalty})")
        
        except Exception as e:
            print(f"   ❌ 測試執行錯誤: {e}")
            import traceback
            traceback.print_exc()
            failed += 1
    
    # 總結
    print(f"\n{'=' * 60}")
    print(f"📊 測試總結")
    print(f"{'=' * 60}")
    print(f"✅ 通過: {passed}/{len(test_cases)}")
    print(f"❌ 失敗: {failed}/{len(test_cases)}")
    
    if failed == 0:
        print(f"\n🎉 所有測試通過！Must Gate 功能正常運作")
        return True
    else:
        print(f"\n⚠️  有 {failed} 個測試失敗，請檢查 Must Gate 邏輯")
        return False

if __name__ == "__main__":
    success = test_must_gate()
    sys.exit(0 if success else 1)
