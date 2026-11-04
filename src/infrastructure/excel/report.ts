import ExcelJS from "exceljs";
import type {
  OperationalReport,
  CashFlowReport,
  ReportMetrics,
} from "../../domain/reports/operations";

const font = {
  name: "Microsoft JhengHei",
  size: 12,
  color: { argb: "FF253B34" },
};
const edge: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FFADB9AE" },
};
const border: Partial<ExcelJS.Borders> = {
  top: edge,
  bottom: edge,
  left: edge,
  right: edge,
};
const metrics: [keyof ReportMetrics, string][] = [
  ["soldQuantity", "原成交數量"],
  ["restockQuantity", "可售退回數量"],
  ["damagedQuantity", "損壞退回數量"],
  ["retainedQuantity", "未退回數量"],
  ["gross", "原成交額（元）"],
  ["refunded", "退款與折抵額（元）"],
  ["netRevenue", "退款後營收（元）"],
  ["netKnownCost", "已知未回庫成本（元）"],
  ["unknownCostQuantity", "成本未知數量"],
  ["damagedKnownCost", "已知損壞退貨成本（元）"],
  ["damagedUnknownCostQuantity", "損壞退貨成本未知數量"],
  ["revenueLessCost", "營收減未回庫成本（非分潤／會計利潤）"],
];
const exactDecimals = new Set<keyof ReportMetrics>([
  "netKnownCost",
  "damagedKnownCost",
  "revenueLessCost",
]);
function integer(value: string): number | string {
  if (/^-?(0|[1-9]\d*)$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n)) return n;
  }
  return value;
}
function metricValues(row: ReportMetrics) {
  return metrics.map(([key]) =>
    row[key] === null
      ? "尚無法完整試算"
      : exactDecimals.has(key)
        ? row[key]!
        : integer(row[key]!),
  );
}
function localTime(value: string) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) throw new Error("報表產生時間不正確。");
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(time);
}
function selected(
  value: string | undefined,
  options: { id: string; label: string }[],
) {
  return value === undefined
    ? "全部"
    : options.find((o) => o.id === value)?.label ||
        (value === "" ? "未記錄／未指定" : "指定來源");
}
export async function buildReportWorkbook(
  report: OperationalReport,
  cash: CashFlowReport,
) {
  if (
    report.workspaceId !== cash.workspaceId ||
    report.sourceRevision !== cash.sourceRevision
  )
    throw new Error("報表來源工作區或修訂不同，請重新整理後再匯出。");
  const book = new ExcelJS.Workbook();
  book.creator = "ConMate";
  book.created = new Date(report.generatedAt);
  function sheet(name: string, headers: string[]) {
    const ws = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1, showGridLines: true }],
      properties: { defaultRowHeight: 32 },
    });
    ws.columns = headers.map((header) => ({
      header,
      width: header === "說明" ? 95 : 28,
      style: {
        font,
        numFmt: "@",
        alignment: { vertical: "top", wrapText: true },
        border,
      },
    }));
    ws.getRow(1).height = 42;
    ws.getRow(1).eachCell((cell) => {
      cell.font = { ...font, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF275C50" },
      };
    });
    return ws;
  }
  const info = sheet("00_報表說明", ["項目", "說明"]);
  info.addRows([
    [
      "檔案用途",
      "這是查詢報表，不是完整專案備份，不能匯入還原工作區。請另行匯出專案備份。",
    ],
    ["工作區", report.workspaceName],
    ["來源修訂", report.sourceRevision],
    ["產生時間（台灣）", localTime(report.generatedAt)],
    [
      "銷售成交日期",
      `${report.filters.fromDate || "不限"} 至 ${report.filters.toDate || "不限"}`,
    ],
    ["銷售活動", selected(report.filters.eventId, report.choices.events)],
    [
      "成交時創作者",
      selected(report.filters.creatorId, report.choices.creators),
    ],
    [
      "商品目前企劃",
      selected(report.filters.projectId, report.choices.projects),
    ],
    ["商品", selected(report.filters.productId, report.choices.products)],
    [
      "分組",
      (
        {
          event: "活動",
          creator: "成交時創作者",
          project: "商品目前企劃",
          product: "商品",
        } as const
      )[report.filters.groupBy],
    ],
    [
      "實際收退日期",
      `${cash.filters.fromDate || "不限"} 至 ${cash.filters.toDate || "不限"}`,
    ],
    ["實際收退活動", selected(cash.filters.eventId, report.choices.events)],
    [
      "實際收退篩選",
      "款項採整筆交易，不依創作者、企劃或商品比例拆分；其範圍可能與銷售明細不同。",
    ],
    [
      "數值格式",
      "可安全表示的整數為數值；精確成本最終四位小數以純文字保存，超過安全範圍的整數也以純文字保存。沒有使用試算表公式。",
    ],
    ...report.definitions.map((message) => ["銷售與成本定義", message]),
    ...cash.definitions.map((message) => ["實際收退定義", message]),
    ...report.warnings.map((message) => ["銷售與成本提醒", message]),
    ...cash.warnings.map((message) => ["實際收退提醒", message]),
  ]);
  const totals = sheet("01_總計", ["項目", "數值"]);
  for (let i = 0; i < metrics.length; i++)
    totals.addRow([metrics[i]![1], metricValues(report.totals)[i]]);
  totals.addRows([
    ["期間實際收款（元）", integer(cash.receipts)],
    ["期間實際退款（元）", integer(cash.payouts)],
    ["期間實際淨收退（元）", integer(cash.net)],
    ["付款／收款對象未記錄筆數", cash.unknownPayerCount],
  ]);
  const groups = sheet("02_分組", [
    "分組名稱",
    ...metrics.map(([, label]) => label),
  ]);
  report.groups.forEach((row) =>
    groups.addRow([row.name, ...metricValues(row)]),
  );
  const sales = sheet("03_銷售明細", [
    "交易編號",
    "成交時間（台灣）",
    "活動",
    "商品（成交時）",
    "創作者（成交時）",
    "企劃（商品目前）",
    "販售方式",
    "販售方案（成交時）",
    ...metrics.map(([, label]) => label),
  ]);
  report.lines.forEach((row) =>
    sales.addRow([
      row.saleCode,
      localTime(row.saleAt),
      row.eventName,
      row.productName,
      row.creatorName,
      row.projectName,
      row.mode === "draw" ? "抽選" : "指定",
      row.planName,
      ...metricValues(row),
    ]),
  );
  const stock = sheet("04_目前庫存", [
    "商品",
    "庫位",
    "現存數量",
    "已預留",
    "未預留可用",
    "已標記單件",
  ]);
  report.currentStock.forEach((row) =>
    stock.addRow([
      row.productName,
      row.locationName,
      integer(row.quantity),
      integer(row.reserved),
      integer(row.available),
      integer(row.markedUnits),
    ]),
  );
  const money = sheet("05_實際收退款", [
    "紀錄類型",
    "發生時間（台灣）",
    "活動",
    "交易編號",
    "已記錄對象",
    "實際收退金額（元，正收負退）",
    "說明",
  ]);
  const names = {
    sale: "成交實收",
    exchange: "換購實際差額",
    refund: "實際退款",
    cancel: "整筆取消退款",
  };
  cash.entries.forEach((row) =>
    money.addRow([
      names[row.kind],
      localTime(row.at),
      row.eventName,
      row.saleCode,
      row.partyName,
      integer(row.amount),
      row.description,
    ]),
  );
  for (const ws of book.worksheets) {
    if (ws.rowCount > 1)
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: ws.rowCount, column: ws.columnCount },
      };
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        cell.border = border;
        if (row.number !== 1) cell.font = font;
        if (typeof cell.value === "number") cell.numFmt = "0";
      }),
    );
  }
  return book;
}
export async function exportReport(
  report: OperationalReport,
  cash: CashFlowReport,
): Promise<ArrayBuffer> {
  const buffer = await (
    await buildReportWorkbook(report, cash)
  ).xlsx.writeBuffer();
  return Uint8Array.from(buffer as unknown as Uint8Array).buffer;
}
