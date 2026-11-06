import { test, expect } from "@playwright/test";
test("preorder receipts, partial delivery, cancellation and original goods return remain separate while offline", async ({
  page,
  context,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("預售離線測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("預售徽章");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page.goto("#/inventory");
  await page.getByLabel("庫位名稱", { exact: true }).fill("出貨架");
  await page.getByRole("button", { name: "建立庫位", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("庫位已建立");
  await page.getByLabel("商品", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("目的庫位", { exact: true })
    .selectOption({ label: "出貨架" });
  await page.getByLabel("數量", { exact: true }).fill("3");
  await page.getByLabel("異動原因").fill("實際到貨");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto("#/preorders");
  await page.getByLabel("預售單名稱（必填）").fill("訂單 A001");
  await page.getByLabel("顧客參考代號").fill("顧客 A");
  await page
    .getByLabel("預售商品 1", { exact: true })
    .selectOption({ label: "預售徽章" });
  await page.getByLabel("預訂數量 1", { exact: true }).fill("3");
  await page.getByLabel("約定單價 1（元）", { exact: true }).fill("100");
  await page.getByRole("button", { name: "建立預售單", exact: true }).click();
  await expect(page.locator(".success-notice")).toContainText("預售單已建立");
  const payment = async (kind: "receipt" | "refund", reason: string) => {
    await page.getByLabel("款項類型").selectOption(kind);
    await page.getByLabel("本次實際金額（元）").fill("100");
    await page.getByLabel("收退說明").fill(reason);
    await page.getByLabel("我確認本次款項已實際收到或退還").check();
    await page.getByRole("button", { name: "保存實際款項" }).click();
    await expect(page.locator(".success-notice")).toContainText(
      "實際款項已保存",
    );
  };
  const deliver = async (reason: string) => {
    await page.getByLabel("交付訂單品項").selectOption({ index: 1 });
    await page.getByLabel("實際出貨庫位").selectOption({ label: "出貨架" });
    await page.getByLabel("本次交付數量").fill("1");
    await page.getByLabel("實際交付說明").fill(reason);
    await page.getByLabel("我確認本次商品已實際交付顧客").check();
    await page.getByRole("button", { name: "保存實際交付並扣庫" }).click();
    await expect(page.locator(".success-notice")).toContainText("交付已保存");
  };
  await payment("receipt", "訂金100");
  await page.getByText("分批實際交付", { exact: true }).click();
  await deliver("第一次交付1件");
  await page.getByText("取消尚未交付品項", { exact: true }).click();
  await page.getByLabel("取消訂單品項").selectOption({ index: 1 });
  await page.getByLabel("本次取消數量").fill("1");
  await page.getByLabel("取消原因", { exact: true }).fill("顧客取消未交付1件");
  await page.getByRole("button", { name: "確認取消未交付數量" }).click();
  await expect(page.locator(".success-notice")).toContainText(
    "未交付數量已取消",
  );
  await payment("receipt", "尾款100");
  await deliver("第二次交付1件");
  await page.getByText("已交付商品退貨", { exact: true }).click();
  await page.getByLabel("原交付明細").selectOption({ index: 1 });
  await page.getByLabel("可售退回數量", { exact: true }).fill("1");
  await page.getByLabel("可售退回庫位").selectOption({ label: "出貨架" });
  await page.getByLabel("實物退貨原因").fill("原件可售退回");
  await page.getByLabel("我確認所填商品已退回，並核對可售／不可售狀態").check();
  await page.getByRole("button", { name: "保存退貨與交付抵減" }).click();
  await expect(page.locator(".success-notice")).toContainText("這不是現金退款");
  await payment("refund", "確認實際退還100");
  await page.getByLabel("結束／重新開啟原因").fill("訂單已完成核對");
  await page.getByRole("button", { name: "結束預售單", exact: true }).click();
  await expect(page.locator(".success-notice")).toContainText("預售狀態已更新");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "預售與交付", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新開啟預售單" }),
  ).toBeVisible();
  // Confirm actual unpaid handover explicitly; it must not fabricate a receipt.
  await page.getByLabel("預售單名稱（必填）").fill("欠款交付 B002");
  await page
    .getByLabel("預售商品 1", { exact: true })
    .selectOption({ label: "預售徽章" });
  await page.getByLabel("預訂數量 1", { exact: true }).fill("1");
  await page.getByLabel("約定單價 1（元）", { exact: true }).fill("100");
  await page.getByRole("button", { name: "建立預售單", exact: true }).click();
  await expect(page.locator(".success-notice")).toContainText("預售單已建立");
  await page.getByText("分批實際交付", { exact: true }).click();
  await page.getByLabel("交付訂單品項").selectOption({ index: 1 });
  await page.getByLabel("實際出貨庫位").selectOption({ label: "出貨架" });
  await page.getByLabel("本次交付數量").fill("1");
  await page.getByLabel("實際交付說明").fill("實際交付，款項待收");
  await page.getByLabel("我確認本次商品已實際交付顧客").check();
  await page.getByRole("button", { name: "保存實際交付並扣庫" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByLabel("我確認即使尚未足額收款，仍已實際交付，並保留未收款差額。")
    .check();
  await page.getByRole("button", { name: "保存實際交付並扣庫" }).click();
  await expect(page.locator(".success-notice")).toContainText("交付已保存");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await context.setOffline(false);
});
