import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import { putEvent } from "../../src/domain/catalog/projects";
import { putCost } from "../../src/domain/finance/operations";
import {
  addLocation,
  addMovement,
  balance,
} from "../../src/domain/inventory/operations";
import {
  prepareHandoff,
  applyActivityCommand,
  closeActivityPacket,
  mergeActivityPacket,
  previewActivityMerge,
  validateActivityPacket,
  returnActivityStock,
} from "../../src/domain/activity/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "私人工作區",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const product = putProduct(s, {
      name: "徽章",
      productType: "徽章",
      specification: "",
      artwork: "",
      notes: "PRIVATE-NOTE",
      tagIds: [],
      customValues: {},
    }),
    home = addLocation(s, "私人住所"),
    event = putEvent(s, {
      name: "活動",
      startDate: "2026-11-03",
      endDate: "2026-11-04",
      venue: "",
      notes: "PRIVATE-EVENT-NOTE",
      projectIds: [],
    });
  addMovement(s, {
    productId: product.id,
    kind: "receipt",
    quantity: 10,
    fromLocationId: "",
    toLocationId: home.id,
    reason: "PRIVATE-RECEIPT",
  });
  const input = {
    name: "甲交接",
    eventId: event.id,
    sourceLocationId: home.id,
    lines: [{ productId: product.id, quantity: 6 }],
    planIds: [],
    collectorIds: [],
  };
  return { s, product, home, event, input };
}
function sale(
  p: ReturnType<typeof prepareHandoff>["packet"],
  id: string,
  q = 2,
) {
  return applyActivityCommand(p, {
    type: "sale",
    input: {
      operationId: crypto.randomUUID(),
      locationId: p.locationId,
      eventId: p.eventId,
      collectorId: "",
      cashReceived: q * 100,
      notes: "",
      lines: [{ productId: id, mode: "direct", quantity: q, unitPrice: 100 }],
    },
  });
}
function close(p: ReturnType<typeof prepareHandoff>["packet"]) {
  return closeActivityPacket(
    p,
    p.snapshot.products.map((r) => ({
      productId: r.id,
      actual: balance(p.snapshot, r.id, p.locationId),
      reason: "",
    })),
    "",
  );
}
it("isolates private data and maintains delivery conservation", () => {
  const { s, product, home, input } = fixture(),
    { packet } = prepareHandoff(s, input);
  expect(balance(s, product.id, home.id)).toBe(4);
  expect(balance(s, product.id, packet.locationId)).toBe(6);
  for (const secret of [
    "PRIVATE-NOTE",
    "PRIVATE-EVENT-NOTE",
    "PRIVATE-RECEIPT",
    "私人工作區",
    "私人住所",
  ])
    expect(JSON.stringify(packet)).not.toContain(secret);
  expect(packet.snapshot.costs).toEqual([]);
  expect(packet.snapshot.activityHandoffs).toEqual([]);
  expect(() =>
    prepareHandoff(s, {
      ...input,
      name: "乙",
      lines: [{ productId: product.id, quantity: 5 }],
    }),
  ).toThrow("不足");
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("requires full counts and no draft; closed commands stay readonly", () => {
  const { s, product, input } = fixture();
  let { packet } = prepareHandoff(s, input);
  expect(() => closeActivityPacket(packet, [], "")).toThrow("所有");
  packet = applyActivityCommand(packet, {
    type: "draft",
    lines: [
      { productId: product.id, quantity: 1, unitPrice: 100, mode: "direct" },
    ],
  });
  expect(() => close(packet)).toThrow("草稿");
  packet = applyActivityCommand(packet, { type: "draft", lines: [] });
  packet = close(packet);
  expect(() => sale(packet, product.id)).toThrow("唯讀");
  expect(() => close(packet)).toThrow("唯讀");
});
it("merges final records once, preserving independent work and initial stock", () => {
  const { s, product, home, input } = fixture();
  let { packet } = prepareHandoff(s, input);
  packet = sale(packet, product.id);
  expect(() => previewActivityMerge(s, packet)).toThrow("尚未結案");
  addMovement(s, {
    productId: product.id,
    kind: "receipt",
    quantity: 3,
    fromLocationId: "",
    toLocationId: home.id,
    reason: "期間追加",
  });
  packet = close(packet);
  const before = s.movements.length,
    result = mergeActivityPacket(s, packet, {});
  expect(balance(s, product.id, home.id)).toBe(7);
  expect(balance(s, product.id, packet.locationId)).toBe(4);
  expect(s.movements.length).toBe(before + 1);
  expect(mergeActivityPacket(s, packet, {}).id).toBe(result.id);
  expect(s.sales).toHaveLength(1);
  returnActivityStock(s, packet.handoffId, home.id, "已收到實物");
  expect(balance(s, product.id, home.id)).toBe(11);
  expect(() =>
    returnActivityStock(s, packet.handoffId, home.id, "再次"),
  ).toThrow("已完成");
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("maps added same SKU while preserving actual independent batch sources", () => {
  const { s, product, input } = fixture();
  let { packet } = prepareHandoff(s, input);
  packet = applyActivityCommand(packet, {
    type: "add-product",
    name: "同款追加",
    quantity: 3,
    reason: "現場帶入",
  });
  const added = packet.additions[0]!.productId;
  packet = close(sale(packet, added, 2));
  mergeActivityPacket(s, packet, { [added]: product.id });
  expect(balance(s, product.id, packet.locationId)).toBe(7);
  expect(s.products).toHaveLength(1);
  expect(validateRestoreSnapshot(s)).toEqual(s);
  s.movements.at(-1)!.batchAllocations[0]!.quantity = 1;
  expect(() => validateRestoreSnapshot(s)).toThrow();
});
it("rejects changed original quantities and divergent repeated closure", () => {
  const { s, product, input } = fixture(),
    { packet } = prepareHandoff(s, input),
    bad = structuredClone(packet);
  bad.snapshot.movements[0]!.quantity++;
  expect(() => validateActivityPacket(bad)).toThrow();
  const final = close(sale(packet, product.id));
  mergeActivityPacket(s, final, {});
  const divergent = structuredClone(final);
  divergent.closure!.notes = "不同內容";
  expect(() => mergeActivityPacket(s, divergent, {})).toThrow("不同結案");
});
it("refund original batches and permit pending discrepancy without fabricating stock", () => {
  const { s, product, input } = fixture();
  let { packet } = prepareHandoff(s, input);
  packet = sale(packet, product.id, 3);
  const original = packet.snapshot.sales[0]!;
  packet = applyActivityCommand(packet, {
    type: "refund",
    input: {
      operationId: crypto.randomUUID(),
      saleId: original.id,
      reason: "退回",
      lines: [
        {
          saleLineId: original.lines[0]!.id,
          amount: 100,
          restockQuantity: 1,
          damagedQuantity: 0,
          returnLocationId: packet.locationId,
        },
      ],
    },
  });
  packet = closeActivityPacket(
    packet,
    [{ productId: product.id, actual: 3, reason: "少一待查" }],
    "待查",
  );
  mergeActivityPacket(s, packet, {});
  expect(balance(s, product.id, packet.locationId)).toBe(4);
  expect(packet.closure!.salesTotal).toBe(300);
  expect(packet.closure!.refundTotal).toBe(100);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("merges disjoint portions independently despite new creator production", () => {
  const { s, product, home, input } = fixture(),
    a = prepareHandoff(s, input).packet,
    b = prepareHandoff(s, {
      ...input,
      name: "乙",
      lines: [{ productId: product.id, quantity: 4 }],
    }).packet;
  addMovement(s, {
    productId: product.id,
    kind: "receipt",
    quantity: 5,
    fromLocationId: "",
    toLocationId: home.id,
    reason: "新製作",
  });
  mergeActivityPacket(s, close(sale(a, product.id, 2)), {});
  mergeActivityPacket(s, close(sale(b, product.id, 1)), {});
  expect(s.activityMerges).toHaveLength(2);
  expect(s.sales).toHaveLength(2);
  expect(balance(s, product.id, home.id)).toBe(5);
  expect(balance(s, product.id, a.locationId)).toBe(4);
  expect(balance(s, product.id, b.locationId)).toBe(3);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("rejects extra stock, private costs and direct source product mutation", () => {
  const { s, product, input } = fixture(),
    { packet } = prepareHandoff(s, input),
    extra = structuredClone(packet);
  addMovement(extra.snapshot, {
    productId: product.id,
    kind: "receipt",
    quantity: 1,
    fromLocationId: "",
    toLocationId: packet.locationId,
    reason: "偷偷追加",
  });
  expect(() => validateActivityPacket(extra)).toThrow("增加既有");
  const changed = structuredClone(packet);
  changed.snapshot.products[0]!.name = "改掉";
  expect(() => validateActivityPacket(changed)).toThrow("來源不得");
  const finance = structuredClone(packet);
  finance.snapshot.costs.push({} as any);
  expect(() => validateActivityPacket(finance)).toThrow("私人財務");
});
it("cannot forge imported movement list to bypass FIFO safety", () => {
  const { s, product, input } = fixture();
  let { packet } = prepareHandoff(s, input);
  packet = close(sale(packet, product.id));
  mergeActivityPacket(s, packet, {});
  s.activityMerges[0]!.createdMovementIds.push(s.movements[0]!.id);
  expect(() => validateRestoreSnapshot(s)).toThrow("清單與活動來源");
});
it("cancellation and cash correction totals reflect actual corrected amounts", () => {
  const { s, product, input } = fixture();
  let { packet } = prepareHandoff(s, input);
  packet = sale(packet, product.id, 1);
  packet = applyActivityCommand(packet, {
    type: "cancel-sale",
    id: packet.snapshot.sales[0]!.id,
    reason: "全額退回",
  });
  packet = applyActivityCommand(packet, {
    type: "cash",
    input: {
      kind: "expense",
      amount: 200,
      payerId: "",
      recipientId: "",
      reason: "場地支出",
      correctsId: "",
    },
  });
  packet = applyActivityCommand(packet, {
    type: "cash",
    input: {
      kind: "correction",
      amount: 150,
      payerId: "",
      recipientId: "",
      reason: "正確150",
      correctsId: packet.cashEntries[0]!.id,
    },
  });
  packet = close(packet);
  expect(packet.closure!.salesTotal).toBe(100);
  expect(packet.closure!.refundTotal).toBe(100);
  expect(packet.closure!.expensesTotal).toBe(150);
  expect(packet.cashEntries).toHaveLength(2);
});
it("failed preparation rolls back even late financial validation", () => {
  const { s, input } = fixture(),
    original = structuredClone(s);
  expect(() =>
    prepareHandoff(s, {
      ...input,
      financialReferences: [{ kind: "costs", id: "missing" }],
    }),
  ).toThrow();
  expect(s).toEqual(original);
});
it("explicit financial reference exports safe scoped fields without private notes", () => {
  const { s, product, input } = fixture();
  putCost(s, {
    name: "成本",
    productId: product.id,
    quantity: 10,
    estimatedPrint: 1000,
    actualPrint: 800,
    artworkAllocated: 0,
    otherCost: 0,
    unitSalePrice: 100,
    paidById: "",
    burdenPartyId: "",
    notes: "PRIVATE-FINANCE-NOTE",
  });
  const c = s.costs.at(-1)!,
    { packet } = prepareHandoff(s, {
      ...input,
      financialReferences: [{ kind: "costs", id: c.id }],
    });
  expect(packet.financialReferences).toHaveLength(1);
  expect(JSON.stringify(packet)).not.toContain("PRIVATE-FINANCE-NOTE");
  expect((packet.financialReferences[0]!.data as any).actualPrint).toBe(800);
  expect(packet.snapshot.costs).toHaveLength(0);
});
it("name revisions preserve original master and historical transaction name", () => {
  const { s, product, input } = fixture();
  let { packet } = prepareHandoff(s, input);
  packet = sale(packet, product.id, 1);
  packet = applyActivityCommand(packet, {
    type: "rename-product",
    id: product.id,
    name: "活動展示名",
    reason: "方便辨識",
  });
  expect(packet.baseline.products[0]!.name).toBe("徽章");
  expect(packet.snapshot.sales[0]!.lines[0]!.productName).toBe("徽章");
  packet = sale(packet, product.id, 1);
  expect(packet.snapshot.sales[1]!.lines[0]!.productName).toBe("活動展示名");
  packet = close(packet);
  mergeActivityPacket(s, packet, {});
  expect(s.products[0]!.name).toBe("徽章");
  expect(s.sales[1]!.lines[0]!.productName).toBe("活動展示名");
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
