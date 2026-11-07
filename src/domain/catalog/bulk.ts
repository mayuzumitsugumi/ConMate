import type { CatalogSnapshot } from "../models/catalog";
import { putProduct, text } from "./operations";
export function putProductNames(s: CatalogSnapshot, input: string[]) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100)
    throw new Error("每次請輸入1至100個商品名稱。");
  const names = input.map((n) => text(n, "商品名稱", 80));
  if (new Set(names).size !== names.length)
    throw new Error("這批名稱有重複，請先確認是否為不同商品。");
  if (names.some((name) => s.products.some((p) => p.name === name)))
    throw new Error(
      "這批名稱包含既有商品，請移除重複名稱；不同款式請用一般表單建立。",
    );
  return names.map((name) =>
    putProduct(s, {
      name,
      productType: "",
      specification: "",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    }),
  );
}

export interface ProductNotesPreview {
  revision: number;
  rows: { id: string; name: string; before: string; after: string }[];
}
export function previewProductNotes(
  s: CatalogSnapshot,
  ids: string[],
  notes: string,
): ProductNotesPreview {
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length)
    throw new Error("每次請選擇1至100項商品。");
  if (notes.trim().length > 2000) throw new Error("備註最多2,000字。");
  return {
    revision: s.revision,
    rows: ids.map((id) => {
      const p = s.products.find((p) => p.id === id && !p.archived);
      if (!p) throw new Error("商品不存在或已封存，請重新預覽。");
      return { id, name: p.name, before: p.notes, after: notes.trim() };
    }),
  };
}
export function applyProductNotes(
  s: CatalogSnapshot,
  preview: ProductNotesPreview,
) {
  if (s.revision !== preview.revision)
    throw new Error("資料已變更，請重新預覽。");
  const checked = previewProductNotes(
    s,
    preview.rows.map((r) => r.id),
    preview.rows[0]?.after ?? "",
  );
  if (JSON.stringify(checked) !== JSON.stringify(preview))
    throw new Error("預覽已失效，請重新預覽。");
  const now = new Date().toISOString();
  for (const row of checked.rows) {
    const p = s.products.find((p) => p.id === row.id)!;
    p.notes = row.after;
    p.updatedAt = now;
  }
}
