import "fake-indexeddb/auto";
import Dexie from "dexie";
import { it, expect } from "vitest";
import { ConMateDatabase } from "../../src/infrastructure/storage/workspaces";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";

it("upgrades schema17 without changing inventory, identifiers, revisions or recovery originals", async () => {
  const name = "reservation-upgrade-" + crypto.randomUUID();
  const workspace = {
    id: "existing-workspace",
    name: "既有企劃",
    currency: "TWD" as const,
    timezone: "Asia/Taipei" as const,
    createdAt: "2026-11-04T00:00:00Z",
  };
  const current = emptyCatalog(workspace);
  current.revision = 42;
  const old = { ...current, schemaVersion: 17 } as Record<string, any>;
  delete old.inventoryReservations;
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
    .version(18)
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
    expect(await upgraded.catalogs.get(workspace.id)).toEqual({
      ...old,
      schemaVersion: 19,
      inventoryReservations: [],
      physicalUnits: [],
    });
    expect(await upgraded.recoverySnapshots.get(recovery.id)).toEqual(recovery);
    expect(await upgraded.activityPackets.count()).toBe(0);
    const checked = validateRestoreSnapshot(structuredClone(old));
    expect(checked.inventoryReservations).toEqual([]);
    expect(checked.revision).toBe(42);
    expect(checked.workspace).toEqual(workspace);
  } finally {
    await upgraded.delete();
  }
});
