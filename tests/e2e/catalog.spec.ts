import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
async function createWorkspace(
  page: import("@playwright/test").Page,
  name = "網站建檔測試",
) {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
}
async function navigate(page: import("@playwright/test").Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("link", { name, exact: true })
    .click();
}
test("website-first catalog, custom options and one-file export", async ({
  page,
}) => {
  await createWorkspace(page);
  await navigate(page, "自訂商品資料");
  await page.getByRole("button", { name: "添加建議標記", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("建議標記已加入");
  await page.getByLabel("欄位名稱（必填）").fill("發售狀態");
  await page.getByLabel("資料類型", { exact: true }).selectOption("single");
  await page.getByRole("button", { name: "新增選項", exact: true }).click();
  await page.getByLabel(/選項\s*1（必填）/).fill("首販");
  await page.getByRole("button", { name: "新增選項", exact: true }).click();
  await page.getByLabel(/選項\s*2（必填）/).fill("再販");
  await page.getByRole("button", { name: "儲存欄位", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("自訂欄位已儲存");
  await navigate(page, "商品建檔");
  await page.getByLabel("商品名稱（必填）").fill("星狐陶土吊飾");
  await page.getByLabel("新創作者名稱").fill("星狐");
  await page.getByLabel("新企劃名稱").fill("星夜");
  await expect(page.getByLabel("周邊種類")).toHaveJSProperty(
    "tagName",
    "INPUT",
  );
  await page.getByLabel("周邊種類").fill("手作陶土吊飾");
  await page
    .getByLabel("發售狀態", { exact: true })
    .selectOption({ label: "首販" });
  await page.getByLabel("新商品", { exact: true }).check();
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "星狐陶土吊飾", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await navigate(page, "專案檔與備份");
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "一鍵匯出專案檔（Excel）", exact: true })
    .click();
  const file = await waiting;
  const path = await file.path();
  expect(path).toBeTruthy();
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path!);
  expect(
    book.worksheets.filter((w) => w.state === "visible").map((w) => w.name),
  ).toEqual(["00_專案說明", "01_商品", "02_自訂設定", "03_企劃"]);
  expect(book.getWorksheet("01_商品")!.getCell("A2").value).toBe(
    "星狐陶土吊飾",
  );
  expect(book.getWorksheet("01_商品")!.getCell("J2").value).toBe("首販");
  expect(book.getWorksheet("_ConMate資料")!.state).toBe("hidden");
  await expect(page.getByRole("status")).toContainText(
    "已產生專案檔並發起下載",
  );
});
test("name-only entry works offline and new workspaces stay separate", async ({
  page,
  context,
}) => {
  await createWorkspace(page, "A");
  await expect(page.getByText("· 已可離線開啟", { exact: true })).toBeAttached({
    timeout: 30000,
  });
  await page.reload();
  await context.setOffline(true);
  await navigate(page, "商品建檔");
  await page.getByLabel("商品名稱（必填）").fill("只有名稱也能保存");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "只有名稱也能保存", exact: true }),
  ).toBeVisible();
  await navigate(page, "專案檔與備份");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "一鍵匯出專案檔（Excel）" }).click();
  expect((await download).suggestedFilename()).toContain("ConMate-A-");
  await navigate(page, "工作區總覽");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("B");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await navigate(page, "商品建檔");
  await expect(
    page.getByRole("heading", { name: "只有名稱也能保存", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("目前工作區").selectOption({ label: "A" });
  await expect(
    page.getByRole("heading", { name: "只有名稱也能保存", exact: true }),
  ).toBeVisible();
});
