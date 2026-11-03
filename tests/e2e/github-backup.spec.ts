import { test, expect, type BrowserContext } from "@playwright/test";
const token = "github_pat_" + "MockOnlyCredential".repeat(3),
  head = "a".repeat(40),
  commit = "c".repeat(40),
  blob = "b".repeat(40);
test("backs up with explicit confirmation and safely previews/restores own GitHub backup", async ({
  page,
  browser,
}) => {
  let bytes: Buffer | undefined,
    path = "",
    currentHead = head,
    puts = 0,
    denied = false;
  async function routes(context: BrowserContext) {
    await context.route("https://api.github.com/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      expect(req.headers()["authorization"]).toBe(`Bearer ${token}`);
      if (denied) {
        await route.fulfill({ status: 403, json: { message: token } });
        return;
      }
      let result: any;
      if (url.pathname === "/user") result = { login: "backup-user" };
      else if (url.pathname.includes("/branches/"))
        result = { commit: { sha: currentHead } };
      else if (req.method() === "PUT") {
        puts++;
        const body = req.postDataJSON();
        bytes = Buffer.from(body.content, "base64");
        path = url.pathname.split("/contents/")[1];
        currentHead = commit;
        expect(JSON.stringify(body)).not.toContain(token);
        result = { commit: { sha: commit }, content: { sha: blob } };
      } else if (url.pathname.endsWith("/commits"))
        result = [
          {
            sha: commit,
            commit: {
              message: "Backup",
              committer: { date: "2026-11-03T00:00:00Z" },
            },
          },
        ];
      else if (url.pathname.endsWith("/contents/conmate/workspaces"))
        result = bytes ? [{ type: "dir", name: path.split("/")[2] }] : [];
      else if (url.pathname.includes("/contents/")) {
        if (!bytes) {
          await route.fulfill({ status: 404, json: { message: "not found" } });
          return;
        }
        result = {
          type: "file",
          sha: blob,
          size: bytes.length,
          encoding: "base64",
          content: bytes.toString("base64"),
        };
      } else result = { private: true, permissions: { push: true } };
      await route.fulfill({ status: 200, json: result });
    });
  }
  async function connect(p: typeof page) {
    await p.getByLabel("GitHub 擁有者", { exact: true }).fill("backup-user");
    await p.getByLabel("私有儲存庫名稱").fill("conmate-private");
    await p.getByLabel("Fine-grained 個人存取權杖").fill(token);
    await p.getByRole("button", { name: "以權杖連接 GitHub" }).click();
    await expect(p.locator(".connection-state")).toContainText("backup-user");
  }
  await routes(page.context());
  await page.goto("");
  await page.getByRole("button", { name: "建立工作區", exact: true }).click();
  await page.getByLabel("工作區名稱").fill("雲端練習");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "建立工作區", exact: true })
    .click();
  await page.goto("#/products");
  await page.getByLabel("商品名稱（必填）").fill("備份徽章");
  await page.getByRole("button", { name: "建立商品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("商品已建立");
  await page.goto("#/templates");
  await connect(page);
  expect(puts).toBe(0);
  await page.getByRole("button", { name: "準備 GitHub 備份預覽" }).click();
  await expect(
    page.getByRole("heading", { name: "待確認備份：雲端練習" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "確認備份到 GitHub" }),
  ).toBeDisabled();
  expect(puts).toBe(0);
  await page
    .getByLabel("我已核對工作區、目的地及遠端內容", { exact: false })
    .check();
  await page.getByRole("button", { name: "確認備份到 GitHub" }).click();
  await expect(page.locator(".cloud-panel .success-notice")).toContainText(
    "GitHub 已確認備份",
  );
  expect(puts).toBe(1);
  expect(bytes?.length).toBeGreaterThan(1000);
  await expect(page.locator(".cloud-panel")).toContainText(
    "此裝置記錄的上次 GitHub 成功備份",
  );
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("conmate-workspaces-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await Promise.all(
        Array.from(db.objectStoreNames).map(
          (name) =>
            new Promise<any[]>((resolve, reject) => {
              const request = db.transaction(name).objectStore(name).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
      return JSON.stringify({
        rows,
        local: { ...localStorage },
        session: { ...sessionStorage },
      });
    } finally {
      db.close();
    }
  });
  expect(stored).not.toContain(token);
  await page.goto("#/products");
  await page.goto("#/templates");
  await expect(page.getByLabel("Fine-grained 個人存取權杖")).toHaveValue("");
  await expect(page.locator(".connection-state")).toHaveCount(0);
  await connect(page);
  denied = true;
  await page.getByRole("button", { name: "準備 GitHub 備份預覽" }).click();
  await expect(page.locator(".cloud-panel [role=alert]")).toContainText("權限");
  await expect(page.locator(".cloud-panel")).not.toContainText(token);
  expect(puts).toBe(1);
  denied = false;
  const context = await browser.newContext();
  await routes(context);
  try {
    const fresh = await context.newPage();
    await fresh.goto("http://127.0.0.1:4173/ConMate/#/templates");
    await connect(fresh);
    await fresh.getByRole("button", { name: "讀取雲端備份清單" }).click();
    await fresh.getByRole("button", { name: "讀取此檔版本紀錄" }).click();
    await fresh.getByLabel("要檢查的版本").selectOption(commit);
    await fresh.getByRole("button", { name: "下載並檢查遠端備份" }).click();
    await expect(
      fresh.getByRole("heading", { name: "檢查通過：雲端練習" }),
    ).toBeVisible();
    await expect(
      fresh.getByRole("button", { name: "確認新增還原工作區" }),
    ).toBeDisabled();
    await fresh.getByLabel("我確認以檔案中的完整紀錄新增工作區").check();
    await fresh.getByRole("button", { name: "確認新增還原工作區" }).click();
    await expect(
      fresh.locator(".success-notice").filter({ hasText: "還原完成" }),
    ).toBeVisible();
    await fresh.goto("http://127.0.0.1:4173/ConMate/#/products");
    await expect(
      fresh.getByRole("heading", { name: "備份徽章", exact: true }),
    ).toBeVisible();
    expect(puts).toBe(1);
  } finally {
    await context.close();
  }
});
