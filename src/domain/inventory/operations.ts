import type {
  CatalogSnapshot,
  InventoryMovement,
  MovementInput,
} from "../models/catalog";
import { record, text } from "../catalog/operations";
export const movementLabels = {
  receipt: "製作入庫",
  free: "無料發放",
  damage: "瑕疵／損耗",
  "adjust-in": "盤差調增",
  "adjust-out": "盤差調減",
  transfer: "庫位調撥",
  reversal: "沖銷更正",
};
export function balance(
  s: CatalogSnapshot,
  productId: string,
  locationId: string,
) {
  let total = 0;
  for (const m of s.movements)
    if (m.productId === productId) {
      if (m.toLocationId === locationId) total += m.quantity;
      if (m.fromLocationId === locationId) total -= m.quantity;
      if (!Number.isSafeInteger(total) || total < 0)
        throw new Error("庫存異動造成負數或超過安全範圍。");
    }
  return total;
}
export function addLocation(s: CatalogSnapshot, name: string) {
  name = text(name, "庫位名稱");
  if (s.locations.some((l) => l.name === name))
    throw new Error("已有相同名稱的庫位。");
  const l = record(s, "LOC", name);
  s.locations.push(l);
  return l;
}
function validateMovement(s: CatalogSnapshot, m: InventoryMovement) {
  if (!Number.isSafeInteger(m.quantity) || m.quantity <= 0)
    throw new Error("數量必須是大於零的安全整數。");
  if (m.fromLocationId && !s.locations.some((l) => l.id === m.fromLocationId))
    throw new Error("來源庫位不存在。");
  if (m.toLocationId && !s.locations.some((l) => l.id === m.toLocationId))
    throw new Error("目的庫位不存在。");
  if (
    (!m.fromLocationId && !m.toLocationId) ||
    m.fromLocationId === m.toLocationId
  )
    throw new Error("請選擇不同的來源與目的庫位。");
  if (
    m.fromLocationId &&
    balance(s, m.productId, m.fromLocationId) < m.quantity
  )
    throw new Error("來源庫位的庫存不足。");
  if (
    m.toLocationId &&
    !Number.isSafeInteger(balance(s, m.productId, m.toLocationId) + m.quantity)
  )
    throw new Error("庫存數量超過安全範圍。");
}
export function addMovement(s: CatalogSnapshot, input: MovementInput) {
  const product = s.products.find((p) => p.id === input.productId);
  if (!product || product.archived) throw new Error("請選擇未封存的商品。");
  if (
    ![
      "receipt",
      "free",
      "damage",
      "adjust-in",
      "adjust-out",
      "transfer",
    ].includes(input.kind)
  )
    throw new Error("異動類型不支援。");
  const incoming = ["receipt", "adjust-in"].includes(input.kind),
    outgoing = ["free", "damage", "adjust-out"].includes(input.kind);
  const reason = text(input.reason, "異動原因", 2000);
  const m: InventoryMovement = {
    ...record(s, "MOV", movementLabels[input.kind]),
    ...input,
    reason,
    fromLocationId: incoming ? "" : input.fromLocationId,
    toLocationId: outgoing ? "" : input.toLocationId,
    createdAt: new Date().toISOString(),
    reversesId: "",
  };
  validateMovement(s, m);
  s.movements.push(m);
  return m;
}
export function reverseMovement(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  const old = s.movements.find((m) => m.id === id);
  if (
    !old ||
    old.kind === "reversal" ||
    s.movements.some((m) => m.reversesId === id)
  )
    throw new Error("找不到可沖銷的異動，或此筆已沖銷。");
  const m: InventoryMovement = {
    ...old,
    ...record(s, "MOV", "沖銷更正"),
    kind: "reversal",
    fromLocationId: old.toLocationId,
    toLocationId: old.fromLocationId,
    reason: text(reason, "沖銷原因", 2000),
    createdAt: new Date().toISOString(),
    reversesId: old.id,
  };
  validateMovement(s, m);
  s.movements.push(m);
  return m;
}
