import { sameData } from "../../shared/data-equality";
import type { CatalogSnapshot, RefundInput } from "../models/catalog";
import type { Consignment } from "./types";
import { record, text } from "../catalog/operations";
import { addLocation, addMovement, balance } from "../inventory/operations";
import { completeSale } from "../sales/operations";
import { refundSale, saleRefundedTotal } from "../sales/refunds";
import { safeAmount, whole } from "../money";
const now = () => new Date().toISOString();
function fail(m: string): never {
  throw new Error(m);
}
function instant(v: string) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    fail("請填寫含時區的有效時間。");
  return new Date(v).toISOString();
}
function get(s: CatalogSnapshot, id: string, open = true) {
  const c = s.consignments.find((c) => c.id === id);
  if (!c) fail("寄賣資料不存在。");
  if (open && c.closedAt) fail("寄賣已結束，請先明確重新開啟；原歷史保留。");
  return c;
}
function atomic<T>(s: CatalogSnapshot, fn: (next: CatalogSnapshot) => T): T {
  const next = structuredClone(s),
    r = fn(next);
  validateConsignments(next);
  Object.assign(s, next);
  return r;
}
export function saveConsignment(
  s: CatalogSnapshot,
  input: { name: string; storePartyId: string; notes: string },
) {
  return atomic(s, (n) => {
    if (!n.parties.some((p) => p.id === input.storePartyId && !p.archived))
      fail("請選擇啟用寄賣店參與方。");
    const r = {
      ...record(n, "CON", text(input.name, "寄賣名稱")),
      storePartyId: input.storePartyId,
      locationId: "",
      notes: input.notes.trim(),
      createdAt: now(),
      closedAt: "",
      operations: [],
      deliveryIds: [],
      returnIds: [],
      saleIds: [],
      refundIds: [],
      statements: [],
      remittances: [],
      statusHistory: [],
    } as Consignment;
    if (r.notes.length > 2000) fail("備註過長。");
    r.locationId = addLocation(n, `${r.name}｜寄賣 ${r.id.slice(0, 8)}`).id;
    n.consignments.push(r);
    return r;
  });
}
interface StockInput {
  operationId?: string;
  productId: string;
  quantity: number;
  unitIds?: string[];
  reason: string;
}
function priorOperation(
  c: Consignment,
  kind: "delivery" | "return" | "remittance",
  input: { operationId?: string },
) {
  const id = text(input.operationId || "", "操作識別", 100);
  const old = c.operations.find((o) => o.id === id);
  if (old && (!sameData(old.request, input) || old.kind !== kind))
    fail("相同操作識別已用於不同寄賣資料，請重新讀取。");
  return old;
}
function remember(
  c: Consignment,
  kind: "delivery" | "return" | "remittance",
  input: { operationId?: string },
  resultId: string,
) {
  c.operations.push({
    id: input.operationId!,
    kind,
    request: structuredClone(input),
    resultId,
  });
}
export function deliverConsignment(
  s: CatalogSnapshot,
  id: string,
  input: StockInput & { sourceLocationId: string },
) {
  return atomic(s, (n) => {
    const c = get(n, id);
    const old = priorOperation(c, "delivery", input);
    if (old) return n.movements.find((r) => r.id === old.resultId)!;
    if (n.consignments.some((x) => x.locationId === input.sourceLocationId))
      fail("寄賣交付來源須為一般庫位。");
    const m = addMovement(n, {
      ...input,
      kind: "transfer",
      fromLocationId: input.sourceLocationId,
      toLocationId: c.locationId,
    });
    c.deliveryIds.push(m.id);
    remember(c, "delivery", input, m.id);
    return m;
  });
}
export function reportConsignmentSale(
  s: CatalogSnapshot,
  id: string,
  input: {
    productId: string;
    quantity: number;
    unitPrice: number;
    unitIds?: string[];
    soldAt: string;
    reason: string;
    operationId: string;
  },
) {
  return atomic(s, (n) => {
    const c = get(n, id),
      at = instant(input.soldAt);
    if (Date.parse(at) > Date.now() + 60000) fail("實際售出時間不可在未來。");
    const old = n.sales.find((x) => x.operationId === input.operationId);
    if (old) {
      if (
        old.consignmentId !== c.id ||
        old.createdAt !== at ||
        old.notes !== input.reason.trim() ||
        old.lines.length !== 1 ||
        old.lines[0]!.productId !== input.productId ||
        old.lines[0]!.quantity !== input.quantity ||
        old.lines[0]!.unitPrice !== input.unitPrice ||
        JSON.stringify(old.lines[0]!.unitIds || []) !==
          JSON.stringify(input.unitIds || [])
      )
        fail("相同操作識別已用於不同回報。");
      return old;
    }
    const total = safeAmount(
      BigInt(whole(input.quantity, "售出數量", true)) *
        BigInt(whole(input.unitPrice, "售價")),
    );
    const sale = completeSale(n, {
      operationId: input.operationId,
      locationId: c.locationId,
      eventId: "",
      collectorId: c.storePartyId,
      cashReceived: total,
      notes: text(input.reason, "回報原因", 2000),
      lines: [
        {
          productId: input.productId,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          unitIds: input.unitIds,
          mode: "direct",
        },
      ],
    });
    sale.consignmentId = c.id;
    sale.consignmentReportedAt = now();
    sale.createdAt = at;
    c.saleIds.push(sale.id);
    return sale;
  });
}
export function returnConsignmentStock(
  s: CatalogSnapshot,
  id: string,
  input: StockInput & { toLocationId: string },
) {
  return atomic(s, (n) => {
    const c = get(n, id);
    const old = priorOperation(c, "return", input);
    if (old) return n.movements.find((r) => r.id === old.resultId)!;
    if (n.consignments.some((x) => x.locationId === input.toLocationId))
      fail("請選擇一般實物退回庫位。");
    const m = addMovement(n, {
      ...input,
      kind: "transfer",
      fromLocationId: c.locationId,
      toLocationId: input.toLocationId,
    });
    c.returnIds.push(m.id);
    remember(c, "return", input, m.id);
    return m;
  });
}
export function recordConsignmentRefund(
  s: CatalogSnapshot,
  id: string,
  input: RefundInput,
) {
  return atomic(s, (n) => {
    const c = get(n, id);
    if (!c.saleIds.includes(input.saleId)) fail("退款原交易不屬於此寄賣。");
    if (
      input.lines.some(
        (l) => l.returnLocationId && l.returnLocationId !== c.locationId,
      )
    )
      fail("顧客退貨先回寄賣庫位，再另記實物收回。");
    const r = refundSale(n, input);
    if (!c.refundIds.includes(r.id)) c.refundIds.push(r.id);
    return r;
  });
}
export function setConsignmentStatement(
  s: CatalogSnapshot,
  id: string,
  input: { fee: number | null; adjustment: number | null; reason: string },
) {
  return atomic(s, (n) => {
    const c = get(n, id);
    if (input.fee !== null) whole(input.fee, "實際寄賣費");
    if (input.adjustment !== null && !Number.isSafeInteger(input.adjustment))
      fail("調整額須為安全整數。");
    const r = {
      id: crypto.randomUUID(),
      ...input,
      reason: text(input.reason, "核對原因", 2000),
      createdAt: now(),
    };
    c.statements.push(r);
    return r;
  });
}
export function recordConsignmentRemittance(
  s: CatalogSnapshot,
  id: string,
  input: {
    amount: number;
    receivedAt: string;
    reason: string;
    operationId?: string;
  },
) {
  return atomic(s, (n) => {
    const c = get(n, id, false);
    const old = priorOperation(c, "remittance", input);
    if (old) return c.remittances.find((r) => r.id === old.resultId)!;
    whole(input.amount, "實際收到款項", true);
    const receivedAt = instant(input.receivedAt);
    if (Date.parse(receivedAt) > Date.now() + 60000)
      fail("實收時間不能在未來。");
    const r = {
      id: crypto.randomUUID(),
      amount: input.amount,
      receivedAt,
      reason: text(input.reason, "實收說明", 2000),
      reversesId: "",
      createdAt: now(),
    };
    c.remittances.push(r);
    remember(c, "remittance", input, r.id);
    return r;
  });
}
export function reverseConsignmentRemittance(
  s: CatalogSnapshot,
  id: string,
  paymentId: string,
  reason: string,
) {
  return atomic(s, (n) => {
    const c = get(n, id, false),
      old = c.remittances.find((r) => r.id === paymentId);
    if (
      !old ||
      old.reversesId ||
      c.remittances.some((r) => r.reversesId === old.id)
    )
      fail("找不到可沖銷實收。");
    const r = {
      id: crypto.randomUUID(),
      amount: old.amount,
      receivedAt: now(),
      reason: text(reason, "沖銷原因", 2000),
      reversesId: old.id,
      createdAt: now(),
    };
    c.remittances.push(r);
    return r;
  });
}
export function closeConsignment(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  return atomic(s, (n) => {
    const c = get(n, id);
    c.closedAt = now();
    c.statusHistory.push({
      at: c.closedAt,
      closed: true,
      reason: text(reason, "結束原因", 2000),
    });
  });
}
export function reopenConsignment(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  return atomic(s, (n) => {
    const c = get(n, id, false);
    if (!c.closedAt) fail("寄賣尚未結束。");
    c.closedAt = "";
    c.statusHistory.push({
      at: now(),
      closed: false,
      reason: text(reason, "重新開啟原因", 2000),
    });
  });
}
export function consignmentSummary(s: CatalogSnapshot, c: Consignment) {
  const gross = safeAmount(
      c.saleIds.reduce(
        (sum, id) => sum + BigInt(s.sales.find((x) => x.id === id)!.total),
        0n,
      ),
    ),
    refunds = safeAmount(
      c.saleIds.reduce((sum, id) => sum + BigInt(saleRefundedTotal(s, id)), 0n),
    );
  const last = c.statements.at(-1),
    fee = last?.fee ?? null,
    adjustment = last?.adjustment ?? null,
    received = safeAmount(
      c.remittances.reduce(
        (sum, r) => sum + (r.reversesId ? -1n : 1n) * BigInt(r.amount),
        0n,
      ),
    );
  const value =
    fee === null || adjustment === null
      ? null
      : BigInt(gross) - BigInt(refunds) - BigInt(fee) + BigInt(adjustment);
  if (
    value !== null &&
    (value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER))
  )
    fail("核對金額超出安全範圍。");
  const expected = value === null ? null : Number(value),
    b = value === null ? null : value - BigInt(received);
  if (
    b !== null &&
    (b > BigInt(Number.MAX_SAFE_INTEGER) || b < BigInt(Number.MIN_SAFE_INTEGER))
  )
    fail("差額超出安全範圍。");
  return {
    gross,
    refunds,
    netSales: gross - refunds,
    fee,
    adjustment,
    expected,
    received,
    balance: b === null ? null : Number(b),
  };
}
export function validateConsignments(s: CatalogSnapshot) {
  if (!Array.isArray(s.consignments)) fail("缺少寄賣清單。");
  const ids = new Set<string>(),
    locs = new Set<string>();
  for (const c of s.consignments) {
    if (
      !c.id ||
      ids.has(c.id) ||
      c.workspaceId !== s.workspaceId ||
      !/^CON-\d+$/.test(c.code) ||
      locs.has(c.locationId)
    )
      fail("寄賣識別或庫位重複。");
    ids.add(c.id);
    locs.add(c.locationId);
    text(c.name, "寄賣名稱");
    if (
      !s.parties.some((p) => p.id === c.storePartyId) ||
      !s.locations.some((l) => l.id === c.locationId) ||
      s.activityHandoffs.some((h) => h.locationId === c.locationId)
    )
      fail("寄賣店或庫位來源不正確。");
    instant(c.createdAt);
    if (c.closedAt) instant(c.closedAt);
    if (typeof c.notes !== "string" || c.notes.length > 2000)
      fail("寄賣備註不正確。");
    const movementIds = new Set<string>();
    for (const [list, incoming] of [
      [c.deliveryIds, true],
      [c.returnIds, false],
    ] as const) {
      if (!Array.isArray(list) || new Set(list).size !== list.length)
        fail("寄賣交付識別重複。");
      for (const id of list) {
        if (movementIds.has(id)) fail("寄賣異動重複。");
        movementIds.add(id);
        const m = s.movements.find((m) => m.id === id);
        if (
          !m ||
          m.kind !== "transfer" ||
          (incoming
            ? m.toLocationId !== c.locationId
            : m.fromLocationId !== c.locationId) ||
          s.consignments.some(
            (x) =>
              x.locationId === (incoming ? m.fromLocationId : m.toLocationId),
          )
        )
          fail("寄賣交付／收回異動不符。");
      }
    }
    if (
      !Array.isArray(c.saleIds) ||
      new Set(c.saleIds).size !== c.saleIds.length ||
      !Array.isArray(c.refundIds) ||
      new Set(c.refundIds).size !== c.refundIds.length
    )
      fail("寄賣銷售／退款識別重複。");
    for (const id of c.saleIds) {
      const sale = s.sales.find((x) => x.id === id);
      if (
        !sale ||
        sale.consignmentId !== c.id ||
        sale.locationId !== c.locationId ||
        sale.collectorId !== c.storePartyId ||
        sale.eventId ||
        sale.exchangeId ||
        sale.cancelledAt
      )
        fail("寄賣銷售來源不符。");
      instant(sale.consignmentReportedAt!);
      for (const l of sale.lines) movementIds.add(l.movementId);
    }
    for (const id of c.refundIds) {
      const r = s.refunds.find((r) => r.id === id);
      if (!r || !c.saleIds.includes(r.saleId) || r.exchangeId)
        fail("寄賣退款來源不符。");
      for (const l of r.lines) {
        if (l.returnLocationId && l.returnLocationId !== c.locationId)
          fail("寄賣退貨庫位不符。");
        if (l.movementId) movementIds.add(l.movementId);
      }
    }
    if (
      s.refunds.some(
        (r) => c.saleIds.includes(r.saleId) && !c.refundIds.includes(r.id),
      )
    )
      fail("寄賣退款回報清單缺漏。");
    if (!Array.isArray(c.operations)) fail("寄賣操作紀錄缺漏。");
    const ops = new Set<string>();
    for (const o of c.operations) {
      if (!o.id || ops.has(o.id)) fail("寄賣操作識別重複。");
      ops.add(o.id);
      const list =
        o.kind === "delivery"
          ? c.deliveryIds
          : o.kind === "return"
            ? c.returnIds
            : o.kind === "remittance"
              ? c.remittances.filter((r) => !r.reversesId).map((r) => r.id)
              : [];
      if (
        !list.includes(o.resultId) ||
        (o.request as { operationId?: string })?.operationId !== o.id
      )
        fail("寄賣操作結果不符。");
      const req = o.request as Record<string, unknown>;
      if (o.kind === "remittance") {
        const r = c.remittances.find((r) => r.id === o.resultId)!;
        if (
          req.amount !== r.amount ||
          typeof req.receivedAt !== "string" ||
          instant(req.receivedAt) !== r.receivedAt ||
          typeof req.reason !== "string" ||
          req.reason.trim() !== r.reason
        )
          fail("寄賣實收與操作來源不符。");
      } else {
        const r = s.movements.find((r) => r.id === o.resultId)!;
        if (
          !r ||
          req.productId !== r.productId ||
          req.quantity !== r.quantity ||
          typeof req.reason !== "string" ||
          req.reason.trim() !== r.reason ||
          !sameData(req.unitIds || [], r.unitIds || []) ||
          (o.kind === "delivery"
            ? req.sourceLocationId !== r.fromLocationId
            : req.toLocationId !== r.toLocationId)
        )
          fail("寄賣交付與操作來源不符。");
      }
    }
    for (const id of [
      ...c.deliveryIds,
      ...c.returnIds,
      ...c.remittances.filter((r) => !r.reversesId).map((r) => r.id),
    ])
      if (!c.operations.some((o) => o.resultId === id))
        fail("寄賣操作來源缺漏。");
    for (const m of s.movements)
      if (
        (m.fromLocationId === c.locationId ||
          m.toLocationId === c.locationId) &&
        !movementIds.has(m.id)
      )
        fail("寄賣庫位須透過寄賣流程操作，不可從一般庫存或販售頁改動。");
    if (s.inventoryReservations.some((r) => r.locationId === c.locationId))
      fail("寄賣庫位不接受活動方案預留。");
    if (
      !Array.isArray(c.statements) ||
      !Array.isArray(c.remittances) ||
      !Array.isArray(c.statusHistory)
    )
      fail("寄賣核對清單不正確。");
    const rowIds = new Set<string>();
    for (const r of c.statements) {
      if (!r.id || rowIds.has(r.id)) fail("寄賣核對識別重複。");
      rowIds.add(r.id);
      if (r.fee !== null) whole(r.fee, "費用");
      if (r.adjustment !== null && !Number.isSafeInteger(r.adjustment))
        fail("調整額不正確。");
      text(r.reason, "核對原因", 2000);
      instant(r.createdAt);
    }
    const paid = new Map<string, (typeof c.remittances)[number]>(),
      reversed = new Set<string>();
    for (const r of c.remittances) {
      if (!r.id || rowIds.has(r.id)) fail("寄賣實收識別重複。");
      rowIds.add(r.id);
      whole(r.amount, "實收金額", true);
      instant(r.createdAt);
      instant(r.receivedAt);
      text(r.reason, "實收說明", 2000);
      if (r.reversesId) {
        const old = paid.get(r.reversesId);
        if (
          !old ||
          old.reversesId ||
          old.amount !== r.amount ||
          reversed.has(old.id)
        )
          fail("寄賣實收沖銷不符。");
        reversed.add(old.id);
      }
      paid.set(r.id, r);
    }
    let closed = "";
    for (const r of c.statusHistory) {
      instant(r.at);
      text(r.reason, "狀態原因", 2000);
      if (typeof r.closed !== "boolean" || r.closed === !!closed)
        fail("寄賣狀態歷史不連續。");
      closed = r.closed ? r.at : "";
    }
    if (closed !== c.closedAt) fail("寄賣結束狀態不符。");
    consignmentSummary(s, c);
  }
  for (const sale of s.sales)
    if (
      sale.consignmentId &&
      !s.consignments.some(
        (c) => c.id === sale.consignmentId && c.saleIds.includes(sale.id),
      )
    )
      fail("寄賣銷售缺少來源。");
}
