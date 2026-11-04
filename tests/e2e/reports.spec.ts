import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";

test("reports distinguish sales and actual cash, export only queried values, and stay read-only offline", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await page.goto("#/reports");
  await expect(
    page.getByRole("heading", { name: "先選擇或建立工作區", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "前往工作區總覽", exact: true }).click();
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("報表測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("報表徽章");
  await page.getByLabel("新創作者名稱").fill("甲");
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
  await page.getByLabel("異動原因").fill("報表案例");
  await page.getByRole("button", { name: "確認登記異動", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  await page.goto("#/sales");
  await page.getByLabel("出貨庫位（必填）").selectOption({ label: "攤位" });
  await page
    .locator(".product-grid article")
    .getByRole("button", { name: "指定購買", exact: true })
    .click();
  await page.getByLabel("單價（新台幣整元）").fill("100");
  await page.getByLabel("收到金額（新台幣整元）").fill("200");
  await page.getByRole("button", { name: "確認收款", exact: true }).click();
  await page
    .getByRole("button", { name: "完成交易並扣庫", exact: true })
    .click();
  await expect(
    page.locator(".success-notice").filter({ hasText: "交易已完成" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /部分退款／退貨 / }).click();
  await page.getByLabel("本次實退金額（元）").fill("20");
  await page
    .getByLabel("退款／退貨原因", { exact: true })
    .fill("退差額，不退實物");
  await page
    .getByLabel("我確認已完成上述退款與退貨；填寫的回庫商品可再次販售")
    .check();
  await page
    .getByRole("button", { name: "記錄退款／退貨", exact: true })
    .click();
  await expect(
    page.locator(".success-notice").filter({ hasText: "退款／退貨已記錄" }),
  ).toBeVisible();
  const snapshot = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("conmate-workspaces-v1");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        return await new Promise<string>((resolve, reject) => {
          const r = db
            .transaction("catalogs", "readonly")
            .objectStore("catalogs")
            .getAll();
          r.onsuccess = () => resolve(JSON.stringify(r.result));
          r.onerror = () => reject(r.error);
        });
      } finally {
        db.close();
      }
    });
  const before = await snapshot();
  await page
    .getByRole("navigation", { name: "主要導覽" })
    .getByRole("link", { name: "營運報表", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "營運報表", exact: true }),
  ).toBeVisible();
  const metrics = page.locator('dl[aria-label="銷售總計"]');
  await expect(
    metrics
      .locator("div")
      .filter({ has: page.locator("dt", { hasText: /^退款後營收$/ }) }),
  ).toContainText("80 元");
  await expect(
    metrics
      .locator("div")
      .filter({ has: page.locator("dt", { hasText: /^未知成本數量$/ }) }),
  ).toContainText("1");
  await expect(metrics).toContainText("尚無法完整試算");
  await page.getByLabel("分組方式", { exact: true }).selectOption("creator");
  await expect(
    page.getByRole("region", { name: "銷售分組表", exact: true }),
  ).toContainText("甲");
  await page.getByLabel("開始日期（台灣時間）").fill("2099-01-01");
  await expect(
    page.getByText("目前篩選範圍沒有成交明細。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("開始日期（台灣時間）").fill("");
  await page.getByRole("button", { name: "實際收退款", exact: true }).click();
  const cash = page.locator('dl[aria-label="收退款總計"]');
  await expect(
    cash
      .locator("div")
      .filter({ has: page.locator("dt", { hasText: /^實際流入$/ }) }),
  ).toContainText("100 元");
  await expect(
    cash
      .locator("div")
      .filter({ has: page.locator("dt", { hasText: /^實際流出$/ }) }),
  ).toContainText("20 元");
  await expect(
    cash
      .locator("div")
      .filter({ has: page.locator("dt", { hasText: /^收退淨額$/ }) }),
  ).toContainText("80 元");
  await expect(
    page.getByRole("region", { name: "實際收退款明細表", exact: true }),
  ).toContainText("未記錄");
  await page.getByRole("link", { name: "這頁怎麼用？", exact: true }).click();
  await expect(page.locator("#help-reports")).toHaveAttribute("open", "");
  await page.goto("#/reports");
  await expect(page.getByText("· 已可離線開啟", { exact: true })).toBeAttached({
    timeout: 30000,
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "營運報表", exact: true }),
  ).toBeVisible();
  await expect(page.locator('dl[aria-label="銷售總計"]')).toContainText(
    "80 元",
  );
  const got = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "匯出目前篩選報表（Excel）", exact: true })
    .click();
  const download = await got;
  const path = await download.path();
  expect(path).not.toBeNull();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(readFileSync(path!) as unknown as ArrayBuffer);
  expect(book.worksheets.length).toBeGreaterThanOrEqual(4);
  expect(book.worksheets.every((w) => w.state === "visible")).toBe(true);
  expect(book.getWorksheet("_ConMate資料")).toBeUndefined();
  let text = "";
  for (const w of book.worksheets)
    w.eachRow((r) =>
      r.eachCell((c) => {
        expect(c.type).not.toBe(ExcelJS.ValueType.Formula);
        text += String(c.value) + " ";
      }),
    );
  expect(text).toContain("報表徽章");
  expect(text).toContain("報表");
  await expect(
    page.getByRole("status").filter({ hasText: "閱讀用營運報表" }),
  ).toBeVisible();
  expect(await snapshot()).toBe(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
