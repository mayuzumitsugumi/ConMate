import { test, expect } from "@playwright/test";
test("records stock, transfers and reversal with persistent shared balances", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("庫存工作區");
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
  for (const location of ["家中", "攤位"]) {
    await page.getByLabel("庫位名稱", { exact: true }).fill(location);
    await page.getByRole("button", { name: "建立庫位", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("庫位已建立");
  }
  await page.getByLabel("商品", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("目的庫位", { exact: true })
    .selectOption({ label: "家中" });
  await page.getByLabel("數量", { exact: true }).fill("10");
  await page.getByLabel("異動原因／批次註記").fill("第一批到貨");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  await page.getByLabel("異動類型").selectOption("transfer");
  await page
    .getByLabel("來源庫位", { exact: true })
    .selectOption({ label: "家中" });
  await page
    .getByLabel("目的庫位", { exact: true })
    .selectOption({ label: "攤位" });
  await page.getByLabel("數量", { exact: true }).fill("4");
  await page.getByLabel("異動原因／批次註記").fill("帶去場次");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  const table = page.getByRole("table");
  await expect(
    table.getByRole("row").filter({ hasText: "家中" }),
  ).toContainText("6");
  await expect(
    table.getByRole("row").filter({ hasText: "攤位" }),
  ).toContainText("4");
  await page
    .getByRole("button", { name: "沖銷更正", exact: true })
    .first()
    .click();
  await page
    .getByLabel("沖銷原因（若庫存已移走，需先處理後續異動）")
    .fill("場次取消");
  await page.getByRole("button", { name: "確認沖銷", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已新增沖銷紀錄");
  await page.reload();
  await expect(
    table.getByRole("row").filter({ hasText: "家中" }),
  ).toContainText("10");
  await expect(
    table.getByRole("row").filter({ hasText: "攤位" }),
  ).toContainText("0");
});
