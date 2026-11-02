import { test, expect } from "@playwright/test";
test("trials explicit source lines and keeps manual decisions separate from cumulative actual payments", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("結算測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  for (const [name, creator] of [
    ["甲徽章", "甲"],
    ["乙吊飾", "乙"],
  ]) {
    await page.getByLabel("商品名稱（必填）").fill(name);
    if (creator === "乙")
      await page
        .getByRole("button", { name: "新增創作者", exact: true })
        .click();
    await page.getByLabel("新創作者名稱").fill(creator);
    await page.getByRole("button", { name: "建立商品", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("商品已建立");
  }
  await page.goto("#/inventory");
  await page.getByLabel("庫位名稱", { exact: true }).fill("攤位");
  await page.getByRole("button", { name: "建立庫位", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("庫位已建立");
  for (const i of [1, 2]) {
    await page.getByLabel("商品", { exact: true }).selectOption({ index: i });
    await page
      .getByLabel("目的庫位", { exact: true })
      .selectOption({ label: "攤位" });
    await page.getByLabel("數量", { exact: true }).fill("3");
    await page.getByLabel("異動原因／批次註記").fill("入庫");
    await page.getByRole("button", { name: "確認登記異動" }).click();
    await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  }
  await page.goto("#/sales");
  await page.getByLabel("出貨庫位（必填）").selectOption({ label: "攤位" });
  for (const name of ["甲徽章", "乙吊飾"]) {
    await page
      .locator(".product-grid article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .getByRole("button", { name: "指定購買", exact: true })
      .click();
  }
  for (const line of await page.locator(".cart-line").all())
    await line.getByLabel("單價（新台幣整元）").fill("100");
  await page.getByLabel("收到金額（新台幣整元）").fill("200");
  await page.getByRole("button", { name: "確認收款", exact: true }).click();
  await page
    .getByRole("button", { name: "完成交易並扣庫", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "交易已完成" }),
  ).toBeVisible();
  await page.goto("#/finance");
  await page.getByLabel("批次／成本名稱", { exact: true }).fill("徽章成本");
  await page.getByLabel("成本商品", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("製作數量", { exact: true }).fill("1");
  await page.getByLabel("實際印製總額（元）", { exact: true }).fill("20");
  await page.getByLabel("本批分配的柄圖費（元）", { exact: true }).fill("0");
  await page.getByLabel("其他成本總額（元）", { exact: true }).fill("0");
  await page.getByRole("button", { name: "建立成本紀錄", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "成本紀錄已儲存" }),
  ).toBeVisible();
  const panel = page.locator('section[aria-labelledby="settlement-title"]');
  await panel.locator("summary").filter({ hasText: "建立結算工作表" }).click();
  await panel.getByLabel("結算工作表名稱", { exact: true }).fill("徽章結算");
  await panel
    .getByRole("button", { name: "建立結算工作表", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "徽章結算", exact: true }),
  ).toBeVisible();
  await panel
    .locator("summary")
    .filter({ hasText: "選擇來源並保存試算" })
    .click();
  await panel.getByRole("checkbox", { name: /SAL-.*甲徽章/ }).check();
  await panel.getByRole("checkbox", { name: /徽章成本 ·/ }).check();
  await panel.getByLabel("抽成基礎", { exact: true }).selectOption("revenue");
  await panel.getByLabel("管理抽成比例（%）", { exact: true }).fill("20");
  await panel.getByLabel("固定管理費（元）", { exact: true }).fill("0");
  await panel
    .getByLabel("固定費計算順序", { exact: true })
    .selectOption("after-rate");
  await panel
    .getByLabel("抽成基礎為負值時", { exact: true })
    .selectOption("zero-fee");
  await panel
    .getByLabel("管理費歸屬", { exact: true })
    .selectOption({ label: "甲" });
  await panel.getByLabel("乙 的分配比例（%）", { exact: true }).fill("100");
  await panel
    .getByRole("button", { name: "保存試算快照", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("試算快照已保存");
  await expect(panel.getByText("甲：20 元", { exact: true })).toBeVisible();
  await expect(panel.getByText("乙：60 元", { exact: true })).toBeVisible();
  await panel
    .getByRole("button", { name: "帶入此試算，供我決定金額", exact: true })
    .click();
  await panel
    .locator("summary")
    .filter({ hasText: "保存人工分配決定" })
    .click();
  await panel
    .getByLabel("分配決定／差異原因", { exact: true })
    .fill("同意本次試算");
  await panel
    .getByRole("button", { name: "保存人工分配決定", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("人工分配決定已保存");
  await panel
    .locator("summary")
    .filter({ hasText: "聲明開始分款時各人實際持款" })
    .click();
  await panel
    .getByLabel("甲 的開始實際持款（整元）", { exact: true })
    .fill("80");
  await panel
    .getByLabel("乙 的開始實際持款（整元）", { exact: true })
    .fill("0");
  await panel
    .getByRole("button", { name: "保存持款聲明", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("持款聲明已保存");
  await panel.locator("summary").filter({ hasText: "登記已實際付款" }).click();
  await panel
    .getByLabel("實際付款人", { exact: true })
    .selectOption({ label: "甲" });
  await panel
    .getByLabel("實際收款人", { exact: true })
    .selectOption({ label: "乙" });
  await panel.getByLabel("已實付金額（整元）", { exact: true }).fill("60");
  await panel.getByLabel("我確認這筆款項已實際支付").check();
  await panel
    .getByRole("button", { name: "記錄實際分款", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("已記錄實際付款");
  const row = (name: string) =>
    panel
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name, exact: true }) });
  await expect(row("甲").getByRole("cell").last()).toHaveText("0");
  await expect(row("乙").getByRole("cell").last()).toHaveText("0");
  await panel
    .getByLabel("甲 的累計分配目標（整元，可負數）", { exact: true })
    .fill("30");
  await panel
    .getByLabel("乙 的累計分配目標（整元，可負數）", { exact: true })
    .fill("50");
  await panel
    .getByLabel("分配決定／差異原因", { exact: true })
    .fill("重新約定累計目標，保留已付60");
  await panel
    .getByRole("button", { name: "保存人工分配決定", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("人工分配決定已保存");
  await expect(row("甲").getByRole("cell").last()).toHaveText("10");
  await expect(row("乙").getByRole("cell").last()).toHaveText("-10");
  await panel
    .getByRole("button", { name: "更正這筆實付紀錄", exact: true })
    .click();
  await panel
    .getByLabel("實付更正原因", { exact: true })
    .fill("實付誤記，保留反向更正");
  await panel
    .getByRole("button", { name: "保存反向更正紀錄", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("反向更正紀錄");
  await expect(row("甲").getByRole("cell").last()).toHaveText("-50");
  await expect(row("乙").getByRole("cell").last()).toHaveText("50");
  await panel.locator("summary").filter({ hasText: "由我決定結案" }).click();
  await panel
    .getByLabel("結案決定與說明", { exact: true })
    .fill("仍有未付款，由我決定先結案");
  await panel
    .getByRole("button", { name: "記錄由我決定結案", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("使用者結案決定");
  await panel
    .locator("summary")
    .filter({ hasText: "由我重新開啟工作表" })
    .click();
  await panel.getByLabel("重新開啟原因", { exact: true }).fill("追加約定");
  await panel
    .getByRole("button", { name: "記錄由我重新開啟", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("重新開啟");
  await expect(row("乙").getByRole("cell").last()).toHaveText("50");
  await panel
    .locator("summary")
    .filter({ hasText: "工作單以外的實際現金增減" })
    .click();
  await panel
    .getByLabel("現金增減成員", { exact: true })
    .selectOption({ label: "甲" });
  await panel
    .getByLabel("已實際收進／付出（整元，正收負付）", { exact: true })
    .fill("-10");
  await panel
    .getByLabel("外部現金增減原因", { exact: true })
    .fill("甲實際退給顧客10元，僅核對持款");
  await panel
    .getByLabel("我確認已完成這筆外部收付款，且未重複登記內部分款")
    .check();
  await panel
    .getByRole("button", { name: "記錄外部現金增減", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("外部現金增減");
  await expect(row("甲").getByRole("cell").last()).toHaveText("-40");
  await panel
    .getByRole("button", { name: "更正這筆外部現金紀錄", exact: true })
    .click();
  await panel
    .getByLabel("外部現金更正原因", { exact: true })
    .fill("修正外部收付款誤記");
  await panel
    .getByRole("button", { name: "保存外部現金反向更正", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("外部現金反向更正");
  await expect(row("甲").getByRole("cell").last()).toHaveText("-50");
  await page.reload();
  await panel
    .getByLabel("目前結算工作表", { exact: true })
    .selectOption({ label: "徽章結算" });
  await expect(row("乙").getByRole("cell").last()).toHaveText("50");
  const createDetails = panel
    .locator("details")
    .filter({
      has: page.locator("summary").filter({ hasText: "建立結算工作表" }),
    });
  if (!(await createDetails.evaluate((e) => (e as HTMLDetailsElement).open)))
    await createDetails.locator("summary").click();
  await panel
    .getByLabel("結算工作表名稱", { exact: true })
    .fill("規則未知人工結案");
  await panel
    .getByRole("button", { name: "建立結算工作表", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "規則未知人工結案", exact: true }),
  ).toBeVisible();
  await panel
    .locator("summary")
    .filter({ hasText: "選擇來源並保存試算" })
    .click();
  await panel
    .getByRole("button", { name: "保存試算快照", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("試算快照已保存");
  await expect(panel.getByText(/尚無法試算：尚未選擇抽成基礎/)).toBeVisible();
  await panel
    .locator("summary")
    .filter({ hasText: "保存人工分配決定" })
    .click();
  await panel
    .getByLabel("甲 的累計分配目標（整元，可負數）", { exact: true })
    .fill("0");
  await panel
    .getByLabel("分配決定／差異原因", { exact: true })
    .fill("無完整試算，仍由我決定");
  await panel
    .getByRole("button", { name: "保存人工分配決定", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("人工分配決定已保存");
  await panel.locator("summary").filter({ hasText: "由我決定結案" }).click();
  await panel
    .getByLabel("結案決定與說明", { exact: true })
    .fill("資料未完整仍由我決定先結案");
  await panel
    .getByRole("button", { name: "記錄由我決定結案", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("使用者結案決定");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});
