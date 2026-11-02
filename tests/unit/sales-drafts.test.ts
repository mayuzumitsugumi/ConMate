import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import {
  SalesDraftDatabase,
  createSalesDraftRepository,
  validateSalesDraft,
  type SalesDraft,
} from "../../src/application/sales-drafts";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
const workspace = {
  id: "w",
  name: "草稿",
  createdAt: "2026-01-01T00:00:00Z",
  currency: "TWD" as const,
  timezone: "Asia/Taipei" as const,
};
const draft = (): SalesDraft => ({
  version: 1,
  workspaceId: "w",
  operationId: "op",
  selectedPlanId: "",
  replacesRefundId: "",
  context: {
    locationId: "loc",
    eventId: "",
    collectorId: "",
    notes: "",
    cashReceived: null,
  },
  cart: [
    {
      key: "line",
      productId: "p",
      productName: "徽章",
      mode: "direct",
      quantity: 1,
      unitPrice: 0,
    },
  ],
});
it("persists snapshots in submission order and isolates workspaces", async () => {
  const db = new SalesDraftDatabase("draft-" + crypto.randomUUID()),
    repo = createSalesDraftRepository(db);
  try {
    const a = draft();
    const first = repo.save(a);
    a.cart[0].quantity = 2;
    const second = repo.save(a);
    await Promise.all([first, second]);
    expect((await repo.read(emptyCatalog(workspace)))!.cart[0].quantity).toBe(
      2,
    );
    expect(
      await repo.read(emptyCatalog({ ...workspace, id: "other" })),
    ).toBeNull();
    await repo.remove("w");
    expect(await repo.read(emptyCatalog(workspace))).toBeNull();
  } finally {
    await db.delete();
  }
});
it("does not restore a draft already committed as a sale", async () => {
  const db = new SalesDraftDatabase("draft-" + crypto.randomUUID()),
    repo = createSalesDraftRepository(db);
  try {
    await repo.save(draft());
    const s = emptyCatalog(workspace);
    s.sales = [{ operationId: "op" } as never];
    expect(await repo.read(s)).toBeNull();
    expect(await db.drafts.get("w")).toBeUndefined();
  } finally {
    await db.delete();
  }
});
it("preserves zero/free price, incomplete empty amount and captured plan version", () => {
  const d = draft();
  d.cart[0].planId = "plan";
  d.cart[0].planVersion = 3;
  expect(validateSalesDraft(d).cart[0]).toMatchObject({
    unitPrice: 0,
    planId: "plan",
    planVersion: 3,
  });
  expect(
    validateSalesDraft({ ...d, context: { ...d.context, cashReceived: "" } })
      .context.cashReceived,
  ).toBeNull();
  expect(() =>
    validateSalesDraft({
      ...d,
      cart: [{ ...d.cart[0], planVersion: undefined }],
    }),
  ).toThrow();
});
it("refuses corrupt drafts without deleting their stored bytes", async () => {
  const db = new SalesDraftDatabase("draft-" + crypto.randomUUID()),
    repo = createSalesDraftRepository(db);
  try {
    const bad = { ...draft(), version: 99 };
    await db.drafts.put(bad as never);
    await expect(repo.read(emptyCatalog(workspace))).rejects.toThrow();
    expect(await db.drafts.get("w")).toEqual(bad);
  } finally {
    await db.delete();
  }
});
