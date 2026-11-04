import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, it, expect } from "vitest";
import {
  workspaceRepository,
  database,
  ConMateDatabase,
} from "../../src/infrastructure/storage/workspaces";
import {
  catalogRepository,
  emptyCatalog,
} from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import {
  previewWorkspaceRestore,
  replaceWorkspace,
  restoreWorkspace,
} from "../../src/infrastructure/storage/restore";
import {
  backupReminder,
  recordDownload,
  confirmBackupSaved,
} from "../../src/infrastructure/storage/local-backups";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
const product = (name: string) => ({
  name,
  productType: "",
  specification: "",
  artwork: "",
  notes: "",
  tagIds: [],
  customValues: {},
});
afterEach(async () => {
  await database.recoverySnapshots.clear();
  await database.backupStatus.clear();
  await database.catalogs.clear();
  await database.workspaces.clear();
});
async function fixture() {
  const w = await workspaceRepository.create("還原測試");
  await catalogRepository.change(w.id, 0, (s) => {
    putProduct(s, product("原商品"));
  });
  return catalogRepository.read(w.id);
}
it("preview reports additions/changes/removals without writes", async () => {
  const current = await fixture(),
    incoming = structuredClone(current);
  incoming.products[0]!.name = "新名稱";
  putProduct(incoming, product("新商品"));
  incoming.parties.push({notes:"",archived:false,
    id: crypto.randomUUID(),
    workspaceId: incoming.workspaceId,
    code: "PTY-000001",
    name: "甲",
  });
  incoming.counters.PTY = 1;
  const result = await previewWorkspaceRestore(incoming);
  expect(result.local).toEqual(current);
  expect(result.differences.find((d) => d.key === "products")).toMatchObject({
    added: 1,
    changed: 1,
    removed: 0,
  });
  expect(await catalogRepository.read(current.workspaceId)).toEqual(current);
  expect(await database.recoverySnapshots.count()).toBe(0);
  const removed = structuredClone(incoming);
  removed.products = [];
  const next = await previewWorkspaceRestore(removed);
  expect(next.differences.find((d) => d.key === "products")?.removed).toBe(1);
});
it("replacement atomically saves original, synchronizes workspace and bumps revision", async () => {
  const current = await fixture(),
    incoming = structuredClone(current);
  incoming.workspace.name = "檔案名稱";
  incoming.products = [];
  incoming.revision = 0;
  const view = await previewWorkspaceRestore(incoming);
  const result = await replaceWorkspace(incoming, view.expectedLocalContent!);
  const actual = await catalogRepository.read(current.workspaceId);
  expect(actual.revision).toBe(current.revision + 1);
  expect(actual.workspace.name).toBe("檔案名稱");
  expect(actual.products).toEqual([]);
  expect(
    (await database.recoverySnapshots.get(result.recoveryId))?.snapshot,
  ).toEqual(current);
  await expect(
    catalogRepository.change(current.workspaceId, current.revision, (s) => {
      putProduct(s, product("過期分頁"));
    }),
  ).rejects.toThrow("更新");
});
it("stale preview and repeated submit cannot overwrite changes", async () => {
  const current = await fixture(),
    view = await previewWorkspaceRestore(current);
  await catalogRepository.change(current.workspaceId, current.revision, (s) => {
    putProduct(s, product("新交易前商品"));
  });
  await expect(
    replaceWorkspace(current, view.expectedLocalContent!),
  ).rejects.toThrow("預覽後");
  expect(await database.recoverySnapshots.count()).toBe(0);
  const latest = await previewWorkspaceRestore(current);
  await replaceWorkspace(current, latest.expectedLocalContent!);
  await expect(
    replaceWorkspace(current, latest.expectedLocalContent!),
  ).rejects.toThrow("預覽後");
  expect(await database.recoverySnapshots.count()).toBe(1);
});
it("recovery can be exported and explicitly restored through a new preview", async () => {
  const current = await fixture(),
    incoming = structuredClone(current);
  incoming.products = [];
  const view = await previewWorkspaceRestore(incoming);
  const first = await replaceWorkspace(incoming, view.expectedLocalContent!);
  const recovery = (await database.recoverySnapshots.get(first.recoveryId))!;
  expect(await inspectProject(await exportProject(recovery.snapshot))).toEqual(
    current,
  );
  const second = await previewWorkspaceRestore(recovery.snapshot);
  await replaceWorkspace(
    recovery.snapshot,
    second.expectedLocalContent!,
    "recovery",
  );
  expect((await catalogRepository.read(current.workspaceId)).products).toEqual(
    current.products,
  );
  expect(await database.recoverySnapshots.count()).toBe(2);
});
it("failed recovery snapshot write rolls back replacement", async () => {
  const current = await fixture(),
    incoming = structuredClone(current);
  incoming.workspace.name = "不得寫入";
  const view = await previewWorkspaceRestore(incoming);
  const fail = () => {
    throw new Error("模擬空間不足");
  };
  database.recoverySnapshots.hook("creating", fail);
  try {
    await expect(
      replaceWorkspace(incoming, view.expectedLocalContent!),
    ).rejects.toThrow("空間不足");
  } finally {
    database.recoverySnapshots.hook("creating").unsubscribe(fail);
  }
  expect(await catalogRepository.read(current.workspaceId)).toEqual(current);
  expect(await database.workspaces.get(current.workspaceId)).toEqual(
    current.workspace,
  );
  expect(await database.recoverySnapshots.count()).toBe(0);
});
it("backup statuses distinguish initiated download from user confirmed saved revision", async () => {
  const s = await fixture();
  expect(backupReminder(undefined, s.revision)).toContain("尚未確認");
  const time = new Date().toISOString();
  await recordDownload(s.workspaceId, s.revision, time);
  expect(
    backupReminder(await database.backupStatus.get(s.workspaceId), s.revision),
  ).toContain("尚未確認");
  await confirmBackupSaved(s.workspaceId, time);
  const status = await database.backupStatus.get(s.workspaceId);
  expect(backupReminder(status, s.revision)).toBe("");
  expect(backupReminder(status, s.revision + 1)).toContain("更新");
  expect(
    backupReminder(status, s.revision, Date.now() + 8 * 86400000),
  ).toContain("七天");
  await recordDownload(
    s.workspaceId,
    s.revision + 1,
    new Date(Date.parse(time) + 1000).toISOString(),
  );
  await expect(confirmBackupSaved(s.workspaceId, time)).rejects.toThrow(
    "紀錄已變更",
  );
});
it("upgrades portable schema10 while retaining local safety tables", async () => {
  const w = {
      id: crypto.randomUUID(),
      name: "舊工作區",
      currency: "TWD" as const,
      timezone: "Asia/Taipei" as const,
      createdAt: new Date().toISOString(),
    },
    s = emptyCatalog(w),
    name = "recovery-migration-" + crypto.randomUUID();
  const old = new Dexie(name);
  old
    .version(10)
    .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" });
  await old.table("workspaces").add(w);
  const legacy: any = structuredClone(s);
  legacy.schemaVersion = 10;
  delete legacy.artworkExpenses;
  delete legacy.expensePayments;
  await old.table("catalogs").add(legacy);
  old.close();
  const upgraded = new ConMateDatabase(name);
  try {
    expect(await upgraded.catalogs.get(w.id)).toEqual(s);
    expect(await upgraded.backupStatus.count()).toBe(0);
    expect(await upgraded.recoverySnapshots.count()).toBe(0);
  } finally {
    await upgraded.delete();
  }
});
it("unknown or max revisions cannot replace local state", async () => {
  const current = await fixture();
  const incoming = { ...current, revision: Number.MAX_SAFE_INTEGER };
  const view = await previewWorkspaceRestore(incoming);
  await expect(
    replaceWorkspace(incoming, view.expectedLocalContent!),
  ).rejects.toThrow("安全範圍");
  await expect(restoreWorkspace(current)).rejects.toThrow("已有相同");
  expect(await database.recoverySnapshots.count()).toBe(0);
});
it("previews and restores old schema10 recovery snapshots after the finance upgrade", async () => {
  const current = await fixture();
  const legacy: any = structuredClone(current);
  legacy.schemaVersion = 10;
  delete legacy.artworkExpenses;
  delete legacy.expensePayments;
  legacy.workspace.name = "舊復原點";
  await database.recoverySnapshots.add({
    id: "old-recovery",
    workspaceId: current.workspaceId,
    createdAt: new Date().toISOString(),
    source: "file",
    restoredFromRevision: 0,
    restoredToRevision: current.revision,
    snapshot: legacy,
  });
  const row = await database.recoverySnapshots.get("old-recovery");
  const preview = await previewWorkspaceRestore(row!.snapshot);
  expect(preview.incoming.schemaVersion).toBe(19);
  expect(preview.incoming.artworkExpenses).toEqual([]);
  expect(preview.differences.some((d) => d.key === "expensePayments")).toBe(
    true,
  );
  await replaceWorkspace(
    preview.incoming,
    preview.expectedLocalContent!,
    "recovery",
  );
  const restored = await catalogRepository.read(current.workspaceId);
  expect(restored.workspace.name).toBe("舊復原點");
  expect(restored.expensePayments).toEqual([]);
  expect(await inspectProject(await exportProject(restored))).toEqual(restored);
});
