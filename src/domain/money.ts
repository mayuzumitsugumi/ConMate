export function whole(v: number, label: string, positive = false): number {
  if (!Number.isSafeInteger(v) || v < (positive ? 1 : 0))
    throw new Error(
      `${label}必須是${positive ? "正" : "非負"}整數，且不可超過安全範圍。`,
    );
  return v;
}
export function safeAmount(v: bigint): number {
  if (v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("金額合計超過安全範圍。");
  return Number(v);
}
