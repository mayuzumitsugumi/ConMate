import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import {
  ConMateDatabase,
  database,
  workspaceRepository,
} from "../../src/infrastructure/storage/workspaces";
import { catalogRepository } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
const input = {
  name: "商品",
  productType: "自由種類",
  specification: "",
  artwork: "",
  notes: "",
  tagIds: [],
  customValues: {},
};
afterEach(async () => {
  await database.catalogs.clear();
  await database.workspaces.clear();
});
describe("catalog storage and upgrades", () => {
  it("keeps workspaces isolated and rejects stale updates without partial data", async () => {
    const a = await workspaceRepository.create("A"),
      b = await workspaceRepository.create("B");
    await catalogRepository.change(a.id, 0, (s) => {
      putProduct(s, input);
    });
    expect((await catalogRepository.read(b.id)).products).toHaveLength(0);
    await expect(
      catalogRepository.change(a.id, 0, (s) => {
        putProduct(s, input);
      }),
    ).rejects.toThrow("資料已");
    expect((await catalogRepository.read(a.id)).products).toHaveLength(1);
  });
  it("upgrades an existing v1 database without deleting workspace IDs", async () => {
    const name = "migration-" + crypto.randomUUID();
    const old = new Dexie(name);
    old.version(1).stores({ workspaces: "id, createdAt" });
    await old
      .table("workspaces")
      .add({
        id: "preserved",
        name: "原工作區",
        createdAt: "2026-01-01T00:00:00Z",
        currency: "TWD",
        timezone: "Asia/Taipei",
      });
    old.close();
    const upgraded = new ConMateDatabase(name);
    expect((await upgraded.workspaces.get("preserved"))?.name).toBe("原工作區");
    expect(await upgraded.catalogs.count()).toBe(0);
    await upgraded.delete();
  });
});
