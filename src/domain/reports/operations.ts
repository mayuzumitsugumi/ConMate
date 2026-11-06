import type { CatalogSnapshot, ExactFraction } from "../models/catalog";
import { batchCostReport } from "../finance/batch-costs";
import { fractionDecimal } from "../finance/operations";
import { unitStates } from "../inventory/units";
export type ReportGroupBy = "event" | "creator" | "project" | "product";
export interface ReportFilters {
  fromDate?: string;
  toDate?: string;
  eventId?: string;
  creatorId?: string;
  projectId?: string;
  productId?: string;
  groupBy: ReportGroupBy;
}
export interface ReportOption {
  id: string;
  label: string;
}
export interface ReportMetrics {
  soldQuantity: string;
  restockQuantity: string;
  damagedQuantity: string;
  retainedQuantity: string;
  gross: string;
  refunded: string;
  netRevenue: string;
  netKnownCost: string;
  unknownCostQuantity: string;
  damagedKnownCost: string;
  damagedUnknownCostQuantity: string;
  revenueLessCost: string | null;
}
export interface ReportLine extends ReportMetrics {
  id: string;
  saleId: string;
  saleCode: string;
  saleAt: string;
  eventId: string;
  eventName: string;
  creatorId: string;
  creatorName: string;
  projectId: string;
  projectName: string;
  productId: string;
  productName: string;
  mode: "direct" | "draw";
  planName: string;
}
export interface ReportStock {
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  quantity: string;
  reserved: string;
  available: string;
  markedUnits: string;
}
export interface OperationalReport {
  workspaceId: string;
  workspaceName: string;
  sourceRevision: number;
  generatedAt: string;
  filters: ReportFilters;
  definitions: string[];
  warnings: string[];
  choices: {
    events: ReportOption[];
    creators: ReportOption[];
    projects: ReportOption[];
    products: ReportOption[];
  };
  totals: ReportMetrics;
  groups: (ReportMetrics & { id: string; name: string })[];
  lines: ReportLine[];
  currentStock: ReportStock[];
}
export interface CashFlowFilters {
  fromDate?: string;
  toDate?: string;
  eventId?: string;
}
export interface CashFlowEntry {
  id: string;
  kind: "sale" | "exchange" | "refund" | "cancel";
  at: string;
  eventId: string;
  eventName: string;
  saleId: string;
  saleCode: string;
  collectorId: string;
  partyName: string;
  amount: string;
  description: string;
}
export interface CashFlowReport {
  workspaceId: string;
  workspaceName: string;
  sourceRevision: number;
  generatedAt: string;
  filters: CashFlowFilters;
  definitions: string[];
  warnings: string[];
  receipts: string;
  payouts: string;
  net: string;
  unknownPayerCount: number;
  entries: CashFlowEntry[];
}

function reject(message: string): never {
  throw new Error(message);
}
type Fraction = { n: bigint; d: bigint };
function rational(n: bigint, d = 1n): Fraction {
  if (d <= 0n) reject("成本分母不正確。");
  let a = n < 0n ? -n : n,
    b = d;
  while (b) [a, b] = [b, a % b];
  const g = a || 1n;
  return { n: n / g, d: d / g };
}
const plus = (a: Fraction, b: Fraction) =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d);
const exact = (v: ExactFraction) =>
  rational(BigInt(v.numerator), BigInt(v.denominator));
