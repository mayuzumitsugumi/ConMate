import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import Dexie from "dexie";
import {
  emptyCatalog,
  catalogRepository,
} from "../../src/infrastructure/storage/catalog";
import {
  ConMateDatabase,
  database,
  workspaceRepository,
} from "../../src/infrastructure/storage/workspaces";
import { putProduct } from "../../src/domain/catalog/operations";
import { putEvent } from "../../src/domain/catalog/projects";
import {
  addLocation,
  addMovement,
  balance,
} from "../../src/domain/inventory/operations";
import {
  beginStocktake,
  saveStocktakeCounts,
  finishStocktake,
  stocktakeStale,
  eventSummary,
} from "../../src/domain/inventory/stocktake";
import { completeSale, cancelSale } from "../../src/domain/sales/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "盤點",
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
  const l = addLocation(s, "攤位"),
    other = addLocation(s, "家中");
  const receipt = (q = 10, location = l.id) =>
    addMovement(s, {
      productId: p.id,
      kind: "receipt",
      quantity: q,
      fromLocationId: "",
      toLocationId: location,
      reason: "入庫",
    });
  receipt();
  const begin = () => beginStocktake(s, l.id, "", "收攤", "");
  return { s, p, l, other, receipt, begin };
}
it("saves expected snapshot and explicit adjustments without creating sales", () => {
  const { s, p, l, begin } = fixture();
  const t = begin();
  expect(t.lines[0]?.expected).toBe(10);
  saveStocktakeCounts(s, t.id, [
    { productId: p.id, actual: 8, action: "adjust", reason: "破損未記" },
  ]);
  expect(balance(s, p.id, l.id)).toBe(10);
  finishStocktake(s, t.id);
  expect(balance(s, p.id, l.id)).toBe(8);
  expect(s.sales).toHaveLength(0);
  expect(t.lines[0]?.adjustmentMovementId).toBeTruthy();
  expect(validateRestoreSnapshot(s)).toEqual(s);
  expect(() => finishStocktake(s, t.id)).toThrow("已完成");
  expect(() => saveStocktakeCounts(s, t.id, [])).toThrow("可編輯");
});
it("allows pending differences and unknown actuals to close without changing stock", () => {
  const { s, p, l, begin } = fixture();
  const t = begin();
  saveStocktakeCounts(s, t.id, [
    { productId: p.id, actual: 7, action: "pending", reason: "待查" },
  ]);
  finishStocktake(s, t.id);
  expect(balance(s, p.id, l.id)).toBe(10);
  const next = begin();
  finishStocktake(s, next.id);
  expect(next.lines[0]?.actual).toBeNull();
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("blocks stale adjustment but allows pending closure and keeps later history valid", () => {
  const { s, p, l, receipt, begin } = fixture();
  const t = begin();
  receipt(2);
  expect(stocktakeStale(s, t)).toBe(true);
  saveStocktakeCounts(s, t.id, [
    { productId: p.id, actual: 8, action: "adjust", reason: "差額" },
  ]);
  expect(() => finishStocktake(s, t.id)).toThrow("已有異動");
  saveStocktakeCounts(s, t.id, [
    { productId: p.id, actual: 8, action: "pending", reason: "重新清點" },
  ]);
  finishStocktake(s, t.id);
  expect(t.staleAtCompletion).toBe(true);
  receipt(1);
  expect(balance(s, p.id, l.id)).toBe(13);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("ignores unrelated location changes while preventing forged snapshot and movement links", () => {
  const { s, p, other, receipt, begin } = fixture();
  const t = begin();
  receipt(3, other.id);
  expect(stocktakeStale(s, t)).toBe(false);
  saveStocktakeCounts(s, t.id, [
    { productId: p.id, actual: 11, action: "adjust", reason: "多一件" },
  ]);
  finishStocktake(s, t.id);
  expect(validateRestoreSnapshot(s)).toEqual(s);
  const forged = structuredClone(s);
  forged.stocktakes[0]!.lines[0]!.expected = 9;
  expect(() => validateRestoreSnapshot(forged)).toThrow();
  const forged2 = structuredClone(s);
  forged2.stocktakes[0]!.lines[0]!.adjustmentMovementId = s.movements[0]!.id;
  expect(() => validateRestoreSnapshot(forged2)).toThrow("不一致");
});
it("rejects negative/decimal/duplicate counts, unknown locations and missing adjustment reason", () => {
  const { s, p, begin } = fixture();
  expect(() => beginStocktake(s, "foreign", "", "盤點", "")).toThrow("庫位");
  const t = begin();
  for (const actual of [-1, 1.5, NaN])
    expect(() =>
      saveStocktakeCounts(s, t.id, [
        { productId: p.id, actual, action: "pending", reason: "" },
      ]),
    ).toThrow();
  expect(() => saveStocktakeCounts(s, t.id, [])).toThrow("不完整");
  expect(() =>
    saveStocktakeCounts(s, t.id, [
      { productId: p.id, actual: 0, action: "adjust", reason: "" },
    ]),
  ).toThrow("原因");
  expect(() =>
    saveStocktakeCounts(s, t.id, [
      { productId: p.id, actual: null, action: "adjust", reason: "" },
    ]),
  ).toThrow();
});
it("separates event gross, refund and effective revenue without including other events", () => {
  const { s, p, l } = fixture();
  const e = putEvent(s, {
    name: "CWT",
    startDate: "2026-11-03",
    endDate: "",
    venue: "",
    notes: "",
    projectIds: [],
  });
  const sale = completeSale(s, {
    operationId: crypto.randomUUID(),
    locationId: l.id,
    eventId: e.id,
    collectorId: "",
    cashReceived: 200,
    notes: "",
    lines: [{ productId: p.id, mode: "direct", quantity: 2, unitPrice: 60 }],
  });
  completeSale(s, {
    operationId: crypto.randomUUID(),
    locationId: l.id,
    eventId: "",
    collectorId: "",
    cashReceived: 100,
    notes: "",
    lines: [{ productId: p.id, mode: "direct", quantity: 1, unitPrice: 100 }],
  });
  expect(eventSummary(s, e.id)).toEqual({
    count: 1,
    activeCount: 1,
    gross: "120",
    refunds: "0",
    net: "120",
  });
  cancelSale(s, sale.id, "全退");
  expect(eventSummary(s, e.id)).toEqual({
    count: 1,
    activeCount: 0,
    gross: "120",
    refunds: "120",
    net: "0",
  });
});
it("round trips pending and completed stocktakes and preserves snapshot after later moves", async () => {
  const { s, p, receipt, begin } = fixture();
  const t = begin();
  saveStocktakeCounts(s, t.id, [
    { productId: p.id, actual: 9, action: "adjust", reason: "少一個" },
  ]);
  finishStocktake(s, t.id);
  receipt(2);
  begin();
  const checked = await inspectProject(await exportProject(s));
  expect(checked).toEqual(s);
});
it("upgrades schema8 backup and database with empty stocktake list", async () => {
  const { s } = fixture();
  const old: any = structuredClone(s);
  old.schemaVersion = 8;
  delete old.stocktakes;
  expect(validateRestoreSnapshot(old).stocktakes).toEqual([]);
  const name = "stocktake-migration-" + crypto.randomUUID();
  const before = new Dexie(name);
  before
    .version(8)
    .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" });
  await before.table("workspaces").add(s.workspace);
  await before.table("catalogs").add(old);
  before.close();
  const after = new ConMateDatabase(name);
  try {
    const upgraded = await after.catalogs.get(s.workspaceId);
    expect(upgraded?.schemaVersion).toBe(22);
    expect(upgraded?.products).toEqual(s.products);
    expect(upgraded?.stocktakes).toEqual([]);
  } finally {
    await after.delete();
  }
});
it("rolls back all counts and adjustments if stale completion fails", async () => {
  const w = await workspaceRepository.create("回滾盤點");
  try {
    let p = "",
      l = "",
      t = "";
    await catalogRepository.change(w.id, 0, (s) => {
      p = putProduct(s, {
        name: "徽章",
        productType: "",
        specification: "",
        artwork: "",
        notes: "",
        tagIds: [],
        customValues: {},
      }).id;
      l = addLocation(s, "攤位").id;
      addMovement(s, {
        productId: p,
        kind: "receipt",
        quantity: 10,
        fromLocationId: "",
        toLocationId: l,
        reason: "入庫",
      });
      t = beginStocktake(s, l, "", "清點", "").id;
      addMovement(s, {
        productId: p,
        kind: "receipt",
        quantity: 1,
        fromLocationId: "",
        toLocationId: l,
        reason: "後續",
      });
    });
    const before = await catalogRepository.read(w.id);
    await expect(
      catalogRepository.change(w.id, 1, (s) => {
        saveStocktakeCounts(s, t, [
          { productId: p, actual: 3, action: "adjust", reason: "少" },
        ]);
        finishStocktake(s, t);
      }),
    ).rejects.toThrow("已有異動");
    expect(await catalogRepository.read(w.id)).toEqual(before);
  } finally {
    await database.catalogs.delete(w.id);
    await database.workspaces.delete(w.id);
  }
});
