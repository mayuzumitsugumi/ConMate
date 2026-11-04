import { test, expect } from "@playwright/test";

test("help works without workspace, finds instructions and follows page context", async ({
  page,
  context,
}) => {
  await page.goto("#/help");
  await expect(
    page.getByRole("heading", { name: "使用說明", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("帳面應剩 9 個", { exact: false })).toBeVisible();
  await page.getByLabel("搜尋說明", { exact: true }).fill("損壞");
  await expect(page.locator("#help-physical-units")).toContainText("損壞退回");
  await expect(page.locator("#help-refunds summary")).toContainText("退款");
  await expect(page.locator("#help-finance")).toContainText("損壞退貨成本另列");
  await expect(
    page.getByText("瑕疵退回（例如損壞）另外記錄", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("搜尋說明", { exact: true }).fill("不存在的內容abcdef");
  await expect(page.locator("details")).toHaveCount(0);
  await expect(
    page.getByText("找不到符合的說明", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "備份與還原", exact: true }).click();
  await expect(page.getByLabel("搜尋說明", { exact: true })).toHaveValue("");
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
  await page.getByLabel("搜尋說明", { exact: true }).fill("無痕");
  await expect(page.locator("#help-offline")).toBeVisible();
});
