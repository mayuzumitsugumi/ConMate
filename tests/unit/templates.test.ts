// XLSX files are deliberately generated before testing, then read independently.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import schema from "../../docs/contracts/workbook.json";
import fixture from "../fixtures/contracts/workspace.json";

async function read(kind: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(`public/templates/conmate-${kind}-v1.xlsx`);
  return workbook;
}

describe("downloadable XLSX templates", () => {
  for (const kind of ["blank", "example"]) {
    it(`${kind}: preserves all headers, visible sheets and pure values`, async () => {
      const workbook = await read(kind);
      expect(workbook.worksheets.map((w) => w.name)).toEqual(
        schema.sheets.map((s) => s.name),
      );
      for (const spec of schema.sheets) {
        const sheet = workbook.getWorksheet(spec.name)!;
        expect(sheet.state).toBe("visible");
        expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(
          spec.columns.map((c) => c.label),
        );
        sheet.eachRow((row) =>
          row.eachCell((cell) => {
            expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
            expect(cell.type).not.toBe(ExcelJS.ValueType.Hyperlink);
          }),
        );
      }
      expect(
        workbook.getWorksheet("00_使用說明")!.getCell("B2").text,
      ).toContain("不是既有資料的備份");
      expect(workbook.getWorksheet("01_格式資訊")!.getCell("C2").text).toBe(
        kind === "blank" ? "空白模板" : "虛構範例",
      );
    });
  }
  it("example has real numeric values, blank system IDs, valid temporary references", async () => {
    const workbook = await read("example");
    const entitySheets = new Map(
      schema.sheets.filter((s) => s.entity).map((s) => [s.entity, s]),
    );
    let total = 0;
    for (const [entity, sourceRows] of Object.entries(fixture.newRows)) {
      const spec = entitySheets.get(entity)!;
      const sheet = workbook.getWorksheet(spec.name)!;
      for (let i = 0; i < sourceRows.length; i++) {
        total++;
        const row = sheet.getRow(i + 2);
        expect(row.getCell(1).value).toBeNull();
        for (let j = 0; j < spec.columns.length; j++) {
          const column = spec.columns[j];
          if (
            ["money", "quantity", "percent", "unitMoney"].includes(
              column.type,
            ) &&
            row.getCell(j + 1).value !== null
          )
            expect(typeof row.getCell(j + 1).value).toBe("number");
          if (
            column.type === "reference" &&
            row.getCell(j + 1).value !== null
          ) {
            const reference = row.getCell(j + 1).text;
            const target = (column as { target: string }).target;
            const targets = fixture.newRows[
              target as keyof typeof fixture.newRows
            ] as { tempKey: string }[];
            expect(reference.startsWith("new:")).toBe(true);
            expect(targets.some((t) => t.tempKey === reference.slice(4))).toBe(
              true,
            );
          }
        }
      }
    }
    expect(total).toBe(132);
  });
  it("blank has no fictional business rows; headers include input notes and colors", async () => {
    const workbook = await read("blank");
    const sheet = workbook.getWorksheet("03_參與方")!;
    expect(sheet.getCell("A2").value).toBeNull();
    expect(sheet.getCell("H2").value).toBeNull();
    expect(sheet.getCell("H1").note).toBeTruthy();
    const fill = sheet.getColumn(1).style.fill as ExcelJS.FillPattern;
    expect(fill.fgColor?.argb).toBe("FFE7E9E7");
  });
});
