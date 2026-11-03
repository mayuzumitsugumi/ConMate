import { record, text } from "../catalog/operations";
import { whole, safeAmount } from "../money";
import { costSummary, fractionDecimal } from "./operations";
import type {
  CatalogSnapshot,
  InternalAgreementInput,
  InternalAgreement,
  InternalReceiptInput,
  ExactFraction,
} from "../models/catalog";
function unit(value: string | null) {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)(\.\d{1,4})?$/.test(value) ||
    value.length > 24
  )
    throw new Error("每件回收額須為非負數，最多四位小數；空白表示未知。");
  const [a, b = ""] = value.split(".");
  const n = BigInt(a!) * 10000n + BigInt(b.padEnd(4, "0"));
  if (n > BigInt(Number.MAX_SAFE_INTEGER) * 10000n)
    throw new Error("每件回收額超出安全範圍。");
  return n;
}
function party(s: CatalogSnapshot, id: string, required = false) {
  if ((required && !id) || (id && !s.parties.some((p) => p.id === id)))
    throw new Error("請選擇此工作區的參與方。");
}
function source(s: CatalogSnapshot, type: string, id: string) {
  if (type === "cost") {
    const c = s.costs.find((c) => c.id === id && !c.archived);
    if (!c) throw new Error("找不到可用成本來源。");
    return { name: c.name, exact: costSummary(c)?.exactTotal ?? null };
  }
  if (type === "artwork") {
    const a = s.artworkExpenses.find((a) => a.id === id && !a.voidedAt);
    if (!a) throw new Error("找不到可用柄圖費來源。");
    return {
      name: a.name,
      exact: { numerator: String(a.amount), denominator: "1" },
    };
  }
  throw new Error("來源類型不正確。");
}
export function createInternalAgreement(
  s: CatalogSnapshot,
  input: InternalAgreementInput,
  previousId = "",
) {
  const name = text(input.name, "約定名稱", 80);
  whole(input.quantity, "回收規劃數量", true);
  if (input.internalTotal !== null) whole(input.internalTotal, "內部負擔總額");
  unit(input.agreedUnit);
  party(s, input.burdenPartyId);
  party(s, input.differencePartyId);
  const src = source(s, input.sourceType, input.sourceId);
  if (previousId) {
    const old = s.internalAgreements.find(
      (a) => a.id === previousId && !a.voidedAt,
    );
    if (
      !old ||
      old.sourceType !== input.sourceType ||
      old.sourceId !== input.sourceId
    )
      throw new Error("新版約定必須使用同一費用來源。");
    if (s.internalAgreements.some((a) => a.previousId === previousId))
      throw new Error("此約定已有新版，請從最新版建立。");
  }
  const a: InternalAgreement = {
    ...record(s, "IAG", name),
    ...input,
    name,
    sourceName: src.name,
    sourceExact: src.exact,
    notes: text(input.notes, "約定原因", 2000),
    differenceTreatment: input.differenceTreatment.trim(),
    createdAt: new Date().toISOString(),
    previousId,
    voidedAt: "",
    voidReason: "",
  };
  if (a.differenceTreatment.length > 2000)
    throw new Error("差額處理說明最多2000字。");
  internalSummary(s, a);
  s.internalAgreements.push(a);
  return a;
}
export function internalSummary(s: CatalogSnapshot, a: InternalAgreement) {
  const u = unit(a.agreedUnit),
    planned = u === null ? null : u * BigInt(a.quantity);
  if (planned !== null && planned > BigInt(Number.MAX_SAFE_INTEGER) * 10000n)
    throw new Error("約定回收合計超出安全範圍。");
  const src = a.sourceExact,
    n = src ? BigInt(src.numerator) : null,
    d = src ? BigInt(src.denominator) : 1n;
  const ancestors = new Set<string>();
  let cursor: InternalAgreement | undefined = a;
  while (cursor) {
    if (ancestors.has(cursor.id)) throw new Error("約定版本循環。");
    ancestors.add(cursor.id);
    cursor = cursor.previousId
      ? s.internalAgreements.find((x) => x.id === cursor!.previousId)
      : undefined;
  }
  const collected = s.internalReceipts
    .filter((r) => ancestors.has(r.agreementId))
    .reduce(
      (sum, r) => sum + (r.reversesId ? -BigInt(r.amount) : BigInt(r.amount)),
      0n,
    );
  const difference =
    planned === null || n === null
      ? null
      : fractionDecimal(planned * d - n * 10000n, 10000n * d);
  return {
    sourceTotal: n === null ? null : fractionDecimal(n, d),
    internalTotal: a.internalTotal,
    plannedTotal: planned === null ? null : fractionDecimal(planned, 10000n),
    difference,
    collected: safeAmount(collected),
    remaining:
      planned === null
        ? null
        : fractionDecimal(planned - collected * 10000n, 10000n),
    differenceResolved: !!a.differencePartyId && !!a.differenceTreatment,
    burdenDifference:
      n === null || a.internalTotal === null
        ? null
        : fractionDecimal(BigInt(a.internalTotal) * d - n, d),
  };
}
export function recordInternalReceipt(
  s: CatalogSnapshot,
  input: InternalReceiptInput,
) {
  const a = s.internalAgreements.find(
    (a) => a.id === input.agreementId && !a.voidedAt,
  );
  if (!a) throw new Error("請選擇未作廢約定。");
  if (s.internalAgreements.some((x) => x.previousId === a.id))
    throw new Error(
      "已有新版約定，請核對後使用最新版；舊收款仍保留，不自動移轉。",
    );
  party(s, input.payerId, true);
  party(s, input.collectorId, true);
  whole(input.amount, "實際已收款", true);
  if (input.payerId === input.collectorId)
    throw new Error("付款與收款者必須不同。");
  const r = {
    ...record(s, "IRC", "內部回收實收"),
    ...input,
    notes: text(input.notes, "收款說明", 2000),
    createdAt: new Date().toISOString(),
    reversesId: "",
  };
  s.internalReceipts.push(r);
  internalSummary(s, a);
  return r;
}
export function reverseInternalReceipt(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  const old = s.internalReceipts.find((r) => r.id === id);
  if (
    !old ||
    old.reversesId ||
    s.internalReceipts.some((r) => r.reversesId === id)
  )
    throw new Error("此收款不可重複沖銷。");
  const r = {
    ...old,
    ...record(s, "IRC", "內部回收沖銷"),
    notes: text(reason, "沖銷原因", 2000),
    createdAt: new Date().toISOString(),
    reversesId: id,
  };
  s.internalReceipts.push(r);
  return r;
}
export function voidInternalAgreement(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  const a = s.internalAgreements.find((a) => a.id === id && !a.voidedAt);
  if (!a) throw new Error("找不到未作廢約定。");
  if (s.internalAgreements.some((x) => x.previousId === id))
    throw new Error("已有新版約定，不能作廢前版。");
  if (internalSummary(s, a).collected)
    throw new Error("仍有有效實收款，不能作廢；請先核對沖銷。");
  a.voidReason = text(reason, "作廢原因", 2000);
  a.voidedAt = new Date().toISOString();
}

