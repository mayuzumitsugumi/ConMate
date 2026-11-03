import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import {
  emptyCatalog,
  catalogRepository,
} from "../../src/infrastructure/storage/catalog";
import {
  workspaceRepository,
  database,
} from "../../src/infrastructure/storage/workspaces";
import { putProduct } from "../../src/domain/catalog/operations";
import {
  addLocation,
  addMovement,
  balance,
  reverseMovement,
} from "../../src/domain/inventory/operations";
import { completeSale, cancelSale } from "../../src/domain/sales/operations";
import {
  refundSale,
  lineReturnSummary,
  saleNetRevenue,
} from "../../src/domain/sales/refunds";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "退貨",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const p = putProduct(s, {
    name: "徽章",
    productType: "徽章",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const l = addLocation(s, "攤位");
  addMovement(s, {
    productId: p.id,
    kind: "receipt",
    quantity: 10,
    fromLocationId: "",
    toLocationId: l.id,
    reason: "入庫",
  });
  const sale = completeSale(s, {
    operationId: crypto.randomUUID(),
    locationId: l.id,
    eventId: "",
    collectorId: "",
    cashReceived: 300,
    notes: "",
    lines: [{ productId: p.id, quantity: 3, mode: "direct", unitPrice: 100 }],
  });
  return { s, sale, p, l };
}
function input(
  sale: ReturnType<typeof fixture>["sale"],
  l: ReturnType<typeof fixture>["l"],
) {
  return {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "實際退款退貨",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 100,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: l.id,
      },
    ],
  };
}
it("partial refund preserves original sale, restores chosen location and net revenue", () => {
  const { s, sale, p, l } = fixture();
  const other = addLocation(s, "倉庫");
  const cmd = input(sale, l);
  cmd.lines[0]!.returnLocationId = other.id;
  const r = refundSale(s, cmd);
  expect(balance(s, p.id, l.id)).toBe(7);
  expect(balance(s, p.id, other.id)).toBe(1);
  expect(sale.total).toBe(300);
  expect(sale.cancelledAt).toBe("");
  expect(saleNetRevenue(s, sale)).toBe(200);
  expect(r.total).toBe(100);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("damaged return and no-return refund do not increase saleable stock", () => {
  const { s, sale, p, l } = fixture();
  const cmd = input(sale, l);
  Object.assign(cmd.lines[0]!, {
    restockQuantity: 0,
    damagedQuantity: 1,
    returnLocationId: "",
  });
  refundSale(s, cmd);
  const c = input(sale, l);
  Object.assign(c.lines[0]!, {
    restockQuantity: 0,
    damagedQuantity: 0,
    returnLocationId: "",
    amount: 50,
  });
  refundSale(s, c);
  expect(balance(s, p.id, l.id)).toBe(7);
  expect(lineReturnSummary(s, sale.lines[0]!.id)).toEqual({
    amount: 150,
    restockQuantity: 0,
    damagedQuantity: 1,
  });
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("zero-price and zero-refund item returns are allowed", () => {
  const { s, p, l } = fixture();
  const sale = completeSale(s, {
    operationId: crypto.randomUUID(),
    locationId: l.id,
    eventId: "",
    collectorId: "",
    cashReceived: 0,
    notes: "",
    lines: [{ productId: p.id, quantity: 1, mode: "direct", unitPrice: 0 }],
  });
  const c = input(sale, l);
  c.lines[0]!.amount = 0;
  refundSale(s, c);
  expect(saleNetRevenue(s, sale)).toBe(0);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("separately caps cumulative cash refunds and physical returns", () => {
  const { s, sale, l } = fixture();
  const c = input(sale, l);
  Object.assign(c.lines[0]!, {
    amount: 300,
    restockQuantity: 0,
    returnLocationId: "",
  });
  refundSale(s, c);
  expect(() => refundSale(s, input(sale, l))).toThrow("退款超過");
  const d = input(sale, l);
  Object.assign(d.lines[0]!, { amount: 0, restockQuantity: 3 });
  refundSale(s, d);
  expect(() =>
    refundSale(s, { ...d, operationId: crypto.randomUUID() }),
  ).toThrow("數量超過");
});
it("idempotency retry neither refunds nor restocks twice and changed command fails", () => {
  const { s, sale, p, l } = fixture();
  const c = input(sale, l);
  const r = refundSale(s, c);
  expect(refundSale(s, c)).toBe(r);
  expect(balance(s, p.id, l.id)).toBe(8);
  const changed = structuredClone(c);
  changed.lines[0]!.amount = 20;
  expect(() => refundSale(s, changed)).toThrow("操作識別");
});
it("guards legacy cancellation, foreign lines, protected return movement and empty input", () => {
  const { s, sale, l } = fixture();
  const c = input(sale, l);
  expect(() =>
    refundSale(s, { ...c, lines: [{ ...c.lines[0]!, saleLineId: "foreign" }] }),
  ).toThrow("不屬於");
  const blank = input(sale, l);
  Object.assign(blank.lines[0]!, {
    amount: 0,
    restockQuantity: 0,
    returnLocationId: "",
  });
  expect(() => refundSale(s, blank)).toThrow("至少");
  const r = refundSale(s, c);
  expect(() => cancelSale(s, sale.id, "不能全取消")).toThrow();
  expect(() =>
    reverseMovement(s, r.lines[0]!.movementId, "不能單獨改庫存", sale.id),
  ).toThrow();
});
it("cancelled old sale cannot receive new refunds", () => {
  const { s, sale, l } = fixture();
  cancelSale(s, sale.id, "全退");
  expect(() => refundSale(s, input(sale, l))).toThrow("取消");
  expect(saleNetRevenue(s, sale)).toBe(0);
});
it("refund backup roundtrip preserves actual cash and return disposition", async () => {
  const { s, sale, l } = fixture();
  refundSale(s, input(sale, l));
  expect(await inspectProject(await exportProject(s))).toEqual(s);
});
it("restore rejects forged cash totals, duplicated qty and broken return movements", () => {
  const { s, sale, l } = fixture();
  refundSale(s, input(sale, l));
  for (const mutate of [
    (x: any) => (x.refunds[0].total = 200),
    (x: any) => (x.refunds[0].lines[0].restockQuantity = 4),
    (x: any) => (x.refunds[0].lines[0].returnLocationId = "foreign"),
    (x: any) => (x.refunds[0].lines[0].movementId = ""),
    (x: any) => (x.refunds[0].lines[0].amount = 301),
  ]) {
    const copy = structuredClone(s);
    mutate(copy);
    expect(() => validateRestoreSnapshot(copy)).toThrow();
  }
});
it("atomic multi-line failure does not leave refunds or stock changes", async () => {
  const { s, sale, l } = fixture();
  await database.workspaces.add(s.workspace);
  await database.catalogs.add(s);
  try {
    const c = input(sale, l);
    c.lines.push({ ...c.lines[0]!, saleLineId: "foreign" });
    await expect(
      catalogRepository.change(s.workspaceId, s.revision, (x) => {
        refundSale(x, c);
      }),
    ).rejects.toThrow();
    expect(await catalogRepository.read(s.workspaceId)).toEqual(s);
  } finally {
    await database.catalogs.delete(s.workspaceId);
    await database.workspaces.delete(s.workspaceId);
  }
});

it("exchange records two actual cash flows and a unique source link", () => {
  const { s, sale, p, l } = fixture();
  const refund = refundSale(s, input(sale, l));
  const replacement = {
    operationId: crypto.randomUUID(),
    replacesRefundId: refund.id,
    locationId: l.id,
    eventId: "",
    collectorId: "",
    cashReceived: 150,
    notes: "換貨另收全額",
    lines: [
      { productId: p.id, quantity: 1, mode: "direct" as const, unitPrice: 150 },
    ],
  };
  const newSale = completeSale(s, replacement);
  expect(newSale.replacesRefundId).toBe(refund.id);
  expect(newSale.cashReceived).toBe(150);
  expect(newSale.total).toBe(150);
  expect(refund.total).toBe(100);
  expect(completeSale(s, replacement)).toBe(newSale);
  expect(() =>
    completeSale(s, { ...replacement, operationId: crypto.randomUUID() }),
  ).toThrow("已連結");
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("money-only correction may follow a physical return without returning twice", () => {
  const { s, sale, l } = fixture();
  const first = input(sale, l);
  first.lines[0]!.amount = 0;
  refundSale(s, first);
  const second = input(sale, l);
  Object.assign(second.lines[0]!, {
    amount: 100,
    restockQuantity: 0,
    returnLocationId: "",
  });
  refundSale(s, second);
  expect(lineReturnSummary(s, sale.lines[0]!.id)).toEqual({
    amount: 100,
    restockQuantity: 1,
    damagedQuantity: 0,
  });
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("upgrades schema9 snapshots and installed data without changing old cancellation", async () => {
  const { s, sale } = fixture();
  cancelSale(s, sale.id, "舊版全退");
  const old: any = { ...s, schemaVersion: 9 };
  delete old.refunds;
  expect(validateRestoreSnapshot(old)).toMatchObject({
    ...s,
    batchTrackingStart: s.movements.length,
    movements: s.movements.map(({ batchAllocations, ...m }) => m),
  });
  const Dexie = (await import("dexie")).default;
  const { ConMateDatabase } =
    await import("../../src/infrastructure/storage/workspaces");
  const name = "refund-migration-" + crypto.randomUUID(),
    db = new Dexie(name);
  db.version(9).stores({
    workspaces: "id, createdAt",
    catalogs: "workspaceId",
  });
  await db.table("workspaces").add(s.workspace);
  await db.table("catalogs").add(old);
  db.close();
  const next = new ConMateDatabase(name);
  try {
    expect(await next.catalogs.get(s.workspaceId)).toMatchObject({
      ...s,
      batchTrackingStart: s.movements.length,
      movements: s.movements.map(({ batchAllocations, ...m }) => m),
    });
  } finally {
    await next.delete();
  }
});
it("event summary subtracts partial refunds only once and retains gross sales", async () => {
  const { s, sale, l } = fixture();
  refundSale(s, input(sale, l));
  const { eventSummary } = await import("../../src/domain/inventory/stocktake");
  expect(eventSummary(s, "")).toMatchObject({
    gross: "300",
    refunds: "100",
    net: "200",
  });
});
