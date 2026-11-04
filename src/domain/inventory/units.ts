import type {
  CatalogSnapshot,
  InventoryMovement,
  PhysicalUnit,
} from "../models/catalog";
import { record, text } from "../catalog/operations";
export type UnitState = PhysicalUnit & {
  unitId: string;
  locationId: string;
  state: "available" | "sold" | "free" | "damage" | "removed";
};
function fail(m: string): never {
  throw new Error(m);
}
export function unitBatchQuantity(
  s: CatalogSnapshot,
  batchId: string,
  locationId: string,
  limit = s.movements.length,
) {
  let n = 0;
  for (const m of s.movements.slice(0, limit))
    for (const a of m.batchAllocations)
      if (a.batchId === batchId)
        n +=
          (m.toLocationId === locationId ? a.quantity : 0) -
          (m.fromLocationId === locationId ? a.quantity : 0);
  return n;
}
/** Registration identifies existing stock. It is never an additional receipt. */
export function registerPhysicalUnits(
  s: CatalogSnapshot,
  input: {
    productId: string;
    locationId: string;
    batchId: string;
    labels: string[];
  },
) {
  if (
    !s.products.some((p) => p.id === input.productId && !p.archived) ||
    !s.locations.some((l) => l.id === input.locationId)
  )
    fail("請選擇啟用商品及實物所在庫位。");
  if (
    s.activityHandoffs.some(
      (h) =>
        h.locationId === input.locationId &&
        !s.activityMerges.some((m) => m.handoffId === h.id),
    )
  )
    fail("已交付活動庫位不能由創作管理新增單件標記。");
  if (
    !Array.isArray(input.labels) ||
    !input.labels.length ||
    input.labels.length > 1000
  )
    fail("每次請登記1至1000件實物標記。");
  const labels = input.labels.map((v) => text(v, "實物辨識標記", 120));
  if (
    new Set(labels).size !== labels.length ||
    labels.some((v) => s.physicalUnits.some((u) => u.label === v))
  )
    fail("實物標記不可重複，請使用可辨識的不同標記。");
  const lot = s.movements.find((m) => m.id === input.batchId);
  if (
    !(lot?.productId === input.productId && !lot.fromLocationId && lot.kind !== "refund-return" && lot.kind !== "reversal") ||
    input.batchId.startsWith("legacy:")
  )
    fail("請選擇有明確入庫來源的批次；未知舊來源不能推定實物身份。");
  if (
    unitBatchQuantity(s, input.batchId, input.locationId) -
      unitStates(s).filter(
        (u) =>
          u.batchId === input.batchId &&
          u.locationId === input.locationId &&
          u.state === "available",
      ).length <
    labels.length
  )
    fail("此批次未標記的可用實物數量不足。");
  const result = labels.map((label) => ({
    ...record(s, "UNT", label),
    label,
    productId: input.productId,
    batchId: input.batchId,
    registeredLocationId: input.locationId,
    registeredMovementCount: s.movements.length,
    createdAt: new Date().toISOString(),
  }));
  s.physicalUnits.push(...result);
  return result;
}
export function unitStates(
  s: CatalogSnapshot,
  limit = s.movements.length,
): UnitState[] {
  const map = new Map<string, UnitState>();
  for (let i = 0; i <= limit; i++) {
    for (const u of s.physicalUnits || [])
      if (u.registeredMovementCount === i)
        map.set(u.id, {
          ...u,
          unitId: u.id,
          locationId: u.registeredLocationId,
          state: "available",
        });
    if (i === limit) break;
    const m = s.movements[i]!;
    for (const id of m.unitIds || []) {
      const u = map.get(id);
      if (!u) fail("異動使用了尚未登記的實物。");
      if (
        m.fromLocationId &&
        (u.locationId !== m.fromLocationId || u.state !== "available")
      )
        fail("指定實物不在來源庫位或已不在可售庫存。");
      if (m.toLocationId) {
        u.locationId = m.toLocationId;
        u.state = "available";
      } else {
        u.locationId = "";
        u.state = m.saleId
          ? "sold"
          : m.kind === "free"
            ? "free"
            : m.kind === "damage"
              ? "damage"
              : "removed";
      }
    }
  }
  if (limit === s.movements.length)
    for (const r of s.refunds)
      for (const line of r.lines)
        for (const id of line.damagedUnitIds || []) {
          const u = map.get(id);
          if (u && u.state === "sold") u.state = "damage";
        }
  return [...map.values()];
}
export function unitAllocations(s: CatalogSnapshot, ids: string[]) {
  const map = new Map<string, number>();
  for (const id of ids) {
    const unit = s.physicalUnits.find((u) => u.id === id);
    if (!unit) fail("指定實物不存在。");
    map.set(unit.batchId, (map.get(unit.batchId) || 0) + 1);
  }
  return [...map].map(([batchId, quantity]) => ({ batchId, quantity }));
}
export function assertUnitSelection(s: CatalogSnapshot, m: InventoryMovement) {
  const ids = m.unitIds || [];
  if (!ids.length) return;
  if (ids.length !== m.quantity || new Set(ids).size !== ids.length)
    fail("指定實物數量必須與異動數量一致，且不能重複。");
  if (!m.fromLocationId && !m.reversesId && m.kind !== "refund-return")
    fail("單件標記不能增加庫存。");
  const state = unitStates(s);
  for (const id of ids) {
    const u = state.find((u) => u.id === id);
    if (!u || u.productId !== m.productId) fail("指定實物與商品不符。");
    if (
      m.fromLocationId &&
      (u.state !== "available" || u.locationId !== m.fromLocationId)
    )
      fail("指定實物不在來源庫位或已售出。");
  }
}
export function validatePhysicalUnits(s: CatalogSnapshot) {
  if (!Array.isArray(s.physicalUnits)) fail("缺少單件實物資料。");
  if (!s.physicalUnits.length) {
    if (
      s.movements.some((m) => m.unitIds?.length) ||
      s.sales.some((a) => a.lines.some((l) => l.unitIds?.length)) ||
      s.refunds.some((a) =>
        a.lines.some(
          (l) => l.restockUnitIds?.length || l.damagedUnitIds?.length,
        ),
      )
    )
      fail("單件識別缺少登記來源。");
    return;
  }
  const ids = new Set<string>(),
    labels = new Set<string>();
  for (const u of s.physicalUnits) {
    if (
      !u.id ||
      ids.has(u.id) ||
      u.workspaceId !== s.workspaceId ||
      !/^UNT-\d+$/.test(u.code) ||
      labels.has(u.label)
    )
      fail("單件實物識別或標記重複／不正確。");
    ids.add(u.id);
    labels.add(u.label);
    text(u.label, "實物標記", 120);
    if (
      u.name !== u.label ||
      !Number.isSafeInteger(u.registeredMovementCount) ||
      u.registeredMovementCount < 0 ||
      u.registeredMovementCount > s.movements.length ||
      !Number.isFinite(Date.parse(u.createdAt))
    )
      fail("單件登記資料不正確。");
    const source = s.movements
      .slice(0, u.registeredMovementCount)
      .find(
        (m) =>
          m.id === u.batchId &&
          !m.fromLocationId &&
          m.kind !== "refund-return" &&
          m.kind !== "reversal" &&
          m.productId === u.productId,
      );
    if (!source || !s.locations.some((l) => l.id === u.registeredLocationId))
      fail("單件實物缺少已知入庫來源或庫位。");
  }
  const states = new Map<string, UnitState>(),
    quantities = new Map<string, number>();
  const key = (batch: string, loc: string) => JSON.stringify([batch, loc]);
  const registrations = new Map<number, PhysicalUnit[]>();
  for (const u of s.physicalUnits) {
    const rows = registrations.get(u.registeredMovementCount) || [];
    rows.push(u);
    registrations.set(u.registeredMovementCount, rows);
  }
  const seenMovements = new Map<string, InventoryMovement>();
  for (let index = 0; index <= s.movements.length; index++) {
    for (const u of registrations.get(index) || []) {
      states.set(u.id, {
        ...u,
        unitId: u.id,
        locationId: u.registeredLocationId,
        state: "available",
      });
      const count = [...states.values()].filter(
        (a) =>
          a.batchId === u.batchId &&
          a.locationId === u.registeredLocationId &&
          a.state === "available",
      ).length;
      if (count > (quantities.get(key(u.batchId, u.registeredLocationId)) || 0))
        fail("單件實物標記超過該批次實際庫存。");
    }
    if (index === s.movements.length) break;
    const m = s.movements[index]!,
      selected = m.unitIds || [];
    if (
      !Array.isArray(selected) ||
      selected.some((id) => typeof id !== "string") ||
      new Set(selected).size !== selected.length ||
      (selected.length && selected.length !== m.quantity)
    )
      fail("異動單件數量或識別不正確。");
    if (selected.length) {
      if (!m.fromLocationId && !m.reversesId && m.kind !== "refund-return")
        fail("單件異動不可增加實物。");
      for (const id of selected) {
        const u = states.get(id);
        if (!u || u.productId !== m.productId)
          fail("異動使用了不符的單件實物。");
        if (
          m.fromLocationId &&
          (u.locationId !== m.fromLocationId || u.state !== "available")
        )
          fail("單件來源不符或重複出貨。");
        if (!m.fromLocationId && u.state === "available")
          fail("單件退回時已在庫存中。");
      }
      if (
        JSON.stringify(unitAllocations(s, selected)) !==
        JSON.stringify(m.batchAllocations)
      )
        fail("指定實物批次與異動不符。");
    } else if (m.fromLocationId) {
      for (const a of m.batchAllocations) {
        const tracked = [...states.values()].filter(
          (u) =>
            u.state === "available" &&
            u.locationId === m.fromLocationId &&
            u.batchId === a.batchId,
        ).length;
        if (
          (quantities.get(key(a.batchId, m.fromLocationId)) || 0) - tracked <
          a.quantity
        )
          fail("已標記實物必須明確選擇，不能以一般數量扣除。");
      }
    }
    if (
      m.reversesId &&
      JSON.stringify(selected) !==
        JSON.stringify(seenMovements.get(m.reversesId)?.unitIds || [])
    )
      fail("沖銷必須保留原單件實物。");
    for (const a of m.batchAllocations)
      for (const [loc, sign] of [
        [m.fromLocationId, -1],
        [m.toLocationId, 1],
      ] as const)
        if (loc) {
          const k = key(a.batchId, loc);
          quantities.set(k, (quantities.get(k) || 0) + sign * a.quantity);
        }
    for (const id of selected) {
      const u = states.get(id)!;
      u.locationId = m.toLocationId;
      u.state = m.toLocationId
        ? "available"
        : m.saleId
          ? "sold"
          : m.kind === "free"
            ? "free"
            : m.kind === "damage"
              ? "damage"
              : "removed";
    }
    seenMovements.set(m.id, m);
  }
  for (const sale of s.sales)
    for (const line of sale.lines) {
      const m = s.movements.find((m) => m.id === line.movementId);
      if (
        JSON.stringify(line.unitIds || []) !== JSON.stringify(m?.unitIds || [])
      )
        fail("交易實物與出庫不一致。");
      const returned = new Set<string>();
      for (const refund of s.refunds)
        for (const r of refund.lines)
          if (r.saleLineId === line.id) {
            const back = r.restockUnitIds || [],
              damaged = r.damagedUnitIds || [],
              tracked = !!line.unitIds?.length;
            if (
              (tracked &&
                (back.length !== r.restockQuantity ||
                  damaged.length !== r.damagedQuantity)) ||
              (!tracked && (back.length || damaged.length))
            )
              fail("退貨必須指定原成交實物。");
            for (const id of [...back, ...damaged]) {
              if (!line.unitIds?.includes(id) || returned.has(id))
                fail("退貨實物不屬於原成交或已退回。");
              returned.add(id);
            }
            if (
              r.movementId &&
              JSON.stringify(back) !==
                JSON.stringify(
                  s.movements.find((m) => m.id === r.movementId)?.unitIds || [],
                )
            )
              fail("退回可售實物與回庫紀錄不符。");
          }
    }
}
/** Sparse historical availability used by FIFO validation, avoiding a replay for each movement. */
export function unitTrackingTimeline(s: CatalogSnapshot) {
  const entries = new Map<string, { index: number; quantity: number }[]>();
  const counts = new Map<string, number>(),
    positions = new Map<string, { batchId: string; locationId: string }>();
  const key = (batch: string, location: string) =>
    JSON.stringify([batch, location]);
  const change = (
    batch: string,
    location: string,
    amount: number,
    index: number,
  ) => {
    if (!location) return;
    const k = key(batch, location),
      n = (counts.get(k) || 0) + amount;
    counts.set(k, n);
    const rows = entries.get(k) || [];
    if (rows.at(-1)?.index === index)
      rows[rows.length - 1] = { index, quantity: n };
    else rows.push({ index, quantity: n });
    entries.set(k, rows);
  };
  const registrations = new Map<number, PhysicalUnit[]>();
  for (const u of s.physicalUnits) {
    const rows = registrations.get(u.registeredMovementCount) || [];
    rows.push(u);
    registrations.set(u.registeredMovementCount, rows);
  }
  for (let index = 0; index <= s.movements.length; index++) {
    for (const u of registrations.get(index) || []) {
      positions.set(u.id, {
        batchId: u.batchId,
        locationId: u.registeredLocationId,
      });
      change(u.batchId, u.registeredLocationId, 1, index);
    }
    if (index === s.movements.length) break;
    const m = s.movements[index]!;
    for (const id of m.unitIds || []) {
      const u = positions.get(id);
      if (!u) fail("異動引用未登記單件。");
      change(u.batchId, u.locationId, -1, index + 1);
      u.locationId = m.toLocationId;
      change(u.batchId, u.locationId, 1, index + 1);
    }
  }
  return (batch: string, location: string, index = s.movements.length) => {
    const rows = entries.get(key(batch, location)) || [];
    let low = 0,
      high = rows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (rows[mid]!.index <= index) low = mid + 1;
      else high = mid;
    }
    return low ? rows[low - 1]!.quantity : 0;
  };
}
