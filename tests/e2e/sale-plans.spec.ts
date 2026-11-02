import { test, expect } from "@playwright/test";
test("uses mixed draw pool and direct price with one shared stock and stable sale history", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("混合池測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  for (const name of ["甲徽章", "乙吊飾"]) {
    await page.getByLabel("商品名稱（必填）").fill(name);
    await page.getByRole("button", { name: "建立商品", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("商品已建立");
  }
  await page.goto("#/inventory");
  await page.getByLabel("庫位名稱", { exact: true }).fill("攤位");
  await page.getByRole("button", { name: "建立庫位", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("庫位已建立");
  for (const name of ["甲徽章", "乙吊飾"]) {
    await page
      .getByLabel("商品", { exact: true })
      .selectOption({ index: name === "甲徽章" ? 1 : 2 });
    await page
      .getByLabel("目的庫位", { exact: true })
      .selectOption({ label: "攤位" });
    await page.getByLabel("數量", { exact: true }).fill("3");
    await page.getByLabel("異動原因／批次註記").fill("入庫");
    await page.getByRole("button", { name: "確認登記異動" }).click();
    await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  }
  await page.goto("#/sales");
  await page.getByLabel("出貨庫位（必填）").selectOption({ label: "攤位" });
  const panel = page.locator('section[aria-labelledby="plans-title"]');
  await panel.locator("summary").click();
  await page.getByLabel("方案名稱（必填）").fill("徽章吊飾混池");
  await page.getByLabel("販售方式", { exact: true }).selectOption("draw");
  await page.getByLabel("每件／每抽售價（整元）").fill("50");
  await panel.getByLabel(/甲徽章 ·/).check();
  await panel.getByLabel(/乙吊飾 ·/).check();
  await page.getByRole("button", { name: "儲存販售方案", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("販售方案已儲存");
  await page
    .getByLabel("目前販售方案")
    .selectOption({ label: "徽章吊飾混池 · 50 元 · 抽選" });
  const cards = page.locator(".product-grid article");
  await cards
    .filter({ has: page.getByRole("heading", { name: "甲徽章", exact: true }) })
    .getByRole("button", { name: "抽選結果", exact: true })
    .click();
  await expect(
    page.locator(".cart-line").getByLabel("單價（新台幣整元）"),
  ).toHaveValue("50");
  await expect(
    page.locator(".cart-line").getByLabel("單價（新台幣整元）"),
  ).toHaveAttribute("readonly", "");
  await page.getByLabel("目前販售方案").selectOption("");
  await cards
    .filter({ has: page.getByRole("heading", { name: "甲徽章", exact: true }) })
    .getByRole("button", { name: "指定購買", exact: true })
    .click();
  await page
    .locator(".cart-line")
    .filter({ hasText: "指定" })
    .getByLabel("單價（新台幣整元）")
    .fill("80");
  await page.getByLabel("收到金額（新台幣整元）").fill("130");
  await page.getByRole("button", { name: "確認收款", exact: true }).click();
  await page
    .getByRole("button", { name: "完成交易並扣庫", exact: true })
    .click();
  await expect(
    page.locator(".success-notice").filter({ hasText: "交易已完成" }),
  ).toBeVisible();
  await expect(
    page.getByText("徽章吊飾混池（版本 1）", { exact: false }),
  ).toBeVisible();
  await expect(
    cards.filter({
      has: page.getByRole("heading", { name: "甲徽章", exact: true }),
    }),
  ).toContainText("目前庫位現存 1");
  await panel
    .getByRole("button", { name: "編輯 徽章吊飾混池", exact: true })
    .click();
  await page.getByLabel("每件／每抽售價（整元）").fill("60");
  await page.getByRole("button", { name: "儲存販售方案", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("販售方案已儲存");
  await expect(
    page.getByText("徽章吊飾混池（版本 1）", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});
