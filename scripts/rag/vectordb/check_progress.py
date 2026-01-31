#!/usr/bin/env python3
"""
快速查看向量化進度
使用方式: python scripts/rag/vectordb/check_progress.py
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

try:
    from qdrant_client import QdrantClient
    QDRANT_AVAILABLE = True
except ImportError:
    QDRANT_AVAILABLE = False
    print("⚠️  qdrant-client 未安裝，將只顯示本地進度（不顯示 Qdrant 狀態）")
    print("   如需完整功能，請執行: pip install qdrant-client")
    print("   或使用虛擬環境: source venv-embedding/bin/activate")
    print()

# 設定路徑 - 自動找到專案根目錄
SCRIPT_DIR = Path(__file__).resolve().parent
# 從 vectordb -> rag -> scripts -> project_root
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent

# 如果從 home 目錄執行，嘗試找到專案目錄
if not (PROJECT_ROOT / "scripts" / "rag" / "data" / "plants-forest-gov-tw.jsonl").exists():
    # 嘗試從常見的專案位置尋找
    possible_paths = [
        Path.home() / "gps-task",
        Path("/Users/hung-weichen/gps-task"),
        Path.cwd() / "gps-task",
    ]
    for path in possible_paths:
        if (path / "scripts" / "rag" / "data" / "plants-forest-gov-tw.jsonl").exists():
            PROJECT_ROOT = path
            break
    else:
        # 如果還是找不到，使用當前工作目錄
        PROJECT_ROOT = Path.cwd()
        # 檢查是否在專案目錄中
        if not (PROJECT_ROOT / "scripts" / "rag" / "data" / "plants-forest-gov-tw.jsonl").exists():
            print(f"❌ 無法找到專案目錄！")
            print(f"   請確保在專案目錄中執行，或使用絕對路徑")
            print(f"   預期路徑: {PROJECT_ROOT / 'scripts' / 'rag' / 'data' / 'plants-forest-gov-tw.jsonl'}")
            sys.exit(1)

progress_file = PROJECT_ROOT / "scripts" / "rag" / "vectordb" / "embed_plants_forest_progress.json"
data_file = PROJECT_ROOT / "scripts" / "rag" / "data" / "plants-forest-gov-tw.jsonl"

print("=" * 70)
print("📊 向量化進度即時報告")
print("=" * 70)

# 讀取本地進度
if progress_file.exists():
    with open(progress_file, 'r', encoding='utf-8') as f:
        progress = json.load(f)
    processed = len(progress.get('processed', []))
    
    # 檢查檔案修改時間
    mtime = progress_file.stat().st_mtime
    last_update = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
    
    # 讀取總數
    if data_file.exists():
        with open(data_file, 'r', encoding='utf-8') as f:
            total = sum(1 for line in f if line.strip())
    else:
        print(f"\n❌ 資料檔案不存在: {data_file}")
        sys.exit(1)
    
    remaining = total - processed
    percentage = (processed / total * 100) if total > 0 else 0
    
    # 計算預估剩餘時間（假設每批約 3.5 秒，每批 32 筆）
    batches_remaining = (remaining + 31) // 32  # 向上取整
    estimated_seconds = batches_remaining * 3.5
    estimated_minutes = estimated_seconds / 60
    
    print(f"\n📈 本地進度：")
    print(f"  ✅ 已處理: {processed:,} / {total:,} 筆")
    print(f"  ⏳ 剩餘: {remaining:,} 筆")
    print(f"  📊 完成度: {percentage:.1f}%")
    print(f"  ⏱️  預估剩餘時間: 約 {estimated_minutes:.1f} 分鐘")
    print(f"  📅 最後更新: {last_update}")
    
    # 查詢 Qdrant 實際向量數量
    if QDRANT_AVAILABLE:
        try:
            QDRANT_URL = os.environ.get("QDRANT_URL", "https://gps-task-qdrant.zeabur.app")
            QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "s659vbjm0Tf2q8WUw1oInr3PK74uycLd")
            
            parsed = urlparse(QDRANT_URL)
            is_https = parsed.scheme == 'https'
            host = parsed.hostname or 'localhost'
            port = parsed.port or (443 if is_https else 6333)
            
            client = QdrantClient(
                host=host,
                port=port,
                api_key=QDRANT_API_KEY,
                https=is_https,
                prefer_grpc=False,
                timeout=30
            )
            
            collection_info = client.get_collection("taiwan_plants")
            qdrant_count = collection_info.points_count
            
            print(f"\n💾 Qdrant 資料庫狀態：")
            print(f"  📦 向量數量: {qdrant_count:,} 筆")
            print(f"  📐 向量維度: {collection_info.config.params.vectors.size}")
            print(f"  📏 距離度量: {collection_info.config.params.vectors.distance}")
            
            # 檢查同步狀態
            if qdrant_count == processed:
                print(f"  ✅ 同步狀態: 已同步")
            elif qdrant_count < processed:
                print(f"  ⚠️  同步狀態: Qdrant 數量較少（可能正在上傳中）")
            else:
                print(f"  ⚠️  同步狀態: Qdrant 數量較多（可能有舊資料）")
                
        except Exception as e:
            print(f"\n⚠️  無法連接到 Qdrant: {e}")
    else:
        print(f"\n💡 提示: 安裝 qdrant-client 後可查看 Qdrant 資料庫狀態")
    
    # 進度條
    bar_width = 50
    filled = int(bar_width * percentage / 100)
    bar = "█" * filled + "░" * (bar_width - filled)
    print(f"\n📊 進度條: [{bar}] {percentage:.1f}%")
    
    if remaining == 0:
        print("\n🎉 向量化已完成！")
    elif percentage < 100:
        print(f"\n⏳ 向量化進行中...")
        
else:
    print("\n⚠️  進度檔案不存在，可能尚未開始")

print("\n" + "=" * 70)
print("💡 提示: 隨時運行此命令查看最新進度")
print("=" * 70)
