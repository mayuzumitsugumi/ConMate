import ExcelJS from "exceljs";
import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import {
  commitMasterDataImport,
  previewMasterDataImport,
} from "../../src/application/master-data-import";
import {
  putField,
  putProduct,
  putTag,
} from "../../src/domain/catalog/operations";
import { putArtwork } from "../../src/domain/catalog/masterdata";
import { putEvent } from "../../src/domain/catalog/projects";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { database } from "../../src/infrastructure/storage/workspaces";
import {
  buildMasterDataImportWorkbook,
  parseMasterDataImport,
} from "../../src/infrastructure/excel/master-data-import";
import type { CatalogSnapshot } from "../../src/domain/models/catalog";

function setup(): CatalogSnapshot {
  const snapshot = emptyCatalog({
    id: crypto.randomUUID(),
    name: "匯入測試",
    createdAt: new Date().toISOString(),
    currency: "TWD",
    timezone: "Asia/Taipei",
  });
  putProduct(snapshot, {
    name: "既有商品",
    creatorName: "既有創作者",
    projectName: "既有企劃",
    productType: "吊飾",
    specification: "6cm",
    artwork: "",
    notes: "原商品備註",
    tagIds: [],
    customValues: {},
  });
  return snapshot;
}

async function workbookBytes(
  snapshot: CatalogSnapshot,
  edit: (book: ExcelJS.Workbook) => void,
): Promise<ArrayBuffer> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildMasterDataImportWorkbook(snapshot));
  edit(book);
  const buffer = await book.xlsx.writeBuffer();
  return Uint8Array.from(buffer as unknown as Uint8Array).buffer;
}

it("parses a current template and previews without changing its source snapshot", async () => {
  const snapshot = setup();
  const before = JSON.stringify(snapshot);
  const bytes = await buildMasterDataImportWorkbook(snapshot);
  const result = await parseMasterDataImport(bytes);

  expect(result.issues).toEqual([]);
  expect(result.document?.workspaceId).toBe(snapshot.workspaceId);
  expect(result.document?.baseRevision).toBe(snapshot.revision);
  expect(previewMasterDataImport(snapshot, result.document!).issues).toEqual(
    [],
  );
  expect(JSON.stringify(snapshot)).toBe(before);
});

it("previews updates and new records with cross-sheet aliases", async () => {
  const snapshot = setup();
  const bytes = await workbookBytes(snapshot, (book) => {
    const party = book.getWorksheet("01_參與方")!;
    party.getRow(2).getCell(3).value = "更新後創作者";
    party.addRow(["", "new-artist", "新增創作者", "新增備註"]);
    book
      .getWorksheet("02_企劃")!
      .addRow(["", "new-project", "新增企劃", "企劃說明"]);
    book
      .getWorksheet("03_商品")!
      .addRow([
        "",
        "new-product",
        "新增商品",
        "",
        "new:new-artist",
        "new:new-project",
        "徽章",
        "58mm",
        "",
        "",
        "",
        "",
      ]);
  });
  const result = await parseMasterDataImport(bytes);
  expect(result.issues).toEqual([]);
  const preview = previewMasterDataImport(snapshot, result.document!);

  expect(preview.issues).toEqual([]);
  expect(
    preview.changes.map((item) => `${item.operation}${item.entity}`),
  ).toEqual(["更新參與方", "新增參與方", "新增企劃", "新增商品"]);
  expect(snapshot.parties[0].name).toBe("既有創作者");
  expect(snapshot.products).toHaveLength(1);
});

it("rejects deleted existing rows", async () => {
  const snapshot = setup();
  const bytes = await workbookBytes(snapshot, (book) => {
    book.getWorksheet("03_商品")!.spliceRows(2, 1);
  });
  const result = await parseMasterDataImport(bytes);
  const preview = previewMasterDataImport(snapshot, result.document!);

  expect(preview.changes).toEqual([]);
  expect(preview.issues.map((item) => item.code)).toContain(
    "missing-existing-row",
  );
});

it("rejects unresolved cross-sheet references", async () => {
  const snapshot = setup();
  const bytes = await workbookBytes(snapshot, (book) => {
    book
      .getWorksheet("03_商品")!
      .addRow([
        "",
        "new-product",
        "新增商品",
        "",
        "new:unknown-artist",
        "",
        "徽章",
        "58mm",
        "",
        "",
        "",
        "",
      ]);
  });
  const result = await parseMasterDataImport(bytes);
  const preview = previewMasterDataImport(snapshot, result.document!);

  expect(preview.issues.map((item) => item.code)).toContain(
    "invalid-reference",
  );
});

