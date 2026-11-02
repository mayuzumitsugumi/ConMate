import { record, text } from "../catalog/operations";
import { whole, safeAmount } from "../money";
import type {
  CatalogSnapshot,
  CostInput,
  CostRecord,
  AdvanceInput,
  AdvanceRecord,
  ManagedArtworkAllocation,
} from "../models/catalog";

export function putCost(s: CatalogSnapshot, input: CostInput, id?: string) {
  const p = s.products.find((p) => p.id === input.productId);
  if (!p) throw new Error("請選擇商品。");
  const old = id ? s.costs.find((c) => c.id === id) : undefined;
  if (id && !old) throw new Error("找不到成本紀錄。");
  if (
    old?.artworkAllocation &&
    [
      "productId",
      "quantity",
      "estimatedPrint",
      "actualPrint",
      "artworkAllocated",
    ].some((key) => (old as any)[key] !== (input as any)[key])
  )
    throw new Error(
      "此成本由柄圖分攤管理，請先撤銷分攤再修改商品、數量或印製／柄圖基準。",
    );
  const name = text(input.name, "批次／成本名稱", 80);
  whole(input.quantity, "製作數量", true);
  for (const key of [
    "estimatedPrint",
    "actualPrint",
    "artworkAllocated",
    "otherCost",
    "unitSalePrice",
  ] as const)
    if (input[key] !== null)
      whole(input[key], key === "unitSalePrice" ? "試算售價" : "成本金額");
  if (input.paidById && !s.parties.some((p) => p.id === input.paidById))
    throw new Error("付款者不存在。");
  if (
    input.burdenPartyId &&
    !s.parties.some((p) => p.id === input.burdenPartyId)
  )
    throw new Error("負擔者不存在。");
  if (input.notes.length > 2000) throw new Error("備註最多2000字。");
  const value = {
    name,
    productId: input.productId,
    quantity: input.quantity,
    estimatedPrint: input.estimatedPrint,
    actualPrint: input.actualPrint,
    artworkAllocated: input.artworkAllocated,
    otherCost: input.otherCost,
    unitSalePrice: input.unitSalePrice,
    paidById: input.paidById,
    burdenPartyId: input.burdenPartyId,
    notes: input.notes.trim(),
    updatedAt: new Date().toISOString(),
  };
  costSummary({ ...value, artworkAllocation: old?.artworkAllocation });
  if (old) Object.assign(old, value);
  else
    s.costs.push({
      ...record(s, "CST", name),
      ...value,
      archived: false,
      createdAt: value.updatedAt,
    });
}
// Exact fractions until final display. Unknown values remain unknown rather than zero.
// CostInput remains editable manual data. CostRecord may additionally carry a managed exact artwork source.
export function costSummary(
  c: CostInput & { artworkAllocation?: ManagedArtworkAllocation },
) {
  if (
    c.actualPrint === null ||
    c.artworkAllocated === null ||
    c.otherCost === null
  )
    return null;
  const art = c.artworkAllocation;
  if (
    art &&
    (!/^(0|[1-9]\d*)$/.test(art.numerator) ||
      !/^[1-9]\d*$/.test(art.denominator) ||
      art.numerator.length > 2000 ||
      art.denominator.length > 2000)
  )
    throw new Error("精確柄圖分數不正確。");
  const d = art ? BigInt(art.denominator) : 1n;
  const n =
    (BigInt(c.actualPrint) + BigInt(c.otherCost)) * d +
    (art ? BigInt(art.numerator) : BigInt(c.artworkAllocated));
  if (n > BigInt(Number.MAX_SAFE_INTEGER) * d)
    throw new Error("成本合計超過安全範圍。");
  const integerTotal = safeAmount(
    BigInt(c.actualPrint) + BigInt(c.artworkAllocated) + BigInt(c.otherCost),
  );
  const revenue =
    c.unitSalePrice === null
      ? null
      : safeAmount(BigInt(c.quantity) * BigInt(c.unitSalePrice));
  const profitNumerator = revenue === null ? null : BigInt(revenue) * d - n;
  const integerString = (v: bigint, den: bigint) =>
    v % den === 0n ? (v / den).toString() : fractionDecimal(v, den);
  const breakEven =
    c.unitSalePrice === null || c.unitSalePrice === 0
      ? null
      : (n + BigInt(c.unitSalePrice) * d - 1n) / (BigInt(c.unitSalePrice) * d);
  return {
    total: art ? integerString(n, d) : integerTotal,
    integerTotal,
    exactTotal: { numerator: n.toString(), denominator: d.toString() },
    unitCost: fractionDecimal(n, d * BigInt(c.quantity)),
    revenue,
    profit: profitNumerator === null ? null : integerString(profitNumerator, d),
    breakEven: breakEven?.toString() ?? null,
  };
}

