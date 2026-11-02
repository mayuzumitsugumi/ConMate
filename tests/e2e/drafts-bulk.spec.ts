import { test, expect } from "@playwright/test";
test("bulk creates searchable products and restores a local uncommitted cart across navigation/reload", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("草稿批量測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByText("一次建立多項商品", { exact: true }).click();
  await page.getByLabel("商品名稱清單（每行一項）").fill("星空徽章\n海洋吊飾");
  await page
    .getByRole("button", { name: "確認批量建立商品", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已一次建立 2 項商品");
  await page
    .getByRole("button", { name: "編輯 星空徽章", exact: true })
    .click();
  await page.getByLabel("新創作者名稱").fill("甲");
  await page.getByLabel("周邊種類", { exact: true }).fill("徽章");
  await page.getByRole("button", { name: "儲存變更", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已更新");
  await page.getByLabel("搜尋商品、創作者、企劃或種類").fill("甲");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await expect(page.locator(".product-card")).toContainText("星空徽章");
  await page.goto("#/inventory");
  await page.getByLabel("庫位名稱", { exact: true }).fill("攤位");
  await page.getByRole("button", { name: "建立庫位", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("庫位已建立");
  await page.getByLabel("商品", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("目的庫位", { exact: true })
    .selectOption({ label: "攤位" });
  await page.getByLabel("數量", { exact: true }).fill("3");
  await page.getByLabel("異動原因／批次註記").fill("入庫");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  await page.goto("#/sales");
  await page.getByLabel("出貨庫位（必填）").selectOption({ label: "攤位" });
  const product = page
    .locator(".product-grid article")
    .filter({
      has: page.getByRole("heading", { name: "星空徽章", exact: true }),
    });
  await product.getByRole("button", { name: "指定購買", exact: true }).click();
  await page
    .locator(".cart-line")
    .getByLabel("數量", { exact: true })
    .fill("2");
  await page.locator(".cart-line").getByLabel("單價（新台幣整元）").fill("60");
  await page.getByLabel("收到金額（新台幣整元）").fill("200");
  await page.getByRole("link", { name: "庫存與盤點", exact: true }).click();
  await page.getByRole("link", { name: "攤位販售", exact: true }).click();
  await expect(
    page.locator(".cart-line").getByLabel("數量", { exact: true }),
  ).toHaveValue("2");
  await expect(
    page.locator(".cart-line").getByLabel("單價（新台幣整元）"),
  ).toHaveValue("60");
  await expect(page.getByLabel("收到金額（新台幣整元）")).toHaveValue("200");
  await expect(product).toContainText("目前庫位現存 3");
  await page.reload();
  await expect(
    page.locator(".cart-line").getByLabel("數量", { exact: true }),
  ).toHaveValue("2");
  await page.getByRole("button", { name: "確認收款", exact: true }).click();
  await page
    .getByRole("button", { name: "完成交易並扣庫", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "交易已完成" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".cart-line")).toHaveCount(0);
  await expect(
    page.getByText("工作區有效交易營收：120 元", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});
