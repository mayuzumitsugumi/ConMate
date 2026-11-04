import { record, text } from "../catalog/operations";
import { costSummary, fractionDecimal } from "./operations";
import { batchBalances } from "../inventory/batches";
import type {
  CatalogSnapshot,
  BatchCostVersion,
  ExactFraction,
  InventoryMovement,
} from "../models/catalog";
type F = { n: bigint; d: bigint };
function f(n: bigint, d = 1n): F {
  if (d <= 0n) throw new Error("成本分母必須大於零。");
  let a = n < 0n ? -n : n,
    b = d;
  while (b) [a, b] = [b, a % b];
  const g = a || 1n;
  const r = { n: n / g, d: d / g };
  if (r.n.toString().length > 2000 || r.d.toString().length > 2000)
    throw new Error("精確成本過於複雜。");
  return r;
}
const add = (a: F, b: F) => f(a.n * b.d + b.n * a.d, a.d * b.d);
const minus = (a: F, b: F) => add(a, f(-b.n, b.d));
const fmt = (a: F) => fractionDecimal(a.n, a.d);
function decode(x: ExactFraction) {
  if (
    !x ||
    typeof x.numerator !== "string" ||
    typeof x.denominator !== "string" ||
    x.numerator.length > 2000 ||
    x.denominator.length > 2000 ||
    !/^(0|[1-9]\d*)$/.test(x.numerator) ||
    !/^[1-9]\d*$/.test(x.denominator)
  )
    throw new Error("批次精確成本格式不正確。");
  const a = f(BigInt(x.numerator), BigInt(x.denominator));
  if (a.n > BigInt(Number.MAX_SAFE_INTEGER) * a.d)
    throw new Error("批次成本超過安全範圍。");
  return a;
}
export function saveBatchCost(
  s: CatalogSnapshot,
  batchId: string,
  costId: string,
  notes: string,
) {
  const index = s.movements.findIndex((m) => m.id === batchId),
    m = s.movements[index];
  if (
    !m ||
    m.kind !== "receipt" ||
    index < s.batchTrackingStart ||
    s.movements.some((r) => r.reversesId === m.id)
  )
    throw new Error(
      "請選擇未沖銷的新製作入庫來源，舊來源未知庫存不能推定成本。",
    );
  const reason = text(notes, "成本版本原因", 2000);
  const c = costId
    ? s.costs.find((c) => c.id === costId && !c.archived)
    : undefined;
  if (
    costId &&
    (!c || c.productId !== m.productId || c.quantity !== m.quantity)
  )
    throw new Error(
      "成本與入庫必須是同商品且製作數量相同；分批入庫請先明確分開成本紀錄。",
    );
  if (
    costId &&
    s.batchCostVersions.some(
      (v) => v.costId === costId && v.batchId !== batchId,
    )
  )
    throw new Error("此成本已用於另一入庫來源，不能重複當作整批成本。");
  const summary = c ? costSummary(c) : null;
  const source = c
    ? {
        actualPrint: c.actualPrint,
        artworkAllocated: c.artworkAllocated,
        otherCost: c.otherCost,
        artworkExact: c.artworkAllocation
          ? {
              numerator: c.artworkAllocation.numerator,
              denominator: c.artworkAllocation.denominator,
            }
          : null,
      }
    : null;
  const v: BatchCostVersion = {
    ...record(s, "BCV", "批次成本版本"),
    batchId,
    costId: costId || "",
    productId: m.productId,
    quantity: m.quantity,
    costName: c?.name || "",
    exactTotal: summary?.exactTotal || null,
    source,
    effectiveMovementCount: s.movements.length,
    createdAt: new Date().toISOString(),
    notes: reason,
  };
  s.batchCostVersions.push(v);
  return v;
}
function at(
  s: CatalogSnapshot,
  batchId: string,
  index: number,
  allowed?: Set<string>,
) {
  let found: BatchCostVersion | undefined;
  for (const v of s.batchCostVersions)
    if (
      v.batchId === batchId &&
      v.effectiveMovementCount <= index &&
      (!allowed || allowed.has(v.id))
    )
      found = v;
  return found;
}
function portion(
  s: CatalogSnapshot,
  m: InventoryMovement,
  index: number,
  start = 0,
  quantity = m.quantity,
) {
  let known = f(0n),
    unknown = 0,
    remaining = quantity,
    skip = start;
  const merged = s.activityMerges.find((r) =>
    r.createdMovementIds.includes(m.id),
  );
  const handoff = merged
    ? s.activityHandoffs.find((h) => h.id === merged.handoffId)
    : undefined;
  const allowed = handoff ? new Set(handoff.costVersionIds || []) : undefined;
  for (const a of m.batchAllocations) {
    const ignored = Math.min(skip, a.quantity);
    skip -= ignored;
    const q = Math.min(remaining, a.quantity - ignored);
    if (q) {
      const v = at(s, a.batchId, index, allowed);
      if (v?.exactTotal) {
        const total = decode(v.exactTotal);
        known = add(
          known,
          f(total.n * BigInt(q), total.d * BigInt(v.quantity)),
        );
      } else unknown += q;
    }
    remaining -= q;
    if (!remaining) break;
  }
  if (remaining) throw new Error("銷售成本來源數量不足。");
  return { known, unknown };
}
/** A numbered item returns its own source, rather than the next FIFO slice. */
function unitPortion(
  s: CatalogSnapshot,
  movement: InventoryMovement,
  index: number,
  ids: string[] | undefined,
  quantity: number,
) {
  const selected = ids || [];
  if (
    selected.length !== quantity ||
    new Set(selected).size !== selected.length
  )
    throw new Error("單件退貨成本與實物數量不一致。");
  const allocations = new Map<string, number>();
  for (const id of selected) {
    if (!movement.unitIds?.includes(id))
      throw new Error("退貨單件不屬於原銷售出庫。");
    const unit = s.physicalUnits.find((u) => u.id === id);
    if (!unit || unit.productId !== movement.productId)
      throw new Error("退貨單件缺少原批次來源。");
    allocations.set(unit.batchId, (allocations.get(unit.batchId) || 0) + 1);
  }
  for (const [batchId, count] of allocations)
    if (
      count >
      (movement.batchAllocations.find((a) => a.batchId === batchId)?.quantity ||
        0)
    )
      throw new Error("單件退貨超過原批次出庫數量。");
  return portion(
    s,
    {
      ...movement,
      quantity,
      batchAllocations: [...allocations].map(([batchId, count]) => ({
        batchId,
        quantity: count,
      })),
    },
    index,
  );
}
export function batchCostReport(s: CatalogSnapshot) {
  const idx = new Map(s.movements.map((m, i) => [m.id, i]));
  const returns = new Map<string, (typeof s.refunds)[number]["lines"]>();
  for (const refund of s.refunds)
    for (const row of refund.lines) {
      const rows = returns.get(row.saleLineId) || [];
      rows.push(row);
      returns.set(row.saleLineId, rows);
    }
  let allKnown = f(0n),
    allUnknown = 0;
  const sales = s.sales.flatMap((sale) =>
    sale.lines.map((line) => {
      const index = idx.get(line.movementId);
      if (index === undefined) throw new Error("找不到銷售出庫來源。");
      const m = s.movements[index]!;
      const original = portion(s, m, index);
      let net = original.known,
        unknown = original.unknown,
        refunded = 0,
        damagedQuantity = 0,
        damagedKnown = f(0n),
        damagedUnknownQuantity = 0,
        returnedQuantity = 0,
        consumed = 0;
      if (sale.cancelledAt) {
        net = f(0n);
        unknown = 0;
        refunded = line.quantity * line.unitPrice;
        returnedQuantity = line.quantity;
      } else
        for (const r of returns.get(line.id) || []) {
          const back = m.unitIds?.length
              ? unitPortion(s, m, index, r.restockUnitIds, r.restockQuantity)
              : portion(s, m, index, consumed, r.restockQuantity),
            damaged = m.unitIds?.length
              ? unitPortion(s, m, index, r.damagedUnitIds, r.damagedQuantity)
              : portion(
                  s,
                  m,
                  index,
                  consumed + r.restockQuantity,
                  r.damagedQuantity,
                );
          net = minus(net, back.known);
          unknown -= back.unknown;
          returnedQuantity += r.restockQuantity;
          damagedQuantity += r.damagedQuantity;
          damagedKnown = add(damagedKnown, damaged.known);
          damagedUnknownQuantity += damaged.unknown;
          consumed += r.restockQuantity + r.damagedQuantity;
          refunded += r.amount;
        }
      if (!Number.isSafeInteger(unknown) || unknown < 0)
        throw new Error("成本未知數量不正確。");
      allKnown = add(allKnown, net);
      allUnknown += unknown;
      if (!Number.isSafeInteger(allUnknown))
        throw new Error("成本數量超出安全範圍。");
      const gross = line.quantity * line.unitPrice;
      return {
        saleId: sale.id,
        saleCode: sale.code,
        lineId: line.id,
        productName: line.productName,
        gross,
        refunded,
        returnedQuantity,
        damagedQuantity,
        damagedKnownCost: fmt(damagedKnown),
        damagedUnknownQuantity,
        soldQuantity: line.quantity,
        knownCost: fmt(original.known),
        knownCostExact: {
          numerator: original.known.n.toString(),
          denominator: original.known.d.toString(),
        },
        unknownQuantity: unknown,
        netKnownCost: fmt(net),
        netKnownCostExact: {
          numerator: net.n.toString(),
          denominator: net.d.toString(),
        },
        damagedKnownCostExact: {
          numerator: damagedKnown.n.toString(),
          denominator: damagedKnown.d.toString(),
        },
        margin: unknown ? null : fmt(minus(f(BigInt(gross - refunded)), net)),
      };
    }),
  );
  const state = batchBalances(s),
    stock = [];
  for (const lot of state.lots.values())
    for (const l of s.locations) {
      const quantity = state.quantity(lot.id, l.id);
      if (!quantity) continue;
      const v = at(s, lot.id, s.movements.length);
      let unit: F | null = null;
      if (v?.exactTotal) {
        const t = decode(v.exactTotal);
        unit = f(t.n, t.d * BigInt(v.quantity));
      }
      stock.push({
        batchId: lot.id,
        productId: lot.productId,
        locationId: l.id,
        quantity,
        unitCost: unit ? fmt(unit) : null,
        value: unit ? fmt(f(unit.n * BigInt(quantity), unit.d)) : null,
      });
    }
  return {
    sales,
    stock,
    totalKnownCost: fmt(allKnown),
    totalUnknownQuantity: allUnknown,
  };
}
export function validateBatchCosts(s: CatalogSnapshot) {
  const movementIndices = new Map(s.movements.map((m, index) => [m.id, index])),
    costIds = new Set(s.costs.map((c) => c.id));
  const previous = new Map<string, number>(),
    sources = new Map<string, string>();
  for (const v of s.batchCostVersions) {
    const index = movementIndices.get(v.batchId) ?? -1,
      m = s.movements[index];
    if (
      !m ||
      m.kind !== "receipt" ||
      index < s.batchTrackingStart ||
      v.productId !== m.productId ||
      v.quantity !== m.quantity
    )
      throw new Error("批次成本入庫關聯不一致。");
    if (
      !Number.isSafeInteger(v.effectiveMovementCount) ||
      v.effectiveMovementCount <= index ||
      v.effectiveMovementCount > s.movements.length ||
      v.effectiveMovementCount < (previous.get(v.batchId) || 0)
    )
      throw new Error("批次成本生效順序不正確。");
    previous.set(v.batchId, v.effectiveMovementCount);
    if (!v.costId) {
      if (v.costName || v.source !== null || v.exactTotal !== null)
        throw new Error("解除批次成本連結資料不一致。");
      continue;
    }
    if (!costIds.has(v.costId)) throw new Error("批次成本來源不存在。");
    const batch = sources.get(v.costId);
    if (batch && batch !== v.batchId)
      throw new Error("整批成本重複連到不同入庫。");
    sources.set(v.costId, v.batchId);
    if (!v.source || typeof v.source !== "object")
      throw new Error("缺少批次成本來源快照。");
    for (const n of [
      v.source.actualPrint,
      v.source.artworkAllocated,
      v.source.otherCost,
    ])
      if (n !== null && (!Number.isSafeInteger(n) || n < 0))
        throw new Error("批次成本快照金額不正確。");
    const art = v.source.artworkExact;
    if (art !== null) decode(art);
    if (
      [
        v.source.actualPrint,
        v.source.artworkAllocated,
        v.source.otherCost,
      ].includes(null)
    ) {
      if (v.exactTotal !== null) throw new Error("未知成本不能填入確定成本。");
    } else {
      if (!v.exactTotal) throw new Error("已知成本缺少精確金額。");
      const a = art ? decode(art) : f(BigInt(v.source.artworkAllocated!));
      const expected = add(
          f(BigInt(v.source.actualPrint!) + BigInt(v.source.otherCost!)),
          a,
        ),
        stored = decode(v.exactTotal);
      if (stored.n * expected.d !== expected.n * stored.d)
        throw new Error("批次精確成本與快照不符。");
    }
  }
}
