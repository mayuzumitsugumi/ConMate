import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import {
  database,
  workspaceRepository,
} from "../../src/infrastructure/storage/workspaces";
import { catalogRepository } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import { putEvent } from "../../src/domain/catalog/projects";
import {
  addLocation,
  addMovement,
  balance,
} from "../../src/domain/inventory/operations";
import {
  createHandoff,
  readActivity,
  changeActivity,
  closeActivity,
  previewActivityImport,
  saveImportedActivity,
  mergeActivity,
  returnActivityStock,
  packetFingerprint,
} from "../../src/application/activities";
async function fixture() {
  const w = await workspaceRepository.create("創作工作區");
  let productId = "",
    sourceId = "",
    eventId = "";
  const s = await catalogRepository.change(w.id, 0, (s) => {
    productId = putProduct(s, {
      name: "徽章",
      productType: "徽章",
      specification: "",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    }).id;
    sourceId = addLocation(s, "原庫位").id;
    eventId = putEvent(s, {
      name: "市集",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      venue: "",
      notes: "",
      projectIds: [],
    }).id;
    addMovement(s, {
      productId,
      kind: "receipt",
      quantity: 10,
      fromLocationId: "",
      toLocationId: sourceId,
      reason: "製作",
    });
  });
  const p = await createHandoff(w.id, s.revision, {
    name: "第一份",
    eventId,
    sourceLocationId: sourceId,
    lines: [{ productId, quantity: 4 }],
    planIds: [],
    collectorIds: [],
  });
  return { w, p, productId, sourceId, eventId };
}
afterEach(async () => {
  await database.activityPackets.clear();
  await database.recoverySnapshots.clear();
  await database.catalogs.clear();
  await database.workspaces.clear();
});
it("atomically allocates, locks creator stock and saves progress in complete workspace", async () => {
  const { w, p, productId, sourceId } = await fixture();
  let s = await catalogRepository.read(w.id);
  expect(balance(s, productId, sourceId)).toBe(6);
  await expect(
    catalogRepository.change(w.id, s.revision, (s) =>
      addMovement(s, {
        productId,
        kind: "adjust-in",
        quantity: 1,
        fromLocationId: "",
        toLocationId: p.locationId,
        reason: "非法追加",
      }),
    ),
  ).rejects.toThrow("已交付活動");
  const next = await changeActivity(p.handoffId, 0, {
    type: "decrease",
    productId,
    quantity: 1,
    kind: "free",
    reason: "無料",
  });
  expect(next.lineage).toHaveLength(1);
  s = await catalogRepository.read(w.id);
  expect(s.activityHandoffs[0]!.localPacket?.snapshot.movements.length).toBe(2);
  expect((await readActivity(p.handoffId)).revision).toBe(1);
  await expect(
    changeActivity(p.handoffId, 0, {
      type: "decrease",
      productId,
      quantity: 1,
      kind: "free",
      reason: "舊版",
    }),
  ).rejects.toThrow("更新");
});
it("rejects divergent imports and writes after closure", async () => {
  const { p, productId } = await fixture();
  const next = await changeActivity(p.handoffId, 0, {
    type: "decrease",
    productId,
    quantity: 1,
    kind: "free",
    reason: "免費",
  });
  expect((await previewActivityImport(p)).canImport).toBe(false);
  await expect(saveImportedActivity(p)).rejects.toThrow("分歧");
  const closed = await closeActivity(
    p.handoffId,
    next.revision,
    [{ productId, actual: 3, reason: "" }],
    "結案",
  );
  expect(closed.closure).toBeTruthy();
  await expect(
    changeActivity(p.handoffId, closed.revision, {
      type: "add-product",
      name: "追加",
      quantity: 1,
      reason: "追加",
    }),
  ).rejects.toThrow("唯讀");
});
it("merges once and requires separate physical return", async () => {
  const { w, p, productId, sourceId, eventId } = await fixture();
  const next = await changeActivity(p.handoffId, 0, {
    type: "sale",
    input: {
      operationId: crypto.randomUUID(),
      locationId: p.locationId,
      eventId,
      collectorId: "",
      cashReceived: 50,
      notes: "",
      lines: [{ productId, mode: "direct", quantity: 1, unitPrice: 50 }],
    },
  });
  await closeActivity(
    p.handoffId,
    next.revision,
    [{ productId, actual: 3, reason: "" }],
    "",
  );
  let s = await catalogRepository.read(w.id);
  await mergeActivity(w.id, s.revision, p.handoffId, {});
  s = await catalogRepository.read(w.id);
  expect(s.sales).toHaveLength(1);
  expect(balance(s, productId, p.locationId)).toBe(3);
  expect(balance(s, productId, sourceId)).toBe(6);
  const n = s.movements.length;
  await mergeActivity(w.id, s.revision, p.handoffId, {});
  s = await catalogRepository.read(w.id);
  expect(s.movements).toHaveLength(n);
  await returnActivityStock(
    w.id,
    s.revision,
    p.handoffId,
    sourceId,
    "已收到實物",
  );
  s = await catalogRepository.read(w.id);
  expect(balance(s, productId, sourceId)).toBe(9);
  expect(await database.recoverySnapshots.count()).toBe(1);
});
it("rolls back over-allocation and imports only known descendants", async () => {
  const { w, p, productId, sourceId, eventId } = await fixture();
  const before = await catalogRepository.read(w.id);
  await expect(
    createHandoff(w.id, before.revision, {
      name: "超額",
      eventId,
      sourceLocationId: sourceId,
      lines: [{ productId, quantity: 7 }],
      planIds: [],
      collectorIds: [],
    }),
  ).rejects.toThrow("不足");
  expect(await catalogRepository.read(w.id)).toEqual(before);
  const { applyActivityCommand } =
    await import("../../src/domain/activity/operations");
  const next = applyActivityCommand(p, {
    type: "decrease",
    productId,
    quantity: 1,
    kind: "free",
    reason: "異地",
  });
  next.lineage = [await packetFingerprint(p)];
  expect((await previewActivityImport(next)).canImport).toBe(true);
  await saveImportedActivity(next, p.revision);
  expect((await readActivity(p.handoffId)).revision).toBe(1);
  const fake = structuredClone(next);
  fake.baseline.workspace.name = "改過";
  fake.snapshot.workspace.name = "改過";
  fake.revision++;
  expect((await previewActivityImport(fake)).canImport).toBe(false);
});
it("keeps unrelated creator work while merging disjoint handoff shares", async () => {
  const { w, p, productId, sourceId, eventId } = await fixture();
  let s = await catalogRepository.read(w.id);
  const second = await createHandoff(w.id, s.revision, {
    name: "第二份",
    eventId,
    sourceLocationId: sourceId,
    lines: [{ productId, quantity: 3 }],
    planIds: [],
    collectorIds: [],
  });
  s = await catalogRepository.read(w.id);
  await catalogRepository.change(w.id, s.revision, (s) => {
    putProduct(s, {
      name: "未參加商品",
      productType: "",
      specification: "",
      artwork: "",
      notes: "私人",
      tagIds: [],
      customValues: {},
    });
    addMovement(s, {
      productId,
      kind: "receipt",
      quantity: 10,
      fromLocationId: "",
      toLocationId: sourceId,
      reason: "再販",
    });
  });
  for (const packet of [p, second]) {
    const q = packet.sources.reduce((n, r) => n + r.quantity, 0),
      sold = await changeActivity(packet.handoffId, 0, {
        type: "sale",
        input: {
          operationId: crypto.randomUUID(),
          locationId: packet.locationId,
          eventId,
          collectorId: "",
          cashReceived: 50,
          notes: "",
          lines: [{ productId, mode: "direct", quantity: 1, unitPrice: 50 }],
        },
      });
    await closeActivity(
      packet.handoffId,
      sold.revision,
      [{ productId, actual: q - 1, reason: "" }],
      "",
    );
    s = await catalogRepository.read(w.id);
    await mergeActivity(w.id, s.revision, packet.handoffId, {});
  }
  s = await catalogRepository.read(w.id);
  expect(s.activityMerges).toHaveLength(2);
  expect(s.sales).toHaveLength(2);
  expect(s.products.some((p) => p.notes === "私人")).toBe(true);
  expect(balance(s, productId, sourceId)).toBe(13);
});
it("uses dispatch cost versions and permits append-only creator refunds", async () => {
  const { w, productId, sourceId, eventId } = await fixture();
  const { putCost } = await import("../../src/domain/finance/operations");
  const { saveBatchCost, batchCostReport } =
    await import("../../src/domain/finance/batch-costs");
  const { cancelSale } = await import("../../src/domain/sales/operations");
  const { refundSale } = await import("../../src/domain/sales/refunds");
  let s = await catalogRepository.read(w.id),
    costId = "";
  s = await catalogRepository.change(w.id, s.revision, (s) => {
    putCost(s, {
      name: "成本",
      productId,
      quantity: 10,
      estimatedPrint: 100,
      actualPrint: 100,
      artworkAllocated: 0,
      otherCost: 0,
      unitSalePrice: 50,
      paidById: "",
      burdenPartyId: "",
      notes: "",
    });
    const c = s.costs.at(-1)!;
    costId = c.id;
    saveBatchCost(
      s,
      s.movements.find((m) => m.kind === "receipt")!.id,
      c.id,
      "交付前",
    );
  });
  const p = await createHandoff(w.id, s.revision, {
    name: "成本份",
    eventId,
    sourceLocationId: sourceId,
    lines: [{ productId, quantity: 2 }],
    planIds: [],
    collectorIds: [],
  });
  s = await catalogRepository.read(w.id);
  await catalogRepository.change(w.id, s.revision, (s) => {
    const c = s.costs.find((c) => c.id === costId)!;
    putCost(s, { ...c, actualPrint: 200 }, c.id);
    saveBatchCost(
      s,
      s.movements.find((m) => m.kind === "receipt")!.id,
      c.id,
      "後來修改",
    );
  });
  const sold = await changeActivity(p.handoffId, 0, {
    type: "sale",
    input: {
      operationId: crypto.randomUUID(),
      locationId: p.locationId,
      eventId,
      collectorId: "",
      cashReceived: 50,
      notes: "",
      lines: [{ productId, mode: "direct", quantity: 1, unitPrice: 50 }],
    },
  });
  await closeActivity(
    p.handoffId,
    sold.revision,
    [{ productId, actual: 1, reason: "" }],
    "",
  );
  s = await catalogRepository.read(w.id);
  await mergeActivity(w.id, s.revision, p.handoffId, {});
  s = await catalogRepository.read(w.id);
  expect(batchCostReport(s).sales[0]!.knownCost).toBe("10.0000");
  await expect(
    catalogRepository.change(w.id, s.revision, (s) =>
      cancelSale(s, s.sales[0]!.id, "錯誤修改"),
    ),
  ).rejects.toThrow("新增退款");
  s = await catalogRepository.change(w.id, s.revision, (s) => {
    const sale = s.sales[0]!;
    refundSale(s, {
      operationId: crypto.randomUUID(),
      saleId: sale.id,
      reason: "結案後退款",
      lines: [
        {
          saleLineId: sale.lines[0]!.id,
          amount: 50,
          restockQuantity: 1,
          damagedQuantity: 0,
          returnLocationId: p.locationId,
        },
      ],
    });
  });
  expect(batchCostReport(s).sales[0]!.netKnownCost).toBe("0.0000");
  const { validateRestoreSnapshot } =
    await import("../../src/domain/validation/restore");
  expect(validateRestoreSnapshot(structuredClone(s)).refunds).toHaveLength(1);
});
