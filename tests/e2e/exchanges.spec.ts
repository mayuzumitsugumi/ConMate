import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("exchanges explicitly reconcile positive negative and zero cash differences without paying the new total twice", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("換購差額測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("徽章");
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
  await page.getByLabel("異動原因").fill("製作入庫");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  await page.goto("#/sales");
  await page.getByLabel("出貨庫位（必填）").selectOption({ label: "攤位" });
  const card = page.locator(".product-grid article").first();
  await card.getByRole("button", { name: "指定購買", exact: true }).click();
  await page
    .locator(".cart-line")
    .getByLabel("數量", { exact: true })
    .fill("2");
  await page.locator(".cart-line").getByLabel("單價（新台幣整元）").fill("50");
  await page.getByLabel("收到金額（新台幣整元）").fill("100");
  await page.getByRole("button", { name: "確認收款", exact: true }).click();
  await page
    .getByRole("button", { name: "完成交易並扣庫", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "交易已完成" }),
  ).toBeVisible();
  for (const step of [
    { credit: 50, price: 75, difference: 25, revenue: 125 },
    { credit: 75, price: 25, difference: -50, revenue: 75 },
    { credit: 25, price: 25, difference: 0, revenue: 75 },
  ]) {
    const panel = page.locator(".exchange-panel").first();
    await panel.getByRole("button", { name: /^換購／補退差額/ }).click();
    await panel
      .getByLabel("本次原商品折抵／退款金額", { exact: true })
      .fill(String(step.credit));
    await panel.getByLabel("本次可售回庫數量", { exact: true }).fill("1");
    await panel
      .getByLabel("換購新商品", { exact: true })
      .selectOption({ label: "徽章" });
    await panel.getByLabel("新交付數量", { exact: true }).fill("1");
    await panel
      .getByLabel("新交付單價", { exact: true })
      .fill(String(step.price));
    await panel
      .getByRole("button", { name: "加入換購新商品", exact: true })
      .click();
    await expect(
      panel.getByRole("status").filter({ hasText: /本次/ }),
    ).toContainText(
      step.difference > 0
        ? `本次應補收 ${step.difference} 元`
        : step.difference < 0
          ? `本次應退還 ${-step.difference} 元`
          : "本次差額 0 元",
    );
    await panel
      .getByLabel("實際收退差額（補收填正數、退還填負數）")
      .fill(String(step.difference));
    await panel.getByLabel("換購原因與說明").fill("當面確認換購");
    await panel
      .getByLabel(
        "我確認已完成以上實物交付，並已實際補收／退還所填差額；零元則無收退款",
      )
      .check();
    await panel
      .getByRole("button", { name: "確認換購並保存差額", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "換購已記錄" }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(`工作區有效交易營收：${step.revenue} 元`, {
        exact: false,
      }),
    ).toBeVisible();
    await expect(card).toContainText("目前庫位現存 1");
  }
  await page.reload();
  await expect(
    page.getByText("工作區有效交易營收：75 元", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(/原商品折抵 25 元，實際補收 0 元，實際退還 0 元/).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("offline activity exchanges close and merge once with actual cash difference", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const notice = async (p: typeof page, text: string) => {
    await expect(
      p.locator(".success-notice").filter({ hasText: text }),
    ).toBeVisible();
  };
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("活動換購工作區");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await notice(page, "已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("活動徽章");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await notice(page, "商品已建立");
  await page.goto("#/projects");
  await page.getByLabel("場次名稱（必填）").fill("換購活動");
  await page.getByLabel("開始日期（必填）").fill("2027-02-01");
  await page.getByRole("button", { name: "建立場次", exact: true }).click();
  await notice(page, "場次已建立");
  await page.goto("#/inventory");
  await page.getByLabel("庫位名稱", { exact: true }).fill("原倉庫");
  await page.getByRole("button", { name: "建立庫位", exact: true }).click();
  await notice(page, "庫位已建立");
  await page.getByLabel("商品", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("目的庫位", { exact: true })
    .selectOption({ label: "原倉庫" });
  await page.getByLabel("數量", { exact: true }).fill("3");
  await page.getByLabel("異動原因").fill("交接用入庫");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await notice(page, "庫存異動已儲存");
  await page.goto("#/activities");
  await page.getByLabel("交接名稱（必填）").fill("換購交接份");
  await page
    .getByLabel("活動（必填）", { exact: true })
    .selectOption({ label: "換購活動" });
  await page
    .getByLabel("交付來源庫位（必填）")
    .selectOption({ label: "原倉庫" });
  await page.getByLabel("活動徽章", { exact: true }).check();
  await page.getByLabel("活動徽章 交付數量").fill("3");
  await page
    .getByRole("button", { name: "確認交付並建立活動檔", exact: true })
    .click();
  await notice(page, "交接份已建立");
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "匯出 換購交接份", exact: true })
    .click();
  const out = await dl;
  const context = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const p = await context.newPage();
    const base = page.url().split("#")[0]!;
    await p.goto(base + "#/activity");
    await expect(p.getByText("· 已可離線開啟", { exact: true })).toBeAttached({
      timeout: 30000,
    });
    await p.reload();
    await expect
      .poll(() => p.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await context.setOffline(true);
    await p.reload();
    await p
      .getByLabel("匯入活動進行檔／結案檔（XLSX）")
      .setInputFiles({
        name: out.suggestedFilename(),
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: readFileSync((await out.path())!),
      });
    await p.getByLabel("我已核對交接份與版本，確認匯入續作或檢視").check();
    await p
      .getByRole("button", { name: "確認匯入活動檔", exact: true })
      .click();
    await notice(p, "活動檔已匯入");
    await p
      .getByLabel("實際交付商品", { exact: true })
      .selectOption({ index: 1 });
    await p.getByLabel("單價（新台幣整元）", { exact: true }).fill("50");
    await p.getByRole("button", { name: "加入購物車", exact: true }).click();
    await p.getByLabel("收到金額（新台幣整元）").fill("50");
    await p.getByRole("button", { name: "核對本筆交易", exact: true }).click();
    await p
      .getByRole("button", { name: "確認收款並成交", exact: true })
      .click();
    await notice(p, "交易已保存");
    const exchange = p.locator(".exchange-panel").first();
    await exchange.getByRole("button", { name: /^換購／補退差額/ }).click();
    await exchange
      .getByLabel("本次原商品折抵／退款金額", { exact: true })
      .fill("50");
    await exchange.getByLabel("本次可售回庫數量", { exact: true }).fill("1");
    await exchange
      .getByLabel("換購新商品", { exact: true })
      .selectOption({ label: "活動徽章" });
    await exchange.getByLabel("新交付單價", { exact: true }).fill("75");
    await exchange
      .getByRole("button", { name: "加入換購新商品", exact: true })
      .click();
    await exchange
      .getByLabel("實際收退差額（補收填正數、退還填負數）")
      .fill("25");
    await exchange.getByLabel("換購原因與說明").fill("活動現場補收25");
    await exchange
      .getByLabel(
        "我確認已完成以上實物交付，並已實際補收／退還所填差額；零元則無收退款",
      )
      .check();
    await exchange
      .getByRole("button", { name: "確認換購並保存差額", exact: true })
      .click();
    await expect(
      p.getByRole("status").filter({ hasText: "換購已記錄" }),
    ).toBeVisible();
    await p.getByRole("button", { name: "盤點與結案", exact: true }).click();
    await p.getByLabel("活動徽章 實點數量", { exact: true }).fill("2");
    await p
      .getByLabel("我已完成全品項實點並確認結案；本活動檔結案後永久唯讀")
      .check();
    await p
      .getByRole("button", { name: "確認盤點完成並永久結案", exact: true })
      .click();
    await notice(p, "活動已確認結案");
    const backWait = p.waitForEvent("download");
    await p
      .getByRole("button", { name: "匯出活動結案檔", exact: true })
      .click();
    const back = await backWait;
    await page.goto("#/activity");
    await page
      .getByLabel("匯入活動進行檔／結案檔（XLSX）")
      .setInputFiles({
        name: back.suggestedFilename(),
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: readFileSync((await back.path())!),
      });
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
    await page.goto("#/sales");
    await expect(
      page.getByText("工作區有效交易營收：75 元", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText(/原商品折抵 50 元，實際補收 25 元，實際退還 0 元/).first(),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
