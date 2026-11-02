import {
  calculateSettlement,
  parseSettlementPercent,
  settlementBalances,
} from "../finance/settlements";
import type {
  CatalogSnapshot,
  SettlementGroup,
  SettlementTrial,
} from "../models/catalog";
const bad = (message: string): never => {
  throw new Error(message);
};
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
    bad(`${label}格式不正確。`);
}
function obj(v: unknown): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    bad("分配資料必須是物件。");
  return v as Record<string, any>;
}
function array(v: unknown, max = 10000): asserts v is any[] {
  if (!Array.isArray(v) || v.length > max)
    bad("分配資料清單格式不正確或過大。");
}
function integer(v: unknown, positive = false) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || (positive && v <= 0))
    bad("分配金額必須是安全整數。");
}
function timestamp(v: unknown) {
  str(v, "時間", 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    bad("分配時間格式不正確。");
}
function fraction(v: unknown) {
  const a = obj(v);
  str(a.numerator, "精確金額分子", 2000, true);
  str(a.denominator, "精確金額分母", 2000, true);
  if (
    !/^-?(?:0|[1-9]\d*)$/.test(a.numerator) ||
    !/^[1-9]\d*$/.test(a.denominator)
  )
    bad("精確分配金額不正確。");
}
const overlapWarning =
  "來源也出現在其他工作單；各試算不是新增收入或再次扣成本，請自行核對重疊分配。";
export function validateSettlements(
  s: CatalogSnapshot,
  nestedId: (id: unknown) => void,
) {
  const party = (id: unknown) => {
    str(id, "參與方ID", 100, true);
    if (!s.parties.some((p) => p.id === id)) bad("分配參與方不存在。");
  };
  const lines = new Map(
    s.sales.flatMap((sale) =>
      sale.lines.map((line) => [line.id, { sale, line }] as const),
    ),
  );
  for (const rawGroup of s.settlements) {
    const g = obj(rawGroup) as unknown as SettlementGroup;
    str(g.notes, "分配工作單備註");
    timestamp(g.createdAt);
    str(g.closedAt, "結束時間", 40);
    str(g.closeReason, "結束說明");
    if (g.closedAt) {
      timestamp(g.closedAt);
      if (
        !g.closeReason.trim() ||
        Date.parse(g.closedAt) < Date.parse(g.createdAt)
      )
        bad("分配結束紀錄不正確。");
    } else if (g.closeReason) bad("未結束工作單不可有結束說明。");
    array(g.statusHistory, 10000);
    let wasClosed = false;
    let statusTime = Date.parse(g.createdAt);
    for (const rawStatus of g.statusHistory) {
      const event = obj(rawStatus);
      nestedId(event.id);
      timestamp(event.createdAt);
      str(event.reason, "狀態變更原因", 2000, true);
      if (
        (event.kind !== "close" && event.kind !== "reopen") ||
        (event.kind === "close" && wasClosed) ||
        (event.kind === "reopen" && !wasClosed)
      )
        bad("工作單狀態歷史不一致。");
      if (Date.parse(event.createdAt) < statusTime)
        bad("工作單狀態歷史時間逆序。");
      statusTime = Date.parse(event.createdAt);
      wasClosed = event.kind === "close";
    }
    const latestStatus = g.statusHistory.at(-1);
    if (
      wasClosed !== !!g.closedAt ||
      (g.closedAt &&
        (g.closedAt !== latestStatus?.createdAt ||
          g.closeReason !== latestStatus?.reason))
    )
      bad("工作單目前狀態與歷史不一致。");
    array(g.trials, 10000);
    array(g.decisions, 10000);
    array(g.payments, 100000);
    str(g.holdingsDeclaredAt, "持款登記時間", 40);
    if (g.openingHoldings !== null) {
      array(g.openingHoldings, 1000);
      if (!g.openingHoldings.length) bad("期初持款需有至少一位明確登記對象。");
      timestamp(g.holdingsDeclaredAt);
      const ids = new Set<string>();
      for (const raw of g.openingHoldings) {
        const h = obj(raw);
        party(h.partyId);
        integer(h.amount);
        if (ids.has(h.partyId)) bad("期初持款對象重複。");
        ids.add(h.partyId);
      }
    } else if (g.holdingsDeclaredAt) bad("沒有期初持款卻有登記時間。");
    const trialMap = new Map<string, SettlementTrial>();
    for (const rawTrial of g.trials) {
      const t = obj(rawTrial) as unknown as SettlementTrial;
      nestedId(t.id);
      timestamp(t.createdAt);
      const rules = obj(t.rules);
      str(rules.notes, "試算備註");
      str(rules.feePartyId, "管理費歸屬", 100);
      if (rules.feePartyId) party(rules.feePartyId);
      array(rules.saleLineIds);
      array(rules.costIds);
      array(rules.shares, 1000);
      for (const raw of rules.shares) {
        const h = obj(raw);
        party(h.partyId);
        str(h.percent, "分配比例", 20, true);
        parseSettlementPercent(h.percent);
      }
      array(t.saleSources);
      array(t.costSources);
      if (
        t.saleSources.length !== rules.saleLineIds.length ||
        t.costSources.length !== rules.costIds.length
      )
        bad("分配來源快照不完整。");
      for (let i = 0; i < t.saleSources.length; i++) {
        const a = obj(t.saleSources[i]),
          src = lines.get(a.saleLineId);
        if (
          !src ||
          a.saleLineId !== rules.saleLineIds[i] ||
          a.saleId !== src.sale.id ||
          a.productId !== src.line.productId ||
          a.eventId !== src.sale.eventId ||
          a.planId !== (src.line.planId || "") ||
          a.collectorId !== src.sale.collectorId
        )
          bad("分配銷售來源不一致。");
        str(a.productName, "來源商品名稱", 80, true);
        integer(a.gross);
        integer(a.refunded);
        integer(a.net);
        if (
          a.gross < 0 ||
          a.refunded < 0 ||
          a.refunded > a.gross ||
          BigInt(a.gross) !==
            BigInt(src!.line.quantity) * BigInt(src!.line.unitPrice) ||
          a.net !== a.gross - a.refunded
        )
          bad("分配來源金額不正確。");
      }
      for (let i = 0; i < t.costSources.length; i++) {
        const c = obj(t.costSources[i]);
        if (
          c.costId !== rules.costIds[i] ||
          !s.costs.some((x) => x.id === c.costId)
        )
          bad("分配成本來源不存在。");
        str(c.name, "來源成本名稱", 80, true);
        if (c.exactAmount !== null) {
          fraction(c.exactAmount);
          if (BigInt(c.exactAmount.numerator) < 0n) bad("來源成本不可為負數。");
        }
      }
      const calculated = calculateSettlement(
          t.rules,
          t.saleSources,
          t.costSources,
        ),
        actual = obj(t.result);
      array(actual.warnings);
      actual.warnings.forEach((w: unknown) => str(w, "試算警告"));
      const expectedWarnings = calculated.warnings;
      if (
        JSON.stringify(actual.warnings) !== JSON.stringify(expectedWarnings) &&
        JSON.stringify(actual.warnings) !==
          JSON.stringify([...expectedWarnings, overlapWarning])
      )
        bad("試算警告不一致。");
      const { warnings: _a, ...values } = actual,
        { warnings: _b, ...expected } = calculated;
      if (JSON.stringify(values) !== JSON.stringify(expected))
        bad("分潤試算結果與來源／規則不一致。");
      if (Date.parse(t.createdAt) < Date.parse(g.createdAt))
        bad("試算時間早於工作單。");
      trialMap.set(t.id, t);
    }
    for (const rawDecision of g.decisions) {
      const d = obj(rawDecision);
      nestedId(d.id);
      timestamp(d.createdAt);
      str(d.trialId, "人工決定試算來源", 100);
      const t = d.trialId ? trialMap.get(d.trialId) : undefined;
      if (d.trialId && !t) bad("人工決定試算來源不存在。");
      if (
        Date.parse(d.createdAt) < Date.parse(g.createdAt) ||
        (t && Date.parse(d.createdAt) < Date.parse(t.createdAt))
      )
        bad("人工決定時間不正確。");
      str(d.reason, "人工決定原因", 2000, true);
      array(d.allocations, 1000);
      const seen = new Set<string>();
      let total = 0n;
      for (const raw of d.allocations) {
        const a = obj(raw);
        party(a.partyId);
        integer(a.amount);
        if (seen.has(a.partyId)) bad("人工分配對象重複。");
        seen.add(a.partyId);
        total += BigInt(a.amount);
      }
      integer(d.total);
      if (total !== BigInt(d.total)) bad("人工分配總額不一致。");
      const variance =
        t?.result.roundedBase === null || !t
          ? null
          : BigInt(d.total) - BigInt(t.result.roundedBase);
      if (
        variance === null
          ? d.variance !== null
          : !Number.isSafeInteger(d.variance) || BigInt(d.variance) !== variance
      )
        bad("人工分配差額不一致。");
    }
    const paymentIds = new Map<string, (typeof g.payments)[number]>(),
      operations = new Set<string>(),
      reversed = new Set<string>();
    for (const rawPayment of g.payments) {
      const p = obj(rawPayment) as unknown as (typeof g.payments)[number];
      nestedId(p.id);
      timestamp(p.createdAt);
      str(p.operationId, "實際付款操作識別", 100, true);
      if (operations.has(p.operationId)) bad("實際分款操作識別重複。");
      operations.add(p.operationId);
      party(p.fromPartyId);
      party(p.toPartyId);
      if (p.fromPartyId === p.toPartyId) bad("實際分款雙方不可相同。");
      integer(p.amount, true);
      str(p.notes, "實際分款備註");
      str(p.reversesId, "沖銷付款來源", 100);
      if (p.reversesId) {
        const old = paymentIds.get(p.reversesId);
        if (
          !old ||
          old.reversesId ||
          reversed.has(old.id) ||
          p.amount !== old.amount ||
          p.fromPartyId !== old.toPartyId ||
          p.toPartyId !== old.fromPartyId ||
          !p.notes.trim() ||
          Date.parse(p.createdAt) < Date.parse(old.createdAt)
        )
          bad("實際分款沖銷不一致。");
        reversed.add(old!.id);
      }
      paymentIds.set(p.id, p);
    }
    if (
      g.holdingsDeclaredAt &&
      g.payments.some(
        (p) => Date.parse(p.createdAt) < Date.parse(g.holdingsDeclaredAt),
      )
    )
      bad("期初持款不可在實際分款後才登記。");
    array(g.cashAdjustments, 100000);
    const cashIds = new Map<string, (typeof g.cashAdjustments)[number]>(),
      cashOperations = new Set<string>(),
      cashReversed = new Set<string>();
    for (const raw of g.cashAdjustments) {
      const a = obj(raw) as unknown as (typeof g.cashAdjustments)[number];
      nestedId(a.id);
      timestamp(a.createdAt);
      party(a.partyId);
      integer(a.amount);
      if (!a.amount) bad("外部持款變動不可為零。");
      str(a.reason, "外部實際收付原因", 2000, true);
      str(a.operationId, "持款變動操作識別", 100, true);
      str(a.reversesId, "沖銷持款變動來源", 100);
      if (cashOperations.has(a.operationId)) bad("持款變動操作識別重複。");
      cashOperations.add(a.operationId);
      if (a.reversesId) {
        const old = cashIds.get(a.reversesId);
        if (
          !old ||
          old.reversesId ||
          cashReversed.has(old.id) ||
          a.partyId !== old.partyId ||
          a.amount !== -old.amount ||
          Date.parse(a.createdAt) < Date.parse(old.createdAt)
        )
          bad("持款變動沖銷不一致。");
        cashReversed.add(old!.id);
      }
      if (
        g.holdingsDeclaredAt &&
        Date.parse(a.createdAt) < Date.parse(g.holdingsDeclaredAt)
      )
        bad("期初持款不可在外部收付後才登記。");
      cashIds.set(a.id, a);
    }
    settlementBalances(s, g.id);
  }
}
