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
import { putParty } from "../../src/domain/catalog/masterdata";
import {
  addLocation,
  addMovement,
  balance,
} from "../../src/domain/inventory/operations";
import { completeSale } from "../../src/domain/sales/operations";
import {
  registerPhysicalUnits,
  unitStates,
} from "../../src/domain/inventory/units";
import { reserveStock } from "../../src/domain/inventory/reservations";
import { putSalePlan } from "../../src/domain/sales/plans";
import * as c from "../../src/domain/consignment/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import {
  queryOperationalReport,
  queryCashFlow,
} from "../../src/domain/reports/operations";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
function setup() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "虛構寄賣測試",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const party = putParty(s, { name: "虛構寄賣店", notes: "" }),
    p = putProduct(s, {
      name: "徽章",
      productType: "徽章",
      specification: "",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    }),
    l = addLocation(s, "家中");
  const receipt = addMovement(s, {
    productId: p.id,
    kind: "receipt",
    quantity: 10,
    fromLocationId: "",
    toLocationId: l.id,
    reason: "製作入庫",
  });
  const con = c.saveConsignment(s, {
    name: "虛構店家寄賣",
    storePartyId: party.id,
    notes: "",
  });
  return { s, p, l, receipt, con };
}
function deliver(x: ReturnType<typeof setup>, q = 6, unitIds?: string[]) {
  return c.deliverConsignment(x.s, x.con.id, {
    operationId: crypto.randomUUID(),
    productId: x.p.id,
    quantity: q,
    sourceLocationId: x.l.id,
    reason: "實物交付",
    unitIds,
  });
}
function sell(
  x: ReturnType<typeof setup>,
  q = 2,
  unitIds?: string[],
  operationId = crypto.randomUUID(),
) {
  return c.reportConsignmentSale(x.s, x.con.id, {
    productId: x.p.id,
    quantity: q,
    unitPrice: 100,
    unitIds,
    soldAt: "2026-01-02T03:00:00Z",
    reason: "店家確認售出",
    operationId,
  });
}
it("delivery conserves total stock and retail report is not creator cash or remittance", () => {
  const x = setup();
  deliver(x);
  const sale = sell(x);
  expect(balance(x.s, x.p.id, x.l.id)).toBe(4);
  expect(balance(x.s, x.p.id, x.con.locationId)).toBe(4);
  expect(sale.consignmentReportedAt).toBeTruthy();
  expect(
    queryOperationalReport(x.s, { groupBy: "product" }).totals.netRevenue,
  ).toBe("200");
  expect(queryCashFlow(x.s, {}).net).toBe("0");
  expect(c.consignmentSummary(x.s, x.s.consignments[0]!).balance).toBeNull();
  validateRestoreSnapshot(x.s);
});
it("manual fee, positive/negative adjustment and actual remittance remain separate", () => {
  const x = setup();
  deliver(x);
  sell(x);
  c.setConsignmentStatement(x.s, x.con.id, {
    fee: 20,
    adjustment: 0,
    reason: "約定費用確認",
  });
  c.recordConsignmentRemittance(x.s, x.con.id, {
    operationId: crypto.randomUUID(),
    amount: 100,
    receivedAt: "2026-01-03T00:00:00Z",
    reason: "實際收到第一筆",
  });
  c.recordConsignmentRemittance(x.s, x.con.id, {
    operationId: crypto.randomUUID(),
    amount: 80,
    receivedAt: "2026-01-04T00:00:00Z",
    reason: "實際收到第二筆",
  });
  expect(c.consignmentSummary(x.s, x.s.consignments[0]!)).toMatchObject({
    expected: 180,
    received: 180,
    balance: 0,
  });
  expect(queryCashFlow(x.s, {}).net).toBe("0");
  c.setConsignmentStatement(x.s, x.con.id, {
    fee: 20,
    adjustment: -10,
    reason: "另確認調減",
  });
  expect(c.consignmentSummary(x.s, x.s.consignments[0]!).balance).toBe(-10);
});
it("unknown amounts never zero and close does not require cleared cash or returned stock", () => {
  const x = setup();
  deliver(x);
  sell(x);
  c.setConsignmentStatement(x.s, x.con.id, {
    fee: null,
    adjustment: 0,
    reason: "費用待查",
  });
  expect(c.consignmentSummary(x.s, x.s.consignments[0]!).expected).toBeNull();
  c.closeConsignment(x.s, x.con.id, "使用者決定結束，差額待查");
  expect(() => sell(x)).toThrow("結束");
  c.recordConsignmentRemittance(x.s, x.con.id, {
    operationId: crypto.randomUUID(),
    amount: 10,
    receivedAt: "2026-01-04T00:00:00Z",
    reason: "結束後實收",
  });
  c.reopenConsignment(x.s, x.con.id, "明確追加作業");
  expect(x.s.consignments[0]!.statusHistory).toHaveLength(2);
});
it("report repeat idempotent, conflicting retry and insufficient stock atomically preserve history", () => {
  const x = setup();
  deliver(x);
  const op = crypto.randomUUID();
  sell(x, 2, undefined, op);
  sell(x, 2, undefined, op);
  expect(x.s.sales).toHaveLength(1);
  const before = JSON.stringify(x.s);
  expect(() => sell(x, 3, undefined, op)).toThrow("識別");
  expect(() => sell(x, 9)).toThrow();
  expect(JSON.stringify(x.s)).toBe(before);
});
it("store customer refund reverses revenue and stock but never creator cash", () => {
  const x = setup();
  deliver(x);
  const sale = sell(x);
  c.recordConsignmentRefund(x.s, x.con.id, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "店家確認顧客退貨",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 50,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: x.con.locationId,
      },
    ],
  });
  expect(c.consignmentSummary(x.s, x.s.consignments[0]!).netSales).toBe(150);
  expect(balance(x.s, x.p.id, x.con.locationId)).toBe(5);
  expect(queryCashFlow(x.s, {}).entries).toHaveLength(0);
  c.returnConsignmentStock(x.s, x.con.id, {
    operationId: crypto.randomUUID(),
    productId: x.p.id,
    quantity: 5,
    toLocationId: x.l.id,
    reason: "實物已交還",
  });
  expect(balance(x.s, x.p.id, x.l.id)).toBe(9);
  validateRestoreSnapshot(x.s);
});
it("exact individual identities survive delivery sale refund and physical return", () => {
  const x = setup();
  const [u] = registerPhysicalUnits(x.s, {
    productId: x.p.id,
    locationId: x.l.id,
    batchId: x.receipt.id,
    labels: ["親簽A"],
  });
  deliver(x, 1, [u!.id]);
  const sale = sell(x, 1, [u!.id]);
  c.recordConsignmentRefund(x.s, x.con.id, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "退回同件",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 100,
        restockQuantity: 1,
        damagedQuantity: 0,
        returnLocationId: x.con.locationId,
        restockUnitIds: [u!.id],
        damagedUnitIds: [],
      },
    ],
  });
  c.returnConsignmentStock(x.s, x.con.id, {
    operationId: crypto.randomUUID(),
    productId: x.p.id,
    quantity: 1,
    unitIds: [u!.id],
    toLocationId: x.l.id,
    reason: "收到原件",
  });
  expect(unitStates(x.s).find((r) => r.id === u!.id)?.locationId).toBe(x.l.id);
  validateRestoreSnapshot(x.s);
});
it("reserved origin stock cannot be delivered and remittance reverses once", () => {
  const x = setup();
  const p = putSalePlan(x.s, {
    name: "專用",
    mode: "direct",
    unitPrice: 100,
    productIds: [x.p.id],
    eventIds: [],
  });
  reserveStock(x.s, {
    planId: p.id,
    productId: x.p.id,
    locationId: x.l.id,
    quantity: 8,
    reason: "明確預留",
  });
  const before = JSON.stringify(x.s);
  expect(() => deliver(x, 3)).toThrow();
  expect(JSON.stringify(x.s)).toBe(before);
  const r = c.recordConsignmentRemittance(x.s, x.con.id, {
    operationId: crypto.randomUUID(),
    amount: 10,
    receivedAt: "2026-01-04T00:00:00Z",
    reason: "實收誤記",
  });
  c.reverseConsignmentRemittance(x.s, x.con.id, r.id, "沖銷");
  expect(c.consignmentSummary(x.s, x.s.consignments[0]!).received).toBe(0);
  expect(() =>
    c.reverseConsignmentRemittance(x.s, x.con.id, r.id, "再沖"),
  ).toThrow();
});
it("unknown old-schema data upgrades without fabricated consignment", () => {
  const x = setup();
  const old = structuredClone(x.s) as any;
  old.schemaVersion = 20;
  delete old.consignments;
  old.locations = old.locations.filter((l: any) => l.id !== x.con.locationId);
  expect(validateRestoreSnapshot(old).consignments).toEqual([]);
});
it("complete backup restores consignment and reports without duplicate finance", async () => {
  const x = setup();
  deliver(x);
  sell(x);
  c.setConsignmentStatement(x.s, x.con.id, {
    fee: 0,
    adjustment: 0,
    reason: "明確零費用",
  });
  const restored = await inspectProject(await exportProject(x.s));
  expect(restored).toEqual(x.s);
});
it("normal repository writes cannot bypass consignment location, failure rolls back", async () => {
  const w = await workspaceRepository.create("寄賣交易測試");
  try {
    let pId = "",
      loc = "",
      cId = "";
    await catalogRepository.change(w.id, 0, (s) => {
      const p = putProduct(s, {
          name: "測試品",
          productType: "",
          specification: "",
          artwork: "",
          notes: "",
          tagIds: [],
          customValues: {},
        }),
        party = putParty(s, { name: "測試店", notes: "" }),
        l = addLocation(s, "家");
      pId = p.id;
      loc = l.id;
      addMovement(s, {
        kind: "receipt",
        productId: p.id,
        quantity: 3,
        fromLocationId: "",
        toLocationId: l.id,
        reason: "入庫",
      });
      const con = c.saveConsignment(s, {
        name: "寄賣",
        storePartyId: party.id,
        notes: "",
      });
      cId = con.id;
      c.deliverConsignment(s, con.id, {
        operationId: crypto.randomUUID(),
        productId: pId,
        quantity: 3,
        sourceLocationId: loc,
        reason: "交出",
      });
    });
    const before = await catalogRepository.read(w.id);
    await expect(
      catalogRepository.change(w.id, 1, (s) => {
        addMovement(s, {
          kind: "damage",
          productId: pId,
          quantity: 1,
          fromLocationId: s.consignments[0]!.locationId,
          toLocationId: "",
          reason: "繞過",
        });
      }),
    ).rejects.toThrow("寄賣庫位");
    expect(await catalogRepository.read(w.id)).toEqual(before);
  } finally {
    await database.catalogs.delete(w.id);
    await database.workspaces.delete(w.id);
  }
});
it("delivery, physical return and actual remittance retries are idempotent and conflicting requests reject", () => {
  const x = setup(),
    input = {
      operationId: crypto.randomUUID(),
      productId: x.p.id,
      quantity: 4,
      sourceLocationId: x.l.id,
      reason: "實物交付確認",
    };
  c.deliverConsignment(x.s, x.con.id, input);
  c.deliverConsignment(x.s, x.con.id, input);
  expect(balance(x.s, x.p.id, x.con.locationId)).toBe(4);
  expect(() =>
    c.deliverConsignment(x.s, x.con.id, { ...input, quantity: 3 }),
  ).toThrow("操作識別");
  const pay = {
    operationId: crypto.randomUUID(),
    amount: 100,
    receivedAt: "2026-01-03T00:00:00Z",
    reason: "銀行入帳確認",
  };
  c.recordConsignmentRemittance(x.s, x.con.id, pay);
  c.recordConsignmentRemittance(x.s, x.con.id, pay);
  expect(c.consignmentSummary(x.s, x.s.consignments[0]!).received).toBe(100);
  expect(() =>
    c.recordConsignmentRemittance(x.s, x.con.id, { ...pay, amount: 99 }),
  ).toThrow("操作識別");
  const back = {
    operationId: crypto.randomUUID(),
    productId: x.p.id,
    quantity: 2,
    toLocationId: x.l.id,
    reason: "實物回到家中",
  };
  c.returnConsignmentStock(x.s, x.con.id, back);
  c.returnConsignmentStock(x.s, x.con.id, back);
  expect(balance(x.s, x.p.id, x.con.locationId)).toBe(2);
  validateRestoreSnapshot(x.s);
});
it("tampered missing cash-only store refund or foreign movement is refused", () => {
  const x = setup();
  deliver(x);
  const sale = sell(x);
  c.recordConsignmentRefund(x.s, x.con.id, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "已退客人款項無退貨",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 30,
        restockQuantity: 0,
        damagedQuantity: 0,
        returnLocationId: "",
      },
    ],
  });
  const bad = structuredClone(x.s);
  bad.consignments[0]!.refundIds = [];
  expect(() => validateRestoreSnapshot(bad)).toThrow("缺漏");
  const missing = structuredClone(x.s);
  missing.sales[0]!.consignmentId = "foreign";
  expect(() => validateRestoreSnapshot(missing)).toThrow();
});
