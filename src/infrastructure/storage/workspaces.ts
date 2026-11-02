import Dexie, { type EntityTable } from "dexie";
import type { CatalogSnapshot } from "../../domain/models/catalog";
import type { Workspace } from "../../domain/models/workspace";

export class ConMateDatabase extends Dexie {
  workspaces!: EntityTable<Workspace, "id">;
  catalogs!: EntityTable<CatalogSnapshot, "workspaceId">;
  constructor(name = "conmate-workspaces-v1") {
    super(name);
    this.version(1).stores({ workspaces: "id, createdAt" });
    this.version(2).stores({
      workspaces: "id, createdAt",
      catalogs: "workspaceId",
    });
  }
}
export const database = new ConMateDatabase();
export const workspaceRepository = {
  list: () => database.workspaces.orderBy("createdAt").toArray(),
  async create(name: string): Promise<Workspace> {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 80)
      throw new Error("工作區名稱請填寫 1 至 80 個字。");
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: cleanName,
      currency: "TWD",
      timezone: "Asia/Taipei",
      createdAt: new Date().toISOString(),
    };
    await database.workspaces.add(workspace);
    return workspace;
  },
};
