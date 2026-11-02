import { test, expect } from "@playwright/test";
test("records manual online listing counts and compares them with shared physical stock", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("通販核對");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("星空徽章");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page.goto("#/inventory");
  await page.getByLabel("庫位名稱", { exact: true }).fill("家中");
  await page.getByRole("button", { name: "建立庫位", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("庫位已建立");
  await page.getByLabel("商品", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("目的庫位", { exact: true })
    .selectOption({ label: "家中" });
  await page.getByLabel("數量", { exact: true }).fill("10");
  await page.getByLabel("異動原因／批次註記").fill("到貨");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  const panel = page.getByRole("region", { name: "通販庫存對照" });
  await expect(panel).toContainText("不會自動讀取或同步庫存");
  for (const [name, quantity] of [
    ["商店A", "6"],
    ["商店B", "5"],
  ]) {
    await panel.getByLabel("商店／通路名稱").fill(name);
    await panel.getByLabel("網店對應商品").selectOption({ index: 1 });
    await panel.getByLabel("實物出貨庫位").selectOption({ label: "家中" });
    await panel.getByLabel("網店商品連結").fill("https://example.com/item");
    await panel.getByLabel("網店顯示的可售數量").fill(quantity);
    await panel.getByRole("button", { name: "儲存通販對照" }).click();
    await expect(panel.getByRole("status")).toContainText("通販對照已儲存");
  }
  await expect(panel.getByRole("table")).toContainText("-1");
  await expect(panel.getByRole("table")).toContainText("網店數量超過現存");
  await expect(
    panel.getByRole("link", { name: "開啟網店商品頁 ↗" }).first(),
  ).toHaveAttribute("href", "https://example.com/item");
  await panel
    .getByRole("button", { name: "封存對照", exact: true })
    .first()
    .click();
  await expect(panel.getByRole("status")).toContainText("已封存");
  await expect(panel.getByRole("table")).toContainText("5");
  await page.reload();
  await expect(panel.getByRole("table")).toContainText("5");
  await expect(
    panel.getByRole("heading", { name: "商店B", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "編輯／重新核對" }).click();
  await panel.getByLabel("網店顯示的可售數量").fill("0");
  await panel.getByRole("button", { name: "儲存通販對照" }).click();
  await expect(panel.getByRole("status")).toContainText("已儲存");
  await expect(panel.getByRole("table").getByRole("row").last()).toContainText(
    "10",
  );
});
