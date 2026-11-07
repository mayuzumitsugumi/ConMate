import JSZip from "jszip";
import ExcelJS from "exceljs";
import type { ActivityPacket } from "../../domain/activity/types";
import { validateActivityPacket } from "../../domain/activity/operations";
import { balance } from "../../domain/inventory/operations";
const MAX_FILE = 10 * 1024 * 1024,
  MAX_EXPANDED = 30 * 1024 * 1024;
function reject(message: string): never {
  throw new Error(message);
}
// Inspect declared expansion sizes before allocating decompressed XML.
function checkZip(bytes: ArrayBuffer) {
  const v = new DataView(bytes);
  if (v.byteLength < 22 || v.getUint32(0, true) !== 0x04034b50)
    reject("不是支援的 XLSX 檔案。");
  let end = -1;
  for (let i = v.byteLength - 22; i >= Math.max(0, v.byteLength - 65557); i--)
    if (
      v.getUint32(i, true) === 0x06054b50 &&
      i + 22 + v.getUint16(i + 20, true) === v.byteLength
    ) {
      end = i;
      break;
    }
  if (end < 0) reject("壓縮檔結構損壞。");
  const count = v.getUint16(end + 10, true),
    size = v.getUint32(end + 12, true),
    offset = v.getUint32(end + 16, true);
  if (
    v.getUint16(end + 4, true) ||
    v.getUint16(end + 6, true) ||
    count !== v.getUint16(end + 8, true) ||
    count > 500 ||
    offset + size !== end
  )
    reject("不支援此壓縮檔結構或檔案過大。");
  let at = offset,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || v.getUint32(at, true) !== 0x02014b50)
      reject("壓縮目錄損壞。");
    const expanded = v.getUint32(at + 24, true),
      nameSize = v.getUint16(at + 28, true),
      extra = v.getUint16(at + 30, true),
      comment = v.getUint16(at + 32, true);
    if (v.getUint16(at + 8, true) & 1) reject("不支援加密檔案。");
    if (at + 46 + nameSize + extra + comment > end) reject("壓縮目錄損壞。");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(bytes, at + 46, nameSize),
    );
    if (
      names.has(name) ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..")
    )
      reject("檔案路徑重複或不安全。");
    names.add(name);
    total += expanded;
    if (total > MAX_EXPANDED) reject("檔案展開後超過 30 MB 限制。");
    at += 46 + nameSize + extra + comment;
  }
  if (at !== end) reject("壓縮目錄長度不一致。");
}
export async function inspectActivity(bytes: ArrayBuffer) {
  if (bytes.byteLength > MAX_FILE) reject("目前支援最大 10 MB 的活動專案檔。");
  checkZip(bytes);
  const zip = await JSZip.loadAsync(bytes);
  if (!zip.file("[Content_Types].xml") || !zip.file("xl/workbook.xml"))
    reject("缺少 XLSX 必要結構。");
  let actual = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (
      /(?:vbaProject|embeddings\/|externalLinks\/|connections\.xml|activeX\/|customUI\/)/i.test(
        entry.name,
      )
    )
      reject("檔案含巨集、外部連線或嵌入物件。");
    if (!/\.(?:xml|rels)$/i.test(entry.name))
      reject("僅支援不含圖片或附件的 ConMate 活動專案檔。");
    const content = await new Promise<Uint8Array>((resolve, rejectStream) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      // JSZip exposes this browser stream at runtime but omits it from JSZipObject typings.
      const stream = (
        entry as unknown as {
          internalStream(type: "uint8array"): {
            on(event: "data", handler: (chunk: Uint8Array) => void): void;
            on(event: "error", handler: (error: Error) => void): void;
            on(event: "end", handler: () => void): void;
            pause(): void;
            resume(): void;
          };
        }
      ).internalStream("uint8array");
      stream.on("data", (chunk: Uint8Array) => {
        size += chunk.length;
        if (actual + size > MAX_EXPANDED) {
          stream.pause();
          rejectStream(new Error("檔案實際展開後超過 30 MB 限制。"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", rejectStream);
      stream.on("end", () => {
        const result = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
          result.set(chunk, at);
          at += chunk.length;
        }
        resolve(result);
      });
      stream.resume();
    });
    actual += content.byteLength;
    if (actual > MAX_EXPANDED) reject("檔案展開後過大。");
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(content);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) reject("檔案包含不支援的 XML 宣告。");
    if (/<(?:[\w.-]+:)?(?:f|formula|formula1|formula2)\b/i.test(xml))
      reject("檔案含公式，無法還原。請使用網站直接匯出的純值檔。");
    if (
      /TargetMode\s*=\s*["']External["']/i.test(xml) ||
      /macroEnabled|vbaProject|oleObject|externalLink|connections\+xml/i.test(
        xml,
      )
    )
      reject("檔案含外部關聯、巨集或執行物件。");
  }
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as any);
  const raw = book.getWorksheet("_ConMate活動資料");
  if (!raw) reject("這不是活動專案檔；完整工作區備份請使用一般還原入口。");
  const meta = new Map<string, string>();
  raw.eachRow((row, index) => {
    if (index === 1) return;
    const key = row.getCell(1).value,
      value = row.getCell(2).value;
    if (typeof key !== "string" || typeof value !== "string" || meta.has(key))
      reject("活動系統資料損壞或重複。");
    meta.set(key, value);
  });
  if (
    meta.get("format") !== ACTIVITY_FORMAT ||
    !["1.0.0", ACTIVITY_VERSION].includes(meta.get("version") || "") ||
    meta.get("payloadEncoding") !== "utf8-base64"
  )
    reject("不支援此活動檔格式版本。");
  const keys = [...meta.keys()].filter((k) => k.startsWith("payload-")).sort();
  if (!keys.length) reject("缺少活動資料。");
  const parts = keys.map((key, index) => {
    if (key !== `payload-${String(index).padStart(6, "0")}`)
      reject("活動資料分段遺失。");
    const value = meta.get(key)!;
    if (
      value.length > 16000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      )
    )
      reject("活動資料編碼不正確。");
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  });
  const length = parts.reduce((sum, p) => sum + p.length, 0);
  if (String(length) !== meta.get("payloadByteLength") || length > MAX_EXPANDED)
    reject("活動資料長度不一致或超限。");
  const data = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  if ((await digest(data)) !== meta.get("payloadSha256"))
    reject("活動完整性校驗失敗，請保留原檔重新匯出。");
  const packet = validateActivityPacket(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)),
  );
  if (
    meta.get("handoffId") !== packet.handoffId ||
    meta.get("revision") !== String(packet.revision) ||
    meta.get("kind") !== (packet.closure ? "closed" : "active")
  )
    reject("活動標頭與內容不一致。");
  return packet;
}
export const ACTIVITY_FORMAT = "ConMate活動專案";
export const ACTIVITY_VERSION = "1.1.0";
async function digest(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const font = {
  name: "Microsoft JhengHei",
  size: 12,
  color: { argb: "FF253B34" },
};
const border: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FFADB9AE" },
};
export async function buildActivityWorkbook(input: ActivityPacket) {
  const packet = validateActivityPacket(structuredClone(input));
  const book = new ExcelJS.Workbook();
  book.creator = "ConMate";
  book.created = new Date();
  function sheet(name: string, headers: string[]) {
    const ws = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1, showGridLines: true }],
    });
    ws.columns = headers.map((header) => ({
      header,
      width: header === "說明" ? 90 : 28,
      style: {
        font,
        numFmt: "@",
        alignment: { vertical: "top", wrapText: true },
        border: { top: border, bottom: border, left: border, right: border },
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
  const info = sheet("00_活動說明", ["項目", "說明"]);
  info.addRows([
    ["活動", packet.name],
    [
      "檔案狀態",
      packet.closure ? "已確認結案／唯讀" : "活動進行中／可匯入續作",
    ],
    [
      "使用方式",
      "請在ConMate活動工作台匯入，不要使用完整工作區取代還原。日常工作表供閱讀，Excel手動修改不作為匯入來源。",
    ],
    [
      "交接方式",
      "同一份活動檔請輪流操作；離線副本不會自動同步。多次存檔不是結案，已有銷售的進行檔不得合回創作管理。",
    ],
    [
      "結案",
      "全品項盤點並確認後，結案檔永久唯讀。創作管理可另建更正紀錄。剩餘品須實際交還後另確認退回庫位。",
    ],
    [
      "資料範圍",
      "本檔只包含本交接份及明確選擇攜帶的財務參考。隱藏系統表不是加密；交付前請確認內容。",
    ],
    ["交接識別", packet.handoffId],
    ["修訂", String(packet.revision)],
    ["格式", `${ACTIVITY_FORMAT} ${ACTIVITY_VERSION}`],
  ]);
  const products = sheet("01_活動商品", [
    "商品",
    "規格",
    "交付或帶入數量",
    "帳面剩餘",
    "狀態",
  ]);
  for (const p of packet.snapshot.products) {
    const qty =
      packet.sources
        .filter((s) => s.productId === p.id)
        .reduce((n, s) => n + s.quantity, 0) +
      packet.additions
        .filter((a) => a.productId === p.id)
        .reduce((n, a) => n + a.quantity, 0);
    const row = products.addRow([
      p.name,
      p.specification,
      qty,
      balance(packet.snapshot, p.id, packet.locationId),
      p.archived ? "封存" : "啟用",
    ]);
    row.getCell(3).numFmt = "0";
    row.getCell(4).numFmt = "0";
  }
  const sales = sheet("02_活動交易", [
    "交易編號",
    "時間",
    "商品",
    "數量",
    "單價",
    "小計",
    "收款者",
    "狀態",
  ]);
  for (const sale of packet.snapshot.sales)
    for (const line of sale.lines) {
      const row = sales.addRow([
        sale.code,
        sale.createdAt,
        line.productName,
        line.quantity,
        line.unitPrice,
        line.quantity * line.unitPrice,
        packet.snapshot.parties.find((p) => p.id === sale.collectorId)?.name ||
          "未指定",
        sale.cancelledAt ? "已取消" : "成交",
      ]);
      [4, 5, 6].forEach((i) => (row.getCell(i).numFmt = "0"));
    }
  const cash = sheet("03_活動款項", [
    "時間",
    "類型",
    "金額",
    "付款人",
    "收款人",
    "原因",
    "更正來源",
  ]);
  for (const c of packet.cashEntries) {
    const row = cash.addRow([
      c.createdAt,
      (
        {
          expense: "活動支出",
          handover: "交付款項",
          note: "備註",
          correction: "更正紀錄",
        } as const
      )[c.kind],
      c.amount,
      packet.snapshot.parties.find((p) => p.id === c.payerId)?.name || "",
      packet.snapshot.parties.find((p) => p.id === c.recipientId)?.name || "",
      c.reason,
      c.correctsId,
    ]);
    row.getCell(3).numFmt = "0";
  }
  if (packet.closure) {
    const count = sheet("04_結案盤點", [
      "商品",
      "帳面應有",
      "實點",
      "差異",
      "說明",
    ]);
    for (const c of packet.closure.counts) {
      const row = count.addRow([
        packet.snapshot.products.find((p) => p.id === c.productId)?.name ||
          c.productId,
        c.expected,
        c.actual,
        c.actual - c.expected,
        c.reason,
      ]);
      [2, 3, 4].forEach((i) => (row.getCell(i).numFmt = "0"));
    }
    const summary = sheet("05_結案摘要", ["項目", "數值或說明"]);
    summary.addRows([
      ["結案時間", packet.closure.createdAt],
      ["銷售", packet.closure.salesTotal],
      ["退款", packet.closure.refundTotal],
      ["活動支出", packet.closure.expensesTotal],
      ["備註", packet.closure.notes],
    ]);
    summary.eachRow((row, index) => {
      if (index > 1 && typeof row.getCell(2).value === "number")
        row.getCell(2).numFmt = "0";
    });
  }
  if (packet.financialReferences.length) {
    const refs = sheet("06_財務參考", [
      "類型",
      "名稱",
      "來源識別",
      "內容（唯讀參考）",
    ]);
    for (const ref of packet.financialReferences)
      refs.addRow([
        ref.kind,
        ref.name,
        ref.id,
        JSON.stringify(ref.data).slice(0, 30000),
      ]);
  }
  const raw = sheet("_ConMate活動資料", ["項目", "資料"]);
  raw.state = "hidden";
  const encoded = new TextEncoder().encode(JSON.stringify(packet));
  raw.addRows([
    ["format", ACTIVITY_FORMAT],
    ["version", ACTIVITY_VERSION],
    ["kind", packet.closure ? "closed" : "active"],
    ["handoffId", packet.handoffId],
    ["revision", String(packet.revision)],
    ["payloadEncoding", "utf8-base64"],
    ["payloadByteLength", String(encoded.length)],
    ["payloadSha256", await digest(encoded)],
  ]);
  for (let i = 0; i < encoded.length; i += 12000)
    raw.addRow([
      `payload-${String(i / 12000).padStart(6, "0")}`,
      btoa(String.fromCharCode(...encoded.subarray(i, i + 12000))),
    ]);
  return book;
}
export async function exportActivity(
  packet: ActivityPacket,
): Promise<ArrayBuffer> {
  const bytes = await (await buildActivityWorkbook(packet)).xlsx.writeBuffer();
  const result = Uint8Array.from(bytes as unknown as Uint8Array).buffer;
  if (result.byteLength > MAX_FILE)
    reject("活動檔超出可還原的 10 MB 限制，未建立下載檔；請保留本機資料。");
  try {
    checkZip(result);
  } catch (error) {
    throw new Error(
      `活動檔超出可還原的容器限制，未建立下載檔；請保留本機資料。${error instanceof Error ? error.message : ""}`,
    );
  }
  return result;
}
