import { record, text } from "../catalog/operations";
import { whole } from "../money";
import { costSummary } from "./operations";
import { lineReturnSummary } from "../sales/refunds";
import type {
  CatalogSnapshot,
  ExactFraction,
  SettlementTrialInput,
  SettlementSaleSource,
  SettlementCostSource,
  SettlementResult,
  SettlementGroup,
  SettlementDecisionInput,
  SettlementPaymentInput,
  SettlementHolding,
  SettlementAllocation,
  SettlementCashInput,
  SettlementTrial,
} from "../models/catalog";
type F = { n: bigint; d: bigint };
const limit = BigInt(Number.MAX_SAFE_INTEGER);
function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}
function f(n: bigint, d = 1n): F {
  if (d <= 0n) throw new Error("分母必須大於零。");
  const g = gcd(n, d),
    v = { n: n / g, d: d / g };
  if (v.n.toString().length > 2000 || v.d.toString().length > 2000)
    throw new Error("分潤分數過於複雜。");
  return v;
}
const add = (a: F, b: F) => f(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: F, b: F) => add(a, f(-b.n, b.d));
const mul = (a: F, b: F) => f(a.n * b.n, a.d * b.d);
const encoded = (a: F): ExactFraction => ({
  numerator: a.n.toString(),
  denominator: a.d.toString(),
});
function decoded(a: ExactFraction): F {
  if (
    !a ||
    typeof a.numerator !== "string" ||
    typeof a.denominator !== "string" ||
    a.numerator.length > 2000 ||
    a.denominator.length > 2000 ||
    !/^-?(?:0|[1-9]\d*)$/.test(a.numerator) ||
    !/^[1-9]\d*$/.test(a.denominator)
  )
    throw new Error("精確金額格式不正確。");
  return f(BigInt(a.numerator), BigInt(a.denominator));
}
function signed(v: bigint): number {
  if (v < -limit || v > limit) throw new Error("金額超過安全範圍。");
  return Number(v);
}
function signedInput(v: number): number {
  if (!Number.isSafeInteger(v))
    throw new Error("分配與持款金額必須是有方向的安全整數。");
  return v;
}
function round(a: F): bigint {
  const n = a.n < 0n ? -a.n : a.n;
  const v = (n * 2n + a.d) / (a.d * 2n);
  return a.n < 0n ? -v : v;
}
export function parseSettlementPercent(v: string): bigint {
  if (typeof v !== "string" || !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/.test(v))
    throw new Error("比例需為0至100的數字，最多四位小數。");
  const [a, b = ""] = v.split("."),
    n = BigInt(a!) * 10000n + BigInt(b.padEnd(4, "0"));
  if (n > 1000000n) throw new Error("比例不可超過100%。");
  return n;
}
function allocateExact(
  values: Map<string, F>,
  total: F,
): SettlementAllocation[] {
  const parts = [...values].map(([partyId, a]) => {
    let floor = a.n / a.d;
    if (a.n < 0n && a.n % a.d) floor--;
    return { partyId, floor, remainder: f(a.n - floor * a.d, a.d) };
  });
  let left = round(total) - parts.reduce((n, p) => n + p.floor, 0n);
  parts.sort((a, b) => {
    const d = a.remainder.n * b.remainder.d - b.remainder.n * a.remainder.d;
    return d > 0n
      ? -1
      : d < 0n
        ? 1
        : a.partyId < b.partyId
          ? -1
          : a.partyId > b.partyId
            ? 1
            : 0;
  });
  if (left < 0n || left > BigInt(parts.length))
    throw new Error("分配總額無法核對。");
  for (const p of parts)
    if (left > 0n) {
      p.floor++;
      left--;
    }
  return parts
    .map((p) => ({ partyId: p.partyId, amount: signed(p.floor) }))
    .sort((a, b) =>
      a.partyId < b.partyId ? -1 : a.partyId > b.partyId ? 1 : 0,
    );
}
function unique(ids: string[], label: string) {
  if (
    !Array.isArray(ids) ||
    ids.length > 10000 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !id || id.length > 100)
  )
    throw new Error(`${label}不可重複或超過限制。`);
}
function party(s: CatalogSnapshot, id: string) {
  if (!s.parties.some((p) => p.id === id)) throw new Error("參與方不存在。");
}
function group(s: CatalogSnapshot, id: string) {
  const g = s.settlements.find((g) => g.id === id);
  if (!g) throw new Error("找不到分配工作單。");
  return g;
}
function open(g: SettlementGroup) {
  if (g.closedAt)
    throw new Error("工作單已結束；如需追加請先重新開啟，原紀錄仍保留。");
}
export function settlementSources(
  s: CatalogSnapshot,
  input: SettlementTrialInput,
) {
  unique(input.saleLineIds, "銷售來源");
  unique(input.costIds, "成本來源");
  const saleSources: SettlementSaleSource[] = input.saleLineIds.map((id) => {
    const sale = s.sales.find((sale) => sale.lines.some((l) => l.id === id)),
      line = sale?.lines.find((l) => l.id === id);
    if (!sale || !line) throw new Error("銷售明細來源不存在。");
    const gross = signed(BigInt(line.quantity) * BigInt(line.unitPrice)),
      refunded = sale.cancelledAt ? gross : lineReturnSummary(s, id).amount;
    return {
      saleId: sale.id,
      saleLineId: id,
      productId: line.productId,
      productName: line.productName,
      eventId: sale.eventId,
      planId: line.planId || "",
      collectorId: sale.collectorId,
      gross,
      refunded,
      net: gross - refunded,
    };
  });
  const costSources: SettlementCostSource[] = input.costIds.map((id) => {
    const c = s.costs.find((c) => c.id === id);
    if (!c) throw new Error("成本來源不存在。");
    const summary = costSummary(c);
    return {
      costId: c.id,
      name: c.name,
      exactAmount: summary?.exactTotal || null,
    };
  });
  return { saleSources, costSources };
}
export function settlementTrialChanged(
  s: CatalogSnapshot,
  trial: SettlementTrial,
) {
  try {
    const current = settlementSources(s, trial.rules);
    return (
      JSON.stringify(current.saleSources) !==
        JSON.stringify(trial.saleSources) ||
      JSON.stringify(current.costSources) !== JSON.stringify(trial.costSources)
    );
  } catch {
    return true;
  }
}
// Recalculates only immutable source snapshots, never mutable present-day sales/costs.
export function calculateSettlement(
  input: SettlementTrialInput,
  sales: SettlementSaleSource[],
  costs: SettlementCostSource[],
): SettlementResult {
  unique(input.saleLineIds, "銷售來源");
  unique(input.costIds, "成本來源");
  if (input.notes.length > 2000) throw new Error("試算備註最多2000字。");
  if (
    input.base !== null &&
    !["revenue", "revenue-minus-costs"].includes(input.base)
  )
    throw new Error("抽成基礎不正確。");
  if (
    input.fixedOrder !== null &&
    !["before-rate", "after-rate"].includes(input.fixedOrder)
  )
    throw new Error("固定費順序不正確。");
  if (
    input.negativePolicy !== null &&
    !["zero-fee", "signed", "manual"].includes(input.negativePolicy)
  )
    throw new Error("負基礎政策不正確。");
  const unknownItems: string[] = [],
    warnings: string[] = [
      "試算只使用明確選取的銷售明細與整批成本，不是自動認列的已售成本或實際持款。",
    ];
  const revenue = signed(sales.reduce((n, s) => n + BigInt(s.net), 0n));
  let exactCosts: F | null = f(0n);
  for (const c of costs) {
    if (c.exactAmount === null) {
      unknownItems.push(`成本未完整：${c.name}`);
      exactCosts = null;
    } else {
      const a = decoded(c.exactAmount);
      if (a.n < 0n) throw new Error("成本不可為負數。");
      if (exactCosts) exactCosts = add(exactCosts, a);
    }
  }
  if (!input.costIds.length)
    warnings.push("未選取成本，表示此次試算明確不扣成本；不代表商品成本為零。");
  if (sales.some((s) => !s.collectorId))
    warnings.push("部分原交易未指定收款者，不能由交易推算持款。");
  if (sales.some((s) => s.refunded > 0))
    warnings.push("退款未記錄實際付款人，不能由原收款者推算退款後持款。");
  if (input.base === null) unknownItems.push("尚未選擇抽成基礎");
  const rate =
    input.ratePercent === null
      ? null
      : parseSettlementPercent(input.ratePercent);
  if (rate === null) unknownItems.push("尚未填寫抽成比例（無抽成請明確填0）");
  if (input.fixedFee !== null) whole(input.fixedFee, "固定管理費");
  else unknownItems.push("尚未填寫固定費（無固定費請明確填0）");
  if (input.fixedOrder === null) unknownItems.push("尚未選擇固定費扣除順序");
  if (input.negativePolicy === null) unknownItems.push("尚未選擇負基礎政策");
  if (
    !Array.isArray(input.shares) ||
    input.shares.length > 1000 ||
    new Set(input.shares.map((s) => s.partyId)).size !== input.shares.length
  )
    throw new Error("分配比例對象重複或過多。");
  let shareTotal = 0n;
  for (const share of input.shares) {
    if (!share.partyId) throw new Error("請選擇分配對象。");
    shareTotal += parseSettlementPercent(share.percent);
  }
  if (!input.shares.length || shareTotal !== 1000000n)
    unknownItems.push("分配比例合計需明確設定為100%");
  if (!input.feePartyId)
    unknownItems.push("尚未選擇管理費／抽成歸屬（即使0元也需明確指定）");
  const available = exactCosts ? sub(f(BigInt(revenue)), exactCosts) : null;
  let base: F | null =
    input.base === null
      ? null
      : input.base === "revenue"
        ? f(BigInt(revenue))
        : available;
  if (base && input.fixedOrder === "before-rate" && input.fixedFee !== null)
    base = sub(base, f(BigInt(input.fixedFee)));
  if (base && base.n < 0n && input.negativePolicy === "manual")
    unknownItems.push("抽成基礎為負，依所選政策需人工決定");
  const result: SettlementResult = {
    status: "partial",
    unknownItems,
    warnings,
    revenue,
    exactCosts: exactCosts ? encoded(exactCosts) : null,
    exactAvailable: available ? encoded(available) : null,
    exactBase: base ? encoded(base) : null,
    exactFee: null,
    exactDistributable: null,
    roundedBase: available ? signed(round(available)) : null,
    allocations: [],
  };
  if (
    unknownItems.length ||
    !base ||
    !available ||
    rate === null ||
    input.fixedFee === null
  )
    return result;
  const rateBase =
    base.n < 0n && input.negativePolicy === "zero-fee" ? f(0n) : base;
  const fee = add(mul(rateBase, f(rate, 1000000n)), f(BigInt(input.fixedFee))),
    residual = sub(available, fee);
  const amounts = new Map<string, F>([[input.feePartyId, fee]]);
  for (const share of input.shares)
    amounts.set(
      share.partyId,
      add(
        amounts.get(share.partyId) || f(0n),
        mul(residual, f(parseSettlementPercent(share.percent), 1000000n)),
      ),
    );
  result.status = "complete";
  result.exactFee = encoded(fee);
  result.exactDistributable = encoded(residual);
  result.allocations = allocateExact(amounts, available);
  if (available.n < 0n)
    warnings.push(
      "本次來源扣除選取成本後為虧損；負分配保留為試算，不自動追收。",
    );
  return result;
}
export function createSettlement(
  s: CatalogSnapshot,
  name: string,
  notes: string,
) {
  if (notes.length > 2000) throw new Error("備註最多2000字。");
  const g: SettlementGroup = {
    ...record(s, "SET", text(name, "分配工作單名稱", 80)),
    notes: notes.trim(),
    statusHistory: [],
    cashAdjustments: [],
    createdAt: new Date().toISOString(),
    closedAt: "",
    closeReason: "",
    openingHoldings: null,
    holdingsDeclaredAt: "",
    trials: [],
    decisions: [],
    payments: [],
  };
  s.settlements.push(g);
  return g;
}
export function recordSettlementTrial(
  s: CatalogSnapshot,
  id: string,
  input: SettlementTrialInput,
) {
  const g = group(s, id);
  open(g);
  const sources = settlementSources(s, input);
  if (input.feePartyId) party(s, input.feePartyId);
  input.shares.forEach((p) => party(s, p.partyId));
  const result = calculateSettlement(
    input,
    sources.saleSources,
    sources.costSources,
  );
  const overlap = s.settlements.filter(
    (other) =>
      other.id !== g.id &&
      other.trials.some(
        (t) =>
          t.rules.saleLineIds.some((id) => input.saleLineIds.includes(id)) ||
          t.rules.costIds.some((id) => input.costIds.includes(id)),
      ),
  );
  if (overlap.length)
    result.warnings.push(
      "來源也出現在其他工作單；各試算不是新增收入或再次扣成本，請自行核對重疊分配。",
    );
  const t = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    rules: structuredClone(input),
    ...sources,
    result,
  };
  g.trials.push(t);
  return t;
}
function projectedBalances(
  s: CatalogSnapshot,
  g: SettlementGroup,
  next: SettlementGroup,
) {
  return settlementBalances(
    {
      ...s,
      settlements: s.settlements.map((item) =>
        item.id === g.id ? next : item,
      ),
    },
    g.id,
  );
}
export function decideSettlement(
  s: CatalogSnapshot,
  id: string,
  input: SettlementDecisionInput,
) {
  const g = group(s, id);
  open(g);
  const trial = input.trialId
    ? g.trials.find((t) => t.id === input.trialId)
    : undefined;
  if (input.trialId && !trial) throw new Error("試算不存在。");
  if (
    !Array.isArray(input.allocations) ||
    input.allocations.length > 1000 ||
    new Set(input.allocations.map((a) => a.partyId)).size !==
      input.allocations.length
  )
    throw new Error("人工分配對象不可重複。");
  for (const a of input.allocations) {
    party(s, a.partyId);
    signedInput(a.amount);
  }
  const reason = text(input.reason, "人工決定原因", 2000),
    total = signed(
      input.allocations.reduce((n, a) => n + BigInt(a.amount), 0n),
    );
  const variance =
    trial?.result.roundedBase === null || !trial
      ? null
      : signed(BigInt(total) - BigInt(trial.result.roundedBase));
  const d = {
    ...structuredClone(input),
    reason,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    total,
    variance,
  };
  projectedBalances(s, g, { ...g, decisions: [...g.decisions, d] });
  g.decisions.push(d);
  return d;
}
export function setSettlementHoldings(
  s: CatalogSnapshot,
  id: string,
  holdings: SettlementHolding[],
) {
  const g = group(s, id);
  open(g);
  if (
    g.payments.length ||
    g.cashAdjustments.length ||
    g.openingHoldings !== null
  )
    throw new Error(
      "期初持款只能在付款前登記一次，後續差異請保留原紀錄並另建核對單。",
    );
  if (
    !Array.isArray(holdings) ||
    !holdings.length ||
    holdings.length > 1000 ||
    new Set(holdings.map((h) => h.partyId)).size !== holdings.length
  )
    throw new Error("期初持款對象重複或過多。");
  holdings.forEach((h) => {
    party(s, h.partyId);
    signedInput(h.amount);
  });
  projectedBalances(s, g, { ...g, openingHoldings: holdings });
  g.openingHoldings = structuredClone(holdings);
  g.holdingsDeclaredAt = new Date().toISOString();
}
export function paySettlement(
  s: CatalogSnapshot,
  id: string,
  input: SettlementPaymentInput,
) {
  const g = group(s, id);
  const operationId = text(input.operationId, "付款操作識別", 100),
    notes = input.notes.trim();
  if (notes.length > 2000) throw new Error("付款備註最多2000字。");
  const prior = g.payments.find((p) => p.operationId === operationId);
  if (prior) {
    if (
      prior.reversesId ||
      prior.fromPartyId !== input.fromPartyId ||
      prior.toPartyId !== input.toPartyId ||
      prior.amount !== input.amount ||
      prior.notes !== notes
    )
      throw new Error("相同操作識別用於不同付款。");
    return prior;
  }
  // Closing is a human status; actual later cash movement remains recordable.
  party(s, input.fromPartyId);
  party(s, input.toPartyId);
  if (input.fromPartyId === input.toPartyId)
    throw new Error("付款雙方不可相同。");
  whole(input.amount, "實際付款", true);
  const p = {
    ...input,
    operationId,
    notes,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    reversesId: "",
  };
  projectedBalances(s, g, { ...g, payments: [...g.payments, p] });
  g.payments.push(p);
  return p;
}
export function reverseSettlementPayment(
  s: CatalogSnapshot,
  id: string,
  paymentId: string,
  reason: string,
) {
  const g = group(s, id),
    old = g.payments.find((p) => p.id === paymentId);
  if (
    !old ||
    old.reversesId ||
    g.payments.some((p) => p.reversesId === paymentId)
  )
    throw new Error("找不到可沖銷的付款。");
  const p = {
    ...old,
    id: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    fromPartyId: old.toPartyId,
    toPartyId: old.fromPartyId,
    notes: text(reason, "付款沖銷原因", 2000),
    createdAt: new Date().toISOString(),
    reversesId: old.id,
  };
  projectedBalances(s, g, { ...g, payments: [...g.payments, p] });
  g.payments.push(p);
  return p;
}
export function closeSettlement(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  const g = group(s, id);
  if (g.closedAt) throw new Error("工作單已結束。");
  g.closeReason = text(reason, "結束說明", 2000);
  g.closedAt = new Date().toISOString();
  g.statusHistory.push({
    id: crypto.randomUUID(),
    kind: "close",
    createdAt: g.closedAt,
    reason: g.closeReason,
  });
}
export function reopenSettlement(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  const g = group(s, id);
  if (!g.closedAt) throw new Error("工作單尚未結束。");
  const note = text(reason, "重新開啟原因", 2000);
  g.statusHistory.push({
    id: crypto.randomUUID(),
    kind: "reopen",
    createdAt: new Date().toISOString(),
    reason: note,
  });
  g.closedAt = "";
  g.closeReason = "";
}
export function settlementBalances(s: CatalogSnapshot, id: string) {
  const g = group(s, id),
    decision = g.decisions.at(-1),
    ids = new Set<string>();
  decision?.allocations.forEach((a) => ids.add(a.partyId));
  g.openingHoldings?.forEach((a) => ids.add(a.partyId));
  g.cashAdjustments.forEach((a) => ids.add(a.partyId));
  g.payments.forEach((p) => {
    ids.add(p.fromPartyId);
    ids.add(p.toPartyId);
  });
  return [...ids].map((partyId) => {
    const allocation = decision?.allocations.find((a) => a.partyId === partyId),
      held = g.openingHoldings?.find((a) => a.partyId === partyId);
    const target = decision ? (allocation?.amount ?? 0) : null,
      openingHeld = held?.amount ?? null;
    const receivedNet = signed(
      g.payments.reduce(
        (n, p) =>
          n +
          (p.toPartyId === partyId ? BigInt(p.amount) : 0n) -
          (p.fromPartyId === partyId ? BigInt(p.amount) : 0n),
        0n,
      ),
    );
    const externalNet = signed(
      g.cashAdjustments
        .filter((a) => a.partyId === partyId)
        .reduce((n, a) => n + BigInt(a.amount), 0n),
    );
    const effectiveHeld =
      openingHeld === null
        ? null
        : signed(
            BigInt(openingHeld) + BigInt(externalNet) + BigInt(receivedNet),
          );
    return {
      partyId,
      target,
      openingHeld,
      receivedNet,
      externalNet,
      effectiveHeld,
      due:
        target === null || effectiveHeld === null
          ? null
          : signed(BigInt(target) - BigInt(effectiveHeld)),
    };
  });
}

