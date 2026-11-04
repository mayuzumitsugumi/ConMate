import { it, expect } from "vitest";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import { putEvent } from "../../src/domain/catalog/projects";
import {
  addLocation,
  addMovement,
  balance,
  reverseMovement,
} from "../../src/domain/inventory/operations";
import {
  registerPhysicalUnits,
  unitStates,
} from "../../src/domain/inventory/units";
import { completeSale, cancelSale } from "../../src/domain/sales/operations";
import { refundSale } from "../../src/domain/sales/refunds";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
import {
  prepareHandoff,
  applyActivityCommand,
  closeActivityPacket,
  mergeActivityPacket,
  returnActivityStock,
} from "../../src/domain/activity/operations";
function fixture(quantity = 4, labels = ["親簽-A", "親簽-B"]) {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "單件測試",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const p = putProduct(s, {
    name: "親簽卡",
    productType: "卡片",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const home = addLocation(s, "家中"),
    other = addLocation(s, "活動");
  const receipt = addMovement(s, {
    productId: p.id,
    kind: "receipt",
    quantity,
    fromLocationId: "",
    toLocationId: home.id,
    reason: "入庫",
  });
  const units = labels.length
    ? registerPhysicalUnits(s, {
        productId: p.id,
        locationId: home.id,
        batchId: receipt.id,
        labels,
      })
    : [];
  const move = (
    quantity: number,
    unitIds?: string[],
    kind: "transfer" | "free" | "damage" = "transfer",
  ) =>
    addMovement(s, {
      productId: p.id,
      kind,
      quantity,
      fromLocationId: home.id,
      toLocationId: kind === "transfer" ? other.id : "",
      reason: "實物異動",
      ...(unitIds ? { unitIds } : {}),
    });
  const sell = (unitIds?: string[], quantity = unitIds?.length || 1) =>
    completeSale(s, {
      operationId: crypto.randomUUID(),
      locationId: home.id,
      eventId: "",
      collectorId: "",
      cashReceived: quantity * 100,
      notes: "",
      lines: [
        {
          productId: p.id,
          mode: "direct",
          quantity,
          unitPrice: 100,
          ...(unitIds ? { unitIds } : {}),
        },
      ],
    });
  return { s, p, home, other, receipt, units, move, sell };
}
it("registers existing stock without creating receipts and refuses over-registration or duplicate marks", () => {
  const f = fixture();
  expect(f.s.movements).toHaveLength(1);
  expect(balance(f.s, f.p.id, f.home.id)).toBe(4);
  expect(unitStates(f.s).map((u) => u.label)).toEqual(["親簽-A", "親簽-B"]);
  const register = (labels: string[]) =>
    registerPhysicalUnits(f.s, {
      productId: f.p.id,
      locationId: f.home.id,
      batchId: f.receipt.id,
      labels,
    });
  expect(() => register(["親簽-A"])).toThrow();
  expect(() => register(["C", "C"])).toThrow();
  expect(() => register(["C", "D", "E"])).toThrow();
  expect(f.s.physicalUnits).toHaveLength(2);
  validateRestoreSnapshot(f.s);
});
it("ordinary FIFO only consumes unmarked stock and cannot silently consume identified objects", () => {
  const f = fixture();
  f.move(2);
  expect(balance(f.s, f.p.id, f.home.id)).toBe(2);
  expect(() => f.move(1)).toThrow();
  expect(unitStates(f.s).every((u) => u.locationId === f.home.id)).toBe(true);
  validateRestoreSnapshot(f.s);
});
it("explicit transfers retain unit identity, original batch and unique location", () => {
  const f = fixture();
  const m = f.move(1, [f.units[1]!.id]);
  expect(m.batchAllocations).toEqual([{ batchId: f.receipt.id, quantity: 1 }]);
  expect(unitStates(f.s).find((u) => u.id === f.units[1]!.id)?.locationId).toBe(
    f.other.id,
  );
  expect(() => f.move(1, [f.units[1]!.id])).toThrow();
  validateRestoreSnapshot(f.s);
});
it("rejects duplicate unit selection, quantity mismatch and wrong-product unit", () => {
  const f = fixture();
  expect(() => f.move(2, [f.units[0]!.id, f.units[0]!.id])).toThrow();
  expect(() => f.move(2, [f.units[0]!.id])).toThrow();
  const other = putProduct(f.s, {
    name: "別的商品",
    productType: "",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  expect(() =>
    addMovement(f.s, {
      productId: other.id,
      kind: "free",
      quantity: 1,
      fromLocationId: f.home.id,
      toLocationId: "",
      reason: "錯物",
      unitIds: [f.units[0]!.id],
    }),
  ).toThrow();
});
it("sales identify exact delivered objects and reject a second sale of the same object", () => {
  const f = fixture(2);
  const sale = f.sell([f.units[1]!.id]);
  expect(sale.lines[0]!.unitIds).toEqual([f.units[1]!.id]);
  expect(unitStates(f.s).find((u) => u.id === f.units[1]!.id)?.state).toBe(
    "sold",
  );
  expect(() => f.sell([f.units[1]!.id])).toThrow();
  expect(() => f.sell()).toThrow();
  validateRestoreSnapshot(f.s);
});
it("returns an arbitrary original sold object rather than assuming first sold order", () => {
  const f = fixture(2);
  const sale = f.sell(f.units.map((u) => u.id));
  const refund = refundSale(f.s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "退回B",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 100,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: f.other.id,
        restockUnitIds: [f.units[1]!.id],
      },
    ],
  });
  expect(
    f.s.movements.find((m) => m.id === refund.lines[0]!.movementId)?.unitIds,
  ).toEqual([f.units[1]!.id]);
  expect(unitStates(f.s).find((u) => u.id === f.units[1]!.id)?.locationId).toBe(
    f.other.id,
  );
  expect(unitStates(f.s).find((u) => u.id === f.units[0]!.id)?.state).toBe(
    "sold",
  );
  validateRestoreSnapshot(f.s);
});
it("separates damaged original units from saleable returns and rejects double returns", () => {
  const f = fixture(2);
  const sale = f.sell(f.units.map((u) => u.id));
  const line = {
    saleLineId: sale.lines[0]!.id,
    amount: 100,
    restockQuantity: 0,
    damagedQuantity: 1,
    returnLocationId: "",
    damagedUnitIds: [f.units[0]!.id],
  };
  refundSale(f.s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "損壞退回",
    lines: [line],
  });
  expect(unitStates(f.s).find((u) => u.id === f.units[0]!.id)?.state).toBe(
    "damage",
  );
  expect(balance(f.s, f.p.id, f.home.id)).toBe(0);
  expect(() =>
    refundSale(f.s, {
      operationId: crypto.randomUUID(),
      saleId: sale.id,
      reason: "重複",
      lines: [line],
    }),
  ).toThrow();
  validateRestoreSnapshot(f.s);
});
it("full sale reversal restores the original objects, while free/damage remain traceable", () => {
  const f = fixture(2);
  const sale = f.sell([f.units[0]!.id]);
  cancelSale(f.s, sale.id, "全額取消並實物退回");
  expect(unitStates(f.s).find((u) => u.id === f.units[0]!.id)?.state).toBe(
    "available",
  );
  const free = f.move(1, [f.units[0]!.id], "free");
  expect(unitStates(f.s).find((u) => u.id === f.units[0]!.id)?.state).toBe(
    "free",
  );
  reverseMovement(f.s, free.id, "發放錯誤實物退回");
  f.move(1, [f.units[1]!.id], "damage");
  expect(unitStates(f.s).find((u) => u.id === f.units[1]!.id)?.state).toBe(
    "damage",
  );
  validateRestoreSnapshot(f.s);
});
it("restoration rejects forged batch identity, repeated unit ids and hidden generic stock deductions", () => {
  const f = fixture(2);
  const wrong = structuredClone(f.s);
  wrong.physicalUnits[0]!.batchId = "missing";
  expect(() => validateRestoreSnapshot(wrong)).toThrow();
  const movement = f.move(1, [f.units[0]!.id]);
  const hidden = structuredClone(f.s);
  delete hidden.movements.find((m) => m.id === movement.id)!.unitIds;
  expect(() => validateRestoreSnapshot(hidden)).toThrow();
  const repeated = structuredClone(f.s);
  repeated.movements.find((m) => m.id === movement.id)!.unitIds = [
    f.units[0]!.id,
    f.units[0]!.id,
  ];
  expect(() => validateRestoreSnapshot(repeated)).toThrow();
});
it("roundtrips unit identities, unique positions and historical original returns through project XLSX", async () => {
  const f = fixture(3);
  f.move(1, [f.units[1]!.id]);
  f.sell([f.units[0]!.id]);
  const result = await inspectProject(await exportProject(f.s));
  expect(result).toEqual(f.s);
  expect(unitStates(result)).toEqual(unitStates(f.s));
});
it("activity file only receives chosen unit identities and remaps sources without duplicating physical stock", () => {
  const f = fixture(3);
  const event = putEvent(f.s, {
    name: "短期活動",
    startDate: "2026-11-04",
    endDate: "2026-11-05",
    venue: "",
    notes: "",
    projectIds: [],
  });
  const { packet } = prepareHandoff(f.s, {
    name: "甲份",
    eventId: event.id,
    sourceLocationId: f.home.id,
    lines: [{ productId: f.p.id, quantity: 1, unitIds: [f.units[1]!.id] }],
    planIds: [],
    collectorIds: [],
  });
  expect(packet.snapshot.physicalUnits.map((u) => u.id)).toEqual([
    f.units[1]!.id,
  ]);
  expect(JSON.stringify(packet)).not.toContain(f.units[0]!.id);
  expect(packet.snapshot.physicalUnits[0]!.batchId).not.toBe(f.receipt.id);
  expect(balance(f.s, f.p.id, f.home.id)).toBe(2);
  validateRestoreSnapshot(f.s);
});
it("activity sale, original-unit refund, counted close, merge and physical return preserve one identity", () => {
  const f = fixture(3);
  const event = putEvent(f.s, {
    name: "活動",
    startDate: "2026-11-04",
    endDate: "2026-11-05",
    venue: "",
    notes: "",
    projectIds: [],
  });
  let { packet } = prepareHandoff(f.s, {
    name: "交接",
    eventId: event.id,
    sourceLocationId: f.home.id,
    lines: [{ productId: f.p.id, quantity: 1, unitIds: [f.units[0]!.id] }],
    planIds: [],
    collectorIds: [],
  });
  packet = applyActivityCommand(packet, {
    type: "sale",
    input: {
      operationId: crypto.randomUUID(),
      locationId: packet.locationId,
      eventId: packet.eventId,
      collectorId: "",
      cashReceived: 100,
      notes: "",
      lines: [
        {
          productId: f.p.id,
          mode: "direct",
          quantity: 1,
          unitPrice: 100,
          unitIds: [f.units[0]!.id],
        },
      ],
    },
  });
  const sale = packet.snapshot.sales[0]!;
  packet = applyActivityCommand(packet, {
    type: "refund",
    input: {
      operationId: crypto.randomUUID(),
      saleId: sale.id,
      reason: "實物退回",
      lines: [
        {
          saleLineId: sale.lines[0]!.id,
          amount: 100,
          restockQuantity: 1,
          damagedQuantity: 0,
          returnLocationId: packet.locationId,
          restockUnitIds: [f.units[0]!.id],
        },
      ],
    },
  });
  packet = closeActivityPacket(
    packet,
    [{ productId: f.p.id, actual: 1, reason: "", unitIds: [f.units[0]!.id] }],
    "實物確認",
  );
  mergeActivityPacket(f.s, packet, {});
  expect(f.s.physicalUnits.filter((u) => u.id === f.units[0]!.id)).toHaveLength(
    1,
  );
  expect(unitStates(f.s).find((u) => u.id === f.units[0]!.id)?.locationId).toBe(
    packet.locationId,
  );
  returnActivityStock(f.s, packet.handoffId, f.home.id, "實際已交還");
  expect(unitStates(f.s).find((u) => u.id === f.units[0]!.id)?.locationId).toBe(
    f.home.id,
  );
  expect(balance(f.s, f.p.id, f.home.id)).toBe(3);
  validateRestoreSnapshot(f.s);
});

