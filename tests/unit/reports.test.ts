import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import { putParty } from "../../src/domain/catalog/masterdata";
import { putProject, putEvent } from "../../src/domain/catalog/projects";
import {
  addLocation,
  addMovement,
} from "../../src/domain/inventory/operations";
import { reserveStock } from "../../src/domain/inventory/reservations";
import { registerPhysicalUnits } from "../../src/domain/inventory/units";
import { putSalePlan } from "../../src/domain/sales/plans";
import { completeSale, cancelSale } from "../../src/domain/sales/operations";
import { refundSale } from "../../src/domain/sales/refunds";
import { completeExchange } from "../../src/domain/sales/exchanges";
import { buildReportWorkbook } from "../../src/infrastructure/excel/report";
import { putCost } from "../../src/domain/finance/operations";
import { saveBatchCost } from "../../src/domain/finance/batch-costs";
import {
  queryOperationalReport,
  queryCashFlow,
  taipeiReportDate,
} from "../../src/domain/reports/operations";
import {
  prepareHandoff,
  applyActivityCommand,
  closeActivityPacket,
  mergeActivityPacket,
} from "../../src/domain/activity/operations";
import type { CatalogSnapshot } from "../../src/domain/models/catalog";
const at = "2026-11-04T12:00:00Z";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "報表測試",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: at,
  });
  const creator = putParty(s, { name: "作者甲", notes: "" }),
    other = putParty(s, { name: "作者乙", notes: "" });
  const project = putProject(s, { name: "企劃甲", description: "" });
  const event = putEvent(s, {
    name: "短期活動",
    startDate: "2026-11-04",
    endDate: "2026-11-04",
    venue: "",
    notes: "",
    projectIds: [project.id],
  });
  const p = putProduct(s, {
    name: "徽章",
    creatorId: creator.id,
    projectId: project.id,
    productType: "徽章",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const b = putProduct(s, {
    name: "吊飾",
    creatorId: other.id,
    productType: "吊飾",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const location = addLocation(s, "攤位");
  for (const product of [p, b])
    addMovement(s, {
      productId: product.id,
      kind: "receipt",
      quantity: 12,
      fromLocationId: "",
      toLocationId: location.id,
      reason: "製作",
    });
  return { s, p, b, creator, other, project, event, location };
}
function sell(
  x: ReturnType<typeof fixture>,
  price = 100,
  productId = x.p.id,
  quantity = 1,
) {
  const sale = completeSale(x.s, {
    operationId: crypto.randomUUID(),
    locationId: x.location.id,
    eventId: x.event.id,
    collectorId: x.creator.id,
    cashReceived: price * quantity,
    notes: "",
    lines: [{ productId, quantity, unitPrice: price, mode: "direct" }],
  });
  sale.createdAt = at;
  return sale;
}
function credit(
  x: ReturnType<typeof fixture>,
  old: ReturnType<typeof sell>,
  newPrice: number,
) {
  return completeExchange(x.s, {
    operationId: crypto.randomUUID(),
    saleId: old.id,
    reason: "換購",
    refundLines: [
      {
        saleLineId: old.lines[0]!.id,
        amount: 100,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: x.location.id,
      },
    ],
    replacement: {
      locationId: x.location.id,
      eventId: x.event.id,
      collectorId: x.other.id,
      notes: "",
      lines: [
        { productId: x.b.id, quantity: 1, unitPrice: newPrice, mode: "direct" },
      ],
    },
    actualDifference: newPrice - 100,
    confirmed: true,
  });
}
it("exports queried draw and direct sale modes with their correct labels", async () => {
  const x = fixture();
  const plan = putSalePlan(x.s, {
    name: "抽選池",
    mode: "draw",
    unitPrice: 100,
    productIds: [x.p.id],
    eventIds: [],
  });
  completeSale(x.s, {
    operationId: crypto.randomUUID(),
    locationId: x.location.id,
    eventId: x.event.id,
    collectorId: x.creator.id,
    cashReceived: 100,
    notes: "",
    lines: [
      {
        productId: x.p.id,
        quantity: 1,
        unitPrice: 100,
        mode: "draw",
        planId: plan.id,
        planVersion: plan.version,
      },
    ],
  });
  sell(x);
  const report = queryOperationalReport(x.s, { groupBy: "product" }, at);
  const book = await buildReportWorkbook(report, queryCashFlow(x.s, {}, at));
  const sales = book.getWorksheet("03_銷售明細")!;
  expect(sales.getRows(2, 2)!.map((r) => r.getCell(7).value).sort()).toEqual([
    "抽選",
    "指定",
  ]);
});
it("groups mixed creator invoice by sale snapshots without splitting invoice cash", () => {
  const x = fixture();
  const sale = completeSale(x.s, {
    operationId: crypto.randomUUID(),
    locationId: x.location.id,
    eventId: x.event.id,
    collectorId: x.creator.id,
    cashReceived: 500,
    notes: "",
    lines: [
      { productId: x.p.id, quantity: 1, unitPrice: 100, mode: "direct" },
      { productId: x.b.id, quantity: 2, unitPrice: 150, mode: "direct" },
    ],
  });
  sale.createdAt = at;
  const report = queryOperationalReport(x.s, { groupBy: "creator" }, at);
  expect(report.totals.netRevenue).toBe("400");
  expect(report.groups.map((g) => g.netRevenue).sort()).toEqual(["100", "300"]);
  const cash = queryCashFlow(x.s, {}, at);
  expect(cash.entries).toHaveLength(1);
  expect(cash.net).toBe("400");
  expect(
    queryOperationalReport(
      x.s,
      { groupBy: "creator", creatorId: x.creator.id },
      at,
    ).totals.netRevenue,
  ).toBe("100");
  expect(queryCashFlow(x.s, {}, at).net).toBe("400");
});
it("uses immutable creator but explicitly current product project and keeps archived sources", () => {
  const x = fixture();
  sell(x);
  const later = putProject(x.s, { name: "新企劃", description: "" });
  x.p.creatorId = x.other.id;
  x.p.projectId = later.id;
  x.p.archived = true;
  x.creator.name = "改名";
  x.creator.archived = true;
  const report = queryOperationalReport(x.s, { groupBy: "creator" }, at);
  expect(report.groups[0]!.name).toBe("作者甲");
  expect(report.groups[0]!.id).toBe(x.creator.id);
  expect(
    queryOperationalReport(x.s, { groupBy: "project", projectId: later.id }, at)
      .totals.netRevenue,
  ).toBe("100");
  expect(report.warnings.join()).toContain("目前歸屬");
  expect(report.choices.creators.some((c) => c.label.includes("已封存"))).toBe(
    true,
  );
});
it("does not infer missing historical creator from current product", () => {
  const x = fixture(),
    sale = sell(x);
  delete sale.lines[0]!.attribution;
  const report = queryOperationalReport(
    x.s,
    { groupBy: "creator", creatorId: "" },
    at,
  );
  expect(report.groups[0]!.name).toBe("未記錄創作者");
  expect(report.totals.netRevenue).toBe("100");
  expect(
    queryOperationalReport(
      x.s,
      { groupBy: "creator", creatorId: x.creator.id },
      at,
    ).lines,
  ).toHaveLength(0);
});
it("Taiwan date cohort includes later refunds while cash window uses each timestamp", () => {
  const x = fixture(),
    sale = sell(x);
  sale.createdAt = "2026-11-03T16:00:00Z";
  const refund = refundSale(x.s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "次日退款",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 30,
        restockQuantity: 0,
        damagedQuantity: 0,
        returnLocationId: "",
      },
    ],
  });
  refund.createdAt = "2026-11-04T16:00:00Z";
  const f = { fromDate: "2026-11-04", toDate: "2026-11-04" };
  expect(taipeiReportDate(sale.createdAt)).toBe("2026-11-04");
  expect(
    queryOperationalReport(x.s, { ...f, groupBy: "product" }, at).totals
      .netRevenue,
  ).toBe("70");
  expect(queryCashFlow(x.s, f, at).net).toBe("100");
  const next = queryCashFlow(
    x.s,
    { fromDate: "2026-11-05", toDate: "2026-11-05" },
    at,
  );
  expect(next.net).toBe("-30");
  expect(next.unknownPayerCount).toBe(1);
  expect(next.entries[0]!.collectorId).toBe("");
});
it("cancellation keeps original gross and subtracts refund once at cancellation time", () => {
  const x = fixture(),
    sale = sell(x);
  cancelSale(x.s, sale.id, "取消");
  sale.cancelledAt = "2026-11-05T00:00:00Z";
  const r = queryOperationalReport(x.s, { groupBy: "product" }, at);
  expect(r.totals.gross).toBe("100");
  expect(r.totals.refunded).toBe("100");
  expect(r.totals.netRevenue).toBe("0");
  expect(r.totals.restockQuantity).toBe("1");
  const cash = queryCashFlow(x.s, {}, at);
  expect(cash.receipts).toBe("100");
  expect(cash.payouts).toBe("100");
  expect(cash.net).toBe("0");
  expect(cash.entries).toHaveLength(2);
});
for (const price of [150, 50, 100])
  it(`exchange ${price - 100} cash difference does not count credit as real refund`, () => {
    const x = fixture(),
      old = sell(x);
    const e = credit(x, old, price);
    const r = queryOperationalReport(x.s, { groupBy: "product" }, at);
    expect(r.totals.gross).toBe(String(100 + price));
    expect(r.totals.refunded).toBe("100");
    expect(r.totals.netRevenue).toBe(String(price));
    const cash = queryCashFlow(x.s, {}, at);
    expect(cash.entries).toHaveLength(2);
    expect(cash.net).toBe(String(price));
    expect(cash.entries.find((r) => r.kind === "exchange")!.amount).toBe(
      String(e.actualDifference),
    );
    expect(cash.entries.some((r) => r.id === "refund:" + e.refundId)).toBe(
      false,
    );
  });
