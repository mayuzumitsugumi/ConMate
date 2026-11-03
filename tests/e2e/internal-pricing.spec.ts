import { test, expect } from "@playwright/test";
test("keeps agreed recovery distinct from actual cost and cumulative member receipts", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("內部計價測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await page.goto("#/creators");
  for (const name of ["成員甲", "總召乙"]) {
    await page.getByLabel("參與方名稱（必填）").fill(name);
    await page.getByRole("button", { name: "建立參與方", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("參與方已建立");
  }
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("塔塔立牌");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page.goto("#/finance");
  await page.getByLabel("批次／成本名稱", { exact: true }).fill("實際4000元");
  await page.getByLabel("成本商品", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("製作數量", { exact: true }).fill("30");
  await page.getByLabel("實際印製總額（元）", { exact: true }).fill("4000");
  await page.getByLabel("本批分配的柄圖費（元）", { exact: true }).fill("0");
  await page.getByLabel("其他成本總額（元）", { exact: true }).fill("0");
  await page.getByRole("button", { name: "建立成本紀錄", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "成本紀錄已儲存" }),
  ).toBeVisible();
  const panel = page.getByRole("region", {
    name: "內部計價與約定回收",
    exact: true,
  });
  await panel.getByLabel("約定名稱（必填）").fill("原約定");
  await panel.getByLabel("費用來源（必填）").selectOption({ index: 1 });
  await panel
    .getByLabel("內部負擔對象", { exact: true })
    .selectOption({ label: "成員甲" });
  await panel.getByLabel("內部負擔總額（元，選填）").fill("4000");
  await panel.getByLabel("約定每件回收額（元，選填）").fill("134");
  await panel.getByLabel("約定／版本原因（必填）").fill("成本4000約定4020差額待定");
  await panel
    .getByRole("button", { name: "預覽確認約定", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "確認保存約定", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("內部計價約定已保存");
  await expect(panel).toContainText("4020.0000");
  await expect(panel).toContainText("20.0000");
  await expect(panel).toContainText("差額仍待確認");
  await panel
    .getByLabel("實際付款人", { exact: true })
    .selectOption({ label: "成員甲" });
  await panel
    .getByLabel("實際收款人", { exact: true })
    .selectOption({ label: "總召乙" });
  await panel.getByLabel("本次已收到金額（整元）").fill("2000");
  await panel.getByLabel("本次收款說明（必填）").fill("已收到第一次");
  await panel
    .getByRole("button", { name: "記錄已收到款項", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("已記錄實際內部收款");
  await expect(panel).toContainText("2020.0000");
  await panel
    .getByRole("button", { name: "追加約定版本", exact: true })
    .click();
  await panel.getByLabel("約定名稱（必填）").fill("新版約定");
  await panel.getByLabel("約定每件回收額（元，選填）").fill("140");
  await panel.getByLabel("約定／版本原因（必填）").fill("明確修訂回收規則");
  await panel
    .getByRole("button", { name: "預覽確認約定", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "確認保存約定", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("內部計價約定已保存");
  await expect(panel).toContainText("2200.0000");
  await page.reload();
  const p = page.getByRole("region", {
    name: "內部計價與約定回收",
    exact: true,
  });
  await p.getByLabel("選擇約定版本").selectOption({ index: 2 });
  await expect(p).toContainText("2200.0000");
  await p.getByLabel("選擇約定版本").selectOption({ index: 1 });
  await expect(
    p.getByRole("button", { name: "記錄已收到款項", exact: true }),
  ).toHaveCount(0);
  await p.getByRole("button", { name: "沖銷收款", exact: true }).click();
  await p.getByLabel("原因（必填）", { exact: true }).fill("輸入錯誤未實收");
  await p.getByRole("button", { name: "確認更正", exact: true }).click();
  await expect(p.getByRole("status")).toContainText("更正已保存");
  await p.getByLabel("選擇約定版本").selectOption({ index: 2 });
  await expect(p).toContainText("4200.0000");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
