// @vitest-environment node
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import {
  putField,
  putProduct,
  putTag,
} from "../../src/domain/catalog/operations";
import {
  exportProject,
  PROJECT_FORMAT,
} from "../../src/infrastructure/excel/project";
import type {
  CatalogSnapshot,
  ProductInput,
} from "../../src/domain/models/catalog";
function sample() {
  return emptyCatalog({
    id: crypto.randomUUID(),
    name: "測試工作區",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
}
const input: ProductInput = {
  name: "星狐徽章",
  creatorName: "星狐",
  projectName: "星夜",
  productType: "特製徽章",
  specification: "58mm",
  artwork: "Q版圖",
  notes: "",
  tagIds: [],
  customValues: {},
};
async function read(s: CatalogSnapshot) {
  const b = new ExcelJS.Workbook();
  await b.xlsx.load(await exportProject(s));
  return b;
}
function payload(b: ExcelJS.Workbook) {
  const parts: string[] = [];
  const raw = b.getWorksheet("_ConMate資料")!;
  raw.eachRow((r) => {
    if (r.getCell(1).text.startsWith("payload-")) parts.push(r.getCell(2).text);
  });
  return JSON.parse(Buffer.from(parts.join(""), "base64").toString("utf8"));
}
describe("single-file website project export", () => {
  it("exports only used readable sheets, all stored records remain in one hidden payload", async () => {
    const s = sample();
    putProduct(s, input);
    putTag(s, "限定");
    putField(s, { name: "發售", type: "single", options: [{ label: "首販" }] });
    const field = s.fields[0];
    s.products[0].customValues[field.id] = field.options[0].id;
    field.archived = true;
    s.tags[0].archived = true;
    s.products[0].tagIds = [s.tags[0].id];
    const b = await read(s);
    expect(b.worksheets.map((w) => w.name)).toEqual([
      "00_專案說明",
      "01_商品",
      "02_自訂設定",
      "03_企劃",
      "_ConMate資料",
    ]);
    expect(b.getWorksheet("_ConMate資料")!.state).toBe("hidden");
    expect(payload(b)).toEqual(JSON.parse(JSON.stringify(s)));
    expect(b.getWorksheet("01_商品")!.getRow(2).getCell(7).text).toBe("限定");
  });
  it("keeps an empty workspace compact and never adds unused finance or stock worksheets", async () => {
    const s = sample(),
      b = await read(s);
    expect(b.worksheets.map((w) => w.name)).toEqual([
      "00_專案說明",
      "_ConMate資料",
    ]);
    expect(payload(b).workspace.id).toBe(s.workspaceId);
  });
  it("preserves numeric zero, false, option IDs and formula-looking text as data", async () => {
    const s = sample();
    putField(s, { name: "數值", type: "number", options: [] });
    putField(s, { name: "確認", type: "boolean", options: [] });
    putProduct(s, {
      ...input,
      name: "=1+1",
      customValues: { [s.fields[0].id]: 0, [s.fields[1].id]: false },
    });
    const b = await read(s),
      ws = b.getWorksheet("01_商品")!;
    expect(ws.getCell("A2").type).toBe(ExcelJS.ValueType.String);
    expect(ws.getCell("A2").value).toBe("=1+1");
    expect(ws.getCell("J2").value).toBe(0);
    expect(ws.getCell("K2").value).toBe("FALSE");
    for (const w of b.worksheets)
      w.eachRow((r) =>
        r.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)),
      );
  });
  it("does not display valid small numeric metadata as zero", async () => {
    const s = sample();
    putField(s, { name: "尺寸係數", type: "number", options: [] });
    putProduct(s, {
      ...input,
      customValues: { [s.fields[0].id]: 0.0000000000001 },
    });
    const b = await read(s),
      cell = b.getWorksheet("01_商品")!.getCell("J2");
    expect(cell.value).toBe(0.0000000000001);
    expect(cell.numFmt ?? "General").toBe("General");
  });
  it("joins UTF-16-safe chunks without losing emoji and checks the canonical payload digest", async () => {
    const s = sample();
    for (let n = 0; n < 18; n++)
      putProduct(s, { ...input, name: `商品${n}`, notes: "🦊".repeat(850) });
    const b = await read(s),
      raw = b.getWorksheet("_ConMate資料")!;
    let checksum = "";
    raw.eachRow((r) => {
      if (r.getCell(1).text === "payloadSha256") checksum = r.getCell(2).text;
      expect(r.getCell(2).text.length).toBeLessThanOrEqual(32767);
    });
    const restored = payload(b);
    expect(restored).toEqual(JSON.parse(JSON.stringify(s)));
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(restored)),
    );
    expect(
      [...new Uint8Array(bytes)]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join(""),
    ).toBe(checksum);
    expect(raw.getCell("B2").text).toBe(PROJECT_FORMAT);
  });
});
