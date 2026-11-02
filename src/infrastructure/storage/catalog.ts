import { database } from "./workspaces";
import type { CatalogSnapshot } from "../../domain/models/catalog";
import type { Workspace } from "../../domain/models/workspace";
export function emptyCatalog(workspace: Workspace): CatalogSnapshot {
  return {
    schemaVersion: 7,
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
    costs: [],
    advances: [],
  };
}
export const catalogRepository = {
  async read(workspaceId: string) {
    const workspace = await database.workspaces.get(workspaceId);
    if (!workspace) throw new Error("請先選擇一個本機工作區。");
    const existing = await database.catalogs.get(workspaceId);
    if (existing && existing.schemaVersion !== 7)
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
        operation(snapshot);
        snapshot.revision++;
        await database.catalogs.put(snapshot);
        return snapshot;
      },
    );
  },
};
