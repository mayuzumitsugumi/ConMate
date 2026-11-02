import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import JSZip from "jszip";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { database } from "../../src/infrastructure/storage/workspaces";
import { restoreWorkspace } from "../../src/infrastructure/storage/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { putProduct } from "../../src/domain/catalog/operations";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "測試工作區",
    createdAt: new Date().toISOString(),
    currency: "TWD",
    timezone: "Asia/Taipei",
  });
  putProduct(s, {
    name: "星空吊飾",
    creatorName: "星星",
    projectName: "夜空企劃",
    productType: "吊飾",
    specification: "6cm",
    artwork: "",
    notes: "=SUM(1,2)",
    tagIds: [],
    customValues: {},
  });
  return s;
}
afterEach(async () => {
  await database.catalogs.clear();
  await database.workspaces.clear();
});
it("round trips and atomically restores exact IDs and data without overwrite", async () => {
  const s = fixture(),
    bytes = await exportProject(s),
    checked = await inspectProject(bytes);
  expect(checked).toEqual(s);
  expect(await database.workspaces.count()).toBe(0);
  await restoreWorkspace(checked);
  expect(await database.catalogs.get(s.workspaceId)).toEqual(s);
  await expect(restoreWorkspace({ ...s, revision: 99 })).rejects.toThrow(
    "相同工作區",
  );
  expect((await database.catalogs.get(s.workspaceId))!.revision).toBe(0);
});
it("rejects competing duplicate restores without partial records", async () => {
  const s = fixture();
  const results = await Promise.allSettled([
    restoreWorkspace(s),
    restoreWorkspace(s),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await database.workspaces.count()).toBe(1);
  expect(await database.catalogs.count()).toBe(1);
});
it("rejects invalid relationships, duplicate IDs and wrong types before writing", async () => {
  const s = fixture();
  s.products[0]!.creatorId = "missing";
  await expect(restoreWorkspace(s)).rejects.toThrow("關聯不存在");
  expect(await database.workspaces.count()).toBe(0);
  const duplicate = fixture();
  duplicate.products[0]!.id = duplicate.parties[0]!.id;
  expect(() => validateRestoreSnapshot(duplicate)).toThrow("重複ID");
  expect(() =>
    validateRestoreSnapshot({ ...fixture(), revision: NaN }),
  ).toThrow("安全整數");
});
it("rejects corrupt or foreign formats and modified payload checksum", async () => {
  await expect(
    inspectProject(new Uint8Array([1, 2, 3]).buffer),
  ).rejects.toThrow();
  const bytes = await exportProject(fixture());
  const zip = await JSZip.loadAsync(bytes);
  const strings = await zip.file("xl/sharedStrings.xml")!.async("string");
  // checksum stored as a shared string; altering it must fail without loading the workspace.
  zip.file(
    "xl/sharedStrings.xml",
    strings.replace(/[a-f0-9]{64}/, "0".repeat(64)),
  );
  await expect(
    inspectProject(await zip.generateAsync({ type: "arraybuffer" })),
  ).rejects.toThrow("校驗失敗");
});
it("rejects formulas even on unrelated hidden sheets, external relationships and embedded objects", async () => {
  const bytes = await exportProject(fixture());
  for (const attack of ["formula", "external", "embedded"]) {
    const zip = await JSZip.loadAsync(bytes);
    if (attack === "formula") {
      const f = zip.file("xl/worksheets/sheet1.xml")!;
      zip.file(
        f.name,
        (await f.async("string")).replace(
          "</worksheet>",
          "<f>1+1</f></worksheet>",
        ),
      );
    }
    if (attack === "external")
      zip.file(
        "xl/_rels/evil.rels",
        '<Relationships><Relationship TargetMode="External" Target="https://example.test"/></Relationships>',
      );
    if (attack === "embedded") zip.file("xl/embeddings/object.bin", "payload");
    await expect(
      inspectProject(await zip.generateAsync({ type: "arraybuffer" })),
    ).rejects.toThrow();
  }
});
