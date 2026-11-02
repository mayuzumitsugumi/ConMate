import { record, text } from "../catalog/operations";
import { whole } from "../money";
import type { CatalogSnapshot, ExpensePaymentInput } from "../models/catalog";
export function expenseSourceAmount(
  s: CatalogSnapshot,
  category: ExpensePaymentInput["category"],
  costId: string,
  artworkSourceId: string,
): number | null {
  if (category === "artwork") {
    if (costId) throw new Error("柄圖付款不應同時連結製作成本。");
    const source = s.artworkExpenses.find((a) => a.id === artworkSourceId);
    if (!source || source.voidedAt) throw new Error("有效柄圖費來源不存在。");
    return source.amount;
  }
  if (artworkSourceId || !["print", "other"].includes(category))
    throw new Error("付款來源類型不正確。");
  const cost = s.costs.find((c) => c.id === costId);
  if (!cost) throw new Error("成本來源不存在。");
  return category === "print" ? cost.actualPrint : cost.otherCost;
}
export function putExpensePayment(
  s: CatalogSnapshot,
  input: ExpensePaymentInput,
) {
  const operationId = text(
    input.operationId || crypto.randomUUID(),
    "付款操作識別",
    100,
  );
  const prior = s.expensePayments.find((p) => p.operationId === operationId);
  if (prior) {
    const same =
      prior.costId === input.costId &&
      prior.artworkSourceId === input.artworkSourceId &&
      prior.category === input.category &&
      prior.payerId === input.payerId &&
      prior.recipient === input.recipient.trim() &&
      prior.amount === input.amount &&
      prior.notes === input.notes.trim();
    if (prior.reversedAt || !same)
      throw new Error("付款操作識別已用於不同或已沖銷紀錄。");
    return prior;
  }
  expenseSourceAmount(s, input.category, input.costId, input.artworkSourceId);
  if (!s.parties.some((p) => p.id === input.payerId))
    throw new Error("請選擇實際付款人。");
  whole(input.amount, "實際支付金額", true);
  const recipient = text(input.recipient, "實際收款廠商／對象", 120);
  if (input.notes.length > 2000) throw new Error("備註最多2000字。");
  const payment = {
    ...record(s, "PAY", "實際費用付款"),
    ...input,
    operationId,
    recipient,
    notes: input.notes.trim(),
    createdAt: new Date().toISOString(),
    reversedAt: "",
    reverseReason: "",
  };
  s.expensePayments.push(payment);
  return payment;
}
export function reverseExpensePayment(
  s: CatalogSnapshot,
  id: string,
  reason: string,
) {
  const p = s.expensePayments.find((p) => p.id === id);
  if (!p || p.reversedAt) throw new Error("找不到可沖銷的付款。");
  p.reverseReason = text(reason, "付款沖銷原因", 2000);
  p.reversedAt = new Date().toISOString();
}
export function expenseReconciliation(
  s: CatalogSnapshot,
  category: ExpensePaymentInput["category"],
  costId: string,
  artworkSourceId: string,
) {
  const expected = expenseSourceAmount(s, category, costId, artworkSourceId);
  const paid = s.expensePayments
    .filter(
      (p) =>
        !p.reversedAt &&
        p.category === category &&
        p.costId === costId &&
        p.artworkSourceId === artworkSourceId,
    )
    .reduce((a, p) => a + BigInt(p.amount), 0n);
  return {
    expected: expected === null ? null : String(expected),
    paid: paid.toString(),
    difference: expected === null ? null : (BigInt(expected) - paid).toString(),
  };
}
