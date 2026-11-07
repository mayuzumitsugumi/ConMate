import { test, expect } from "@playwright/test";

test("help groups topics in workflow order without search and follows page context", async ({
  page,
  context,
}) => {
  await page.goto("#/help");
  await expect(
    page.getByRole("heading", { name: "使用說明", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("帳面應剩 9 個", { exact: false })).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  const navigation = page.getByRole("navigation", {
    name: "說明主題",
    exact: true,
  });
  const buttons = navigation.getByRole("button");
  await expect(buttons).toHaveCount(19);
  await expect(buttons.nth(0)).toHaveText("第一次使用");
  await expect(buttons.nth(1)).toHaveText("創作管理");
  await expect(buttons.nth(2)).toHaveText("活動工作台");
  await expect(navigation.getByRole("heading")).toHaveText([
    "開始使用",
    "創作與商品",
    "庫存與盤點",
    "販售與交付",
    "成本與帳務",
    "備份與離線",
  ]);
  const details = page.locator(".help-topic");
  expect(
    await details.evaluateAll((nodes) => nodes.map((node) => node.id)),
  ).toEqual(
    [
      "start",
      "activities",
      "activity",
      "creators",
      "projects",
      "products",
      "inventory",
      "physical-units",
      "stocktake",
      "sales",
      "refunds",
      "preorders",
      "consignments",
      "finance",
      "settlement",
      "reports",
      "templates",
      "cloud",
      "offline",
    ].map((id) => `help-${id}`),
  );
  await buttons.nth(2).click();
  await expect(page.locator("#help-activity")).toHaveAttribute("open", "");
  await expect(buttons.nth(2)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "備份與還原", exact: true }).click();
  await expect(page.locator("#help-templates")).toHaveAttribute("open", "");
  await page
    .getByRole("link", { name: "匯出、檢查或還原專案檔 →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "專案檔與備份", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "這頁怎麼用？", exact: true }).click();
  await expect(page.locator("#help-templates")).toHaveAttribute("open", "");
  await page
    .getByRole("navigation", { name: "主要導覽" })
    .getByRole("link", { name: "使用說明", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.goto("#/finance");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.goto("#/help");
  await expect(page.getByText("· 已可離線開啟", { exact: true })).toBeAttached({
    timeout: 30_000,
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "使用說明", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "離線、安裝、更新與資料遺失", exact: true })
    .click();
  await expect(page.locator("#help-offline")).toHaveAttribute("open", "");
  await expect(page.locator("#help-offline")).toBeVisible();
});
