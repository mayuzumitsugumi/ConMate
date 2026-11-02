import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import { putCost, costSummary } from "../../src/domain/finance/operations";
import {
  putArtworkExpense,
  previewArtworkAllocation,
  applyArtworkAllocation,
  reverseArtworkAllocation,
  artworkUnitDisplay,
  voidArtworkExpense,
} from "../../src/domain/finance/artwork";
import {
  putExpensePayment,
  reverseExpensePayment,
  expenseReconciliation,
} from "../../src/domain/finance/payments";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
import type { ArtworkAllocationInput } from "../../src/domain/models/catalog";
function fixture(
  qs = [30, 15, 15, 30],
  prints = [600, 240, 240, 150],
  amount = 4000,
) {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "柄圖分攤",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  for (let i = 0; i < qs.length; i++) {
    const p = putProduct(s, {
      name: "商品" + i,
      creatorName: "甲",
      productType: "種類" + i,
      specification: "",
      artwork: "共用圖",
      notes: "",
      tagIds: [],
      customValues: {},
    });
    putCost(s, {
      name: "批次" + i,
      productId: p.id,
      quantity: qs[i]!,
      actualPrint: prints[i]!,
      estimatedPrint: prints[i]!,
      artworkAllocated: null,
      otherCost: 0,
      unitSalePrice: 100,
      paidById: "",
      burdenPartyId: "",
      notes: "",
    });
  }
  const source = putArtworkExpense(s, {
    name: "共用圖委託費",
    artworkId: s.artworks[0]!.id,
    amount,
    notes: "",
  });
  const input: ArtworkAllocationInput = {
    method: "unit-print",
    basis: "actual",
    allowReplaceManual: false,
    targets: s.costs.map((c) => ({
      costId: c.id,
      weight: "1",
      manualAmount: null,
    })),
  };
  return { s, source, input };
}
it("matches provided artwork formula with unequal quantities and preserves exact fractions", () => {
  const { s, source, input } = fixture();
  const result = previewArtworkAllocation(s, source, input);
  expect(
    result.map(
      (t) => `${t.exactAmount.numerator}/${t.exactAmount.denominator}`,
    ),
  ).toEqual(["80000/57", "64000/57", "64000/57", "20000/57"]);
  expect(result.reduce((a, t) => a + t.integerAmount, 0)).toBe(4000);
  applyArtworkAllocation(s, source.id, input);
  expect(costSummary(s.costs[0]!)?.unitCost).toBe("66.7836");
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("uses explicitly estimated print weights while actual discounted cost remains actual", () => {
  const { s, source, input } = fixture([30, 30], [1710, 150], 6000);
  s.costs[0]!.actualPrint = 1368;
  input.basis = "estimated";
  const rows = previewArtworkAllocation(s, source, input);
  expect(rows[0]!.exactAmount).toEqual({
    numerator: "171000",
    denominator: "31",
  });
  applyArtworkAllocation(s, source.id, input);
  expect(costSummary(s.costs[0]!)?.unitCost).toBe("229.4710");
  expect(s.advances).toHaveLength(0);
});
it("supports total-print, equal, custom and manual methods without normalizing quantities", () => {
  const { s, source, input } = fixture([10, 20], [100, 400], 900);
  expect(
    previewArtworkAllocation(s, source, input).map((t) => t.integerAmount),
  ).toEqual([300, 600]);
  input.method = "total-print";
  expect(
    previewArtworkAllocation(s, source, input).map((t) => t.integerAmount),
  ).toEqual([180, 720]);
  input.method = "equal";
  expect(
    previewArtworkAllocation(s, source, input).map((t) => t.integerAmount),
  ).toEqual([450, 450]);
  input.method = "custom";
  input.targets[0]!.weight = "0.5";
  input.targets[1]!.weight = "1";
  expect(
    previewArtworkAllocation(s, source, input).map((t) => t.integerAmount),
  ).toEqual([300, 600]);
  input.method = "manual";
  input.targets[0]!.manualAmount = 200;
  input.targets[1]!.manualAmount = 700;
  expect(
    previewArtworkAllocation(s, source, input).map((t) => t.integerAmount),
  ).toEqual([200, 700]);
});
it("allocates equal remainder by stable cost IDs regardless of selected row order", () => {
  const { s, source, input } = fixture([1, 1, 1], [1, 1, 1], 100);
  s.costs[0]!.id = "c";
  s.costs[1]!.id = "a";
  s.costs[2]!.id = "b";
  input.method = "equal";
  input.targets = s.costs.map((c) => ({
    costId: c.id,
    weight: "1",
    manualAmount: null,
  }));
  const rows = previewArtworkAllocation(s, source, input);
  expect(
    Object.fromEntries(rows.map((r) => [r.costId, r.integerAmount])),
  ).toEqual({ a: 34, b: 33, c: 33 });
  input.targets.reverse();
  expect(
    Object.fromEntries(
      previewArtworkAllocation(s, source, input).map((r) => [
        r.costId,
        r.integerAmount,
      ]),
    ),
  ).toEqual({ a: 34, b: 33, c: 33 });
});
it("blocks missing basis, zero weight total, bad precision, duplicates and unrelated artwork", () => {
  const { s, source, input } = fixture([1, 1], [0, 0], 100);
  expect(() => previewArtworkAllocation(s, source, input)).toThrow("合計");
  s.costs[0]!.actualPrint = null;
  expect(() => previewArtworkAllocation(s, source, input)).toThrow("尚未");
  input.method = "custom";
  input.targets[0]!.weight = "1.00001";
  expect(() => previewArtworkAllocation(s, source, input)).toThrow("權重");
  input.targets[0]!.weight = "1";
  input.targets.push(input.targets[0]!);
  expect(() => previewArtworkAllocation(s, source, input)).toThrow("不重複");
  input.targets.pop();
  s.products[0]!.artworkId = "foreign";
  expect(() => previewArtworkAllocation(s, source, input)).toThrow("來源柄圖");
});
it("rejects manual amounts that do not sum to source and allows legitimate zero source", () => {
  const { s, source, input } = fixture([1, 1], [1, 1], 100);
  input.method = "manual";
  input.targets[0]!.manualAmount = 40;
  input.targets[1]!.manualAmount = 50;
  expect(() => previewArtworkAllocation(s, source, input)).toThrow("合計");
  source.amount = 0;
  input.targets.forEach((t) => (t.manualAmount = 0));
  expect(
    previewArtworkAllocation(s, source, input).map((t) => t.integerAmount),
  ).toEqual([0, 0]);
});
it("requires explicit manual replacement, prevents duplicate sources and restores originals", () => {
  const { s, source, input } = fixture([1], [10], 100);
  s.costs[0]!.artworkAllocated = 11;
  expect(() => applyArtworkAllocation(s, source.id, input)).toThrow("人工");
  input.allowReplaceManual = true;
  applyArtworkAllocation(s, source.id, input);
  expect(s.costs[0]!.artworkAllocated).toBe(100);
  expect(() => applyArtworkAllocation(s, source.id, input)).toThrow("重複");
  reverseArtworkAllocation(s, source.id, "改用其他基準");
  expect(s.costs[0]!.artworkAllocated).toBe(11);
  expect(s.costs[0]!.artworkAllocation).toBeUndefined();
  applyArtworkAllocation(s, source.id, input);
  expect(source.allocations.map((a) => a.version)).toEqual([1, 2]);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("locks active cost basis and permits notes and sale price changes until allocation reversed", () => {
  const { s, source, input } = fixture([1], [10], 100);
  applyArtworkAllocation(s, source.id, input);
  const c = s.costs[0]!;
  expect(() => putCost(s, { ...c, quantity: 2 }, c.id)).toThrow("撤銷");
  expect(() => putCost(s, { ...c, artworkAllocated: 0 }, c.id)).toThrow("撤銷");
  putCost(s, { ...c, notes: "補註", unitSalePrice: 200 }, c.id);
  expect(c.notes).toBe("補註");
  reverseArtworkAllocation(s, source.id, "修改數量");
  putCost(s, { ...c, quantity: 2 }, c.id);
  expect(c.quantity).toBe(2);
});
it("records partial actual supplier payments apart from expenses and advances, including overpayment", () => {
  const { s } = fixture([30], [1368], 0);
  const c = s.costs[0]!,
    payer = s.parties[0]!.id;
  putExpensePayment(s, {
    category: "print",
    costId: c.id,
    artworkSourceId: "",
    payerId: payer,
    recipient: "印刷廠",
    amount: 1000,
    notes: "第一期",
  });
  expect(expenseReconciliation(s, "print", c.id, "")).toEqual({
    expected: "1368",
    paid: "1000",
    difference: "368",
  });
  const p = putExpensePayment(s, {
    category: "print",
    costId: c.id,
    artworkSourceId: "",
    payerId: payer,
    recipient: "印刷廠",
    amount: 500,
    notes: "尾款誤付",
  });
  expect(expenseReconciliation(s, "print", c.id, "").difference).toBe("-132");
  expect(s.advances).toHaveLength(0);
  expect(c.actualPrint).toBe(1368);
  reverseExpensePayment(s, p.id, "登錯");
  expect(expenseReconciliation(s, "print", c.id, "").difference).toBe("368");
  expect(() => reverseExpensePayment(s, p.id, "重複")).toThrow();
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("unknown actual expense remains unknown even after payment and artwork is counted once", () => {
  const { s, source, input } = fixture([1, 1], [1, 1], 100);
  applyArtworkAllocation(s, source.id, input);
  const c = s.costs[0]!,
    payer = s.parties[0]!.id;
  putExpensePayment(s, {
    category: "artwork",
    costId: "",
    artworkSourceId: source.id,
    payerId: payer,
    recipient: "繪師",
    amount: 100,
    notes: "",
  });
  expect(expenseReconciliation(s, "artwork", "", source.id)).toEqual({
    expected: "100",
    paid: "100",
    difference: "0",
  });
  c.otherCost = null;
  expect(expenseReconciliation(s, "other", c.id, "")).toEqual({
    expected: null,
    paid: "0",
    difference: null,
  });
  expect(s.expensePayments).toHaveLength(1);
});
it("does not void sources with active allocations or payments, preserving history after cancellation", () => {
  const { s, source, input } = fixture([1], [10], 100);
  applyArtworkAllocation(s, source.id, input);
  expect(() => voidArtworkExpense(s, source.id, "錯誤")).toThrow();
  reverseArtworkAllocation(s, source.id, "撤銷");
  const p = putExpensePayment(s, {
    category: "artwork",
    costId: "",
    artworkSourceId: source.id,
    payerId: s.parties[0]!.id,
    recipient: "繪師",
    amount: 100,
    notes: "",
  });
  expect(() => voidArtworkExpense(s, source.id, "錯誤")).toThrow();
  reverseExpensePayment(s, p.id, "實付登錯");
  voidArtworkExpense(s, source.id, "來源作廢");
  expect(source.voidedAt).toBeTruthy();
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("round trips exact sources, allocation versions and actual payment audit", async () => {
  const { s, source, input } = fixture();
  applyArtworkAllocation(s, source.id, input);
  putExpensePayment(s, {
    category: "artwork",
    costId: "",
    artworkSourceId: source.id,
    payerId: s.parties[0]!.id,
    recipient: "繪師",
    amount: 1000,
    notes: "部分付款",
  });
  expect(await inspectProject(await exportProject(s))).toEqual(s);
});
it("rejects forged fractions and duplicate allocation accounting on restore", () => {
  const { s, source, input } = fixture();
  applyArtworkAllocation(s, source.id, input);
  const bad = structuredClone(s);
  bad.costs[0]!.artworkAllocation!.numerator = "999";
  expect(() => validateRestoreSnapshot(bad)).toThrow();
  const bad2 = structuredClone(s);
  bad2.artworkExpenses[0]!.allocations[0]!.targets[0]!.integerAmount++;
  expect(() => validateRestoreSnapshot(bad2)).toThrow();
});
it("deduplicates actual payment retries and rejects changed contents for the same operation", () => {
  const { s } = fixture([1], [10], 0);
  const input = {
    operationId: crypto.randomUUID(),
    category: "print" as const,
    costId: s.costs[0]!.id,
    artworkSourceId: "",
    payerId: s.parties[0]!.id,
    recipient: "廠商",
    amount: 10,
    notes: "",
  };
  const one = putExpensePayment(s, input);
  expect(putExpensePayment(s, input).id).toBe(one.id);
  expect(s.expensePayments).toHaveLength(1);
  expect(() => putExpensePayment(s, { ...input, amount: 9 })).toThrow(
    "操作識別",
  );
});
