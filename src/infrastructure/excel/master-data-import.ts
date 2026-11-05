import ExcelJS from "exceljs";
import type { CatalogSnapshot, FieldType } from "../../domain/models/catalog";
import { loadSafeWorkbook } from "./restore";

export const MASTER_IMPORT_FORMAT = "ConMate主資料匯入";
export const MASTER_IMPORT_VERSION = "1";
export type MasterDataImportSource = Pick<
  CatalogSnapshot,
  | "workspaceId"
  | "revision"
  | "parties"
  | "projects"
  | "events"
  | "projectEvents"
  | "products"
  | "productTypes"
  | "tags"
  | "artworks"
  | "fields"
>;

const SHEETS = {
  instructions: "00_匯入說明",
  parties: "01_參與方",
  projects: "02_企劃",
  products: "03_商品",
  events: "04_場次",
  artworks: "05_柄圖",
  tags: "06_標記",
  fields: "07_自訂欄位",
  options: "08_欄位選項",
} as const;

const HEADERS = {
  parties: ["資料ID", "新增代號", "名稱", "備註"],
  projects: ["資料ID", "新增代號", "名稱", "說明"],
  products: [
    "資料ID",
    "新增代號",
    "商品名稱",
    "商品擁有者ID",
    "創作者ID",
    "企劃ID",
    "周邊種類",
    "規格",
    "柄圖名稱",
    "柄圖ID",
    "備註",
    "標記ID（以、分隔）",
  ],
  events: [
    "資料ID",
    "新增代號",
    "場次名稱",
    "開始日期",
    "結束日期",
    "地點",
    "備註",
    "參加企劃ID（以、分隔）",
    "狀態",
  ],
  artworks: [
    "資料ID",
    "新增代號",
    "柄圖名稱",
    "企劃ID",
    "作者ID（以、分隔）",
    "備註",
    "狀態",
  ],
  tags: ["資料ID", "新增代號", "名稱", "狀態"],
  fields: ["資料ID", "新增代號", "欄位名稱", "欄位類型", "狀態"],
  options: [
    "欄位ID",
    "欄位新增代號",
    "選項ID",
    "選項新增代號",
    "選項名稱",
    "狀態",
  ],
} as const;

export interface MasterDataImportIssue {
  sheet: string;
  row?: number;
  column?: string;
  code: string;
  message: string;
  suggestion: string;
}

export interface MasterDataImportRow {
  id: string;
  alias: string;
  sourceRow: number;
}

export interface MasterDataImportParty extends MasterDataImportRow {
  name: string;
  notes: string;
}

export interface MasterDataImportProject extends MasterDataImportRow {
  name: string;
  description: string;
}

export interface MasterDataImportProduct extends MasterDataImportRow {
  name: string;
  ownerId: string;
  creatorId: string;
  projectId: string;
  productType: string;
  specification: string;
  artwork: string;
  artworkId: string;
  notes: string;
  tagIds: string;
}

export interface MasterDataImportEvent extends MasterDataImportRow {
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  notes: string;
  projectIds: string;
  status: string;
}

export interface MasterDataImportArtwork extends MasterDataImportRow {
  name: string;
  projectId: string;
  authorIds: string;
  notes: string;
  status: string;
}

export interface MasterDataImportTag extends MasterDataImportRow {
  name: string;
  status: string;
}

export interface MasterDataImportField extends MasterDataImportRow {
  name: string;
  type: FieldType;
  status: string;
}

export interface MasterDataImportOption {
  fieldId: string;
  fieldAlias: string;
  id: string;
  alias: string;
  label: string;
  status: string;
  sourceRow: number;
}

export interface MasterDataImportDocument {
  workspaceId: string;
  baseRevision: number;
  parties: MasterDataImportParty[];
  projects: MasterDataImportProject[];
  events: MasterDataImportEvent[];
  products: MasterDataImportProduct[];
  artworks: MasterDataImportArtwork[];
  tags: MasterDataImportTag[];
  fields: MasterDataImportField[];
  options: MasterDataImportOption[];
}

function text(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined || value === "") return "";
  return typeof value === "string" ? value : null;
}