it("updates tags, events, artworks, and custom-field options", async () => {
  const snapshot = setup();
  putTag(snapshot, "既有標記");
  putArtwork(snapshot, {
    name: "既有柄圖",
    projectId: snapshot.projects[0].id,
    authorIds: [snapshot.parties[0].id],
    notes: "舊備註",
  });
  putEvent(snapshot, {
    name: "既有場次",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    venue: "台北",
    notes: "舊場次備註",
    projectIds: [snapshot.projects[0].id],
  });
  putField(snapshot, {
    name: "款式",
    type: "single",
    options: [{ label: "藍" }, { label: "紅" }],
  });
  const bytes = await workbookBytes(snapshot, (book) => {
    book.getWorksheet("04_場次")!.getRow(2).getCell(3).value = "更新場次";
    book.getWorksheet("05_柄圖")!.getRow(2).getCell(3).value = "更新柄圖";
    book.getWorksheet("06_標記")!.getRow(2).getCell(3).value = "更新標記";
    book.getWorksheet("07_自訂欄位")!.getRow(2).getCell(3).value = "商品款式";
    book.getWorksheet("08_欄位選項")!.getRow(2).getCell(5).value = "深藍";
  });
  const parsed = await parseMasterDataImport(bytes);
  const preview = previewMasterDataImport(snapshot, parsed.document!);

  expect(preview.issues).toEqual([]);
  expect(preview.changes.map((item) => item.entity)).toEqual([
    "場次",
    "柄圖",
    "標記",
    "自訂欄位",
    "欄位選項",
  ]);
  expect(snapshot.events[0].name).toBe("既有場次");
  expect(snapshot.artworks[0].name).toBe("既有柄圖");
  expect(snapshot.tags[0].name).toBe("既有標記");
  expect(snapshot.fields[0].name).toBe("款式");
});

it("rejects archived status for newly imported records", async () => {
  const snapshot = setup();
  const bytes = await workbookBytes(snapshot, (book) => {
    book
      .getWorksheet("04_場次")!
      .addRow([
        "",
        "new-event",
        "新場次",
        "2026-11-03",
        "2026-11-03",
        "台北",
        "",
        "",
        "已封存",
      ]);
    book
      .getWorksheet("05_柄圖")!
      .addRow([
        "",
        "new-artwork",
        "新柄圖",
        snapshot.projects[0].id,
        "",
        "",
        "已封存",
      ]);
    book.getWorksheet("06_標記")!.addRow(["", "new-tag", "新標記", "已封存"]);
    book
      .getWorksheet("07_自訂欄位")!
      .addRow(["", "new-field", "尺寸", "text", "已封存"]);
  });
  const parsed = await parseMasterDataImport(bytes);
  const preview = previewMasterDataImport(snapshot, parsed.document!);

  expect(preview.issues.map((item) => item.code)).toEqual([
    "invalid-new-status",
    "invalid-new-status",
    "invalid-new-status",
    "invalid-new-status",
  ]);
});

it("creates referenced master data and field options in one preview", async () => {
  const snapshot = setup();
  const bytes = await workbookBytes(snapshot, (book) => {
    book.getWorksheet("01_參與方")!.addRow(["", "new-artist", "新增作者", ""]);
    book.getWorksheet("02_企劃")!.addRow(["", "new-project", "新增企劃", ""]);
    book
      .getWorksheet("04_場次")!
      .addRow([
        "",
        "new-event",
        "新場次",
        "2026-11-03",
        "2026-11-03",
        "台北",
        "",
        "new:new-project",
        "使用中",
      ]);
    book
      .getWorksheet("05_柄圖")!
      .addRow([
        "",
        "new-artwork",
        "新柄圖",
        "new:new-project",
        "new:new-artist",
        "",
        "使用中",
      ]);
    book.getWorksheet("06_標記")!.addRow(["", "new-tag", "新標記", "使用中"]);
    book
      .getWorksheet("07_自訂欄位")!
      .addRow(["", "new-field", "尺寸", "single", "使用中"]);
    book
      .getWorksheet("08_欄位選項")!
      .addRow(["", "new-field", "", "new-size-small", "小", "使用中"]);
    book
      .getWorksheet("03_商品")!
      .addRow([
        "",
        "new-product",
        "新增商品",
        "",
        "new:new-artist",
        "new:new-project",
        "徽章",
        "58mm",
        "新柄圖",
        "new:new-artwork",
        "",
        "new:new-tag",
      ]);
  });
  const parsed = await parseMasterDataImport(bytes);
  expect(parsed.issues).toEqual([]);
  const preview = previewMasterDataImport(snapshot, parsed.document!);

  expect(preview.issues).toEqual([]);
  expect(preview.changes.map((item) => item.entity)).toEqual([
    "參與方",
    "企劃",
    "場次",
    "柄圖",
    "標記",
    "自訂欄位",
    "欄位選項",
    "商品",
  ]);
  expect(snapshot.events).toHaveLength(0);
  expect(snapshot.fields).toHaveLength(0);
});

it("rejects formulas before interpreting workbook values", async () => {
  const snapshot = setup();
  const bytes = await workbookBytes(snapshot, (book) => {
    book.getWorksheet("03_商品")!.getCell("A2").value = { formula: "1+1" };
  });

  await expect(parseMasterDataImport(bytes)).rejects.toThrow("公式");
});

