import { saleRefundedTotal } from "../sales/refunds";
import { record, text } from "../catalog/operations";
import { addMovement, balance } from "./operations";
import { whole } from "../money";
import type {
  CatalogSnapshot,
  StocktakeRecord,
  StocktakeCountInput,
} from "../models/catalog";
export function stocktakeStale(s: CatalogSnapshot, take: StocktakeRecord) {
  return s.movements
    .slice(take.cutoffMovementCount, take.completionMovementCount ?? undefined)
    .some(
      (m) =>
        m.fromLocationId === take.locationId ||
        m.toLocationId === take.locationId,
    );
}
export function beginStocktake(
  s: CatalogSnapshot,
  locationId: string,
  eventId: string,
  name: string,
  notes: string,
) {
  const location = s.locations.find((l) => l.id === locationId);
  if (!location) throw new Error("請選擇盤點庫位。");
  if (eventId && !s.events.some((e) => e.id === eventId))
    throw new Error("場次不存在。");
  const take: StocktakeRecord = {
    ...record(s, "STK", text(name, "盤點名稱", 80)),
    locationId,
    eventId,
    notes: notes.trim(),
    createdAt: new Date().toISOString(),
    completedAt: "",
    cutoffMovementCount: s.movements.length,
    staleAtCompletion: false,
    completionMovementCount: null,
    lines: s.products.map((p) => ({
      productId: p.id,
      productName: p.name,
      expected: balance(s, p.id, locationId),
      actual: null,
      action: "pending",
      reason: "",
      adjustmentMovementId: "",
    })),
  };
  if (take.notes.length > 2000) throw new Error("備註最多2000字。");
  s.stocktakes.push(take);
  return take;
}
export function saveStocktakeCounts(
  s: CatalogSnapshot,
  id: string,
  inputs: StocktakeCountInput[],
) {
  const take = s.stocktakes.find((t) => t.id === id);
  if (!take || take.completedAt) throw new Error("找不到可編輯的盤點單。");
  if (
    inputs.length !== take.lines.length ||
    new Set(inputs.map((i) => i.productId)).size !== inputs.length
  )
    throw new Error("盤點明細不完整或重複。");
  const next = take.lines.map((line) => {
    const input = inputs.find((i) => i.productId === line.productId);
    if (!input || !["pending", "adjust"].includes(input.action))
      throw new Error("盤點商品或處理方式不正確。");
    const actual =
      input.actual === null ? null : whole(input.actual, "實點數量");
    const reason = input.reason.trim();
    if (reason.length > 2000) throw new Error("差異原因最多2000字。");
    if (
      input.action === "adjust" &&
      (actual === null || (actual !== line.expected && !reason))
    )
      throw new Error("套用調整需填實點數量及差異原因。");
    return { ...line, actual, action: input.action, reason };
  });
  take.lines = next;
}
export function finishStocktake(s: CatalogSnapshot, id: string) {
  const take = s.stocktakes.find((t) => t.id === id);
  if (!take || take.completedAt) throw new Error("盤點單不存在或已完成。");
  const stale = stocktakeStale(s, take);
  const changes = take.lines.filter(
    (l) =>
      l.action === "adjust" && l.actual !== null && l.actual !== l.expected,
  );
  if (stale && changes.length)
    throw new Error(
      "開始盤點後此庫位已有異動，不能套用舊差額。請新建盤點單；原單可保留待查後完成。",
    );
  const completionMovementCount = s.movements.length;
  for (const line of changes) {
    const delta = line.actual! - line.expected;
    const p = s.products.find((p) => p.id === line.productId);
    if (!p || p.archived)
      throw new Error("需調整的商品已封存，請先恢復商品或保留待查。");
    const movement = addMovement(s, {
      productId: line.productId,
      kind: delta > 0 ? "adjust-in" : "adjust-out",
      quantity: Math.abs(delta),
      fromLocationId: delta < 0 ? take.locationId : "",
      toLocationId: delta > 0 ? take.locationId : "",
      reason: `${take.code} 盤點差異：${line.reason}`,
    });
    line.adjustmentMovementId = movement.id;
  }
  take.completionMovementCount = completionMovementCount;
  take.staleAtCompletion = stale;
  take.completedAt = new Date().toISOString();
  return take;
}
export function eventSummary(s: CatalogSnapshot, eventId: string) {
  const sales = s.sales.filter((sale) => sale.eventId === eventId);
  const gross = sales.reduce((a, sale) => a + BigInt(sale.total), 0n);
  const refunds = sales.reduce(
    (a, sale) =>
      a + BigInt(sale.cancelledAt ? sale.total : saleRefundedTotal(s, sale.id)),
    0n,
  );
  return {
    count: sales.length,
    activeCount: sales.filter((sale) => !sale.cancelledAt).length,
    gross: gross.toString(),
    refunds: refunds.toString(),
    net: (gross - refunds).toString(),
  };
}
