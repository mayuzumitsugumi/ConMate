import "fake-indexeddb/auto";
import { it, expect, afterEach } from "vitest";
import {
  emptyCatalog,
  catalogRepository,
} from "../../src/infrastructure/storage/catalog";
import { database } from "../../src/infrastructure/storage/workspaces";
import { putProduct } from "../../src/domain/catalog/operations";
import { putEvent } from "../../src/domain/catalog/projects";
import {
  addLocation,
  addMovement,
  balance,
} from "../../src/domain/inventory/operations";
import {
  registerPhysicalUnits,
  unitStates,
} from "../../src/domain/inventory/units";
import { reserveStock } from "../../src/domain/inventory/reservations";
import { putSalePlan } from "../../src/domain/sales/plans";
import {
  prepareHandoff,
  validateActivityPacket,
} from "../../src/domain/activity/operations";
import { batchCostReport } from "../../src/domain/finance/batch-costs";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import {
  queryCashFlow,
  queryOperationalReport,
} from "../../src/domain/reports/operations";
import * as pre from "../../src/domain/preorder/operations";
const op = () => crypto.randomUUID();
const time = () => new Date(Date.now() - 60000).toISOString();
function setup(stock = 3) {
  const s = emptyCatalog({
    id: op(),
    name: "虛構預售",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const product = putProduct(s, {
      name: "徽章",
      productType: "徽章",
      specification: "",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    }),
    location = addLocation(s, "保管處");
  const receipt = stock
    ? addMovement(s, {
        productId: product.id,
        kind: "receipt",
        quantity: stock,
        fromLocationId: "",
        toLocationId: location.id,
        reason: "實際製作到貨",
      })
    : null;
  const request = {
    operationId: op(),
    name: "訂單",
    customerReference: "僅測試用顧客代稱",
    notes: "",
    lines: [{ productId: product.id, quantity: 3, unitPrice: 100 }],
  };
  const order = pre.createPreorder(s, request);
  return {
    s,
    product,
    location,
    receipt,
    request,
    orderId: order.id,
    lineId: order.lines[0]!.id,
  };
}
function order(x: ReturnType<typeof setup>) {
  return x.s.preorders.find((o) => o.id === x.orderId)!;
}
function summary(x: ReturnType<typeof setup>) {
  return pre.preorderSummary(x.s, order(x));
}
function receive(
  x: ReturnType<typeof setup>,
  amount = 300,
  operationId = op(),
) {
  return pre.receivePreorder(x.s, x.orderId, {
    operationId,
    amount,
    partyId: "",
    occurredAt: time(),
    reason: "實際收到款項",
  });
}
function deliver(
  x: ReturnType<typeof setup>,
  quantity = 1,
  unitIds?: string[],
) {
  return pre.fulfillPreorder(x.s, x.orderId, {
    operationId: op(),
    locationId: x.location.id,
    lines: [
      { orderLineId: x.lineId, quantity, ...(unitIds ? { unitIds } : {}) },
    ],
    reason: "確認實物已交付",
  });
}
function cancel(x: ReturnType<typeof setup>, quantity = 1) {
  return pre.cancelPreorder(x.s, x.orderId, {
    operationId: op(),
    lines: [{ orderLineId: x.lineId, quantity }],
    reason: "顧客取消未交付商品",
  });
}
afterEach(async () => {
  await database.catalogs.clear();
  await database.workspaces.clear();
});
it("creating an order requires no stock and posts neither receipt, sale nor inventory", () => {
  const x = setup(0);
  expect(x.s.movements).toHaveLength(0);
  expect(x.s.sales).toHaveLength(0);
  expect(order(x).payments).toHaveLength(0);
  expect(summary(x)).toMatchObject({
    total: 300,
    netPaid: 0,
    received: 0,
    balance: 300,
    deliveredValue: 0,
  });
  expect(validateRestoreSnapshot(x.s)).toEqual(x.s);
});
it("prepayment cash is recorded once while partial fulfillment recognizes only delivered revenue", () => {
  const x = setup();
  receive(x, 100);
  receive(x, 100);
  expect(queryOperationalReport(x.s, { groupBy: "product" }).totals.gross).toBe(
    "0",
  );
  expect(queryCashFlow(x.s, {}).net).toBe("200");
  deliver(x, 1);
  expect(x.s.sales[0]).toMatchObject({
    preorderId: x.orderId,
    total: 100,
    cashReceived: 0,
    change: 0,
  });
  expect(balance(x.s, x.product.id, x.location.id)).toBe(2);
  expect(summary(x)).toMatchObject({
    balance: 100,
    netDeliveredValue: 100,
    netPaid: 200,
  });
  expect(
    queryOperationalReport(x.s, { groupBy: "product" }).totals.netRevenue,
  ).toBe("100");
  expect(queryCashFlow(x.s, {}).net).toBe("200");
  expect(batchCostReport(x.s).sales[0]!.unknownQuantity).toBe(1);
});
it("receipts and creating an order are idempotent and reject conflicting retries", () => {
  const x = setup(),
    id = op(),
    request = {
      operationId: id,
      amount: 100,
      partyId: "",
      occurredAt: time(),
      reason: "訂金",
    };
  expect(pre.createPreorder(x.s, x.request).id).toBe(x.orderId);
  expect(x.s.preorders).toHaveLength(1);
  const a = pre.receivePreorder(x.s, x.orderId, request);
  expect(pre.receivePreorder(x.s, x.orderId, request)).toBe(a);
  expect(summary(x).netPaid).toBe(100);
  const before = JSON.stringify(x.s);
  expect(() =>
    pre.receivePreorder(x.s, x.orderId, { ...request, amount: 200 }),
  ).toThrow();
  expect(JSON.stringify(x.s)).toBe(before);
});
it("fulfillment checks both actually paid funds and stock without partial changes", () => {
  const x = setup();
  receive(x, 50);
  const before = JSON.stringify(x.s);
  expect(() => deliver(x)).toThrow(/尚有未收款/);
  expect(JSON.stringify(x.s)).toBe(before);
  const y = setup(0);
  receive(y);
  const original = JSON.stringify(y.s);
  expect(() => deliver(y)).toThrow();
  expect(JSON.stringify(y.s)).toBe(original);
});
it("an order does not consume another sale plan reservation", () => {
  const x = setup(),
    plan = putSalePlan(x.s, {
      name: "專用抽選",
      mode: "draw",
      unitPrice: 100,
      productIds: [x.product.id],
      eventIds: [],
    });
  reserveStock(x.s, {
    planId: plan.id,
    productId: x.product.id,
    locationId: x.location.id,
    quantity: 3,
    reason: "只供抽選",
  });
  receive(x);
  const before = JSON.stringify(x.s);
  expect(() => deliver(x)).toThrow(/預留|庫存/);
  expect(JSON.stringify(x.s)).toBe(before);
});
it("canceling only undelivered goods does not invent refunds; cash refund is separately confirmed and capped", () => {
  const x = setup();
  receive(x, 200);
  deliver(x);
  cancel(x, 2);
  expect(summary(x)).toMatchObject({
    activeTotal: 100,
    netPaid: 200,
    refundable: 200,
  });
  expect(queryCashFlow(x.s, {}).net).toBe("200");
  const request = {
    operationId: op(),
    amount: 100,
    partyId: "",
    occurredAt: time(),
    reason: "實際退還取消部分",
  };
  pre.refundPreorderPayment(x.s, x.orderId, request);
  pre.refundPreorderPayment(x.s, x.orderId, request);
  expect(summary(x)).toMatchObject({ netPaid: 100, refundable: 100 });
  expect(queryCashFlow(x.s, {}).net).toBe("100");
  const before = JSON.stringify(x.s);
  expect(() =>
    pre.refundPreorderPayment(x.s, x.orderId, {
      ...request,
      operationId: op(),
      amount: 1,
    }),
  ).toThrow();
  expect(() => cancel(x, 1)).toThrow();
  expect(JSON.stringify(x.s)).toBe(before);
});
it("receipt mistake reversal reveals unpaid delivery but cannot erase money already actually refunded", () => {
  const x = setup(),
    paymentId = receive(x);
  deliver(x);
  pre.reversePreorderReceipt(x.s, x.orderId, {
    operationId: op(),
    paymentId,
    reason: "原收款其實誤記，保留已交貨與待收",
  });
  expect(summary(x)).toMatchObject({
    netPaid: 0,
    received: 0,
    balance: 300,
    netDeliveredValue: 100,
  });
  expect(x.s.sales).toHaveLength(1);
  expect(balance(x.s, x.product.id, x.location.id)).toBe(2);
  expect(queryCashFlow(x.s, {}).net).toBe("0");
  const y = setup(),
    p = receive(y, 100);
  cancel(y, 3);
  pre.refundPreorderPayment(y.s, y.orderId, {
    operationId: op(),
    amount: 100,
    partyId: "",
    occurredAt: time(),
    reason: "已退",
  });
  const original = JSON.stringify(y.s);
  expect(() =>
    pre.reversePreorderReceipt(y.s, y.orderId, {
      operationId: op(),
      paymentId: p,
      reason: "不可重複減款",
    }),
  ).toThrow();
  expect(JSON.stringify(y.s)).toBe(original);
});
it("specified physical units return to their original source; goods credit is not another cash refund", () => {
  const x = setup();
  const units = registerPhysicalUnits(x.s, {
    productId: x.product.id,
    locationId: x.location.id,
    batchId: x.receipt!.id,
    labels: ["親簽 A", "親簽 B"],
  });
  receive(x);
  deliver(x, 1, [units[1]!.id]);
  const sale = x.s.sales[0]!,
    line = sale.lines[0]!;
  pre.returnPreorderGoods(x.s, x.orderId, {
    operationId: op(),
    saleId: sale.id,
    reason: "退回原件",
    lines: [
      {
        saleLineId: line.id,
        amount: 100,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: x.location.id,
        restockUnitIds: [units[1]!.id],
        damagedUnitIds: [],
      },
    ],
  });
  expect(unitStates(x.s).find((u) => u.id === units[1]!.id)).toMatchObject({
    state: "available",
    locationId: x.location.id,
  });
  expect(queryCashFlow(x.s, {}).net).toBe("300");
  expect(summary(x)).toMatchObject({
    returnCredit: 100,
    netDeliveredValue: 0,
    netPaid: 300,
    refundable: 300,
  });
  expect(validateRestoreSnapshot(x.s)).toEqual(x.s);
});
it("damaged returns reduce fulfilled value but do not add saleable stock or assume loss burden", () => {
  const x = setup();
  receive(x);
  deliver(x);
  const sale = x.s.sales[0]!;
  pre.returnPreorderGoods(x.s, x.orderId, {
    operationId: op(),
    saleId: sale.id,
    reason: "不可售退貨",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 100,
        restockQuantity: 0,
        damagedQuantity: 1,
        returnLocationId: "",
      },
    ],
  });
  expect(balance(x.s, x.product.id, x.location.id)).toBe(2);
  expect(summary(x)).toMatchObject({ netDeliveredValue: 0, refundable: 300 });
  expect(queryCashFlow(x.s, {}).net).toBe("300");
});
it("closing is allowed with outstanding fulfillment or money and explicit reopen preserves history", () => {
  const x = setup(0);
  pre.closePreorder(x.s, x.orderId, {
    operationId: op(),
    reason: "暫時收尾，保留待交付",
  });
  expect(order(x).closedAt).toBeTruthy();
  expect(() => receive(x)).toThrow(/結束/);
  pre.reopenPreorder(x.s, x.orderId, { operationId: op(), reason: "繼續處理" });
  receive(x, 50);
  expect(order(x).statusHistory.map((h) => h.closed)).toEqual([true, false]);
  expect(summary(x).netPaid).toBe(50);
});
it("the repository transaction rolls back an earlier payment if later fulfillment fails", async () => {
  const x = setup(0);
  await database.workspaces.add(x.s.workspace);
  await database.catalogs.add(x.s);
  const before = await catalogRepository.read(x.s.workspaceId);
  await expect(
    catalogRepository.change(x.s.workspaceId, x.s.revision, (n) => {
      pre.receivePreorder(n, x.orderId, {
        operationId: op(),
        amount: 300,
        partyId: "",
        occurredAt: time(),
        reason: "交易內測試",
      });
      pre.fulfillPreorder(n, x.orderId, {
        operationId: op(),
        locationId: x.location.id,
        lines: [{ orderLineId: x.lineId, quantity: 1 }],
        reason: "無庫存應失敗",
      });
    }),
  ).rejects.toThrow();
  expect(await catalogRepository.read(x.s.workspaceId)).toEqual(before);
});
it("activity snapshots do not contain unrelated preorder customer references or payment history", () => {
  const x = setup();
  receive(x, 100);
  const event = putEvent(x.s, {
    name: "短期活動",
    startDate: "2026-11-06",
    endDate: "2026-11-07",
    venue: "測試",
    notes: "",
    projectIds: [],
  });
  const { packet } = prepareHandoff(x.s, {
    name: "活動交接",
    eventId: event.id,
    sourceLocationId: x.location.id,
    lines: [{ productId: x.product.id, quantity: 1 }],
    planIds: [],
    collectorIds: [],
  });
  expect(packet.baseline.preorders).toEqual([]);
  expect(packet.snapshot.preorders).toEqual([]);
  expect(JSON.stringify(packet)).not.toContain(x.request.customerReference);
  const forged = structuredClone(packet);
  forged.snapshot.preorders = x.s.preorders;
  expect(() => validateActivityPacket(forged)).toThrow(/私人|活動/);
});

