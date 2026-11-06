import { completeExchange } from "../sales/exchanges";
import type { ExchangeRecord } from "../models/catalog";
import { sameData } from "../../shared/data-equality";
import { unitStates } from "../inventory/units";
import { reserveStock, releaseReservation } from "../inventory/reservations";
import type { CatalogSnapshot, NamedRecord } from "../models/catalog";
import type {
  ActivityPacket,
  HandoffInput,
  HandoffRecord,
  ActivityMergeRecord,
  ActivityCommand,
  ActivityClosure,
} from "./types";
import { record, text, putProduct } from "../catalog/operations";
import { addLocation, addMovement, balance } from "../inventory/operations";
import { completeSale, cancelSale } from "../sales/operations";
import { refundSale } from "../sales/refunds";
import { putSalePlan } from "../sales/plans";
import { validateRestoreSnapshot } from "../validation/restore";
const clone = <T>(v: T): T => structuredClone(v);
const equal = sameData;
function fail(message: string): never {
  throw new Error(message);
}
const now = () => new Date().toISOString();
function whole(n: number, positive = false) {
  if (!Number.isSafeInteger(n) || n < 0 || (positive && !n))
    fail("活動數量／金額必須是安全整數。");
  return n;
}
function sum(ns: number[]) {
  return ns.reduce((a, b) => whole(a + whole(b)), 0);
}
const arrayKeys = [
  "preorders",
  "consignments",
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
  "stocktakes",
  "refunds",
  "costs",
  "advances",
  "settlements",
  "artworkExpenses",
  "expensePayments",
  "batchCostVersions",
  "internalAgreements",
  "internalReceipts",
  "activityHandoffs",
  "activityMerges",
  "inventoryReservations",
  "physicalUnits",
  "exchanges",
] as const;
function blank(parent: CatalogSnapshot, id: string, name: string) {
  const s = {
    schemaVersion: parent.schemaVersion,
    workspaceId: id,
    workspace: {
      id,
      name,
      currency: "TWD",
      timezone: "Asia/Taipei",
      createdAt: now(),
    },
    revision: 0,
    counters: {},
    batchTrackingStart: 0,
  } as CatalogSnapshot;
  for (const k of arrayKeys) (s as any)[k] = [];
  return s;
}
function scoped<T extends NamedRecord>(
  rows: T[],
  ids: Set<string>,
  workspaceId: string,
) {
  return rows
    .filter((r) => ids.has(r.id))
    .map((r) => ({ ...clone(r), workspaceId }));
}
function counters(s: CatalogSnapshot) {
  for (const k of arrayKeys)
    for (const r of (s as any)[k] || []) {
      const m = /^([A-Z]+)-(\d+)$/.exec(r.code || "");
      if (m) s.counters[m[1]!] = Math.max(s.counters[m[1]!] || 0, Number(m[2]));
    }
}
function financialReference(
  s: CatalogSnapshot,
  ref: NonNullable<HandoffInput["financialReferences"]>[number],
  products: Set<string>,
  parties: Set<string>,
  artworks: Set<string>,
  eventId: string,
) {
  const row = (s[ref.kind] as any[]).find((r) => r.id === ref.id);
  if (!row) fail("選取的財務參考不存在。");
  let keys: string[] = [];
  if (ref.kind === "costs") {
    if (!products.has(row.productId)) fail("費用來源不屬於選取商品。");
    keys = [
      "productId",
      "quantity",
      "estimatedPrint",
      "actualPrint",
      "artworkAllocated",
      "otherCost",
      "unitSalePrice",
    ];
  } else if (ref.kind === "artworkExpenses") {
    if (!artworks.has(row.artworkId)) fail("柄圖費不屬於選取的商品柄圖。");
    keys = ["artworkId", "amount", "voidedAt"];
  } else if (ref.kind === "advances") {
    if (!parties.has(row.payerId) || !parties.has(row.debtorId))
      fail("代墊對象不在交接範圍。");
    keys = ["payerId", "debtorId", "principal", "voidedAt"];
  } else if (ref.kind === "internalAgreements") {
    const source =
      row.sourceType === "cost"
        ? s.costs.find((c) => c.id === row.sourceId)
        : s.artworkExpenses.find((c) => c.id === row.sourceId);
    if (
      !source ||
      ("productId" in source
        ? !products.has(source.productId)
        : !artworks.has(source.artworkId))
    )
      fail("內部約定來源不在交接範圍。");
    keys = [
      "sourceType",
      "sourceId",
      "quantity",
      "sourceExact",
      "internalTotal",
      "agreedUnit",
      "voidedAt",
    ];
  } else if (ref.kind === "settlements") {
    if (
      (row.payments || []).some(
        (r: any) => !parties.has(r.fromPartyId) || !parties.has(r.toPartyId),
      )
    )
      fail("分配工作單含未交付的對象。");
    for (const t of row.trials || []) {
      for (const sale of t.saleSources || [])
        if (
          !products.has(sale.productId) ||
          (sale.eventId && sale.eventId !== eventId)
        )
          fail("分配工作單包含其他商品或活動。");
      for (const c of t.costSources || [])
        if (
          !s.costs.some((r) => r.id === c.costId && products.has(r.productId))
        )
          fail("分配工作單包含其他商品成本。");
    }
    if (
      (row.decisions || []).some((r: any) =>
        (r.allocations || []).some((a: any) => !parties.has(a.partyId)),
      )
    )
      fail("分配工作單包含未交付對象。");
    keys = ["closedAt"];
  }
  const data: Record<string, unknown> = {
    id: row.id,
    code: row.code,
    name: row.name,
  };
  for (const k of keys) if (row[k] !== undefined) data[k] = clone(row[k]);
  if (ref.kind === "advances")
    data.repayments = (row.repayments || []).map((r: any) => ({
      id: r.id,
      amount: r.amount,
      reversesId: r.reversesId,
      createdAt: r.createdAt,
    }));
  if (ref.kind === "settlements") {
    data.decisions = (row.decisions || []).map((r: any) => ({
      id: r.id,
      createdAt: r.createdAt,
      allocations: (r.allocations || []).map((a: any) => ({
        partyId: a.partyId,
        amount: a.amount,
      })),
    }));
    data.payments = (row.payments || []).map((r: any) => ({
      id: r.id,
      fromPartyId: r.fromPartyId,
      toPartyId: r.toPartyId,
      amount: r.amount,
      reversesId: r.reversesId,
      createdAt: r.createdAt,
    }));
  }
  return { kind: ref.kind, id: ref.id, name: row.name, data };
}
function prepareUnsafe(
  s: CatalogSnapshot,
  input: HandoffInput,
): { record: HandoffRecord; packet: ActivityPacket } {
  const name = text(input.name, "交接名稱"),
    event = s.events.find((e) => e.id === input.eventId && !e.archived);
  if (!event) fail("請選擇啟用的活動。");
  if (!s.locations.some((l) => l.id === input.sourceLocationId))
    fail("來源庫位不存在。");
  if (s.activityHandoffs.some((h) => h.locationId === input.sourceLocationId))
    fail("不能從已交付的交接庫位再交出商品。");
  if (!input.lines.length || input.lines.length > 10000)
    fail("請選擇1至10000項交付商品。");
  const selectedIds = new Set<string>();
  for (const l of input.lines) {
    whole(l.quantity, true);
    if (selectedIds.has(l.productId)) fail("交付商品不可重複。");
    selectedIds.add(l.productId);
    if (!s.products.some((p) => p.id === l.productId && !p.archived))
      fail("交付商品不存在或已封存。");
    if (balance(s, l.productId, input.sourceLocationId) < l.quantity)
      fail("交付庫存不足。");
  }
  const plans = s.salePlans.filter((p) => input.planIds.includes(p.id));
  if (
    plans.length !== new Set(input.planIds).size ||
    plans.some(
      (p) =>
        p.archived ||
        (p.eventIds.length && !p.eventIds.includes(input.eventId)),
    )
  )
    fail("販售方案不存在、已停用或不適用本活動。");
  if (input.collectorIds.some((id) => !s.parties.some((p) => p.id === id)))
    fail("收款者不存在。");
  const id = crypto.randomUUID(),
    location = addLocation(s, `${name}｜交接 ${id.slice(0, 8)}`),
    p = blank(s, id, name);
  p.locations = [{ ...location, workspaceId: id }];
  p.events = [{ ...clone(event), workspaceId: id, notes: "" }];
  const selected = s.products.filter((r) => selectedIds.has(r.id)),
    ids = (xs: (string | undefined)[]) =>
      new Set(xs.filter(Boolean) as string[]);
  p.products = selected.map((r) => ({
    ...clone(r),
    workspaceId: id,
    notes: "",
    customValues: {},
    tagIds: [],
  }));
  p.projects = scoped(
    s.projects,
    ids(selected.map((r) => r.projectId)),
    id,
  ).map((r) => ({ ...r, description: "" }));
  p.projectEvents = s.projectEvents
    .filter(
      (r) =>
        r.eventId === input.eventId &&
        p.projects.some((a) => a.id === r.projectId),
    )
    .map((r) => ({ ...clone(r), workspaceId: id }));
  p.productTypes = scoped(
    s.productTypes,
    ids(selected.map((r) => r.typeId)),
    id,
  );
  p.specs = scoped(s.specs, ids(selected.map((r) => r.specId)), id);
  p.series = scoped(s.series, ids(selected.map((r) => r.seriesId)), id);
  p.artworks = scoped(
    s.artworks,
    ids(selected.map((r) => r.artworkId)),
    id,
  ).map((r) => ({ ...r, notes: "" }));
  p.parties = scoped(
    s.parties,
    ids([
      ...input.collectorIds,
      ...selected.flatMap((r) => [r.creatorId, r.ownerId]),
      ...p.artworks.flatMap((r) => r.authorIds),
    ]),
    id,
  ).map((r) => ({ ...r, notes: "" }));
  p.salePlans = plans
    .map((r) => ({
      ...clone(r),
      workspaceId: id,
      productIds: r.productIds.filter((x) => selectedIds.has(x)),
      eventIds: [input.eventId],
    }))
    .filter((r) => r.productIds.length);
  counters(p);
  const sources: ActivityPacket["sources"] = [];
  for (const l of input.lines) {
    const move = addMovement(s, {
      productId: l.productId,
      kind: "transfer",
      quantity: l.quantity,
      ...(l.unitIds?.length ? { unitIds: [...l.unitIds] } : {}),
      fromLocationId: input.sourceLocationId,
      toLocationId: location.id,
      reason: `活動交接：${name}`,
    });
    for (const a of move.batchAllocations) {
      const receipt = addMovement(p, {
        productId: l.productId,
        kind: "receipt",
        quantity: a.quantity,
        fromLocationId: "",
        toLocationId: location.id,
        reason: "活動交付初始庫存",
        batchName: `活動交付來源 ${sources.length + 1}`,
      });
      sources.push({
        productId: l.productId,
        quantity: a.quantity,
        packetReceiptId: receipt.id,
        parentBatchId: a.batchId,
        parentTransferId: move.id,
      });
    }
  }
  for (const line of input.lines)
    for (const unitId of line.unitIds || []) {
      const unit = s.physicalUnits.find((u) => u.id === unitId)!;
      const source = sources.find(
        (r) =>
          r.parentBatchId === unit.batchId && r.productId === unit.productId,
      );
      if (!source) fail("交付單件缺少來源批次。");
      p.physicalUnits.push({
        ...clone(unit),
        workspaceId: p.workspaceId,
        batchId: source.packetReceiptId,
        registeredLocationId: p.locations[0]!.id,
        registeredMovementCount: p.movements.length,
      });
    }
  counters(p);
  const financialReferences = (input.financialReferences || []).map((r) =>
    financialReference(
      s,
      r,
      selectedIds,
      new Set(p.parties.map((x) => x.id)),
      new Set(p.artworks.map((x) => x.id)),
      input.eventId,
    ),
  );
  const packet: ActivityPacket = {
    format: "ConMate活動專案",
    version: 1,
    handoffId: id,
    sourceWorkspaceId: s.workspaceId,
    sourceRevision: s.revision,
    eventId: input.eventId,
    name,
    createdAt: now(),
    revision: 0,
    lineage: [],
    draft: [],
    locationId: location.id,
    sources,
    baseline: clone(p),
    snapshot: p,
    additions: [],
    priceRevisions: [],
    productRevisions: [],
    cashEntries: [],
    financialReferences,
    closure: null,
  };
  const rec: HandoffRecord = {
    id,
    name,
    eventId: input.eventId,
    locationId: location.id,
    createdAt: packet.createdAt,
    costVersionIds: s.batchCostVersions.map((v) => v.id),
    packet: clone(packet),
    localPacket: null,
  };
  s.activityHandoffs.push(rec);
  return { record: rec, packet };
}
export function prepareHandoff(s: CatalogSnapshot, input: HandoffInput) {
  const next = clone(s),
    result = prepareUnsafe(next, input);
  validateRestoreSnapshot(next);
  Object.assign(s, next);
  return result;
}
function requireOpen(p: ActivityPacket) {
  if (p.closure)
    fail("活動已確認結案，原檔永久唯讀，請由創作管理新增更正紀錄。");
}
export function applyActivityCommand(
  input: ActivityPacket,
  command: ActivityCommand,
): ActivityPacket {
  const p = validateActivityPacket(input);
  requireOpen(p);
  const s = p.snapshot;
  switch (command.type) {
    case "reserve":
      if (command.input.locationId !== p.locationId)
        fail("只能預留本交接庫位。");
      reserveStock(s, command.input);
      break;
    case "release-reservation":
      releaseReservation(s, command.id, command.reason);
      break;
    case "draft":
      if (
        command.lines.length > 100 ||
        command.lines.some((l) => !s.products.some((r) => r.id === l.productId))
      )
        fail("草稿商品不在活動中。");
      p.draft = clone(command.lines);
      break;
    case "sale":
      if (
        command.input.locationId !== p.locationId ||
        command.input.eventId !== p.eventId
      )
        fail("活動交易只能使用本交接庫位與活動。");
      completeSale(s, command.input);
      p.draft = [];
      break;
    case "exchange":
      if (p.draft.length) fail("請先處理未成交草稿，再進行換購。");
      if (
        command.input.replacement.locationId !== p.locationId ||
        command.input.replacement.eventId !== p.eventId ||
        command.input.refundLines.some(
          (l) => l.returnLocationId && l.returnLocationId !== p.locationId,
        )
      )
        fail("活動換購只能使用本活動與交接庫位。");
      completeExchange(s, command.input);
      break;
    case "refund":
      if (
        command.input.lines.some(
          (l) => l.returnLocationId && l.returnLocationId !== p.locationId,
        )
      )
        fail("退貨只能回本交接庫位。");
      refundSale(s, command.input);
      break;
    case "cancel-sale":
      cancelSale(s, command.id, command.reason);
      break;
    case "rename-product": {
      const product = s.products.find((r) => r.id === command.id);
      if (!product) fail("活動商品不存在。");
      const name = text(command.name, "活動展示名稱"),
        reason = text(command.reason, "名稱修訂原因", 2000);
      p.productRevisions.push({
        id: crypto.randomUUID(),
        productId: product.id,
        beforeName: product.name,
        afterName: name,
        reason,
        createdAt: now(),
      });
      product.name = name;
      break;
    }
    case "decrease":
      addMovement(s, {
        productId: command.productId,
        ...(command.unitIds?.length ? { unitIds: [...command.unitIds] } : {}),
        kind: command.kind,
        quantity: command.quantity,
        fromLocationId: p.locationId,
        toLocationId: "",
        reason: command.reason,
      });
      break;
    case "price": {
      const old = s.salePlans.find((r) => r.id === command.id);
      if (!old) fail("活動端只能修訂既有販售方案。");
      const reason = text(command.reason, "改價原因", 2000);
      if (
        command.input.productIds.some(
          (id) => !s.products.some((r) => r.id === id),
        )
      )
        fail("商品不在活動中。");
      if (!equal(command.input.eventIds, [p.eventId]))
        fail("方案只能屬於本活動。");
      const before = clone(old),
        updated = putSalePlan(s, command.input, command.id);
      p.priceRevisions.push({
        id: crypto.randomUUID(),
        planId: updated.id,
        before,
        after: clone(updated),
        reason,
        createdAt: now(),
      });
      break;
    }
    case "add-product": {
      whole(command.quantity, true);
      const reason = text(command.reason, "新增商品來源與原因", 2000),
        specs = [...s.specs],
        series = [...s.series];
      const product = putProduct(s, {
        name: command.name,
        productType: "",
        specification: "",
        artwork: "",
        notes: "",
        tagIds: [],
        customValues: {},
      });
      s.specs = specs;
      s.series = series;
      product.specId = "";
      product.seriesId = "";
      const receipt = addMovement(s, {
        productId: product.id,
        kind: "receipt",
        quantity: command.quantity,
        fromLocationId: "",
        toLocationId: p.locationId,
        reason,
        batchName: "活動現場一次帶入",
      });
      p.additions.push({
        productId: product.id,
        receiptId: receipt.id,
        initialProduct: clone(product),
        quantity: command.quantity,
        reason,
      });
      break;
    }
    case "cash": {
      const e = command.input;
      whole(e.amount);
      text(e.reason, "活動帳務原因", 2000);
      if (!["expense", "handover", "note", "correction"].includes(e.kind))
        fail("活動帳務類型不正確。");
      if (
        (e.kind === "correction" && !e.correctsId) ||
        (e.kind !== "correction" && e.correctsId)
      )
        fail("更正紀錄需明確指定原紀錄，其他類型不可指定更正來源。");
      if (e.correctsId && !p.cashEntries.some((r) => r.id === e.correctsId))
        fail("更正來源不存在。");
      for (const id of [e.payerId, e.recipientId])
        if (id && !s.parties.some((r) => r.id === id)) fail("帳務對象不存在。");
      if (
        e.kind === "handover" &&
        (!e.payerId || !e.recipientId || e.payerId === e.recipientId)
      )
        fail("交款需指定不同付款與收款對象。");
      p.cashEntries.push({
        ...clone(e),
        id: crypto.randomUUID(),
        createdAt: now(),
      });
      break;
    }
  }
  if (
    !Number.isSafeInteger(p.revision + 1) ||
    !Number.isSafeInteger(s.revision + 1)
  )
    fail("活動修訂已達安全上限。");
  p.revision++;
  s.revision++;
  return validateActivityPacket(p);
}
export function activityCashSummary(p: ActivityPacket) {
  const roots = new Map<string, string>(),
    current = new Map<string, { kind: string; amount: number }>();
  for (const c of p.cashEntries) {
    if (c.kind === "correction") {
      const root = roots.get(c.correctsId);
      if (!root) fail("活動帳務更正來源不正確。");
      roots.set(c.id, root);
      current.get(root)!.amount = c.amount;
    } else {
      roots.set(c.id, c.id);
      current.set(c.id, { kind: c.kind, amount: c.amount });
    }
  }
  return {
    expensesTotal: sum(
      [...current.values()]
        .filter((c) => c.kind === "expense")
        .map((c) => c.amount),
    ),
    handoverTotal: sum(
      [...current.values()]
        .filter((c) => c.kind === "handover")
        .map((c) => c.amount),
    ),
  };
}
function closureFor(
  p: ActivityPacket,
  counts: ActivityClosure["counts"],
  notes: string,
): ActivityClosure {
  if (typeof notes !== "string" || notes.length > 2000) fail("結案說明過長。");
  if (
    counts.length !== p.snapshot.products.length ||
    new Set(counts.map((c) => c.productId)).size !== counts.length
  )
    fail("所有交付與新增商品都必須完成實點。");
  for (const product of p.snapshot.products) {
    const c = counts.find((r) => r.productId === product.id);
    if (!c) fail("商品尚未實點。");
    whole(c.actual);
    const units = unitStates(p.snapshot).filter(
      (u) =>
        u.productId === product.id &&
        u.locationId === p.locationId &&
        u.state === "available",
    );
    if (p.snapshot.physicalUnits.some((u) => u.productId === product.id)) {
      if (
        !Array.isArray(c.unitIds) ||
        new Set(c.unitIds).size !== c.unitIds.length ||
        c.unitIds.some((id) => !units.some((u) => u.id === id))
      )
        fail("請逐件核對單件實物，不能以總數代替實物辨識。");
      if (c.actual < c.unitIds.length)
        fail("實點總數不能少於已確認的單件實物。");
      if (c.unitIds.length !== units.length && !c.reason.trim())
        fail("單件實物有差異，請註明原因或待查。");
    } else if (c.unitIds?.length) fail("此商品沒有已標記實物。");
    if (c.expected !== balance(p.snapshot, product.id, p.locationId))
      fail("盤點帳面數量已變更，請重新核對。");
    if (typeof c.reason !== "string" || c.reason.length > 2000)
      fail("盤點原因格式不正確。");
    if (c.actual !== c.expected && !c.reason.trim())
      fail("盤點差異請註明原因或待查。");
  }
  return {
    id: crypto.randomUUID(),
    createdAt: now(),
    counts: clone(counts),
    salesTotal: sum(p.snapshot.sales.map((r) => r.total)),
    refundTotal: sum([
      ...p.snapshot.refunds.map((r) => r.total),
      ...p.snapshot.sales.filter((r) => r.cancelledAt).map((r) => r.total),
    ]),
    expensesTotal: activityCashSummary(p).expensesTotal,
    notes,
  };
}
export function closeActivityPacket(
  input: ActivityPacket,
  counts: {
    productId: string;
    actual: number;
    reason: string;
    unitIds?: string[];
  }[],
  notes: string,
) {
  const p = validateActivityPacket(input);
  requireOpen(p);
  if (p.draft.length) fail("請先成交或捨棄交易草稿，再確認結案。");
  if (!Number.isSafeInteger(p.revision + 1)) fail("活動修訂已達安全上限。");
  for (const reservation of p.snapshot.inventoryReservations)
    if (!reservation.releasedAt)
      releaseReservation(
        p.snapshot,
        reservation.id,
        "活動結案，釋放剩餘專用預留",
      );
  p.closure = closureFor(
    p,
    counts.map((c) => ({
      ...c,
      expected: balance(p.snapshot, c.productId, p.locationId),
    })),
    notes,
  );
  p.revision++;
  return validateActivityPacket(p);
}
function validateShape(p: ActivityPacket) {
  if (
    !p ||
    p.format !== "ConMate活動專案" ||
    p.version !== 1 ||
    typeof p.handoffId !== "string" ||
    !p.handoffId ||
    typeof p.sourceWorkspaceId !== "string" ||
    !p.sourceWorkspaceId ||
    p.sourceWorkspaceId === p.handoffId
  )
    fail("活動檔來源格式不正確。");
  text(p.name, "活動名稱");
  whole(p.sourceRevision);
  whole(p.revision);
  if (!Number.isFinite(Date.parse(p.createdAt))) fail("活動建立時間不正確。");
  if (
    !Array.isArray(p.lineage) ||
    p.lineage.length > 100000 ||
    p.lineage.some((h) => typeof h !== "string" || !/^[a-f0-9]{64}$/.test(h))
  )
    fail("活動續作版本鏈不正確。");
  if (!Array.isArray(p.draft) || p.draft.length > 100) fail("活動草稿不正確。");
  for (const k of [
    "sources",
    "additions",
    "priceRevisions",
    "productRevisions",
    "cashEntries",
    "financialReferences",
  ] as const)
    if (!Array.isArray(p[k]) || p[k].length > 100000)
      fail("活動清單格式不正確。");
  if (
    p.baseline.workspaceId !== p.handoffId ||
    p.snapshot.workspaceId !== p.handoffId ||
    p.baseline.workspace.id !== p.handoffId ||
    p.snapshot.workspace.id !== p.handoffId
  )
    fail("活動工作區識別不一致。");
  for (const s of [p.baseline, p.snapshot]) {
    if (s.activityHandoffs.length || s.activityMerges.length)
      fail("活動檔不得包含其他交接歷史。");
    for (const k of [
      "preorders",
      "consignments",
      "costs",
      "advances",
      "settlements",
      "artworkExpenses",
      "expensePayments",
      "batchCostVersions",
      "internalAgreements",
      "internalReceipts",
      "onlineListings",
      "stocktakes",
    ] as const)
      if (s[k]?.length) fail("活動工作資料不得混入私人財務或非本活動歷史。");
    if (
      s.locations.length !== 1 ||
      s.locations[0]?.id !== p.locationId ||
      s.events.length !== 1 ||
      s.events[0]?.id !== p.eventId
    )
      fail("活動檔包含未交付的庫位或活動。");
  }
  if (
    p.baseline.sales.length ||
    p.baseline.refunds.length ||
    p.baseline.exchanges?.length ||
    0
  )
    fail("交接快照不得含其他歷史交易。");
}
export function validateActivityPacket(input: unknown): ActivityPacket {
  const p = clone(input) as ActivityPacket;
  validateShape(p);
  p.baseline = validateRestoreSnapshot(p.baseline);
  p.snapshot = validateRestoreSnapshot(p.snapshot);
  const base = p.baseline,
    s = p.snapshot;
  for (const k of [
    "parties",
    "projects",
    "events",
    "projectEvents",
    "productTypes",
    "specs",
    "series",
    "artworks",
    "tags",
    "fields",
    "locations",
    "movementTypes",
    "physicalUnits",
  ] as const)
    if (!equal(base[k], s[k])) fail("活動來源主資料不得直接改寫。");
  for (const r of p.productRevisions) {
    text(r.id, "名稱修訂ID", 100);
    text(r.reason, "名稱修訂原因", 2000);
    text(r.beforeName, "原名稱");
    text(r.afterName, "新名稱");
    if (!s.products.some((a) => a.id === r.productId))
      fail("名稱修訂商品不存在。");
  }
  const revised = (original: CatalogSnapshot["products"][number]) => {
    const out = clone(original);
    for (const r of p.productRevisions.filter((a) => a.productId === out.id)) {
      if (out.name !== r.beforeName) fail("名稱修訂來源不連續。");
      out.name = r.afterName;
    }
    return out;
  };
  for (const product of base.products)
    if (
      !equal(
        revised(product),
        s.products.find((r) => r.id === product.id),
      )
    )
      fail("交付商品來源不得直接改寫，請使用名稱修訂。");
  if (
    s.products.length !== base.products.length + p.additions.length ||
    new Set(p.additions.map((a) => a.productId)).size !== p.additions.length
  )
    fail("新增商品與來源登記不一致。");
  for (const a of p.additions) {
    whole(a.quantity, true);
    text(a.reason, "新增商品來源", 2000);
    if (
      base.products.some((r) => r.id === a.productId) ||
      !s.products.some((r) => r.id === a.productId)
    )
      fail("新增活動品項來源不正確。");
    if (
      !a.initialProduct ||
      a.initialProduct.id !== a.productId ||
      !equal(
        revised(a.initialProduct),
        s.products.find((r) => r.id === a.productId),
      )
    )
      fail("新增商品資料未保留原始版本。");
    const m = s.movements.find((r) => r.id === a.receiptId);
    if (
      !m ||
      m.productId !== a.productId ||
      m.kind !== "receipt" ||
      m.quantity !== a.quantity ||
      m.fromLocationId ||
      m.toLocationId !== p.locationId ||
      m.reason !== a.reason
    )
      fail("新增商品僅可一次登記帶入量。");
  }
  if (!equal(s.movements.slice(0, base.movements.length), base.movements))
    fail("原始交付量或批次不得修改。");
  if (
    p.sources.length !== base.movements.length ||
    new Set(p.sources.map((a) => a.packetReceiptId)).size !== p.sources.length
  )
    fail("交付來源不正確。");
  for (const a of p.sources) {
    whole(a.quantity, true);
    const m = base.movements.find((r) => r.id === a.packetReceiptId);
    if (
      !m ||
      m.kind !== "receipt" ||
      m.quantity !== a.quantity ||
      m.productId !== a.productId ||
      !a.parentBatchId ||
      !a.parentTransferId
    )
      fail("交付來源對應不正確。");
  }
  const receipts = new Set([
    ...p.sources.map((a) => a.packetReceiptId),
    ...p.additions.map((a) => a.receiptId),
  ]);
  for (const m of s.movements) {
    if (
      (m.fromLocationId && m.fromLocationId !== p.locationId) ||
      (m.toLocationId && m.toLocationId !== p.locationId)
    )
      fail("活動庫位越界。");
    if (m.kind === "transfer" || m.kind === "adjust-in")
      fail("活動端不能調入或增加既有商品。");
    if (m.kind === "receipt" && !receipts.has(m.id))
      fail("活動端不能增加既有商品交付量。");
    if (m.kind === "reversal" && !m.saleId)
      fail("活動端不可用沖銷增加原交付數量。");
  }
  if (s.salePlans.length !== base.salePlans.length)
    fail("活動方案不可擅自新增或刪除。");
  if (
    p.priceRevisions.some((r) => !base.salePlans.some((a) => a.id === r.planId))
  )
    fail("方案修訂來源不存在。");
  for (const old of base.salePlans) {
    let current = clone(old);
    for (const r of p.priceRevisions.filter((a) => a.planId === old.id)) {
      text(r.reason, "方案修訂原因", 2000);
      if (!equal(r.before, current)) fail("方案修訂來源不連續。");
      current = clone(r.after) as typeof old;
      if (
        current.id !== old.id ||
        current.workspaceId !== p.handoffId ||
        current.version !== (r.before as typeof old).version + 1
      )
        fail("方案修訂版本不正確。");
    }
    if (
      !equal(
        current,
        s.salePlans.find((r) => r.id === old.id),
      )
    )
      fail("方案變更未保留歷史。");
  }
  for (const l of p.draft) {
    if (!s.products.some((r) => r.id === l.productId)) fail("草稿商品不存在。");
    if (
      l.unitIds !== undefined &&
      (!Array.isArray(l.unitIds) ||
        l.unitIds.length !== l.quantity ||
        new Set(l.unitIds).size !== l.unitIds.length ||
        l.unitIds.some(
          (id) =>
            !s.physicalUnits.some(
              (u) => u.id === id && u.productId === l.productId,
            ),
        ))
    )
      fail("草稿單件識別與商品或數量不符。");
    whole(l.quantity, true);
    whole(l.unitPrice);
  }
  const cashIds = new Set<string>();
  for (const c of p.cashEntries) {
    if (!c.id || cashIds.has(c.id)) fail("活動帳務識別重複。");
    if (
      (c.kind === "correction" && !c.correctsId) ||
      (c.kind !== "correction" && c.correctsId)
    )
      fail("活動更正來源不正確。");
    if (c.correctsId && !cashIds.has(c.correctsId))
      fail("活動更正需指向既有紀錄。");
    cashIds.add(c.id);
    whole(c.amount);
    text(c.reason, "活動帳務原因", 2000);
    if (!["expense", "handover", "note", "correction"].includes(c.kind))
      fail("活動帳務類型不正確。");
    for (const id of [c.payerId, c.recipientId])
      if (id && !s.parties.some((r) => r.id === id))
        fail("活動帳務對象不存在。");
    if (
      c.kind === "handover" &&
      (!c.payerId || !c.recipientId || c.payerId === c.recipientId)
    )
      fail("交款對象不正確。");
  }
  for (const r of p.financialReferences)
    if (
      ![
        "costs",
        "advances",
        "settlements",
        "artworkExpenses",
        "internalAgreements",
      ].includes(r.kind) ||
      typeof r.id !== "string" ||
      typeof r.name !== "string" ||
      !r.data ||
      typeof r.data !== "object"
    )
      fail("財務參考格式不正確。");
  if (base.inventoryReservations.length) fail("原始交接不能包含其他專用預留。");
  if (p.closure && s.inventoryReservations.some((r) => !r.releasedAt))
    fail("結案前須釋放專用預留。");
  if (p.closure) {
    if (p.draft.length) fail("結案檔不能包含未成交草稿。");
    const c = closureFor(p, p.closure.counts, p.closure.notes);
    if (
      c.salesTotal !== p.closure.salesTotal ||
      c.refundTotal !== p.closure.refundTotal ||
      c.expensesTotal !== p.closure.expensesTotal ||
      !p.closure.id ||
      !Number.isFinite(Date.parse(p.closure.createdAt))
    )
      fail("結案報告與活動紀錄不一致。");
  }
  return p;
}
function assertSameHandoff(original: ActivityPacket, incoming: ActivityPacket) {
  original = validateActivityPacket(original);
  for (const k of [
    "handoffId",
    "sourceWorkspaceId",
    "sourceRevision",
    "eventId",
    "name",
    "createdAt",
    "locationId",
    "sources",
    "baseline",
    "financialReferences",
  ] as const)
    if (!equal(original[k], incoming[k]))
      fail("活動交接來源或原始快照與創作管理不一致。");
}
export function validateActivityParentState(s: CatalogSnapshot) {
  if (!Array.isArray(s.activityHandoffs) || !Array.isArray(s.activityMerges))
    fail("活動交接清單格式不正確。");
  const ids = new Set<string>();
  for (const h of s.activityHandoffs) {
    if (
      !h.id ||
      ids.has(h.id) ||
      !s.events.some((e) => e.id === h.eventId) ||
      !s.locations.some((l) => l.id === h.locationId)
    )
      fail("活動交接來源不正確。");
    ids.add(h.id);
    if (
      !Array.isArray(h.costVersionIds) ||
      new Set(h.costVersionIds).size !== h.costVersionIds.length ||
      h.costVersionIds.some(
        (id) => !s.batchCostVersions.some((v) => v.id === id),
      )
    )
      fail("活動成本版本來源不正確。");
    const p = validateActivityPacket(h.packet);
    if (
      p.handoffId !== h.id ||
      p.sourceWorkspaceId !== s.workspaceId ||
      p.eventId !== h.eventId ||
      p.locationId !== h.locationId ||
      p.closure ||
      p.snapshot.sales.length ||
      p.additions.length ||
      p.revision
    )
      fail("活動交接基準不正確。");
    for (const u of p.baseline.physicalUnits) {
      const original = s.physicalUnits.find((a) => a.id === u.id),
        source = p.sources.find((a) => a.packetReceiptId === u.batchId);
      if (
        !original ||
        !source ||
        original.productId !== u.productId ||
        original.batchId !== source.parentBatchId ||
        original.label !== u.label
      )
        fail("交付單件實物與原創作資料不一致。");
    }
    if (h.localPacket)
      assertSameHandoff(p, validateActivityPacket(h.localPacket));
  }
  const merges = new Set<string>();
  for (const m of s.activityMerges) {
    if (
      !m.id ||
      merges.has(m.handoffId) ||
      !ids.has(m.handoffId) ||
      !m.closureId ||
      typeof m.packetContent !== "string" ||
      !Array.isArray(m.createdMovementIds)
    )
      fail("活動合回紀錄不正確。");
    merges.add(m.handoffId);
    const p = validateActivityPacket(JSON.parse(m.packetContent));
    if (p.handoffId !== m.handoffId || p.closure?.id !== m.closureId)
      fail("活動合回來源不一致。");
    assertSameHandoff(
      s.activityHandoffs.find((h) => h.id === m.handoffId)!.packet,
      p,
    );
    validateMergedRecords(s, p, m);
  }
}
function mergeContext(s: CatalogSnapshot, input: ActivityPacket) {
  const p = validateActivityPacket(input);
  if (!p.closure) fail("活動尚未結案，不可合回創作管理。");
  if (p.sourceWorkspaceId !== s.workspaceId)
    fail("結案檔不是來自此創作工作區。");
  const h = s.activityHandoffs.find((h) => h.id === p.handoffId);
  if (!h) fail("找不到原始交接份，不能只靠名稱合回。");
  assertSameHandoff(h.packet, p);
  const merged = s.activityMerges.find((m) => m.handoffId === p.handoffId);
  if (merged) {
    if (
      merged.closureId !== p.closure.id ||
      !equal(validateActivityPacket(JSON.parse(merged.packetContent)), p)
    )
      fail("同一交接份已有不同結案內容，不能覆蓋已合回紀錄。");
    return { p, h, merged };
  }
  const ids = new Set(p.sources.map((r) => r.parentTransferId)),
    actual = s.movements.filter(
      (m) =>
        m.fromLocationId === h.locationId || m.toLocationId === h.locationId,
    );
  if (
    actual.length !== ids.size ||
    actual.some(
      (m) =>
        !ids.has(m.id) ||
        m.kind !== "transfer" ||
        m.toLocationId !== h.locationId,
    )
  )
    fail("交接庫位在合回前已有其他異動，請先核對衝突。");
  for (const id of ids) {
    const m = actual.find((r) => r.id === id),
      rows = p.sources.filter((r) => r.parentTransferId === id);
    if (
      !m ||
      m.productId !== rows[0]?.productId ||
      !equal(
        m.batchAllocations,
        rows.map((r) => ({ batchId: r.parentBatchId, quantity: r.quantity })),
      )
    )
      fail("原始交付批次已變更，不能自動合回。");
  }
  return { p, h, merged: null };
}
export function previewActivityMerge(
  s: CatalogSnapshot,
  input: ActivityPacket,
) {
  const { p, merged } = mergeContext(s, input);
  return {
    handoffId: p.handoffId,
    name: p.name,
    eventId: p.eventId,
    alreadyMerged: !!merged,
    sales: p.snapshot.sales.length,
    refunds: p.snapshot.refunds.length,
    movements: p.snapshot.movements.length - p.baseline.movements.length,
    expenses: p.cashEntries.filter((r) => r.kind === "expense").length,
    cashEntries: p.cashEntries.length,
    newProducts: p.additions.map((a) => ({
      productId: a.productId,
      name: p.snapshot.products.find((r) => r.id === a.productId)!.name,
      quantity: a.quantity,
    })),
    counts: clone(p.closure!.counts),
    pendingDiscrepancies: p.closure!.counts.filter(
      (c) => c.actual !== c.expected,
    ).length,
    salesTotal: p.closure!.salesTotal,
    refundTotal: p.closure!.refundTotal,
    remaining: sum(p.closure!.counts.map((c) => c.expected)),
  };
}
function importedMovements(
  p: ActivityPacket,
  mappings: Record<string, string>,
  workspaceId: string,
) {
  const lots = new Map(
    p.sources.map((r) => [r.packetReceiptId, r.parentBatchId]),
  );
  return p.snapshot.movements.slice(p.baseline.movements.length).map((m) => ({
    ...clone(m),
    workspaceId,
    productId: mappings[m.productId] || m.productId,
    batchAllocations: m.batchAllocations.map((a) => ({
      batchId: lots.get(a.batchId) || a.batchId,
      quantity: a.quantity,
    })),
  }));
}
function refreshCode<T extends NamedRecord>(s: CatalogSnapshot, row: T): T {
  const prefix = /^([A-Z]+)-/.exec(row.code)?.[1] || "IMP";
  return { ...row, ...record(s, prefix, row.name), id: row.id };
}
export function mergeActivityPacket(
  s: CatalogSnapshot,
  input: ActivityPacket,
  mappings: Record<string, string>,
): ActivityMergeRecord {
  const context = mergeContext(s, input);
  if (context.merged) return context.merged;
  const p = context.p,
    next = clone(s),
    map: Record<string, string> = {};
  for (const a of p.additions) {
    if (!Object.hasOwn(mappings, a.productId))
      fail("請逐項確認活動新增商品的對應，空值表示建立新商品。");
    const target = mappings[a.productId];
    if (target) {
      if (!next.products.some((r) => r.id === target))
        fail("對應的既有商品不存在。");
      map[a.productId] = target;
    } else {
      if (next.products.some((r) => r.id === a.productId))
        fail("新增商品ID已存在，請明確選擇對應商品。");
      const row = p.snapshot.products.find((r) => r.id === a.productId)!;
      next.products.push(
        refreshCode(next, { ...clone(row), workspaceId: next.workspaceId }),
      );
      map[a.productId] = row.id;
    }
  }
  if (
    Object.keys(mappings).some(
      (id) => !p.additions.some((a) => a.productId === id),
    )
  )
    fail("商品對應包含非活動新增商品。");
  const existing = new Set<string>();
  for (const k of arrayKeys)
    for (const r of (next as any)[k] || []) if (r.id) existing.add(r.id);
  const planMap = new Map<string, string>();
  for (const row of p.snapshot.salePlans) {
    const plan = {
      ...clone(row),
      ...record(next, "PLN", row.name),
      productIds: [...new Set(row.productIds.map((id) => map[id] || id))],
    };
    planMap.set(row.id, plan.id);
    next.salePlans.push(plan);
  }
  const reservationOffset = next.movements.length - p.baseline.movements.length;
  for (const row of p.snapshot.inventoryReservations) {
    if (existing.has(row.id)) fail("活動預留ID與既有資料衝突。");
    existing.add(row.id);
    next.inventoryReservations.push(
      refreshCode(next, {
        ...clone(row),
        workspaceId: next.workspaceId,
        planId: planMap.get(row.planId)!,
        productId: map[row.productId] || row.productId,
        createdMovementCount: row.createdMovementCount + reservationOffset,
        releasedMovementCount:
          row.releasedMovementCount === null
            ? null
            : row.releasedMovementCount + reservationOffset,
      }),
    );
  }
  const movements = importedMovements(p, map, next.workspaceId);
  for (const row of movements) {
    if (existing.has(row.id)) fail("活動異動ID與既有資料衝突，不能重複記帳。");
    existing.add(row.id);
    next.movements.push(refreshCode(next, row));
  }
  for (const row of p.snapshot.sales) {
    if (
      existing.has(row.id) ||
      next.sales.some((r) => r.operationId === row.operationId)
    )
      fail("交易識別或操作識別已存在，請先核對。");
    existing.add(row.id);
    next.sales.push(
      refreshCode(next, {
        ...clone(row),
        workspaceId: next.workspaceId,
        lines: row.lines.map((l) => ({
          ...clone(l),
          productId: map[l.productId] || l.productId,
          ...(l.planId ? { planId: planMap.get(l.planId)! } : {}),
        })),
      }),
    );
  }
  for (const row of p.snapshot.refunds) {
    if (
      existing.has(row.id) ||
      next.refunds.some((r) => r.operationId === row.operationId)
    )
      fail("退款識別或操作識別已存在，請先核對。");
    existing.add(row.id);
    next.refunds.push(
      refreshCode(next, { ...clone(row), workspaceId: next.workspaceId }),
    );
  }
  for (const row of p.snapshot.exchanges) {
    if (
      existing.has(row.id) ||
      next.exchanges.some((e) => e.operationId === row.operationId)
    )
      fail("換購識別或操作已存在，不能重複合回。");
    existing.add(row.id);
    next.exchanges.push(
      refreshCode(
        next,
        mappedExchange(row, map, Object.fromEntries(planMap), next.workspaceId),
      ),
    );
  }
  const rec: ActivityMergeRecord = {
    id: crypto.randomUUID(),
    handoffId: p.handoffId,
    closureId: p.closure!.id,
    packetContent: JSON.stringify(p),
    mergedAt: now(),
    productMappings: map,
    planMappings: Object.fromEntries(planMap),
    createdMovementIds: movements.map((m) => m.id),
    ...(p.snapshot.inventoryReservations.length
      ? { reservationMovementOffset: reservationOffset }
      : {}),
    returnedAt: "",
  };
  next.activityMerges.push(rec);
  next.activityHandoffs.find((h) => h.id === p.handoffId)!.localPacket =
    clone(p);
  validateRestoreSnapshot(next);
  Object.assign(s, next);
  return rec;
}
function mappedExchange(
  row: ExchangeRecord,
  products: Record<string, string>,
  plans: Record<string, string>,
  workspaceId: string,
): ExchangeRecord {
  return {
    ...clone(row),
    workspaceId,
    request: {
      ...clone(row.request),
      replacement: {
        ...clone(row.request.replacement),
        lines: row.request.replacement.lines.map((l) => ({
          ...clone(l),
          productId: products[l.productId] || l.productId,
          ...(l.planId ? { planId: plans[l.planId]! } : {}),
        })),
      },
    },
  };
}
function validateMergedRecords(
  s: CatalogSnapshot,
  p: ActivityPacket,
  m: ActivityMergeRecord,
) {
  const ids = p.additions.map((a) => a.productId);
  if (
    Object.keys(m.productMappings).length !== ids.length ||
    ids.some(
      (id) =>
        typeof m.productMappings[id] !== "string" ||
        !s.products.some((r) => r.id === m.productMappings[id]),
    )
  )
    fail("合回商品對應不正確。");
  if (
    !m.planMappings ||
    Object.keys(m.planMappings).length !== p.snapshot.salePlans.length ||
    p.snapshot.salePlans.some(
      (r) =>
        !m.planMappings[r.id] ||
        !s.salePlans.some((a) => a.id === m.planMappings[r.id]),
    )
  )
    fail("合回方案對應不正確。");
  const expected = importedMovements(p, m.productMappings, s.workspaceId);
  const reservationOffset = m.reservationMovementOffset;
  if (
    p.snapshot.inventoryReservations.length &&
    (!Number.isSafeInteger(reservationOffset) || reservationOffset! < 0)
  )
    fail("合回預留位置不正確。");
  if (
    p.snapshot.inventoryReservations.length &&
    expected.length &&
    reservationOffset !==
      s.movements.findIndex((r) => r.id === expected[0]!.id) -
        p.baseline.movements.length
  )
    fail("合回預留位置與異動不符。");
  for (const source of p.snapshot.inventoryReservations) {
    const actual = s.inventoryReservations.find((r) => r.id === source.id);
    const row = {
      ...clone(source),
      workspaceId: s.workspaceId,
      planId: m.planMappings[source.planId]!,
      productId: m.productMappings[source.productId] || source.productId,
      createdMovementCount: source.createdMovementCount + reservationOffset!,
      releasedMovementCount:
        source.releasedMovementCount === null
          ? null
          : source.releasedMovementCount + reservationOffset!,
    };
    if (!actual || !equal({ ...actual, code: "" }, { ...row, code: "" }))
      fail("合回預留紀錄與活動來源不符。");
  }
  if (
    !equal(
      m.createdMovementIds,
      expected.map((r) => r.id),
    )
  )
    fail("合回異動清單與活動來源不一致。");
  const noCode = (r: unknown) => {
    const v = clone(r) as any;
    delete v.code;
    return v;
  };
  for (const row of expected) {
    const actual = s.movements.find((r) => r.id === row.id);
    if (!actual || !equal(noCode(actual), noCode(row)))
      fail("合回批次或數量與原活動異動不符。");
  }
  for (const sale of p.snapshot.sales) {
    const actual = s.sales.find((r) => r.id === sale.id);
    if (!actual) fail("合回交易缺漏。");
    const expectedSale = {
      ...clone(sale),
      workspaceId: s.workspaceId,
      lines: sale.lines.map((line, i) => {
        const out = {
          ...clone(line),
          productId: m.productMappings[line.productId] || line.productId,
        };
        if (line.planId) {
          const target = m.planMappings[line.planId];
          if (
            !target ||
            !s.salePlans.some((r) => r.id === target) ||
            actual.lines[i]?.planId !== target
          )
            fail("合回販售方案來源不符。");
          out.planId = target;
        }
        return out;
      }),
    };
    if (!equal(noCode(actual), noCode(expectedSale)))
      fail("合回交易與活動來源不符。");
  }
  for (const refund of p.snapshot.refunds) {
    const actual = s.refunds.find((r) => r.id === refund.id);
    if (
      !actual ||
      !equal(
        noCode(actual),
        noCode({ ...clone(refund), workspaceId: s.workspaceId }),
      )
    )
      fail("合回退款與活動來源不符。");
  }
  for (const exchange of p.snapshot.exchanges) {
    const actual = s.exchanges.find((r) => r.id === exchange.id);
    const expected = mappedExchange(
      exchange,
      m.productMappings,
      m.planMappings,
      s.workspaceId,
    );
    if (!actual || !equal(noCode(actual), noCode(expected)))
      fail("合回換購與原活動來源不符。");
  }
}
export function returnActivityStock(
  s: CatalogSnapshot,
  handoffId: string,
  toLocationId: string,
  reason: string,
) {
  const h = s.activityHandoffs.find((h) => h.id === handoffId),
    m = s.activityMerges.find((m) => m.handoffId === handoffId);
  if (!h || !m) fail("活動尚未合回，不能確認實物退回。");
  if (m.returnedAt) fail("此交接份已完成實物退回。");
  if (
    toLocationId === h.locationId ||
    !s.locations.some((l) => l.id === toLocationId) ||
    s.activityHandoffs.some((r) => r.locationId === toLocationId)
  )
    fail("請選擇一般退回庫位。");
  text(reason, "實物退回說明", 2000);
  const p = validateActivityPacket(JSON.parse(m.packetContent)),
    quantities = new Map<string, number>();
  for (const c of p.closure!.counts) {
    const id = m.productMappings[c.productId] || c.productId;
    quantities.set(id, (quantities.get(id) || 0) + c.actual);
  }
  for (const [id, q] of quantities)
    if (balance(s, id, h.locationId) !== q)
      fail("實點與交接庫位帳面不同，請先在創作管理明確處理盤差，再確認退回。");
  const next = clone(s),
    created: string[] = [];
  for (const [id, q] of quantities)
    if (q) {
      const product = next.products.find((r) => r.id === id)!,
        archived = product.archived;
      product.archived = false;
      try {
        const units = unitStates(next).filter(
          (u) =>
            u.productId === id &&
            u.locationId === h.locationId &&
            u.state === "available",
        );
        const confirmed = p
          .closure!.counts.filter(
            (c) => (m.productMappings[c.productId] || c.productId) === id,
          )
          .flatMap((c) => c.unitIds || []);
        if (
          units.length !== confirmed.length ||
          units.some((u) => !confirmed.includes(u.id))
        )
          fail("單件實物與結案實點不同，請先在創作管理明確處理差異。");
        if (units.length)
          created.push(
            addMovement(next, {
              productId: id,
              kind: "transfer",
              quantity: units.length,
              unitIds: units.map((u) => u.id),
              fromLocationId: h.locationId,
              toLocationId,
              reason,
            }).id,
          );
        if (q > units.length)
          created.push(
            addMovement(next, {
              productId: id,
              kind: "transfer",
              quantity: q - units.length,
              fromLocationId: h.locationId,
              toLocationId,
              reason,
            }).id,
          );
      } finally {
        product.archived = archived;
      }
    }
  next.activityMerges.find((r) => r.id === m.id)!.returnedAt = now();
  Object.assign(s, next);
  return created;
}
