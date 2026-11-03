import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  emptyCatalog,
  catalogRepository,
} from "../../src/infrastructure/storage/catalog";
import {
  database,
  workspaceRepository,
  ConMateDatabase,
} from "../../src/infrastructure/storage/workspaces";
import { putProduct } from "../../src/domain/catalog/operations";
import {
  addLocation,
  addMovement,
  balance,
  reverseMovement,
} from "../../src/domain/inventory/operations";
import {
  completeSale,
  cancelSale,
  saleTotal,
} from "../../src/domain/sales/operations";
import {
  putCost,
  costSummary,
  fractionDecimal,
  putAdvance,
  repayAdvance,
  reverseRepayment,
  advanceRepaid,
  voidAdvance,
} from "../../src/domain/finance/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
import type {
  CatalogSnapshot,
  SaleInput,
  CostInput,
} from "../../src/domain/models/catalog";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "測試工作區",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const p = putProduct(s, {
    name: "徽章",
    creatorName: "甲",
    productType: "徽章",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  putProduct(s, {
    name: "吊飾",
    creatorName: "乙",
    productType: "吊飾",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const location = addLocation(s, "攤位");
  addMovement(s, {
    productId: p.id,
    kind: "receipt",
    quantity: 10,
    fromLocationId: "",
    toLocationId: location.id,
    reason: "實際到貨",
  });
  return s;
}
function sale(s: CatalogSnapshot): SaleInput {
  return {
    operationId: crypto.randomUUID(),
    locationId: s.locations[0]!.id,
    eventId: "",
    collectorId: "",
    cashReceived: 500,
    notes: "",
    lines: [
      {
        productId: s.products[0]!.id,
        quantity: 2,
        unitPrice: 60,
        mode: "direct",
      },
      {
        productId: s.products[0]!.id,
        quantity: 1,
        unitPrice: 50,
        mode: "draw",
      },
    ],
  };
}
function cost(s: CatalogSnapshot): CostInput {
  return {
    name: "第一批",
    productId: s.products[0]!.id,
    quantity: 30,
    estimatedPrint: 1710,
    actualPrint: 1368,
    artworkAllocated: 4000,
    otherCost: 0,
    unitSalePrice: 200,
    paidById: "",
    burdenPartyId: "",
    notes: "",
  };
}
function advance(s: CatalogSnapshot) {
  putAdvance(s, {
    name: "代墊印製",
    payerId: s.parties[0]!.id,
    debtorId: s.parties[1]!.id,
    principal: 1368,
    notes: "只追收實付1368，不產生342團費",
  });
  return s.advances[0]!;
}
describe("stock linked sales", () => {
  it("shares stock across direct/draw, preserves exact delivery and cash/change", () => {
    const s = fixture(),
      a = completeSale(s, sale(s));
    expect(a.total).toBe(170);
    expect(a.change).toBe(330);
    expect(balance(s, s.products[0]!.id, s.locations[0]!.id)).toBe(7);
    expect(a.lines.map((l) => l.mode)).toEqual(["direct", "draw"]);
    expect(validateRestoreSnapshot(s)).toEqual(s);
  });
  it("operation retry does not deduct twice", () => {
    const s = fixture(),
      input = sale(s);
    const a = completeSale(s, input);
    expect(completeSale(s, input).id).toBe(a.id);
    expect(s.sales).toHaveLength(1);
    expect(s.movements).toHaveLength(3);
  });
  it("rejects reused operation IDs with changed content", () => {
    const s = fixture(),
      input = sale(s);
    completeSale(s, input);
    input.cashReceived = 1000;
    expect(() => completeSale(s, input)).toThrow("不同交易");
  });
  it("cash too low produces no sale", () => {
    const s = fixture(),
      i = sale(s);
    i.cashReceived = 10;
    expect(() => completeSale(s, i)).toThrow("不足");
    expect(s.sales).toHaveLength(0);
    expect(s.movements).toHaveLength(1);
  });
  it("refund returns every actual SKU and blocks duplicate refund/manual inventory reversal", () => {
    const s = fixture(),
      a = completeSale(s, sale(s));
    expect(() => reverseMovement(s, a.lines[0]!.movementId, "錯誤")).toThrow(
      "攤位販售",
    );
    cancelSale(s, a.id, "客人取消，已退款且回庫");
    expect(balance(s, s.products[0]!.id, s.locations[0]!.id)).toBe(10);
    expect(() => cancelSale(s, a.id, "再次退款")).toThrow("已經取消");
    expect(validateRestoreSnapshot(s)).toEqual(s);
  });
  it("validates whole money and safe multiplication", () => {
    expect(() =>
      saleTotal([
        { productId: "x", mode: "direct", quantity: 1, unitPrice: 0.1 },
      ]),
    ).toThrow();
    expect(() =>
      saleTotal([
        {
          productId: "x",
          mode: "direct",
          quantity: Number.MAX_SAFE_INTEGER,
          unitPrice: 2,
        },
      ]),
    ).toThrow("安全範圍");
  });
  it("rolls back every line/counter when later stock is insufficient", async () => {
    const s = fixture();
    await database.workspaces.add(s.workspace);
    await database.catalogs.add(s);
    try {
      const i = sale(s);
      i.lines[1]!.quantity = 20;
      await expect(
        catalogRepository.change(s.workspaceId, 0, (copy) => {
          completeSale(copy, i);
        }),
      ).rejects.toThrow("不足");
      expect(await database.catalogs.get(s.workspaceId)).toEqual(s);
    } finally {
      await database.catalogs.delete(s.workspaceId);
      await database.workspaces.delete(s.workspaceId);
    }
  });
  it("rejects forged financial or stock relations during restore", () => {
    const s = fixture();
    completeSale(s, sale(s));
    const changed = structuredClone(s);
    changed.sales[0]!.total++;
    expect(() => validateRestoreSnapshot(changed)).toThrow();
    const unlinked = structuredClone(s);
    unlinked.sales = [];
    expect(() => validateRestoreSnapshot(unlinked)).toThrow();
    const changedQty = structuredClone(s);
    changedQty.sales[0]!.lines[0]!.quantity++;
    expect(() => validateRestoreSnapshot(changedQty)).toThrow();
  });
});
describe("explicit cost and advance accounting", () => {
  it("unknown cost remains unknown and explicit zero can be calculated", () => {
    const s = fixture(),
      c = cost(s);
    c.artworkAllocated = null;
    expect(costSummary(c)).toBeNull();
    c.artworkAllocated = 0;
    expect(costSummary(c)?.total).toBe(1368);
  });
  it("uses actual discounted print payment with no imaginary discount fund", () => {
    const s = fixture(),
      c = cost(s);
    c.artworkAllocated = 0;
    const r = costSummary(c)!;
    expect(r.total).toBe(1368);
    expect(r.unitCost).toBe("45.6000");
    expect(r.profit).toBe("4632");
    expect(r.breakEven).toBe("7");
  });
  it("includes an explicit artwork allocation and different manufacturing quantities", () => {
    const s = fixture(),
      a = cost(s),
      b = { ...a, quantity: 60 };
    expect(costSummary(a)?.unitCost).toBe("178.9333");
    expect(costSummary(b)?.unitCost).toBe("89.4667");
    expect(costSummary(a)?.total).toBe(costSummary(b)?.total);
  });
  it("rounds only final display half up using exact fractions", () => {
    expect(fractionDecimal(1n, 3n)).toBe("0.3333");
    expect(fractionDecimal(1n, 20000n)).toBe("0.0001");
    expect(fractionDecimal(-1n, 20000n)).toBe("-0.0001");
  });
  it("zero sale price cannot yield a fictitious break even", () => {
    const s = fixture(),
      c = cost(s);
    c.unitSalePrice = 0;
    expect(costSummary(c)?.breakEven).toBeNull();
    expect(costSummary(c)?.profit).toBe("-5368");
  });
  it("retains loss instead of truncating it to zero", () => {
    const s = fixture(),
      c = cost(s);
    c.unitSalePrice = 100;
    expect(costSummary(c)?.profit).toBe("-2368");
  });
  it("does not produce profit if sale price is unknown", () => {
    const s = fixture(),
      c = cost(s);
    c.unitSalePrice = null;
    expect(costSummary(c)?.profit).toBeNull();
  });
  it("rejects fractional/negative cost, zero quantity, overflow and foreign payer", () => {
    for (const patch of [
      { actualPrint: -1 },
      { quantity: 0 },
      { actualPrint: 0.1 },
      { actualPrint: Number.MAX_SAFE_INTEGER },
      { paidById: "foreign" },
    ]) {
      const s = fixture();
      expect(() => putCost(s, { ...cost(s), ...patch })).toThrow();
    }
  });
  it("editing cost preserves id and never creates inventory or actual payment", () => {
    const s = fixture();
    putCost(s, cost(s));
    const id = s.costs[0]!.id;
    putCost(s, { ...cost(s), name: "改名" }, id);
    expect(s.costs[0]!.id).toBe(id);
    expect(s.movements).toHaveLength(1);
    expect(s.advances).toHaveLength(0);
  });
  it("actual advance is independent of product cost and revenue", () => {
    const s = fixture(),
      a = advance(s);
    expect(a.principal).toBe(1368);
    expect(s.costs).toHaveLength(0);
    expect(s.sales).toHaveLength(0);
    expect(advanceRepaid(a)).toBe(0);
  });
  it("partial repayment reduces only principal and blocks overpayment", () => {
    const s = fixture(),
      a = advance(s);
    repayAdvance(s, a.id, 1000, "已轉帳");
    expect(advanceRepaid(a)).toBe(1000);
    expect(a.principal - advanceRepaid(a)).toBe(368);
    expect(() => repayAdvance(s, a.id, 369, "")).toThrow("超過");
    expect(s.sales).toHaveLength(0);
  });
  it("repayment reversal is compensating and cannot repeat", () => {
    const s = fixture(),
      a = advance(s);
    repayAdvance(s, a.id, 1000, "記錯");
    reverseRepayment(s, a.id, a.repayments[0]!.id, "轉帳未成功");
    expect(advanceRepaid(a)).toBe(0);
    expect(a.repayments).toHaveLength(2);
    expect(() =>
      reverseRepayment(s, a.id, a.repayments[0]!.id, "重複"),
    ).toThrow();
    expect(validateRestoreSnapshot(s)).toEqual(s);
  });
  it("void requires no outstanding effective repayment and preserves history", () => {
    const s = fixture(),
      a = advance(s);
    repayAdvance(s, a.id, 10, "");
    expect(() => voidAdvance(s, a.id, "本金記錯")).toThrow();
    reverseRepayment(s, a.id, a.repayments[0]!.id, "還款記錯");
    voidAdvance(s, a.id, "本金記錯重新登記");
    expect(a.voidedAt).not.toBe("");
    expect(() => repayAdvance(s, a.id, 1, "")).toThrow();
  });
  it("cannot label own payment as receivable from self", () => {
    const s = fixture();
    expect(() =>
      putAdvance(s, {
        name: "自付",
        payerId: s.parties[0]!.id,
        debtorId: s.parties[0]!.id,
        principal: 10,
        notes: "",
      }),
    ).toThrow("自行負擔");
  });
  it("rejects forged excess repayment in restored backup", () => {
    const s = fixture(),
      a = advance(s);
    repayAdvance(s, a.id, 10, "");
    a.repayments[0]!.amount = 2000;
    expect(() => validateRestoreSnapshot(s)).toThrow("本金");
  });
  it("full workspace sales costs advance and reversal survive XLSX roundtrip", async () => {
    const s = fixture();
    const a = completeSale(s, sale(s));
    cancelSale(s, a.id, "已退");
    putCost(s, cost(s));
    const d = advance(s);
    repayAdvance(s, d.id, 1000, "實付");
    expect(await inspectProject(await exportProject(s))).toEqual(s);
  });
  it("upgrades schema6 DB without rewriting existing IDs or setting invented money", async () => {
    const s = fixture(),
      name = "migrate-sales-" + crypto.randomUUID();
    const { default: Dexie } = await import("dexie");
    const old = new Dexie(name);
    old
      .version(6)
      .stores({ workspaces: "id, createdAt", catalogs: "workspaceId" });
    const { sales, costs, advances, ...legacy } = s;
    await old.table("workspaces").add(s.workspace);
    await old.table("catalogs").add({ ...legacy, schemaVersion: 6 });
    old.close();
    const db = new ConMateDatabase(name);
    try {
      const next = await db.catalogs.get(s.workspaceId);
      expect(next?.schemaVersion).toBe(17);
      expect(next?.products).toEqual(s.products);
      expect(next?.movements).toMatchObject(
        s.movements.map(({ batchAllocations, ...m }) => m),
      );
      expect(next?.sales).toEqual([]);
      expect(next?.costs).toEqual([]);
    } finally {
      await db.delete();
    }
  });
});