function addIssue(
  issues: MasterDataImportIssue[],
  sheet: string,
  code: string,
  message: string,
  suggestion: string,
  row?: number,
  column?: string,
) {
  issues.push({ sheet, row, column, code, message, suggestion });
}

function addTable<T>(
  book: ExcelJS.Workbook,
  sheetName: string,
  headers: readonly string[],
  issues: MasterDataImportIssue[],
  parse: (values: Record<string, string>, row: number) => T,
): T[] {
  const ws = book.getWorksheet(sheetName);
  if (!ws) {
    addIssue(
      issues,
      sheetName,
      "missing-sheet",
      "缺少必要工作表。",
      "請重新下載目前工作區的主資料匯入範本。",
    );
    return [];
  }
  const columns = new Map<string, number>();
  const header = ws.getRow(1);
  header.eachCell((cell, column) => {
    const value = text(cell.value);
    if (value === null) {
      addIssue(
        issues,
        sheetName,
        "invalid-header",
        "欄名必須是文字。",
        "請勿修改欄名列。",
        1,
      );
      return;
    }
    if (!value) return;
    if (columns.has(value)) {
      addIssue(
        issues,
        sheetName,
        "duplicate-header",
        `欄名「${value}」重複。`,
        "請保留每個欄名各一欄。",
        1,
        value,
      );
      return;
    }
    columns.set(value, column);
  });
  for (const required of headers)
    if (!columns.has(required))
      addIssue(
        issues,
        sheetName,
        "missing-column",
        `缺少必要欄「${required}」。`,
        "請重新下載範本並保留全部欄位。",
        1,
        required,
      );
  for (const name of columns.keys())
    if (!headers.includes(name))
      addIssue(
        issues,
        sheetName,
        "unknown-column",
        `不支援欄位「${name}」。`,
        "請移除額外欄位，或使用本次下載的範本。",
        1,
        name,
      );
  if (issues.some((issue) => issue.sheet === sheetName)) return [];

  const rows: T[] = [];
  if (ws.rowCount > 100001) {
    addIssue(
      issues,
      sheetName,
      "too-many-rows",
      "資料列超過 100,000 筆上限。",
      "請拆分匯入資料或移除多餘的空白列。",
    );
    return rows;
  }
  for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const values: Record<string, string> = {};
    let hasValue = false;
    const knownColumns = new Set(columns.values());
    row.eachCell((cell, column) => {
      if (knownColumns.has(column) || cell.value === null || cell.value === "")
        return;
      addIssue(
        issues,
        sheetName,
        "unknown-column",
        "資料列含有未命名欄位的內容。",
        "請移除表頭以外的額外資料欄。",
        rowNumber,
        `第 ${column} 欄`,
      );
    });
    for (const name of headers) {
      const value = text(row.getCell(columns.get(name)!).value);
      if (value === null) {
        addIssue(
          issues,
          sheetName,
          "invalid-cell",
          "此欄只接受文字或空白，數字、日期及其他儲存格型別不支援。",
          "請將內容改為文字；ID 與參照欄請使用範本中的文字值。",
          rowNumber,
          name,
        );
        values[name] = "";
      } else {
        values[name] = value;
        if (value.trim()) hasValue = true;
      }
    }
    if (hasValue) rows.push(parse(values, rowNumber));
  }
  return rows;
}

function parseIdentity(
  values: Record<string, string>,
  row: number,
  sheet: string,
  issues: MasterDataImportIssue[],
) {
  const id = values["資料ID"].trim();
  const alias = values["新增代號"].trim();
  if (!id && !alias)
    addIssue(
      issues,
      sheet,
      "missing-identity",
      "資料列需要既有資料ID，或新資料的新增代號。",
      "既有資料保留資料ID；新增資料留白資料ID並填寫唯一新增代號。",
      row,
      "資料ID",
    );
  if (!id && alias && !/^[A-Za-z0-9._-]{1,60}$/.test(alias))
    addIssue(
      issues,
      sheet,
      "invalid-alias",
      "新增代號只能使用 1 至 60 個英數字、句點、底線或連字號。",
      "例如填入 new-product-1；其他工作表以 new:代號參照。",
      row,
      "新增代號",
    );
  return { id, alias, sourceRow: row };
}

