import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import Dexie from "dexie";
import {
  emptyCatalog,
  catalogRepository,
} from "../../src/infrastructure/storage/catalog";
import {
  database,
  workspaceRepository,
  ConMateDatabase,
} from "../../src/infrastructure/storage/workspaces";
import { putProduct } from "../../src/domain/catalog/operations";
import { putEvent } from "../../src/domain/catalog/projects";
import {
  addLocation,
  addMovement,
  balance,
} from "../../src/domain/inventory/operations";
import {
  putSalePlan,
  toggleSalePlanArchive,
} from "../../src/domain/sales/plans";
import { completeSale } from "../../src/domain/sales/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "工作區",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  for (const [name, creatorName, productType] of [
    ["甲徽章", "甲", "徽章"],
    ["乙吊飾", "乙", "吊飾"],
  ])
    putProduct(s, {
      name: name!,
      creatorName,
      productType: productType!,
      specification: "",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    });
  const l = addLocation(s, "攤位");
  for (const p of s.products)
    addMovement(s, {
      productId: p.id,
      kind: "receipt",
      quantity: 5,
      fromLocationId: "",
      toLocationId: l.id,
      reason: "到貨",
    });
  return s;
}
function command(s: ReturnType<typeof fixture>, i = 0) {
  return {
    operationId: crypto.randomUUID(),
    locationId: s.locations[0]!.id,
    eventId: "",
    collectorId: "",
    cashReceived: 200,
    notes: "",
    lines: [
      {
        productId: s.products[i]!.id,
        mode: "draw" as const,
        quantity: 1,
        unitPrice: 100,
      },
    ],
  };
}
it("mixed pool and direct plan share physical stock and save actual SKU snapshots", () => {
  const s = fixture(),
    plan = putSalePlan(s, {
      name: "混合抽選",
      mode: "draw",
      unitPrice: 100,
      productIds: s.products.map((p) => p.id),
      eventIds: [],
    });
  const c = command(s, 1);
  Object.assign(c.lines[0]!, { planId: plan.id, planVersion: plan.version });
  const sale = completeSale(s, c);
  expect(sale.lines[0]).toMatchObject({
    planName: "混合抽選",
    planVersion: 1,
    productId: s.products[1]!.id,
  });
  const direct = putSalePlan(s, {
    name: "指定",
    mode: "direct",
    unitPrice: 150,
    productIds: [s.products[1]!.id],
    eventIds: [],
  });
  const d = command(s, 1);
  Object.assign(d.lines[0]!, {
    mode: "direct",
    unitPrice: 150,
    planId: direct.id,
    planVersion: direct.version,
  });
  completeSale(s, d);
  expect(balance(s, s.products[1]!.id, s.locations[0]!.id)).toBe(3);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("edits version plan without rewriting old sale and stale selection is rejected", () => {
  const s = fixture(),
    input = {
      name: "抽選",
      mode: "draw" as const,
      unitPrice: 100,
      productIds: s.products.map((p) => p.id),
      eventIds: [],
    },
    p = putSalePlan(s, input);
  const c = command(s);
  Object.assign(c.lines[0]!, { planId: p.id, planVersion: 1 });
  const old = completeSale(s, c);
  putSalePlan(
    s,
    { ...input, name: "新價", unitPrice: 120, productIds: [s.products[1]!.id] },
    p.id,
  );
  expect(old.lines[0]).toMatchObject({
    unitPrice: 100,
    planName: "抽選",
    planVersion: 1,
  });
  expect(() =>
    completeSale(s, { ...c, operationId: crypto.randomUUID() }),
  ).toThrow("更新");
  expect(completeSale(s, c)).toBe(old);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("guards pool membership price mode and scoped event and archive", () => {
  const s = fixture(),
    event = putEvent(s, {
      name: "場",
      startDate: "2026-11-03",
      endDate: "",
      venue: "",
      notes: "",
      projectIds: [],
    });
  const p = putSalePlan(s, {
    name: "限定池",
    mode: "draw",
    unitPrice: 100,
    productIds: [s.products[0]!.id],
    eventIds: [event.id],
  });
  const c = command(s);
  Object.assign(c.lines[0]!, { planId: p.id, planVersion: 1 });
  expect(() => completeSale(s, c)).toThrow("場次");
  for (const changed of [
    { productId: s.products[1]!.id },
    { unitPrice: 1 },
    { mode: "direct" },
  ])
    expect(() =>
      completeSale(s, {
        ...c,
        eventId: event.id,
        lines: [{ ...c.lines[0]!, ...changed } as any],
      }),
    ).toThrow("方案不符");
  toggleSalePlanArchive(s, p.id);
  expect(() => completeSale(s, { ...c, eventId: event.id })).toThrow("停用");
});
it("validates restored plan IDs duplicates version and line snapshot shape", () => {
  const s = fixture(),
    p = putSalePlan(s, {
      name: "池",
      mode: "draw",
      unitPrice: 100,
      productIds: s.products.map((p) => p.id),
      eventIds: [],
    });
  const c = command(s);
  Object.assign(c.lines[0]!, { planId: p.id, planVersion: 1 });
  completeSale(s, c);
  for (const mutate of [
    (x: any) => x.salePlans[0].productIds.push(x.products[0].id),
    (x: any) => (x.salePlans[0].unitPrice = -1),
    (x: any) => (x.sales[0].lines[0].planVersion = 2),
    (x: any) => delete x.sales[0].lines[0].planName,
  ]) {
    const copy = structuredClone(s);
    mutate(copy);
    expect(() => validateRestoreSnapshot(copy)).toThrow();
  }
});
it("new format roundtrip preserves plan and actual-SKU snapshots", async () => {
  const s = fixture(),
    p = putSalePlan(s, {
      name: "池",
      mode: "draw",
      unitPrice: 100,
      productIds: s.products.map((p) => p.id),
      eventIds: [],
    });
  const c = command(s);
  Object.assign(c.lines[0]!, { planId: p.id, planVersion: 1 });
  completeSale(s, c);
  expect(await inspectProject(await exportProject(s))).toEqual(s);
});
it("schema7 restoration/migration preserves prior records and adds no plans", async () => {
  const s = fixture();
  const old: any = { ...s, schemaVersion: 7 };
  delete old.salePlans;
  expect(validateRestoreSnapshot(old)).toEqual(s);
  const name = "plans-migrate-" + crypto.randomUUID(),
    db = new Dexie(name);
  db.version(7).stores({
    workspaces: "id, createdAt",
    catalogs: "workspaceId",
  });
  await db.table("workspaces").add(s.workspace);
  await db.table("catalogs").add(old);
  db.close();
  const upgraded = new ConMateDatabase(name);
  try {
    expect(await upgraded.catalogs.get(s.workspaceId)).toEqual(s);
  } finally {
    await upgraded.delete();
  }
});
it("failed plan checkout rolls back complete sale with stock changes", async () => {
  const w = await workspaceRepository.create("方案原子測試");
  try {
    await catalogRepository.change(w.id, 0, (s) => {
      Object.assign(s, fixture(), { workspace: w, workspaceId: w.id });
      for (const key of [
        "products",
        "parties",
        "locations",
        "movements",
        "productTypes",
        "series",
        "specs",
      ] as const)
        for (const r of s[key]) r.workspaceId = w.id;
      putSalePlan(s, {
        name: "池",
        mode: "draw",
        unitPrice: 100,
        productIds: [s.products[0]!.id],
        eventIds: [],
      });
    });
    const before = await catalogRepository.read(w.id);
    const c = command(before);
    c.lines.push({
      ...c.lines[0]!,
      productId: before.products[1]!.id,
      planId: before.salePlans[0]!.id,
      planVersion: 1,
    });
    await expect(
      catalogRepository.change(w.id, before.revision, (s) => {
        completeSale(s, c);
      }),
    ).rejects.toThrow();
    expect(await catalogRepository.read(w.id)).toEqual(before);
  } finally {
    await database.catalogs.delete(w.id);
    await database.workspaces.delete(w.id);
  }
});
