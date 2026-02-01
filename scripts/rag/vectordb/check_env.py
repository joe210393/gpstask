#!/usr/bin/env python3
"""
檢查向量化所需的環境變數
"""

import os

print("=" * 60)
print("🔍 環境變數檢查")
print("=" * 60)

# 檢查 QDRANT
qdrant_url = os.environ.get("QDRANT_URL")
qdrant_key = os.environ.get("QDRANT_API_KEY")
print(f"\n📦 Qdrant:")
print(f"   QDRANT_URL: {qdrant_url or '❌ 未設定'}")
print(f"   QDRANT_API_KEY: {'✅ 已設定' if qdrant_key else '❌ 未設定'}")

# 檢查 Jina
jina_key = os.environ.get("JINA_API_KEY")
print(f"\n🤖 Jina API:")
print(f"   JINA_API_KEY: {'✅ 已設定' if jina_key else '❌ 未設定'}")

# 檢查資料檔案
from pathlib import Path
script_dir = Path(__file__).parent
enhanced_file = script_dir.parent / "data" / "plants-forest-gov-tw-enhanced.jsonl"
original_file = script_dir.parent / "data" / "plants-forest-gov-tw.jsonl"

print(f"\n📁 資料檔案:")
if enhanced_file.exists():
    size = enhanced_file.stat().st_size / (1024 * 1024)
    print(f"   ✅ Enhanced: {enhanced_file.name} ({size:.1f} MB)")
elif original_file.exists():
    size = original_file.stat().st_size / (1024 * 1024)
    print(f"   ⚠️  Original: {original_file.name} ({size:.1f} MB)")
    print(f"   💡 建議：先執行 generate_morphology_summary.py 生成 enhanced 資料")
else:
    print(f"   ❌ 資料檔案不存在")

# 總結
print(f"\n{'=' * 60}")
if qdrant_url and qdrant_key and jina_key:
    print("✅ 所有環境變數已設定，可以開始向量化")
    print(f"\n執行：python3 scripts/rag/vectordb/embed_plants_forest_jina.py")
else:
    print("❌ 缺少必要的環境變數")
    print(f"\n請設定：")
    if not qdrant_url:
        print(f"   export QDRANT_URL='https://gps-task-qdrant.zeabur.app'")
    if not qdrant_key:
        print(f"   export QDRANT_API_KEY='your_qdrant_key'")
    if not jina_key:
        print(f"   export JINA_API_KEY='your_jina_key'")
print("=" * 60)
