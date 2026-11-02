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
    this.version(3)
      .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 2)
              throw new Error("無法升級未知資料版本，原資料未刪除。");
            data.projects = data.projects.map(
              (p: { id: string; name: string }) => ({
                ...p,
                description: "",
                archived: false,
              }),
            );
            data.events = [];
            data.projectEvents = [];
            data.schemaVersion = 3;
          });
      });
    this.version(4)
      .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 3)
              throw new Error("不支援的資料版本，原始資料未刪除。");
            data.locations = [];
            data.movements = [];
            data.schemaVersion = 4;
          });
      });
    this.version(5)
      .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 4)
              throw new Error("不支援的資料版本，原始資料未刪除。");
            data.onlineListings = [];
            data.schemaVersion = 5;
          });
      });
    this.version(6)
      .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 5)
              throw new Error("不支援的資料版本，原始資料未刪除。");
            data.movementTypes = [];
            data.schemaVersion = 6;
          });
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