export function validateInternalPricing(s: CatalogSnapshot) {
  const validTime = (v: string) => {
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) ||
      !Number.isFinite(Date.parse(v))
    )
      throw new Error("內部紀錄時間不正確。");
  };
  const known = new Map<string, InternalAgreement>();
  for (const a of s.internalAgreements) {
    text(a.name, "約定名稱", 80);
    whole(a.quantity, "約定數量", true);
    unit(a.agreedUnit);
    if (a.internalTotal !== null) whole(a.internalTotal, "內部負擔");
    party(s, a.burdenPartyId);
    party(s, a.differencePartyId);
    // Current source may have been edited or archived. Only require identity, never rewrite its frozen amount.
    if (
      !["cost", "artwork"].includes(a.sourceType) ||
      !(a.sourceType === "cost" ? s.costs : s.artworkExpenses).some(
        (x) => x.id === a.sourceId,
      )
    )
      throw new Error("內部約定費用來源不正確。");
    text(a.sourceName, "來源名稱", 80);
    text(a.notes, "約定原因", 2000);
    if (
      typeof a.differenceTreatment !== "string" ||
      a.differenceTreatment.length > 2000
    )
      throw new Error("差額說明不正確。");
    if (a.sourceExact !== null) {
      const e = a.sourceExact;
      if (
        !e ||
        typeof e.numerator !== "string" ||
        typeof e.denominator !== "string" ||
        e.numerator.length > 2000 ||
        e.denominator.length > 2000 ||
        !/^(0|[1-9]\d*)$/.test(e.numerator) ||
        !/^[1-9]\d*$/.test(e.denominator) ||
        BigInt(e.numerator) >
          BigInt(Number.MAX_SAFE_INTEGER) * BigInt(e.denominator)
      )
        throw new Error("約定精確成本不正確。");
    }
    validTime(a.createdAt);
    if (
      typeof a.previousId !== "string" ||
      typeof a.voidedAt !== "string" ||
      typeof a.voidReason !== "string"
    )
      throw new Error("約定版本資料不正確。");
    if (a.previousId) {
      const old = known.get(a.previousId);
      if (
        !old ||
        old.voidedAt ||
        old.sourceType !== a.sourceType ||
        old.sourceId !== a.sourceId ||
        Date.parse(old.createdAt) > Date.parse(a.createdAt) ||
        s.internalAgreements.filter((x) => x.previousId === a.previousId)
          .length !== 1
      )
        throw new Error("約定版本鏈不正確。");
    }
    if (a.voidedAt) {
      validTime(a.voidedAt);
      text(a.voidReason, "作廢原因", 2000);
      if (Date.parse(a.voidedAt) < Date.parse(a.createdAt))
        throw new Error("作廢時間不正確。");
    } else if (a.voidReason) throw new Error("作廢資料不一致。");
    known.set(a.id, a);
  }
  const receipts = new Map<string, (typeof s.internalReceipts)[number]>(),
    reversed = new Set<string>();
  for (const r of s.internalReceipts) {
    const a = known.get(r.agreementId);
    if (!a) throw new Error("回收款約定不存在。");
    party(s, r.payerId, true);
    party(s, r.collectorId, true);
    if (r.payerId === r.collectorId) throw new Error("回收付款與收款者相同。");
    whole(r.amount, "回收款", true);
    text(r.notes, "收款原因", 2000);
    validTime(r.createdAt);
    if (
      Date.parse(r.createdAt) < Date.parse(a.createdAt) ||
      typeof r.reversesId !== "string"
    )
      throw new Error("回收時間或沖銷資料不正確。");
    if (r.reversesId) {
      const old = receipts.get(r.reversesId);
      if (
        !old ||
        old.reversesId ||
        reversed.has(old.id) ||
        old.agreementId !== r.agreementId ||
        old.amount !== r.amount ||
        old.payerId !== r.payerId ||
        old.collectorId !== r.collectorId ||
        Date.parse(r.createdAt) < Date.parse(old.createdAt)
      )
        throw new Error("回收沖銷資料不一致。");
      reversed.add(old.id);
    } else {
      if (a.voidedAt && Date.parse(r.createdAt) > Date.parse(a.voidedAt))
        throw new Error("作廢後新增收款。");
      const child = s.internalAgreements.find((x) => x.previousId === a.id);
      if (child && Date.parse(r.createdAt) > Date.parse(child.createdAt))
        throw new Error("舊版約定新增收款。");
    }
    receipts.set(r.id, r);
  }
  for (const a of s.internalAgreements) {
    const summary = internalSummary(s, a);
    if (a.voidedAt && summary.collected !== 0)
      throw new Error("已作廢約定仍有未沖銷款項。");
  }
}
