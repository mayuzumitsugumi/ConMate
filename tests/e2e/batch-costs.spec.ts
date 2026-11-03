import { test, expect } from "@playwright/test";
test("links explicit batch cost for future sales while keeping prior cost unknown", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("批次成本測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("成本徽章");
  await page.getByLabel("新創作者名稱").fill("甲");
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
  await page.getByLabel("數量", { exact: true }).fill("3");
  await page.getByLabel("入庫批次名稱（選填）").fill("明確首批");
  await page.getByLabel("異動原因", { exact: true }).fill("實際製作");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  const sell = async () => {
    await page.goto("#/sales");
    await page.getByLabel("出貨庫位（必填）").selectOption({ label: "家中" });
    const p = page
      .locator("article")
      .filter({
        has: page.getByRole("heading", { name: "成本徽章", exact: true }),
      });
    await p.getByRole("button", { name: "指定購買", exact: true }).click();
    await page
      .locator(".cart-line")
      .getByLabel("單價（新台幣整元）")
      .fill("100");
    await page.getByLabel("收到金額（新台幣整元）").fill("100");
    await page.getByRole("button", { name: "確認收款", exact: true }).click();
    await page
      .getByRole("button", { name: "完成交易並扣庫", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("交易已完成");
  };
  await sell();
  await page.goto("#/finance");
  await page.getByLabel("批次／成本名稱", { exact: true }).fill("明確製作成本");
  await page.getByLabel("成本商品", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("製作數量", { exact: true }).fill("3");
  await page.getByLabel("實際印製總額（元）", { exact: true }).fill("100");
  await page.getByLabel("本批分配的柄圖費（元）", { exact: true }).fill("0");
  await page.getByLabel("其他成本總額（元）", { exact: true }).fill("0");
  await page.getByRole("button", { name: "建立成本紀錄", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "成本紀錄已儲存" }),
  ).toBeVisible();
  const panel = page.getByRole("region", {
    name: "批次成本與已售成本",
    exact: true,
  });
  await panel.getByLabel("入庫批次（必填）").selectOption({ index: 1 });
  await panel
    .getByLabel("製作成本紀錄", { exact: true })
    .selectOption({ index: 1 });
  await panel.getByLabel("版本說明（必填）").fill("已確認來源，之後生效");
  await panel.getByRole("button", { name: "預覽連結", exact: true }).click();
  await panel
    .getByRole("button", { name: "確認保存成本版本", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("批次成本版本已保存");
  await expect(panel).toContainText("成本未知數量：1");
  await sell();
  await page.goto("#/finance");
  const report = page.getByRole("region", {
    name: "批次成本與已售成本",
    exact: true,
  });
  await expect(report).toContainText("已知成本合計：33.3333");
  await expect(report).toContainText("成本未知數量：1");
  await expect(report).toContainText("66.6667 元");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "批次成本與已售成本", exact: true }),
  ).toContainText("已知成本合計：33.3333");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