export function recordSettlementCash(
  s: CatalogSnapshot,
  id: string,
  input: SettlementCashInput,
) {
  const g = group(s, id),
    operationId = text(input.operationId, "持款變動操作識別", 100),
    reason = text(input.reason, "實際外部收付原因", 2000);
  const prior = g.cashAdjustments.find((a) => a.operationId === operationId);
  if (prior) {
    if (
      prior.reversesId ||
      prior.partyId !== input.partyId ||
      prior.amount !== input.amount ||
      prior.reason !== reason
    )
      throw new Error("相同操作識別用於不同持款變動。");
    return prior;
  }
  party(s, input.partyId);
  signedInput(input.amount);
  if (!input.amount) throw new Error("實際外部收付不能為零。");
  const a = {
    ...input,
    operationId,
    reason,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    reversesId: "",
  };
  projectedBalances(s, g, { ...g, cashAdjustments: [...g.cashAdjustments, a] });
  g.cashAdjustments.push(a);
  return a;
}
export function reverseSettlementCash(
  s: CatalogSnapshot,
  id: string,
  adjustmentId: string,
  reason: string,
) {
  const g = group(s, id),
    old = g.cashAdjustments.find((a) => a.id === adjustmentId);
  if (
    !old ||
    old.reversesId ||
    g.cashAdjustments.some((a) => a.reversesId === old.id)
  )
    throw new Error("找不到可沖銷的持款變動。");
  const a = {
    ...old,
    id: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    amount: -old.amount,
    reason: text(reason, "持款變動沖銷原因", 2000),
    createdAt: new Date().toISOString(),
    reversesId: old.id,
  };
  projectedBalances(s, g, { ...g, cashAdjustments: [...g.cashAdjustments, a] });
  g.cashAdjustments.push(a);
  return a;
}
