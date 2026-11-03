import { test, expect } from "@playwright/test";
test("tracks named inbound lots and FIFO sale allocation across reload and export", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("批次測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("批次徽章");
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
  for (const [batch, quantity] of [
    ["首批", "2"],
    ["補貨批", "5"],
  ]) {
    await page.getByLabel("入庫批次名稱（選填）").fill(batch!);
    await page.getByLabel("數量", { exact: true }).fill(quantity!);
    await page.getByLabel("異動原因", { exact: true }).fill("實際收到");
    await page.getByRole("button", { name: "確認登記異動" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "庫存異動已儲存" }),
    ).toBeVisible();
  }
  const batches = page.locator(".batches");
  await expect(batches).toContainText("首批");
  await expect(batches).toContainText("家中：2 件");
  await expect(batches).toContainText("補貨批");
  await page.getByLabel("異動類型", { exact: true }).selectOption("adjust-out");
  await page
    .getByLabel("來源庫位", { exact: true })
    .selectOption({ label: "家中" });
  await page.getByLabel("數量", { exact: true }).fill("3");
  await page.getByLabel("異動原因", { exact: true }).fill("現場無料");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "庫存異動已儲存" }),
  ).toBeVisible();
  await expect(batches).not.toContainText("首批");
  await expect(batches).toContainText("補貨批");
  await expect(batches).toContainText("家中：4 件");
  await page.reload();
  await expect(page.locator(".batches")).toContainText("家中：4 件");
  await page.goto("#/templates");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "一鍵匯出專案檔（Excel）" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
});