export function fractionDecimal(
  numerator: bigint,
  denominator: bigint,
  places = 4,
): string {
  if (denominator <= 0n) throw new Error("分母必須大於零。");
  const scale = 10n ** BigInt(places),
    negative = numerator < 0n;
  const a = negative ? -numerator : numerator;
  const scaled = (a * scale * 2n + denominator) / (denominator * 2n);
  const str = scaled.toString().padStart(places + 1, "0");
  return `${negative && scaled !== 0n ? "-" : ""}${str.slice(0, -places)}.${str.slice(-places)}`;
}
export function putAdvance(s: CatalogSnapshot, input: AdvanceInput) {
  const name = text(input.name, "代墊名稱", 80);
  whole(input.principal, "已實付且約定可追收本金", true);
  for (const id of [input.payerId, input.debtorId])
    if (!s.parties.some((p) => p.id === id))
      throw new Error("請選擇付款者與負擔者。");
  if (input.payerId === input.debtorId)
    throw new Error("自行負擔的付款不屬於向他人追收的代墊。");
  if (input.notes.length > 2000) throw new Error("備註最多2000字。");
  s.advances.push({
    ...record(s, "ADV", name),
    payerId: input.payerId,
    debtorId: input.debtorId,
    principal: input.principal,
    name,
    notes: input.notes.trim(),
    createdAt: new Date().toISOString(),
    voidedAt: "",
    voidReason: "",
    repayments: [],
  });
}
export function repayAdvance(
  s: CatalogSnapshot,
  id: string,
  amount: number,
  notes: string,
) {
  const a = s.advances.find((a) => a.id === id);
  if (!a || a.voidedAt) throw new Error("找不到有效代墊紀錄。");
  whole(amount, "償還金額", true);
  const paid = BigInt(advanceRepaid(a));
  if (paid + BigInt(amount) > BigInt(a.principal))
    throw new Error("償還金額超過未還本金。");
  if (notes.length > 2000) throw new Error("備註最多2000字。");
  a.repayments.push({
    id: crypto.randomUUID(),
    amount,
    reversesId: "",
    notes: notes.trim(),
    createdAt: new Date().toISOString(),
  });
}

export function advanceRepaid(a: AdvanceRecord): number {
  return safeAmount(
    a.repayments.reduce(
      (sum, r) => sum + (r.reversesId ? -1n : 1n) * BigInt(r.amount),
      0n,
    ),
  );
}
export function reverseRepayment(
  s: CatalogSnapshot,
  id: string,
  repaymentId: string,
  reason: string,
) {
  const a = s.advances.find((a) => a.id === id);
  const old = a?.repayments.find((r) => r.id === repaymentId);
  if (
    !a ||
    a.voidedAt ||
    !old ||
    old.reversesId ||
    a.repayments.some((r) => r.reversesId === repaymentId)
  )
    throw new Error("找不到可沖銷的還款。");
  a.repayments.push({
    ...old,
    id: crypto.randomUUID(),
    reversesId: old.id,
    notes: text(reason, "沖銷原因", 2000),
    createdAt: new Date().toISOString(),
  });
}
export function voidAdvance(s: CatalogSnapshot, id: string, reason: string) {
  const a = s.advances.find((r) => r.id === id);
  if (!a || a.voidedAt || advanceRepaid(a) !== 0)
    throw new Error("僅能作廢沒有有效還款的代墊。請先處理還款紀錄。");
  a.voidReason = text(reason, "作廢原因", 2000);
  a.voidedAt = new Date().toISOString();
}
