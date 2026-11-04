import type {
  CatalogSnapshot,
  InventoryMovement,
  InventoryReservation,
} from "../models/catalog";
import { record, text } from "../catalog/operations";
function fail(message: string): never {
  throw new Error(message);
}
function physical(s: CatalogSnapshot, productId: string, locationId: string) {
  return s.movements.reduce(
    (n, m) =>
      m.productId !== productId
        ? n
        : n +
          (m.toLocationId === locationId ? m.quantity : 0) -
          (m.fromLocationId === locationId ? m.quantity : 0),
    0,
  );
}
export function reservationRemaining(
  s: CatalogSnapshot,
  r: InventoryReservation,
) {
  let n = r.quantity;
  for (const m of s.movements)
    if (m.reservationId === r.id) {
      if (m.fromLocationId === r.locationId) n -= m.quantity;
      if (m.toLocationId === r.locationId) n += m.quantity;
    }
  return n;
}
export function reservedQuantity(
  s: CatalogSnapshot,
  productId: string,
  locationId: string,
) {
  let n = 0;
  for (const r of s.inventoryReservations)
    if (
      !r.releasedAt &&
      r.productId === productId &&
      r.locationId === locationId
    )
      n += reservationRemaining(s, r);
  if (!Number.isSafeInteger(n)) fail("預留數量超出安全範圍。");
  return n;
}
export function availableQuantity(
  s: CatalogSnapshot,
  productId: string,
  locationId: string,
  planId?: string,
) {
  const own = planId
    ? s.inventoryReservations.find(
        (r) =>
          !r.releasedAt &&
          r.planId === planId &&
          r.productId === productId &&
          r.locationId === locationId,
      )
    : undefined;
  return own
    ? reservationRemaining(s, own)
    : physical(s, productId, locationId) -
        reservedQuantity(s, productId, locationId);
}
export function reserveStock(
  s: CatalogSnapshot,
  input: {
    planId: string;
    productId: string;
    locationId: string;
    quantity: number;
    reason: string;
  },
) {
  const plan = s.salePlans.find((p) => p.id === input.planId && !p.archived);
  if (!plan || !plan.productIds.includes(input.productId))
    fail("請選擇啟用方案中的商品。");
  if (
    !s.products.some((p) => p.id === input.productId && !p.archived) ||
    !s.locations.some((l) => l.id === input.locationId)
  )
    fail("商品或庫位不存在／已封存。");
  if (
    s.inventoryReservations.some(
      (r) =>
        !r.releasedAt &&
        r.planId === input.planId &&
        r.productId === input.productId &&
        r.locationId === input.locationId,
    )
  )
    fail("同方案商品庫位已有預留，請先明確釋放後再建立。");
  if (
    s.activityHandoffs.some(
      (h) =>
        h.locationId === input.locationId &&
        !s.activityMerges.some((m) => m.handoffId === h.id),
    )
  )
    fail("此庫位已交接，請在活動工作台操作。");
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0)
    fail("預留數量必須是正安全整數。");
  if (availableQuantity(s, input.productId, input.locationId) < input.quantity)
    fail("未預留的可用庫存不足。");
  const r: InventoryReservation = {
    ...record(s, "RSV", `${plan.name} 專用預留`),
    ...input,
    reason: text(input.reason, "預留原因", 2000),
    createdAt: new Date().toISOString(),
    releasedAt: "",
    releaseReason: "",
    createdMovementCount: s.movements.length,
    releasedMovementCount: null,
  };
  s.inventoryReservations.push(r);
  return r;
}
export function releaseReservation(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  const r = s.inventoryReservations.find((r) => r.id === id);
  if (!r || r.releasedAt) fail("預留不存在或已釋放。");
  r.releaseReason = text(reason, "釋放原因", 2000);
  r.releasedAt = new Date().toISOString();
  r.releasedMovementCount = s.movements.length;
  return r;
}
/** Outflows without a sale plan must use the unreserved portion. */
export function assertUnreservedOutflow(
  s: CatalogSnapshot,
  productId: string,
  locationId: string,
  quantity: number,
) {
  if (availableQuantity(s, productId, locationId) < quantity)
    fail("可用庫存不足，部分庫存已預留；請先明確釋放專用池預留。");
}
export function reservationForSale(
  s: CatalogSnapshot,
  productId: string,
  locationId: string,
  quantity: number,
  planId?: string,
) {
  const own = planId
    ? s.inventoryReservations.find(
        (r) =>
          !r.releasedAt &&
          r.planId === planId &&
          r.productId === productId &&
          r.locationId === locationId,
      )
    : undefined;
  if (availableQuantity(s, productId, locationId, planId) < quantity)
    fail(
      own
        ? "此方案的專用預留庫存不足，請減少數量或明確釋放後重設。"
        : "可用庫存不足，其他方案已預留的數量不能挪用。",
    );
  return own?.id;
}
export function activeReturnReservation(
  s: CatalogSnapshot,
  source: InventoryMovement,
  toLocationId: string,
) {
  const r = s.inventoryReservations.find(
    (r) =>
      r.id === source.reservationId &&
      !r.releasedAt &&
      r.locationId === toLocationId,
  );
  return r?.id;
}
export function validateReservations(s: CatalogSnapshot) {
  if (!Array.isArray(s.inventoryReservations)) fail("缺少庫存預留清單。");
  if (!s.inventoryReservations.length) {
    if (s.movements.some((m) => m.reservationId)) fail("異動預留來源不存在。");
    return;
  }
  const ids = new Set<string>();
  for (const r of s.inventoryReservations) {
    if (!r.id || ids.has(r.id) || r.workspaceId !== s.workspaceId)
      fail("預留識別不正確或重複。");
    ids.add(r.id);
    const plan = s.salePlans.find((p) => p.id === r.planId);
    if (
      !plan ||
      !s.products.some((p) => p.id === r.productId) ||
      !s.locations.some((l) => l.id === r.locationId)
    )
      fail("預留方案／商品／庫位關聯不正確。");
    if (
      !Number.isSafeInteger(r.quantity) ||
      r.quantity <= 0 ||
      !Number.isSafeInteger(r.createdMovementCount) ||
      r.createdMovementCount < 0 ||
      r.createdMovementCount > s.movements.length
    )
      fail("預留數量或建立位置不正確。");
    if (
      typeof r.createdAt !== "string" ||
      !Number.isFinite(Date.parse(r.createdAt)) ||
      typeof r.releasedAt !== "string" ||
      typeof r.releaseReason !== "string"
    )
      fail("預留時間或原因格式不正確。");
    text(r.reason, "預留原因", 2000);
    if (r.releasedAt) {
      if (
        !Number.isFinite(Date.parse(r.releasedAt)) ||
        !r.releaseReason.trim() ||
        !Number.isSafeInteger(r.releasedMovementCount) ||
        r.releasedMovementCount! < r.createdMovementCount ||
        r.releasedMovementCount! > s.movements.length
      )
        fail("預留釋放來源不正確。");
    } else if (
      r.releasedMovementCount !== null ||
      r.releaseReason ||
      plan.archived ||
      !plan.productIds.includes(r.productId)
    )
      fail("啟用預留不能屬於已封存或移除商品的方案。");
  }
  const stock = new Map<string, number>(),
    remaining = new Map(s.inventoryReservations.map((r) => [r.id, r.quantity]));
  const key = (p: string, l: string) => JSON.stringify([p, l]);
  const active = (r: InventoryReservation, i: number) =>
    r.createdMovementCount <= i &&
    (r.releasedMovementCount === null || r.releasedMovementCount > i);
  function check(i: number) {
    const totals = new Map<string, number>(),
      own = new Set<string>();
    for (const r of s.inventoryReservations)
      if (active(r, i)) {
        const unique = JSON.stringify([r.planId, r.productId, r.locationId]);
        if (own.has(unique)) fail("同方案商品庫位不能重複預留。");
        own.add(unique);
        const n = remaining.get(r.id)!;
        if (!Number.isSafeInteger(n) || n < 0 || n > r.quantity)
          fail("專用預留使用量不守恆。");
        const k = key(r.productId, r.locationId);
        totals.set(k, (totals.get(k) || 0) + n);
      }
    for (const [k, n] of totals)
      if (!Number.isSafeInteger(n) || n > (stock.get(k) || 0))
        fail("預留總量超過當時實物庫存。");
  }
  for (let i = 0; i <= s.movements.length; i++) {
    check(i);
    if (i === s.movements.length) break;
    const m = s.movements[i]!,
      r = m.reservationId
        ? s.inventoryReservations.find((r) => r.id === m.reservationId)
        : undefined;
    if (m.reservationId) {
      if (!r || r.productId !== m.productId || !active(r, i))
        fail("異動預留來源不存在或當時已釋放。");
      if (m.fromLocationId) {
        const sale = s.sales.find((a) => a.id === m.saleId),
          line = sale?.lines.find((l) => l.movementId === m.id);
        if (
          m.kind !== "sale" ||
          m.fromLocationId !== r.locationId ||
          line?.planId !== r.planId
        )
          fail("只有對應方案銷售可使用專用預留。");
        remaining.set(r.id, remaining.get(r.id)! - m.quantity);
      } else {
        let source: InventoryMovement | undefined;
        if (m.kind === "reversal")
          source = s.movements.find((a) => a.id === m.reversesId);
        else if (m.kind === "refund-return") {
          const refund = s.refunds.find((a) => a.id === m.refundId),
            line = refund?.lines.find((l) => l.movementId === m.id),
            sale = s.sales.find((a) => a.id === refund?.saleId);
          source = s.movements.find(
            (a) =>
              a.id ===
              sale?.lines.find((l) => l.id === line?.saleLineId)?.movementId,
          );
        }
        if (
          !source ||
          source.reservationId !== r.id ||
          m.toLocationId !== r.locationId
        )
          fail("退貨預留與原成交來源不符。");
        remaining.set(r.id, remaining.get(r.id)! + m.quantity);
      }
    } else if (m.fromLocationId) {
      let reserved = 0;
      for (const other of s.inventoryReservations)
        if (
          active(other, i) &&
          other.productId === m.productId &&
          other.locationId === m.fromLocationId
        )
          reserved += remaining.get(other.id)!;
      if (
        (stock.get(key(m.productId, m.fromLocationId)) || 0) - reserved <
        m.quantity
      )
        fail("異動挪用了其他方案的專用預留。");
      if (m.kind === "sale") {
        const line = s.sales
          .find((a) => a.id === m.saleId)
          ?.lines.find((l) => l.movementId === m.id);
        if (
          line?.planId &&
          s.inventoryReservations.some(
            (other) =>
              active(other, i) &&
              other.planId === line.planId &&
              other.productId === m.productId &&
              other.locationId === m.fromLocationId,
          )
        )
          fail("專用方案銷售缺少預留使用紀錄。");
      }
    }
    if (m.fromLocationId) {
      const k = key(m.productId, m.fromLocationId);
      stock.set(k, (stock.get(k) || 0) - m.quantity);
    }
    if (m.toLocationId) {
      const k = key(m.productId, m.toLocationId);
      stock.set(k, (stock.get(k) || 0) + m.quantity);
    }
    check(i);
  }
}
