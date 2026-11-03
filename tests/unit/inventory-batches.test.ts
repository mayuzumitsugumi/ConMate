import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import {
  addMovement,
  addLocation,
  reverseMovement,
  balance,
} from "../../src/domain/inventory/operations";
import {
  batchBalances,
  legacyBatchId,
} from "../../src/domain/inventory/batches";
import { completeSale, cancelSale } from "../../src/domain/sales/operations";
import { refundSale } from "../../src/domain/sales/refunds";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "批次",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const p = putProduct(s, {
    name: "徽章",
    productType: "徽章",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const a = addLocation(s, "家中"),
    b = addLocation(s, "攤位");
  const receipt = (quantity: number, batchName: string) =>
    addMovement(s, {
      productId: p.id,
      kind: "receipt",
      quantity,
      fromLocationId: "",
      toLocationId: a.id,
      reason: "入庫",
      batchName,
    });
  const sale = (quantity: number, locationId = a.id) =>
    completeSale(s, {
      operationId: crypto.randomUUID(),
      locationId,
      eventId: "",
      collectorId: "",
      notes: "",
      cashReceived: quantity * 100,
      lines: [{ productId: p.id, mode: "direct", quantity, unitPrice: 100 }],
    });
  return { s, p, a, b, receipt, sale };
}
it("deducts multiple source batches FIFO despite identical names and timestamps", () => {
  const { s, a, receipt, sale } = fixture();
  const x = receipt(3, "第一批"),
    y = receipt(4, "第一批");
  const sold = sale(5),
    m = s.movements.find((m) => m.id === sold.lines[0]!.movementId)!;
  expect(m.batchAllocations).toEqual([
    { batchId: x.id, quantity: 3 },
    { batchId: y.id, quantity: 2 },
  ]);
  expect(batchBalances(s).quantity(y.id, a.id)).toBe(2);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("transfer retains original source order and reversal restores the exact lots", () => {
  const { s, p, a, b, receipt, sale } = fixture();
  const x = receipt(2, "一"),
    y = receipt(3, "二");
  const transfer = addMovement(s, {
    productId: p.id,
    kind: "transfer",
    quantity: 4,
    fromLocationId: a.id,
    toLocationId: b.id,
    reason: "調撥",
  });
  expect(transfer.batchAllocations).toEqual([
    { batchId: x.id, quantity: 2 },
    { batchId: y.id, quantity: 2 },
  ]);
  reverseMovement(s, transfer.id, "輸入錯誤");
  expect(batchBalances(s).quantity(x.id, a.id)).toBe(2);
  expect(balance(s, p.id, b.id)).toBe(0);
  const sold = sale(3);
  cancelSale(s, sold.id, "已退款");
  expect(batchBalances(s).quantity(x.id, a.id)).toBe(2);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("refuses reversal when original lot exhausted even if another lot has enough total stock", () => {
  const { s, receipt, sale } = fixture();
  const x = receipt(3, "一");
  sale(3);
  receipt(10, "二");
  expect(() => reverseMovement(s, x.id, "不能拿另一批抵銷")).toThrow("原批次");
});
it("partial saleable and damaged returns retain original sale allocation without inventing inventory", () => {
  const { s, p, a, receipt, sale } = fixture();
  const x = receipt(2, "一"),
    y = receipt(4, "二");
  const sold = sale(5);
  const line = sold.lines[0]!;
  const first = refundSale(s, {
    operationId: crypto.randomUUID(),
    saleId: sold.id,
    reason: "退回",
    lines: [
      {
        saleLineId: line.id,
        amount: 100,
        restockQuantity: 1,
        damagedQuantity: 1,
        returnLocationId: a.id,
      },
    ],
  });
  expect(
    s.movements.find((m) => m.id === first.lines[0]!.movementId)!
      .batchAllocations,
  ).toEqual([{ batchId: x.id, quantity: 1 }]);
  const second = refundSale(s, {
    operationId: crypto.randomUUID(),
    saleId: sold.id,
    reason: "退回",
    lines: [
      {
        saleLineId: line.id,
        amount: 200,
        restockQuantity: 2,
        damagedQuantity: 0,
        returnLocationId: a.id,
      },
    ],
  });
  expect(
    s.movements.find((m) => m.id === second.lines[0]!.movementId)!
      .batchAllocations,
  ).toEqual([{ batchId: y.id, quantity: 2 }]);
  expect(balance(s, p.id, a.id)).toBe(4);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("old history upgrades to clearly unknown batch without changing source history or total", () => {
  const { s, p, a, receipt, sale } = fixture();
  receipt(8, "previous");
  sale(3);
  const old: any = structuredClone(s);
  old.schemaVersion = 12;
  delete old.batchTrackingStart;
  for (const m of old.movements) {
    delete m.batchAllocations;
    delete m.batchName;
  }
  const checked = validateRestoreSnapshot(old);
  expect(checked.batchTrackingStart).toBe(2);
  expect(checked.movements.map((m) => m.id)).toEqual(
    s.movements.map((m) => m.id),
  );
  expect(batchBalances(checked).quantity(legacyBatchId(p.id), a.id)).toBe(5);
  expect(old.movements[0].batchAllocations).toBeUndefined();
});
it("rejects incorrect FIFO allocation, foreign batch, wrong sum, and negative batch even with matching aggregate", () => {
  const { s, receipt, sale } = fixture();
  const x = receipt(2, "一"),
    y = receipt(5, "二");
  sale(2);
  const tamper = structuredClone(s);
  tamper.movements[2]!.batchAllocations = [{ batchId: y.id, quantity: 2 }];
  expect(() => validateRestoreSnapshot(tamper)).toThrow("FIFO");
  const sum = structuredClone(s);
  sum.movements[2]!.batchAllocations = [{ batchId: x.id, quantity: 1 }];
  expect(() => validateRestoreSnapshot(sum)).toThrow("合計");
  const foreign = structuredClone(s);
  foreign.movements[2]!.batchAllocations = [
    { batchId: crypto.randomUUID(), quantity: 2 },
  ];
  expect(() => validateRestoreSnapshot(foreign)).toThrow("來源");
});
it("complete batch records roundtrip in single project file", async () => {
  const { s, receipt, sale } = fixture();
  receipt(2, "第一批");
  receipt(5, "第二批");
  sale(4);
  expect(await inspectProject(await exportProject(s))).toEqual(s);
});
