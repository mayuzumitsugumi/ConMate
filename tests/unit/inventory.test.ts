import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import Dexie from "dexie";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import {
  ConMateDatabase,
  database,
  workspaceRepository,
} from "../../src/infrastructure/storage/workspaces";
import { catalogRepository } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import {
  addLocation,
  addMovement,
  balance,
  reverseMovement,
} from "../../src/domain/inventory/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "庫存測試",
    createdAt: new Date().toISOString(),
    currency: "TWD",
    timezone: "Asia/Taipei",
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
  const a = addLocation(s, "家中"),
    b = addLocation(s, "場次");
  const move = (
    kind:
      "receipt" | "transfer" | "damage" | "free" | "adjust-in" | "adjust-out",
    quantity: number,
    from = "",
    to = "",
  ) =>
    addMovement(s, {
      productId: p.id,
      kind,
      quantity,
      fromLocationId: from,
      toLocationId: to,
      reason: "測試原因",
    });
  return { s, p, a, b, move };
}
it("keeps shared SKU stock conserved through transfers and separates non-sale outflows", () => {
  const { s, p, a, b, move } = fixture();
  move("receipt", 10, "", a.id);
  move("transfer", 4, a.id, b.id);
  move("free", 1, b.id);
  move("damage", 2, a.id);
  expect(balance(s, p.id, a.id)).toBe(4);
  expect(balance(s, p.id, b.id)).toBe(3);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("rejects invalid quantity, duplicate/foreign locations, archived SKU and insufficient stock", () => {
  const { s, p, a, b, move } = fixture();
  expect(() => addLocation(s, "家中")).toThrow("相同");
  for (const q of [0, -1, 1.5, NaN, Infinity])
    expect(() => move("receipt", q, "", a.id)).toThrow("數量");
  expect(() => move("receipt", 1, "", "foreign")).toThrow("庫位不存在");
  expect(() => move("transfer", 1, a.id, a.id)).toThrow("不同");
  expect(() => move("free", 1, b.id)).toThrow("庫存不足");
  p.archived = true;
  expect(() => move("receipt", 1, "", a.id)).toThrow("未封存");
});
it("uses reversal records without deleting history and rejects duplicate/reversal-of-reversal", () => {
  const { s, p, a, move } = fixture();
  const original = move("receipt", 5, "", a.id);
  const undo = reverseMovement(s, original.id, "數量登錯");
  expect(s.movements).toHaveLength(2);
  expect(balance(s, p.id, a.id)).toBe(0);
  expect(undo.reversesId).toBe(original.id);
  expect(() => reverseMovement(s, original.id, "再次")).toThrow("已沖銷");
  expect(() => reverseMovement(s, undo.id, "再次")).toThrow();
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("does not reverse a receipt whose stock has already moved away", () => {
  const { s, a, b, move } = fixture();
  const receipt = move("receipt", 2, "", a.id);
  const transfer = move("transfer", 2, a.id, b.id);
  expect(() => reverseMovement(s, receipt.id, "錯誤")).toThrow("庫存不足");
  reverseMovement(s, transfer.id, "先退調撥");
  reverseMovement(s, receipt.id, "再沖入庫");
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("round trips full ledger, location IDs and balances through XLSX", async () => {
  const { s, p, a, b, move } = fixture();
  move("receipt", 20, "", a.id);
  move("transfer", 8, a.id, b.id);
  move("adjust-out", 2, b.id);
  move("adjust-in", 1, "", a.id);
  const checked = await inspectProject(await exportProject(s));
  expect(checked).toEqual(s);
  expect(balance(checked, p.id, b.id)).toBe(6);
});
it("upgrades old schema3 backups with empty inventory without inventing quantities", () => {
  const { s } = fixture();
  const old: any = structuredClone(s);
  old.schemaVersion = 3;
  delete old.locations;
  delete old.movements;
  const checked = validateRestoreSnapshot(old);
  expect(checked.schemaVersion).toBe(11);
  expect(checked.locations).toEqual([]);
  expect(checked.movements).toEqual([]);
  expect(checked.products).toEqual(s.products);
});
it("rejects forged negative ledger and duplicated reversal in restore validation", () => {
  const { s, a, move } = fixture();
  const m = move("receipt", 3, "", a.id);
  move("free", 2, a.id);
  const forged = structuredClone(s);
  forged.movements[1]!.quantity = 4;
  expect(() => validateRestoreSnapshot(forged)).toThrow("負數");
  const bad = structuredClone(s);
  bad.movements[0]!.kind = "unknown" as any;
  expect(() => validateRestoreSnapshot(bad)).toThrow("未知");
});
it("atomically rejects overdrawn writes without persisting counters or half ledger", async () => {
  const workspace = await workspaceRepository.create("交易測試");
  try {
    await catalogRepository.change(workspace.id, 0, (s) => {
      const p = putProduct(s, {
        name: "貨品",
        productType: "",
        specification: "",
        artwork: "",
        notes: "",
        tagIds: [],
        customValues: {},
      });
      const l = addLocation(s, "庫位");
      addMovement(s, {
        productId: p.id,
        kind: "receipt",
        quantity: 2,
        fromLocationId: "",
        toLocationId: l.id,
        reason: "入庫",
      });
    });
    const before = await catalogRepository.read(workspace.id);
    await expect(
      catalogRepository.change(workspace.id, before.revision, (s) =>
        addMovement(s, {
          productId: s.products[0]!.id,
          kind: "free",
          quantity: 3,
          fromLocationId: s.locations[0]!.id,
          toLocationId: "",
          reason: "不夠",
        }),
      ),
    ).rejects.toThrow("不足");
    expect(await catalogRepository.read(workspace.id)).toEqual(before);
  } finally {
    await database.catalogs.delete(workspace.id);
    await database.workspaces.delete(workspace.id);
  }
});
it("migrates an installed schema3 database while preserving original IDs and revision", async () => {
  const { s } = fixture();
  const oldData: any = structuredClone(s);
  oldData.schemaVersion = 3;
  delete oldData.locations;
  delete oldData.movements;
  const name = "inventory-migration-" + crypto.randomUUID(),
    old = new Dexie(name);
  old
    .version(3)
    .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" });
  await old.table("workspaces").add(s.workspace);
  await old.table("catalogs").add(oldData);
  old.close();
  const next = new ConMateDatabase(name);
  try {
    const data = await next.catalogs.get(s.workspaceId);
    expect(data?.schemaVersion).toBe(11);
    expect(data?.products).toEqual(s.products);
    expect(data?.revision).toBe(s.revision);
    expect(data?.movements).toEqual([]);
  } finally {
    await next.delete();
  }
});