it("does not invent identities for a legacy unknown manufacturing source", () => {
  const f = fixture(1, []);
  expect(() =>
    registerPhysicalUnits(f.s, {
      productId: f.p.id,
      locationId: f.home.id,
      batchId: `legacy:${f.p.id}`,
      labels: ["舊物-A"],
    }),
  ).toThrow("未知舊來源");
  expect(f.s.physicalUnits).toEqual([]);
});

it("requires explicit per-unit stocktake before final activity closure", () => {
  const f = fixture(2);
  const event = putEvent(f.s, {
    name: "盤點活動",
    startDate: "2026-11-04",
    endDate: "2026-11-05",
    venue: "",
    notes: "",
    projectIds: [],
  });
  const { packet } = prepareHandoff(f.s, {
    name: "盤點份",
    eventId: event.id,
    sourceLocationId: f.home.id,
    lines: [{ productId: f.p.id, quantity: 1, unitIds: [f.units[0]!.id] }],
    planIds: [],
    collectorIds: [],
  });
  expect(() =>
    closeActivityPacket(
      packet,
      [{ productId: f.p.id, actual: 1, reason: "" }],
      "",
    ),
  ).toThrow();
  expect(() =>
    closeActivityPacket(
      packet,
      [{ productId: f.p.id, actual: 1, reason: "", unitIds: [f.units[1]!.id] }],
      "",
    ),
  ).toThrow();
  const closed = closeActivityPacket(
    packet,
    [{ productId: f.p.id, actual: 1, reason: "", unitIds: [f.units[0]!.id] }],
    "",
  );
  expect(closed.closure?.counts[0]?.unitIds).toEqual([f.units[0]!.id]);
  expect(() =>
    applyActivityCommand(closed, {
      type: "decrease",
      productId: f.p.id,
      quantity: 1,
      kind: "free",
      reason: "結案後",
      unitIds: [f.units[0]!.id],
    }),
  ).toThrow("永久唯讀");
});