it("explicit unpaid fulfillment records real delivery without inventing payment or blocking closure", () => {
  const x = setup();
  pre.fulfillPreorder(x.s, x.orderId, {
    operationId: op(),
    locationId: x.location.id,
    lines: [{ orderLineId: x.lineId, quantity: 1 }],
    reason: "實物已先交付，款項另待收",
    allowUnpaidDelivery: true,
  });
  expect(summary(x)).toMatchObject({
    netPaid: 0,
    received: 0,
    balance: 300,
    netDeliveredValue: 100,
  });
  expect(queryCashFlow(x.s, {}).net).toBe("0");
  pre.closePreorder(x.s, x.orderId, {
    operationId: op(),
    reason: "保留待交與未收事項",
  });
  expect(order(x).closedAt).toBeTruthy();
  expect(validateRestoreSnapshot(x.s)).toEqual(x.s);
});
it("actual refund may leave an outstanding balance only with explicit confirmation, without canceling goods", () => {
  const x = setup();
  receive(x, 100);
  const request = {
    operationId: op(),
    amount: 50,
    partyId: "",
    occurredAt: time(),
    reason: "實際退回部分款但訂單維持",
  };
  const before = JSON.stringify(x.s);
  expect(() => pre.refundPreorderPayment(x.s, x.orderId, request)).toThrow(
    /確認/,
  );
  expect(JSON.stringify(x.s)).toBe(before);
  pre.refundPreorderPayment(x.s, x.orderId, {
    ...request,
    confirmedOutstanding: true,
  });
  expect(summary(x)).toMatchObject({
    netPaid: 50,
    balance: 250,
    activeTotal: 300,
  });
  expect(order(x).cancellations).toHaveLength(0);
  expect(queryCashFlow(x.s, {}).net).toBe("50");
});

