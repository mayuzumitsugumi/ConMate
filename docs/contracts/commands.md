# 命令、查詢與提交契約

本文件是待實作介面，不是現有 API。無 HTTP 後端。

## 共通邊界

寫入命令：`{ workspaceId, expectedRevision, operationId, payload }`。

回傳成功：`{ status: 'committed', workspaceRevision, entityIds, warnings }`；失敗：`{ status: 'rejected', issues }`。查詢及預覽不增加修訂。成功命令把來源、衍生分錄、修訂、流水號及操作收據一起提交。

同 operationId／相同正規化請求返回既有結果；不同請求拒絕。expectedRevision 不符拒絕並重新查詢，不自行重送會改變結果的命令。所有 ID 由應用服務產生；UI 不直接修改資料庫。

驗證順序：資料型別 → 工作區／關聯 → 狀態 → 業務數量／金額 → 試算 → 原子提交。警告是否需確認由 issue code 定義，不能一個「忽略全部」略過錯誤。

## 命令清單

| 命令 | payload 核心輸入 | 成功結果／限制 |
| --- | --- | --- |
| CreateWorkspace | 名稱、TWD、Asia/Taipei | 空工作區、修訂及序號空間 |
| SaveCatalog | entityType、資料、新增或既有ID | 只更新允許欄；重複名稱不自動合併 |
| ArchiveCatalog | type、id | 保留歷史外鍵；不級聯刪除 |
| CloneProjectSettings | projectId、共享成員選擇 | 新建企劃／SKU／規則 ID，不複製交易、庫存及付款 |
| RecordExpense | 費用、分配目標、金額 | 分配額核對；確定費用需 actualAmount |
| RecordPayment | 付款方、收款方、整元金額、日期、用途 | 不自動把整筆付款當費用或本金 |
| RecordFunding | 實付來源、受益方、模式、金額 | 可追收本金不得超過可歸屬實付；不追收投入分開 |
| RecordFundingRecovery | agreementId、抵付來源、金額 | 不能重複抵付／超還本金；超出須另列款項 |
| CreateRuleVersion | 約定、適用SKU／方案、計算步驟及政策 | 重疊未消歧回 issue，不靜默改舊規則 |
| ReceiveStock | 批次、庫位、良品數、日期 | 一次來源入庫，數量與批次收貨一致 |
| TransferStock | 批次／單件、來源與目的、數量 | 原子守恆；不能移出他用途保留量 |
| ReservePoolStock | 池版本、批次、庫位、數量 | 專用池；共用配置不呼叫保留 |
| RecordStockDisposition | 類型、批次、庫位、數量、原因 | 無料／耗損／調整各有類型，不產生假營收 |
| OpenSession | sessionId | 核對方案、庫位；缺財務規則僅警告 |
| SaveCartDraft | sessionId、商品行、輸入收款 | 草稿可恢復，不扣庫、不列收入 |
| PostSale | sessionId、方案版本行、實際SKU及數量、指定單件、折扣、收款方／方式、實收 | 提交前總庫存再驗證；共用SKU合併檢查；銷售及出庫原子提交 |
| CancelSale | saleId、原因、退款及商品回收決定 | 依原來源沖回；若已退部分不重複沖回 |
| CorrectSale | saleId、原因、替代內容、實物是否交換 | 保留原資料；收入、成本及庫存都可追溯 |
| ReturnSaleItems | 原issueId、數量、退款、是否回庫、良品與否 | 不超退；回原批次，損壞轉不可售或耗損 |
| CorrectReceipt | receiptId、收款方／方式修正、原因 | 不重做銷售及扣庫 |
| StopSession | sessionId | 建立作業截止點，不清除草稿或未解款項 |
| StartStocktake | 庫位、截止revision | 固定帳面快照；未知未來資料不混入 |
| SaveStocktakeCounts | stocktakeId、各批次／單件實點 | 空白是未點，不等於0 |
| ResolveStocktakeLine | lineId、補記／更正來源或盤差調整／待查 | 少貨不自動售出；待查不改庫存 |
| ConfirmStocktake | stocktakeId、需確認警告 | 容許未解差異；來源變更先重新核對 |
| CalculateSettlement | projectId、cutoff、規則版本 | 純查詢；complete或partial，不扣錢 |
| SaveAllocationDecision | projectId、試算參照可空、各方決定金額、原因可空 | 保留差額；不要求符合系統試算 |
| ConfirmSettlement | 快照、人工決定或試算分配、警告確認 | 缺規則可保留partial並採人工分配；不捏造計算 |
| RecordSettlementPayment | paymentId、分配／人工決定行、抵付額 | 現金與權益分開，不能重複付款抵付 |
| CloseProject | projectId、領回／保留／報廢決定、未解項確認 | 使用者可決定；未清款與存貨不歸零 |
| ReopenProject | projectId、說明可空 | 保留上次結案快照 |

### 收款及找零

現金輸入 `tendered` 與銷售淨額分開：`change=tendered−netDue`，收款紀錄只保存實際淨收。找零不是退款。P0 不支援未明確設定的賒帳；實收不足提示補足或修改交易，不產生假收款。非現金記實際入帳整元金額。

### 快速抽選

UI 點選實際抽出 SKU 後加入購物車，無額外抽獎命令。售罄重抽不寫 Sale、DrawResult 或庫存事件。P0 若先收款後抽，先保存在草稿，品項選齊才提交；畫面明示未記帳，避免把草稿當營收。

## Excel 工作階段

| 操作 | 輸入／輸出 | 保護 |
| --- | --- | --- |
| InspectFile | bytes、檔名 → issues、parsedSummary、capabilities | 不需要工作區；不寫正式資料；可中止 |
| PrepareImport | 檢查結果、模式、目標工作區 → previewId、baseRevision、changes、warnings | 配 ID 僅在暫存；比對工作區與已匯入文件 |
| CommitImport | previewId、expectedRevision、已確認警告 → 原子寫入結果 | 再驗證revision；失敗全部回滾；不先清空原資料 |
| CancelImport | previewId | 清理暫存，不影響正式資料 |
| ExportWorkspace | workspaceId、固定revision → bytes、新documentId | 一致快照、重算、自我驗證；下載發起不等於安全保存 |
| DownloadTemplate | blank／fictional、formatVersion | 不寫正式工作區；範例不能直接覆蓋正式資料 |

匯入模式：create（空模板／虛構案例）、restore（原ID完整還原）、update（同工作區精確基準）、fork（全部ID重建）。分歧合併不支援。取代前提供外部備份與本機還原點，不以下載按鈕成功宣稱已備份。

## 查詢

WorkspaceOverview、CatalogList、StockByLocation、AvailableForPlan、RecentSales、DailyRevenueAndReceipts、StocktakeDifferences、FundingBalances、FinancialPreview、AllocationDifferences、BackupStatus。

查詢明確帶 workspaceId 及需要的 sessionId／projectId／cutoff；區分「淨銷售」「現金持有」「淨利」。缺值回 null 與 unknownItems，畫面顯示尚無法試算。
