import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import Dexie from "dexie";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { ConMateDatabase } from "../../src/infrastructure/storage/workspaces";
import { putProduct, record } from "../../src/domain/catalog/operations";
import {
  addLocation,
  addMovement,
} from "../../src/domain/inventory/operations";
import { completeSale } from "../../src/domain/sales/operations";
import { refundSale } from "../../src/domain/sales/refunds";
import { putCost } from "../../src/domain/finance/operations";
import {
  createSettlement,
  recordSettlementTrial,
  decideSettlement,
  paySettlement,
  reverseSettlementPayment,
  closeSettlement,
  reopenSettlement,
  setSettlementHoldings,
  settlementBalances,
  parseSettlementPercent,
  calculateSettlement,
  settlementTrialChanged,
  recordSettlementCash,
  reverseSettlementCash,
} from "../../src/domain/finance/settlements";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
import type { SettlementTrialInput } from "../../src/domain/models/catalog";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "分配",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const p = putProduct(s, {
      name: "甲徽章",
      creatorName: "創作者",
      productType: "徽章",
      specification: "",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    }),
    owner = s.parties[0]!;
  const manager = record(s, "PTY", "總召");
  s.parties.push({...manager,notes:"",archived:false});
  const l = addLocation(s, "攤位");
  addMovement(s, {
    productId: p.id,
    kind: "receipt",
    quantity: 20,
    fromLocationId: "",
    toLocationId: l.id,
    reason: "入庫",
  });
  const sale = completeSale(s, {
    operationId: crypto.randomUUID(),
    locationId: l.id,
    eventId: "",
    collectorId: manager.id,
    cashReceived: 1000,
    notes: "",
    lines: [{ productId: p.id, mode: "direct", quantity: 10, unitPrice: 100 }],
  });
  putCost(s, {
    name: "整批",
    productId: p.id,
    quantity: 20,
    estimatedPrint: 100,
    actualPrint: 100,
    artworkAllocated: 0,
    otherCost: 0,
    unitSalePrice: 100,
    paidById: owner.id,
    burdenPartyId: owner.id,
    notes: "",
  });
  const cost = s.costs[0]!,
    g = createSettlement(s, "第一場", "");
  const input: SettlementTrialInput = {
    saleLineIds: [sale.lines[0]!.id],
    costIds: [cost.id],
    base: "revenue",
    ratePercent: "20",
    fixedFee: 0,
    fixedOrder: "after-rate",
    negativePolicy: "zero-fee",
    feePartyId: manager.id,
    shares: [{ partyId: owner.id, percent: "100" }],
    notes: "",
  };
  return { s, p, owner, manager, l, sale, cost, g, input };
}
const amount = (
  allocations: { partyId: string; amount: number }[],
  id: string,
) => allocations.find((a) => a.partyId === id)?.amount;
it("revenue commission always deducts selected costs from available profit", () => {
  const { s, g, input, owner, manager } = fixture();
  const t = recordSettlementTrial(s, g.id, input);
  expect(t.result.status).toBe("complete");
  expect(t.result.roundedBase).toBe(900);
  expect(amount(t.result.allocations, manager.id)).toBe(200);
  expect(amount(t.result.allocations, owner.id)).toBe(700);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("net-cost commission has distinct exact base", () => {
  const { s, g, input, owner, manager } = fixture();
  input.base = "revenue-minus-costs";
  const t = recordSettlementTrial(s, g.id, input);
  expect(amount(t.result.allocations, manager.id)).toBe(180);
  expect(amount(t.result.allocations, owner.id)).toBe(720);
});
it("explicit fixed-fee order changes percentage basis but conserves available total", () => {
  const { s, g, input, manager } = fixture();
  input.fixedFee = 100;
  input.fixedOrder = "before-rate";
  const a = recordSettlementTrial(s, g.id, input);
  input.fixedOrder = "after-rate";
  const b = recordSettlementTrial(s, g.id, input);
  expect(amount(a.result.allocations, manager.id)).toBe(280);
  expect(amount(b.result.allocations, manager.id)).toBe(300);
  for (const t of [a, b])
    expect(t.result.allocations.reduce((n, a) => n + a.amount, 0)).toBe(900);
});
it("selects exact sale lines from mixed transactions rather than all merchandise", () => {
  const { s, g, input, p, l, manager } = fixture();
  const sale = completeSale(s, {
    operationId: crypto.randomUUID(),
    locationId: l.id,
    eventId: "",
    collectorId: manager.id,
    cashReceived: 250,
    notes: "",
    lines: [
      { productId: p.id, mode: "direct", quantity: 1, unitPrice: 200 },
      { productId: p.id, mode: "draw", quantity: 1, unitPrice: 50 },
    ],
  });
  input.saleLineIds = [sale.lines[1]!.id];
  input.costIds = [];
  const t = recordSettlementTrial(s, g.id, input);
  expect(t.result.revenue).toBe(50);
  expect(t.saleSources).toHaveLength(1);
  expect(t.saleSources[0]!.saleLineId).toBe(sale.lines[1]!.id);
});
it("preserves source snapshot when later refunds change live revenue", () => {
  const { s, g, input, sale } = fixture();
  const t = recordSettlementTrial(s, g.id, input);
  expect(settlementTrialChanged(s, t)).toBe(false);
  refundSale(s, {
    operationId: crypto.randomUUID(),
    saleId: sale.id,
    reason: "只退部分款",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 100,
        restockQuantity: 0,
        damagedQuantity: 0,
        returnLocationId: "",
      },
    ],
  });
  const next = recordSettlementTrial(s, g.id, input);
  expect(settlementTrialChanged(s, t)).toBe(true);
  expect(settlementTrialChanged(s, next)).toBe(false);
  expect(t.result.revenue).toBe(1000);
  expect(next.result.revenue).toBe(900);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("exact fractional batch costs are not rounded before commission and split", () => {
  const { input, owner, manager } = fixture();
  input.base = "revenue-minus-costs";
  input.ratePercent = "33.3333";
  const r = calculateSettlement(
    input,
    [
      {
        saleId: "sale",
        saleLineId: input.saleLineIds[0]!,
        productId: "p",
        productName: "商品",
        eventId: "",
        planId: "",
        collectorId: "",
        gross: 1,
        refunded: 0,
        net: 1,
      },
    ],
    [
      {
        costId: input.costIds[0]!,
        name: "精確成本",
        exactAmount: { numerator: "1", denominator: "3" },
      },
    ],
  );
  expect(r.exactAvailable).toEqual({ numerator: "2", denominator: "3" });
  expect(r.exactFee).toEqual({ numerator: "111111", denominator: "500000" });
  expect(r.allocations.reduce((a, v) => a + v.amount, 0)).toBe(1);
  expect(r.allocations.some((a) => a.partyId === owner.id)).toBe(true);
  expect(r.allocations.some((a) => a.partyId === manager.id)).toBe(true);
});
it("zero percentage on negative basis leaves fixed fee and loss visible", () => {
  const { s, g, input, cost, owner, manager } = fixture();
  cost.actualPrint = 1100;
  input.base = "revenue-minus-costs";
  input.fixedFee = 10;
  const t = recordSettlementTrial(s, g.id, input);
  expect(amount(t.result.allocations, manager.id)).toBe(10);
  expect(amount(t.result.allocations, owner.id)).toBe(-110);
  expect(t.result.roundedBase).toBe(-100);
});
it("signed negative commission is explicit rather than secretly clamped", () => {
  const { s, g, input, cost, owner, manager } = fixture();
  cost.actualPrint = 1100;
  input.base = "revenue-minus-costs";
  input.negativePolicy = "signed";
  const t = recordSettlementTrial(s, g.id, input);
  expect(amount(t.result.allocations, manager.id)).toBe(-20);
  expect(amount(t.result.allocations, owner.id)).toBe(-80);
});
it("manual negative policy yields unavailable trial but allows decision and closing", () => {
  const { s, g, input, cost, owner } = fixture();
  cost.actualPrint = 1100;
  input.base = "revenue-minus-costs";
  input.negativePolicy = "manual";
  const t = recordSettlementTrial(s, g.id, input);
  expect(t.result.status).toBe("partial");
  decideSettlement(s, g.id, {
    trialId: t.id,
    allocations: [{ partyId: owner.id, amount: 0 }],
    reason: "共同承擔另議",
  });
  closeSettlement(s, g.id, "使用者決定先結束");
  expect(g.closedAt).not.toBe("");
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("missing rules stay unknown, explicit zero differs from missing", () => {
  const { s, g, input } = fixture();
  input.ratePercent = null;
  input.fixedFee = null;
  const t = recordSettlementTrial(s, g.id, input);
  expect(t.result.status).toBe("partial");
  expect(t.result.allocations).toEqual([]);
  expect(t.result.unknownItems.join()).toContain("尚未填寫");
  input.ratePercent = "0";
  input.fixedFee = 0;
  expect(recordSettlementTrial(s, g.id, input).result.status).toBe("complete");
});
it("unknown selected cost blocks profit trial and can still make manual decision without trial", () => {
  const { s, g, input, cost, owner } = fixture();
  cost.actualPrint = null;
  const t = recordSettlementTrial(s, g.id, input);
  expect(t.result.exactAvailable).toBeNull();
  expect(t.result.roundedBase).toBeNull();
  const d = decideSettlement(s, g.id, {
    trialId: "",
    allocations: [{ partyId: owner.id, amount: 42 }],
    reason: "人工約定",
  });
  expect(d.variance).toBeNull();
  expect(d.total).toBe(42);
});
it("rate parsing prevents floating point drift and malformed percentages", () => {
  expect(parseSettlementPercent("20.0001")).toBe(200001n);
  for (const v of ["100.0001", "-1", "20%", "0.12345", "1e2"])
    expect(() => parseSettlementPercent(v)).toThrow();
});
it("largest remainder distributes deterministic whole dollars without losing money", () => {
  const { s, g, input, owner, manager } = fixture();
  input.costIds = [];
  input.saleLineIds = [];
  input.ratePercent = "0";
  const sources = [
    {
      saleId: "s",
      saleLineId: "l",
      productId: "p",
      productName: "p",
      eventId: "",
      planId: "",
      collectorId: "",
      gross: 1,
      refunded: 0,
      net: 1,
    },
  ];
  input.shares = [
    { partyId: owner.id, percent: "50" },
    { partyId: manager.id, percent: "50" },
  ];
  const a = calculateSettlement(input, sources, []);
  input.shares.reverse();
  const b = calculateSettlement(input, sources, []);
  expect(a.allocations).toEqual(b.allocations);
  expect(a.allocations.reduce((n, v) => n + v.amount, 0)).toBe(1);
  expect(amount(a.allocations, [owner.id, manager.id].sort()[0]!)).toBe(1);
});
it("repeated trial is simulation and never creates payments, costs or advance principal", () => {
  const { s, g, input } = fixture();
  recordSettlementTrial(s, g.id, input);
  recordSettlementTrial(s, g.id, input);
  expect(g.payments).toEqual([]);
  expect(s.costs).toHaveLength(1);
  expect(s.advances).toEqual([]);
});
it("latest manual decision is cumulative target and retains actual transfers", () => {
  const { s, g, owner, manager } = fixture();
  setSettlementHoldings(s, g.id, [
    { partyId: owner.id, amount: 0 },
    { partyId: manager.id, amount: 1000 },
  ]);
  decideSettlement(s, g.id, {
    trialId: "",
    allocations: [
      { partyId: owner.id, amount: 700 },
      { partyId: manager.id, amount: 300 },
    ],
    reason: "第一版",
  });
  paySettlement(s, g.id, {
    operationId: "paid1",
    fromPartyId: manager.id,
    toPartyId: owner.id,
    amount: 400,
    notes: "先付",
  });
  expect(
    settlementBalances(s, g.id).find((a) => a.partyId === owner.id)?.due,
  ).toBe(300);
  decideSettlement(s, g.id, {
    trialId: "",
    allocations: [
      { partyId: owner.id, amount: 650 },
      { partyId: manager.id, amount: 350 },
    ],
    reason: "退款後修訂累計",
  });
  expect(
    settlementBalances(s, g.id).find((a) => a.partyId === owner.id)?.due,
  ).toBe(250);
  expect(g.payments).toHaveLength(1);
});
it("actual holdings subtract from entitlement and missing baseline remains unknown", () => {
  const { s, g, owner, manager } = fixture();
  decideSettlement(s, g.id, {
    trialId: "",
    allocations: [{ partyId: owner.id, amount: 700 }],
    reason: "人工",
  });
  expect(settlementBalances(s, g.id)[0]!.due).toBeNull();
  setSettlementHoldings(s, g.id, [{ partyId: owner.id, amount: 200 }]);
  expect(
    settlementBalances(s, g.id).find((a) => a.partyId === owner.id)?.due,
  ).toBe(500);
  paySettlement(s, g.id, {
    operationId: "p",
    fromPartyId: manager.id,
    toPartyId: owner.id,
    amount: 50,
    notes: "",
  });
  expect(
    settlementBalances(s, g.id).find((a) => a.partyId === owner.id)?.due,
  ).toBe(450);
  expect(
    settlementBalances(s, g.id).find((a) => a.partyId === manager.id)?.due,
  ).toBeNull();
});
it("holds declaration needs explicit person and cannot be silently changed after transfer", () => {
  const { s, g, owner, manager } = fixture();
  expect(() => setSettlementHoldings(s, g.id, [])).toThrow();
  expect(g.openingHoldings).toBeNull();
  paySettlement(s, g.id, {
    operationId: "p",
    fromPartyId: manager.id,
    toPartyId: owner.id,
    amount: 1,
    notes: "",
  });
  expect(() =>
    setSettlementHoldings(s, g.id, [{ partyId: owner.id, amount: 0 }]),
  ).toThrow();
});
it("payments have idempotency and reverse by explicit opposite transfer once", () => {
  const { s, g, owner, manager } = fixture();
  const cmd = {
    operationId: "pay",
    fromPartyId: manager.id,
    toPartyId: owner.id,
    amount: 123,
    notes: "分款",
  };
  const p = paySettlement(s, g.id, cmd);
  expect(paySettlement(s, g.id, cmd).id).toBe(p.id);
  expect(() => paySettlement(s, g.id, { ...cmd, amount: 124 })).toThrow();
  reverseSettlementPayment(s, g.id, p.id, "輸入錯誤");
  expect(() => reverseSettlementPayment(s, g.id, p.id, "再沖")).toThrow();
  expect(settlementBalances(s, g.id).every((b) => b.receivedNet === 0)).toBe(
    true,
  );
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("manual variance is saved instead of forcing fake matching allocation", () => {
  const { s, g, input, owner } = fixture();
  const t = recordSettlementTrial(s, g.id, input),
    d = decideSettlement(s, g.id, {
      trialId: t.id,
      allocations: [{ partyId: owner.id, amount: 1000 }],
      reason: "成員另議差額",
    });
  expect(d.variance).toBe(100);
  expect(t.result.roundedBase).toBe(900);
});
it("overlapping sources warn and never double charge a financial ledger", () => {
  const { s, g, input } = fixture();
  recordSettlementTrial(s, g.id, input);
  const other = createSettlement(s, "另一試算", "");
  const t = recordSettlementTrial(s, other.id, input);
  expect(t.result.warnings.join()).toContain("重疊");
  expect(s.costs).toHaveLength(1);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("reopen preserves closure history and cumulative payments for later refunds", () => {
  const { s, g, owner, manager } = fixture();
  closeSettlement(s, g.id, "先結束");
  expect(() =>
    decideSettlement(s, g.id, { trialId: "", allocations: [], reason: "改" }),
  ).toThrow();
  paySettlement(s, g.id, {
    operationId: "late",
    fromPartyId: manager.id,
    toPartyId: owner.id,
    amount: 50,
    notes: "結束後實際付款",
  });
  reopenSettlement(s, g.id, "退款後追加");
  decideSettlement(s, g.id, {
    trialId: "",
    allocations: [{ partyId: owner.id, amount: 60 }],
    reason: "新累計目標",
  });
  expect(g.statusHistory.map((h) => h.kind)).toEqual(["close", "reopen"]);
  expect(g.payments).toHaveLength(1);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("trial source remains immutable after current batch cost changes", () => {
  const { s, g, input, cost } = fixture();
  const t = recordSettlementTrial(s, g.id, input);
  cost.actualPrint = 999;
  expect(t.costSources[0]!.exactAmount).toEqual({
    numerator: "100",
    denominator: "1",
  });
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("rejects tampered allocations, source values, duplicate payments and status history", () => {
  const { s, g, input } = fixture();
  recordSettlementTrial(s, g.id, input);
  for (const change of [
    (x: any) => x.settlements[0].trials[0].result.allocations[0].amount++,
    (x: any) => x.settlements[0].trials[0].saleSources[0].gross++,
    (x: any) => (x.settlements[0].closedAt = new Date().toISOString()),
  ]) {
    const copy = structuredClone(s);
    change(copy);
    expect(() => validateRestoreSnapshot(copy)).toThrow();
  }
});
it("roundtrips all trial, manual, holdings, payments and closure history in XLSX", async () => {
  const { s, g, input, owner, manager } = fixture();
  const t = recordSettlementTrial(s, g.id, input);
  decideSettlement(s, g.id, {
    trialId: t.id,
    allocations: t.result.allocations,
    reason: "採試算",
  });
  setSettlementHoldings(s, g.id, [
    { partyId: owner.id, amount: 0 },
    { partyId: manager.id, amount: 1000 },
  ]);
  const p = paySettlement(s, g.id, {
    operationId: "p",
    fromPartyId: manager.id,
    toPartyId: owner.id,
    amount: 100,
    notes: "已付",
  });
  reverseSettlementPayment(s, g.id, p.id, "改正");
  closeSettlement(s, g.id, "待款仍結束");
  expect(await inspectProject(await exportProject(s))).toEqual(s);
});
it("upgrades old schema11 in database and restore without inventing settlement", async () => {
  const { s } = fixture();
  const old: any = structuredClone(s);
  old.schemaVersion = 11;
  delete old.settlements;
  expect(validateRestoreSnapshot(old).settlements).toEqual([]);
  const name = "settlement-migrate-" + crypto.randomUUID(),
    db = new Dexie(name);
  db.version(12).stores({
    workspaces: "id, createdAt",
    catalogs: "workspaceId",
    recoverySnapshots: "id, workspaceId, createdAt",
    backupStatus: "workspaceId",
  });
  await db.table("workspaces").add(old.workspace);
  await db.table("catalogs").add(old);
  db.close();
  const next = new ConMateDatabase(name);
  try {
    const got = await next.catalogs.get(s.workspaceId);
    expect(got?.schemaVersion).toBe(23);
    expect(got?.settlements).toEqual([]);
    expect(got?.sales).toEqual(s.sales);
  } finally {
    await next.delete();
  }
});

it("external actual cash outflow after customer refund affects holdings without recharging costs", () => {
  const { s, g, owner, manager, input, sale } = fixture();
  setSettlementHoldings(s, g.id, [
    { partyId: owner.id, amount: 0 },
    { partyId: manager.id, amount: 1000 },
  ]);
  const t = recordSettlementTrial(s, g.id, input);
  decideSettlement(s, g.id, {
    trialId: t.id,
    allocations: t.result.allocations,
    reason: "第一次",
  });
  paySettlement(s, g.id, {
    operationId: "p",
    fromPartyId: manager.id,
    toPartyId: owner.id,
    amount: 700,
    notes: "分款",
  });
  refundSale(s, {
    operationId: "refund",
    saleId: sale.id,
    reason: "客人退款",
    lines: [
      {
        saleLineId: sale.lines[0]!.id,
        amount: 100,
        restockQuantity: 0,
        damagedQuantity: 0,
        returnLocationId: "",
      },
    ],
  });
  const next = recordSettlementTrial(s, g.id, input);
  decideSettlement(s, g.id, {
    trialId: next.id,
    allocations: next.result.allocations,
    reason: "退款後累計",
  });
  const before = settlementBalances(s, g.id).find(
    (b) => b.partyId === manager.id,
  )!;
  expect(before.openingHeld).toBe(1000);
  expect(before.receivedNet).toBe(-700);
  const cmd = {
    operationId: "cash",
    partyId: manager.id,
    amount: -100,
    reason: "實際由總召退款客人",
  };
  const a = recordSettlementCash(s, g.id, cmd);
  expect(recordSettlementCash(s, g.id, cmd).id).toBe(a.id);
  expect(() =>
    recordSettlementCash(s, g.id, { ...cmd, amount: -101 }),
  ).toThrow();
  const after = settlementBalances(s, g.id).find(
    (b) => b.partyId === manager.id,
  )!;
  expect(after.effectiveHeld).toBe(200);
  expect(after.due).toBe(-20);
  expect(s.costs).toHaveLength(1);
  expect(s.advances).toEqual([]);
  reverseSettlementCash(s, g.id, a.id, "誤登");
  expect(() => reverseSettlementCash(s, g.id, a.id, "再沖")).toThrow();
  expect(
    settlementBalances(s, g.id).find((b) => b.partyId === manager.id)!
      .externalNet,
  ).toBe(0);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("unknown opening cash remains unknown even when later external movement is recorded", () => {
  const { s, g, owner } = fixture();
  recordSettlementCash(s, g.id, {
    operationId: "external",
    partyId: owner.id,
    amount: 20,
    reason: "實際收款",
  });
  expect(settlementBalances(s, g.id)[0]!.due).toBeNull();
  expect(() =>
    setSettlementHoldings(s, g.id, [{ partyId: owner.id, amount: 0 }]),
  ).toThrow();
});
it("projected transfers and external cash overflow reject before creating a broken ledger", () => {
  const { s, g, owner, manager } = fixture();
  paySettlement(s, g.id, {
    operationId: "max",
    fromPartyId: manager.id,
    toPartyId: owner.id,
    amount: Number.MAX_SAFE_INTEGER,
    notes: "",
  });
  expect(() =>
    paySettlement(s, g.id, {
      operationId: "one",
      fromPartyId: manager.id,
      toPartyId: owner.id,
      amount: 1,
      notes: "",
    }),
  ).toThrow();
  expect(g.payments).toHaveLength(1);
  recordSettlementCash(s, g.id, {
    operationId: "extmax",
    partyId: manager.id,
    amount: Number.MAX_SAFE_INTEGER,
    reason: "大額",
  });
  expect(() =>
    recordSettlementCash(s, g.id, {
      operationId: "ext1",
      partyId: manager.id,
      amount: 1,
      reason: "超限",
    }),
  ).toThrow();
  expect(g.cashAdjustments).toHaveLength(1);
});
