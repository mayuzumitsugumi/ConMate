import { test, expect } from "@playwright/test";

test("overview, local workspace and responsive navigation", async ({
  page,
}) => {
  await page.goto("");
  await expect(
    page.getByRole("heading", { name: "工作區總覽", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("行動裝置測試工作室");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "行動裝置測試工作室" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "攤位販售" })
    .click();
  await expect(
    page.getByRole("heading", { name: "小秘書正在準備這一頁" }),
  ).toBeVisible();
});

test("templates download with the Pages subpath", async ({ page }) => {
  await page.goto("#/templates/advanced");
  await expect(
    page.getByRole("heading", { name: "Excel 資料中心", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "不確定怎麼填？先看逐欄範例 ↓" })
    .click();
  await expect(
    page.getByRole("heading", { name: "一步一步，先建立一個星狐徽章" }),
  ).toBeVisible();
  const creatorStep = page
    .locator("details.fill-step")
    .filter({ has: page.locator("summary", { hasText: "建立創作者" }) });
  await creatorStep.locator("summary").click();
  await expect(
    creatorStep.getByRole("cell", { name: "星狐", exact: true }),
  ).toHaveCount(2);
  await expect(
    creatorStep.getByRole("cell", { name: "星狐", exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(() => getComputedStyle(document.body).fontFamily),
  ).toContain("Microsoft JhengHei");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  for (const [name, file] of [
    ["下載空白模板", "conmate-blank-v1.xlsx"],
    ["下載虛構範例模板", "conmate-example-v1.xlsx"],
  ]) {
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    expect((await download).suggestedFilename()).toBe(file);
  }
  await expect(page.getByRole("status")).toContainText("不是目前工作區的備份");
});

test("cached application and template remain available offline", async ({
  page,
  context,
}) => {
  await page.goto("");
  await expect(page.getByText("· 已可離線開啟", { exact: true })).toBeAttached({
    timeout: 30_000,
  });
  await page.reload();
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "工作區總覽", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "專案檔與備份" })
    .click();
  const status = await page.evaluate(
    async () =>
      (await fetch("/ConMate/templates/conmate-blank-v1.xlsx")).status,
  );
  expect(status).toBe(200);
});
