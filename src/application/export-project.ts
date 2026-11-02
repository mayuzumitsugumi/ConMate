import { recordDownload } from "../infrastructure/storage/local-backups";
import type { CatalogSnapshot } from "../domain/models/catalog";
import { catalogRepository } from "../infrastructure/storage/catalog";
export async function downloadProject(workspaceId: string) {
  const snapshot = await catalogRepository.read(workspaceId);
  const result = await downloadSnapshot(snapshot);
  let trackingStored = true;
  try {
    await recordDownload(
      result.workspaceId,
      result.revision,
      result.initiatedAt,
    );
  } catch {
    trackingStored = false;
  }
  return { ...result, trackingStored };
}
export async function downloadSnapshot(
  snapshot: CatalogSnapshot,
  recovery = false,
) {
  const worker = new Worker(
    new URL("../workers/project-export.worker.ts", import.meta.url),
    { type: "module" },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("匯出超過30秒，請稍後重試；原資料仍保留。")),
        30000,
      );
      worker.onmessage = (event) =>
        event.data.ok
          ? resolve(event.data.bytes)
          : reject(new Error(event.data.error));
      worker.onerror = () =>
        reject(new Error("產生檔案時發生錯誤，原資料仍保存在本機。"));
      worker.postMessage(snapshot);
    });
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    const safeName = snapshot.workspace.name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .slice(0, 60);
    anchor.download = `${recovery ? "ConMate-復原快照" : "ConMate"}-${safeName}-${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}.xlsx`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return {
      workspaceId: snapshot.workspaceId,
      revision: snapshot.revision,
      initiatedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}
