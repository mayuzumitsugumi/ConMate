import type { CatalogSnapshot, InventoryMovement } from "../models/catalog";
export interface BatchAllocation {
  batchId: string;
  quantity: number;
}
export const legacyBatchId = (productId: string) => `legacy:${productId}`;
/** Migration retains unknown provenance. It never invents historical manufacturing batches. */
export function upgradeBatches(data: any) {
  data.movements = data.movements.map((m: any) => ({
    ...m,
    batchAllocations: [
      { batchId: legacyBatchId(m.productId), quantity: m.quantity },
    ],
  }));
  data.batchTrackingStart = data.movements.length;
  data.schemaVersion = 13;
  return data;
}
export function batchBalances(s: Pick<CatalogSnapshot, "movements">) {
  const quantities = new Map<string, number>();
  const lots = new Map<
    string,
    {
      id: string;
      productId: string;
      name: string;
      sourceMovementId: string;
      sourceCode: string;
      order: number;
    }
  >();
  const key = (id: string, location: string) => JSON.stringify([id, location]);
  for (const [order, m] of s.movements.entries()) {
    for (const a of m.batchAllocations || []) {
      if (!lots.has(a.batchId))
        lots.set(a.batchId, {
          id: a.batchId,
          productId: m.productId,
          name: a.batchId.startsWith("legacy:")
            ? "舊資料／來源批次未指定"
            : m.batchName || `${m.code} 入庫批次`,
          sourceMovementId: a.batchId.startsWith("legacy:") ? "" : m.id,
          sourceCode: a.batchId.startsWith("legacy:") ? "" : m.code,
          order,
        });
      for (const [location, sign] of [
        [m.fromLocationId, -1],
        [m.toLocationId, 1],
      ] as const)
        if (location) {
          const k = key(a.batchId, location),
            n = (quantities.get(k) || 0) + sign * a.quantity;
          if (!Number.isSafeInteger(n) || n < 0)
            throw new Error("批次庫存不足或超出安全範圍。");
          quantities.set(k, n);
        }
    }
  }
  return {
    lots,
    quantity: (batchId: string, locationId: string) =>
      quantities.get(key(batchId, locationId)) || 0,
  };
}
export function allocateMovement(s: CatalogSnapshot, m: InventoryMovement) {
  const state = batchBalances(s);
  let allocations: BatchAllocation[];
  if (m.reversesId) {
    const old = s.movements.find((r) => r.id === m.reversesId);
    if (!old?.batchAllocations) throw new Error("沖銷來源缺少批次紀錄。");
    allocations = old.batchAllocations.map((a) => ({ ...a }));
  } else if (m.fromLocationId) {
    let remaining = m.quantity;
    allocations = [];
    for (const lot of state.lots.values())
      if (lot.productId === m.productId) {
        const amount = Math.min(
          remaining,
          state.quantity(lot.id, m.fromLocationId),
        );
        if (amount) allocations.push({ batchId: lot.id, quantity: amount });
        remaining -= amount;
        if (!remaining) break;
      }
    if (remaining) throw new Error("批次庫存不足。");
  } else allocations = [{ batchId: m.id, quantity: m.quantity }];
  for (const a of allocations)
    if (
      m.fromLocationId &&
      state.quantity(a.batchId, m.fromLocationId) < a.quantity
    )
      throw new Error("原批次已移走或售出，不能沖銷；請先處理後續異動。");
  m.batchAllocations = allocations;
}
export function allocateReturn(
  s: CatalogSnapshot,
  m: InventoryMovement,
  sourceId: string,
  skip: number,
) {
  const original = s.movements.find((r) => r.id === sourceId);
  if (!original?.batchAllocations) throw new Error("原銷售缺少批次來源。");
  let remaining = m.quantity;
  m.batchAllocations = [];
  for (const a of original.batchAllocations) {
    const ignored = Math.min(skip, a.quantity);
    skip -= ignored;
    const q = Math.min(remaining, a.quantity - ignored);
    if (q) m.batchAllocations.push({ batchId: a.batchId, quantity: q });
    remaining -= q;
    if (!remaining) break;
  }
  if (remaining) throw new Error("退貨批次超過原出庫數量。");
}
export function validateBatchLedger(s: CatalogSnapshot) {
  if (
    !Number.isSafeInteger(s.batchTrackingStart) ||
    s.batchTrackingStart < 0 ||
    s.batchTrackingStart > s.movements.length
  )
    throw new Error("批次追蹤起點不正確。");
  const seen = new Map<string, InventoryMovement>();
  const amounts = new Map<string, number>();
  const lotProducts = new Map<string, string>();
  const k = (lot: string, loc: string) => JSON.stringify([lot, loc]);
  for (const [index, m] of s.movements.entries()) {
    if (!Array.isArray(m.batchAllocations) || !m.batchAllocations.length)
      throw new Error("異動缺少批次分配。");
    let sum = 0;
    const ids = new Set<string>();
    for (const a of m.batchAllocations) {
      if (
        typeof a.batchId !== "string" ||
        ids.has(a.batchId) ||
        !Number.isSafeInteger(a.quantity) ||
        a.quantity <= 0
      )
        throw new Error("批次分配不正確。");
      ids.add(a.batchId);
      sum += a.quantity;
      const source = seen.get(a.batchId);
      if (
        a.batchId !== legacyBatchId(m.productId) &&
        a.batchId !== m.id &&
        (!source ||
          source.productId !== m.productId ||
          source.fromLocationId ||
          source.kind === "refund-return" ||
          source.kind === "reversal")
      )
        throw new Error("批次來源不正確。");
      if (
        a.batchId === m.id &&
        (m.fromLocationId ||
          m.kind === "refund-return" ||
          m.kind === "reversal")
      )
        throw new Error("批次來源方向不正確。");
    }
    if (
      index < s.batchTrackingStart &&
      (m.batchAllocations.length !== 1 ||
        m.batchAllocations[0]!.batchId !== legacyBatchId(m.productId))
    )
      throw new Error("舊資料批次來源不可推定。");
    if (
      index >= s.batchTrackingStart &&
      !m.fromLocationId &&
      !m.reversesId &&
      m.kind !== "refund-return" &&
      (m.batchAllocations.length !== 1 ||
        m.batchAllocations[0]!.batchId !== m.id)
    )
      throw new Error("新入庫必須建立獨立批次。");
    if (sum !== m.quantity || !Number.isSafeInteger(sum))
      throw new Error("批次分配合計與異動不符。");
    if (
      m.batchName !== undefined &&
      (typeof m.batchName !== "string" ||
        m.batchName.length > 120 ||
        m.fromLocationId ||
        m.kind === "refund-return" ||
        m.kind === "reversal")
    )
      throw new Error("批次名稱不正確。");
    if (
      m.reversesId &&
      JSON.stringify(m.batchAllocations) !==
        JSON.stringify(seen.get(m.reversesId)?.batchAllocations)
    )
      throw new Error("沖銷批次與原異動不符。");
    if (index >= s.batchTrackingStart && m.fromLocationId && !m.reversesId) {
      let remaining = m.quantity;
      const expected: BatchAllocation[] = [];
      for (const [id, productId] of lotProducts)
        if (productId === m.productId) {
          const q = Math.min(
            remaining,
            amounts.get(k(id, m.fromLocationId)) || 0,
          );
          if (q) expected.push({ batchId: id, quantity: q });
          remaining -= q;
          if (!remaining) break;
        }
      if (JSON.stringify(expected) !== JSON.stringify(m.batchAllocations))
        throw new Error("出庫批次不符合FIFO來源。");
    }
    if (index >= s.batchTrackingStart && m.kind === "refund-return") {
      const refund = s.refunds.find((r) => r.id === m.refundId),
        line = refund?.lines.find((l) => l.movementId === m.id);
      const original = s.sales
        .find((r) => r.id === m.saleId)
        ?.lines.find((l) => l.id === line?.saleLineId);
      if (!refund || !line || !original)
        throw new Error("退貨批次來源不正確。");
      let skip = 0;
      for (const r of s.refunds) {
        if (r.id === refund.id) break;
        for (const l of r.lines)
          if (l.saleLineId === original.id)
            skip += l.restockQuantity + l.damagedQuantity;
      }
      const expected = { ...m, batchAllocations: [] };
      allocateReturn(s, expected, original.movementId, skip);
      if (
        JSON.stringify(expected.batchAllocations) !==
        JSON.stringify(m.batchAllocations)
      )
        throw new Error("退貨批次與原銷售不符。");
    }
    for (const a of m.batchAllocations) {
      lotProducts.set(a.batchId, m.productId);
      for (const [loc, sign] of [
        [m.fromLocationId, -1],
        [m.toLocationId, 1],
      ] as const)
        if (loc) {
          const key = k(a.batchId, loc),
            n = (amounts.get(key) || 0) + sign * a.quantity;
          if (!Number.isSafeInteger(n) || n < 0)
            throw new Error("批次庫存不足。");
          amounts.set(key, n);
        }
    }
    seen.set(m.id, m);
  }
}