it("resolves field-option aliases without case sensitivity", async () => {
  const snapshot = setup();
  const parsed = await parseMasterDataImport(
    await workbookBytes(snapshot, (book) => {
      book
        .getWorksheet("07_自訂欄位")!
        .addRow(["", "New-Size", "尺寸", "single", "使用中"]);
      book
        .getWorksheet("08_欄位選項")!
        .addRow(["", "new-size", "", "Small", "小", "使用中"]);
    }),
  );
  const preview = previewMasterDataImport(snapshot, parsed.document!);
  expect(preview.issues).toEqual([]);
  expect(preview.changes.map((item) => item.entity)).toEqual([
    "自訂欄位",
    "欄位選項",
  ]);
});

it("rejects duplicate option aliases across differently cased field references", async () => {
  const snapshot = setup();
  const parsed = await parseMasterDataImport(
    await workbookBytes(snapshot, (book) => {
      book
        .getWorksheet("07_自訂欄位")!
        .addRow(["", "New-Size", "尺寸", "single", "使用中"]);
      const options = book.getWorksheet("08_欄位選項")!;
      options.addRow(["", "New-Size", "", "Small", "小", "使用中"]);
      options.addRow(["", "new-size", "", "small", "大", "使用中"]);
    }),
  );
  expect(
    previewMasterDataImport(snapshot, parsed.document!).issues.map(
      (item) => item.code,
    ),
  ).toContain("duplicate-option-alias");
});

it("rejects ambiguous field-option identities", async () => {
  const snapshot = setup();
  putField(snapshot, {
    name: "尺寸",
    type: "single",
    options: [{ label: "小" }],
  });
  const parsed = await parseMasterDataImport(
    await workbookBytes(snapshot, (book) => {
      book.getWorksheet("08_欄位選項")!.getCell("B2").value = "new-size";
    }),
  );
  expect(parsed.document).toBeNull();
  expect(parsed.issues.map((item) => item.code)).toContain(
    "ambiguous-option-identity",
  );
});

it("rolls back all earlier changes when a later row fails validation", async () => {
  const snapshot = setup();
  await database.workspaces.put(snapshot.workspace);
  await database.catalogs.put(snapshot);
  try {
    const parsed = await parseMasterDataImport(
      await workbookBytes(snapshot, (book) => {
        book.getWorksheet("01_參與方")!.getCell("C2").value = "不能部分寫入";
        book.getWorksheet("03_商品")!.getCell("C2").value = "";
      }),
    );
    await expect(commitMasterDataImport(parsed.document!)).rejects.toThrow();
    expect(await database.catalogs.get(snapshot.workspaceId)).toEqual(snapshot);
  } finally {
    await database.catalogs.delete(snapshot.workspaceId);
    await database.workspaces.delete(snapshot.workspaceId);
  }
});

it("preserves product option values when renaming and archiving their option", async () => {
  const snapshot = setup();
  putField(snapshot, {
    name: "尺寸",
    type: "single",
    options: [{ label: "小" }, { label: "大" }],
  });
  const field = snapshot.fields[0];
  snapshot.products[0].customValues[field.id] = field.options[0].id;
  await database.workspaces.put(snapshot.workspace);
  await database.catalogs.put(snapshot);
  try {
    const parsed = await parseMasterDataImport(
      await workbookBytes(snapshot, (book) => {
        book.getWorksheet("08_欄位選項")!.getCell("E2").value = "小款";
        book.getWorksheet("08_欄位選項")!.getCell("F2").value = "已封存";
        book.getWorksheet("03_商品")!.getCell("C2").value = "更新商品";
      }),
    );
    await commitMasterDataImport(parsed.document!);
    const committed = (await database.catalogs.get(snapshot.workspaceId))!;
    expect(committed.products[0].customValues).toEqual(
      snapshot.products[0].customValues,
    );
    expect(committed.fields[0].options[0]).toEqual({
      ...field.options[0],
      label: "小款",
      archived: true,
    });
  } finally {
    await database.catalogs.delete(snapshot.workspaceId);
    await database.workspaces.delete(snapshot.workspaceId);
  }
});

it("commits atomically and rejects a stale re-import", async () => {
  const snapshot = setup();
  await database.workspaces.put(snapshot.workspace);
  await database.catalogs.put(snapshot);
  try {
    const bytes = await workbookBytes(snapshot, (book) => {
      book.getWorksheet("01_參與方")!.getRow(2).getCell(3).value =
        "確認匯入的名稱";
    });
    const parsed = await parseMasterDataImport(bytes);
    expect(parsed.document).not.toBeNull();

    await commitMasterDataImport(parsed.document!);
    const committed = await database.catalogs.get(snapshot.workspaceId);
    expect(committed?.revision).toBe(snapshot.revision + 1);
    expect(committed?.parties[0].name).toBe("確認匯入的名稱");

    await expect(commitMasterDataImport(parsed.document!)).rejects.toThrow(
      "資料已在其他畫面更新",
    );
    const unchanged = await database.catalogs.get(snapshot.workspaceId);
    expect(unchanged?.revision).toBe(snapshot.revision + 1);
    expect(unchanged?.parties[0].name).toBe("確認匯入的名稱");
  } finally {
    await database.catalogs.delete(snapshot.workspaceId);
    await database.workspaces.delete(snapshot.workspaceId);
  }
});
