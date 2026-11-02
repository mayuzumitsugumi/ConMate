import { saleTotal } from "../sales/operations";
import { costSummary } from "../finance/operations";
import { safeShopUrl } from "../inventory/online";
import type { CatalogSnapshot } from "../models/catalog";
const fail = (message: string): never => {
  throw new Error(message);
};
const obj = (v: unknown): Record<string, any> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? v
    : fail("資料必須是物件。");
function str(
  v: unknown,
  label: string,
  max = 2000,
  required = false,
): asserts v is string {
  if (
    typeof v !== "string" ||
    v.length > max ||
    (required && !v.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    fail(`${label}文字格式不正確。`);
}
function bool(v: unknown) {
  if (typeof v !== "boolean") fail("封存狀態必須是布林值。");
}
function integer(v: unknown) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    fail("修訂或流水號必須是非負安全整數。");
}
function date(v: unknown) {
  str(v, "日期", 10);
  if (
    v !== "" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v)
  )
    fail("日期格式不正確。");
}
function time(v: unknown) {
  str(v, "時間", 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    fail("時間格式不正確。");
}
const keys = [
  "parties",
  "projects",
  "events",
  "projectEvents",
  "productTypes",
  "specs",
  "series",
  "artworks",
  "products",
  "tags",
  "fields",
  "locations",
  "movements",
  "movementTypes",
  "onlineListings",
  "sales",
  "salePlans",
  "costs",
  "advances",
] as const;
export function validateRestoreSnapshot(input: unknown): CatalogSnapshot {
  // Older backups gain empty inventory; never invent physical stock.
  const original = obj(input);
  const inventory =
    original.schemaVersion === 3
      ? { ...original, schemaVersion: 4, locations: [], movements: [] }
      : original;
  const online =
    inventory.schemaVersion === 4
      ? { ...inventory, schemaVersion: 5, onlineListings: [] }
      : inventory;
  const customized =
    online.schemaVersion === 5
      ? { ...online, schemaVersion: 6, movementTypes: [] }
      : online;
  const business =
    customized.schemaVersion === 6
      ? { ...customized, schemaVersion: 7, sales: [], costs: [], advances: [] }
      : customized;
  const s =
    business.schemaVersion === 7
      ? { ...business, schemaVersion: 8, salePlans: [] }
      : business;
  if (s.schemaVersion !== 8) fail("目前僅支援網站資料版本 3 至 8。");
  str(s.workspaceId, "工作區ID", 100, true);
  const w = obj(s.workspace);
  if (
    w.id !== s.workspaceId ||
    w.currency !== "TWD" ||
    w.timezone !== "Asia/Taipei"
  )
    fail("工作區資料不一致。");
  str(w.name, "工作區名稱", 80, true);
  time(w.createdAt);
  integer(s.revision);
  const counters = obj(s.counters);
  for (const [key, value] of Object.entries(counters)) {
    if (!/^[A-Z]+$/.test(key)) fail("流水號類型不正確。");
    integer(value);
  }
  const allIds = new Set<string>(),
    maps: Record<string, Map<string, any>> = {};
  for (const key of keys) {
    if (!Array.isArray(s[key]) || s[key].length > 100000)
      fail(`${key}資料清單不正確或過大。`);
    const map = new Map<string, any>();
    const codes = new Set<string>();
    maps[key] = map;
    for (const item of s[key]) {
      const r = obj(item);
      str(r.id, "ID", 100, true);
      if (allIds.has(r.id)) fail(`${key}出現重複ID。`);
      allIds.add(r.id);
      if (r.workspaceId !== s.workspaceId) fail(`${key}含其他工作區資料。`);
      str(r.code, "顯示編號", 100, true);
      if (codes.has(r.code)) fail(`${key}顯示編號重複。`);
      codes.add(r.code);
      const match = /^([A-Z]+)-(\d+)$/.exec(r.code);
      if (
        !match ||
        !Number.isSafeInteger(Number(match[2])) ||
        Number(match[2]) < 1 ||
        (counters[match[1]!] ?? 0) < Number(match[2])
      )
        fail("流水號計數與資料不一致。");
      str(r.name, "名稱", 200, true);
      map.set(r.id, r);
    }
  }
  const ref = (key: string, id: unknown, optional = false) => {
    if (optional && id === "") return;
    str(id, "參照ID", 100, true);
    if (!maps[key]!.has(id)) fail(`${key}關聯不存在。`);
  };
  for (const p of s.projects) {
    str(p.description, "企劃說明");
    bool(p.archived);
  }
  for (const e of s.events) {
    date(e.startDate);
    date(e.endDate);
    if (e.endDate && (!e.startDate || e.endDate < e.startDate))
      fail("場次日期順序不正確。");
    str(e.venue, "地點", 200);
    str(e.notes, "備註");
    bool(e.archived);
  }
  const pairs = new Set<string>();
  for (const r of s.projectEvents) {
    ref("projects", r.projectId);
    ref("events", r.eventId);
    const pair = JSON.stringify([r.projectId, r.eventId]);
    if (pairs.has(pair)) fail("重複企劃場次關聯。");
    pairs.add(pair);
  }
  for (const r of s.specs) ref("productTypes", r.typeId, true);
  for (const r of s.series) {
    ref("projects", r.projectId, true);
    ref("productTypes", r.typeId, true);
  }
  for (const r of s.artworks) ref("projects", r.projectId, true);
  for (const t of s.tags) bool(t.archived);
  for (const f of s.fields) {
    bool(f.archived);
    if (
      !["text", "number", "single", "multi", "boolean", "date"].includes(
        f.type,
      ) ||
      !Array.isArray(f.options)
    )
      fail("自訂欄位格式不正確。");
    const ids = new Set();
    for (const option of f.options) {
      const o = obj(option);
      str(o.id, "選項ID", 100, true);
      str(o.label, "選項", 80, true);
      bool(o.archived);
      if (ids.has(o.id)) fail("選項ID重複。");
      ids.add(o.id);
    }
  }
  for (const p of s.products) {
    bool(p.archived);
    time(p.createdAt);
    time(p.updatedAt);
    str(p.specification, "規格", 120);
    str(p.artwork, "柄圖", 120);
    str(p.notes, "備註");
    ref("parties", p.creatorId, true);
    ref("projects", p.projectId, true);
    ref("productTypes", p.typeId, true);
    ref("series", p.seriesId, true);
    ref("specs", p.specId, true);
    if (p.artworkId !== undefined) ref("artworks", p.artworkId, true);
    if (p.specId && maps.specs!.get(p.specId).typeId !== p.typeId)
      fail("規格與商品種類不符。");
    if (p.seriesId) {
      const r = maps.series!.get(p.seriesId);
      if (r.projectId !== p.projectId || r.typeId !== p.typeId)
        fail("商品系列關聯不符。");
    }
    if (
      p.artworkId &&
      maps.artworks!.get(p.artworkId).projectId !== p.projectId
    )
      fail("柄圖企劃不符。");
    if (!Array.isArray(p.tagIds) || new Set(p.tagIds).size !== p.tagIds.length)
      fail("商品標記重複或格式不正確。");
    for (const id of p.tagIds) ref("tags", id);
    for (const [id, v] of Object.entries(obj(p.customValues))) {
      ref("fields", id);
      const f = maps.fields!.get(id);
      if (v === null) continue;
      switch (f.type) {
        case "number":
          if (
            typeof v !== "number" ||
            !Number.isFinite(v) ||
            Math.abs(v) > Number.MAX_SAFE_INTEGER
          )
            fail("自訂數值不正確。");
          break;
        case "boolean":
          bool(v);
          break;
        case "single":
        case "multi": {
          const values = f.type === "single" ? [v] : v;
          if (
            !Array.isArray(values) ||
            new Set(values).size !== values.length ||
            values.some((x) => !f.options.some((o: any) => o.id === x))
          )
            fail("自訂選項不存在。");
          break;
        }
        case "date":
          date(v);
          break;
        default:
          str(v, "自訂文字", 2000);
      }
    }
  }
  for (const type of s.movementTypes) {
    bool(type.archived);
    if (!["increase", "decrease", "transfer"].includes(type.effect))
      fail("異動類型的庫存變化方式不正確。");
  }
  const seenMovements = new Map<string, any>(),
    reversed = new Set<string>(),
    balances = new Map<string, number>(),
    reversalBySource = new Map<string, any>();
  const apply = (product: string, location: string, delta: number) => {
    if (!location) return;
    const key = JSON.stringify([product, location]);
    const next = (balances.get(key) || 0) + delta;
    if (!Number.isSafeInteger(next) || next < 0)
      fail("庫存異動造成負數或超過安全範圍。");
    balances.set(key, next);
  };
  for (const m of s.movements) {
    ref("products", m.productId);
    if (m.saleId !== undefined) {
      ref("sales", m.saleId);
      if (
        !["sale", "reversal"].includes(m.kind) ||
        m.movementTypeId !== undefined
      )
        fail("販售庫存來源不正確。");
    }
    if (m.movementTypeId !== undefined) {
      ref("movementTypes", m.movementTypeId);
      const type = maps.movementTypes!.get(m.movementTypeId);
      const expected = {
        increase: "adjust-in",
        decrease: "adjust-out",
        transfer: "transfer",
      }[type.effect as "increase" | "decrease" | "transfer"];
      if (m.kind !== "reversal" && m.kind !== expected)
        fail("異動類型與庫存方向不符。");
    }
    ref("locations", m.fromLocationId, true);
    ref("locations", m.toLocationId, true);
    integer(m.quantity);
    if (
      m.quantity === 0 ||
      m.fromLocationId === m.toLocationId ||
      (!m.fromLocationId && !m.toLocationId)
    )
      fail("庫存異動數量或庫位不正確。");
    time(m.createdAt);
    str(m.reason, "異動原因", 2000, true);
    str(m.reversesId, "沖銷來源", 100);
    if (["receipt", "adjust-in"].includes(m.kind)) {
      if (m.fromLocationId || !m.toLocationId || m.reversesId)
        fail("入庫來源不正確。");
    } else if (["free", "damage", "adjust-out", "sale"].includes(m.kind)) {
      if (!m.fromLocationId || m.toLocationId || m.reversesId)
        fail("出庫來源不正確。");
    } else if (m.kind === "transfer") {
      if (!m.fromLocationId || !m.toLocationId || m.reversesId)
        fail("調撥庫位不正確。");
    } else if (m.kind === "reversal") {
      const old = seenMovements.get(m.reversesId);
      if (
        !old ||
        old.kind === "reversal" ||
        reversed.has(old.id) ||
        old.productId !== m.productId ||
        old.quantity !== m.quantity ||
        old.fromLocationId !== m.toLocationId ||
        old.toLocationId !== m.fromLocationId
      )
        fail("沖銷來源不正確或重複。");
    } else fail("未知庫存異動類型。");
    apply(m.productId, m.fromLocationId, -m.quantity);
    apply(m.productId, m.toLocationId, m.quantity);
    seenMovements.set(m.id, m);
    if (m.reversesId) {
      reversed.add(m.reversesId);
      reversalBySource.set(m.reversesId, m);
    }
  }
  const onlineTotals = new Map<string, number>();
  for (const listing of s.onlineListings) {
    ref("products", listing.productId);
    ref("locations", listing.locationId);
    str(listing.url, "通販網址", 2000, true);
    safeShopUrl(listing.url);
    integer(listing.quantity);
    time(listing.checkedAt);
    str(listing.notes, "通販備註");
    bool(listing.archived);
    if (!listing.archived) {
      const key = JSON.stringify([listing.productId, listing.locationId]);
      const total = (onlineTotals.get(key) || 0) + listing.quantity;
      if (!Number.isSafeInteger(total)) fail("網店合計數量超過安全範圍。");
      onlineTotals.set(key, total);
    }
  }

  for (const p of s.salePlans) {
    str(p.name, "方案名稱", 80, true);
    if (!["direct", "draw"].includes(p.mode)) fail("販售方案售法不正確。");
    integer(p.unitPrice);
    integer(p.version);
    if (!p.version) fail("方案版本必須大於零。");
    bool(p.archived);
    time(p.createdAt);
    time(p.updatedAt);
    if (
      !Array.isArray(p.productIds) ||
      !p.productIds.length ||
      p.productIds.length > 10000 ||
      new Set(p.productIds).size !== p.productIds.length
    )
      fail("方案商品清單不正確。");
    if (
      !Array.isArray(p.eventIds) ||
      new Set(p.eventIds).size !== p.eventIds.length
    )
      fail("方案場次清單不正確。");
    p.productIds.forEach((id: unknown) => ref("products", id));
    p.eventIds.forEach((id: unknown) => ref("events", id));
  }

  const nestedId = (id: unknown) => {
    str(id, "明細ID", 100, true);
    if (allIds.has(id)) fail("明細ID重複。");
    allIds.add(id);
  };
  const operationIds = new Set<string>(),
    linkedMovements = new Set<string>();
  for (const sale of s.sales) {
    str(sale.operationId, "交易操作識別", 100, true);
    if (operationIds.has(sale.operationId)) fail("重複交易操作識別。");
    operationIds.add(sale.operationId);
    ref("locations", sale.locationId);
    ref("events", sale.eventId, true);
    ref("parties", sale.collectorId, true);
    str(sale.notes, "交易備註");
    time(sale.createdAt);
    integer(sale.total);
    integer(sale.cashReceived);
    integer(sale.change);
    if (
      sale.cashReceived < sale.total ||
      sale.change !== sale.cashReceived - sale.total
    )
      fail("交易收款與找零不一致。");
    str(sale.cancelledAt, "取消時間", 40);
    str(sale.cancelReason, "取消原因", 2000);
    if (
      !Array.isArray(sale.lines) ||
      !sale.lines.length ||
      sale.lines.length > 100 ||
      !Array.isArray(sale.reversalIds)
    )
      fail("交易明細格式不正確。");
    if (sale.cancelledAt) {
      time(sale.cancelledAt);
      if (
        !sale.cancelReason.trim() ||
        Date.parse(sale.cancelledAt) < Date.parse(sale.createdAt) ||
        sale.reversalIds.length !== sale.lines.length
      )
        fail("取消交易資料不完整。");
    } else if (sale.cancelReason || sale.reversalIds.length)
      fail("有效交易不應有取消資料。");
    const expectedReversals = new Set<string>();
    for (const line of sale.lines) {
      nestedId(line.id);
      ref("products", line.productId);
      str(line.productName, "成交商品名稱", 80, true);
      integer(line.quantity);
      integer(line.unitPrice);
      if (!line.quantity || !["direct", "draw"].includes(line.mode))
        fail("交易數量或售法不正確。");
      if (
        line.planId !== undefined ||
        line.planVersion !== undefined ||
        line.planName !== undefined
      ) {
        ref("salePlans", line.planId);
        integer(line.planVersion);
        str(line.planName, "成交方案名稱", 80, true);
        if (
          !line.planVersion ||
          line.planVersion > maps.salePlans!.get(line.planId).version
        )
          fail("成交方案版本不正確。");
      }
      ref("movements", line.movementId);
      const m = maps.movements!.get(line.movementId);
      if (
        linkedMovements.has(m.id) ||
        m.saleId !== sale.id ||
        m.kind !== "sale" ||
        m.productId !== line.productId ||
        m.quantity !== line.quantity ||
        m.fromLocationId !== sale.locationId ||
        m.toLocationId
      )
        fail("交易與出庫明細不一致。");
      linkedMovements.add(m.id);
      const reversal = reversalBySource.get(m.id);
      if (sale.cancelledAt) {
        if (!reversal || reversal.saleId !== sale.id)
          fail("取消交易缺少回庫沖銷。");
        expectedReversals.add(reversal.id);
        linkedMovements.add(reversal.id);
      } else if (reversal) fail("有效交易不可有回庫沖銷。");
    }
    if (sale.total !== saleTotal(sale.lines)) fail("交易總額與明細不一致。");
    if (
      new Set(sale.reversalIds).size !== sale.reversalIds.length ||
      sale.reversalIds.some((id: any) => !expectedReversals.has(id))
    )
      fail("交易沖銷來源不一致。");
  }
  for (const m of s.movements)
    if (
      (m.kind === "sale" || m.saleId !== undefined) &&
      !linkedMovements.has(m.id)
    )
      fail("販售出庫沒有對應交易。");
  for (const c of s.costs) {
    ref("products", c.productId);
    ref("parties", c.paidById, true);
    ref("parties", c.burdenPartyId, true);
    integer(c.quantity);
    if (!c.quantity) fail("製作數量必須大於零。");
    for (const key of [
      "estimatedPrint",
      "actualPrint",
      "artworkAllocated",
      "otherCost",
      "unitSalePrice",
    ])
      if (c[key] !== null) integer(c[key]);
    str(c.notes, "成本備註");
    bool(c.archived);
    time(c.createdAt);
    time(c.updatedAt);
    costSummary(c);
  }
  for (const a of s.advances) {
    ref("parties", a.payerId);
    ref("parties", a.debtorId);
    integer(a.principal);
    if (!a.principal || a.payerId === a.debtorId)
      fail("代墊本金或負擔者不正確。");
    str(a.notes, "代墊備註");
    time(a.createdAt);
    str(a.voidedAt, "作廢時間", 40);
    str(a.voidReason, "作廢原因");
    if (!Array.isArray(a.repayments) || a.repayments.length > 100000)
      fail("還款清單不正確。");
    const seen = new Map<string, any>(),
      undone = new Set<string>();
    let paid = 0n;
    for (const r of a.repayments) {
      nestedId(r.id);
      integer(r.amount);
      if (!r.amount) fail("還款金額必須大於零。");
      time(r.createdAt);
      str(r.notes, "還款備註");
      str(r.reversesId, "還款沖銷來源", 100);
      if (r.reversesId) {
        const old = seen.get(r.reversesId);
        if (
          !old ||
          old.reversesId ||
          undone.has(old.id) ||
          old.amount !== r.amount ||
          !r.notes.trim()
        )
          fail("還款沖銷來源不正確。");
        undone.add(old.id);
        paid -= BigInt(r.amount);
      } else paid += BigInt(r.amount);
      if (paid < 0n || paid > BigInt(a.principal))
        fail("已還本金超過代墊本金。");
      seen.set(r.id, r);
    }
    if (a.voidedAt) {
      time(a.voidedAt);
      if (!a.voidReason.trim() || paid !== 0n) fail("作廢代墊仍有有效還款。");
    } else if (a.voidReason) fail("代墊作廢資料不一致。");
  }
  return s as unknown as CatalogSnapshot;
}