export async function buildMasterDataImportWorkbook(
  snapshot: MasterDataImportSource,
): Promise<ArrayBuffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "ConMate";
  book.created = new Date();
  const instructions = book.addWorksheet(SHEETS.instructions);
  instructions.addRows([
    ["項目", "內容"],
    ["格式", MASTER_IMPORT_FORMAT],
    ["版本", MASTER_IMPORT_VERSION],
    ["工作區ID", snapshot.workspaceId],
    ["基準修訂", String(snapshot.revision)],
    [
      "使用方式",
      "可修改參與方、企劃、場次、柄圖、標記、自訂欄位與商品工作表。保留所有既有資料ID；新增列留白資料ID並填唯一新增代號。",
    ],
    [
      "參照方式",
      "參與方、企劃、場次及柄圖參照欄填現有資料ID；同檔新增資料可填 new:新增代號。多筆 ID 以「、」分隔。欄位選項填欄位ID，或在欄位新增代號欄填代號（不加 new:）。",
    ],
    [
      "封存限制",
      "封存中的場次、柄圖、標記與自訂欄位不可由匯入修改。請在網站操作封存狀態；只有欄位選項可由匯入封存／恢復。",
    ],
    [
      "限制",
      "刪除既有資料列不會刪除本機資料，且會使匯入被拒絕。匯入不處理交易、庫存、成本或結算。",
    ],
    [
      "提交",
      "匯入會先驗證並顯示差異；只有按下確認後才會一次寫入。工作區修訂變動後，請重新下載範本。",
    ],
  ]);
  const addSheet = (
    name: string,
    headers: readonly string[],
    rows: (string | number)[][],
  ) => {
    const ws = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.addRow([...headers]);
    ws.addRows(rows);
    ws.columns = headers.map((header) => ({
      header,
      width: header.includes("備註") || header.includes("說明") ? 48 : 24,
      style: { numFmt: "@" },
    }));
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = {
      from: "A1",
      to: { row: Math.max(1, ws.rowCount), column: headers.length },
    };
  };
  addSheet(
    SHEETS.parties,
    HEADERS.parties,
    snapshot.parties.map((row) => [row.id, "", row.name, row.notes]),
  );
  addSheet(
    SHEETS.projects,
    HEADERS.projects,
    snapshot.projects.map((row) => [row.id, "", row.name, row.description]),
  );
  addSheet(
    SHEETS.products,
    HEADERS.products,
    snapshot.products.map((row) => [
      row.id,
      "",
      row.name,
      row.ownerId,
      row.creatorId,
      row.projectId,
      snapshot.productTypes.find((type) => type.id === row.typeId)?.name || "",
      row.specification,
      row.artwork,
      row.artworkId || "",
      row.notes,
      row.tagIds.join("、"),
    ]),
  );
  addSheet(
    SHEETS.events,
    HEADERS.events,
    snapshot.events.map((row) => [
      row.id,
      "",
      row.name,
      row.startDate,
      row.endDate,
      row.venue,
      row.notes,
      snapshot.projectEvents
        .filter((link) => link.eventId === row.id)
        .map((link) => link.projectId)
        .join("、"),
      row.archived ? "已封存" : "使用中",
    ]),
  );
  addSheet(
    SHEETS.artworks,
    HEADERS.artworks,
    snapshot.artworks.map((row) => [
      row.id,
      "",
      row.name,
      row.projectId,
      row.authorIds.join("、"),
      row.notes,
      row.archived ? "已封存" : "使用中",
    ]),
  );
  addSheet(
    SHEETS.tags,
    HEADERS.tags,
    snapshot.tags.map((row) => [
      row.id,
      "",
      row.name,
      row.archived ? "已封存" : "使用中",
    ]),
  );
  addSheet(
    SHEETS.fields,
    HEADERS.fields,
    snapshot.fields.map((row) => [
      row.id,
      "",
      row.name,
      row.type,
      row.archived ? "已封存" : "使用中",
    ]),
  );
  addSheet(
    SHEETS.options,
    HEADERS.options,
    snapshot.fields.flatMap((field) =>
      field.options.map((option) => [
        field.id,
        "",
        option.id,
        "",
        option.label,
        option.archived ? "已封存" : "使用中",
      ]),
    ),
  );
  const buffer = await book.xlsx.writeBuffer();
  return Uint8Array.from(buffer as unknown as Uint8Array).buffer;
}

