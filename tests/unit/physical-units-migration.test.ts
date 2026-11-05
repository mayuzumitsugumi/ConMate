import "fake-indexeddb/auto";
import Dexie from "dexie";
import { it, expect } from "vitest";
import { ConMateDatabase } from "../../src/infrastructure/storage/workspaces";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import {
  addLocation,
  addMovement,
} from "../../src/domain/inventory/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";

it("upgrades schema18 with empty unit identities without changing existing quantity or recovery originals", async () => {
  const name = "unit-upgrade-" + crypto.randomUUID();
  const workspace = {
    id: "existing-unit-workspace",
    name: "既有親簽商品",
    currency: "TWD" as const,
    timezone: "Asia/Taipei" as const,
    createdAt: "2026-11-04T00:00:00Z",
  };
  const current = emptyCatalog(workspace);
  const product = putProduct(current, {
    name: "親簽卡",
    productType: "卡片",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const location = addLocation(current, "家中");
  addMovement(current, {
    productId: product.id,
    kind: "receipt",
    quantity: 3,
    fromLocationId: "",
    toLocationId: location.id,
    reason: "既有實物",
  });
  current.revision = 42;
  const old = { ...current, schemaVersion: 18 } as Record<string, any>;
  delete old.physicalUnits;
  const recovery = {
    id: "original-recovery",
    workspaceId: workspace.id,
    createdAt: "2026-11-04T00:00:00Z",
    source: "file",
    restoredFromRevision: 40,
    restoredToRevision: 42,
    snapshot: structuredClone(old),
  };
  const previous = new Dexie(name);
  previous
    .version(19)
    .stores({
      workspaces: "id, createdAt",
      catalogs: "workspaceId",
      recoverySnapshots: "id, workspaceId, createdAt",
      backupStatus: "workspaceId",
      activityPackets: "handoffId, sourceWorkspaceId, eventId",
    });
  await previous.table("workspaces").add(workspace);
  await previous.table("catalogs").add(old);
  await previous.table("recoverySnapshots").add(recovery);
  previous.close();
  const upgraded = new ConMateDatabase(name);
  try {
    const restored = await upgraded.catalogs.get(workspace.id);
    expect(restored).toEqual({ ...old, schemaVersion: 21, physicalUnits: [], exchanges: [] });
    expect(restored?.movements).toEqual(current.movements);
    expect(restored?.products[0]?.id).toBe(product.id);
    expect(restored?.revision).toBe(42);
    expect(await upgraded.recoverySnapshots.get(recovery.id)).toEqual(recovery);
    const checked = validateRestoreSnapshot(structuredClone(old));
    expect(checked.physicalUnits).toEqual([]);
    expect(checked.movements).toEqual(current.movements);
  } finally {
    await upgraded.delete();
  }
});
