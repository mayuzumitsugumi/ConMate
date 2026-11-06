import "fake-indexeddb/auto";
import Dexie from "dexie";
import { it, expect } from "vitest";
import { ConMateDatabase } from "../../src/infrastructure/storage/workspaces";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putParty } from "../../src/domain/catalog/masterdata";
import { putProduct } from "../../src/domain/catalog/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
it("upgrades schema21 into schema22 without inventing orders or changing original recovery data", async () => {
  const workspace = {
    id: crypto.randomUUID(),
    name: "原工作區",
    currency: "TWD" as const,
    timezone: "Asia/Taipei" as const,
    createdAt: "2026-01-01T00:00:00Z",
  };
  const current = emptyCatalog(workspace);
  const owner = putParty(current, { name: "原創作者", notes: "保留" });
  const product = putProduct(current, {
    name: "原商品",
    creatorId: owner.id,
    productType: "徽章",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  current.revision = 42;
  const old = { ...current, schemaVersion: 21 } as Record<string, any>;
  delete old.preorders;
  const name = "preorders-upgrade-" + crypto.randomUUID(),
    previous = new Dexie(name);
  previous.version(22).stores({
    workspaces: "id, createdAt",
    catalogs: "workspaceId",
    recoverySnapshots: "id, workspaceId, createdAt",
    backupStatus: "workspaceId",
    activityPackets: "handoffId, sourceWorkspaceId, eventId",
  });
  await previous.table("workspaces").add(workspace);
  await previous.table("catalogs").add(old);
  await previous.table("recoverySnapshots").add({
    id: "original-recovery",
    workspaceId: workspace.id,
    createdAt: "2026-01-01T00:00:00Z",
    source: "file",
    restoredFromRevision: 40,
    restoredToRevision: 42,
    snapshot: structuredClone(old),
  });
  previous.close();
  const next = new ConMateDatabase(name);
  try {
    const got = await next.catalogs.get(workspace.id);
    expect(got).toEqual({ ...old, schemaVersion: 22, preorders: [] });
    expect(got!.products[0]!.id).toBe(product.id);
    expect(got!.parties[0]!.id).toBe(owner.id);
    expect(
      (await next.recoverySnapshots.get("original-recovery"))!.snapshot,
    ).toEqual(old);
    expect(validateRestoreSnapshot(structuredClone(old))).toEqual({
      ...old,
      schemaVersion: 22,
      preorders: [],
    });
  } finally {
    await next.delete();
  }
});

it("backs up preorder terms and actual receipts in readable sheets and restores the complete source", async () => {
  const { createPreorder, receivePreorder } =
    await import("../../src/domain/preorder/operations");
  const { exportProject, buildProjectWorkbook } =
    await import("../../src/infrastructure/excel/project");
  const { inspectProject } =
    await import("../../src/infrastructure/excel/restore");
  const snapshot = emptyCatalog({
    id: crypto.randomUUID(),
    name: "預售備份測試",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const product = putProduct(snapshot, {
    name: "預售徽章",
    productType: "徽章",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const order = createPreorder(snapshot, {
    operationId: crypto.randomUUID(),
    name: "虛構訂單",
    customerReference: "虛構顧客代稱",
    notes: "不含個人資料",
    lines: [{ productId: product.id, quantity: 2, unitPrice: 100 }],
  });
  receivePreorder(snapshot, order.id, {
    operationId: crypto.randomUUID(),
    amount: 50,
    partyId: "",
    occurredAt: new Date(Date.now() - 60000).toISOString(),
    reason: "已確認收到訂金",
  });
  const book = await buildProjectWorkbook(snapshot);
  expect(book.getWorksheet("43_預售訂單")!.getRow(2).getCell(4).value).toBe(
    200,
  );
  expect(book.getWorksheet("43_預售訂單")!.getRow(2).getCell(9).value).toBe(50);
  expect(book.getWorksheet("43_預售訂單")!.getRow(2).getCell(10).value).toBe(
    150,
  );
  expect(book.getWorksheet("44_預售品項")!.getRow(2).getCell(8).value).toBe(2);
  expect(book.getWorksheet("45_預售實際收退")!.getRow(2).getCell(4).value).toBe(
    50,
  );
  expect(book.getWorksheet("46_預售交付")).toBeUndefined();
  expect(await inspectProject(await exportProject(snapshot))).toEqual(snapshot);
});
