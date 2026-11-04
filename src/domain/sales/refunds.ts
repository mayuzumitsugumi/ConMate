import { activeReturnReservation } from "../inventory/reservations";
import { allocateReturn } from "../inventory/batches";
import { record, text } from "../catalog/operations";
import { whole, safeAmount } from "../money";
import { balance } from "../inventory/operations";
import type {
  CatalogSnapshot,
  RefundInput,
  RefundRecord,
  SaleRecord,
} from "../models/catalog";
export function saleRefundedTotal(s: CatalogSnapshot, saleId: string) {
  return safeAmount(
    s.refunds
      .filter((r) => r.saleId === saleId)
      .reduce((sum, r) => sum + BigInt(r.total), 0n),
  );
}
export function saleNetRevenue(s: CatalogSnapshot, sale: SaleRecord) {
  return sale.cancelledAt ? 0 : sale.total - saleRefundedTotal(s, sale.id);
}
export function lineReturnSummary(s: CatalogSnapshot, saleLineId: string) {
  let amount = 0n,
    restockQuantity = 0n,
    damagedQuantity = 0n;
  for (const refund of s.refunds)
    for (const line of refund.lines)
      if (line.saleLineId === saleLineId) {
        amount += BigInt(line.amount);
        restockQuantity += BigInt(line.restockQuantity);
        damagedQuantity += BigInt(line.damagedQuantity);
      }
  return {
    amount: safeAmount(amount),
    restockQuantity: safeAmount(restockQuantity),
    damagedQuantity: safeAmount(damagedQuantity),
  };
}
export function refundSale(s: CatalogSnapshot, input: RefundInput) {
  const operationId = text(input.operationId, "退款操作識別", 100),
    reason = text(input.reason, "退款／退貨原因", 2000);
  const existing = s.refunds.find((r) => r.operationId === operationId);
  if (existing) {
    const same =
      existing.saleId === input.saleId &&
      existing.reason === reason &&
      existing.lines.length === input.lines.length &&
      existing.lines.every((l, i) => {
        const n = input.lines[i];
        return (
          n &&
          l.saleLineId === n.saleLineId &&
          l.amount === n.amount &&
          l.restockQuantity === n.restockQuantity &&
          l.damagedQuantity === n.damagedQuantity &&
          l.returnLocationId === n.returnLocationId
        );
      });
    if (!same) throw new Error("相同操作識別已用於不同退款，請重新讀取。");
    return existing;
  }
  const sale = s.sales.find((r) => r.id === input.saleId);
  if (!sale || sale.cancelledAt) throw new Error("原交易不存在或已取消。");
  if (!input.lines.length || input.lines.length > 100)
    throw new Error("退款／退貨需有1至100項明細。");
  const seen = new Set<string>();
  let total = 0n;
  const projected = new Map<string, number>();
  // Validate every line before writing. Storage transaction remains final safety boundary.
  for (const line of input.lines) {
    if (seen.has(line.saleLineId))
      throw new Error("同一退款不能重複加入原交易明細。");
    seen.add(line.saleLineId);
    const original = sale.lines.find((l) => l.id === line.saleLineId);
    if (!original) throw new Error("退款明細不屬於原交易。");
    whole(line.amount, "實際退款金額");
    whole(line.restockQuantity, "可售回庫數量");
    whole(line.damagedQuantity, "損壞退回數量");
    if (!line.amount && !line.restockQuantity && !line.damagedQuantity)
      throw new Error("明細至少需有退款或退回商品。");
    const prior = lineReturnSummary(s, line.saleLineId);
    if (
      BigInt(prior.amount) + BigInt(line.amount) >
      BigInt(original.quantity) * BigInt(original.unitPrice)
    )
      throw new Error("累計退款超過原明細成交金額。");
    if (
      BigInt(prior.restockQuantity) +
        BigInt(prior.damagedQuantity) +
        BigInt(line.restockQuantity) +
        BigInt(line.damagedQuantity) >
      BigInt(original.quantity)
    )
      throw new Error("累計退回數量超過原成交數量。");
    if (line.restockQuantity) {
      if (!s.locations.some((l) => l.id === line.returnLocationId))
        throw new Error("請選擇可售退貨的回庫庫位。");
      const key = JSON.stringify([original.productId, line.returnLocationId]);
      const next =
        (projected.get(key) ??
          balance(s, original.productId, line.returnLocationId)) +
        line.restockQuantity;
      if (!Number.isSafeInteger(next))
        throw new Error("回庫數量超過安全範圍。");
      projected.set(key, next);
    } else if (line.returnLocationId)
      throw new Error("沒有可售回庫數量時請勿指定庫位。");
    total += BigInt(line.amount);
  }
  const refund: RefundRecord = {
    ...record(s, "REF", "退款／退貨"),
    operationId,
    saleId: sale.id,
    reason,
    createdAt: new Date().toISOString(),
    total: safeAmount(total),
    lines: [],
  };
  for (const inputLine of input.lines) {
    const original = sale.lines.find((l) => l.id === inputLine.saleLineId)!;
    let movementId = "";
    if (inputLine.restockQuantity) {
      const movement = {
        batchAllocations: [] as { batchId: string; quantity: number }[],
        ...record(s, "MOV", "退款商品回庫"),
        kind: "refund-return" as const,
        productId: original.productId,
        saleId: sale.id,
        refundId: refund.id,
        quantity: inputLine.restockQuantity,
        fromLocationId: "",
        toLocationId: inputLine.returnLocationId,
        reason: `${refund.code} ${reason}`,
        createdAt: refund.createdAt,
        reversesId: "",
      };
      const sourceMovement = s.movements.find(
        (m) => m.id === original.movementId,
      )!;
      const reservationId = activeReturnReservation(
        s,
        sourceMovement,
        inputLine.returnLocationId,
      );
      if (reservationId) Object.assign(movement, { reservationId });
      const prior = lineReturnSummary(s, original.id);
      allocateReturn(
        s,
        movement,
        original.movementId,
        prior.restockQuantity + prior.damagedQuantity,
      );
      s.movements.push(movement);
      movementId = movement.id;
    }
    refund.lines.push({ ...inputLine, id: crypto.randomUUID(), movementId });
  }
  s.refunds.push(refund);
  return refund;
}
