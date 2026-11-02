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
    await old.table("workspaces").add({
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

it("migrates v0.2 catalog records without changing IDs, custom values or revisions", async () => {
  const name = "migration-v2-" + crypto.randomUUID();
  const old = new Dexie(name);
  old
    .version(2)
    .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" });
  const workspace = {
    id: "workspace-old",
    name: "舊工作區",
    createdAt: "2026-01-01T00:00:00Z",
    currency: "TWD",
    timezone: "Asia/Taipei",
  };
  const raw = {
    workspaceId: workspace.id,
    workspace,
    schemaVersion: 2,
    revision: 7,
    counters: { PRJ: 1 },
    parties: [],
    projects: [
      {
        id: "project-stable",
        workspaceId: workspace.id,
        code: "PRJ-000001",
        name: "原企劃",
      },
    ],
    productTypes: [],
    specs: [],
    series: [],
    artworks: [],
    tags: [],
    fields: [],
    products: [
      {
        id: "product-stable",
        projectId: "project-stable",
        customValues: { example: false },
      },
    ],
  };
  await old.table("workspaces").add(workspace);
  await old.table("catalogs").put(raw);
  old.close();
  const upgraded = new ConMateDatabase(name);
  const result = await upgraded.catalogs.get(workspace.id);
  expect(result?.schemaVersion).toBe(4);
  expect(result?.revision).toBe(7);
  expect(result?.products).toEqual(raw.products);
  expect(result?.projects[0]).toEqual({
    ...raw.projects[0],
    description: "",
    archived: false,
  });
  expect(result?.events).toEqual([]);
  expect(result?.projectEvents).toEqual([]);
  await upgraded.delete();
});
