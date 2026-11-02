// XLSX files are deliberately generated before testing, then read independently.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import schema from "../../docs/contracts/workbook.json";
import fixture from "../fixtures/contracts/workspace.json";
import guide from "../../docs/contracts/template-guide.json";

function position(sheet: ExcelJS.Worksheet, label: string) {
  const headers = sheet.getRow(1).values as unknown[];
  const index = headers.indexOf(label);
  if (index < 1) throw new Error(`Missing ${sheet.name}: ${label}`);
  return index;
}

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
        expect((sheet.getRow(1).values as string[]).slice(1).sort()).toEqual(
          spec.columns.map((c) => c.label).sort(),
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
        expect(row.getCell(position(sheet, "正式ID")).value).toBeNull();
        for (let j = 0; j < spec.columns.length; j++) {
          const column = spec.columns[j];
          const cell = row.getCell(position(sheet, column.label));
          if (
            ["money", "quantity", "percent", "unitMoney"].includes(
              column.type,
            ) &&
            cell.value !== null
          )
            expect(typeof cell.value).toBe("number");
          if (column.type === "reference" && cell.value !== null) {
            const reference = cell.text;
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
    expect(sheet.getRow(2).getCell(position(sheet, "名稱")).value).toBeNull();
    expect(sheet.getRow(1).getCell(position(sheet, "名稱")).note).toBeTruthy();
    const fill = sheet.getColumn(position(sheet, "正式ID")).style
      .fill as ExcelJS.FillPattern;
    expect(fill.fgColor?.argb).toBe("FFE7E9E7");
  });

  for (const kind of ["blank", "example"]) {
    it(`${kind}: readable font and real borders remain present even in empty input cells`, async () => {
      const workbook = await read(kind);
      for (const spec of schema.sheets) {
        const sheet = workbook.getWorksheet(spec.name)!;
        expect(sheet.views[0].showGridLines).toBe(true);
        expect(sheet.getCell("A1").font.name).toBe("Microsoft JhengHei");
        expect(sheet.getCell("A1").font.size).toBe(12);
        if (!spec.entity) continue;
        const headers = (sheet.getRow(1).values as string[]).slice(1);
        expect(headers.slice(0, 2)).toEqual(["新增代號", "操作"]);
        const lastEditable = Math.max(
          ...spec.columns
            .filter((c) => c.editable)
            .map((c) => position(sheet, c.label)),
        );
        const firstSystem = Math.min(
          ...spec.columns
            .filter((c) => !c.editable)
            .map((c) => position(sheet, c.label)),
        );
        expect(lastEditable).toBeLessThan(firstSystem);
        for (const column of spec.columns) {
          for (const r of [2, 50, 101]) {
            const cell = sheet.getRow(r).getCell(position(sheet, column.label));
            expect(cell.font.name).toBe("Microsoft JhengHei");
            expect(cell.font.size).toBe(12);
            for (const side of ["top", "left", "bottom", "right"] as const)
              expect(cell.border[side]?.style).toBe("thin");
          }
          if (column.editable) {
            const cell = sheet
              .getRow(101)
              .getCell(position(sheet, column.label));
            expect(cell.value).toBeNull();
            expect(cell.dataValidation.showInputMessage).toBe(true);
            expect(cell.dataValidation.prompt).toContain(column.label);
          }
        }
      }
    });
  }

  it("has connected, accurate beginner examples and Chinese purposes for every sheet", async () => {
    const workbook = await read("example");
    const instructionText: string[] = [];
    workbook
      .getWorksheet("00_使用說明")!
      .eachRow((r) =>
        instructionText.push(`${r.getCell(1).text}\n${r.getCell(2).text}`),
      );
    expect(instructionText.join("\n")).toContain("A2「新增代號」：星狐");
    expect(instructionText.join("\n")).toContain("先別");
    for (const spec of schema.sheets)
      expect(
        guide.sheetPurposes[spec.name as keyof typeof guide.sheetPurposes],
      ).toMatch(/[\u4e00-\u9fff]/);
    for (const step of [...guide.starterSteps, ...guide.optionalSteps]) {
      const sheet = workbook.getWorksheet(step.sheet)!;
      const keyColumn = position(sheet, "新增代號");
      let match: ExcelJS.Row | undefined;
      sheet.eachRow((row) => {
        if (row.getCell(keyColumn).text === step.exampleKey) match = row;
      });
      expect(match).toBeDefined();
      for (const field of step.fields)
        expect(match!.getCell(position(sheet, field.label)).value).toBe(
          typeof field.value === "string" &&
            ["ratio", "estimatedUnitCost"].includes(field.key)
            ? Number(field.value)
            : field.value,
        );
    }
  });
});
