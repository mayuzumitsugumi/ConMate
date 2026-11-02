import { it, expect } from "vitest";
import { putProductNames } from "../../src/domain/catalog/bulk";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
const snapshot = () =>
  emptyCatalog({
    id: "w",
    name: "w",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: "2026-01-01T00:00:00Z",
  });
it("creates independent stable product IDs without stock or inferred creator", () => {
  const s = snapshot();
  const products = putProductNames(s, ["徽章", "吊飾"]);
  expect(new Set(products.map((p) => p.id)).size).toBe(2);
  expect(s.products).toHaveLength(2);
  expect(s.movements).toHaveLength(0);
  expect(products.every((p) => !p.creatorId)).toBe(true);
});
it("validates all names before any mutation", () => {
  const s = snapshot();
  putProductNames(s, ["既有"]);
  const before = JSON.stringify(s);
  for (const names of [
    ["新商品", "既有"],
    ["重複", " 重複 "],
    ["新商品", ""],
    Array.from({ length: 101 }, (_, i) => String(i)),
  ]) {
    expect(() => putProductNames(s, names)).toThrow();
    expect(JSON.stringify(s)).toBe(before);
  }
});
