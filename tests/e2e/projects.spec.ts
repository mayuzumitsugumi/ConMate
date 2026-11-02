import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
test("complete projects and events page: edit, many-to-many, archive, reload and export", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("跨場企劃");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "企劃與場次", exact: true })
    .click();
  for (const name of ["星夜", "海風"]) {
    await page.getByLabel("企劃名稱（必填）").fill(name);
    await page.getByRole("button", { name: "建立企劃", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("企劃已建立");
  }
  await page.getByLabel("場次名稱（必填）").fill("第一場");
  await page.getByLabel("開始日期（必填）").fill("2027-01-10");
  await page
    .getByRole("group", { name: "連結企劃（可複選）" })
    .getByLabel("星夜", { exact: true })
    .check();
  await page
    .getByRole("group", { name: "連結企劃（可複選）" })
    .getByLabel("海風", { exact: true })
    .check();
  await page.getByRole("button", { name: "建立場次", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("場次已建立");
  await page.getByLabel("場次名稱（必填）").fill("第二場");
  await page.getByLabel("開始日期（必填）").fill("2027-02-14");
  await page.getByLabel("結束日期", { exact: true }).fill("2027-02-15");
  await page
    .getByRole("group", { name: "連結企劃（可複選）" })
    .getByLabel("星夜", { exact: true })
    .check();
  await page.getByRole("button", { name: "建立場次", exact: true }).click();
  await page
    .getByRole("button", { name: "編輯企劃 星夜", exact: true })
    .click();
  await page.getByLabel("企劃名稱（必填）").fill("星夜改名");
  await page.getByRole("button", { name: "儲存企劃", exact: true }).click();
  const first = page.locator("article").filter({
    has: page.getByRole("heading", { name: "第一場", exact: true }),
  });
  await expect(first).toContainText("星夜改名、海風");
  await page
    .getByRole("button", { name: "封存企劃 星夜改名", exact: true })
    .click();
  await page.getByRole("button", { name: "確認封存", exact: true }).click();
  await expect(first).toContainText("星夜改名（已封存）");
  await page.getByLabel("顯示封存的企劃與場次").check();
  await page
    .getByRole("button", { name: "恢復企劃 星夜改名", exact: true })
    .click();
  await page.getByRole("button", { name: "確認恢復", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("企劃已恢復。");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "第二場", exact: true }),
  ).toBeVisible();
  await expect(first).toContainText("星夜改名、海風");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "專案檔與備份", exact: true })
    .click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "一鍵匯出專案檔（Excel）" }).click();
  const file = await waiting;
  const b = new ExcelJS.Workbook();
  await b.xlsx.readFile((await file.path())!);
  expect(b.getWorksheet("03_企劃")!.getCell("A2").value).toBe("星夜改名");
  expect(b.getWorksheet("04_場次")!.getCell("E2").value).toBe("星夜改名、海風");
  expect(b.getWorksheet("04_場次")!.getCell("C2").value).toBe("2027-01-10");
});
