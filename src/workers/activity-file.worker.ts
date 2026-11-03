import type { ActivityPacket } from "../domain/activity/types";
import {
  inspectActivity,
  exportActivity,
} from "../infrastructure/excel/activity";
type Request =
  | { kind: "inspect"; bytes: ArrayBuffer }
  | { kind: "export"; packet: ActivityPacket };
self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const request = event.data;
    if (request.kind === "inspect")
      self.postMessage({
        ok: true,
        packet: await inspectActivity(request.bytes),
      });
    else {
      const bytes = await exportActivity(request.packet);
      self.postMessage({ ok: true, bytes }, { transfer: [bytes] });
    }
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "活動檔處理失敗。",
    });
  }
};
