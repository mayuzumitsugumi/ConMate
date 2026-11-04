import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
async function activityDownload(page: Page, button: string) {
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const file = await wait;
  return {
    name: file.suggestedFilename(),
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync((await file.path())!),
  };
}
async function notice(page: Page, text: string) {
  await expect(
    page.locator(".success-notice").filter({ hasText: text }),
  ).toBeVisible();
}

test("physical unit labels follow selected transfer, sale and exact return without adding stock", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
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
  const card = page.locator(".product-grid article").filter({
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

  await page.goto("#/projects");
  await page.getByLabel("場次名稱（必填）").fill("親簽短期活動");
  await page.getByLabel("開始日期（必填）").fill("2027-01-10");
  await page.getByRole("button", { name: "建立場次", exact: true }).click();
  await notice(page, "場次已建立");
  await page.goto("#/activities");
  await page.getByLabel("交接名稱（必填）").fill("A01單件交接");
  await page
    .getByLabel("活動（必填）", { exact: true })
    .selectOption({ label: "親簽短期活動" });
  await page
    .getByLabel("交付來源庫位（必填）")
    .selectOption({ label: "保管箱" });
  await page.getByLabel("親簽立牌", { exact: true }).check();
  await page
    .getByRole("group", { name: "本份交付的特殊單件", exact: true })
    .getByLabel("簽名 A01", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "確認交付並建立活動檔", exact: true })
    .click();
  await notice(page, "交接份已建立");
  const outgoing = await activityDownload(page, "匯出 A01單件交接");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(outgoing.buffer as never);
  const parts: string[] = [];
  workbook.getWorksheet("_ConMate活動資料")!.eachRow((row) => {
    if (String(row.getCell(1).value).startsWith("payload-"))
      parts.push(String(row.getCell(2).value));
  });
  const serialized = Buffer.concat(
    parts.map((chunk) => Buffer.from(chunk, "base64")),
  ).toString("utf8");
  expect(serialized).toContain("簽名 A01");
  expect(serialized).not.toContain("簽名 A02");
  const context = await browser.newContext({
    viewport: page.viewportSize() || { width: 1280, height: 800 },
  });
  try {
    const fresh = await context.newPage();
    await fresh.goto(page.url().split("#")[0] + "#/activity");
    await expect(
      fresh.getByText("· 已可離線開啟", { exact: true }),
    ).toBeAttached({ timeout: 30000 });
    await fresh.reload();
    await expect
      .poll(() => fresh.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await context.setOffline(true);
    await fresh.reload();
    await fresh
      .getByLabel("匯入活動進行檔／結案檔（XLSX）")
      .setInputFiles(outgoing);
    await fresh.getByLabel("我已核對交接份與版本，確認匯入續作或檢視").check();
    await fresh
      .getByRole("button", { name: "確認匯入活動檔", exact: true })
      .click();
    await notice(fresh, "活動檔已匯入");
    await fresh.getByLabel("實際交付商品").selectOption({ index: 1 });
    await expect(
      fresh.getByRole("group", { name: "選擇實際交付單件", exact: true }),
    ).toContainText("簽名 A01");
    await expect(
      fresh.getByRole("group", { name: "選擇實際交付單件", exact: true }),
    ).not.toContainText("簽名 A02");
    await fresh
      .getByRole("button", { name: "盤點與結案", exact: true })
      .click();
    await fresh.getByLabel("親簽立牌 實點數量", { exact: true }).fill("1");
    await fresh
      .getByRole("group", { name: "親簽立牌 實際點到的特殊單件", exact: true })
      .getByLabel("簽名 A01", { exact: true })
      .check();
    await fresh
      .getByLabel("我已完成全品項實點並確認結案；本活動檔結案後永久唯讀")
      .check();
    await fresh
      .getByRole("button", { name: "確認盤點完成並永久結案", exact: true })
      .click();
    await notice(fresh, "活動已確認結案");
    const closed = await activityDownload(fresh, "匯出活動結案檔");
    await page.goto("#/activity");
    await page
      .getByLabel("匯入活動進行檔／結案檔（XLSX）")
      .setInputFiles(closed);
    await page.getByLabel("我已核對交接份與版本，確認匯入續作或檢視").check();
    await page
      .getByRole("button", { name: "確認匯入活動檔", exact: true })
      .click();
    await notice(page, "活動檔已匯入");
    await page
      .getByRole("button", { name: "合回創作管理", exact: true })
      .click();
    await page
      .getByRole("button", { name: "檢查結案合回差異", exact: true })
      .click();
    await page
      .getByLabel("我已核對新增紀錄、商品對應及衝突，確認合回這份活動結案")
      .check();
    await page
      .getByRole("button", { name: "確認合回活動結案", exact: true })
      .click();
    await notice(page, "活動結案紀錄已合回");
    await page.goto("#/activities");
    await page
      .locator("article.packet-card")
      .filter({
        has: page.getByRole("heading", { name: "A01單件交接", exact: true }),
      })
      .getByRole("button", { name: "確認實物退回", exact: true })
      .click();
    await page
      .getByLabel("退回庫位", { exact: true })
      .selectOption({ label: "保管箱" });
    await page.getByLabel("實物退回原因與核對").fill("逐件確認 A01 已收回");
    await page
      .getByRole("button", { name: "確認已收回實物並退回庫存", exact: true })
      .click();
    await notice(page, "已記錄實物退回");
    await page.goto("#/inventory");
    await expect(
      units.locator(".unit-list article").filter({ hasText: "簽名 A01" }),
    ).toContainText("可用 · 保管箱");
    await expect(
      units.locator(".unit-list article").filter({ hasText: "簽名 A02" }),
    ).toContainText("可用 · 攤位");
  } finally {
    await context.close();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
