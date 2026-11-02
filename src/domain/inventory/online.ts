import type { CatalogSnapshot, OnlineListingInput } from "../models/catalog";
import { record, text } from "../catalog/operations";
import { balance } from "./operations";
export function safeShopUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000)
    throw new Error("通販網址格式不正確。");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("請填寫完整的 http 或 https 通販網址。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("僅支援不含登入資訊的 http 或 https 通販網址。");
  return url.href;
}
export function putOnlineListing(
  s: CatalogSnapshot,
  input: OnlineListingInput,
  id?: string,
) {
  const old = id ? s.onlineListings.find((l) => l.id === id) : undefined;
  if (id && !old) throw new Error("找不到通販對照。");
  const product = s.products.find((p) => p.id === input.productId);
  if (!product || (product.archived && old?.productId !== product.id))
    throw new Error("請選擇有效商品。");
  if (!s.locations.some((l) => l.id === input.locationId))
    throw new Error("請選擇出貨庫位。");
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 0)
    throw new Error("網店數量必須是非負安全整數。");
  const values = {
    name: text(input.name, "商店／通路名稱"),
    productId: input.productId,
    locationId: input.locationId,
    url: safeShopUrl(input.url),
    quantity: input.quantity,
    notes: input.notes.trim(),
    checkedAt: new Date().toISOString(),
  };
  if (values.notes.length > 2000) throw new Error("備註最多2000字。");
  const total = s.onlineListings
    .filter(
      (l) =>
        l.id !== id &&
        !l.archived &&
        l.productId === input.productId &&
        l.locationId === input.locationId,
    )
    .reduce((sum, l) => sum + l.quantity, input.quantity);
  if (!Number.isSafeInteger(total)) throw new Error("合計數量超過安全範圍。");
  if (old) {
    Object.assign(old, values);
    return old;
  }
  const listing = {
    ...record(s, "WEB", values.name),
    ...values,
    archived: false,
  };
  s.onlineListings.push(listing);
  return listing;
}
export function onlineComparison(
  s: CatalogSnapshot,
  productId: string,
  locationId: string,
) {
  const listed = s.onlineListings
    .filter(
      (l) =>
        !l.archived && l.productId === productId && l.locationId === locationId,
    )
    .reduce((sum, l) => sum + l.quantity, 0);
  if (!Number.isSafeInteger(listed)) throw new Error("合計數量超過安全範圍。");
  const physical = balance(s, productId, locationId);
  return { listed, physical, difference: physical - listed };
}

export function toggleOnlineListing(s: CatalogSnapshot, id: string) {
  const listing = s.onlineListings.find((l) => l.id === id);
  if (!listing) throw new Error("找不到通販對照。");
  if (listing.archived) {
    const total =
      onlineComparison(s, listing.productId, listing.locationId).listed +
      listing.quantity;
    if (!Number.isSafeInteger(total)) throw new Error("合計數量超過安全範圍。");
  }
  listing.archived = !listing.archived;
}
