import { exportReport } from "../infrastructure/excel/report";
import type {
  OperationalReport,
  CashFlowReport,
} from "../domain/reports/operations";
self.onmessage = async (
  event: MessageEvent<{ report: OperationalReport; cash: CashFlowReport }>,
) => {
  try {
    const bytes = await exportReport(event.data.report, event.data.cash);
    self.postMessage({ ok: true, bytes }, { transfer: [bytes] });
  } catch {
    self.postMessage({
      ok: false,
      error: "報表產生失敗，請重新整理查詢後再試；本機資料未更動。",
    });
  }
};
