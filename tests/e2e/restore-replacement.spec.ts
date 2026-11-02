import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
test("explicit replacement previews loss, keeps recovery and records backup confirmation", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("安全取代");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("舊商品");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page.goto("#/templates");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "一鍵匯出專案檔（Excel）", exact: true })
    .click();
  const file = await pending;
  const upload = {
    name: file.suggestedFilename(),
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync((await file.path())!),
  };
  await expect(
    page.getByRole("button", { name: "我已確認下載檔已保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "我已確認下載檔已保存" }).click();
  await expect(page.getByLabel("備份提醒")).not.toBeVisible();
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("較新的商品");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await expect(page.getByLabel("備份提醒")).toContainText("更新");
  await page.goto("#/templates");
  await page.getByLabel("選擇 Excel 專案檔").setInputFiles(upload);
  await expect(
    page.getByRole("heading", { name: "檢查通過：安全取代" }),
  ).toBeVisible();
  const button = page.getByRole("button", {
    name: "確認取代本機工作區",
    exact: true,
  });
  await expect(button).toBeDisabled();
  await page.getByLabel("我要以檔案完整取代本機同一工作區").check();
  await page.getByLabel("請輸入「取代工作區」確認").fill("取代工作區");
  await page.getByLabel("我已檢視差異").check();
  await button.click();
  await expect(
    page.getByText("取代完成，修訂已更新為", { exact: false }),
  ).toBeVisible();
  await page.goto("#/products");
  await expect(
    page.getByRole("heading", { name: "舊商品", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "較新的商品", exact: true }),
  ).not.toBeVisible();
  await page.goto("#/templates");
  await page
    .getByRole("button", { name: "預覽此復原快照", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "檢查通過：安全取代" }),
  ).toBeVisible();
  await page.getByLabel("我要以檔案完整取代本機同一工作區").check();
  await page.getByLabel("請輸入「取代工作區」確認").fill("取代工作區");
  await page.getByLabel("我已檢視差異").check();
  await page
    .getByRole("button", { name: "確認取代本機工作區", exact: true })
    .click();
  await expect(
    page.getByText("取代完成，修訂已更新為", { exact: false }),
  ).toBeVisible();
  await page.goto("#/products");
  await expect(
    page.getByRole("heading", { name: "較新的商品", exact: true }),
  ).toBeVisible();
});
