import { test, expect } from "@playwright/test";
test("master data has explicit authors and ownership, stable edit/archive and reload", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("主檔測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "創作者與柄圖", exact: true })
    .click();
  for (const name of ["創作者", "商品主人", "繪師"]) {
    await page.getByLabel("參與方名稱（必填）").fill(name);
    await page.getByRole("button", { name: "建立參與方", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("參與方已建立");
  }
  await page.getByLabel("柄圖名稱（必填）").fill("星空圖");
  await page
    .getByRole("group", { name: "柄圖作者（可複選）" })
    .getByLabel(/繪師/)
    .check();
  await page.getByRole("button", { name: "建立柄圖", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("柄圖已建立");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "商品建檔", exact: true })
    .click();
  await page.getByLabel("商品名稱（必填）").fill("星空吊飾");
  await page
    .getByLabel("創作者", { exact: true })
    .selectOption({ label: "創作者" });
  await page
    .getByLabel("商品擁有者", { exact: true })
    .selectOption({ label: "商品主人" });
  await page
    .getByLabel("既有柄圖", { exact: true })
    .selectOption({ label: "星空圖" });
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "創作者與柄圖", exact: true })
    .click();
  await page
    .getByRole("button", { name: "編輯參與方 繪師", exact: true })
    .click();
  await page.getByLabel("參與方名稱（必填）").fill("繪師新名");
  await page
    .getByRole("button", { name: "儲存參與方變更", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("參與方已更新");
  await page
    .getByRole("button", { name: "封存柄圖 星空圖", exact: true })
    .click();
  await page.getByRole("button", { name: "確認封存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("柄圖已封存");
  await page.getByLabel("顯示已封存的參與方與柄圖").check();
  await page
    .getByRole("button", { name: "恢復柄圖 星空圖", exact: true })
    .click();
  await page.getByRole("button", { name: "確認恢復", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("柄圖已恢復");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "繪師新名", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "商品建檔", exact: true })
    .click();
  await page
    .getByRole("button", { name: "編輯 星空吊飾", exact: true })
    .click();
  await expect(
    page.getByLabel("商品擁有者", { exact: true }).locator("option:checked"),
  ).toHaveText("商品主人");
  await expect(
    page.getByLabel("既有柄圖", { exact: true }).locator("option:checked"),
  ).toHaveText("星空圖");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
