# 資料、狀態與不變條件

## 識別及共通資料

獨立紀錄有 `id: UUID v4`、`workspaceId`、`displayCode`、`revision: 正整數`、`createdAt`、`updatedAt`。適用主資料可有 `archivedAt`。所有外鍵同工作區。正式 ID 不變，流水號按工作區／實體遞增且不回收；建立時在同一工作單元分配。

以 ID 精確匹配，不按姓名、列序或業務值猜測。UUID 僅提供識別，不提供授權、防偽或同步保證。資料與 Excel 格式版本獨立於應用版本。

JSON 金額用十進位字串；正式款項單位為 TWD 元整數。數量為安全非負整數。日期 `YYYY-MM-DD`、時間 ISO 8601 含 offset。備註可換行；識別與參照禁止控制字元。

## 實體與關聯

| 群組 | 實體與必要關聯 |
| --- | --- |
| 營運 | Workspace；Party；Project；ProjectMember(project, party)；Event；ProjectEvent(project, event)；SalesChannel；SalesSession(channel, event?)；SessionProject(session, project) |
| 商品 | ProductType；ProductSpec(type)；Artwork(project)；ArtworkContributor(artwork, party)；Product(project, type)；SKU(product, spec, trackingMode)；SKUArtwork(sku, artwork)；SKUInterest(sku, party, ratio) |
| 製作 | ProductionOrder(project, supplier?)；ProductionBatch(order, sku, plannedQty, receivedQty)；PhysicalUnit(batch, uniqueLabel) |
| 費用 | Expense(project, category, estimatedAmount?, actualAmount?, confirmed)；ExpenseAllocation(expense, exactlyOneTarget, amount)；CostRecoveryRule(allocation, sku, version, basis, unitRecovery) |
| 資金 | Payment(payer, payee, amount)；PaymentApplication(payment, expense, amount)；FundingAgreement(project, funder, beneficiary, mode)；FundingAllocation(agreement, expense, paymentApplication?, amount)；FundingRecovery(agreement, source, amount) |
| 販售 | SalesPlan(session)；SalesPlanVersion(plan, price, mode)；SalesPlanItem(version, sku)；DrawPool；DrawPoolVersion(pool, planVersion, stockMode)；DrawPoolItem(version, sku, location, qty) |
| 後續抽號 | DrawRound(version)；DrawTicket(round, numberText)；DrawTicketPrize(ticket, sku, qty)；P0 不啟用號碼業務命令 |
| 庫存 | StockLocation(custodian?, session?)；StockDocument(type, source)；StockDocumentItem(document, batch, unit?, qty)；StockEntry(document, batch, location, unit?, signedQty)；StockReservation(batch, location, source, qty)；StockBalance 為投影 |
| 銷售 | Sale(session, operationId)；SaleLine(sale, planVersion, qty, unitPrice, discount)；SaleFulfillment(line, sku, qty, revenueAllocation)；DrawResult(round?, fulfillment, sku, qty)；StockIssueAllocation(fulfillment, batch, location, unit?, qty)；SaleReceipt(sale, collector, amount) |
| 更正 | SaleAdjustment(original, reason, replacement?)；ReturnLine(originalIssue, qty, refundAmount, returnDisposition) |
| 財務 | SettlementAgreement(project)；SettlementRuleVersion(agreement)；RuleParticipant(version, party)；Settlement(project, cutoff)；SettlementLine(source, ruleVersion, calculationSnapshot)；SettlementDistribution(line, party, kind, amount)；SettlementPayment(payment, distribution, amount) |
| 決定 | AllocationDecision(project, calculationSnapshot?, authorLabel?, reason?, status)；AllocationDecisionLine(decision, party, kind, signedAmount)；付款抵付可指向系統分配或人工決定項，恰選一種 |
| 盤點 | Stocktake(location, cutoffRevision, status)；StocktakeLine(stocktake, batch, unit?, bookQty, actualQty)；StocktakeResolution(line, action, linkedCorrection?, unresolvedReason?) |
| 結案 | ProjectCloseoutItem(project, batch, qty, disposition, recipient?, agreedPrice?, feeDecision?)；CloseoutSnapshot(project, openItems, decision) |
| 追溯 | ImportReceipt(documentId, baseRevision, resultingRevision)；OperationReceipt(operationId, requestDigest, result)；RevisionEvent；MigrationRecord |

