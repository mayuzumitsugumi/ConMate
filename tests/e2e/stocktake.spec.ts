import { test, expect } from "@playwright/test";
test("counts stock, preserves pending differences, applies explicit adjustment and shows event summary", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("收攤盤點測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("盤點徽章");
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
  await page.getByLabel("異動原因").fill("入庫");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  const panel = page.getByRole("region", { name: "收攤盤點與場次摘要" });
  await panel.getByText("建立盤點單", { exact: true }).click();
  await panel.getByLabel("盤點名稱", { exact: true }).fill("首日收攤");
  await panel
    .getByLabel("盤點庫位", { exact: true })
    .selectOption({ label: "攤位" });
  await panel.getByRole("button", { name: "開始盤點並保存帳面快照" }).click();
  await expect(panel.getByRole("status")).toContainText("盤點單已建立");
  await panel.getByLabel("盤點徽章實點數量", { exact: true }).fill("8");
  await panel
    .getByRole("button", { name: "儲存實點數量", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("尚未調整庫存");
  await page.reload();
  await panel
    .getByLabel("盤點紀錄", { exact: true })
    .selectOption({ index: 1 });
  await expect(
    panel.getByLabel("盤點徽章實點數量", { exact: true }),
  ).toHaveValue("8");
  await panel
    .getByLabel("盤點徽章差異處理", { exact: true })
    .selectOption("adjust");
  await panel
    .getByLabel("盤點徽章差異原因", { exact: true })
    .fill("少兩個，已確認需調整");
  await panel.getByRole("button", { name: "完成盤點", exact: true }).click();
  await expect(
    panel.getByRole("region", { name: "盤點完成確認" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "確認完成並套用所選差異" }).click();
  await expect(panel.getByRole("status")).toContainText("盤點單已完成");
  await expect(
    page.getByRole("table").getByRole("row").filter({ hasText: "盤點徽章" }),
  ).toContainText("8");
  await expect(
    panel.getByLabel("盤點徽章實點數量", { exact: true }),
  ).toBeDisabled();
  await panel.getByText("場次營收摘要", { exact: true }).click();
  await expect(panel).toContainText("有效營收 0 元");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