const decimal = (v: Fraction) => fractionDecimal(v.n, v.d);
function date(value: string | undefined) {
  if (!value) return;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    reject("報表日期需為有效的 YYYY-MM-DD。");
}
function checkFilters(f: CashFlowFilters) {
  date(f.fromDate);
  date(f.toDate);
  if (f.fromDate && f.toDate && f.fromDate > f.toDate)
    reject("報表開始日期不能晚於結束日期。");
}
const taipei = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function taipeiReportDate(at: string) {
  const value = new Date(at);
  if (!Number.isFinite(value.getTime())) reject("紀錄時間格式不正確。");
  const p = taipei.formatToParts(value);
  return ["year", "month", "day"]
    .map((k) => p.find((v) => v.type === k)!.value)
    .join("-");
}
function inWindow(at: string, f: CashFlowFilters) {
  const day = taipeiReportDate(at);
  return (!f.fromDate || day >= f.fromDate) && (!f.toDate || day <= f.toDate);
}
function matches(actual: string, chosen?: string) {
  return chosen === undefined || chosen === actual;
}
function reportAt(at: string) {
  if (!Number.isFinite(Date.parse(at))) reject("報表產生時間不正確。");
  return at;
}
function optionRows(
  rows: { id: string; name: string; archived?: boolean }[],
  unknown: string,
): ReportOption[] {
  return [
    { id: "", label: unknown },
    ...rows.map((r) => ({
      id: r.id,
      label: r.name + (r.archived ? "（已封存）" : ""),
    })),
  ];
}
interface Sum {
  sold: bigint;
  restock: bigint;
  damage: bigint;
  gross: bigint;
  refunded: bigint;
  unknown: bigint;
  damageUnknown: bigint;
  cost: Fraction;
  damageCost: Fraction;
}
const zero = (): Sum => ({
  sold: 0n,
  restock: 0n,
  damage: 0n,
  gross: 0n,
  refunded: 0n,
  unknown: 0n,
  damageUnknown: 0n,
  cost: rational(0n),
  damageCost: rational(0n),
});
function sumInto(target: Sum, a: Sum) {
  target.sold += a.sold;
  target.restock += a.restock;
  target.damage += a.damage;
  target.gross += a.gross;
  target.refunded += a.refunded;
  target.unknown += a.unknown;
  target.damageUnknown += a.damageUnknown;
  target.cost = plus(target.cost, a.cost);
  target.damageCost = plus(target.damageCost, a.damageCost);
}
function metrics(a: Sum): ReportMetrics {
  const revenue = a.gross - a.refunded;
  return {
    soldQuantity: a.sold.toString(),
    restockQuantity: a.restock.toString(),
    damagedQuantity: a.damage.toString(),
    retainedQuantity: (a.sold - a.restock - a.damage).toString(),
    gross: a.gross.toString(),
    refunded: a.refunded.toString(),
    netRevenue: revenue.toString(),
    netKnownCost: decimal(a.cost),
    unknownCostQuantity: a.unknown.toString(),
    damagedKnownCost: decimal(a.damageCost),
    damagedUnknownCostQuantity: a.damageUnknown.toString(),
    revenueLessCost: a.unknown
      ? null
      : decimal(plus(rational(revenue), rational(-a.cost.n, a.cost.d))),
  };
}
export function queryOperationalReport(
  s: CatalogSnapshot,
  filters: ReportFilters,
  generatedAt = new Date().toISOString(),
): OperationalReport {
  checkFilters(filters);
  reportAt(generatedAt);
  if (!["event", "creator", "project", "product"].includes(filters.groupBy))
    reject("報表分組不正確。");
  const products = new Map(s.products.map((p) => [p.id, p]));
  const events = new Map(s.events.map((e) => [e.id, e.name]));
  const projects = new Map(s.projects.map((p) => [p.id, p.name]));
  const creators = new Map(s.parties.map((p) => [p.id, p]));
  const historicCreators = new Map<string, string>();
  for (const sale of s.sales)
    for (const line of sale.lines)
      if (line.attribution?.creatorId)
        historicCreators.set(
          line.attribution.creatorId,
          line.attribution.creatorName || "未記錄名稱",
        );
  const creatorChoices = optionRows(s.parties, "未記錄創作者");
  for (const [id, label] of historicCreators)
    if (!creators.has(id)) creatorChoices.push({ id, label });
  const costs = new Map(batchCostReport(s).sales.map((c) => [c.lineId, c]));
  const total = zero(),
    grouped = new Map<string, { name: string; sum: Sum }>(),
    lines: ReportLine[] = [];
  let oldAttribution = false;
  for (const sale of s.sales) {
    if (
      !matches(sale.eventId, filters.eventId) ||
      !inWindow(sale.createdAt, filters)
    )
      continue;
    for (const line of sale.lines) {
      const p = products.get(line.productId),
        creatorId = line.attribution?.creatorId || "",
        projectId = p?.projectId || "";
      if (
        !matches(line.productId, filters.productId) ||
        !matches(creatorId, filters.creatorId) ||
        !matches(projectId, filters.projectId)
      )
        continue;
      const c = costs.get(line.id);
      if (!c) reject("找不到銷售成本核對來源。");
      const creatorName =
        line.attribution?.creatorName ||
        (creatorId ? "未記錄名稱" : "未記錄創作者");
      oldAttribution ||= !line.attribution;
      const a: Sum = {
        sold: BigInt(c.soldQuantity),
        restock: BigInt(c.returnedQuantity),
        damage: BigInt(c.damagedQuantity),
        gross: BigInt(c.gross),
        refunded: BigInt(c.refunded),
        unknown: BigInt(c.unknownQuantity),
        damageUnknown: BigInt(c.damagedUnknownQuantity),
        cost: exact(c.netKnownCostExact),
        damageCost: exact(c.damagedKnownCostExact),
      };
      sumInto(total, a);
      const eventName = events.get(sale.eventId) || "未指定活動",
        projectName = projects.get(projectId) || "未指定目前企劃";
      const ids = {
        event: sale.eventId,
        creator: creatorId,
        project: projectId,
        product: line.productId,
      };
      const names = {
        event: eventName,
        creator: creatorName,
        project: projectName,
        product: line.productName,
      };
      const key = ids[filters.groupBy];
      if (!grouped.has(key))
        grouped.set(key, { name: names[filters.groupBy], sum: zero() });
      sumInto(grouped.get(key)!.sum, a);
      lines.push({
        ...metrics(a),
        id: line.id,
        saleId: sale.id,
        saleCode: sale.code,
        saleAt: sale.createdAt,
        eventId: sale.eventId,
        eventName,
        creatorId,
        creatorName,
        projectId,
        projectName,
        productId: line.productId,
        productName: line.productName,
        mode: line.mode,
        planName: line.planName || "手動售價",
      });
    }
  }
  const tracked = new Map<string, number>();
  for (const u of unitStates(s))
    if (u.state === "available") {
      const key = JSON.stringify([u.productId, u.locationId]);
      tracked.set(key, (tracked.get(key) || 0) + 1);
    }
  // Build current quantities once; avoid scanning the whole ledger for each SKU/location.
  const quantities = new Map<string, bigint>(),
    reserved = new Map<string, bigint>();
  const active = new Map(
    s.inventoryReservations.filter((r) => !r.releasedAt).map((r) => [r.id, r]),
  );
  const remaining = new Map(
    [...active].map(([id, r]) => [id, BigInt(r.quantity)]),
  );
  const key = (productId: string, locationId: string) =>
    JSON.stringify([productId, locationId]);
  for (const m of s.movements) {
    for (const [locationId, sign] of [
      [m.toLocationId, 1n],
      [m.fromLocationId, -1n],
    ] as const)
      if (locationId) {
        const k = key(m.productId, locationId);
        quantities.set(
          k,
          (quantities.get(k) || 0n) + sign * BigInt(m.quantity),
        );
      }
    const r = m.reservationId ? active.get(m.reservationId) : undefined;
    if (r)
      remaining.set(
        r.id,
        remaining.get(r.id)! +
          (m.toLocationId === r.locationId ? BigInt(m.quantity) : 0n) -
          (m.fromLocationId === r.locationId ? BigInt(m.quantity) : 0n),
      );
  }
  for (const [id, r] of active) {
    const k = key(r.productId, r.locationId);
    reserved.set(k, (reserved.get(k) || 0n) + remaining.get(id)!);
  }
  const currentStock: ReportStock[] = [];
  for (const p of s.products) {
    if (
      !matches(p.id, filters.productId) ||
      !matches(p.creatorId, filters.creatorId) ||
      !matches(p.projectId, filters.projectId)
    )
      continue;
    for (const l of s.locations) {
      const k = key(p.id, l.id),
        quantity = quantities.get(k) || 0n,
        reserve = reserved.get(k) || 0n;
      if (!quantity && !reserve) continue;
      currentStock.push({
        productId: p.id,
        productName: p.name,
        locationId: l.id,
        locationName: l.name,
        quantity: quantity.toString(),
        reserved: reserve.toString(),
        available: (quantity - reserve).toString(),
        markedUnits: String(tracked.get(k) || 0),
      });
    }
  }
  const warnings = [
    "銷售依成交日期選取，退款、折抵及取消包含本次資料快照中全部關聯紀錄，可能發生在日期範圍之外。",
    "企劃依商品目前歸屬分組；目前沒有成交時企劃快照，不代表歷史企劃歸屬。",
    "目前庫存依商品目前創作者／企劃篩選；不受成交日期或活動篩選限制，也不是歷史期末庫存。",
    "營收減未回庫成本僅供營運核對，不是可分配利潤；不包含活動費用、代墊、內部回收或分款。",
  ];
  if (oldAttribution)
    warnings.push(
      "部分舊交易未保存創作者快照，已列為未記錄，不以目前商品設定回填。",
    );
  if (total.unknown)
    warnings.push(
      "選取的銷售存在成本未知數量；已知成本只列小計，完整營收成本差額尚無法計算。",
    );
  return {
    workspaceId: s.workspaceId,
    workspaceName: s.workspace.name,
    sourceRevision: s.revision,
    generatedAt,
    filters: { ...filters },
    definitions: [
      "原成交額包含後來取消的交易；退款／折抵另列，退款後營收＝原成交額－退款／折抵。",
      "留在顧客處數量＝原交付數－可售退回數－損壞退回數；金額退款不必然有實物退回。",
      "可售退貨沿用原成本反向核對；損壞退回成本另列，仍包含於未回可售庫存成本。",
      "精確分數先加總再顯示四位小數；各列顯示尾數不一定直接相加等於總計。",
      "這是目前工作區已保存資料的唯讀查詢；寄賣店確認回報列入營收，但店家收款不等於創作者已收匯款；尚未合回的活動檔不會重複計入。",
    ],
    warnings,
    choices: {
      events: optionRows(s.events, "未指定活動"),
      creators: creatorChoices,
      projects: optionRows(s.projects, "未指定目前企劃"),
      products: optionRows(s.products, "未指定商品"),
    },
    totals: metrics(total),
    groups: [...grouped]
      .map(([id, g]) => ({ id, name: g.name, ...metrics(g.sum) }))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, "zh-TW") || a.id.localeCompare(b.id),
      ),
    lines: lines.sort(
      (a, b) => a.saleAt.localeCompare(b.saleAt) || a.id.localeCompare(b.id),
    ),
    currentStock,
  };
}

