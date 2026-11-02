import { test, expect } from "@playwright/test";
test("allocates one artwork source across different quantities and reconciles actual supplier payments", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("柄圖財務測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  for (const [name, type] of [
    ["星空徽章", "徽章"],
    ["星空吊飾", "吊飾"],
  ]) {
    await page.getByLabel("商品名稱（必填）").fill(name!);
    if (name === "星空徽章") await page.getByLabel("新創作者名稱").fill("甲");
    await page.getByLabel("周邊種類", { exact: true }).fill(type!);
    await page.getByLabel("款式／圖樣", { exact: true }).fill("共用星空圖");
    await page.getByRole("button", { name: "建立商品", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("商品已建立");
  }
  await page.goto("#/finance");
  for (const [name, product, qty, print] of [
    ["徽章成本", "星空徽章", "10", "100"],
    ["吊飾成本", "星空吊飾", "20", "400"],
  ]) {
    await page.getByLabel("批次／成本名稱", { exact: true }).fill(name!);
    await page
      .getByLabel("成本商品", { exact: true })
      .selectOption({ label: product! });
    await page.getByLabel("製作數量", { exact: true }).fill(qty!);
    await page.getByLabel("實際印製總額（元）", { exact: true }).fill(print!);
    await page.getByLabel("本批分配的柄圖費（元）", { exact: true }).fill("0");
    await page.getByLabel("其他成本總額（元）", { exact: true }).fill("0");
    await page.getByLabel("試算單件售價（元）", { exact: true }).fill("100");
    await page
      .getByRole("button", { name: "建立成本紀錄", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "成本紀錄已儲存" }),
    ).toBeVisible();
  }
  const panel = page.getByRole("region", { name: "柄圖費分攤與實際付款核對" });
  await panel.getByText("新增柄圖費來源", { exact: true }).click();
  await panel.getByLabel("柄圖費名稱", { exact: true }).fill("星空圖委託費");
  await panel
    .getByLabel("使用的柄圖", { exact: true })
    .selectOption({ index: 1 });
  await panel.getByLabel("本次柄圖費總額（元）", { exact: true }).fill("900");
  await panel
    .getByRole("button", { name: "建立柄圖費來源", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("柄圖費來源已建立");
  await panel.getByRole("checkbox", { name: /徽章成本/ }).check();
  await panel.getByRole("checkbox", { name: /吊飾成本/ }).check();
  await expect(panel).toContainText("整元分攤 300 元");
  await expect(panel).toContainText("整元分攤 600 元");
  await panel
    .getByRole("button", { name: "確認分攤預覽", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "套用柄圖費分攤", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("分攤已套用");
  await panel.getByText("記錄已實際支付的廠商款項", { exact: true }).click();
  await panel
    .getByLabel("付款成本來源", { exact: true })
    .selectOption({ label: "徽章成本" });
  await panel
    .getByLabel("實際廠商付款人", { exact: true })
    .selectOption({ label: "甲" });
  await panel.getByLabel("實際收款廠商／對象", { exact: true }).fill("印刷廠");
  await panel.getByLabel("已實付金額（元）", { exact: true }).fill("100");
  await panel
    .getByRole("button", { name: "記錄廠商實際付款", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("未自動建立代墊");
  await panel.getByText("費用與付款核對", { exact: true }).click();
  await expect(
    panel.getByRole("row").filter({ hasText: "徽章成本・印製費" }),
  ).toContainText("100");
  await page.reload();
  await panel
    .getByLabel("分攤來源", { exact: true })
    .selectOption({ index: 1 });
  await expect(panel).toContainText("分攤版本 1・生效");
  await panel
    .getByRole("button", { name: "撤銷此分攤並還原原值", exact: true })
    .click();
  await panel.getByLabel("費用更正原因", { exact: true }).fill("重新設定基準");
  await panel
    .getByRole("button", { name: "確認保存費用更正", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("已保存更正");
  await expect(panel).toContainText("分攤版本 1・已撤銷");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
