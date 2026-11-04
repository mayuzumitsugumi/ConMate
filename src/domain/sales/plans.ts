import type {
  CatalogSnapshot,
  SalePlanInput,
  SalePlan,
} from "../models/catalog";
import { record, text } from "../catalog/operations";
import { whole } from "../money";
export function putSalePlan(
  s: CatalogSnapshot,
  input: SalePlanInput,
  id?: string,
) {
  const old = id ? s.salePlans.find((p) => p.id === id) : undefined;
  if (id && !old) throw new Error("找不到販售方案。");
  const name = text(input.name, "方案名稱", 80);
  if (!["direct", "draw"].includes(input.mode))
    throw new Error("販售方式不正確。");
  const unitPrice = whole(input.unitPrice, "方案單價");
  const productIds = [...new Set(input.productIds)],
    eventIds = [...new Set(input.eventIds)];
  if (!productIds.length || productIds.length > 10000)
    throw new Error("方案需至少一項商品。");
  if (
    productIds.some(
      (id) =>
        !s.products.some(
          (p) => p.id === id && (!p.archived || old?.productIds.includes(id)),
        ),
    )
  )
    throw new Error("方案商品不存在或已封存。");
  if (
    eventIds.some(
      (id) =>
        !s.events.some(
          (e) => e.id === id && (!e.archived || old?.eventIds.includes(id)),
        ),
    )
  )
    throw new Error("方案場次不存在或已封存。");
  if (
    old &&
    s.inventoryReservations.some(
      (r) =>
        !r.releasedAt &&
        r.planId === old.id &&
        !productIds.includes(r.productId),
    )
  )
    throw new Error("移除商品前請先明確釋放其專用預留。");
  const now = new Date().toISOString();
  const plan: SalePlan = old || {
    ...record(s, "PLN", name),
    mode: input.mode,
    unitPrice,
    productIds,
    eventIds,
    version: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  if (!Number.isSafeInteger(plan.version + 1))
    throw new Error("方案版本超出範圍。");
  Object.assign(plan, {
    name,
    mode: input.mode,
    unitPrice,
    productIds,
    eventIds,
    version: plan.version + 1,
    updatedAt: now,
  });
  if (!old) s.salePlans.push(plan);
  return plan;
}
export function toggleSalePlanArchive(s: CatalogSnapshot, id: string) {
  const p = s.salePlans.find((p) => p.id === id);
  if (!p) throw new Error("找不到販售方案。");
  if (
    !p.archived &&
    s.inventoryReservations.some((r) => !r.releasedAt && r.planId === p.id)
  )
    throw new Error("封存方案前請先明確釋放全部專用預留。");
  p.archived = !p.archived;
  p.updatedAt = new Date().toISOString();
}
