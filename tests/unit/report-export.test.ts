// @vitest-environment node
import { it, expect } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { exportReport } from "../../src/infrastructure/excel/report";
import type {
  OperationalReport,
  CashFlowReport,
  ReportMetrics,
} from "../../src/domain/reports/operations";
const metrics: ReportMetrics = {
  soldQuantity: "3",
  restockQuantity: "0",
  damagedQuantity: "0",
  retainedQuantity: "3",
  gross: "300",
  refunded: "0",
  netRevenue: "300",
  netKnownCost: "100.0000",
  unknownCostQuantity: "0",
  damagedKnownCost: "0.0000",
  damagedUnknownCostQuantity: "0",
  revenueLessCost: "200.0000",
};
function fixture(): { report: OperationalReport; cash: CashFlowReport } {
  return {
    report: {
      workspaceId: "workspace-test",
      workspaceName: '=HYPERLINK("https://example.invalid")',
      sourceRevision: 7,
      generatedAt: "2026-11-04T16:01:00Z",
      filters: { groupBy: "product", fromDate: "2026-11-05" },
      definitions: ["成交日期群組包含之後的退款。"],
      warnings: ["目前庫存不是歷史期末庫存。"],
      choices: { products: [], creators: [], projects: [], events: [] },
      totals: { ...metrics },
      groups: [{ ...metrics, id: "product-test", name: "+SUM(1,2)" }],
      lines: [
        {
          ...metrics,
          id: "line-test",
          saleId: "sale-test",
          saleCode: "SAL-000001",
          saleAt: "2026-11-04T16:00:00Z",
          eventId: "",
          eventName: "未指定活動",
          creatorId: "",
          creatorName: "未記錄",
          projectId: "",
          projectName: "未指定",
          productId: "product-test",
          productName: "@SUM(1,2)",
          mode: "draw",
          planName: "=1+1",
        },
      ],
      currentStock: [
        {
          productId: "product-test",
          productName: "@SUM(1,2)",
          locationId: "location-test",
          locationName: "攤位",
          quantity: "9007199254740992",
          reserved: "0",
          available: "9007199254740992",
          markedUnits: "0",
        },
      ],
    },
    cash: {
      workspaceId: "workspace-test",
      workspaceName: "測試",
      sourceRevision: 7,
      generatedAt: "2026-11-04T16:01:00Z",
      filters: { fromDate: "2026-11-05" },
      definitions: ["換購折抵不是現金。"],
      warnings: [],
      receipts: "300",
      payouts: "50",
      net: "250",
      unknownPayerCount: 1,
      entries: [
        {
          id: "refund-test",
          kind: "refund",
          at: "2026-11-04T16:00:30Z",
          eventId: "",
          eventName: "未指定活動",
          saleId: "sale-test",
          saleCode: "SAL-000001",
          collectorId: "",
          partyName: "付款人未記錄",
          amount: "-50",
          description: "=1+1",
        },
      ],
    },
  };
}
it("exports a readable report with exact cost strings and no restorable project or formulas", async () => {
  const { report, cash } = fixture(),
    before = JSON.stringify({ report, cash });
  const bytes = await exportReport(report, cash);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  expect(book.worksheets.map((s) => s.name)).toEqual([
    "00_報表說明",
    "01_總計",
    "02_分組",
    "03_銷售明細",
    "04_目前庫存",
    "05_實際收退款",
  ]);
  expect(book.worksheets.every((s) => s.state === "visible")).toBe(true);
  expect(book.getWorksheet("_ConMate資料")).toBeUndefined();
  const info = book.getWorksheet("00_報表說明")!;
  expect(info.getCell("B2").text).toContain("不能匯入還原");
  expect(info.getCell("B3").value).toBe(report.workspaceName);
  expect(info.getCell("B5").text).toContain("2026");
  const total = book.getWorksheet("01_總計")!;
  const costRow = total
    .getRows(2, total.rowCount - 1)!
    .find((r) => r.getCell(1).text === "已知未回庫成本（元）")!;
  expect(costRow.getCell(2).value).toBe("100.0000");
  expect(book.getWorksheet("04_目前庫存")!.getCell("C2").value).toBe(
    "9007199254740992",
  );
  expect(book.getWorksheet("05_實際收退款")!.getCell("F2").value).toBe(-50);
  expect(book.getWorksheet("03_銷售明細")!.getCell("D2").value).toBe(
    "@SUM(1,2)",
  );
  for (const ws of book.worksheets) {
    expect(ws.views[0]).toMatchObject({
      state: "frozen",
      ySplit: 1,
      showGridLines: true,
    });
    expect(ws.getCell("A1").font.name).toBe("Microsoft JhengHei");
    expect(ws.getCell("A2").border.bottom.style).toBe("thin");
    ws.eachRow((row) =>
      row.eachCell((cell) =>
        expect(cell.type).not.toBe(ExcelJS.ValueType.Formula),
      ),
    );
  }
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files).filter(
    (name) => name.endsWith(".xml") || name.endsWith(".rels"),
  )) {
    const xml = await zip.file(name)!.async("string");
    expect(xml).not.toMatch(/<f(?:\s|>)/);
    expect(xml).not.toContain('TargetMode="External"');
    expect(xml).not.toContain("payloadSha256");
    expect(xml).not.toContain("sourceWorkspaceId");
  }
  expect(JSON.stringify({ report, cash })).toBe(before);
});
it("preserves unknown cost rather than exporting a fabricated zero result", async () => {
  const { report, cash } = fixture();
  report.totals.revenueLessCost = null;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportReport(report, cash));
  const total = book.getWorksheet("01_總計")!;
  expect(total.getRow(13).getCell(2).value).toBe("尚無法完整試算");
});
it("refuses to combine differently revised or different workspace reports", async () => {
  const { report, cash } = fixture();
  await expect(
    exportReport(report, { ...cash, sourceRevision: 8 }),
  ).rejects.toThrow("來源工作區或修訂不同");
  await expect(
    exportReport(report, { ...cash, workspaceId: "other" }),
  ).rejects.toThrow("來源工作區或修訂不同");
});
