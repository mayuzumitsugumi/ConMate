import { record, text } from "../catalog/operations";
import { whole, safeAmount } from "../money";
import { fractionDecimal, costSummary } from "./operations";
import type {
  CatalogSnapshot,
  ArtworkAllocationInput,
  ArtworkExpenseInput,
  ArtworkExpenseRecord,
  ArtworkTargetSnapshot,
  ExactFraction,
} from "../models/catalog";
type Fraction = { n: bigint; d: bigint };
function gcd(a: bigint, b: bigint): bigint {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a < 0n ? -a : a;
}
function fraction(n: bigint, d = 1n): Fraction {
  if (d <= 0n) throw new Error("分母必須大於零。");
  const g = gcd(n, d);
  const result = { n: n / g, d: d / g };
  if (result.n.toString().length > 2000 || result.d.toString().length > 2000)
    throw new Error("分攤基準過於複雜，請拆分群組。");
  return result;
}
function add(a: Fraction, b: Fraction) {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}
const encoded = (v: Fraction): ExactFraction => ({
  numerator: v.n.toString(),
  denominator: v.d.toString(),
});
export function parseWeight(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(value))
    throw new Error("權重需為非負數字，最多四位小數。");
  const [a, b = ""] = value.split(".");
  return BigInt(a!) * 10000n + BigInt(b.padEnd(4, "0"));
}
export function previewArtworkAllocation(
  s: CatalogSnapshot,
  source: ArtworkExpenseRecord,
  input: ArtworkAllocationInput,
): ArtworkTargetSnapshot[] {
  if (
    !["unit-print", "total-print", "equal", "custom", "manual"].includes(
      input.method,
    ) ||
    !["actual", "estimated"].includes(input.basis)
  )
    throw new Error("分攤方式或成本基準不正確。");
  if (
    !input.targets.length ||
    input.targets.length > 1000 ||
    new Set(input.targets.map((t) => t.costId)).size !== input.targets.length
  )
    throw new Error("請選擇不重複的分攤成本紀錄。");
  const bases = input.targets.map((t) => {
    const cost = s.costs.find((c) => c.id === t.costId && !c.archived);
    if (!cost) throw new Error("請選擇啟用的成本紀錄。");
    const product = s.products.find((p) => p.id === cost.productId);
    if (product?.artworkId !== source.artworkId)
      throw new Error("分攤商品必須使用來源柄圖。");
    if (cost.artworkAllocation)
      throw new Error("此成本已有生效的柄圖分攤，請先撤銷原分攤。");
    if (
      cost.artworkAllocated !== null &&
      cost.artworkAllocated !== 0 &&
      !input.allowReplaceManual
    )
      throw new Error("目標已有人工柄圖費，請明確確認取代或取消。");
    whole(cost.quantity, "製作數量", true);
    const printTotal =
      input.basis === "actual" ? cost.actualPrint : cost.estimatedPrint;
    let weight = fraction(1n);
    if (input.method === "unit-print" || input.method === "total-print") {
      if (printTotal === null) throw new Error("分攤基準印製費尚未填寫。");
      whole(printTotal, "基準印製費");
      weight = fraction(
        BigInt(printTotal),
        input.method === "unit-print" ? BigInt(cost.quantity) : 1n,
      );
    } else if (input.method === "custom")
      weight = fraction(parseWeight(t.weight));
    if (input.method === "manual") {
      if (t.manualAmount === null) throw new Error("請填寫每項人工分攤額。");
      whole(t.manualAmount, "人工分攤額");
    }
    return { cost, t, printTotal, weight };
  });
  const amount = BigInt(whole(source.amount, "柄圖來源金額"));
  const sum = bases.reduce((a, b) => add(a, b.weight), fraction(0n));
  if (input.method !== "manual" && sum.n === 0n)
    throw new Error("分攤權重合計必須大於零。");
  if (
    input.method === "manual" &&
    bases.reduce((a, b) => a + BigInt(b.t.manualAmount!), 0n) !== amount
  )
    throw new Error("人工分攤合計必須等於來源柄圖費。");
  const exact = bases.map((b) =>
    input.method === "manual"
      ? fraction(BigInt(b.t.manualAmount!))
      : fraction(amount * b.weight.n * sum.d, b.weight.d * sum.n),
  );
  const integers = exact.map((v) => v.n / v.d);
  let remainder = amount - integers.reduce((a, b) => a + b, 0n);
  const order = exact
    .map((v, i) => ({ i, n: v.n % v.d, d: v.d, id: bases[i]!.cost.id }))
    .sort((a, b) => {
      const diff = a.n * b.d - b.n * a.d;
      return diff > 0n
        ? -1
        : diff < 0n
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;
    });
  for (const row of order) {
    if (!remainder) break;
    integers[row.i] = integers[row.i]! + 1n;
    remainder--;
  }
  return bases.map((b, i) => ({
    costId: b.cost.id,
    productId: b.cost.productId,
    quantity: b.cost.quantity,
    printTotal: b.printTotal,
    weight: b.t.weight,
    manualAmount: b.t.manualAmount,
    exactAmount: encoded(exact[i]!),
    integerAmount: safeAmount(integers[i]!),
    previousAmount: b.cost.artworkAllocated,
  }));
}
export function putArtworkExpense(
  s: CatalogSnapshot,
  input: ArtworkExpenseInput,
) {
  const name = text(input.name, "柄圖費名稱", 80);
  if (!s.artworks.some((a) => a.id === input.artworkId))
    throw new Error("請選擇已在商品建檔使用的柄圖。");
  whole(input.amount, "柄圖來源金額");
  const source: ArtworkExpenseRecord = {
    ...record(s, "AEX", name),
    artworkId: input.artworkId,
    amount: input.amount,
    notes: input.notes.trim(),
    createdAt: new Date().toISOString(),
    allocations: [],
    voidedAt: "",
    voidReason: "",
  };
  if (source.notes.length > 2000) throw new Error("備註最多2000字。");
  s.artworkExpenses.push(source);
  return source;
}
export function applyArtworkAllocation(
  s: CatalogSnapshot,
  id: string,
  input: ArtworkAllocationInput,
) {
  const source = s.artworkExpenses.find((a) => a.id === id);
  if (!source || source.voidedAt) throw new Error("有效柄圖費來源不存在。");
  if (source.allocations.some((a) => !a.reversedAt))
    throw new Error("這筆柄圖來源已有生效分攤，不能重複分配。");
  const targets = previewArtworkAllocation(s, source, input);
  const version = source.allocations.length + 1;
  const allocation = {
    version,
    method: input.method,
    basis: input.basis,
    createdAt: new Date().toISOString(),
    reversedAt: "",
    reverseReason: "",
    targets,
  };
  for (const target of targets) {
    const cost = s.costs.find((c) => c.id === target.costId)!;
    costSummary({
      ...cost,
      artworkAllocated: target.integerAmount,
      artworkAllocation: {
        sourceId: source.id,
        version,
        ...target.exactAmount,
      },
    });
  }
  for (const target of targets) {
    const cost = s.costs.find((c) => c.id === target.costId)!;
    cost.artworkAllocated = target.integerAmount;
    cost.artworkAllocation = {
      sourceId: source.id,
      version,
      ...target.exactAmount,
    };
    cost.updatedAt = allocation.createdAt;
  }
  source.allocations.push(allocation);
  return allocation;
}
export function reverseArtworkAllocation(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  const source = s.artworkExpenses.find((a) => a.id === id);
  const allocation = source?.allocations.find((a) => !a.reversedAt);
  if (!source || !allocation) throw new Error("找不到生效中的分攤。");
  reason = text(reason, "撤銷原因", 2000);
  for (const target of allocation.targets) {
    const cost = s.costs.find((c) => c.id === target.costId);
    if (
      cost?.artworkAllocation?.sourceId !== source.id ||
      cost.artworkAllocation.version !== allocation.version
    )
      throw new Error("目標成本的分攤來源不一致，無法撤銷。");
  }
  for (const target of allocation.targets) {
    const cost = s.costs.find((c) => c.id === target.costId)!;
    cost.artworkAllocated = target.previousAmount;
    delete cost.artworkAllocation;
    cost.updatedAt = new Date().toISOString();
  }
  allocation.reversedAt = new Date().toISOString();
  allocation.reverseReason = reason;
}
export function artworkUnitDisplay(target: ArtworkTargetSnapshot) {
  return fractionDecimal(
    BigInt(target.exactAmount.numerator),
    BigInt(target.exactAmount.denominator) * BigInt(target.quantity),
  );
}

export function voidArtworkExpense(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  const source = s.artworkExpenses.find((a) => a.id === id);
  if (
    !source ||
    source.voidedAt ||
    source.allocations.some((a) => !a.reversedAt) ||
    s.expensePayments.some((p) => !p.reversedAt && p.artworkSourceId === id)
  )
    throw new Error("僅能作廢沒有生效分攤與付款的柄圖來源。");
  source.voidReason = text(reason, "作廢原因", 2000);
  source.voidedAt = new Date().toISOString();
}