export function queryCashFlow(
  s: CatalogSnapshot,
  filters: CashFlowFilters,
  generatedAt = new Date().toISOString(),
): CashFlowReport {
  checkFilters(filters);
  reportAt(generatedAt);
  const entries: CashFlowEntry[] = [];
  const eventName = (id: string) =>
    s.events.find((e) => e.id === id)?.name || "未指定活動";
  const partyName = (id: string) =>
    s.parties.find((p) => p.id === id)?.name || "未記錄收付款對象";
  const push = (entry: CashFlowEntry) => {
    if (matches(entry.eventId, filters.eventId) && inWindow(entry.at, filters))
      entries.push(entry);
  };
  for (const sale of s.sales) {
    if (sale.consignmentId || sale.preorderId) continue; // Retailer collection is not creator receipt.
    const amount = BigInt(sale.cashReceived) - BigInt(sale.change);
    push({
      id: "sale:" + sale.id,
      kind: sale.exchangeId ? "exchange" : "sale",
      at: sale.createdAt,
      eventId: sale.eventId,
      eventName: eventName(sale.eventId),
      saleId: sale.id,
      saleCode: sale.code,
      collectorId: sale.collectorId,
      partyName: partyName(sale.collectorId),
      amount: amount.toString(),
      description: sale.exchangeId
        ? "換購實際補收／退還差額（不另加折抵額）"
        : "成交實收扣找零",
    });
    if (sale.cancelledAt)
      push({
        id: "cancel:" + sale.id,
        kind: "cancel",
        at: sale.cancelledAt,
        eventId: sale.eventId,
        eventName: eventName(sale.eventId),
        saleId: sale.id,
        saleCode: sale.code,
        collectorId: "",
        partyName: "退款付款人未記錄",
        amount: (-BigInt(sale.total)).toString(),
        description: "整筆取消實際退款；付款人未由原收款者推定",
      });
  }
  for (const refund of s.refunds) {
    if (refund.exchangeId || !refund.total) continue;
    const sale = s.sales.find((r) => r.id === refund.saleId);
    if (!sale) reject("退款原交易不存在。");
    if (sale.consignmentId || sale.preorderId) continue;
    push({
      id: "refund:" + refund.id,
      kind: "refund",
      at: refund.createdAt,
      eventId: sale.eventId,
      eventName: eventName(sale.eventId),
      saleId: sale.id,
      saleCode: sale.code,
      collectorId: "",
      partyName: "退款付款人未記錄",
      amount: (-BigInt(refund.total)).toString(),
      description: "實際退款；換購折抵不列現金支出",
    });
  }
  if (!filters.eventId)
    for (const order of s.preorders)
      for (const payment of order.payments) {
        if (
          payment.kind === "receipt-reversal" ||
          order.payments.some((r) => r.reversesId === payment.id)
        )
          continue;
        const positive = payment.kind === "receipt";
        push({
          id: "preorder:" + payment.id,
          kind: positive ? "sale" : "refund",
          at: payment.occurredAt,
          eventId: "",
          eventName: "預售款項（尚未交付不認列銷售）",
          saleId: "",
          saleCode: order.code,
          collectorId: payment.partyId,
          partyName: partyName(payment.partyId),
          amount: (positive
            ? BigInt(payment.amount)
            : -BigInt(payment.amount)
          ).toString(),
          description:
            payment.kind === "receipt"
              ? "預售實收款（不另計交付成交現金）"
              : payment.kind === "refund"
                ? "預售實際退款"
                : "預售誤記收款沖銷（非實際支出）",
        });
      }
  let receipts = 0n,
    payouts = 0n;
  for (const e of entries) {
    const n = BigInt(e.amount);
    if (n >= 0n) receipts += n;
    else payouts -= n;
  }
  return {
    workspaceId: s.workspaceId,
    workspaceName: s.workspace.name,
    sourceRevision: s.revision,
    generatedAt,
    filters: { ...filters },
    definitions: [
      "依每筆成交、取消及退款發生時間篩選，日期採台灣時間；不是依原成交日期計算的銷售群組。",
      "成交現金淨額＝收到金額－找零；換購只列真正補收／退還差額，不另加換購紀錄或把折抵當現金退款。",
      "預售另列實際收款與退款；交付及退貨折抵不再產生現金。誤記收款的原紀錄與沖銷均不列實際收退，明細仍保留於預售訂單供核對。選取特定活動時不包含無活動歸屬的預售款項。",
      "本表排除寄賣店回報的顧客收退；店家實際匯款另見寄賣核對。本表僅核對直接顧客銷售相關現金，不包含活動支出、交款、代墊或成員分款，不能當作實際持款餘額。",
      "創作者／企劃／商品篩選不套用本表；混合交易的現金不按商品比例分攤。",
    ],
    warnings: [
      "一般退款及整筆取消未記錄實際付款人，顯示未記錄，不推定由原收款者支付。",
      "本表依目前工作區已保存紀錄查詢，不代表銀行或實際現金盤點結果。",
    ],
    receipts: receipts.toString(),
    payouts: payouts.toString(),
    net: (receipts - payouts).toString(),
    unknownPayerCount: entries.filter(
      (e) => BigInt(e.amount) < 0n && !e.collectorId,
    ).length,
    entries: entries.sort(
      (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
    ),
  };
}