it("does not treat matching aggregate count as sufficient when the physical unit was not confirmed", () => {
  const f = fixture(2);
  const event = putEvent(f.s, {
    name: "逐件盤點",
    startDate: "2026-11-04",
    endDate: "2026-11-05",
    venue: "",
    notes: "",
    projectIds: [],
  });
  const { packet } = prepareHandoff(f.s, {
    name: "單件核對",
    eventId: event.id,
    sourceLocationId: f.home.id,
    lines: [{ productId: f.p.id, quantity: 1, unitIds: [f.units[0]!.id] }],
    planIds: [],
    collectorIds: [],
  });
  expect(() =>
    closeActivityPacket(
      packet,
      [{ productId: f.p.id, actual: 1, reason: "", unitIds: [] }],
      "",
    ),
  ).toThrow("單件實物有差異");
});

it("allows a documented missing-unit close while blocking physical return until creator-side reconciliation", () => {
  const f = fixture(2);
  const event = putEvent(f.s, {
    name: "單件待查",
    startDate: "2026-11-04",
    endDate: "2026-11-05",
    venue: "",
    notes: "",
    projectIds: [],
  });
  let { packet } = prepareHandoff(f.s, {
    name: "待查交接",
    eventId: event.id,
    sourceLocationId: f.home.id,
    lines: [{ productId: f.p.id, quantity: 1, unitIds: [f.units[0]!.id] }],
    planIds: [],
    collectorIds: [],
  });
  packet = closeActivityPacket(
    packet,
    [
      {
        productId: f.p.id,
        actual: 0,
        reason: "A實物未找到，保留待查",
        unitIds: [],
      },
    ],
    "數量差異不代替銷售",
  );
  expect(packet.closure).not.toBeNull();
  expect(packet.snapshot.sales).toHaveLength(0);
  mergeActivityPacket(f.s, packet, {});
  expect(() =>
    returnActivityStock(f.s, packet.handoffId, f.home.id, "尚未交還實物"),
  ).toThrow("實點與交接庫位帳面不同");
  expect(balance(f.s, f.p.id, packet.locationId)).toBe(1);
  expect(f.s.activityMerges[0]!.returnedAt).toBe("");
  validateRestoreSnapshot(f.s);
});