export async function parseMasterDataImport(bytes: ArrayBuffer): Promise<{
  document: MasterDataImportDocument | null;
  issues: MasterDataImportIssue[];
}> {
  const book = await loadSafeWorkbook(bytes);
  const issues: MasterDataImportIssue[] = [];
  const allowedSheets = new Set<string>(Object.values(SHEETS));
  for (const ws of book.worksheets) {
    if (!allowedSheets.has(ws.name) && ws.actualRowCount > 0)
      addIssue(
        issues,
        ws.name,
        "unknown-sheet",
        "檔案含不支援的非空白工作表。",
        "請只使用主資料匯入範本中的工作表。",
      );
  }
  const instructions = book.getWorksheet(SHEETS.instructions);
  const metadata = new Map<string, string>();
  if (!instructions) {
    addIssue(
      issues,
      SHEETS.instructions,
      "missing-sheet",
      "缺少匯入格式說明。",
      "請重新下載目前工作區的主資料匯入範本。",
    );
  } else {
    if (
      text(instructions.getRow(1).getCell(1).value) !== "項目" ||
      text(instructions.getRow(1).getCell(2).value) !== "內容"
    )
      addIssue(
        issues,
        SHEETS.instructions,
        "invalid-metadata-header",
        "匯入格式說明表頭不正確。",
        "請勿修改說明工作表。",
        1,
      );
    instructions.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const key = text(row.getCell(1).value);
      const value = text(row.getCell(2).value);
      row.eachCell((cell, column) => {
        if (column <= 2 || cell.value === null || cell.value === "") return;
        addIssue(
          issues,
          SHEETS.instructions,
          "unknown-metadata-column",
          "匯入說明表含有未支援欄位。",
          "請重新下載範本並勿加入其他資料欄。",
          rowNumber,
          `第 ${column} 欄`,
        );
      });
      if (!key && !value) return;
      if (!key || value === null || metadata.has(key)) {
        addIssue(
          issues,
          SHEETS.instructions,
          "invalid-metadata",
          "格式資訊缺漏、型別不正確或重複。",
          "請重新下載範本並只修改資料工作表。",
          rowNumber,
        );
        return;
      }
      if (
        ![
          "格式",
          "版本",
          "工作區ID",
          "基準修訂",
          "使用方式",
          "參照方式",
          "封存限制",
          "限制",
          "提交",
        ].includes(key)
      ) {
        addIssue(
          issues,
          SHEETS.instructions,
          "unknown-metadata",
          `不支援格式資訊「${key}」。`,
          "請重新下載範本並勿加入其他資訊列。",
          rowNumber,
          "項目",
        );
        return;
      }
      metadata.set(key, value);
    });
  }
  if (
    metadata.get("格式") !== MASTER_IMPORT_FORMAT ||
    metadata.get("版本") !== MASTER_IMPORT_VERSION
  )
    addIssue(
      issues,
      SHEETS.instructions,
      "unsupported-format",
      "不支援此匯入檔格式或版本。",
      "請重新下載目前網站提供的主資料匯入範本。",
    );
  const workspaceId = metadata.get("工作區ID") || "";
  const revisionText = metadata.get("基準修訂") || "";
  const baseRevision = Number(revisionText);
  if (
    !workspaceId ||
    !/^\d+$/.test(revisionText) ||
    !Number.isSafeInteger(baseRevision)
  )
    addIssue(
      issues,
      SHEETS.instructions,
      "invalid-source",
      "匯入檔缺少有效的工作區ID或基準修訂。",
      "請從要更新的工作區重新下載匯入範本。",
    );

  const parties = addTable(
    book,
    SHEETS.parties,
    HEADERS.parties,
    issues,
    (values, row) => ({
      ...parseIdentity(values, row, SHEETS.parties, issues),
      name: values["名稱"],
      notes: values["備註"],
    }),
  );
  const projects = addTable(
    book,
    SHEETS.projects,
    HEADERS.projects,
    issues,
    (values, row) => ({
      ...parseIdentity(values, row, SHEETS.projects, issues),
      name: values["名稱"],
      description: values["說明"],
    }),
  );
  const events = addTable(
    book,
    SHEETS.events,
    HEADERS.events,
    issues,
    (values, row) => ({
      ...parseIdentity(values, row, SHEETS.events, issues),
      name: values["場次名稱"],
      startDate: values["開始日期"],
      endDate: values["結束日期"],
      venue: values["地點"],
      notes: values["備註"],
      projectIds: values["參加企劃ID（以、分隔）"],
      status: values["狀態"],
    }),
  );
  const products = addTable(
    book,
    SHEETS.products,
    HEADERS.products,
    issues,
    (values, row) => ({
      ...parseIdentity(values, row, SHEETS.products, issues),
      name: values["商品名稱"],
      ownerId: values["商品擁有者ID"],
      creatorId: values["創作者ID"],
      projectId: values["企劃ID"],
      productType: values["周邊種類"],
      specification: values["規格"],
      artwork: values["柄圖名稱"],
      artworkId: values["柄圖ID"],
      notes: values["備註"],
      tagIds: values["標記ID（以、分隔）"],
    }),
  );
  const tags = addTable(
    book,
    SHEETS.tags,
    HEADERS.tags,
    issues,
    (values, row) => ({
      ...parseIdentity(values, row, SHEETS.tags, issues),
      name: values["名稱"],
      status: values["狀態"],
    }),
  );
  const artworks = addTable(
    book,
    SHEETS.artworks,
    HEADERS.artworks,
    issues,
    (values, row) => ({
      ...parseIdentity(values, row, SHEETS.artworks, issues),
      name: values["柄圖名稱"],
      projectId: values["企劃ID"],
      authorIds: values["作者ID（以、分隔）"],
      notes: values["備註"],
      status: values["狀態"],
    }),
  );
  const fields = addTable(
    book,
    SHEETS.fields,
    HEADERS.fields,
    issues,
    (values, row) => ({
      ...parseIdentity(values, row, SHEETS.fields, issues),
      name: values["欄位名稱"],
      type: values["欄位類型"] as FieldType,
      status: values["狀態"],
    }),
  );
  const options = addTable(
    book,
    SHEETS.options,
    HEADERS.options,
    issues,
    (values, row) => {
      const fieldId = values["欄位ID"].trim();
      const fieldAlias = values["欄位新增代號"].trim();
      const id = values["選項ID"].trim();
      const alias = values["選項新增代號"].trim();
      if ((!fieldId && !fieldAlias) || (!id && !alias))
        addIssue(
          issues,
          SHEETS.options,
          "missing-option-identity",
          "選項列須指定欄位及選項識別。",
          "既有資料使用 ID；新增欄位或選項分別填寫新增代號。",
          row,
        );
      if ((fieldId && fieldAlias) || (id && alias))
        addIssue(
          issues,
          SHEETS.options,
          "ambiguous-option-identity",
          "既有ID與新增代號不能同時填寫。",
          "欄位與選項各自只保留既有ID或新增代號其中一種識別。",
          row,
        );
      if (!id && alias && !/^[A-Za-z0-9._-]{1,60}$/.test(alias))
        addIssue(
          issues,
          SHEETS.options,
          "invalid-option-alias",
          "選項新增代號只能使用 1 至 60 個英數字、句點、底線或連字號。",
          "請更換為格式正確且唯一的代號。",
          row,
          "選項新增代號",
        );
      return {
        fieldId,
        fieldAlias,
        id,
        alias,
        label: values["選項名稱"],
        status: values["狀態"],
        sourceRow: row,
      };
    },
  );
  if (issues.length) return { document: null, issues };
  return {
    document: {
      workspaceId,
      baseRevision,
      parties,
      projects,
      events,
      products,
      artworks,
      tags,
      fields,
      options,
    },
    issues,
  };
}
