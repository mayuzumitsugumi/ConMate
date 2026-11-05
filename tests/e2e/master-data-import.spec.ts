import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

test("imports a master-data template after preview and confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("主資料匯入測試");
  await page
    .getByRole("button", { name: "建立工作區", exact: true })
    .last()
    .click();

  await page.getByRole("link", { name: "專案檔與備份", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下載主資料匯入範本" }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error("未能讀取匯入範本下載檔。");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  workbook
    .getWorksheet("01_參與方")!
    .addRow(["", "new-artist", "測試創作者", ""]);
  workbook.getWorksheet("02_企劃")!.addRow(["", "new-project", "測試企劃", ""]);
  workbook
    .getWorksheet("04_場次")!
    .addRow([
      "",
      "new-event",
      "測試場次",
      "2026-11-06",
      "2026-11-06",
      "台北",
      "",
      "new:new-project",
      "使用中",
    ]);
  workbook
    .getWorksheet("05_柄圖")!
    .addRow([
      "",
      "new-artwork",
      "測試柄圖",
      "new:new-project",
      "new:new-artist",
      "",
      "使用中",
    ]);
  workbook
    .getWorksheet("06_標記")!
    .addRow(["", "new-tag", "測試標記", "使用中"]);
  workbook
    .getWorksheet("07_自訂欄位")!
    .addRow(["", "new-field", "測試款式", "single", "使用中"]);
  workbook
    .getWorksheet("08_欄位選項")!
    .addRow(["", "new-field", "", "new-option", "一般款", "使用中"]);
  workbook
    .getWorksheet("03_商品")!
    .addRow([
      "",
      "new-product",
      "測試商品",
      "",
      "new:new-artist",
      "new:new-project",
      "吊飾",
      "6cm",
      "測試柄圖",
      "new:new-artwork",
      "",
      "new:new-tag",
    ]);
  const bytes = await workbook.xlsx.writeBuffer();
  await page.locator("#master-import-file").setInputFiles({
    name: "master-data-import.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(bytes as ArrayBuffer),
  });

  await expect(
    page.getByText("新增商品：測試商品", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("新增場次：測試場次", { exact: false })).toBeVisible();
  await expect(page.getByText("新增自訂欄位：測試款式", { exact: false })).toBeVisible();
  await page.getByLabel("我已檢查差異，確認一次匯入以上主資料變更").check();
  await page.getByRole("button", { name: "確認匯入主資料" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已匯入" }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("link", { name: "商品建檔", exact: true }).click();
  await expect(page.getByText("測試商品", { exact: true })).toBeVisible();
});
