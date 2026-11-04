import Dexie, { type EntityTable } from "dexie";
import type { CatalogSnapshot, SaleLineInput } from "../domain/models/catalog";
export interface SalesDraft {
  workspaceId: string;
  version: 1;
  operationId: string;
  selectedPlanId: string;
  replacesRefundId: string;
  context: {
    locationId: string;
    eventId: string;
    collectorId: string;
    notes: string;
    cashReceived: number | null;
  };
  cart: (Omit<SaleLineInput, "unitPrice"> & {
    key: string;
    productName: string;
    unitPrice: number | null;
  })[];
}
export class SalesDraftDatabase extends Dexie {
  drafts!: EntityTable<SalesDraft, "workspaceId">;
  constructor(name = "conmate-device-drafts") {
    super(name);
    this.version(1).stores({ drafts: "workspaceId" });
  }
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("購物車草稿格式不正確，原草稿仍保留。");
  return v as Record<string, unknown>;
}
function str(v: unknown, max = 100) {
  if (typeof v !== "string" || v.length > max)
    throw new Error("購物車草稿文字格式不正確，原草稿仍保留。");
  return v;
}
function num(v: unknown, nullable = false): number | null {
  if (nullable && (v === null || v === "")) return null;
  if (!Number.isSafeInteger(v) || Number(v) < 0)
    throw new Error("購物車草稿數量或金額不正確，原草稿仍保留。");
  return v as number;
}
export function validateSalesDraft(value: unknown): SalesDraft {
  const d = object(value),
    c = object(d.context);
  if (d.version !== 1 || !Array.isArray(d.cart) || d.cart.length > 100)
    throw new Error("購物車草稿版本不支援，原草稿仍保留。");
  const cart = d.cart.map((value) => {
    const l = object(value);
    if (l.mode !== "direct" && l.mode !== "draw")
      throw new Error("草稿販售方式不正確。");
    const planId = l.planId === undefined ? undefined : str(l.planId);
    const planVersion =
      l.planVersion === undefined ? undefined : num(l.planVersion)!;
    if ((planId === undefined) !== (planVersion === undefined))
      throw new Error("草稿方案版本不完整。");
    let unitIds: string[] | undefined;
    if (l.unitIds !== undefined) {
      if (!Array.isArray(l.unitIds) || l.unitIds.length > 1000)
        throw new Error("草稿單件清單格式不正確，原草稿仍保留。");
      unitIds = l.unitIds.map((value) => {
        const id = str(value);
        if (!id.trim()) throw new Error("草稿單件識別不可留白。");
        return id;
      });
      if (new Set(unitIds).size !== unitIds.length)
        throw new Error("草稿單件識別重複，請重新核對。");
    }
    return {
      key: str(l.key),
      productId: str(l.productId),
      productName: str(l.productName, 80),
      mode: l.mode as "direct" | "draw",
      quantity: num(l.quantity)!,
      unitPrice: num(l.unitPrice, true),
      ...(planId ? { planId, planVersion } : {}),
      ...(unitIds ? { unitIds } : {}),
    };
  });
  if (new Set(cart.map((l) => l.key)).size !== cart.length)
    throw new Error("購物車草稿項目重複。");
  return {
    version: 1,
    workspaceId: str(d.workspaceId),
    operationId: str(d.operationId),
    selectedPlanId: str(d.selectedPlanId),
    replacesRefundId: str(d.replacesRefundId),
    context: {
      locationId: str(c.locationId),
      eventId: str(c.eventId),
      collectorId: str(c.collectorId),
      notes: str(c.notes, 2000),
      cashReceived: num(c.cashReceived, true),
    },
    cart,
  };
}
export function createSalesDraftRepository(db: SalesDraftDatabase) {
  const pending = new Map<string, Promise<unknown>>();
  function enqueue<T>(id: string, task: () => Promise<T>) {
    const next = (pending.get(id) || Promise.resolve())
      .catch(() => {})
      .then(task);
    pending.set(id, next);
    return next.finally(() => {
      if (pending.get(id) === next) pending.delete(id);
    });
  }
  return {
    save(value: SalesDraft) {
      const draft = validateSalesDraft(JSON.parse(JSON.stringify(value)));
      return enqueue(draft.workspaceId, () => db.drafts.put(draft));
    },
    remove(id: string) {
      return enqueue(id, () => db.drafts.delete(id));
    },
    async read(snapshot: CatalogSnapshot) {
      await pending.get(snapshot.workspaceId)?.catch(() => {});
      const value = await db.drafts.get(snapshot.workspaceId);
      if (!value) return null;
      const d = validateSalesDraft(value);
      if (d.workspaceId !== snapshot.workspaceId)
        throw new Error("草稿工作區不符。");
      if (snapshot.sales.some((s) => s.operationId === d.operationId)) {
        await db.drafts.delete(d.workspaceId);
        return null;
      }
      return d;
    },
  };
}
export const salesDraftRepository = createSalesDraftRepository(
  new SalesDraftDatabase(),
);
