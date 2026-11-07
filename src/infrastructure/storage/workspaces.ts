import type { ActivityPacket } from "../../domain/activity/types";
import { upgradeMasterData } from "../../domain/catalog/masterdata";
import { upgradeBatches } from "../../domain/inventory/batches";
import Dexie, { type EntityTable } from "dexie";
import type { CatalogSnapshot } from "../../domain/models/catalog";
import type { BackupStatus, RecoverySnapshot } from "./local-backups";
import type { Workspace } from "../../domain/models/workspace";

export class ConMateDatabase extends Dexie {
  activityPackets!: EntityTable<ActivityPacket, "handoffId">;
  workspaces!: EntityTable<Workspace, "id">;
  catalogs!: EntityTable<CatalogSnapshot, "workspaceId">;
  recoverySnapshots!: EntityTable<RecoverySnapshot, "id">;
  backupStatus!: EntityTable<BackupStatus, "workspaceId">;
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
    this.version(7)
      .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 6)
              throw new Error("不支援的資料版本，原始資料未刪除。");
            data.sales = [];
            data.costs = [];
            data.advances = [];
            data.schemaVersion = 7;
          });
      });
    this.version(8)
      .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 7)
              throw new Error("不支援的資料版本，原始資料未刪除。");
            data.salePlans = [];
            data.schemaVersion = 8;
          });
      });
    this.version(9)
      .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 8)
              throw new Error("不支援的資料版本，原始資料未刪除。");
            data.stocktakes = [];
            data.schemaVersion = 9;
          });
      });
    this.version(10)
      .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 9)
              throw new Error("不支援的資料版本，原始資料未刪除。");
            data.refunds = [];
            data.schemaVersion = 10;
          });
      });
    // Local safety metadata is not part of the portable workspace schema.
    this.version(11).stores({
      workspaces: "id, createdAt",
      catalogs: "workspaceId",
      recoverySnapshots: "id, workspaceId, createdAt",
      backupStatus: "workspaceId",
    });
    this.version(12)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 10)
              throw new Error("不支援的資料版本，原始資料未刪除。");
            data.artworkExpenses = [];
            data.expensePayments = [];
            data.schemaVersion = 11;
          });
      });
    this.version(13)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 11)
              throw new Error("不支援的資料版本，原始資料未刪除。");
            data.settlements = [];
            data.schemaVersion = 12;
          });
      });
    this.version(14)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 12) throw new Error("不支援資料版本。");
            upgradeBatches(data);
          });
      });
    this.version(15)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 13) throw new Error("不支援資料版本。");
            upgradeMasterData(data);
          });
      });
    this.version(16)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 14) throw new Error("不支援資料版本。");
            data.batchCostVersions = [];
            data.schemaVersion = 15;
          });
      });
    this.version(17)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 15) throw new Error("不支援資料版本。");
            data.internalAgreements = [];
            data.internalReceipts = [];
            data.schemaVersion = 16;
          });
      });
    this.version(18)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
        activityPackets: "handoffId, sourceWorkspaceId, eventId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 16) throw new Error("不支援資料版本。");
            data.activityHandoffs = [];
            data.activityMerges = [];
            data.schemaVersion = 17;
          });
      });
    this.version(19)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
        activityPackets: "handoffId, sourceWorkspaceId, eventId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 17) throw new Error("不支援資料版本。");
            data.inventoryReservations = [];
            data.schemaVersion = 18;
          });
      });
    this.version(20)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
        activityPackets: "handoffId, sourceWorkspaceId, eventId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 18) throw new Error("不支援資料版本。");
            data.physicalUnits = [];
            data.schemaVersion = 19;
          });
      });
    this.version(21)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
        activityPackets: "handoffId, sourceWorkspaceId, eventId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 19) throw new Error("不支援資料版本。");
            data.exchanges = [];
            data.schemaVersion = 20;
          });
      });
    this.version(22)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
        activityPackets: "handoffId, sourceWorkspaceId, eventId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 20) throw new Error("不支援資料版本。");
            data.schemaVersion = 21;
            data.consignments = [];
          });
      });
    this.version(23)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
        activityPackets: "handoffId, sourceWorkspaceId, eventId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 21) throw new Error("不支援資料版本。");
            data.schemaVersion = 22;
            data.preorders = [];
          });
      });
    this.version(24)
      .stores({
        workspaces: "id, createdAt",
        catalogs: "workspaceId",
        recoverySnapshots: "id, workspaceId, createdAt",
        backupStatus: "workspaceId",
        activityPackets: "handoffId, sourceWorkspaceId, eventId",
      })
      .upgrade(async (tx) => {
        await tx
          .table("catalogs")
          .toCollection()
          .modify((data) => {
            if (data.schemaVersion !== 22) throw new Error("不支援資料版本。");
            data.schemaVersion = 23;
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
