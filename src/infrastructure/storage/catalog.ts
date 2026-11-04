import { database } from "./workspaces";
import type { CatalogSnapshot } from "../../domain/models/catalog";
import type { Workspace } from "../../domain/models/workspace";
export function emptyCatalog(workspace: Workspace): CatalogSnapshot {
  return {
    schemaVersion: 20,
    exchanges: [],
    physicalUnits: [],
    inventoryReservations: [],
    activityHandoffs: [],
    activityMerges: [],
    internalAgreements: [],
    internalReceipts: [],
    batchCostVersions: [],
    batchTrackingStart: 0,
    workspaceId: workspace.id,
    workspace,
    revision: 0,
    counters: {},
    parties: [],
    projects: [],
    events: [],
    projectEvents: [],
    productTypes: [],
    specs: [],
    series: [],
    artworks: [],
    products: [],
    tags: [],
    fields: [],
    locations: [],
    movements: [],
    movementTypes: [],
    onlineListings: [],
    sales: [],
    salePlans: [],
    stocktakes: [],
    refunds: [],
    costs: [],
    advances: [],
    settlements: [],
    artworkExpenses: [],
    expensePayments: [],
  };
}
export const catalogRepository = {
  async read(workspaceId: string) {
    const workspace = await database.workspaces.get(workspaceId);
    if (!workspace) throw new Error("請先選擇一個本機工作區。");
    const existing = await database.catalogs.get(workspaceId);
    if (existing && existing.schemaVersion !== 20)
      throw new Error("資料版本較新或不支援，請更新網站；原始資料未刪除。 ");
    return existing ? { ...existing, workspace } : emptyCatalog(workspace);
  },
  async change(
    workspaceId: string,
    expectedRevision: number,
    operation: (snapshot: CatalogSnapshot) => void,
  ) {
    return database.transaction(
      "rw",
      database.workspaces,
      database.catalogs,
      async () => {
        const snapshot = await catalogRepository.read(workspaceId);
        if (snapshot.revision !== expectedRevision)
          throw new Error("資料已在其他畫面更新，請重新載入後再儲存。");
        if (!Number.isSafeInteger(snapshot.revision + 1))
          throw new Error("資料修訂已達安全上限，尚未儲存變更；請保留備份。");
        const locked = new Set(
          snapshot.activityHandoffs
            .filter(
              (h) => !snapshot.activityMerges.some((m) => m.handoffId === h.id),
            )
            .map((h) => h.locationId),
        );
        const protectedBefore = JSON.stringify(
          snapshot.movements.filter(
            (m) => locked.has(m.fromLocationId) || locked.has(m.toLocationId),
          ),
        );
        operation(snapshot);
        if (
          JSON.stringify(
            snapshot.movements.filter(
              (m) => locked.has(m.fromLocationId) || locked.has(m.toLocationId),
            ),
          ) !== protectedBefore
        )
          throw new Error(
            "此庫位已交付活動，請在活動工作台記錄；結案合回前不能從創作管理更動交付庫存。",
          );
        snapshot.revision++;
        await database.catalogs.put(snapshot);
        return snapshot;
      },
    );
  },
};
