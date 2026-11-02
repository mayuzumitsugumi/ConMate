import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  putField,
  putProduct,
  putTag,
} from "../../src/domain/catalog/operations";
import type {
  CatalogSnapshot,
  ProductInput,
} from "../../src/domain/models/catalog";
import type { Workspace } from "../../src/domain/models/workspace";
import {
  catalogRepository,
  emptyCatalog,
} from "../../src/infrastructure/storage/catalog";
import { database } from "../../src/infrastructure/storage/workspaces";

const workspaceIds = new Set<string>();

function makeWorkspace(name: string): Workspace {
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name,
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  };
  workspaceIds.add(workspace.id);
  return workspace;
}

function productInput(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: "星狐徽章",
    productType: "徽章",
    specification: "58mm",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
    ...overrides,
  };
}

function addField(
  snapshot: CatalogSnapshot,
  name: string,
  type: "text" | "number" | "single" | "multi" | "boolean" | "date",
  options: { id?: string; label: string; archived?: boolean }[] = [],
) {
  putField(snapshot, { name, type, options });
  return snapshot.fields.at(-1)!;
}

afterEach(async () => {
  for (const id of workspaceIds) {
    await database.catalogs.delete(id);
    await database.workspaces.delete(id);
  }
  workspaceIds.clear();
});

describe("workspace catalog operations", () => {
  it("accepts a free-text product type and requires a product name", () => {
    const snapshot = emptyCatalog(makeWorkspace("商品工作區"));
    const product = putProduct(
      snapshot,
      productInput({ productType: "手作壓克力吊飾" }),
    );

    expect(snapshot.productTypes.map((type) => type.name)).toEqual([
      "手作壓克力吊飾",
    ]);
    expect(product.typeId).toBe(snapshot.productTypes[0].id);
    expect(() => putProduct(snapshot, productInput({ name: "   " }))).toThrow(
      "商品名稱請填寫",
    );
  });

  it("does not create suggested tags as a side effect of adding a product", () => {
    const snapshot = emptyCatalog(makeWorkspace("標記工作區"));

    putProduct(snapshot, productInput());

    expect(snapshot.tags).toEqual([]);
    putTag(snapshot, "再販");
    expect(snapshot.tags.map((tag) => tag.name)).toEqual(["再販"]);
  });

  it("rejects references to records from another workspace", () => {
    const first = emptyCatalog(makeWorkspace("第一工作區"));
    const second = emptyCatalog(makeWorkspace("第二工作區"));
    putTag(first, "限定販售");
    const firstTag = first.tags[0];
    const firstField = addField(first, "價格備註", "text");

    expect(() =>
      putProduct(second, productInput({ tagIds: [firstTag.id] })),
    ).toThrow("標記不屬於目前工作區");
    expect(() =>
      putProduct(
        second,
        productInput({ customValues: { [firstField.id]: "外部欄位值" } }),
      ),
    ).toThrow("自訂欄位不屬於目前工作區");
  });

  it("keeps option IDs stable when renamed and retains archived historical choices", () => {
    const snapshot = emptyCatalog(makeWorkspace("選項工作區"));
    const field = addField(snapshot, "狀態", "single", [
      { label: "待補貨" },
      { label: "販售中" },
    ]);
    const historicalOption = field.options[0];
    const product = putProduct(
      snapshot,
      productInput({ customValues: { [field.id]: historicalOption.id } }),
    );

    putField(
      snapshot,
      {
        name: "狀態",
        type: "single",
        options: [
          { id: historicalOption.id, label: "補貨中" },
          { id: field.options[1].id, label: "販售中" },
        ],
      },
      field.id,
    );
    expect(snapshot.fields[0].options[0]).toMatchObject({
      id: historicalOption.id,
      label: "補貨中",
      archived: false,
    });
    expect(product.customValues[field.id]).toBe(historicalOption.id);

    putField(
      snapshot,
      {
        name: "狀態",
        type: "single",
        options: [
          { id: historicalOption.id, label: "補貨中", archived: true },
          { id: field.options[1].id, label: "販售中" },
        ],
      },
      field.id,
    );
    expect(snapshot.fields[0].options[0].archived).toBe(true);
    expect(
      putProduct(
        snapshot,
        productInput({
          name: "歷史商品更新",
          customValues: {},
        }),
        product.id,
      ).customValues[field.id],
    ).toBe(historicalOption.id);
    expect(() =>
      putProduct(
        snapshot,
        productInput({
          name: "新商品",
          customValues: { [field.id]: historicalOption.id },
        }),
      ),
    ).toThrow("含已停用或不存在的選項");
  });

  it("preserves numeric zero and boolean false as actual custom values", () => {
    const snapshot = emptyCatalog(makeWorkspace("數值工作區"));
    const quantity = addField(snapshot, "庫存", "number");
    const featured = addField(snapshot, "加強包裝", "boolean");

    const product = putProduct(
      snapshot,
      productInput({
        customValues: {
          [quantity.id]: 0,
          [featured.id]: false,
        },
      }),
    );

    expect(product.customValues).toEqual({
      [quantity.id]: 0,
      [featured.id]: false,
    });
  });

  it("rejects impossible calendar dates", () => {
    const snapshot = emptyCatalog(makeWorkspace("日期工作區"));
    const field = addField(snapshot, "到貨日", "date");

    expect(() =>
      putProduct(
        snapshot,
        productInput({ customValues: { [field.id]: "2026-02-30" } }),
      ),
    ).toThrow("到貨日請填有效日期");
  });

  it("rejects duplicate field option IDs and duplicate active labels", () => {
    const snapshot = emptyCatalog(makeWorkspace("重複選項工作區"));
    const field = addField(snapshot, "販售狀態", "single", [
      { label: "販售中" },
    ]);
    const optionId = field.options[0].id;

    expect(() =>
      putField(
        snapshot,
        {
          name: "販售狀態",
          type: "single",
          options: [
            { id: optionId, label: "販售中" },
            { id: optionId, label: "停售" },
          ],
        },
        field.id,
      ),
    ).toThrow("選項重複");
    expect(() =>
      putField(snapshot, {
        name: "新狀態",
        type: "single",
        options: [{ label: "待售" }, { label: "待售" }],
      }),
    ).toThrow("使用中的選項名稱不能重複");
  });

  it("rolls back a failed catalog repository change", async () => {
    const workspace = makeWorkspace("交易工作區");
    await database.workspaces.put(workspace);
    const initial = await catalogRepository.change(
      workspace.id,
      0,
      (snapshot) => {
        putProduct(snapshot, productInput());
      },
    );
    const before = await catalogRepository.read(workspace.id);

    await expect(
      catalogRepository.change(workspace.id, initial.revision, (snapshot) => {
        snapshot.products[0].name = "不應保存的名稱";
        throw new Error("刻意觸發交易回滾");
      }),
    ).rejects.toThrow("刻意觸發交易回滾");

    expect(await catalogRepository.read(workspace.id)).toEqual(before);
  });
});
