import {
  assertUnreservedOutflow,
  reservationForSale,
  activeReturnReservation,
} from "./reservations";
import { allocateMovement } from "./batches";
import type {
  CatalogSnapshot,
  InventoryMovement,
  MovementInput,
  StockEffect,
} from "../models/catalog";
import { record, text } from "../catalog/operations";
export const movementLabels = {
  receipt: "增加庫存",
  free: "無料發放",
  damage: "瑕疵／損耗",
  "adjust-in": "增加庫存",
  "adjust-out": "減少庫存",
  transfer: "移動庫存",
  reversal: "沖銷更正",
  sale: "販售出庫",
  "refund-return": "退款商品回庫",
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
export function addMovement(
  s: CatalogSnapshot,
  input: MovementInput,
  salePlanId?: string,
) {
  const type = input.movementTypeId
    ? s.movementTypes.find((t) => t.id === input.movementTypeId)
    : undefined;
  if (input.movementTypeId && (!type || type.archived))
    throw new Error("請選擇啟用的自訂類型。");
  const effectKind = type
    ? (
        {
          increase: "adjust-in",
          decrease: "adjust-out",
          transfer: "transfer",
        } as const
      )[type.effect]
    : input.kind;
  input = { ...input, kind: effectKind };
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
    batchAllocations: [],
    ...record(s, "MOV", type?.name || movementLabels[input.kind]),
    ...input,
    ...(incoming && input.batchName?.trim()
      ? { batchName: text(input.batchName, "批次名稱", 120) }
      : {}),
    reason,
    fromLocationId: incoming ? "" : input.fromLocationId,
    toLocationId: outgoing ? "" : input.toLocationId,
    createdAt: new Date().toISOString(),
    reversesId: "",
  };
  if (!incoming) delete m.batchName;
  delete m.reservationId;
  validateMovement(s, m);
  if (m.fromLocationId) {
    if (salePlanId)
      m.reservationId = reservationForSale(
        s,
        m.productId,
        m.fromLocationId,
        m.quantity,
        salePlanId,
      );
    else assertUnreservedOutflow(s, m.productId, m.fromLocationId, m.quantity);
    if (!m.reservationId) delete m.reservationId;
  }
  validateMovement(s, m);
  allocateMovement(s, m);
  s.movements.push(m);
  return m;
}
export function reverseMovement(
  s: CatalogSnapshot,
  id: string,
  reason: string,
  sourceSaleId?: string,
) {
  const old = s.movements.find((m) => m.id === id);
  if (
    !old ||
    old.kind === "reversal" ||
    s.movements.some((m) => m.reversesId === id)
  )
    throw new Error("找不到可沖銷的異動，或此筆已沖銷。");
  if (old.refundId)
    throw new Error("退款回庫請到攤位販售頁處理，不能單獨沖銷。");
  if (old.saleId && old.saleId !== sourceSaleId)
    throw new Error("販售出庫請到攤位販售頁取消交易，避免款項與庫存不一致。");
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
  delete m.batchName;
  delete m.reservationId;
  validateMovement(s, m);
  if (m.fromLocationId)
    assertUnreservedOutflow(s, m.productId, m.fromLocationId, m.quantity);
  else {
    const reservationId = activeReturnReservation(s, old, m.toLocationId);
    if (reservationId) m.reservationId = reservationId;
  }
  validateMovement(s, m);
  allocateMovement(s, m);
  s.movements.push(m);
  return m;
}

export const stockEffectLabels = {
  increase: "增加庫存",
  decrease: "減少庫存",
  transfer: "移動庫存",
};
export function putMovementType(
  s: CatalogSnapshot,
  name: string,
  effect: StockEffect,
  id?: string,
) {
  name = text(name, "類型名稱", 80);
  if (!["increase", "decrease", "transfer"].includes(effect))
    throw new Error("請選擇庫存變化方式。");
  const existing = id ? s.movementTypes.find((t) => t.id === id) : undefined;
  if (id && !existing) throw new Error("找不到異動類型。");
  if (existing && existing.effect !== effect)
    throw new Error("類型的庫存變化方式不可修改，請另建類型。");
  if (s.movementTypes.some((t) => t.id !== id && t.name === name))
    throw new Error("已有相同名稱的類型。");
  if (existing) {
    existing.name = name;
    return existing;
  }
  const type = { ...record(s, "MVT", name), effect, archived: false };
  s.movementTypes.push(type);
  return type;
}
export function toggleMovementType(s: CatalogSnapshot, id: string) {
  const type = s.movementTypes.find((t) => t.id === id);
  if (!type) throw new Error("找不到異動類型。");
  type.archived = !type.archived;
}
