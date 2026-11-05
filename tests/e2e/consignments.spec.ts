import { test, expect } from "@playwright/test";
test("consignment separates physical delivery, store sales and actual remittance", async ({
  page,
}) => {
  const pastTaipei = (hours: number) =>
    new Date(Date.now() - hours * 3600000 + 8 * 3600000)
      .toISOString()
      .slice(0, 16);
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("寄賣測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/creators");
  await page.getByLabel("參與方名稱（必填）").fill("星空書店");
  await page.getByRole("button", { name: "建立參與方", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("參與方已建立");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("寄賣徽章");
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
  await page.getByLabel("異動原因").fill("製作到貨");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  await page.goto("#/consignments");
  await page.getByLabel("寄賣單名稱", { exact: true }).fill("書店寄賣");
  await page
    .getByLabel("寄賣店家／合作對象")
    .selectOption({ label: "星空書店" });
  await page.getByRole("button", { name: "建立寄賣單", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("寄賣單已建立");
  await page
    .getByLabel("交付商品", { exact: true })
    .selectOption({ label: "寄賣徽章" });
  await page.getByLabel("交付來源庫位").selectOption({ label: "家中" });
  await page.getByLabel("交付數量").fill("6");
  await page.getByLabel("交付原因／憑據").fill("店家簽收6件");
  await page.getByRole("button", { name: "確認實物已交付" }).click();
  await expect(page.getByRole("status")).toContainText("寄賣商品已交付");
  await page.getByLabel("回報售出商品").selectOption({ index: 1 });
  await page.getByLabel("回報售出數量").fill("2");
  await page.getByLabel("實際售出單價（元）").fill("100");
  await page.getByLabel("實際銷售時間（台灣時間）").fill(pastTaipei(3));
  await page.getByLabel("銷售回報來源／說明").fill("店家日報");
  await page.getByRole("button", { name: "確認銷售回報並扣庫" }).click();
  await expect(page.getByRole("status")).toContainText("寄賣銷售回報已保存");
  const summary = page.locator(".business-panel").filter({
    has: page.getByRole("heading", { name: "書店寄賣", exact: true }),
  });
  await expect(summary).toContainText("尚無法試算");
  await expect(
    summary
      .locator("dl > div")
      .filter({ has: page.locator("dt", { hasText: "實際已收匯款" }) }),
  ).toContainText("0 元");
  await page.getByLabel("累計店家費用（元，可留白）").fill("20");
  await page.getByLabel("累計其他調整（元，可正負或留白）").fill("0");
  await page.getByLabel("對帳依據／變更原因").fill("店家費用20元");
  await page.getByRole("button", { name: "保存對帳版本" }).click();
  await expect(page.getByRole("status")).toContainText("對帳金額已保存");
  await expect(summary).toContainText("180 元");
  await page.getByLabel("本次實收金額（元）").fill("180");
  await page.getByLabel("實收時間（台灣時間）").fill(pastTaipei(1));
  await page.getByLabel("實收說明／憑據").fill("銀行已收到");
  await page.getByRole("button", { name: "確認已實際收款" }).click();
  await expect(page.getByRole("status")).toContainText("實際匯款已記錄");
  await page.getByRole("button", { name: /部分退款／退貨 / }).click();
  await page.getByLabel("本次實退金額（元）").fill("100");
  await page.getByLabel("本次可售回庫數量").fill("1");
  await page.getByLabel("退款／退貨原因", { exact: true }).fill("店家退款回報");
  await page
    .getByLabel("我確認店家已完成上述退款與退貨；回庫商品可再次販售")
    .check();
  await page
    .getByRole("button", { name: "記錄退款／退貨", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "店家退款／退貨回報已保存" }),
  ).toBeVisible();
  await page.getByLabel("收回商品", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("收回目的庫位").selectOption({ label: "家中" });
  await page.getByLabel("實際收回數量").fill("5");
  await page.getByLabel("實物收回說明").fill("店家退回5件");
  await page.getByRole("button", { name: "確認實物已收回" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "剩餘商品已記錄實物收回" }),
  ).toBeVisible();
  await page.getByLabel("結束／重新開啟原因").fill("多收100待另行核對");
  await page.getByRole("button", { name: "確認結束寄賣單" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "寄賣單已結束" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "重新開啟寄賣單", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
