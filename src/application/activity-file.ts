import type { ActivityPacket } from "../domain/activity/types";
async function workerRequest<T>(
  request: unknown,
  transfer: Transferable[] = [],
): Promise<T> {
  const worker = new Worker(
    new URL("../workers/activity-file.worker.ts", import.meta.url),
    { type: "module" },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("活動檔處理超過30秒，原資料未更動。")),
        30000,
      );
      worker.onerror = () =>
        reject(new Error("活動檔處理失敗，原資料未更動。"));
      worker.onmessage = (event) =>
        event.data.ok
          ? resolve((event.data.packet ?? event.data.bytes) as T)
          : reject(new Error(event.data.error));
      worker.postMessage(request, transfer);
    });
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}
export async function checkActivityFile(file: File): Promise<ActivityPacket> {
  if (!file.name.toLowerCase().endsWith(".xlsx"))
    throw new Error("請選擇.xlsx活動專案檔。");
  if (file.size > 10 * 1024 * 1024) throw new Error("活動專案檔上限10 MB。");
  const bytes = await file.arrayBuffer();
  return workerRequest<ActivityPacket>({ kind: "inspect", bytes }, [bytes]);
}
export const activityBytes = (packet: ActivityPacket) =>
  workerRequest<ArrayBuffer>({ kind: "export", packet });
export async function downloadActivityPacket(packet: ActivityPacket) {
  const bytes = await activityBytes(packet);
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  const safe = packet.name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .slice(0, 60);
  a.download = `ConMate-${packet.closure ? "活動結案" : "活動進行"}-${safe}-r${packet.revision}.xlsx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return {
    handoffId: packet.handoffId,
    revision: packet.revision,
    initiatedAt: new Date().toISOString(),
  };
}
