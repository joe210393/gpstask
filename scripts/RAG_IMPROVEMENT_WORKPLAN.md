# RAG 辨識改進工項計畫

依序執行，每步完成後測試再進入下一步。

---

## 工項清單

| 步驟 | 工項 | 狀態 | 備註 |
|------|------|------|------|
| 1 | 補齊 traits-parser 映射 | ✅ 完成 | racemose、spiral、leaf_type、compound_type |
| 2 | flower_color/seed_color 混淆處理 | ✅ 完成 | 種子顏色誤填 flower_color 時丟棄 |
| 3 | 擴大 top_k (3→30) | ✅ 完成 | Node 端 RAG_TOP_K=30，可 env 覆寫 |
| 4 | 移除 +0.15 gate，改合併打分 | ✅ 完成 | mergePlantResults 合併兩階段候選 |
| 5 | 測試 10~15 筆驗證 | ✅ 完成 | 12 筆，見 RAG_TEST_CASES_RECORD.md 新一輪摘要 |
| **5.5** | **hybrid 空陣列診斷與修正** | ✅ 完成 | 日誌、空 query 兜底、encode 失敗/0 候選時回傳與日誌 |
| 6 | 動態權重（w_embed/w_feat + 動態 top_k） | 待進行 | 依 traits 品質 Q 調整 |
| 7 | 矛盾重罰（先 penalty，不硬刪） | 待進行 | 規則表 + 懲罰倍率 |
| 8 | Must Gate（少數高辨識力 trait） | 待進行 | 依 Step 7 效果再上 |

---

## 進階工項（建議最後處理）

| 工項 | 說明 | 建議順序 |
|------|------|----------|
| **動態權重** | 依 traits 品質調整 embed/feature 權重，需定義品質門檻與權重區間 | Step 6 |
| **矛盾規則具體化** | 定義哪些 trait 組合視為矛盾、規則列表與優先順序 | Step 7、8 |

---

## 新一輪測試結論（12 筆）

- **正確辨識率**：0%
- **有找到但排名在後**：3 筆（小金雀、金露花）
- **第二階段空陣列**：3 筆（風鈴草、西印度櫻桃、長穗木）
- **下步優先**：Step 5.5 釐清 hybrid 空陣列 → Step 6 動態權重

---

## Step 5.5 空陣列診斷說明

發生「第二階段搜尋無結果」時，請對照以下日誌：

- **Node**：`[RAG] 第二階段請求: query=N字 features=M guess_names=K` → 確認有送出 query/features。
- **Node**：`第二階段搜尋無結果（API 錯誤: ...)` 或 `（results.length=0）` → 區分是連線/API 錯誤還是後端回傳空陣列。
- **Python**：`POST /hybrid-search 收到: query_len=...` → 確認後端有收到 body。
- **Python**：`hybrid_search 跳過: Qdrant 未連線` → 服務尚未就緒。
- **Python**：`hybrid_search 警告: query 為空...` → 入參缺 query 且無兜底。
- **Python**：`hybrid_search encode_text 失敗` 或 `hybrid_search 空候選: Qdrant 回傳 0 筆` → 依訊息排查 Jina / Qdrant。

**修正**：query 為空時改以 guess_names 或 features 兜底；encode 失敗或 0 候選時明確回傳空陣列並寫入日誌。

---

## 注意事項

- **補齊映射不需重新向量化**：只影響查詢端
- **準確度優先**：速度優化延後
- **每步獨立 commit**：便於回滾
