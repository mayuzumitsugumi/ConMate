import "fake-indexeddb/auto";
import { afterEach, it, expect } from "vitest";
import { database } from "../../src/infrastructure/storage/workspaces";
import {
  backupReminder,
  recordCloudBackup,
} from "../../src/infrastructure/storage/local-backups";
afterEach(async () => {
  await database.backupStatus.clear();
});
it("records only successful metadata and leaves download confirmation distinct", async () => {
  const cloud = {
    revision: 3,
    at: new Date().toISOString(),
    commit: "a".repeat(40),
    owner: "owner",
    repo: "private",
    branch: "main",
    path: "conmate/workspaces/w/project.xlsx",
  };
  await recordCloudBackup("w", { ...cloud, token: "must-not-store" } as any);
  const saved = await database.backupStatus.get("w");
  expect(saved?.cloud).toEqual(cloud);
  expect(JSON.stringify(saved)).not.toContain("must-not-store");
  expect(saved?.confirmedRevision).toBeUndefined();
  expect(backupReminder(saved, 3)).toBe("");
  expect(backupReminder(saved, 4)).not.toBe("");
  expect(backupReminder(saved, 3, Date.now() + 8 * 86400000)).not.toBe("");
});
it("rejects incomplete provider success without marking a backup", async () => {
  await expect(
    recordCloudBackup("w", {
      revision: 1,
      at: "invalid",
      commit: "",
      owner: "o",
      repo: "r",
      branch: "main",
      path: "p",
    }),
  ).rejects.toThrow("不完整");
  expect(await database.backupStatus.get("w")).toBeUndefined();
});
