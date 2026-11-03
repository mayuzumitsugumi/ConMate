import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import { putEvent } from "../../src/domain/catalog/projects";
import {
  addLocation,
  addMovement,
} from "../../src/domain/inventory/operations";
import {
  prepareHandoff,
  closeActivityPacket,
} from "../../src/domain/activity/operations";
import {
  buildActivityWorkbook,
  exportActivity,
  inspectActivity,
} from "../../src/infrastructure/excel/activity";
const secrets = [
  "私人完整工作區不可外洩",
  "私人未參售商品不可外洩",
  "私人不相關創作者",
  "私人企劃不得外洩",
  "私有種類",
  "私人商品備註不得外洩",
  "私人物品原庫位不得外洩",
  "私人完整製作原因不得外洩",
];
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: secrets[0]!,
    createdAt: new Date().toISOString(),
    currency: "TWD",
    timezone: "Asia/Taipei",
  });
  const selected = putProduct(s, {
    name: "活動徽章",
    creatorName: "活動創作者",
    productType: "徽章",
    specification: "32mm",
    artwork: "",
    notes: '=HYPERLINK("example")' + "🌟".repeat(900),
    tagIds: [],
    customValues: {},
  });
  putProduct(s, {
    name: secrets[1]!,
    creatorName: secrets[2]!,
    projectName: secrets[3]!,
    productType: secrets[4]!,
    specification: "",
    artwork: "",
    notes: secrets[5]!,
    tagIds: [],
    customValues: {},
  });
  const event = putEvent(s, {
    name: "短期活動",
    startDate: "2026-11-03",
    endDate: "2026-11-04",
    venue: "活動會場",
    notes: "",
    projectIds: [],
  });
  const location = addLocation(s, secrets[6]!);
  addMovement(s, {
    productId: selected.id,
    kind: "receipt",
    quantity: 10,
    fromLocationId: "",
    toLocationId: location.id,
    reason: secrets[7]!,
  });
  return prepareHandoff(s, {
    name: "友人交接份",
    eventId: event.id,
    sourceLocationId: location.id,
    lines: [{ productId: selected.id, quantity: 4 }],
    planIds: [],
    collectorIds: [],
  }).packet;
}
it("round trips the exact scoped packet and includes gridlines, readable Chinese font and pure text", async () => {
  const packet = fixture();
  const book = await buildActivityWorkbook(packet);
  expect(book.worksheets[0]!.name).toBe("00_活動說明");
  expect(book.getWorksheet("_ConMate活動資料")!.state).toBe("hidden");
  expect(book.getWorksheet("01_活動商品")!.getCell("A2").font.name).toBe(
    "Microsoft JhengHei",
  );
  expect(
    book.getWorksheet("01_活動商品")!.getCell("A2").border.bottom?.style,
  ).toBe("thin");
  expect(book.getWorksheet("01_活動商品")!.views[0]?.showGridLines).toBe(true);
  expect(await inspectActivity(await exportActivity(packet))).toEqual(packet);
});
it("exports neither unselected master data nor original workspace/location/movement notes in XML or hidden packet", async () => {
  const bytes = await exportActivity(fixture());
  const zip = await JSZip.loadAsync(bytes);
  for (const entry of Object.values(zip.files))
    if (!entry.dir) {
      const xml = await entry.async("string");
      for (const secret of secrets) expect(xml).not.toContain(secret);
    }
  const json = JSON.stringify(await inspectActivity(bytes));
  for (const secret of secrets) expect(json).not.toContain(secret);
});
it("rejects corrupted payload and wrong file kind metadata without importing", async () => {
  const bytes = await exportActivity(fixture());
  const zip = await JSZip.loadAsync(bytes);
  const shared = await zip.file("xl/sharedStrings.xml")!.async("string");
  zip.file(
    "xl/sharedStrings.xml",
    shared.replace(/[a-f0-9]{64}/, "0".repeat(64)),
  );
  await expect(
    inspectActivity(await zip.generateAsync({ type: "arraybuffer" })),
  ).rejects.toThrow("校驗失敗");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as any);
  const raw = book.getWorksheet("_ConMate活動資料")!;
  raw.eachRow((row) => {
    if (row.getCell(1).value === "kind") row.getCell(2).value = "closed";
  });
  const changed = await book.xlsx.writeBuffer();
  await expect(
    inspectActivity(Uint8Array.from(changed as unknown as Uint8Array).buffer),
  ).rejects.toThrow("標頭");
});
it("rejects formulas in unrelated sheets, external relationships, embedded objects and foreign files", async () => {
  const bytes = await exportActivity(fixture());
  for (const attack of ["formula", "external", "embedded"]) {
    const zip = await JSZip.loadAsync(bytes);
    if (attack === "formula") {
      const path = "xl/worksheets/sheet1.xml";
      zip.file(
        path,
        (await zip.file(path)!.async("string")).replace(
          "</worksheet>",
          "<f>1+1</f></worksheet>",
        ),
      );
    }
    if (attack === "external")
      zip.file(
        "xl/_rels/attack.xml.rels",
        '<Relationships><Relationship TargetMode="External" Target="https://example.test"/></Relationships>',
      );
    if (attack === "embedded")
      zip.file("xl/embeddings/object.bin", new Uint8Array([1, 2]));
    await expect(
      inspectActivity(await zip.generateAsync({ type: "arraybuffer" })),
    ).rejects.toThrow();
  }
  await expect(
    inspectActivity(new Uint8Array([1, 2, 3]).buffer),
  ).rejects.toThrow();
});
it("round trips an immutable closed report and marks the workbook as closed", async () => {
  const packet = fixture();
  const closed = closeActivityPacket(
    packet,
    packet.snapshot.products.map((p) => ({
      productId: p.id,
      actual: 4,
      reason: "",
    })),
    "已實點，款項待核對",
  );
  const book = await buildActivityWorkbook(closed);
  expect(book.getWorksheet("04_結案盤點")!.getCell("C2").value).toBe(4);
  expect(book.getWorksheet("00_活動說明")!.getCell("B3").value).toContain(
    "唯讀",
  );
  expect(await inspectActivity(await exportActivity(closed))).toEqual(closed);
});
