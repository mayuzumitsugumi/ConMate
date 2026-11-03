import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import Dexie from "dexie";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { ConMateDatabase } from "../../src/infrastructure/storage/workspaces";
import { putProduct } from "../../src/domain/catalog/operations";
import { putParty } from "../../src/domain/catalog/masterdata";
import {
  addLocation,
  addMovement,
  reverseMovement,
} from "../../src/domain/inventory/operations";
import { completeSale, cancelSale } from "../../src/domain/sales/operations";
import { refundSale } from "../../src/domain/sales/refunds";
import { putCost } from "../../src/domain/finance/operations";
import {
  saveBatchCost,
  batchCostReport,
} from "../../src/domain/finance/batch-costs";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
const product = {
  name: "徽章",
  productType: "徽章",
  specification: "",
  artwork: "",
  notes: "",
  tagIds: [],
  customValues: {},
};
function setup() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "成本",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const p = putProduct(s, product),
    party = putParty(s, { name: "甲", notes: "" }),
    l = addLocation(s, "家中");
  return { s, p, l, party };
}
function receipt(x: ReturnType<typeof setup>, q = 3) {
  return addMovement(x.s, {
    productId: x.p.id,
    kind: "receipt",
    quantity: q,
    fromLocationId: "",
    toLocationId: x.l.id,
    reason: "製作",
  });
}
function cost(x: ReturnType<typeof setup>, q = 3, amount: number | null = 100) {
  putCost(x.s, {
    name: "批次成本",
    productId: x.p.id,
    quantity: q,
    estimatedPrint: null,
    actualPrint: amount,
    artworkAllocated: 0,
    otherCost: 0,
    unitSalePrice: 100,
    paidById: "",
    burdenPartyId: "",
    notes: "",
  });
  return x.s.costs.at(-1)!;
}
function sell(x: ReturnType<typeof setup>, q = 1, loc = x.l.id) {
  return completeSale(x.s, {
    operationId: crypto.randomUUID(),
    locationId: loc,
    eventId: "",
    collectorId: x.party.id,
    cashReceived: q * 100,
    notes: "",
    lines: [{ productId: x.p.id, mode: "direct", quantity: q, unitPrice: 100 }],
  });
}
it("FIFO can allocate different source costs without averaging", () => {
  const x = setup(),
    a = receipt(x, 2),
    ca = cost(x, 2, 100);
  saveBatchCost(x.s, a.id, ca.id, "已知第一批");
  const b = receipt(x, 3),
    cb = cost(x, 3, 300);
  saveBatchCost(x.s, b.id, cb.id, "第二批");
  sell(x, 3);
  const r = batchCostReport(x.s);
  expect(r.sales[0].knownCost).toBe("200.0000");
  expect(r.sales[0].margin).toBe("100.0000");
  expect(r.stock[0].value).toBe("200.0000");
  expect(validateRestoreSnapshot(x.s)).toEqual(x.s);
});
it("linking a cost after selling never fills historical unknowns", () => {
  const x = setup(),
    a = receipt(x);
  sell(x);
  const c = cost(x);
  saveBatchCost(x.s, a.id, c.id, "之後生效");
  sell(x);
  const r = batchCostReport(x.s);
  expect(r.sales[0].unknownQuantity).toBe(1);
  expect(r.sales[0].margin).toBeNull();
  expect(r.sales[1].knownCost).toBe("33.3333");
});
it("new cost version and current cost edits leave past sale basis unchanged", () => {
  const x = setup(),
    a = receipt(x),
    c = cost(x);
  saveBatchCost(x.s, a.id, c.id, "初始");
  sell(x);
  c.actualPrint = 300;
  expect(batchCostReport(x.s).sales[0].knownCost).toBe("33.3333");
  saveBatchCost(x.s, a.id, c.id, "改版");
  sell(x);
  const r = batchCostReport(x.s);
  expect(r.sales[0].knownCost).toBe("33.3333");
  expect(r.sales[1].knownCost).toBe("100.0000");
  expect(validateRestoreSnapshot(x.s)).toEqual(x.s);
});
it("known cost fractions sum before display rounding", () => {
  const x = setup(),
    a = receipt(x),
    c = cost(x);
  saveBatchCost(x.s, a.id, c.id, "初始");
  sell(x);
  sell(x);
  sell(x);
  expect(batchCostReport(x.s).totalKnownCost).toBe("100.0000");
});
it("saleable returns reverse original basis while damaged returns retain cost", () => {
  const x = setup(),
    a = receipt(x, 4),
    c = cost(x, 4, 200);
  saveBatchCost(x.s, a.id, c.id, "初始");
  const sale = sell(x, 3);
  c.actualPrint = 400;
  saveBatchCost(x.s, a.id, c.id, "未來");
  refundSale(x.s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "部分退貨",
    lines: [
      {
        saleLineId: sale.lines[0].id,
        amount: 150,
        restockQuantity: 1,
        damagedQuantity: 1,
        returnLocationId: x.l.id,
      },
    ],
  });
  const r = batchCostReport(x.s).sales[0];
  expect(r.netKnownCost).toBe("100.0000");
  expect(r.returnedQuantity).toBe(1);
  expect(r.damagedQuantity).toBe(1);
  expect(r.damagedKnownCost).toBe("50.0000");
  expect(r.margin).toBe("50.0000");
});
it("cash refund without stock return does not reverse cost", () => {
  const x = setup(),
    a = receipt(x),
    c = cost(x);
  saveBatchCost(x.s, a.id, c.id, "初始");
  const sale = sell(x);
  refundSale(x.s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "折讓",
    lines: [
      {
        saleLineId: sale.lines[0].id,
        amount: 10,
        restockQuantity: 0,
        damagedQuantity: 0,
        returnLocationId: "",
      },
    ],
  });
  expect(batchCostReport(x.s).sales[0].netKnownCost).toBe("33.3333");
});
it("full cancellation reverses net cost and returns original source", () => {
  const x = setup(),
    a = receipt(x),
    c = cost(x);
  saveBatchCost(x.s, a.id, c.id, "初始");
  const sale = sell(x);
  cancelSale(x.s, sale.id, "全退");
  const r = batchCostReport(x.s);
  expect(r.sales[0].netKnownCost).toBe("0.0000");
  expect(r.sales[0].margin).toBe("0.0000");
  expect(r.stock[0].quantity).toBe(3);
});
it("moving a batch between locations retains its basis", () => {
  const x = setup(),
    a = receipt(x),
    c = cost(x);
  saveBatchCost(x.s, a.id, c.id, "初始");
  const l = addLocation(x.s, "場次");
  addMovement(x.s, {
    productId: x.p.id,
    kind: "transfer",
    quantity: 2,
    fromLocationId: x.l.id,
    toLocationId: l.id,
    reason: "送場",
  });
  sell(x, 1, l.id);
  expect(batchCostReport(x.s).sales[0].knownCost).toBe("33.3333");
});
it("unknown snapshot remains unknown when source later becomes complete", () => {
  const x = setup(),
    a = receipt(x),
    c = cost(x, 3, null);
  saveBatchCost(x.s, a.id, c.id, "費用未知");
  c.actualPrint = 100;
  sell(x);
  expect(batchCostReport(x.s).sales[0].unknownQuantity).toBe(1);
  expect(batchCostReport(x.s).stock[0].value).toBeNull();
});
it("same whole cost cannot be applied twice to separate receipts, even after unlink", () => {
  const x = setup(),
    a = receipt(x),
    b = receipt(x),
    c = cost(x);
  saveBatchCost(x.s, a.id, c.id, "初始");
  saveBatchCost(x.s, a.id, "", "解除");
  expect(() => saveBatchCost(x.s, b.id, c.id, "重複")).toThrow("重複");
});
it("rejects unknown legacy source, wrong quantity, foreign product and archived costs", () => {
  const x = setup(),
    a = receipt(x),
    c = cost(x, 4);
  expect(() => saveBatchCost(x.s, a.id, c.id, "不符")).toThrow("數量");
  c.quantity = 3;
  c.productId = "foreign";
  expect(() => saveBatchCost(x.s, a.id, c.id, "外部")).toThrow();
  c.productId = x.p.id;
  c.archived = true;
  expect(() => saveBatchCost(x.s, a.id, c.id, "封存")).toThrow();
  expect(() => saveBatchCost(x.s, "legacy:" + x.p.id, c.id, "舊")).toThrow(
    "舊來源",
  );
});
it("reversed receipts cannot gain new cost links", () => {
  const x = setup(),
    a = receipt(x),
    c = cost(x);
  reverseMovement(x.s, a.id, "錯誤入庫");
  expect(() => saveBatchCost(x.s, a.id, c.id, "無效")).toThrow("沖銷");
});
it("rejects forged source fractions, cutoff and foreign cost refs", () => {
  const x = setup(),
    a = receipt(x),
    c = cost(x);
  const v = saveBatchCost(x.s, a.id, c.id, "初始");
  const good = structuredClone(v);
  v.exactTotal = { numerator: "200", denominator: "1" };
  expect(() => validateRestoreSnapshot(x.s)).toThrow("快照");
  Object.assign(v, good);
  v.effectiveMovementCount = 0;
  expect(() => validateRestoreSnapshot(x.s)).toThrow("生效");
  Object.assign(v, good);
  v.costId = "foreign";
  expect(() => validateRestoreSnapshot(x.s)).toThrow("來源");
});
it("upgrade old schema14 backup and installed DB keeps all cost knowledge unknown", async () => {
  const x = setup();
  receipt(x);
  sell(x);
  const old: any = structuredClone(x.s);
  old.schemaVersion = 14;
  delete old.batchCostVersions;
  const checked = validateRestoreSnapshot(old);
  expect(checked.batchCostVersions).toEqual([]);
  expect(batchCostReport(checked).sales[0].unknownQuantity).toBe(1);
  const name = "cogs-" + crypto.randomUUID(),
    db = new Dexie(name);
  db.version(15).stores({
    workspaces: "id, createdAt",
    catalogs: "workspaceId",
    recoverySnapshots: "id, workspaceId, createdAt",
    backupStatus: "workspaceId",
  });
  await db.table("workspaces").put(x.s.workspace);
  await db.table("catalogs").put(old);
  db.close();
  const next = new ConMateDatabase(name);
  try {
    const got = await next.catalogs.get(x.s.workspaceId);
    expect(got!.schemaVersion).toBe(15);
    expect(got!.batchCostVersions).toEqual([]);
    expect(got!.sales).toEqual(x.s.sales);
  } finally {
    await next.delete();
  }
});
it("roundtrips immutable cost versions and exactly reproduces report", async () => {
  const x = setup(),
    a = receipt(x),
    c = cost(x);
  saveBatchCost(x.s, a.id, c.id, "初始");
  sell(x);
  const restored = await inspectProject(await exportProject(x.s));
  expect(restored).toEqual(x.s);
  expect(batchCostReport(restored)).toEqual(batchCostReport(x.s));
});
