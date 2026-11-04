import { test, expect } from "@playwright/test";

test("physical unit labels follow selected transfer, sale and exact return without adding stock", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("特殊單件測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("親簽立牌");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page.goto("#/inventory");
  for (const name of ["攤位", "保管箱"]) {
    await page.getByLabel("庫位名稱", { exact: true }).fill(name);
    await page.getByRole("button", { name: "建立庫位", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("庫位已建立");
  }
  await page.getByLabel("商品", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("目的庫位", { exact: true })
    .selectOption({ label: "攤位" });
  await page.getByLabel("數量", { exact: true }).fill("3");
  await page.getByLabel("入庫批次名稱（選填）").fill("首刷");
  await page.getByLabel("異動原因").fill("到貨三件");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  const units = page.getByRole("region", { name: "特殊單件追蹤", exact: true });
  await units
    .getByLabel("單件商品", { exact: true })
    .selectOption({ label: "親簽立牌" });
  await units.getByLabel("實物所在庫位").selectOption({ label: "攤位" });
  await units.getByLabel("單件來源批次").selectOption({ index: 1 });
  await units.getByLabel("實物標記（一行一件）").fill("簽名 A01\n簽名 A02");
  await units
    .getByRole("button", { name: "登記特殊單件", exact: true })
    .click();
  await expect(units.getByRole("status")).toContainText("現存總數量不變");
  await expect(
    page.getByRole("table").getByRole("row").filter({ hasText: "親簽立牌" }),
  ).toContainText("3");
  await page.getByLabel("異動類型", { exact: true }).selectOption("transfer");
  await page
    .getByLabel("來源庫位", { exact: true })
    .selectOption({ label: "攤位" });
  await page
    .getByLabel("目的庫位", { exact: true })
    .selectOption({ label: "保管箱" });
  await page
    .getByRole("group", { name: "本次異動的特殊單件" })
    .getByLabel("簽名 A01", { exact: true })
    .check();
  await page.getByLabel("異動原因").fill("A01獨立保管");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(
    page.locator(".success-notice").filter({ hasText: "庫存異動已儲存" }),
  ).toBeVisible();
  await expect(
    units.locator(".unit-list article").filter({ hasText: "簽名 A01" }),
  ).toContainText("保管箱");
  await page.goto("#/sales");
  await page.getByLabel("出貨庫位（必填）").selectOption({ label: "攤位" });
  const card = page
    .locator(".product-grid article")
    .filter({
      has: page.getByRole("heading", { name: "親簽立牌", exact: true }),
    });
  await card.getByRole("button", { name: "指定購買", exact: true }).click();
  await page
    .getByRole("group", { name: "選擇實際交付單件", exact: true })
    .getByLabel("簽名 A02", { exact: true })
    .check();
  await page.getByLabel("單價（新台幣整元）").fill("100");
  await page.getByLabel("收到金額（新台幣整元）").fill("100");
  await page.getByRole("button", { name: "確認收款", exact: true }).click();
  await page
    .getByRole("button", { name: "完成交易並扣庫", exact: true })
    .click();
  await expect(
    page.locator(".success-notice").filter({ hasText: "交易已完成" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /部分退款／退貨 / }).click();
  const returnPicker = page.getByRole("group", {
    name: "選擇實際退回的特殊單件",
    exact: true,
  });
  await expect(returnPicker).toContainText("簽名 A02");
  await expect(returnPicker).not.toContainText("簽名 A01");
  await returnPicker.getByLabel("可售回庫", { exact: true }).check();
  await page.getByLabel("本次實退金額（元）").fill("100");
  await page.getByLabel("退款／退貨原因", { exact: true }).fill("退回原 A02");
  await page
    .getByLabel("我確認已完成上述退款與退貨；填寫的回庫商品可再次販售")
    .check();
  await page
    .getByRole("button", { name: "記錄退款／退貨", exact: true })
    .click();
  await expect(
    page.locator(".success-notice").filter({ hasText: "退款／退貨已記錄" }),
  ).toBeVisible();
  await page.goto("#/inventory");
  await expect(
    units.locator(".unit-list article").filter({ hasText: "簽名 A02" }),
  ).toContainText("可用 · 攤位");
  await page.reload();
  await expect(
    units.locator(".unit-list article").filter({ hasText: "簽名 A01" }),
  ).toContainText("保管箱");
  await expect(
    units.locator(".unit-list article").filter({ hasText: "簽名 A02" }),
  ).toContainText("可用 · 攤位");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
