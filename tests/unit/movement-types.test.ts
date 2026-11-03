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
  reverseMovement,
  putMovementType,
  toggleMovementType,
} from "../../src/domain/inventory/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "自訂類型",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const p = putProduct(s, {
    name: "徽章",
    productType: "",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const a = addLocation(s, "家中"),
    b = addLocation(s, "攤位");
  const move = (typeId: string, quantity: number, from: string, to: string) =>
    addMovement(s, {
      productId: p.id,
      movementTypeId: typeId,
      kind: "receipt",
      quantity,
      fromLocationId: from,
      toLocationId: to,
      reason: "測試",
    });
  return { s, p, a, b, move };
}
it("maps custom types to safe stock effects and preserves transfer conservation", () => {
  const { s, p, a, b, move } = fixture();
  const received = putMovementType(s, "廠商到貨", "increase"),
    gift = putMovementType(s, "送朋友", "decrease"),
    transport = putMovementType(s, "帶去場次", "transfer");
  const first = move(received.id, 10, "", a.id);
  expect(first.kind).toBe("adjust-in");
  move(transport.id, 4, a.id, b.id);
  move(gift.id, 1, b.id, "");
  expect(balance(s, p.id, a.id)).toBe(6);
  expect(balance(s, p.id, b.id)).toBe(3);
  expect(() => move(gift.id, 5, b.id, "")).toThrow("不足");
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("renames without changing historic labels, forbids effect changes and archived/unknown new assignments", () => {
  const { s, a, move } = fixture();
  const type = putMovementType(s, "到貨", "increase");
  const m = move(type.id, 3, "", a.id);
  putMovementType(s, "補貨", "increase", type.id);
  expect(m.name).toBe("到貨");
  expect(() => putMovementType(s, "補貨", "decrease", type.id)).toThrow(
    "不可修改",
  );
  expect(() => putMovementType(s, "補貨", "transfer")).toThrow("相同");
  toggleMovementType(s, type.id);
  expect(() => move(type.id, 1, "", a.id)).toThrow("啟用");
  expect(() => move("foreign", 1, "", a.id)).toThrow("啟用");
  reverseMovement(s, m.id, "退回");
  expect(validateRestoreSnapshot(s)).toEqual(s);
  toggleMovementType(s, type.id);
  expect(move(type.id, 1, "", a.id).name).toBe("補貨");
});
it("rejects forged type direction while keeping complete types/history in XLSX round trip", async () => {
  const { s, a, move } = fixture();
  const t = putMovementType(s, "到貨", "increase");
  move(t.id, 2, "", a.id);
  const bad = structuredClone(s);
  bad.movementTypes[0]!.effect = "decrease";
  expect(() => validateRestoreSnapshot(bad)).toThrow("方向");
  expect(await inspectProject(await exportProject(s))).toEqual(s);
});
it("upgrades schema5 installed data and backups without changing stock, IDs or historical kinds", async () => {
  const { s, p, a } = fixture();
  addMovement(s, {
    productId: p.id,
    kind: "receipt",
    quantity: 3,
    fromLocationId: "",
    toLocationId: a.id,
    reason: "舊資料",
  });
  const oldData: any = structuredClone(s);
  oldData.schemaVersion = 5;
  delete oldData.movementTypes;
  const normalized = validateRestoreSnapshot(oldData);
  expect(normalized.movementTypes).toEqual([]);
  expect(normalized.movements).toMatchObject(
    s.movements.map(({ batchAllocations, ...m }) => m),
  );
  const name = "type-migration-" + crypto.randomUUID(),
    old = new Dexie(name);
  old
    .version(5)
    .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" });
  await old.table("workspaces").add(s.workspace);
  await old.table("catalogs").add(oldData);
  old.close();
  const upgraded = new ConMateDatabase(name);
  try {
    const data = (await upgraded.catalogs.get(s.workspaceId))!;
    expect(data.schemaVersion).toBe(13);
    expect(data.movements).toMatchObject(
      s.movements.map(({ batchAllocations, ...m }) => m),
    );
    expect(balance(data, p.id, a.id)).toBe(3);
    expect(data.movementTypes).toEqual([]);
  } finally {
    await upgraded.delete();
  }
});
