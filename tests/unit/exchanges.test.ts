import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import {
  emptyCatalog,
  catalogRepository,
} from "../../src/infrastructure/storage/catalog";
import {
  database,
  workspaceRepository,
} from "../../src/infrastructure/storage/workspaces";
import { putProduct } from "../../src/domain/catalog/operations";
import { putEvent } from "../../src/domain/catalog/projects";
import {
  addLocation,
  addMovement,
  balance,
} from "../../src/domain/inventory/operations";
import { completeSale, cancelSale } from "../../src/domain/sales/operations";
import { refundSale, saleNetRevenue } from "../../src/domain/sales/refunds";
import {
  completeExchange,
  validateExchanges,
} from "../../src/domain/sales/exchanges";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
import {
  reserveStock,
  reservationRemaining,
} from "../../src/domain/inventory/reservations";
import { putSalePlan } from "../../src/domain/sales/plans";
import {
  registerPhysicalUnits,
  unitStates,
} from "../../src/domain/inventory/units";
import {
  prepareHandoff,
  applyActivityCommand,
  closeActivityPacket,
  mergeActivityPacket,
} from "../../src/domain/activity/operations";
import type {
  CatalogSnapshot,
  ExchangeInput,
} from "../../src/domain/models/catalog";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "測試",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const a = putProduct(s, {
      name: "徽章",
      productType: "",
      specification: "",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    }),
    b = putProduct(s, {
      name: "吊飾",
      productType: "",
      specification: "",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    }),
    loc = addLocation(s, "攤位");
  for (const p of [a, b])
    addMovement(s, {
      productId: p.id,
      kind: "receipt",
      quantity: 10,
      fromLocationId: "",
      toLocationId: loc.id,
      reason: "到貨",
    });
  return { s, a, b, loc };
}
function sold(
  s: CatalogSnapshot,
  price = 100,
  quantity = 1,
  unitIds?: string[],
) {
  return completeSale(s, {
    operationId: crypto.randomUUID(),
    locationId: s.locations[0]!.id,
    eventId: "",
    collectorId: "",
    cashReceived: price * quantity,
    notes: "",
    lines: [
      {
        productId: s.products[0]!.id,
        mode: "direct",
        quantity,
        unitPrice: price,
        ...(unitIds ? { unitIds } : {}),
      },
    ],
  });
}
function command(
  s: CatalogSnapshot,
  original: ReturnType<typeof sold>,
  price = 150,
  credit = 100,
): ExchangeInput {
  return {
    operationId: crypto.randomUUID(),
    saleId: original.id,
    reason: "換款",
    refundLines: [
      {
        saleLineId: original.lines[0]!.id,
        amount: credit,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: s.locations[0]!.id,
      },
    ],
    replacement: {
      locationId: s.locations[0]!.id,
      eventId: "",
      collectorId: "",
      notes: "",
      lines: [
        {
          productId: s.products[1]!.id,
          mode: "direct",
          quantity: 1,
          unitPrice: price,
        },
      ],
    },
    actualDifference: price - credit,
    confirmed: true,
  };
}
for (const [price, delta] of [
  [150, 50],
  [60, -40],
  [100, 0],
  [0, -100],
])
  it(`records only actual signed cash difference ${delta}`, () => {
    const { s, a, b, loc } = fixture(),
      old = sold(s),
      e = completeExchange(s, command(s, old, price));
    expect(e.actualDifference).toBe(delta);
    const replacement = s.sales.find((r) => r.id === e.replacementSaleId)!;
    expect(replacement.cashReceived).toBe(Math.max(delta!, 0));
    expect(replacement.change).toBe(Math.max(-delta!, 0));
    expect(replacement.exchangeCredit).toBe(100);
    expect(balance(s, a.id, loc.id)).toBe(10);
    expect(balance(s, b.id, loc.id)).toBe(9);
    expect(s.sales.reduce((n, r) => n + saleNetRevenue(s, r), 0)).toBe(price);
    expect(validateRestoreSnapshot(s)).toEqual(s);
  });
