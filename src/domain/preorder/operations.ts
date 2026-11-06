import type { CatalogSnapshot, RefundInput } from "../models/catalog";
import type {
  Preorder,
  PreorderInput,
  PreorderPaymentInput,
  PreorderFulfillmentInput,
  PreorderCancelInput,
  PreorderReturnInput,
} from "./types";
import { record, text } from "../catalog/operations";
import { whole, safeAmount } from "../money";
import { sameData } from "../../shared/data-equality";
import { completeSale } from "../sales/operations";
import { refundSale } from "../sales/refunds";
const now = () => new Date().toISOString();
function fail(m: string): never {
  throw new Error(m);
}
function at(v: string) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    Date.parse(v) > Date.now() + 60000
  )
    fail("請填有效且非未來的含時區時間。");
  return new Date(v).toISOString();
}
const sum = (a: number[]) => safeAmount(a.reduce((n, v) => n + BigInt(v), 0n));
function order(s: CatalogSnapshot, id: string, open = true) {
  const o = s.preorders.find((o) => o.id === id);
  if (!o) fail("預售訂單不存在。");
  if (open && o.closedAt) fail("訂單已結束，請先明確重新開啟。");
  return o;
}
function run(
  s: CatalogSnapshot,
  id: string,
  kind: string,
  input: { operationId: string },
  fn: (n: CatalogSnapshot, o: Preorder) => string,
) {
  const n = structuredClone(s),
    o = order(n, id, false),
    op = text(input.operationId, "操作識別", 100),
    old = o.operations.find((r) => r.id === op);
  if (old) {
    if (old.kind !== kind || !sameData(old.request, input))
      fail("同一操作識別已用於不同資料。");
    return old.resultId;
  }
  const result = fn(n, o);
  o.operations.push({
    id: op,
    kind,
    request: structuredClone(input),
    resultId: result,
  });
  validatePreorders(n);
  Object.assign(s, n);
  return result;
}
export function preorderSummary(s: CatalogSnapshot, o: Preorder) {
  const lines = o.lines.map((l) => {
    const cancelledQuantity = sum(
        o.cancellations.flatMap((c) =>
          c.lines.filter((r) => r.orderLineId === l.id).map((r) => r.quantity),
        ),
      ),
      deliveredQuantity = sum(
        o.fulfillments.flatMap((f) =>
          f.lines.filter((r) => r.orderLineId === l.id).map((r) => r.quantity),
        ),
      );
    return {
      ...l,
      cancelledQuantity,
      deliveredQuantity,
      remainingQuantity: l.quantity - cancelledQuantity - deliveredQuantity,
    };
  });
  const total = sum(
      o.lines.map((l) => safeAmount(BigInt(l.quantity) * BigInt(l.unitPrice))),
    ),
    cancelledValue = sum(
      lines.map((l) =>
        safeAmount(BigInt(l.cancelledQuantity) * BigInt(l.unitPrice)),
      ),
    ),
    deliveredValue = sum(
      o.fulfillments.map((f) => s.sales.find((x) => x.id === f.saleId)!.total),
    ),
    returnCredit = sum(
      o.returnIds.map((id) => s.refunds.find((r) => r.id === id)!.total),
    ),
    received = sum(
      o.payments.filter((p) => p.kind === "receipt").map((p) => p.amount),
    ),
    refunded = sum(
      o.payments.filter((p) => p.kind === "refund").map((p) => p.amount),
    ),
    reversed = sum(
      o.payments
        .filter((p) => p.kind === "receipt-reversal")
        .map((p) => p.amount),
    );
  const netPaid = received - refunded - reversed,
    activeTotal = total - cancelledValue - returnCredit,
    netDeliveredValue = deliveredValue - returnCredit;
  return {
    total,
    cancelledValue,
    returnCredit,
    activeTotal,
    deliveredValue,
    netDeliveredValue,
    received,
    refunded,
    netPaid,
    balance: activeTotal - netPaid,
    refundable: Math.max(0, netPaid),
    lines,
  };
}
export function createPreorder(s: CatalogSnapshot, input: PreorderInput) {
  const old = s.preorders.find(
    (o) => o.createOperationId === input.operationId,
  );
  if (old) {
    if (!sameData(old.operations[0]?.request, input))
      fail("同一操作識別已用於不同訂單。");
    return old;
  }
  text(input.operationId, "操作識別", 100);
  if (
    !Array.isArray(input.lines) ||
    !input.lines.length ||
    input.lines.length > 100
  )
    fail("訂單需1至100項商品。");
  const n = structuredClone(s),
    seen = new Set<string>();
  const lines = input.lines.map((l) => {
    const p = n.products.find((p) => p.id === l.productId && !p.archived);
    if (!p || seen.has(l.productId)) fail("商品不存在、封存或重複。");
    seen.add(l.productId);
    whole(l.quantity, "訂購數量", true);
    whole(l.unitPrice, "約定單價");
    return {
      id: crypto.randomUUID(),
      productId: p.id,
      productName: p.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    };
  });
  const o: Preorder = {
    ...record(n, "PRE", text(input.name, "訂單名稱")),
    createOperationId: input.operationId,
    customerReference: input.customerReference.trim()
      ? text(input.customerReference, "顧客代稱", 120)
      : "",
    notes: input.notes.trim(),
    createdAt: now(),
    closedAt: "",
    lines,
    payments: [],
    fulfillments: [],
    cancellations: [],
    returnIds: [],
    operations: [],
    statusHistory: [],
  };
  if (o.notes.length > 2000) fail("說明過長。");
  o.operations.push({
    id: input.operationId,
    kind: "create",
    request: structuredClone(input),
    resultId: o.id,
  });
  n.preorders.push(o);
  validatePreorders(n);
  Object.assign(s, n);
  return o;
}
export function receivePreorder(
  s: CatalogSnapshot,
  id: string,
  input: PreorderPaymentInput,
) {
  return run(s, id, "receipt", input, (n, o) => {
    order(n, id);
    whole(input.amount, "實收金額", true);
    if (input.partyId && !n.parties.some((p) => p.id === input.partyId))
      fail("收款對象不存在。");
    const r = {
      ...input,
      id: crypto.randomUUID(),
      kind: "receipt" as const,
      occurredAt: at(input.occurredAt),
      createdAt: now(),
      reason: text(input.reason, "實收說明", 2000),
      reversesId: "",
    };
    o.payments.push(r);
    return r.id;
  });
}
export function refundPreorderPayment(
  s: CatalogSnapshot,
  id: string,
  input: PreorderPaymentInput,
) {
  return run(s, id, "refund", input, (n, o) => {
    whole(input.amount, "實際退款", true);
    if (input.amount > preorderSummary(n, o).refundable)
      fail("退款超過實際尚未退還的已收款。");
    if (
      input.amount >
        Math.max(
          0,
          preorderSummary(n, o).netPaid - preorderSummary(n, o).activeTotal,
        ) &&
      input.confirmedOutstanding !== true
    )
      fail("退款後仍有未收款，請明確確認此實際退款不代表取消商品或減價。");
    if (input.partyId && !n.parties.some((p) => p.id === input.partyId))
      fail("付款對象不存在。");
    const r = {
      ...input,
      id: crypto.randomUUID(),
      kind: "refund" as const,
      occurredAt: at(input.occurredAt),
      createdAt: now(),
      reason: text(input.reason, "退款說明", 2000),
      reversesId: "",
    };
    o.payments.push(r);
    return r.id;
  });
}
export function reversePreorderReceipt(
  s: CatalogSnapshot,
  id: string,
  input: { operationId: string; paymentId: string; reason: string },
) {
  return run(s, id, "receipt-reversal", input, (_n, o) => {
    const old = o.payments.find(
      (p) => p.id === input.paymentId && p.kind === "receipt",
    );
    if (!old || o.payments.some((p) => p.reversesId === old.id))
      fail("找不到可沖銷的收款。");
    const r = {
      ...old,
      id: crypto.randomUUID(),
      kind: "receipt-reversal" as const,
      reversesId: old.id,
      occurredAt: now(),
      createdAt: now(),
      reason: text(input.reason, "沖銷原因", 2000),
    };
    o.payments.push(r);
    return r.id;
  });
}
function generalLocation(s: CatalogSnapshot, id: string) {
  if (
    !s.locations.some((l) => l.id === id) ||
    s.consignments.some((c) => c.locationId === id) ||
    s.activityHandoffs.some((h) => h.locationId === id)
  )
    fail("預售交付／退貨請使用一般庫位，不可使用活動交接或寄賣庫位。");
}
export function fulfillPreorder(
  s: CatalogSnapshot,
  id: string,
  input: PreorderFulfillmentInput,
) {
  return run(s, id, "fulfill", input, (n, o) => {
    order(n, id);
    generalLocation(n, input.locationId);
    if (
      !input.lines.length ||
      input.lines.length > 100 ||
      new Set(input.lines.map((l) => l.orderLineId)).size !== input.lines.length
    )
      fail("交付明細不可空白或重複。");
    const summary = preorderSummary(n, o),
      rows = input.lines.map((l) => {
        const line = summary.lines.find((r) => r.id === l.orderLineId);
        whole(l.quantity, "交付數量", true);
        if (!line || l.quantity > line.remainingQuantity)
          fail("交付超過尚未交付數量。");
        return {
          productId: line.productId,
          quantity: l.quantity,
          unitPrice: line.unitPrice,
          mode: "direct" as const,
          ...(l.unitIds?.length ? { unitIds: l.unitIds } : {}),
        };
      });
    const value = sum(
      rows.map((l) => safeAmount(BigInt(l.quantity) * BigInt(l.unitPrice))),
    );
    if (
      summary.netPaid < summary.netDeliveredValue + value &&
      input.allowUnpaidDelivery !== true
    )
      fail("尚有未收款；若實物已交付，請明確確認未收齊款項仍交付並註明原因。");
    const sale = completeSale(
      n,
      {
        operationId: crypto.randomUUID(),
        locationId: input.locationId,
        eventId: "",
        collectorId: "",
        cashReceived: 0,
        notes: text(input.reason, "交付原因", 2000),
        lines: rows,
      },
      undefined,
      { id: o.id },
    );
    const f = {
      id: crypto.randomUUID(),
      saleId: sale.id,
      allowUnpaidDelivery: input.allowUnpaidDelivery === true,
      createdAt: sale.createdAt,
      lines: input.lines.map((l, i) => ({
        orderLineId: l.orderLineId,
        saleLineId: sale.lines[i]!.id,
        quantity: l.quantity,
      })),
    };
    o.fulfillments.push(f);
    return f.id;
  });
}
export function cancelPreorder(
  s: CatalogSnapshot,
  id: string,
  input: PreorderCancelInput,
) {
  return run(s, id, "cancel", input, (n, o) => {
    order(n, id);
    if (
      !input.lines.length ||
      new Set(input.lines.map((l) => l.orderLineId)).size !== input.lines.length
    )
      fail("取消明細不可空白或重複。");
    const summary = preorderSummary(n, o);
    for (const l of input.lines) {
      whole(l.quantity, "取消數量", true);
      if (
        l.quantity >
        (summary.lines.find((r) => r.id === l.orderLineId)?.remainingQuantity ??
          -1)
      )
        fail("只能取消尚未交付數量。");
    }
    const r = {
      id: crypto.randomUUID(),
      createdAt: now(),
      lines: structuredClone(input.lines),
      reason: text(input.reason, "取消原因", 2000),
    };
    o.cancellations.push(r);
    return r.id;
  });
}
export function returnPreorderGoods(
  s: CatalogSnapshot,
  id: string,
  input: PreorderReturnInput,
) {
  return run(s, id, "return", input, (n, o) => {
    const f = o.fulfillments.find((f) => f.saleId === input.saleId);
    if (!f) fail("不是此訂單交付交易。");
    const sale = n.sales.find((s) => s.id === f.saleId)!;
    for (const l of input.lines) {
      const line = sale.lines.find((r) => r.id === l.saleLineId);
      if (
        !line ||
        BigInt(l.amount) !==
          BigInt(l.restockQuantity + l.damagedQuantity) * BigInt(line.unitPrice)
      )
        fail("退貨折抵需等於原單價乘實際退回數量，實際退款另記。");
      if (l.returnLocationId) generalLocation(n, l.returnLocationId);
    }
    const r = refundSale(
      n,
      { ...input, operationId: crypto.randomUUID() },
      undefined,
      o.id,
    );
    o.returnIds.push(r.id);
    return r.id;
  });
}
export function closePreorder(
  s: CatalogSnapshot,
  id: string,
  input: { operationId: string; reason: string },
) {
  return run(s, id, "close", input, (_n, o) => {
    if (o.closedAt) fail("訂單已結束。");
    o.closedAt = now();
    o.statusHistory.push({
      at: o.closedAt,
      closed: true,
      reason: text(input.reason, "結束原因", 2000),
    });
    return o.id;
  });
}
export function reopenPreorder(
  s: CatalogSnapshot,
  id: string,
  input: { operationId: string; reason: string },
) {
  return run(s, id, "reopen", input, (_n, o) => {
    if (!o.closedAt) fail("訂單尚未結束。");
    o.closedAt = "";
    o.statusHistory.push({
      at: now(),
      closed: false,
      reason: text(input.reason, "重開原因", 2000),
    });
    return o.id;
  });
}
export function validatePreorders(s: CatalogSnapshot) {
  if (!Array.isArray(s.preorders)) fail("缺少預售訂單。");
  const ids = new Set<string>(),
    ops = new Set<string>(),
    saleIds = new Set<string>(),
    refundIds = new Set<string>();
  for (const o of s.preorders) {
    if (
      !o.id ||
      ids.has(o.id) ||
      o.workspaceId !== s.workspaceId ||
      !/^PRE-\d+$/.test(o.code)
    )
      fail("預售識別不正確。");
    ids.add(o.id);
    text(o.name, "訂單名稱");
    if (o.customerReference !== "") text(o.customerReference, "顧客代稱", 120);
    if (
      typeof o.notes !== "string" ||
      o.notes.length > 2000 ||
      !Number.isFinite(Date.parse(o.createdAt))
    )
      fail("訂單說明或時間不正確。");
    if (!Array.isArray(o.lines) || !o.lines.length || o.lines.length > 100)
      fail("訂單明細不正確。");
    const lineIds = new Set<string>(),
      products = new Set<string>();
    for (const l of o.lines) {
      if (
        !l.id ||
        lineIds.has(l.id) ||
        products.has(l.productId) ||
        !s.products.some((p) => p.id === l.productId)
      )
        fail("訂單商品關聯不正確。");
      lineIds.add(l.id);
      products.add(l.productId);
      text(l.productName, "商品快照");
      whole(l.quantity, "訂購量", true);
      whole(l.unitPrice, "單價");
    }
    for (const key of [
      "payments",
      "fulfillments",
      "cancellations",
      "returnIds",
      "operations",
      "statusHistory",
    ] as const)
      if (!Array.isArray(o[key])) fail("訂單清單不正確。");
    const rowIds = new Set<string>();
    let paid = 0n;
    const receiptIds = new Map<string, (typeof o.payments)[number]>(),
      reversed = new Set<string>();
    for (const p of o.payments) {
      if (!p.id || rowIds.has(p.id)) fail("款項識別重複。");
      rowIds.add(p.id);
      whole(p.amount, "款項", true);
      at(p.occurredAt);
      if (!Number.isFinite(Date.parse(p.createdAt)))
        fail("款項登記時間不正確。");
      text(p.reason, "款項原因", 2000);
      if (p.partyId && !s.parties.some((r) => r.id === p.partyId))
        fail("款項對象不存在。");
      if (p.kind === "receipt") {
        if (p.reversesId) fail("收款不可指向沖銷來源。");
        paid += BigInt(p.amount);
        receiptIds.set(p.id, p);
      } else if (p.kind === "refund") paid -= BigInt(p.amount);
      else if (p.kind === "receipt-reversal") {
        const old = receiptIds.get(p.reversesId);
        if (
          !old ||
          reversed.has(old.id) ||
          old.amount !== p.amount ||
          old.partyId !== p.partyId
        )
          fail("收款沖銷來源不正確。");
        reversed.add(old.id);
        paid -= BigInt(p.amount);
      } else fail("款項種類不正確。");
      if (paid < 0n || paid > BigInt(Number.MAX_SAFE_INTEGER))
        fail("款項沖銷或退款超過已收款。");
    }
    for (const c of o.cancellations) {
      if (
        !c.id ||
        rowIds.has(c.id) ||
        !c.lines.length ||
        new Set(c.lines.map((l) => l.orderLineId)).size !== c.lines.length
      )
        fail("取消明細不正確。");
      rowIds.add(c.id);
      text(c.reason, "取消原因", 2000);
      for (const l of c.lines) {
        if (!lineIds.has(l.orderLineId)) fail("取消商品不存在。");
        whole(l.quantity, "取消量", true);
      }
    }
    for (const f of o.fulfillments) {
      if (!f.id || rowIds.has(f.id) || saleIds.has(f.saleId))
        fail("交付識別重複。");
      rowIds.add(f.id);
      saleIds.add(f.saleId);
      const sale = s.sales.find((r) => r.id === f.saleId);
      if (
        !sale ||
        sale.preorderId !== o.id ||
        sale.consignmentId ||
        sale.exchangeId ||
        sale.cancelledAt ||
        sale.cashReceived ||
        sale.change ||
        sale.lines.length !== f.lines.length
      )
        fail("預售交付交易不正確。");
      generalLocation(s, sale.locationId);
      for (let i = 0; i < f.lines.length; i++) {
        const l = f.lines[i]!,
          ol = o.lines.find((r) => r.id === l.orderLineId),
          sl = sale.lines[i];
        if (
          !ol ||
          !sl ||
          sl.id !== l.saleLineId ||
          sl.productId !== ol.productId ||
          sl.quantity !== l.quantity ||
          sl.unitPrice !== ol.unitPrice ||
          sl.mode !== "direct" ||
          sl.planId
        )
          fail("交付商品與原約定不符。");
      }
    }
    if (new Set(o.returnIds).size !== o.returnIds.length)
      fail("退貨來源重複。");
    for (const id of o.returnIds) {
      const r = s.refunds.find((r) => r.id === id);
      if (
        !r ||
        refundIds.has(id) ||
        r.preorderId !== o.id ||
        !o.fulfillments.some((f) => f.saleId === r.saleId) ||
        r.exchangeId
      )
        fail("預售退貨來源不正確。");
      refundIds.add(id);
      const sale = s.sales.find((x) => x.id === r.saleId)!;
      for (const l of r.lines) {
        const sl = sale.lines.find((x) => x.id === l.saleLineId);
        if (
          !sl ||
          BigInt(l.amount) !==
            BigInt(l.restockQuantity + l.damagedQuantity) * BigInt(sl.unitPrice)
        )
          fail("退貨折抵不符原單價。");
        if (l.returnLocationId) generalLocation(s, l.returnLocationId);
      }
    }
    validateOrderOperations(s, o);
    const summary = preorderSummary(s, o);
    if (
      summary.lines.some((l) => l.remainingQuantity < 0) ||
      summary.activeTotal < 0 ||
      summary.netDeliveredValue < 0
    )
      fail("訂單數量或已交付款項不一致。");
    let closed = "";
    for (const h of o.statusHistory) {
      if (
        typeof h.closed !== "boolean" ||
        h.closed === !!closed ||
        !Number.isFinite(Date.parse(h.at))
      )
        fail("結束歷史不連續。");
      text(h.reason, "狀態原因", 2000);
      closed = h.closed ? h.at : "";
    }
    if (closed !== o.closedAt) fail("結束狀態不符。");
    for (const op of o.operations) {
      if (
        !op.id ||
        ops.has(op.id) ||
        !op.resultId ||
        ![
          "create",
          "receipt",
          "refund",
          "receipt-reversal",
          "fulfill",
          "cancel",
          "return",
          "close",
          "reopen",
        ].includes(op.kind)
      )
        fail("操作識別重複或種類不正確。");
      ops.add(op.id);
    }
    if (
      !o.operations.some(
        (op) =>
          op.kind === "create" &&
          op.id === o.createOperationId &&
          op.resultId === o.id,
      )
    )
      fail("缺少訂單建立來源。");
  }
  for (const sale of s.sales)
    if (sale.preorderId && !saleIds.has(sale.id))
      fail("預售交付缺少訂單來源。");
  for (const r of s.refunds)
    if (r.preorderId && !refundIds.has(r.id)) fail("預售退貨缺少訂單來源。");
}
function validateOrderOperations(s: CatalogSnapshot, o: Preorder) {
  const used = new Set<string>(),
    quantities = new Map(
      o.lines.map((l) => [
        l.id,
        { ordered: l.quantity, delivered: 0, cancelled: 0 },
      ]),
    );
  let paid = 0n,
    delivered = 0n,
    cancelled = 0n,
    credited = 0n,
    status = 0;
  const total = BigInt(preorderSummary(s, o).total);
  let created = false;
  const claim = (id: string) => {
    if (used.has(id)) fail("訂單操作重複引用同一結果。");
    used.add(id);
  };
  for (const op of o.operations) {
    const q = op.request as any;
    if (!q || q.operationId !== op.id) fail("訂單操作原始識別不符。");
    if (op.kind === "create") {
      if (
        created ||
        op !== o.operations[0] ||
        op.resultId !== o.id ||
        q.name.trim() !== o.name ||
        q.customerReference.trim() !== o.customerReference ||
        q.notes.trim() !== o.notes ||
        !sameData(
          q.lines,
          o.lines.map(({ productId, quantity, unitPrice }) => ({
            productId,
            quantity,
            unitPrice,
          })),
        )
      )
        fail("建立訂單與原始確認不同。");
      created = true;
      continue;
    }
    if (!created) fail("訂單操作缺少建立來源。");
    if (["receipt", "refund", "receipt-reversal"].includes(op.kind)) {
      const r = o.payments.find((r) => r.id === op.resultId);
      if (!r || r.kind !== op.kind) fail("款項操作缺少結果。");
      claim(r.id);
      if (op.kind === "receipt-reversal") {
        if (q.paymentId !== r.reversesId || q.reason.trim() !== r.reason)
          fail("沖銷與原確認不符。");
        paid -= BigInt(r.amount);
      } else {
        if (
          q.amount !== r.amount ||
          q.partyId !== r.partyId ||
          at(q.occurredAt) !== r.occurredAt ||
          q.reason.trim() !== r.reason
        )
          fail("款項與原確認不符。");
        if (op.kind === "refund") {
          if (BigInt(r.amount) > paid) fail("實際退款超過當時實收。");
          if (
            BigInt(r.amount) > paid - (total - cancelled - credited) &&
            q.confirmedOutstanding !== true
          )
            fail("退款後未收款未經明確確認。");
          paid -= BigInt(r.amount);
        } else paid += BigInt(r.amount);
      }
    } else if (op.kind === "fulfill") {
      const f = o.fulfillments.find((f) => f.id === op.resultId),
        sale = f && s.sales.find((r) => r.id === f.saleId);
      if (
        !f ||
        !sale ||
        sale.locationId !== q.locationId ||
        sale.notes !== q.reason.trim() ||
        q.lines.length !== f.lines.length
      )
        fail("交付與原操作不符。");
      claim(f.id);
      if (new Set(f.lines.map((l) => l.orderLineId)).size !== f.lines.length)
        fail("交付明細重複。");
      for (let i = 0; i < f.lines.length; i++) {
        const l = f.lines[i]!,
          x = q.lines[i],
          v = quantities.get(l.orderLineId);
        if (
          !x ||
          !v ||
          x.orderLineId !== l.orderLineId ||
          x.quantity !== l.quantity ||
          !sameData(x.unitIds || [], sale.lines[i]!.unitIds || [])
        )
          fail("交付指定實物或數量不符原確認。");
        v.delivered += l.quantity;
      }
      delivered += BigInt(sale.total);
      if (paid < delivered - credited && q.allowUnpaidDelivery !== true)
        fail("未收齊交付缺少原操作確認。");
      if (f.allowUnpaidDelivery !== (q.allowUnpaidDelivery === true))
        fail("交付未收款確認與原操作不符。");
    } else if (op.kind === "cancel") {
      const c = o.cancellations.find((c) => c.id === op.resultId);
      if (!c || !sameData(c.lines, q.lines) || c.reason !== q.reason.trim())
        fail("取消與原操作不符。");
      claim(c.id);
      for (const l of c.lines) {
        quantities.get(l.orderLineId)!.cancelled += l.quantity;
        cancelled +=
          BigInt(l.quantity) *
          BigInt(o.lines.find((r) => r.id === l.orderLineId)!.unitPrice);
      }
    } else if (op.kind === "return") {
      const r = s.refunds.find((r) => r.id === op.resultId);
      if (
        !r ||
        !o.returnIds.includes(r.id) ||
        r.saleId !== q.saleId ||
        r.reason !== q.reason.trim() ||
        !sameData(
          r.lines.map(({ id, movementId, ...l }) => l),
          q.lines,
        )
      )
        fail("退貨與原確認不符。");
      claim(r.id);
      credited += BigInt(r.total);
    } else {
      const h = o.statusHistory[status++];
      if (
        op.resultId !== o.id ||
        !h ||
        h.closed !== (op.kind === "close") ||
        h.reason !== q.reason.trim()
      )
        fail("結束狀態與原確認不符。");
    }
    if (paid < 0n) fail("已收款不足以支付當時交付，或誤沖銷已使用款項。");
    for (const v of quantities.values())
      if (v.delivered + v.cancelled > v.ordered)
        fail("累計交付及取消超過原訂單。");
  }
  if (
    used.size !==
      o.payments.length +
        o.fulfillments.length +
        o.cancellations.length +
        o.returnIds.length ||
    status !== o.statusHistory.length
  )
    fail("訂單歷史包含未經操作確認的紀錄。");
}
