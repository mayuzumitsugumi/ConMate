import { balance } from "../../domain/inventory/operations";
import ExcelJS from "exceljs";
import type { CatalogSnapshot, CustomValue } from "../../domain/models/catalog";
export const PROJECT_FORMAT = "ConMate網站專案";
export const PROJECT_VERSION = "2.4.0";
const font = {
  name: "Microsoft JhengHei",
  size: 12,
  color: { argb: "FF253B34" },
};
const edge: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FFADB9AE" },
};
const edges: Partial<ExcelJS.Borders> = {
  top: edge,
  right: edge,
  bottom: edge,
  left: edge,
};
const typeNames = {
  text: "文字",
  number: "數字",
  single: "單選",
  multi: "多選",
  boolean: "是／否",
  date: "日期",
};
export async function buildProjectWorkbook(snapshot: CatalogSnapshot) {
  const book = new ExcelJS.Workbook();
  book.creator = "ConMate";
  book.created = new Date();
  function sheet(name: string, headers: string[]) {
    const ws = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1, showGridLines: true }],
      properties: { defaultRowHeight: 32 },
    });
    ws.columns = headers.map((h) => ({
      header: h,
      width: h === "說明" ? 90 : 28,
      style: {
        font,
        numFmt: "@",
        alignment: { vertical: "top", wrapText: true },
        border: edges,
      },
    }));
    ws.getRow(1).height = 34;
    ws.getRow(1).eachCell((c) => {
      c.font = { ...font, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF275C50" },
      };
    });
    return ws;
  }
  const info = sheet("00_專案說明", ["項目", "說明"]);
  info.addRows([
    ["工作區", snapshot.workspace.name],
    [
      "匯出時間（台灣時間）",
      new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date()),
    ],
    [
      "使用方式",
      "先在ConMate網站建檔，按一下匯出一份專案檔。不必先填Excel，也不必自己輸入ID或new:。",
    ],
    [
      "內容",
      "只顯示有資料的商品與自訂設定；沒使用的成本、庫存、抽選等功能不加入空白表。",
    ],
    [
      "閱讀與編輯",
      "日常工作表供閱讀與核對。請回網站編輯資料後再匯出；這個網站建檔版不採用修改Excel後的資料。",
    ],
    [
      "完整資料",
      "隱藏的「_ConMate資料」保存本次網站建檔的完整紀錄、穩定ID、欄位選項及封存內容。隱藏不是加密，可在試算表取消隱藏。不要修改此表。",
    ],
    [
      "還原功能",
      "可在專案檔與備份頁檢查並還原本格式檔案。還原只會新增本機尚不存在的工作區；若工作區ID已存在，系統會阻止覆蓋。請另行保留備份檔。",
    ],
    [
      "資料範圍",
      "本檔包含此工作區目前可建立的商品、創作者、企劃、場次、參場關聯、標記、自訂欄位及庫存異動；尚不包含未開放的銷售及財務功能。",
    ],
    [
      "格式",
      `${PROJECT_FORMAT} ${PROJECT_VERSION}；來源修訂 ${snapshot.revision}`,
    ],
  ]);
  const fields = snapshot.fields.filter((f) => !f.archived);
  if (snapshot.products.length) {
    const ws = sheet("01_商品", [
      "商品名稱",
      "創作者",
      "企劃",
      "周邊種類",
      "規格",
      "柄圖",
      "標記",
      "備註",
      "狀態",
      ...fields.map((f) => `自訂｜${f.name}`),
    ]);
    const name = (records: { id: string; name: string }[], id: string) =>
      records.find((r) => r.id === id)?.name || "";
    for (const p of snapshot.products) {
      const values = fields.map((f) => {
        const value = p.customValues[f.id];
        if (value === null || value === undefined) return "";
        if (f.type === "single" || f.type === "multi")
          return (Array.isArray(value) ? value : [value])
            .map(
              (id) => f.options.find((o) => o.id === id)?.label || String(id),
            )
            .join("、");
        return typeof value === "boolean"
          ? value
            ? "TRUE"
            : "FALSE"
          : (value as string | number);
      });
      const row = ws.addRow([
        p.name,
        name(snapshot.parties, p.creatorId),
        name(snapshot.projects, p.projectId),
        name(snapshot.productTypes, p.typeId),
        p.specification,
        p.artwork,
        p.tagIds.map((id) => name(snapshot.tags, id)).join("、"),
        p.notes,
        p.archived ? "已封存" : "使用中",
        ...values,
      ]);
      fields.forEach((f, i) => {
        if (f.type === "number") row.getCell(10 + i).numFmt = "General";
      });
      row.height = Math.max(
        32,
        Math.min(180, Math.ceil(p.notes.length / 20) * 18),
      );
    }
    ws.autoFilter = {
      from: "A1",
      to: { row: ws.rowCount, column: ws.columnCount },
    };
  }
  if (snapshot.tags.length || snapshot.fields.length) {
    const ws = sheet("02_自訂設定", [
      "資料類型",
      "名稱",
      "欄位類型",
      "可選項目",
      "狀態",
    ]);
    snapshot.tags.forEach((t) =>
      ws.addRow(["商品標記", t.name, "", "", t.archived ? "已封存" : "使用中"]),
    );
    snapshot.fields.forEach((f) =>
      ws.addRow([
        "自訂欄位",
        f.name,
        typeNames[f.type],
        f.options
          .map((o) => o.label + (o.archived ? "（已封存）" : ""))
          .join("、"),
        f.archived ? "已封存" : "使用中",
      ]),
    );
  }
  if (snapshot.projects.length) {
    const ws = sheet("03_企劃", ["企劃名稱", "企劃說明", "參加場次", "狀態"]);
    for (const p of snapshot.projects)
      ws.addRow([
        p.name,
        p.description,
        snapshot.projectEvents
          .filter((r) => r.projectId === p.id)
          .map(
            (r) => snapshot.events.find((e) => e.id === r.eventId)?.name || "",
          )
          .join("、"),
        p.archived ? "已封存" : "使用中",
      ]);
  }
  if (snapshot.events.length) {
    const ws = sheet("04_場次", [
      "場次名稱",
      "開始日期",
      "結束日期",
      "地點",
      "參加企劃",
      "備註",
      "狀態",
    ]);
    for (const e of snapshot.events)
      ws.addRow([
        e.name,
        e.startDate,
        e.endDate,
        e.venue,
        snapshot.projectEvents
          .filter((r) => r.eventId === e.id)
          .map(
            (r) =>
              snapshot.projects.find((p) => p.id === r.projectId)?.name || "",
          )
          .join("、"),
        e.notes,
        e.archived ? "已封存" : "使用中",
      ]);
  }
  if (snapshot.movements.length || snapshot.locations.length) {
    const stock = sheet("05_庫存", ["商品", "庫位", "現存數量"]);
    const ledger = sheet("06_庫存異動", [
      "異動編號",
      "商品",
      "類型",
      "數量",
      "來源庫位",
      "目的庫位",
      "原因",
      "時間",
      "沖銷來源",
    ]);
    const label = (records: { id: string; name: string }[], id: string) =>
      records.find((r) => r.id === id)?.name || "";
    for (const p of snapshot.products)
      for (const l of snapshot.locations) {
        const value = balance(snapshot, p.id, l.id);
        if (
          value ||
          snapshot.movements.some(
            (m) =>
              m.productId === p.id &&
              (m.fromLocationId === l.id || m.toLocationId === l.id),
          )
        ) {
          const row = stock.addRow([p.name, l.name, value]);
          row.getCell(3).numFmt = "0";
        }
      }
    for (const m of snapshot.movements) {
      const row = ledger.addRow([
        m.code,
        label(snapshot.products, m.productId),
        m.name,
        m.quantity,
        label(snapshot.locations, m.fromLocationId),
        label(snapshot.locations, m.toLocationId),
        m.reason,
        m.createdAt,
        m.reversesId,
      ]);
      row.getCell(4).numFmt = "0";
    }
  }
  if (snapshot.onlineListings.length) {
    const ws = sheet("07_通販對照", [
      "商店／通路",
      "商品",
      "出貨庫位",
      "通販連結",
      "記錄的網店數量",
      "最後手動核對",
      "備註",
      "狀態",
    ]);
    for (const l of snapshot.onlineListings)
      ws.addRow([
        l.name,
        snapshot.products.find((p) => p.id === l.productId)?.name || "",
        snapshot.locations.find((p) => p.id === l.locationId)?.name || "",
        l.url,
        l.quantity,
        l.checkedAt,
        l.notes,
        l.archived ? "已封存" : "使用中",
      ]);
    ws.getColumn(5).numFmt = "0";
  }
  if (snapshot.movementTypes.length) {
    const ws = sheet("08_異動類型", ["類型名稱", "庫存變化", "狀態"]);
    for (const t of snapshot.movementTypes)
      ws.addRow([
        t.name,
        { increase: "增加庫存", decrease: "減少庫存", transfer: "移動庫存" }[
          t.effect
        ],
        t.archived ? "已封存" : "使用中",
      ]);
  }
  const raw = sheet("_ConMate資料", ["項目", "資料"]);
  raw.state = "hidden";
  raw.addRows([
    ["format", PROJECT_FORMAT],
    ["version", PROJECT_VERSION],
    ["workspaceId", snapshot.workspaceId],
    ["revision", String(snapshot.revision)],
  ]);
  const encoded = JSON.stringify(snapshot);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(encoded),
  );
  raw.addRow([
    "payloadSha256",
    [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  ]);
  // ASCII transport avoids surrogate/UTF-8 boundary corruption in spreadsheet XML readers.
  const bytes = new TextEncoder().encode(encoded);
  raw.addRows([
    ["payloadEncoding", "utf8-base64"],
    ["payloadByteLength", String(bytes.length)],
  ]);
  for (let i = 0; i < bytes.length; i += 12000) {
    const chunk = btoa(String.fromCharCode(...bytes.subarray(i, i + 12000)));
    raw.addRow([`payload-${String(i / 12000).padStart(6, "0")}`, chunk]);
  }
  for (const ws of book.worksheets)
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        cell.border = edges;
        if (row.number !== 1) cell.font = font;
      }),
    );
  return book;
}
export async function exportProject(
  snapshot: CatalogSnapshot,
): Promise<ArrayBuffer> {
  const buffer = await (
    await buildProjectWorkbook(snapshot)
  ).xlsx.writeBuffer();
  return Uint8Array.from(buffer as unknown as Uint8Array).buffer;
}
