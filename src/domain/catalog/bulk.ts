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
