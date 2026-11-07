import "fake-indexeddb/auto";
import Dexie from "dexie";
import { it, expect } from "vitest";
import { ConMateDatabase } from "../../src/infrastructure/storage/workspaces";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import { putCost } from "../../src/domain/finance/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";

it("upgrades v16 catalogs without rewriting IDs, revision, money or recovery originals", async () => {
  const name = "activity-upgrade-" + crypto.randomUUID();
  const workspace = {
    id: "preserved-workspace",
    name: "既有企劃",
    currency: "TWD" as const,
    timezone: "Asia/Taipei" as const,
    createdAt: "2026-11-03T00:00:00Z",
  };
  const current = emptyCatalog(workspace);
  current.revision = 42;
  current.counters = { PTY: 1, CST: 1 };
  current.parties.push({
    id: "party-original",
    workspaceId: workspace.id,
    code: "PTY-000001",
    name: "原創作者",
    notes: "保留",
    archived: false,
  });
  const product = putProduct(current, {
    name: "既有商品",
    creatorId: "party-original",
    productType: "徽章",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  putCost(current, {
    name: "原成本",
    productId: product.id,
    quantity: 3,
    estimatedPrint: 1710,
    actualPrint: 1368,
    artworkAllocated: null,
    otherCost: 0,
    unitSalePrice: 500,
    paidById: "party-original",
    burdenPartyId: "party-original",
    notes: "未知柄圖費保持null",
  });
  // The fixture is an actual previous schema, not a schema17 document with an old label.
  const old = { ...current, schemaVersion: 16 } as Record<string, any>;
  delete old.activityHandoffs;
  delete old.activityMerges;
  delete old.inventoryReservations;
  const recovery = {
    id: "recovery-original",
    workspaceId: workspace.id,
    createdAt: "2026-11-03T00:00:00Z",
    source: "file",
    restoredFromRevision: 40,
    restoredToRevision: 42,
    snapshot: structuredClone(old),
  };
  const previous = new Dexie(name);
  previous.version(17).stores({
    workspaces: "id, createdAt",
    catalogs: "workspaceId",
    recoverySnapshots: "id, workspaceId, createdAt",
    backupStatus: "workspaceId",
  });
  await previous.table("workspaces").add(workspace);
  await previous.table("catalogs").add(old);
  await previous.table("recoverySnapshots").add(recovery);
  previous.close();
  const upgraded = new ConMateDatabase(name);
  try {
    const got = await upgraded.catalogs.get(workspace.id);
    expect(got).toEqual({
      ...old,
      schemaVersion: 23,
      exchanges: [],
      inventoryReservations: [],
      physicalUnits: [],
      activityHandoffs: [],
      activityMerges: [],
    });
    expect(await upgraded.activityPackets.count()).toBe(0);
    const kept = await upgraded.recoverySnapshots.get(recovery.id);
    expect(kept).toEqual(recovery);
    const restored = validateRestoreSnapshot(structuredClone(kept!.snapshot));
    expect(restored.schemaVersion).toBe(23);
    expect(restored.parties).toEqual(current.parties);
    expect(restored.revision).toBe(42);
    expect(restored.costs).toEqual(old.costs);
    expect(restored.products).toEqual(old.products);
    expect(restored.internalAgreements).toEqual(old.internalAgreements);
  } finally {
    await upgraded.delete();
  }
});
