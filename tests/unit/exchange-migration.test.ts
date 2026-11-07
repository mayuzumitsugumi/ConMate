import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, it } from "vitest";
import { ConMateDatabase } from "../../src/infrastructure/storage/workspaces";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";

it("upgrades schema19 without inventing exchanges or modifying existing recovery originals", async () => {
  const name = "exchange-migration-" + crypto.randomUUID();
  const workspace = {
    id: "exchange-existing",
    name: "換購升級工作區",
    currency: "TWD" as const,
    timezone: "Asia/Taipei" as const,
    createdAt: "2026-11-05T00:00:00Z",
  };
  const current = emptyCatalog(workspace);
  current.revision = 17;
  const old: Record<string, any> = { ...current, schemaVersion: 19 };
  delete old.exchanges;
  const recovery = {
    id: "original",
    workspaceId: workspace.id,
    createdAt: workspace.createdAt,
    source: "file",
    restoredFromRevision: 16,
    restoredToRevision: 17,
    snapshot: structuredClone(old),
  };
  const previous = new Dexie(name);
  previous.version(20).stores({
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
      schemaVersion: 23,
      exchanges: [],
    });
    expect(await upgraded.recoverySnapshots.get(recovery.id)).toEqual(recovery);
    expect(validateRestoreSnapshot(structuredClone(old))).toEqual({
      ...old,
      schemaVersion: 23,
      exchanges: [],
    });
  } finally {
    await upgraded.delete();
  }
});