it("later ordinary refund on replacement is real cash and credit remains excluded", () => {
  const x = fixture(),
    old = sell(x),
    e = credit(x, old, 150),
    replacement = x.s.sales.find((s) => s.id === e.replacementSaleId)!;
  refundSale(x.s, {
    operationId: crypto.randomUUID(),
    saleId: replacement.id,
    reason: "再退",
    lines: [
      {
        saleLineId: replacement.lines[0]!.id,
        amount: 20,
        restockQuantity: 0,
        damagedQuantity: 0,
        returnLocationId: "",
      },
    ],
  });
  expect(
    queryOperationalReport(x.s, { groupBy: "product" }, at).totals.netRevenue,
  ).toBe("130");
  expect(queryCashFlow(x.s, {}, at).net).toBe("130");
});
function knownCost(
  s: CatalogSnapshot,
  productId: string,
  receiptId: string,
  quantity: number,
  total: number,
) {
  putCost(s, {
    name: "精確批次",
    productId,
    quantity,
    estimatedPrint: null,
    actualPrint: total,
    artworkAllocated: 0,
    otherCost: 0,
    unitSalePrice: null,
    paidById: "",
    burdenPartyId: "",
    notes: "",
  });
  saveBatchCost(s, receiptId, s.costs.at(-1)!.id, "明確連結");
}
it("sums exact 100/3 before formatting group and total amounts", () => {
  const x = fixture();
  const p = putProduct(x.s, {
    name: "三件批次",
    productType: "",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const receipt = addMovement(x.s, {
    productId: p.id,
    kind: "receipt",
    quantity: 3,
    fromLocationId: "",
    toLocationId: x.location.id,
    reason: "三件",
  });
  knownCost(x.s, p.id, receipt.id, 3, 100);
  for (let i = 0; i < 3; i++) sell(x, 100, p.id);
  const report = queryOperationalReport(x.s, { groupBy: "product" }, at);
  expect(report.lines.map((l) => l.netKnownCost)).toEqual([
    "33.3333",
    "33.3333",
    "33.3333",
  ]);
  expect(report.totals.netKnownCost).toBe("100.0000");
  expect(report.groups[0]!.netKnownCost).toBe("100.0000");
  expect(report.totals.revenueLessCost).toBe("200.0000");
});
it("unknown costs keep known subtotal but never fabricate full difference", () => {
  const x = fixture();
  knownCost(x.s, x.p.id, x.s.movements[0]!.id, 12, 120);
  sell(x);
  sell(x, 100, x.b.id);
  const report = queryOperationalReport(x.s, { groupBy: "product" }, at);
  expect(report.totals.netKnownCost).toBe("10.0000");
  expect(report.totals.unknownCostQuantity).toBe("1");
  expect(report.totals.revenueLessCost).toBeNull();
});
it("physical returns and damaged returns have separate quantities and cost treatment", () => {
  const x = fixture();
  knownCost(x.s, x.p.id, x.s.movements[0]!.id, 12, 120);
  const sale = sell(x, 100, x.p.id, 3);
  refundSale(x.s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "一件回庫一件損壞",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 150,
        restockQuantity: 1,
        damagedQuantity: 1,
        returnLocationId: x.location.id,
      },
    ],
  });
  const r = queryOperationalReport(x.s, { groupBy: "product" }, at).totals;
  expect(r.restockQuantity).toBe("1");
  expect(r.damagedQuantity).toBe("1");
  expect(r.retainedQuantity).toBe("1");
  expect(r.netKnownCost).toBe("20.0000");
  expect(r.damagedKnownCost).toBe("10.0000");
  expect(r.netRevenue).toBe("150");
});
it("reports current reserved and marked physical quantities without date/event stock inference or writes", () => {
  const x = fixture();
  registerPhysicalUnits(x.s, {
    productId: x.p.id,
    locationId: x.location.id,
    batchId: x.s.movements[0]!.id,
    labels: ["親簽1", "親簽2"],
  });
  const plan = putSalePlan(x.s, {
    name: "池",
    mode: "draw",
    unitPrice: 100,
    productIds: [x.p.id],
    eventIds: [],
  });
  reserveStock(x.s, {
    planId: plan.id,
    productId: x.p.id,
    locationId: x.location.id,
    quantity: 3,
    reason: "專用",
  });
  const before = JSON.stringify(x.s);
  const r = queryOperationalReport(
    x.s,
    {
      groupBy: "product",
      fromDate: "2020-01-01",
      toDate: "2020-01-01",
      eventId: "其他活動",
    },
    at,
  );
  expect(r.lines).toHaveLength(0);
  expect(r.currentStock.find((r) => r.productId === x.p.id)).toMatchObject({
    quantity: "12",
    reserved: "3",
    available: "9",
    markedUnits: "2",
  });
  queryCashFlow(x.s, {}, at);
  expect(JSON.stringify(x.s)).toBe(before);
});
it("unmerged activity sales are excluded and final merge appears once", () => {
  const x = fixture();
  const { packet } = prepareHandoff(x.s, {
    name: "交接",
    eventId: x.event.id,
    sourceLocationId: x.location.id,
    lines: [{ productId: x.p.id, quantity: 2 }],
    planIds: [],
    collectorIds: [x.creator.id],
  });
  let p = applyActivityCommand(packet, {
    type: "sale",
    input: {
      operationId: crypto.randomUUID(),
      locationId: packet.locationId,
      eventId: x.event.id,
      collectorId: x.creator.id,
      cashReceived: 100,
      notes: "",
      lines: [
        { productId: x.p.id, quantity: 1, unitPrice: 100, mode: "direct" },
      ],
    },
  });
  expect(
    queryOperationalReport(x.s, { groupBy: "event" }, at).totals.netRevenue,
  ).toBe("0");
  p = closeActivityPacket(
    p,
    p.snapshot.products.map((product) => ({
      productId: product.id,
      actual: 1,
      reason: "",
    })),
    "結案",
  );
  mergeActivityPacket(x.s, p, {});
  mergeActivityPacket(x.s, p, {});
  expect(
    queryOperationalReport(x.s, { groupBy: "event" }, at).totals.netRevenue,
  ).toBe("100");
  expect(queryCashFlow(x.s, {}, at).net).toBe("100");
});
it("rejects invalid dates and reversed ranges without changing source", () => {
  const x = fixture();
  expect(() =>
    queryOperationalReport(x.s, { groupBy: "product", fromDate: "2026-02-30" }),
  ).toThrow("日期");
  expect(() =>
    queryCashFlow(x.s, { fromDate: "2026-11-05", toDate: "2026-11-04" }),
  ).toThrow("開始日期");
  expect(() =>
    queryOperationalReport(x.s, { groupBy: "wrong" as "product" }),
  ).toThrow("分組");
});
it("aggregate integer money stays exact beyond one safe-number total", () => {
  const x = fixture();
  sell(x, Number.MAX_SAFE_INTEGER);
  sell(x, Number.MAX_SAFE_INTEGER);
  const expected = (BigInt(Number.MAX_SAFE_INTEGER) * 2n).toString();
  expect(
    queryOperationalReport(x.s, { groupBy: "product" }, at).totals.netRevenue,
  ).toBe(expected);
  expect(queryCashFlow(x.s, {}, at).net).toBe(expected);
});
it("selected special-unit return uses original unit batch rather than next FIFO cost", () => {
  const x = fixture();
  const receiptA = x.s.movements[0]!;
  knownCost(x.s, x.p.id, receiptA.id, 12, 120);
  const receiptB = addMovement(x.s, {
    productId: x.p.id,
    kind: "receipt",
    quantity: 1,
    fromLocationId: "",
    toLocationId: x.location.id,
    reason: "另一成本單件",
  });
  knownCost(x.s, x.p.id, receiptB.id, 1, 50);
  const [u] = registerPhysicalUnits(x.s, {
    productId: x.p.id,
    locationId: x.location.id,
    batchId: receiptB.id,
    labels: ["唯一編號"],
  });
  const sale = completeSale(x.s, {
    operationId: crypto.randomUUID(),
    locationId: x.location.id,
    eventId: x.event.id,
    collectorId: x.creator.id,
    cashReceived: 100,
    notes: "",
    lines: [
      {
        productId: x.p.id,
        quantity: 1,
        unitPrice: 100,
        mode: "direct",
        unitIds: [u!.id],
      },
    ],
  });
  let r = queryOperationalReport(x.s, { groupBy: "product" }, at);
  expect(r.totals.netKnownCost).toBe("50.0000");
  refundSale(x.s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "原件退回",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 100,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: x.location.id,
        restockUnitIds: [u!.id],
      },
    ],
  });
  r = queryOperationalReport(x.s, { groupBy: "product" }, at);
  expect(r.totals.netKnownCost).toBe("0.0000");
  expect(r.totals.netRevenue).toBe("0");
});
