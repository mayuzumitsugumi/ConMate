import JSZip from "jszip";
import ExcelJS from "exceljs";
import { validateRestoreSnapshot } from "../../domain/validation/restore";
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
export async function inspectProject(bytes: ArrayBuffer) {
  if (bytes.byteLength > MAX_FILE) reject("目前支援最大 10 MB 的網站專案檔。");
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
      reject("僅支援不含圖片或附件的 ConMate 網站專案檔。");
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
  const raw = book.getWorksheet("_ConMate資料");
  if (!raw) reject("找不到完整專案資料。舊版空白模板不能用於網站還原。");
  const meta = new Map<string, string>();
  raw.eachRow((row, index) => {
    if (index === 1) return;
    const k = row.getCell(1).value,
      v = row.getCell(2).value;
    if (typeof k !== "string" || typeof v !== "string" || meta.has(k))
      reject("系統資料欄位損壞或重複。");
    meta.set(k, v);
  });
  if (
    meta.get("format") !== "ConMate網站專案" ||
    !["2.1.0", "2.2.0", "2.3.0", "2.4.0", "2.5.0", "2.6.0", "2.7.0"].includes(
      meta.get("version") || "",
    ) ||
    meta.get("payloadEncoding") !== "utf8-base64"
  )
    reject(
      "目前僅支援 ConMate 網站專案 2.1.0、2.2.0、2.3.0、2.4.0 、2.5.0 、2.6.0 或 2.7.0。",
    );
  const chunks = [...meta.keys()]
    .filter((k) => k.startsWith("payload-"))
    .sort();
  if (!chunks.length) reject("缺少專案內容。");
  const parts = chunks.map((k, i) => {
    if (k !== `payload-${String(i).padStart(6, "0")}`)
      reject("專案資料分段遺失。");
    const value = meta.get(k)!;
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      ) ||
      value.length > 16000
    )
      reject("專案資料編碼不正確。");
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  });
  const length = parts.reduce((sum, p) => sum + p.length, 0);
  if (String(length) !== meta.get("payloadByteLength"))
    reject("專案資料長度不一致。");
  const payload = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    payload.set(part, offset);
    offset += part.length;
  }
  const hash = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", payload)),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== meta.get("payloadSha256"))
    reject("專案完整性校驗失敗，檔案可能已被修改或損壞。");
  const input = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(payload),
  );
  const expectedSchema = {
    "2.1.0": 3,
    "2.2.0": 4,
    "2.3.0": 5,
    "2.4.0": 6,
    "2.5.0": 7,
    "2.6.0": 8,
    "2.7.0": 9,
  }[meta.get("version") as "2.1.0"];
  if (input?.schemaVersion !== expectedSchema)
    reject("專案格式版本與資料版本不一致。");
  const snapshot = validateRestoreSnapshot(input);
  if (
    meta.get("workspaceId") !== snapshot.workspaceId ||
    meta.get("revision") !== String(snapshot.revision)
  )
    reject("專案標頭與內容不一致。");
  return snapshot;
}
