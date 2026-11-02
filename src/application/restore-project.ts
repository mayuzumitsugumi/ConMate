import type { CatalogSnapshot } from "../domain/models/catalog";
export async function checkProjectFile(file: File): Promise<CatalogSnapshot> {
  if (!file.name.toLowerCase().endsWith(".xlsx"))
    throw new Error("請選擇 .xlsx 網站專案檔。");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("目前支援最大 10 MB 的網站專案檔。");
  const worker = new Worker(
    new URL("../workers/project-restore.worker.ts", import.meta.url),
    { type: "module" },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<CatalogSnapshot>(async (resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("檢查超過 30 秒，請確認檔案大小與格式後重試。")),
        30000,
      );
      worker.onmessage = (event) =>
        event.data.ok
          ? resolve(event.data.snapshot)
          : reject(new Error(event.data.error));
      worker.onerror = () =>
        reject(new Error("檔案檢查失敗；本機資料未更動。"));
      try {
        const bytes = await file.arrayBuffer();
        worker.postMessage(bytes, [bytes]);
      } catch {
        reject(new Error("無法讀取檔案。"));
      }
    });
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}
