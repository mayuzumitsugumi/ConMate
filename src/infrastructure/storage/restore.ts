import { database } from "./workspaces";
import { emptyCatalog } from "./catalog";
import { validateRestoreSnapshot } from "../../domain/validation/restore";
import type { CatalogSnapshot } from "../../domain/models/catalog";
import type { RecoverySnapshot } from "./local-backups";
export async function restoreWorkspace(input: unknown) {
  const snapshot = validateRestoreSnapshot(structuredClone(input));
  await database.transaction(
    "rw",
    database.workspaces,
    database.catalogs,
    async () => {
      if (
        (await database.workspaces.get(snapshot.workspaceId)) ||
        (await database.catalogs.get(snapshot.workspaceId))
      )
        throw new Error(
          "本機已有相同工作區。請先預覽差異，再明確選擇取代；不會自動覆蓋或合併。",
        );
      await database.workspaces.add(snapshot.workspace);
      await database.catalogs.add(snapshot);
    },
  );
  return snapshot.workspaceId;
}
async function localSnapshot(workspaceId: string) {
  const workspace = await database.workspaces.get(workspaceId),
    catalog = await database.catalogs.get(workspaceId);
  if (!workspace) {
    if (catalog)
      throw new Error("本機工作區資料不完整，不能取代。請先保留備份並檢查。");
    return null;
  }
  return catalog ? { ...catalog, workspace } : emptyCatalog(workspace);
}
export interface RestoreDifference {
  key: string;
  label: string;
  added: number;
  changed: number;
  removed: number;
}
const groups = {
  products: "商品",
  parties: "創作者",
  projects: "企劃",
  events: "場次",
  projectEvents: "參場關聯",
  productTypes: "商品種類",
  specs: "規格",
  series: "系列",
  artworks: "柄圖",
  tags: "標記",
  fields: "自訂欄位",
  locations: "庫位",
  movements: "庫存異動",
  movementTypes: "異動類型",
  onlineListings: "通販對照",
  sales: "交易",
  salePlans: "販售方案",
  stocktakes: "盤點單",
  refunds: "退款退貨",
  costs: "成本",
  advances: "代墊",
  artworkExpenses: "柄圖費來源與分攤版本",
  expensePayments: "廠商實際付款",
} as const;
export async function previewWorkspaceRestore(input: unknown) {
  const incoming = validateRestoreSnapshot(structuredClone(input));
  const local = await database.transaction(
    "r",
    database.workspaces,
    database.catalogs,
    () => localSnapshot(incoming.workspaceId),
  );
  const differences: RestoreDifference[] = [];
  if (local)
    for (const [key, label] of Object.entries(groups)) {
      const before = new Map(
        (local[key as keyof typeof groups] as { id: string }[]).map((r) => [
          r.id,
          JSON.stringify(r),
        ]),
      );
      let added = 0,
        changed = 0;
      for (const r of incoming[key as keyof typeof groups]) {
        if (!before.has(r.id)) added++;
        else if (before.get(r.id) !== JSON.stringify(r)) changed++;
        before.delete(r.id);
      }
      differences.push({ key, label, added, changed, removed: before.size });
    }
  return {
    incoming,
    local,
    expectedLocalContent: local ? JSON.stringify(local) : null,
    differences,
  };
}
export async function replaceWorkspace(
  input: unknown,
  expectedLocalContent: string,
  source: "file" | "recovery" = "file",
) {
  const incoming = validateRestoreSnapshot(structuredClone(input));
  return database.transaction(
    "rw",
    database.workspaces,
    database.catalogs,
    database.recoverySnapshots,
    async () => {
      const current = await localSnapshot(incoming.workspaceId);
      if (!current || JSON.stringify(current) !== expectedLocalContent)
        throw new Error(
          "本機資料在預覽後已改變，請重新檢查差異；原資料未更動。",
        );
      const revision = Math.max(current.revision, incoming.revision) + 1;
      if (!Number.isSafeInteger(revision))
        throw new Error("修訂超出安全範圍，不能取代。");
      const recovery: RecoverySnapshot = {
        id: crypto.randomUUID(),
        workspaceId: incoming.workspaceId,
        createdAt: new Date().toISOString(),
        source,
        restoredFromRevision: incoming.revision,
        restoredToRevision: revision,
        snapshot: current,
      };
      const next = { ...incoming, revision };
      await database.recoverySnapshots.add(recovery);
      await database.workspaces.put(next.workspace);
      await database.catalogs.put(next);
      return {
        workspaceId: next.workspaceId,
        recoveryId: recovery.id,
        revision,
      };
    },
  );
}
