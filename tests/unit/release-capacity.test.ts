// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import JSZip from "jszip";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import { putParty } from "../../src/domain/catalog/masterdata";
import {
  addLocation,
  addMovement,
} from "../../src/domain/inventory/operations";
import { completeSale } from "../../src/domain/sales/operations";
import {
  queryOperationalReport,
  queryCashFlow,
} from "../../src/domain/reports/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import {
  buildProjectWorkbook,
  exportProject,
} from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
import { restoreWorkspace } from "../../src/infrastructure/storage/restore";
import { database } from "../../src/infrastructure/storage/workspaces";

const at = "2026-11-04T04:00:00.000Z";
const nextDay = "2026-11-05T04:00:00.000Z";

/** All data is fictional. Expand API-created sale/movement templates together,
 * preserving real attribution, FIFO batch allocations and both directions of
 * sale/movement links. This tests dataset capacity, not 10,000 UI commands. */
function capacityFixture(salesPerSku: number) {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "虛構容量驗證",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: at,
  });
  const creators = Array.from({ length: 20 }, (_, i) =>
    putParty(s, { name: `虛構作者${i}`, notes: "" }),
  );
  const location = addLocation(s, "虛構倉庫");
  for (let sku = 0; sku < 500; sku++) {
    const p = putProduct(s, {
      name: `虛構商品${sku}`,
      creatorId: creators[sku % 20]!.id,
      productType: "徽章",
      specification: "",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    });
    const receipt = addMovement(s, {
      productId: p.id,
      kind: "receipt",
      quantity: 30,
      fromLocationId: "",
      toLocationId: location.id,
      reason: "虛構入庫",
    });
    receipt.createdAt = at;
    const sale = completeSale(s, {
      operationId: crypto.randomUUID(),
      locationId: location.id,
      eventId: "",
      collectorId: creators[sku % 20]!.id,
      cashReceived: 100,
      notes: "",
      lines: [{ productId: p.id, quantity: 1, unitPrice: 100, mode: "direct" }],
    });
    sale.createdAt = at;
    const movement = s.movements.find(
      (m) => m.id === sale.lines[0]!.movementId,
    )!;
    movement.createdAt = at;
    for (let j = 1; j < salesPerSku; j++) {
      const copy = structuredClone(sale),
        out = structuredClone(movement);
      copy.id = crypto.randomUUID();
      copy.operationId = crypto.randomUUID();
      copy.code = `SAL-${String(++s.counters.SAL!).padStart(6, "0")}`;
      copy.createdAt = j % 2 ? nextDay : at;
      out.id = crypto.randomUUID();
      out.code = `MOV-${String(++s.counters.MOV!).padStart(6, "0")}`;
      out.saleId = copy.id;
      out.createdAt = copy.createdAt;
      out.reason = `${copy.code} 指定購買`;
      copy.lines[0]!.id = crypto.randomUUID();
      copy.lines[0]!.movementId = out.id;
      s.sales.push(copy);
      s.movements.push(out);
    }
  }
  return s;
}

afterEach(async () => {
  await database.catalogs.clear();
  await database.workspaces.clear();
});

it("keeps 500 SKU / 20 creators / 10,000 valid sales conserved across reports and bounded backup inspection", async () => {
  const s = capacityFixture(20);
  expect(validateRestoreSnapshot(structuredClone(s))).toEqual(s);
  expect(s.products).toHaveLength(500);
  expect(s.parties).toHaveLength(20);
  expect(s.sales).toHaveLength(10_000);
  expect(s.movements).toHaveLength(10_500);
  const before = JSON.stringify(s);
  const report = queryOperationalReport(s, { groupBy: "product" }, at);
  expect(report.lines).toHaveLength(10_000);
  expect(report.groups).toHaveLength(500);
  expect(report.totals).toMatchObject({
    soldQuantity: "10000",
    retainedQuantity: "10000",
    gross: "1000000",
    refunded: "0",
    netRevenue: "1000000",
    unknownCostQuantity: "10000",
    revenueLessCost: null,
  });
  expect(
    report.groups.every(
      (g) => g.soldQuantity === "20" && g.netRevenue === "2000",
    ),
  ).toBe(true);
  expect(report.currentStock).toHaveLength(500);
  expect(
    report.currentStock.every(
      (r) => r.quantity === "10" && r.available === "10",
    ),
  ).toBe(true);
  expect(
    report.currentStock.reduce((n, r) => n + Number(r.quantity), 0) +
      Number(report.totals.soldQuantity),
  ).toBe(15_000);
  const creator = queryOperationalReport(
    s,
    { groupBy: "creator", creatorId: s.parties[0]!.id },
    at,
  );
  expect(creator.lines).toHaveLength(500);
  expect(creator.totals.netRevenue).toBe("50000");
  const day = { fromDate: "2026-11-05", toDate: "2026-11-05" };
  expect(
    queryOperationalReport(
      s,
      { ...day, groupBy: "product", productId: s.products[0]!.id },
      at,
    ).totals.netRevenue,
  ).toBe("1000");
  const cash = queryCashFlow(s, {}, at);
  expect(cash.entries).toHaveLength(10_000);
  expect(cash.net).toBe(report.totals.netRevenue);
  expect(queryCashFlow(s, day, at).net).toBe("500000");
  expect(JSON.stringify(s)).toBe(before);

  // The visible workbook plus hidden lossless payload may exceed the import
  // expansion budget. Assert the real safety boundary instead of raising it.
  const rawBuffer = await (await buildProjectWorkbook(s)).xlsx.writeBuffer();
  const bytes = Uint8Array.from(rawBuffer as unknown as Uint8Array).buffer;
  const zip = await JSZip.loadAsync(bytes);
  const expanded = (
    await Promise.all(
      Object.values(zip.files)
        .filter((f) => !f.dir)
        .map(async (f) => (await f.async("uint8array")).byteLength),
    )
  ).reduce((a, b) => a + b, 0);
  console.info(
    `CAPACITY: 500 SKU / 20 creators / 10000 sales: compressed=${bytes.byteLength} bytes; expanded=${expanded} bytes`,
  );
  if (bytes.byteLength > 10 * 1024 * 1024 || expanded > 30 * 1024 * 1024) {
    await expect(exportProject(s)).rejects.toThrow("備份超出可還原的檔案限制");
    await expect(inspectProject(bytes)).rejects.toThrow(/10 MB|30 MB/);
  } else {
    expect(await inspectProject(await exportProject(s))).toEqual(s);
  }
  expect(JSON.stringify(s)).toBe(before);
  expect(await database.catalogs.count()).toBe(0);
  expect(await database.workspaces.count()).toBe(0);
}, 90_000);

it("round trips a 500 SKU / 20 creator / 1,000 sale complete backup through XLSX and IndexedDB", async () => {
  const s = capacityFixture(2);
  const checked = await inspectProject(await exportProject(s));
  expect(checked).toEqual(s);
  await restoreWorkspace(checked);
  expect(await database.catalogs.get(s.workspaceId)).toEqual(s);
  expect(await database.workspaces.get(s.workspaceId)).toEqual(s.workspace);
  expect(
    queryOperationalReport(checked, { groupBy: "creator" }, at).totals
      .netRevenue,
  ).toBe("100000");
  await expect(restoreWorkspace(checked)).rejects.toThrow("相同工作區");
  expect(await database.workspaces.count()).toBe(1);
  expect(await database.catalogs.count()).toBe(1);
}, 60_000);
