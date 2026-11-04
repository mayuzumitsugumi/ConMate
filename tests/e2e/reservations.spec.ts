import { test, expect } from "@playwright/test";

test("dedicated plan stock stays exclusive until explicit release and survives reload", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("專用庫存測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("甲徽章");
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
  await page.getByLabel("數量", { exact: true }).fill("10");
  await page.getByLabel("異動原因").fill("實物到貨");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  await page.goto("#/sales");
  const plans = page.locator('section[aria-labelledby="plans-title"]');
  await plans.locator("summary").click();
  await page.getByLabel("方案名稱（必填）").fill("專用抽選");
  await page.getByLabel("販售方式", { exact: true }).selectOption("draw");
  await page.getByLabel("每件／每抽售價（整元）").fill("50");
  await plans.getByLabel(/甲徽章 ·/).check();
  await page.getByRole("button", { name: "儲存販售方案", exact: true }).click();
  await expect(plans.getByRole("status")).toContainText("販售方案已儲存");
  const reservations = page.locator(
    'section[aria-labelledby="reservation-title"]',
  );
  await reservations.locator("summary").click();
  await page
    .getByLabel("預留方案", { exact: true })
    .selectOption({ label: "專用抽選" });
  await page.getByLabel("預留商品", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("預留庫位", { exact: true })
    .selectOption({ label: "攤位" });
  await page.getByLabel("預留數量", { exact: true }).fill("6");
  await page.getByLabel("預留原因", { exact: true }).fill("保留抽選份數");
  await page.getByRole("button", { name: "確認預留庫存", exact: true }).click();
  await expect(reservations.getByRole("status")).toContainText(
    "專用庫存已預留",
  );
  await page.getByLabel("出貨庫位（必填）").selectOption({ label: "攤位" });
  const card = page
    .locator(".product-grid article")
    .filter({
      has: page.getByRole("heading", { name: "甲徽章", exact: true }),
    });
  await expect(card).toContainText("目前庫位現存 10");
  await expect(card).toContainText("目前共用可售 4");
  await page
    .getByLabel("目前販售方案")
    .selectOption({ label: "專用抽選 · 50 元 · 抽選" });
  await expect(card).toContainText("目前方案可售 6");
  await card.getByRole("button", { name: "抽選結果", exact: true }).click();
  await page.getByLabel("收到金額（新台幣整元）").fill("50");
  await page.getByRole("button", { name: "確認收款", exact: true }).click();
  await page
    .getByRole("button", { name: "完成交易並扣庫", exact: true })
    .click();
  await expect(
    page.locator(".success-notice").filter({ hasText: "交易已完成" }),
  ).toBeVisible();
  await expect(reservations.locator(".reservation-card")).toContainText(
    "尚可售 5",
  );
  await expect(card).toContainText("目前庫位現存 9");
  await page.getByLabel("目前販售方案").selectOption("");
  await expect(card).toContainText("目前共用可售 4");
  await plans
    .getByRole("button", { name: "封存 專用抽選", exact: true })
    .click();
  await expect(plans.getByRole("alert")).toContainText("預留");
  await reservations.getByRole("button", { name: /釋放預留 / }).click();
  await page.getByLabel("釋放原因", { exact: true }).fill("活動改採指定共售");
  await page.getByRole("button", { name: "確認釋放預留", exact: true }).click();
  await expect(reservations.getByRole("status")).toContainText("預留已釋放");
  await expect(card).toContainText("目前共用可售 9");
  await page.reload();
  await page.getByLabel("出貨庫位（必填）").selectOption({ label: "攤位" });
  await expect(card).toContainText("目前共用可售 9");
  await reservations.getByLabel("顯示已釋放預留", { exact: true }).check();
  await expect(reservations.locator(".reservation-card")).toContainText(
    "活動改採指定共售",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});
