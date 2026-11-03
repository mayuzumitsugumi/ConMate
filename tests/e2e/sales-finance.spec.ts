import { test, expect } from "@playwright/test";
test("sells actual direct/draw items, refunds, calculates explicit costs and tracks principal", async ({
  page,
}) => {
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("場次財務測試");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存在這台裝置");
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("星空徽章");
  await page.getByLabel("新創作者名稱").fill("甲");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page.getByLabel("商品名稱（必填）").fill("吊飾");
  await page.getByRole("button", { name: "新增創作者", exact: true }).click();
  await page.getByLabel("新創作者名稱").fill("乙");
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
  await page.getByLabel("數量", { exact: true }).fill("10");
  await page.getByLabel("異動原因").fill("第一批");
  await page.getByRole("button", { name: "確認登記異動" }).click();
  await expect(page.getByRole("status")).toContainText("庫存異動已儲存");
  await page.goto("#/sales");
  await page.getByLabel("出貨庫位（必填）").selectOption({ label: "攤位" });
  const product = page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: "星空徽章", exact: true }),
    });
  await product.getByRole("button", { name: "指定購買", exact: true }).click();
  const direct = page.locator(".cart-line").filter({ hasText: "指定" });
  await direct.getByLabel("數量", { exact: true }).fill("2");
  await direct.getByLabel("單價（新台幣整元）").fill("60");
  await product.getByRole("button", { name: "抽選結果", exact: true }).click();
  await page
    .locator(".cart-line")
    .filter({ hasText: "抽選" })
    .getByLabel("單價（新台幣整元）")
    .fill("50");
  await page.getByLabel("收到金額（新台幣整元）").fill("100");
  await expect(
    page.getByRole("button", { name: "確認收款", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("收到金額（新台幣整元）").fill("500");
  await page.getByRole("button", { name: "確認收款", exact: true }).click();
  await expect(page.getByRole("region", { name: "成交確認" })).toContainText(
    "找零 330 元",
  );
  await page
    .getByRole("button", { name: "完成交易並扣庫", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("交易已完成");
  await page.reload();
  await expect(
    page.getByText("工作區有效交易營收：170 元", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "取消／全額退款並回庫", exact: true })
    .click();
  await page.getByLabel("取消原因", { exact: true }).fill("客人取消");
  await page.getByLabel("我已全額退款，且全部商品已回到原庫位").check();
  await page
    .getByRole("button", { name: "記錄退款並回庫", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已記錄全額退款");
  await page.goto("#/finance");
  await page.getByLabel("批次／成本名稱", { exact: true }).fill("第一批成本");
  await page.getByLabel("成本商品", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("製作數量", { exact: true }).fill("30");
  await page.getByLabel("實際印製總額（元）", { exact: true }).fill("1368");
  await expect(
    page.getByText(
      "實際印製費、分配柄圖費與其他成本未完整填寫，尚無法試算綜合成本。",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel("本批分配的柄圖費（元）", { exact: true }).fill("0");
  await page.getByLabel("其他成本總額（元）", { exact: true }).fill("0");
  await page.getByLabel("試算單件售價（元）", { exact: true }).fill("200");
  await page.getByRole("button", { name: "建立成本紀錄", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("成本紀錄已儲存");
  await expect(page.getByText("45.6000 元", { exact: true })).toBeVisible();
  await page.getByLabel("代墊名稱", { exact: true }).fill("印製代墊");
  await page
    .getByLabel("實際代墊付款者", { exact: true })
    .selectOption({ label: "甲" });
  await page
    .getByLabel("約定償還本金的負擔者", { exact: true })
    .selectOption({ label: "乙" });
  await page
    .getByLabel("已實付且約定可追收本金（元）", { exact: true })
    .fill("1368");
  await page.getByRole("button", { name: "記錄代墊本金", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已記錄實際代墊本金");
  await page
    .getByRole("button", { name: "登記償還 印製代墊", exact: true })
    .click();
  await page.getByLabel("已實際償還金額（元）", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "確認已償還", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已記錄本金償還");
  await page.reload();
  await expect(page.getByText(/未還 368 元/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.goto("#/inventory");
  await expect(
    page.getByRole("table").getByRole("row").filter({ hasText: "星空徽章" }),
  ).toContainText("10");
});
