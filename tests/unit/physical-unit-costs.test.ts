import { expect, it } from "vitest";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import {
  addLocation,
  addMovement,
} from "../../src/domain/inventory/operations";
import { putCost } from "../../src/domain/finance/operations";
import {
  saveBatchCost,
  batchCostReport,
} from "../../src/domain/finance/batch-costs";
import { completeSale } from "../../src/domain/sales/operations";
import type { RefundRecord } from "../../src/domain/models/catalog";

function fixture(secondAmount: number | null = 100) {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "單件成本",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const product = putProduct(s, {
    name: "編號立牌",
    productType: "",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const location = addLocation(s, "倉庫");
  const lots = [10, secondAmount].map((amount, i) => {
    const receipt = addMovement(s, {
      productId: product.id,
      kind: "receipt",
      quantity: 1,
      fromLocationId: "",
      toLocationId: location.id,
      reason: `第${i + 1}批`,
    });
    putCost(s, {
      name: `第${i + 1}批成本`,
      productId: product.id,
      quantity: 1,
      estimatedPrint: null,
      actualPrint: amount,
      artworkAllocated: 0,
      otherCost: 0,
      unitSalePrice: 200,
      paidById: "",
      burdenPartyId: "",
      notes: "",
    });
    const cost = s.costs.at(-1)!;
    saveBatchCost(s, receipt.id, cost.id, "已確認成本");
    return { receipt, cost };
  });
  const sale = completeSale(s, {
    operationId: crypto.randomUUID(),
    locationId: location.id,
    eventId: "",
    collectorId: "",
    cashReceived: 400,
    notes: "",
    lines: [
      { productId: product.id, mode: "direct", quantity: 2, unitPrice: 200 },
    ],
  });
  const movement = s.movements.find((m) => m.id === sale.lines[0]!.movementId)!;
  // Report contract fixture: both physical items existed at this original sale cutoff.
  s.physicalUnits = lots.map(({ receipt }, i) => ({
    id: `unit-${i}`,
    workspaceId: s.workspaceId,
    code: `UNT-00000${i + 1}`,
    name: `編號${i + 1}`,
    label: `編號${i + 1}`,
    productId: product.id,
    batchId: receipt.id,
    registeredLocationId: location.id,
    registeredMovementCount: 2,
    createdAt: receipt.createdAt,
  }));
  movement.unitIds = s.physicalUnits.map((u) => u.id);
  sale.lines[0]!.unitIds = [...movement.unitIds];
  const refund = (restock: string[], damaged: string[]) => {
    s.refunds.push({
      id: crypto.randomUUID(),
      workspaceId: s.workspaceId,
      code: `REF-${s.refunds.length}`,
      name: "實際退貨",
      operationId: crypto.randomUUID(),
      saleId: sale.id,
      reason: "核對編號",
      createdAt: new Date().toISOString(),
      total: 0,
      lines: [
        {
          id: crypto.randomUUID(),
          movementId: "",
          saleLineId: sale.lines[0]!.id,
          amount: 0,
          restockQuantity: restock.length,
          damagedQuantity: damaged.length,
          returnLocationId: restock.length ? location.id : "",
          restockUnitIds: restock,
          damagedUnitIds: damaged,
        },
      ],
    } satisfies RefundRecord);
  };
  return { s, lots, sale, movement, refund };
}

it("an individually identified return reverses its own batch cost, not the first FIFO unit", () => {
  const x = fixture();
  x.refund(["unit-1"], []);
  const row = batchCostReport(x.s).sales[0]!;
  expect(row.knownCost).toBe("110.0000");
  expect(row.netKnownCost).toBe("10.0000");
  expect(row.returnedQuantity).toBe(1);
});

it("successive numbered returns preserve original cost versions and damaged cost independently", () => {
  const x = fixture();
  x.lots[1]!.cost.actualPrint = 900;
  saveBatchCost(x.s, x.lots[1]!.receipt.id, x.lots[1]!.cost.id, "只對未來生效");
  x.refund([], ["unit-1"]);
  x.refund(["unit-0"], []);
  const row = batchCostReport(x.s).sales[0]!;
  expect(row.netKnownCost).toBe("100.0000");
  expect(row.damagedKnownCost).toBe("100.0000");
  expect(row.damagedQuantity).toBe(1);
});

it("returning an identified unknown-cost unit removes only its unknown quantity", () => {
  const x = fixture(null);
  x.refund(["unit-1"], []);
  const report = batchCostReport(x.s);
  expect(report.sales[0]!.netKnownCost).toBe("10.0000");
  expect(report.sales[0]!.unknownQuantity).toBe(0);
  expect(report.totalUnknownQuantity).toBe(0);
});

it("rejects a numbered return missing its exact unit or belonging to another original sale", () => {
  const x = fixture();
  x.refund(["unit-1"], []);
  x.s.refunds[0]!.lines[0]!.restockUnitIds = ["foreign-unit"];
  expect(() => batchCostReport(x.s)).toThrow("不屬於原銷售");
  x.s.refunds[0]!.lines[0]!.restockUnitIds = [];
  expect(() => batchCostReport(x.s)).toThrow("數量不一致");
});