it("restore rejects orphaned fulfillment and forged payment values instead of changing real receipts", () => {
  const x = setup();
  receive(x);
  deliver(x);
  const orphan = structuredClone(x.s);
  orphan.preorders[0]!.fulfillments = [];
  expect(() => validateRestoreSnapshot(orphan)).toThrow();
  const forged = structuredClone(x.s);
  forged.preorders[0]!.payments[0]!.amount += 1;
  expect(() => validateRestoreSnapshot(forged)).toThrow();
  const original = structuredClone(x.s);
  expect(validateRestoreSnapshot(original)).toEqual(x.s);
});

it("allows an optional blank customer reference without storing private contact information", () => {
  const x = setup(0);
  const o = pre.createPreorder(x.s, {
    ...x.request,
    operationId: op(),
    customerReference: "",
  });
  expect(o.customerReference).toBe("");
  expect(validateRestoreSnapshot(x.s).preorders).toHaveLength(2);
});
it("preserves the original acknowledgment for an actual refund leaving outstanding balance", () => {
  const x = setup();
  receive(x, 100);
  pre.refundPreorderPayment(x.s, x.orderId, {
    operationId: op(),
    amount: 50,
    partyId: "",
    occurredAt: time(),
    reason: "實際退款但訂單仍有效",
    confirmedOutstanding: true,
  });
  const forged = structuredClone(x.s);
  forged.preorders[0]!.payments.find(
    (p) => p.kind === "refund",
  )!.confirmedOutstanding = false;
  expect(() => validateRestoreSnapshot(forged)).toThrow(/原確認/);
  expect(summary(x).balance).toBe(250);
});
