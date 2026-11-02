import { inspectProject } from "../infrastructure/excel/restore";
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ ok: true, snapshot: await inspectProject(event.data) });
  } catch (e) {
    self.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : "無法讀取此檔案。",
    });
  }
};
