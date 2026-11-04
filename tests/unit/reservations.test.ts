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
  reverseMovement,
} from "../../src/domain/inventory/operations";
import {
  putSalePlan,
  toggleSalePlanArchive,
} from "../../src/domain/sales/plans";
import { completeSale, cancelSale } from "../../src/domain/sales/operations";
import { refundSale } from "../../src/domain/sales/refunds";
import {
  reserveStock,
  releaseReservation,
  reservationRemaining,
  availableQuantity,
  validateReservations,
} from "../../src/domain/inventory/reservations";
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
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "測試",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const p = putProduct(s, {
      name: "徽章",
      productType: "",
      specification: "",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    }),
    l = addLocation(s, "家中"),
    other = addLocation(s, "寄放");
  const receipt = addMovement(s, {
    productId: p.id,
    kind: "receipt",
    quantity: 10,
    fromLocationId: "",
    toLocationId: l.id,
    reason: "入庫",
  });
  const plan = putSalePlan(s, {
    name: "專用抽選池",
    mode: "draw",
    unitPrice: 100,
    productIds: [p.id],
    eventIds: [],
  });
  const reserve = (q = 6) =>
    reserveStock(s, {
      planId: plan.id,
      productId: p.id,
      locationId: l.id,
      quantity: q,
      reason: "本次專用",
    });
  const sale = (q = 1, own = true) =>
    completeSale(s, {
      operationId: crypto.randomUUID(),
      locationId: l.id,
      eventId: "",
      collectorId: "",
      cashReceived: q * 100,
      notes: "",
      lines: [
        {
          productId: p.id,
          mode: own ? "draw" : "direct",
          quantity: q,
          unitPrice: 100,
          ...(own ? { planId: plan.id, planVersion: plan.version } : {}),
        },
      ],
    });
  return { s, p, l, other, receipt, plan, reserve, sale };
}
it("reserves a physical subset without adding stock and protects all unrelated outflows", () => {
  const f = fixture(),
    r = f.reserve();
  expect(balance(f.s, f.p.id, f.l.id)).toBe(10);
  expect(availableQuantity(f.s, f.p.id, f.l.id)).toBe(4);
  for (const kind of ["free", "damage", "adjust-out", "transfer"] as const)
    expect(() =>
      addMovement(f.s, {
        productId: f.p.id,
        kind,
        quantity: 5,
        fromLocationId: f.l.id,
        toLocationId: kind === "transfer" ? f.other.id : "",
        reason: "嘗試挪用",
      }),
    ).toThrow("預留");
  expect(() => f.sale(5, false)).toThrow("預留");
  expect(reservationRemaining(f.s, r)).toBe(6);
  expect(validateRestoreSnapshot(f.s)).toEqual(f.s);
});
it("dedicated and shared sales consume separate quantities and retry does not double deduct", () => {
  const f = fixture(),
    r = f.reserve(),
    sale = f.sale(2);
  expect(reservationRemaining(f.s, r)).toBe(4);
  expect(availableQuantity(f.s, f.p.id, f.l.id)).toBe(4);
  f.sale(4, false);
  expect(balance(f.s, f.p.id, f.l.id)).toBe(4);
  expect(() => f.sale(1, false)).toThrow();
  expect(() => f.sale(5)).toThrow();
  expect(validateRestoreSnapshot(f.s)).toEqual(f.s);
  expect(
    f.s.movements.find((m) => m.id === sale.lines[0]!.movementId)
      ?.reservationId,
  ).toBe(r.id);
});
it("refund to the original location restores an active quota, damaged and other-location returns do not", () => {
  const f = fixture(),
    r = f.reserve(),
    sale = f.sale(4);
  refundSale(f.s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "部分退貨",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 100,
        restockQuantity: 1,
        damagedQuantity: 1,
        returnLocationId: f.l.id,
      },
    ],
  });
  expect(reservationRemaining(f.s, r)).toBe(3);
  refundSale(f.s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "另一庫位退貨",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 100,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: f.other.id,
      },
    ],
  });
  expect(reservationRemaining(f.s, r)).toBe(3);
  expect(validateRestoreSnapshot(f.s)).toEqual(f.s);
});
it("released reservation is never revived by a later refund and new reservations remain separate", () => {
  const f = fixture(),
    r = f.reserve(),
    sale = f.sale(2);
  releaseReservation(f.s, r.id, "改為共用");
  const newReserve = f.reserve(3);
  refundSale(f.s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "稍後退貨",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 200,
        restockQuantity: 2,
        damagedQuantity: 0,
        returnLocationId: f.l.id,
      },
    ],
  });
  expect(reservationRemaining(f.s, newReserve)).toBe(3);
  expect(availableQuantity(f.s, f.p.id, f.l.id)).toBe(7);
  expect(validateRestoreSnapshot(f.s)).toEqual(f.s);
});
it("whole cancellation restores the active reservation, and reversing receipts cannot steal reserved stock", () => {
  const f = fixture(),
    r = f.reserve(),
    sale = f.sale(2);
  cancelSale(f.s, sale.id, "全退");
  expect(reservationRemaining(f.s, r)).toBe(6);
  expect(() => reverseMovement(f.s, f.receipt.id, "錯誤")).toThrow("預留");
  expect(validateRestoreSnapshot(f.s)).toEqual(f.s);
});
it("requires explicit release before archive or removing reserved products, while repricing preserves quota", () => {
  const f = fixture(),
    r = f.reserve();
  expect(() => f.reserve()).toThrow("已有預留");
  expect(() => toggleSalePlanArchive(f.s, f.plan.id)).toThrow("釋放");
  const second = putProduct(f.s, {
    name: "吊飾",
    productType: "",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  expect(() =>
    putSalePlan(f.s, { ...f.plan, productIds: [second.id] }, f.plan.id),
  ).toThrow("釋放");
  putSalePlan(f.s, { ...f.plan, unitPrice: 200 }, f.plan.id);
  expect(reservationRemaining(f.s, r)).toBe(6);
  releaseReservation(f.s, r.id, "收攤");
  toggleSalePlanArchive(f.s, f.plan.id);
  expect(() => releaseReservation(f.s, r.id, "再釋放")).toThrow();
  expect(validateRestoreSnapshot(f.s)).toEqual(f.s);
});
it("rejects quota tampering, missing consumption identity and foreign reservation references on restore", () => {
  const f = fixture(),
    r = f.reserve(),
    sale = f.sale(2);
  for (const change of [
    (s: typeof f.s) => {
      s.inventoryReservations[0]!.quantity = 20;
    },
    (s: typeof f.s) => {
      delete s.movements.find((m) => m.id === sale.lines[0]!.movementId)!
        .reservationId;
    },
    (s: typeof f.s) => {
      s.movements.find(
        (m) => m.id === sale.lines[0]!.movementId,
      )!.reservationId = "foreign";
    },
  ]) {
    const bad = structuredClone(f.s);
    change(bad);
    expect(() => validateRestoreSnapshot(bad)).toThrow();
  }
  expect(r.quantity).toBe(6);
});
it("atomic commands roll back failed mixed carts and reservation identifiers", async () => {
  const workspace = await workspaceRepository.create("預留回滾");
  try {
    await catalogRepository.change(workspace.id, 0, (s) => {
      Object.assign(s, fixture().s, { workspaceId: workspace.id, workspace });
      for (const key of [
        "products",
        "locations",
        "movements",
        "salePlans",
      ] as const)
        for (const row of s[key]) row.workspaceId = workspace.id;
    });
    const before = await catalogRepository.read(workspace.id);
    await expect(
      catalogRepository.change(workspace.id, before.revision, (s) => {
        const p = s.products[0]!,
          l = s.locations[0]!,
          plan = s.salePlans[0]!;
        reserveStock(s, {
          planId: plan.id,
          productId: p.id,
          locationId: l.id,
          quantity: 6,
          reason: "預留",
        });
        completeSale(s, {
          operationId: crypto.randomUUID(),
          locationId: l.id,
          eventId: "",
          collectorId: "",
          cashReceived: 1000,
          notes: "",
          lines: [
            {
              productId: p.id,
              mode: "draw",
              quantity: 2,
              unitPrice: 100,
              planId: plan.id,
              planVersion: plan.version,
            },
            { productId: p.id, mode: "direct", quantity: 5, unitPrice: 100 },
          ],
        });
      }),
    ).rejects.toThrow();
    expect(await catalogRepository.read(workspace.id)).toEqual(before);
  } finally {
    await database.catalogs.delete(workspace.id);
    await database.workspaces.delete(workspace.id);
  }
});
it("round trips active and released quota history through complete XLSX", async () => {
  const f = fixture();
  f.reserve();
  f.sale(1);
  const restored = await inspectProject(await exportProject(f.s));
  expect(restored).toEqual(f.s);
  validateReservations(restored);
});
it("activity quotas are independent, released on closure, mapped once on merge and remain valid after later parent work", () => {
  const f = fixture(),
    event = putEvent(f.s, {
      name: "活動",
      startDate: "2026-11-04",
      endDate: "2026-11-05",
      venue: "",
      notes: "",
      projectIds: [],
    });
  const { packet } = prepareHandoff(f.s, {
    name: "交接",
    eventId: event.id,
    sourceLocationId: f.l.id,
    lines: [{ productId: f.p.id, quantity: 8 }],
    planIds: [f.plan.id],
    collectorIds: [],
  });
  let p = applyActivityCommand(packet, {
    type: "reserve",
    input: {
      planId: f.plan.id,
      productId: f.p.id,
      locationId: packet.locationId,
      quantity: 5,
      reason: "交接內專用",
    },
  });
  p = applyActivityCommand(p, {
    type: "sale",
    input: {
      operationId: crypto.randomUUID(),
      locationId: p.locationId,
      eventId: event.id,
      collectorId: "",
      cashReceived: 100,
      notes: "",
      lines: [
        {
          productId: f.p.id,
          mode: "draw",
          quantity: 1,
          unitPrice: 100,
          planId: f.plan.id,
          planVersion: f.plan.version,
        },
      ],
    },
  });
  p = closeActivityPacket(
    p,
    [{ productId: f.p.id, actual: 7, reason: "" }],
    "結案",
  );
  expect(p.snapshot.inventoryReservations[0]!.releaseReason).toContain("結案");
  mergeActivityPacket(f.s, p, {});
  expect(f.s.inventoryReservations[0]!.releasedAt).toBeTruthy();
  returnActivityStock(f.s, p.handoffId, f.l.id, "收回實物");
  addMovement(f.s, {
    productId: f.p.id,
    kind: "receipt",
    quantity: 1,
    fromLocationId: "",
    toLocationId: f.l.id,
    reason: "後續追加",
  });
  expect(validateRestoreSnapshot(f.s)).toEqual(f.s);
  const count = f.s.inventoryReservations.length;
  mergeActivityPacket(f.s, p, {});
  expect(f.s.inventoryReservations).toHaveLength(count);
});
it("blocks dispatch of creator-reserved stock until explicitly released", () => {
  const f = fixture(),
    r = f.reserve(),
    event = putEvent(f.s, {
      name: "活動",
      startDate: "2026-11-04",
      endDate: "2026-11-05",
      venue: "",
      notes: "",
      projectIds: [],
    });
  expect(() =>
    prepareHandoff(f.s, {
      name: "交接",
      eventId: event.id,
      sourceLocationId: f.l.id,
      lines: [{ productId: f.p.id, quantity: 8 }],
      planIds: [],
      collectorIds: [],
    }),
  ).toThrow("預留");
  releaseReservation(f.s, r.id, "改交活動");
  expect(availableQuantity(f.s, f.p.id, f.l.id)).toBe(10);
});
it("merges an activity that only reserved and released without operating stock, then keeps history valid after later parent receipts", () => {
  const f = fixture(),
    event = putEvent(f.s, {
      name: "活動",
      startDate: "2026-11-04",
      endDate: "2026-11-05",
      venue: "",
      notes: "",
      projectIds: [],
    });
  const { packet } = prepareHandoff(f.s, {
    name: "僅預留",
    eventId: event.id,
    sourceLocationId: f.l.id,
    lines: [{ productId: f.p.id, quantity: 5 }],
    planIds: [f.plan.id],
    collectorIds: [],
  });
  let p = applyActivityCommand(packet, {
    type: "reserve",
    input: {
      planId: f.plan.id,
      productId: f.p.id,
      locationId: packet.locationId,
      quantity: 3,
      reason: "預留但未售",
    },
  });
  p = closeActivityPacket(
    p,
    [{ productId: f.p.id, actual: 5, reason: "" }],
    "取消販售",
  );
  mergeActivityPacket(f.s, p, {});
  addMovement(f.s, {
    productId: f.p.id,
    kind: "receipt",
    quantity: 2,
    fromLocationId: "",
    toLocationId: f.l.id,
    reason: "後續入庫",
  });
  expect(validateRestoreSnapshot(f.s)).toEqual(f.s);
});
it("keeps two dedicated plans exclusive and rejects aggregate overbooking", () => {
  const f = fixture();
  f.reserve(6);
  const other = putSalePlan(f.s, {
    name: "另一專用方案",
    mode: "direct",
    unitPrice: 100,
    productIds: [f.p.id],
    eventIds: [],
  });
  expect(() =>
    reserveStock(f.s, {
      planId: other.id,
      productId: f.p.id,
      locationId: f.l.id,
      quantity: 5,
      reason: "超額",
    }),
  ).toThrow("不足");
  const r = reserveStock(f.s, {
    planId: other.id,
    productId: f.p.id,
    locationId: f.l.id,
    quantity: 4,
    reason: "第二方案專用",
  });
  completeSale(f.s, {
    operationId: crypto.randomUUID(),
    locationId: f.l.id,
    eventId: "",
    collectorId: "",
    cashReceived: 200,
    notes: "",
    lines: [
      {
        productId: f.p.id,
        mode: "direct",
        quantity: 2,
        unitPrice: 100,
        planId: other.id,
        planVersion: other.version,
      },
    ],
  });
  expect(reservationRemaining(f.s, r)).toBe(2);
  expect(availableQuantity(f.s, f.p.id, f.l.id)).toBe(0);
  expect(() => f.sale(1, false)).toThrow("預留");
  expect(validateRestoreSnapshot(f.s)).toEqual(f.s);
});