it("retries are idempotent and conflicting operation is refused", () => {
  const { s } = fixture(),
    old = sold(s),
    c = command(s, old),
    e = completeExchange(s, c),
    before = structuredClone(s);
  expect(completeExchange(s, c).id).toBe(e.id);
  expect(s).toEqual(before);
  expect(() => completeExchange(s, { ...c, reason: "不同" })).toThrow(
    "相同操作",
  );
});
it("requires explicit matching payment confirmation and remains unchanged on errors", () => {
  const { s } = fixture(),
    old = sold(s),
    c = command(s, old),
    before = structuredClone(s);
  expect(() => completeExchange(s, { ...c, confirmed: false as true })).toThrow(
    "確認",
  );
  expect(() => completeExchange(s, { ...c, actualDifference: 0 })).toThrow(
    "差額",
  );
  expect(s).toEqual(before);
});
it("rolls back both return and outgoing goods when replacement stock is unavailable", () => {
  const { s, b, loc } = fixture(),
    old = sold(s),
    c = command(s, old),
    before = structuredClone(s);
  c.replacement.lines[0]!.quantity = 11;
  c.actualDifference = 1550;
  expect(() => completeExchange(s, c)).toThrow();
  expect(s).toEqual(before);
  expect(balance(s, b.id, loc.id)).toBe(10);
});
it("respects previous partial refunds and does not refund twice", () => {
  const { s } = fixture(),
    old = sold(s, 100, 2);
  refundSale(s, {
    operationId: crypto.randomUUID(),
    saleId: old.id,
    reason: "先退",
    lines: [
      {
        saleLineId: old.lines[0]!.id,
        amount: 100,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: s.locations[0]!.id,
      },
    ],
  });
  completeExchange(s, command(s, old));
  const before = structuredClone(s);
  expect(() => completeExchange(s, command(s, old))).toThrow("累計");
  expect(s).toEqual(before);
});
it("damaged returns remain out of saleable stock", () => {
  const { s, a, loc } = fixture(),
    old = sold(s),
    c = command(s, old);
  Object.assign(c.refundLines[0]!, {
    restockQuantity: 0,
    damagedQuantity: 1,
    returnLocationId: "",
  });
  completeExchange(s, c);
  expect(balance(s, a.id, loc.id)).toBe(9);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("cannot take another plans reserved stock and rolls back source return", () => {
  const { s, b, loc } = fixture(),
    old = sold(s),
    plan = putSalePlan(s, {
      name: "專用",
      mode: "draw",
      unitPrice: 150,
      productIds: [b.id],
      eventIds: [],
    });
  reserveStock(s, {
    planId: plan.id,
    productId: b.id,
    locationId: loc.id,
    quantity: 10,
    reason: "預留",
  });
  const before = structuredClone(s);
  expect(() => completeExchange(s, command(s, old))).toThrow("預留");
  expect(s).toEqual(before);
  const c = command(s, old);
  c.replacement.lines[0] = {
    ...c.replacement.lines[0]!,
    mode: "draw",
    planId: plan.id,
    planVersion: plan.version,
  };
  completeExchange(s, c);
  expect(reservationRemaining(s, s.inventoryReservations[0]!)).toBe(9);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("uses exact original returned and replacement physical unit IDs", () => {
  const { s, a, b, loc } = fixture();
  const [ua] = registerPhysicalUnits(s, {
      productId: a.id,
      locationId: loc.id,
      batchId: s.movements[0]!.id,
      labels: ["A01"],
    }),
    [ub] = registerPhysicalUnits(s, {
      productId: b.id,
      locationId: loc.id,
      batchId: s.movements[1]!.id,
      labels: ["B01"],
    });
  const old = sold(s, 100, 1, [ua!.id]),
    c = command(s, old);
  c.refundLines[0]!.restockUnitIds = [ua!.id];
  c.replacement.lines[0]!.unitIds = [ub!.id];
  completeExchange(s, c);
  expect(unitStates(s).find((u) => u.id === ua!.id)!.state).toBe("available");
  expect(unitStates(s).find((u) => u.id === ub!.id)!.state).toBe("sold");
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("exchange child cannot be directly canceled but subsequent explicit refund remains possible", () => {
  const { s } = fixture(),
    e = completeExchange(s, command(s, sold(s))),
    child = s.sales.find((r) => r.id === e.replacementSaleId)!;
  expect(() => cancelSale(s, child.id, "改記")).toThrow("追加");
  refundSale(s, {
    operationId: crypto.randomUUID(),
    saleId: child.id,
    reason: "後續退款",
    lines: [
      {
        saleLineId: child.lines[0]!.id,
        amount: 150,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: s.locations[0]!.id,
      },
    ],
  });
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("rejects tampered credit/cash/linkage and preserves exact XLSX roundtrip", async () => {
  const { s } = fixture(),
    e = completeExchange(s, command(s, sold(s)));
  for (const field of [
    "actualDifference",
    "refundTotal",
    "replacementTotal",
  ] as const) {
    const bad = structuredClone(s);
    bad.exchanges[0]![field]++;
    expect(() => validateRestoreSnapshot(bad)).toThrow();
  }
  const bad = structuredClone(s);
  bad.sales.find((r) => r.id === e.replacementSaleId)!.cashReceived = 150;
  expect(() => validateRestoreSnapshot(bad)).toThrow();
  expect(await inspectProject(await exportProject(s))).toEqual(s);
});
it("creator DB transaction rolls back on a failed command", async () => {
  const w = await workspaceRepository.create("原子換購");
  try {
    const { s } = fixture();
    s.workspace = w;
    s.workspaceId = w.id;
    for (const key of [
      "products",
      "parties",
      "locations",
      "movements",
    ] as const)
      for (const r of s[key]) r.workspaceId = w.id;
    const old = sold(s),
      c = command(s, old);
    await database.catalogs.put(s);
    c.replacement.lines[0]!.quantity = 100;
    c.actualDifference = 14900;
    await expect(
      catalogRepository.change(w.id, 0, (t) => completeExchange(t, c)),
    ).rejects.toThrow();
    expect(await catalogRepository.read(w.id)).toEqual(s);
  } finally {
    await database.catalogs.delete(w.id);
    await database.workspaces.delete(w.id);
  }
});
it("offline activity exchange closes and merges once without changing unrelated data", () => {
  const { s, a, b, loc } = fixture(),
    event = putEvent(s, {
      name: "活動",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      venue: "",
      notes: "",
      projectIds: [],
    });
  let { packet } = prepareHandoff(s, {
    name: "交接",
    eventId: event.id,
    sourceLocationId: loc.id,
    lines: [
      { productId: a.id, quantity: 3 },
      { productId: b.id, quantity: 3 },
    ],
    planIds: [],
    collectorIds: [],
  });
  packet = applyActivityCommand(packet, {
    type: "sale",
    input: {
      operationId: crypto.randomUUID(),
      locationId: packet.locationId,
      eventId: event.id,
      collectorId: "",
      cashReceived: 100,
      notes: "",
      lines: [{ productId: a.id, mode: "direct", quantity: 1, unitPrice: 100 }],
    },
  });
  const c = command(packet.snapshot, packet.snapshot.sales[0]!);
  c.replacement.eventId = event.id;
  packet = applyActivityCommand(packet, { type: "exchange", input: c });
  packet = closeActivityPacket(
    packet,
    packet.snapshot.products.map((p) => ({
      productId: p.id,
      actual: balance(packet.snapshot, p.id, packet.locationId),
      reason: "",
    })),
    "",
  );
  expect(() =>
    applyActivityCommand(packet, { type: "exchange", input: c }),
  ).toThrow("結案");
  const old = structuredClone(s.products);
  mergeActivityPacket(s, packet, {});
  expect(s.products).toEqual(old);
  expect(s.exchanges).toHaveLength(1);
  const after = structuredClone(s);
  mergeActivityPacket(s, packet, {});
  expect(s).toEqual(after);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});

it("cost reconciliation uses original return basis and keeps unknown replacement cost unknown", async () => {
  const { putCost } = await import("../../src/domain/finance/operations");
  const { saveBatchCost, batchCostReport } =
    await import("../../src/domain/finance/batch-costs");
  const { s, a, b } = fixture();
  for (const [i, p] of [a, b].entries()) {
    putCost(s, {
      name: "明確成本" + i,
      productId: p.id,
      quantity: 10,
      estimatedPrint: null,
      actualPrint: i === 0 ? 200 : null,
      artworkAllocated: 0,
      otherCost: 0,
      unitSalePrice: null,
      paidById: "",
      burdenPartyId: "",
      notes: "",
    });
    saveBatchCost(s, s.movements[i]!.id, s.costs.at(-1)!.id, "明確連結");
  }
  const old = sold(s),
    c = command(s, old);
  completeExchange(s, c);
  const report = batchCostReport(s);
  expect(report.totalKnownCost).toBe("0.0000");
  expect(report.totalUnknownQuantity).toBe(1);
  expect(report.sales.find((r) => r.saleId === old.id)!.netKnownCost).toBe(
    "0.0000",
  );
  expect(report.sales.find((r) => r.saleId !== old.id)!.margin).toBeNull();
  expect(validateRestoreSnapshot(s)).toEqual(s);
});

it("changed plan price refuses exchange without committing its source return", () => {
  const { s, b } = fixture(),
    old = sold(s),
    plan = putSalePlan(s, {
      name: "換購方案",
      mode: "direct",
      unitPrice: 150,
      productIds: [b.id],
      eventIds: [],
    }),
    c = command(s, old);
  c.replacement.lines[0] = {
    ...c.replacement.lines[0]!,
    planId: plan.id,
    planVersion: plan.version,
  };
  putSalePlan(
    s,
    {
      name: plan.name,
      mode: "direct",
      unitPrice: 160,
      productIds: plan.productIds,
      eventIds: [],
    },
    plan.id,
  );
  const before = structuredClone(s);
  expect(() => completeExchange(s, c)).toThrow("方案");
  expect(s).toEqual(before);
});

it("reimporting an already merged pre-exchange activity remains idempotent after schema upgrade", () => {
  const { s, a, loc } = fixture(),
    event = putEvent(s, {
      name: "舊活動",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      venue: "",
      notes: "",
      projectIds: [],
    });
  let { packet } = prepareHandoff(s, {
    name: "舊交接",
    eventId: event.id,
    sourceLocationId: loc.id,
    lines: [{ productId: a.id, quantity: 2 }],
    planIds: [],
    collectorIds: [],
  });
  packet = closeActivityPacket(
    packet,
    packet.snapshot.products.map((p) => ({
      productId: p.id,
      actual: 2,
      reason: "",
    })),
    "",
  );
  mergeActivityPacket(s, packet, {});
  const old = structuredClone(s) as any;
  const downgradePacket = (p: any) => {
    for (const key of ["baseline", "snapshot"]) {
      p[key].schemaVersion = 19;
      delete p[key].exchanges;
    }
    return p;
  };
  old.schemaVersion = 19;
  delete old.exchanges;
  for (const h of old.activityHandoffs) {
    downgradePacket(h.packet);
    if (h.localPacket) downgradePacket(h.localPacket);
  }
  for (const m of old.activityMerges)
    m.packetContent = JSON.stringify(
      downgradePacket(JSON.parse(m.packetContent)),
    );
  const restored = validateRestoreSnapshot(old),
    before = structuredClone(restored);
  mergeActivityPacket(restored, downgradePacket(structuredClone(packet)), {});
  expect(restored).toEqual(before);
});

it("refuses a forged exchange that uses its own replacement as the original", () => {
  const { s } = fixture(),
    e = completeExchange(s, command(s, sold(s)));
  e.originalSaleId = e.replacementSaleId;
  e.request.saleId = e.replacementSaleId;
  expect(() => validateExchanges(s)).toThrow("循環");
});
