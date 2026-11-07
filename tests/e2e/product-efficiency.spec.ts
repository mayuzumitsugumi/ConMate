import { test, expect } from "@playwright/test";

test("local thumbnail, barcode selection and reviewed bulk notes survive backup and offline reopen", async ({
  page,
  context,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("效率驗收");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await expect(page.getByText("· 已可離線開啟", { exact: true })).toBeAttached({
    timeout: 30000,
  });
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("縮圖徽章");
  await page.getByLabel("條碼（選填，最多80字）").fill("001234");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#42aa77";
    ctx.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page
    .getByLabel("本機商品縮圖")
    .setInputFiles({
      name: "local.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await expect(page.getByAltText("商品縮圖預覽")).toBeVisible();
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  const card = page
    .locator(".product-card")
    .filter({
      has: page.getByRole("heading", { name: "縮圖徽章", exact: true }),
    });
  await card.getByLabel("選取", { exact: true }).check();
  await page.getByText("大量更新已選商品備註（1項）", { exact: true }).click();
  await page.getByLabel("共同備註").fill("離線販售備註");
  await page.getByRole("button", { name: "預覽變更", exact: true }).click();
  await expect(
    page.getByText("縮圖徽章：（空白） → 離線販售備註", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "確認整批更新備註", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("商品備註已整批更新");
  await page.goto("#/sales");
  await page.getByLabel("條碼／商品代碼（掃碼槍或手動輸入）").fill("001234");
  await page.getByLabel("條碼／商品代碼（掃碼槍或手動輸入）").press("Enter");
  await expect(
    page.getByText("找到商品，請選取。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cart-line")).toHaveCount(0);
  await page.getByRole("button", { name: /縮圖徽章 · SKU/ }).click();
  await expect(page.locator(".product-grid article")).toHaveCount(1);
  await expect(page.locator(".cart-line")).toHaveCount(0);
  await page.goto("#/templates");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "一鍵匯出專案檔（Excel）", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  await context.setOffline(true);
  await page.goto("#/products");
  await page.reload();
  await expect(page.getByAltText("縮圖徽章縮圖")).toBeVisible();
  await page
    .getByRole("button", { name: "編輯 縮圖徽章", exact: true })
    .click();
  await expect(page.getByLabel("條碼（選填，最多80字）")).toHaveValue("001234");
  await expect(page.getByLabel("備註", { exact: true })).toHaveValue(
    "離線販售備註",
  );
});
