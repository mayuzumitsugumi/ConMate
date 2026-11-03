import { test, expect } from "@playwright/test";
test("records partial refunds and separates saleable/damaged returns with linked replacement", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("退款測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("徽章");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page.goto("#/inventory");
  await page.getByLabel("庫位名稱", { exact: true }).fill("攤位");
  await page.getByRole("button", { name: "建立庫位", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("庫位已建立");
  await page.getByLabel("商品", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("目的庫位", { exact: true })
    .selectOption({ label: "攤位" });
  await page.getByLabel("數量", { exact: true }).fill("3");
  await page.getByLabel("異動原因").fill("入庫");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  await page.goto("#/sales");
  await page.getByLabel("出貨庫位（必填）").selectOption({ label: "攤位" });
  const product = page.locator(".product-grid article").first();
  await product.getByRole("button", { name: "指定購買", exact: true }).click();
  await page
    .locator(".cart-line")
    .getByLabel("數量", { exact: true })
    .fill("2");
  await page.locator(".cart-line").getByLabel("單價（新台幣整元）").fill("50");
  await page.getByLabel("收到金額（新台幣整元）").fill("100");
  await page.getByRole("button", { name: "確認收款", exact: true }).click();
  await page
    .getByRole("button", { name: "完成交易並扣庫", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("交易已完成");
  await page.getByRole("button", { name: /部分退款／退貨 SAL/ }).click();
  await page.getByLabel("本次實退金額（元）", { exact: true }).fill("25");
  await page.getByLabel("本次可售回庫數量", { exact: true }).fill("1");
  await page
    .getByLabel("退款／退貨原因", { exact: true })
    .fill("退一件部分退款");
  await page
    .getByLabel("我確認已完成上述退款與退貨；填寫的回庫商品可再次販售")
    .check();
  await page
    .getByRole("button", { name: "記錄退款／退貨", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "退款／退貨已記錄" }),
  ).toBeVisible();
  await expect(product).toContainText("目前庫位現存 2");
  await expect(
    page.getByText("工作區有效交易營收：75 元", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "取消／全額退款並回庫", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /部分退款／退貨 SAL/ }).click();
  await page.getByLabel("本次實退金額（元）", { exact: true }).fill("75");
  await page.getByLabel("本次瑕疵退回數量", { exact: true }).fill("1");
  await page
    .getByLabel("退款／退貨原因", { exact: true })
    .fill("瑕疵退回不回可售");
  await page
    .getByLabel("我確認已完成上述退款與退貨；填寫的回庫商品可再次販售")
    .check();
  await page
    .getByRole("button", { name: "記錄退款／退貨", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "退款／退貨已記錄" }),
  ).toBeVisible();
  await expect(product).toContainText("目前庫位現存 2");
  await expect(
    page.getByText("工作區有效交易營收：0 元", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /另建換貨交易/ })
    .last()
    .click();
  await product.getByRole("button", { name: "指定購買", exact: true }).click();
  await page.locator(".cart-line").getByLabel("單價（新台幣整元）").fill("0");
  await page.getByLabel("收到金額（新台幣整元）").fill("0");
  await page.getByRole("button", { name: "確認收款", exact: true }).click();
  await page
    .getByRole("button", { name: "完成交易並扣庫", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "交易已完成" }),
  ).toBeVisible();
  await expect(product).toContainText("目前庫位現存 1");
  await expect(page.getByText(/換貨來源：REF/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/換貨來源：REF/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});
