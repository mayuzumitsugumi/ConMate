import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
const mimeType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
async function waitNotice(page: Page, text: string) {
  await expect(
    page.locator(".success-notice").filter({ hasText: text }),
  ).toBeVisible();
}
async function download(page: Page, button: string) {
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const file = await wait;
  return {
    name: file.suggestedFilename(),
    mimeType,
    buffer: readFileSync((await file.path())!),
  };
}
test("split activity handoff is private, resumes offline, closes immutably and merges once without overwriting creator work", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  await page.goto("");
  await expect(
    page.getByRole("link", { name: "創作管理", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "活動工作台", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("創作者完整工作區");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await waitNotice(page, "已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("甲徽章");
  await page.getByLabel("新創作者名稱").fill("甲");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await waitNotice(page, "商品已建立");
  await page.getByLabel("商品名稱（必填）").fill("私人未參售商品");
  await page.getByLabel("備註", { exact: true }).fill("不得交付的私人資料");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await waitNotice(page, "商品已建立");
  await page.goto("#/projects");
  await page.getByLabel("場次名稱（必填）").fill("短期社團活動");
  await page.getByLabel("開始日期（必填）").fill("2027-01-10");
  await page.getByRole("button", { name: "建立場次", exact: true }).click();
  await waitNotice(page, "場次已建立");
  await page.goto("#/inventory");
  await page.getByLabel("庫位名稱", { exact: true }).fill("創作者倉庫");
  await page.getByRole("button", { name: "建立庫位", exact: true }).click();
  await waitNotice(page, "庫位已建立");
  await page.getByLabel("商品", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("目的庫位", { exact: true })
    .selectOption({ label: "創作者倉庫" });
  await page.getByLabel("數量", { exact: true }).fill("10");
  await page.getByLabel("異動原因").fill("本次交接前入庫");
  await page.getByRole("button", { name: "確認登記異動", exact: true }).click();
  await waitNotice(page, "庫存異動已儲存");
  await page.goto("#/sales");
  const plans = page.locator('section[aria-labelledby="plans-title"]');
  await plans.locator("summary").click();
  await page.getByLabel("方案名稱（必填）").fill("活動指定價");
  await page.getByLabel("每件／每抽售價（整元）").fill("20");
  await plans.getByLabel(/甲徽章 ·/).check();
  await page.getByRole("button", { name: "儲存販售方案", exact: true }).click();
  await expect(plans.getByRole("status")).toContainText("販售方案已儲存");
  await page.goto("#/activities");
  for (const [name, qty] of [
    ["上午交接份", "4"],
    ["下午交接份", "3"],
  ]) {
    await page.getByLabel("交接名稱（必填）").fill(name);
    await page
      .getByLabel("活動（必填）", { exact: true })
      .selectOption({ label: "短期社團活動" });
    await page
      .getByLabel("交付來源庫位（必填）")
      .selectOption({ label: "創作者倉庫" });
    await page.getByLabel("甲徽章", { exact: true }).check();
    await page.getByLabel("甲徽章 交付數量").fill(qty);
    await page.getByLabel("活動指定價 · 20 元", { exact: true }).check();
    await page
      .getByRole("group", { name: "活動收款與支出人員" })
      .getByLabel("甲", { exact: true })
      .check();
    await page
      .getByRole("button", { name: "確認交付並建立活動檔", exact: true })
      .click();
    await waitNotice(page, "交接份已建立");
  }
  const outgoing = await download(page, "匯出 上午交接份");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(outgoing.buffer as never);
  const raw = book.getWorksheet("_ConMate活動資料")!;
  const chunks: string[] = [];
  raw.eachRow((row) => {
    if (String(row.getCell(1).value).startsWith("payload-"))
      chunks.push(String(row.getCell(2).value));
  });
  const packet = JSON.parse(
    Buffer.concat(chunks.map((s) => Buffer.from(s, "base64"))).toString("utf8"),
  );
  expect(JSON.stringify(packet)).not.toContain("私人未參售商品");
  expect(JSON.stringify(packet)).not.toContain("不得交付的私人資料");
  expect(packet.snapshot.costs).toHaveLength(0);
  expect(packet.snapshot.products).toHaveLength(1);
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("活動期間新增二版");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await waitNotice(page, "商品已建立");
  const freshContext = await browser.newContext({
    viewport: page.viewportSize() || { width: 1280, height: 800 },
  });
  try {
    const fresh = await freshContext.newPage();
    const base = page.url().split("#")[0];
    await fresh.goto(base + "#/activity");
    await expect(
      fresh.getByText("· 已可離線開啟", { exact: true }),
    ).toBeAttached({ timeout: 30000 });
    await fresh.reload();
    await expect
      .poll(() => fresh.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await freshContext.setOffline(true);
    await fresh.reload();
    await fresh
      .getByLabel("匯入活動進行檔／結案檔（XLSX）")
      .setInputFiles(outgoing);
    await expect(
      fresh.getByRole("heading", { name: "匯入預覽：上午交接份", exact: true }),
    ).toBeVisible();
    await fresh.getByLabel("我已核對交接份與版本，確認匯入續作或檢視").check();
    await fresh
      .getByRole("button", { name: "確認匯入活動檔", exact: true })
      .click();
    await waitNotice(fresh, "活動檔已匯入");
    await expect(
      fresh
        .getByRole("navigation", { name: "主要導覽" })
        .getByRole("link", { name: "成本與財務", exact: true }),
    ).toHaveCount(0);
    await fresh
      .getByRole("button", { name: "商品與庫存", exact: true })
      .click();
    await fresh.getByText("修訂商品展示名稱", { exact: true }).click();
    await fresh
      .getByLabel("要修訂展示名稱的商品")
      .selectOption({ label: "甲徽章" });
    await fresh.getByLabel("本活動商品展示名稱").fill("活動限定徽章");
    await fresh.getByLabel("展示名稱修訂原因").fill("現場展示名稱調整");
    await fresh
      .getByRole("button", { name: "保存商品展示名稱修訂", exact: true })
      .click();
    await waitNotice(fresh, "活動商品展示名稱修訂已保存");
    await expect(
      fresh.getByText("甲徽章 → 活動限定徽章", { exact: true }),
    ).toBeVisible();
    await fresh.getByText("修訂既有活動販售方案", { exact: true }).click();
    await fresh
      .getByLabel("要修訂的方案", { exact: true })
      .selectOption({ label: "活動指定價" });
    await fresh.getByLabel("方案單價（整元）").fill("30");
    await fresh.getByLabel("改價／新方案原因").fill("現場明確改價");
    await fresh
      .getByRole("button", { name: "保存方案修訂", exact: true })
      .click();
    await waitNotice(fresh, "販售方案修訂已保存");
    await fresh.getByText("新增活動品項與一次帶入量", { exact: true }).click();
    await fresh.getByLabel("活動新品項名稱").fill("臨時追加徽章");
    await fresh.getByLabel("一次實際帶入數量").fill("2");
    await fresh.getByLabel("帶入來源與原因").fill("現場另帶一袋，獨立品項");
    await fresh
      .getByRole("button", { name: "確認新增品項與帶入量", exact: true })
      .click();
    await waitNotice(fresh, "活動新品項及一次帶入量已記錄");
    await fresh.getByRole("button", { name: "快速販售", exact: true }).click();
    const reserved = fresh.locator(
      'section[aria-labelledby="reservation-title"]',
    );
    await reserved.locator("summary").click();
    await fresh
      .getByLabel("預留方案", { exact: true })
      .selectOption({ label: "活動指定價" });
    await fresh
      .getByLabel("預留商品", { exact: true })
      .selectOption({ index: 1 });
    await fresh
      .getByLabel("預留庫位", { exact: true })
      .selectOption({ index: 1 });
    await fresh.getByLabel("預留數量", { exact: true }).fill("2");
    await fresh
      .getByLabel("預留原因", { exact: true })
      .fill("活動份內專用數量");
    await fresh
      .getByRole("button", { name: "確認預留庫存", exact: true })
      .click();
    await expect(reserved.getByRole("status")).toContainText("專用庫存已預留");

    await fresh
      .getByLabel("販售方案", { exact: true })
      .selectOption({ index: 1 });
    await fresh.getByLabel("實際交付商品").selectOption({ index: 1 });
    await fresh
      .getByRole("button", { name: "加入購物車", exact: true })
      .click();
    await fresh.getByLabel("販售方案", { exact: true }).selectOption("");
    await fresh
      .getByLabel("實際交付商品")
      .selectOption({ label: "臨時追加徽章 · 現存2 · 可售2" });
    await fresh.getByLabel("單價（新台幣整元）", { exact: true }).fill("15");
    await fresh
      .getByRole("button", { name: "加入購物車", exact: true })
      .click();
    await fresh
      .getByRole("button", { name: "儲存購物車草稿", exact: true })
      .click();
    await waitNotice(fresh, "未成交購物車已保存");
    await fresh.reload();
    await expect(
      fresh.getByRole("heading", { name: "本筆購物車", exact: true }),
    ).toBeVisible();
    await fresh
      .getByLabel("實際收款者", { exact: true })
      .selectOption({ label: "甲" });
    await fresh.getByLabel("收到金額（新台幣整元）").fill("100");
    await fresh
      .getByRole("button", { name: "核對本筆交易", exact: true })
      .click();
    await fresh
      .getByRole("button", { name: "確認收款並成交", exact: true })
      .click();
    await waitNotice(fresh, "交易已保存");
    await fresh.getByText("登記實際退款／退貨", { exact: true }).click();
    await fresh
      .getByLabel("原交易", { exact: true })
      .selectOption({ index: 1 });
    await fresh
      .getByLabel("原交易商品", { exact: true })
      .selectOption({ index: 1 });
    await fresh.getByLabel("本次已實際退款金額").fill("5");
    await fresh
      .getByLabel("退款／退貨原因", { exact: true })
      .fill("現場折讓退差額");
    await fresh
      .getByRole("button", { name: "確認已退款／退貨並登記", exact: true })
      .click();
    await waitNotice(fresh, "實際退款／退貨已保存");
    await fresh.getByRole("button", { name: "活動帳務", exact: true }).click();
    await fresh.getByLabel("已實際支付金額（整元）").fill("10");
    await fresh
      .getByLabel("實際付款者", { exact: true })
      .selectOption({ label: "甲" });
    await fresh.getByLabel("用途／更正說明").fill("本活動包裝材料");
    await fresh
      .getByRole("button", { name: "確認新增活動帳務", exact: true })
      .click();
    await waitNotice(fresh, "活動帳務紀錄已新增");
    await fresh
      .getByRole("button", { name: "盤點與結案", exact: true })
      .click();
    await fresh
      .getByLabel("我已完成全品項實點並確認結案；本活動檔結案後永久唯讀")
      .check();
    await expect(
      fresh.getByRole("button", {
        name: "確認盤點完成並永久結案",
        exact: true,
      }),
    ).toBeDisabled();
    await fresh.getByLabel("活動限定徽章 實點數量", { exact: true }).fill("3");
    await fresh.getByLabel("臨時追加徽章 實點數量", { exact: true }).fill("1");
    await fresh
      .getByRole("button", { name: "確認盤點完成並永久結案", exact: true })
      .click();
    await waitNotice(fresh, "活動已確認結案");
    const closed = await download(fresh, "匯出活動結案檔");
    await fresh.getByRole("button", { name: "快速販售", exact: true }).click();
    await expect(
      fresh.getByRole("button", { name: "加入購物車", exact: true }),
    ).toBeDisabled();
    await fresh.reload();
    await expect(
      fresh.getByRole("button", { name: "加入購物車", exact: true }),
    ).toBeDisabled();
    await page.goto("#/activity");
    await page
      .getByLabel("匯入活動進行檔／結案檔（XLSX）")
      .setInputFiles(closed);
    await expect(
      page.getByRole("heading", { name: "匯入預覽：上午交接份", exact: true }),
    ).toBeVisible();
    await page.getByLabel("我已核對交接份與版本，確認匯入續作或檢視").check();
    await page
      .getByRole("button", { name: "確認匯入活動檔", exact: true })
      .click();
    await waitNotice(page, "活動檔已匯入");
    await page
      .getByRole("button", { name: "合回創作管理", exact: true })
      .click();
    await page
      .getByRole("button", { name: "檢查結案合回差異", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "合回預覽", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("我已核對新增紀錄、商品對應及衝突，確認合回這份活動結案")
      .check();
    await page
      .getByRole("button", { name: "確認合回活動結案", exact: true })
      .click();
    await waitNotice(page, "活動結案紀錄已合回");
    await page
      .getByRole("button", { name: "檢查結案合回差異", exact: true })
      .click();
    await expect(
      page.getByText("這份結案已合回，不會再次扣庫或記帳。", { exact: true }),
    ).toBeVisible();
    await page.goto("#/products");
    await expect(
      page.getByRole("heading", { name: "甲徽章", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "活動限定徽章", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "私人未參售商品", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "活動期間新增二版", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "臨時追加徽章", exact: true }),
    ).toBeVisible();
    await page.goto("#/activities");
    const morning = page.locator("article.packet-card").filter({
      has: page.getByRole("heading", { name: "上午交接份", exact: true }),
    });
    await morning
      .getByRole("button", { name: "確認實物退回", exact: true })
      .click();
    await page
      .getByLabel("退回庫位", { exact: true })
      .selectOption({ label: "創作者倉庫" });
    await page.getByLabel("實物退回原因與核對").fill("盤點相符，實物已交還");
    await page
      .getByRole("button", { name: "確認已收回實物並退回庫存", exact: true })
      .click();
    await waitNotice(page, "已記錄實物退回");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await freshContext.close();
  }
});
