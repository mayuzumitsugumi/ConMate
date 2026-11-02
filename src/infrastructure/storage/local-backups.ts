import { database } from "./workspaces";
import type { CatalogSnapshot } from "../../domain/models/catalog";
export interface RecoverySnapshot {
  id: string;
  workspaceId: string;
  createdAt: string;
  source: "file" | "recovery";
  restoredFromRevision: number;
  restoredToRevision: number;
  snapshot: CatalogSnapshot;
}
export interface BackupStatus {
  workspaceId: string;
  downloadedRevision?: number;
  downloadedAt?: string;
  confirmedRevision?: number;
  confirmedAt?: string;
}
export async function recordDownload(
  workspaceId: string,
  revision: number,
  initiatedAt: string,
) {
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !Number.isFinite(Date.parse(initiatedAt))
  )
    throw new Error("備份下載紀錄格式不正確。");
  await database.transaction("rw", database.backupStatus, async () => {
    const old = await database.backupStatus.get(workspaceId);
    await database.backupStatus.put({
      ...old,
      workspaceId,
      downloadedRevision: revision,
      downloadedAt: initiatedAt,
    });
  });
}
export async function confirmBackupSaved(
  workspaceId: string,
  downloadedAt: string,
) {
  await database.transaction("rw", database.backupStatus, async () => {
    const status = await database.backupStatus.get(workspaceId);
    if (
      !status ||
      status.downloadedAt !== downloadedAt ||
      status.downloadedRevision === undefined
    )
      throw new Error("下載紀錄已變更，請重新檢視後確認。");
    await database.backupStatus.put({
      ...status,
      confirmedRevision: status.downloadedRevision,
      confirmedAt: new Date().toISOString(),
    });
  });
}
export function backupReminder(
  status: BackupStatus | undefined,
  revision: number,
  now = Date.now(),
) {
  if (status?.confirmedRevision === undefined)
    return "尚未確認外部備份。請匯出專案檔，確認已保存後再登記。";
  if (status.confirmedRevision !== revision)
    return "目前資料有尚未確認備份的更新，建議再匯出一份專案檔。";
  if (
    !status.confirmedAt ||
    !Number.isFinite(Date.parse(status.confirmedAt)) ||
    now - Date.parse(status.confirmedAt) >= 7 * 86400000
  )
    return "距離上次確認備份已超過七天，請檢查備份檔仍可使用。";
  return "";
}
