import type {
  OperationalReport,
  CashFlowReport,
} from "../domain/reports/operations";
/** A report download is not a project backup and must never update backup status. */
export async function downloadReport(
  report: OperationalReport,
  cash: CashFlowReport,
) {
  const worker = new Worker(
    new URL("../workers/report-export.worker.ts", import.meta.url),
    { type: "module" },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("報表匯出超過30秒，請縮小查詢範圍後重試。")),
        30000,
      );
      worker.onmessage = (event) =>
        event.data.ok
          ? resolve(event.data.bytes)
          : reject(new Error(event.data.error));
      worker.onerror = () =>
        reject(new Error("報表產生失敗，本機資料未更動。"));
      worker.postMessage({ report, cash });
    });
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    const safeName = report.workspaceName
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .slice(0, 60);
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    anchor.download = `ConMate-營運報表-${safeName}-${date}.xlsx`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}
