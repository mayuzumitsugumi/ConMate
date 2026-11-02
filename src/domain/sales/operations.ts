import { whole, safeAmount } from "../money";
import { record, text } from "../catalog/operations";
import { addMovement, reverseMovement } from "../inventory/operations";
import type { CatalogSnapshot, SaleInput, SaleRecord } from "../models/catalog";

export function saleTotal(lines: SaleInput["lines"]): number {
  return safeAmount(
    lines.reduce(
      (sum, line) =>
        sum +
        BigInt(whole(line.quantity, "數量", true)) *
          BigInt(whole(line.unitPrice, "單價")),
      0n,
    ),
  );
}
export function completeSale(s: CatalogSnapshot, input: SaleInput) {
  const operationId = text(input.operationId, "操作識別", 100);
  // Retrying the same command must not create a second sale or deduct stock twice.
  const prior = s.sales.find((sale) => sale.operationId === operationId);
  if (prior) {
    if (prior.cancelledAt)
      throw new Error("此操作的原交易已取消，請清空購物車後建立新交易。");
    const same =
      prior.locationId === input.locationId &&
      prior.eventId === input.eventId &&
      prior.collectorId === input.collectorId &&
      prior.cashReceived === input.cashReceived &&
      prior.notes === input.notes.trim() &&
      prior.lines.length === input.lines.length &&
      prior.lines.every((l, i) => {
        const next = input.lines[i];
        return (
          next &&
          l.productId === next.productId &&
          l.mode === next.mode &&
          l.quantity === next.quantity &&
          l.unitPrice === next.unitPrice &&
          l.planId === next.planId &&
          l.planVersion === next.planVersion
        );
      });
    if (!same)
      throw new Error("相同操作識別已用於不同交易，請重新載入後檢查。");
    return prior;
  }
  if (!input.lines.length || input.lines.length > 100)
    throw new Error("每筆交易需有1至100項商品。");
  const location = s.locations.find((l) => l.id === input.locationId);
  if (!location) throw new Error("請選擇出貨庫位。");
  if (
    input.eventId &&
    !s.events.some((e) => e.id === input.eventId && !e.archived)
  )
    throw new Error("請選擇啟用的場次。");
  if (input.collectorId && !s.parties.some((p) => p.id === input.collectorId))
    throw new Error("收款者不存在。");
  const total = saleTotal(input.lines);
  const cashReceived = whole(input.cashReceived, "收到金額");
  if (cashReceived < total) throw new Error("收到金額不足，尚未成交。");
  const notes = input.notes.trim();
  if (notes.length > 2000) throw new Error("備註最多2000字。");
  const sale: SaleRecord = {
    ...record(s, "SAL", "攤位交易"),
    operationId,
    locationId: location.id,
    eventId: input.eventId,
    collectorId: input.collectorId,
    notes,
    total,
    cashReceived,
    change: cashReceived - total,
    createdAt: new Date().toISOString(),
    cancelledAt: "",
    cancelReason: "",
    lines: [],
    reversalIds: [],
  };
  for (const line of input.lines) {
    const p = s.products.find((p) => p.id === line.productId && !p.archived);
    if (!p) throw new Error("請選擇未封存的商品。");
    if (!["direct", "draw"].includes(line.mode))
      throw new Error("販售方式不正確。");
    const plan = line.planId
      ? s.salePlans.find((p) => p.id === line.planId)
      : undefined;
    if (line.planId !== undefined || line.planVersion !== undefined) {
      if (!plan || plan.archived || plan.version !== line.planVersion)
        throw new Error("販售方案已更新或停用，請重新選擇方案。");
      if (
        plan.mode !== line.mode ||
        plan.unitPrice !== line.unitPrice ||
        !plan.productIds.includes(p.id) ||
        (plan.eventIds.length && !plan.eventIds.includes(input.eventId))
      )
        throw new Error("商品、價格或場次與販售方案不符。");
    }
    const movement = addMovement(s, {
      productId: p.id,
      kind: "adjust-out",
      quantity: line.quantity,
      fromLocationId: location.id,
      toLocationId: "",
      reason: `${sale.code} ${line.mode === "draw" ? "抽選實際交付" : "指定購買"}`,
    });
    movement.kind = "sale";
    movement.name = "販售出庫";
    movement.saleId = sale.id;
    sale.lines.push({
      id: crypto.randomUUID(),
      productId: p.id,
      productName: p.name,
      ...(plan
        ? { planId: plan.id, planVersion: plan.version, planName: plan.name }
        : {}),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      mode: line.mode,
      movementId: movement.id,
    });
  }
  s.sales.push(sale);
  return sale;
}
export function cancelSale(s: CatalogSnapshot, id: string, reason: string) {
  const sale = s.sales.find((r) => r.id === id);
  if (!sale || sale.cancelledAt) throw new Error("交易不存在，或已經取消。");
  reason = text(reason, "取消原因", 2000);
  const reversals = sale.lines.map(
    (l) =>
      reverseMovement(
        s,
        l.movementId,
        `${sale.code} 全額退款並回庫：${reason}`,
        sale.id,
      ).id,
  );
  sale.cancelledAt = new Date().toISOString();
  sale.cancelReason = reason;
  sale.reversalIds = reversals;
}
