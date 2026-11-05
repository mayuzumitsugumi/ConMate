import { record, text } from "../catalog/operations";
import { safeAmount } from "../money";
import { sameData } from "../../shared/data-equality";
import { completeSale, saleTotal } from "./operations";
import { refundSale } from "./refunds";
import type {
  CatalogSnapshot,
  ExchangeInput,
  ExchangeRecord,
} from "../models/catalog";
function fail(message: string): never {
  throw new Error(message);
}
function signed(v: number) {
  if (!Number.isSafeInteger(v))
    fail("實際換購差額必須是安全整數，補收填正數、退還填負數。");
  return v;
}
function normalize(input: ExchangeInput): ExchangeInput {
  if (!input || input.confirmed !== true)
    fail("請確認換購退貨及實際補收／退還均已完成。");
  if (!Array.isArray(input.refundLines) || !input.refundLines.length)
    fail("換購必須有原交易的退貨／折抵明細。");
  if (
    !input.replacement ||
    !Array.isArray(input.replacement.lines) ||
    !input.replacement.lines.length
  )
    fail("請選擇實際換出的商品。");
  const operationId = text(input.operationId, "換購操作識別", 100),
    reason = text(input.reason, "換購原因", 2000);
  signed(input.actualDifference);
  return {
    operationId,
    saleId: text(input.saleId, "原交易識別", 100),
    reason,
    refundLines: structuredClone(input.refundLines),
    replacement: {
      locationId: input.replacement.locationId,
      eventId: input.replacement.eventId,
      collectorId: input.replacement.collectorId,
      notes: input.replacement.notes.trim(),
      lines: structuredClone(input.replacement.lines),
    },
    actualDifference: input.actualDifference,
    confirmed: true,
  };
}
export function exchangeDifference(
  input: Pick<ExchangeInput, "refundLines" | "replacement">,
) {
  let refund = 0n;
  for (const l of input.refundLines) {
    if (!Number.isSafeInteger(l.amount) || l.amount < 0)
      fail("換購折抵額必須是非負安全整數。");
    refund += BigInt(l.amount);
  }
  const refundTotal = safeAmount(refund),
    replacementTotal = saleTotal(input.replacement.lines);
  const difference = Number(BigInt(replacementTotal) - BigInt(refundTotal));
  return { refundTotal, replacementTotal, difference };
}
/** Both return and replacement are one atomic domain command; actual cash is only the signed difference. */
export function completeExchange(
  s: CatalogSnapshot,
  raw: ExchangeInput,
): ExchangeRecord {
  const input = normalize(raw),
    previous = s.exchanges.find((r) => r.operationId === input.operationId);
  if (previous) {
    if (!sameData(previous.request, input))
      fail("相同操作識別已用於不同換購，請重新讀取。");
    return previous;
  }
  if (s.sales.find((r) => r.id === input.saleId)?.consignmentId)
    fail("寄賣換貨請分別回報退款及新銷售，不使用現場差額換購。");
  const totals = exchangeDifference(input);
  if (input.actualDifference !== totals.difference)
    fail(
      "已確認的實收／實退差額與換購計算不同，請先調整實際成交價格或折抵金額。",
    );
  const next = structuredClone(s),
    identity = record(next, "EXC", "換購差額");
  const refund = refundSale(
    next,
    {
      operationId: crypto.randomUUID(),
      saleId: input.saleId,
      reason: input.reason,
      lines: input.refundLines,
    },
    identity.id,
  );
  const sale = completeSale(
    next,
    {
      ...input.replacement,
      operationId: crypto.randomUUID(),
      cashReceived: Math.max(input.actualDifference, 0),
      replacesRefundId: refund.id,
    },
    { id: identity.id, credit: totals.refundTotal },
  );
  const result: ExchangeRecord = {
    ...identity,
    operationId: input.operationId,
    originalSaleId: input.saleId,
    refundId: refund.id,
    replacementSaleId: sale.id,
    ...totals,
    actualDifference: input.actualDifference,
    collectorId: sale.collectorId,
    createdAt: new Date().toISOString(),
    reason: input.reason,
    request: input,
  };
  next.exchanges.push(result);
  validateExchanges(next);
  Object.assign(s, next);
  return result;
}
/** Validate immutable linkage without inferring any cash movement from ordinary refunds. */
export function validateExchanges(s: CatalogSnapshot) {
  if (!Array.isArray(s.exchanges)) fail("缺少換購紀錄清單。");
  const ids = new Set<string>(),
    ops = new Set<string>(),
    refunds = new Set<string>(),
    sales = new Set<string>();
  for (const e of s.exchanges) {
    if (
      !e.id ||
      ids.has(e.id) ||
      e.workspaceId !== s.workspaceId ||
      !/^EXC-\d+$/.test(e.code) ||
      ops.has(e.operationId)
    )
      fail("換購識別或操作識別不正確／重複。");
    ids.add(e.id);
    ops.add(e.operationId);
    if (!Number.isFinite(Date.parse(e.createdAt))) fail("換購時間不正確。");
    const input = normalize(e.request),
      total = exchangeDifference(input);
    if (
      input.operationId !== e.operationId ||
      input.saleId !== e.originalSaleId ||
      input.reason !== e.reason ||
      !sameData(total, {
        refundTotal: e.refundTotal,
        replacementTotal: e.replacementTotal,
        difference: e.difference,
      }) ||
      signed(e.actualDifference) !== total.difference ||
      input.actualDifference !== e.actualDifference
    )
      fail("換購來源或差額與原始確認不一致。");
    const original = s.sales.find((r) => r.id === e.originalSaleId),
      refund = s.refunds.find((r) => r.id === e.refundId),
      sale = s.sales.find((r) => r.id === e.replacementSaleId);
    if (
      !original ||
      original.cancelledAt ||
      !refund ||
      !sale ||
      refunds.has(refund.id) ||
      sales.has(sale.id)
    )
      fail("換購原交易、折抵或新交易來源不正確。");
    if (
      original.id === sale.id ||
      s.sales.indexOf(original) >= s.sales.indexOf(sale)
    )
      fail("換購原交易必須先於新交易，不能循環引用。");
    refunds.add(refund.id);
    sales.add(sale.id);
    if (
      refund.exchangeId !== e.id ||
      refund.saleId !== original.id ||
      refund.total !== e.refundTotal ||
      refund.reason !== e.reason ||
      sale.exchangeId !== e.id ||
      sale.exchangeCredit !== e.refundTotal ||
      sale.replacesRefundId !== refund.id ||
      sale.total !== e.replacementTotal ||
      sale.cancelledAt ||
      sale.cashReceived !== Math.max(e.actualDifference, 0) ||
      sale.change !== Math.max(-e.actualDifference, 0) ||
      sale.collectorId !== e.collectorId
    )
      fail("換購折抵、實際收退與子交易不一致。");
    const refundLines = refund.lines.map(({ id, movementId, ...line }) => line);
    const saleLines = sale.lines.map(
      ({ id, productName, movementId, attribution, planName, ...line }) => line,
    );
    if (
      !sameData(refundLines, input.refundLines) ||
      !sameData(saleLines, input.replacement.lines) ||
      sale.locationId !== input.replacement.locationId ||
      sale.eventId !== input.replacement.eventId ||
      sale.collectorId !== input.replacement.collectorId ||
      sale.notes !== input.replacement.notes
    )
      fail("換購明細與確認紀錄不同。");
  }
  for (const sale of s.sales)
    if (
      sale.exchangeId &&
      !s.exchanges.some(
        (e) => e.id === sale.exchangeId && e.replacementSaleId === sale.id,
      )
    )
      fail("換購子交易缺少唯一來源。");
  for (const refund of s.refunds)
    if (
      refund.exchangeId &&
      !s.exchanges.some(
        (e) => e.id === refund.exchangeId && e.refundId === refund.id,
      )
    )
      fail("換購折抵缺少唯一來源。");
}
