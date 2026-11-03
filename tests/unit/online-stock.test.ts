import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import Dexie from "dexie";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { ConMateDatabase } from "../../src/infrastructure/storage/workspaces";
import { putProduct } from "../../src/domain/catalog/operations";
import {
  addLocation,
  addMovement,
  balance,
} from "../../src/domain/inventory/operations";
import {
  safeShopUrl,
  putOnlineListing,
  onlineComparison,
  toggleOnlineListing,
} from "../../src/domain/inventory/online";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "網店測試",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const p = putProduct(s, {
    name: "吊飾",
    productType: "",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const a = addLocation(s, "家中"),
    b = addLocation(s, "攤位");
  addMovement(s, {
    productId: p.id,
    kind: "receipt",
    quantity: 10,
    fromLocationId: "",
    toLocationId: a.id,
    reason: "到貨",
  });
  const input = {
    name: "網店A",
    productId: p.id,
    locationId: a.id,
    url: "https://example.com/item",
    quantity: 6,
    notes: "核對",
  };
  return { s, p, a, b, input };
}
it("compares all shops sharing SKU/location without changing stock and recomputes after movements", () => {
  const { s, p, a, b, input } = fixture();
  const one = putOnlineListing(s, input);
  putOnlineListing(s, { ...input, name: "網店B", quantity: 5 });
  expect(onlineComparison(s, p.id, a.id)).toEqual({
    physical: 10,
    listed: 11,
    difference: -1,
  });
  putOnlineListing(s, {
    ...input,
    name: "另一庫位",
    locationId: b.id,
    quantity: 20,
  });
  expect(onlineComparison(s, p.id, a.id).listed).toBe(11);
  expect(balance(s, p.id, a.id)).toBe(10);
  addMovement(s, {
    productId: p.id,
    kind: "free",
    quantity: 1,
    fromLocationId: a.id,
    toLocationId: "",
    reason: "贈品",
  });
  expect(onlineComparison(s, p.id, a.id).difference).toBe(-2);
  toggleOnlineListing(s, one.id);
  expect(onlineComparison(s, p.id, a.id).listed).toBe(5);
  toggleOnlineListing(s, one.id);
  expect(onlineComparison(s, p.id, a.id).listed).toBe(11);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("preserves stable ID on recheck and allows zero", () => {
  const { s, input } = fixture();
  const one = putOnlineListing(s, input);
  const id = one.id,
    code = one.code;
  putOnlineListing(s, { ...input, name: "新店名", quantity: 0 }, id);
  expect(s.onlineListings).toHaveLength(1);
  expect(one.id).toBe(id);
  expect(one.code).toBe(code);
  expect(one.quantity).toBe(0);
});
it("rejects unsafe URLs, invalid qty and missing associations", () => {
  const { s, input } = fixture();
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "ftp://example.com",
    "https://a:b@example.com",
    "bad",
  ])
    expect(() => safeShopUrl(url)).toThrow();
  for (const quantity of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => putOnlineListing(s, { ...input, quantity })).toThrow();
  expect(() =>
    putOnlineListing(s, { ...input, productId: "foreign" }),
  ).toThrow();
  expect(() =>
    putOnlineListing(s, { ...input, locationId: "foreign" }),
  ).toThrow();
});
it("validates URLs, references and aggregate overflow when restoring", () => {
  const { s, input } = fixture();
  const one = putOnlineListing(s, input);
  const bad = structuredClone(s);
  bad.onlineListings[0]!.url = "javascript:alert(1)";
  expect(() => validateRestoreSnapshot(bad)).toThrow();
  const foreign = structuredClone(s);
  foreign.onlineListings[0]!.locationId = "elsewhere";
  expect(() => validateRestoreSnapshot(foreign)).toThrow();
  one.quantity = Number.MAX_SAFE_INTEGER;
  expect(() => putOnlineListing(s, { ...input, quantity: 1 })).toThrow("安全");
});
it("round trips listing IDs, manual quantities, timestamps and archives in project file", async () => {
  const { s, input } = fixture();
  putOnlineListing(s, input);
  const old = putOnlineListing(s, { ...input, quantity: 0 });
  toggleOnlineListing(s, old.id);
  expect(await inspectProject(await exportProject(s))).toEqual(s);
});
it("migrates schema4 restore and installed database preserving physical ledger", async () => {
  const { s, p, a } = fixture();
  const oldData: any = structuredClone(s);
  oldData.schemaVersion = 4;
  delete oldData.onlineListings;
  const checked = validateRestoreSnapshot(oldData);
  expect(checked.schemaVersion).toBe(17);
  expect(checked.onlineListings).toEqual([]);
  expect(balance(checked, p.id, a.id)).toBe(10);
  const dbname = "online-migration-" + crypto.randomUUID();
  const old = new Dexie(dbname);
  old
    .version(4)
    .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" });
  await old.table("workspaces").add(s.workspace);
  await old.table("catalogs").add(oldData);
  old.close();
  const db = new ConMateDatabase(dbname);
  try {
    const current = await db.catalogs.get(s.workspaceId);
    expect(current).toEqual(checked);
  } finally {
    await db.delete();
  }
});