柄圖使用不得跨企劃；要共用素材時，明確建立各企劃柄圖參照來源描述，不複製同一筆應收費用。企劃、SKU、批次不可藉改外鍵搬家使歷史改歸屬。

商品權益比例與財務分配比例不同。需要分別持有與處分實物時使用不同 SKU，不以權益比例直接拆庫存。

## 狀態與操作

| 對象 | 狀態／允許操作 |
| --- | --- |
| 主資料 | active → archived；可恢復，已有關聯不可硬刪 |
| 企劃 | draft → active → closed → reopened；由使用者決定，未清項保留 |
| 販售作業 | draft → open → stopped → closed；重新開攤記事件，不刪截止快照 |
| 方案／規則版本 | draft → active → retired；使用後不可就地改價或公式，建新版本 |
| 草稿購物車 | draft → discarded 或 submitted；非銷售、非保留、非扣庫 |
| 銷售 | posted；後續取消、退款或更正以關聯事件衍生狀態，不直接改總額 |
| 保留 | active → consumed／released；不得同時兩次消耗 |
| 盤點 | draft → confirmed；來源截止前資料被更正則 needsReview，可保留 unresolved |
| 試算 | complete／partial；partial 有 unknownItems，未算值為 null 而非 0 |
| 人工分配 | draft → confirmed → superseded；允許不同於試算，保存差額 |
| 結算 | draft → confirmed → partiallyPaid／paid；更正產生追加差額 |
| 匯入 | parsed → invalid 或 validated → previewed → committed／cancelled；工作區變動則 stale |

## 不可破壞的規則

1. 普通銷售不能造成負庫存；調整需明確來源與原因，不以關帳直接抹平。
2. 現存 = 所有已提交庫存分錄總和；可用 = 現存 − 有效保留。
3. 調撥在同一工作單元來源減、目的增；總數守恆。
4. 共用池配置不是保留；專用池才有 reservation。方案庫存不可相加為總數。
5. FIFO 依入庫業務時間、批次 ID 決定；退貨回原出庫批次。FIFO 只能使用選定庫位及適用保留量。
6. 特殊單件一次只能位於一個庫位，不能重複售出／保留；批次模式不產生每件 ID。
7. 交易、收入分配、抽選結果、出庫與操作去重在同一原子單元提交。
8. 同操作ID同輸入回原結果；同操作ID不同輸入報錯，不視為新交易。
9. 交易可跨企劃；收入歸屬依 fulfillment，收款者不能推導擁有者。
10. 未知實際商品不算完成銷售；P0 不提供只記抽數模式。
11. 成本、回收、分配及付款不重複認列；完整規則見 finance.md。
12. 缺規則、分配偏差、未回本及待查盤差是業務狀態，不禁止人工決定與結案。
13. 結案不消除本金、存貨或未付款；關帳後更正保留並重新標記需核對。
14. 草稿取消不回庫；已成交需分辨是否退款、是否收回商品、是否可再售。
15. 同一庫存來源不讓交易表與分錄表各自編輯。系統分錄由來源命令導出。

## 複製、還原與遷移

完整還原保留所有 ID、原版本及追溯。獨立副本建立新 workspaceId，重建所有 ID／外鍵，記錄複製來源但不保留可碰撞的操作識別。

資料庫遷移先驗證可用版本及備份提示，在交易內完成並保留 ID。失敗不得刪庫重建。新版格式不能用舊程式默默降級。第一版不合併分歧工作區。
