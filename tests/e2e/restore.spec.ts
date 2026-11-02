import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
test("checks a backup without writes, blocks duplicate workspace, and restores on a clean device", async ({
  page,
  browser,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("可還原企劃");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("還原徽章");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page.goto("#/templates");
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "一鍵匯出專案檔（Excel）", exact: true })
    .click();
  const file = await waiting;
  const path = (await file.path())!;
  const upload = {
    name: file.suggestedFilename(),
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(path),
  };
  await page.getByLabel("選擇 Excel 專案檔").setInputFiles(upload);
  await expect(
    page.getByRole("heading", { name: "檢查通過：可還原企劃" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("本機已有相同工作區");
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await fresh.goto("http://127.0.0.1:4173/ConMate/#/templates");
    await fresh.getByLabel("選擇 Excel 專案檔").setInputFiles(upload);
    await expect(
      fresh.getByRole("heading", { name: "檢查通過：可還原企劃" }),
    ).toBeVisible();
    await expect(
      fresh.getByRole("button", { name: "確認新增還原工作區" }),
    ).toBeDisabled();
    await fresh.getByLabel("我確認以檔案中的完整紀錄新增工作區").check();
    await fresh.getByRole("button", { name: "確認新增還原工作區" }).click();
    await expect(fresh.getByRole("status")).toContainText("還原完成");
    await fresh.goto("http://127.0.0.1:4173/ConMate/#/products");
    await expect(
      fresh.getByRole("heading", { name: "還原徽章", exact: true }),
    ).toBeVisible();
    await fresh.reload();
    await expect(
      fresh.getByRole("heading", { name: "還原徽章", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
