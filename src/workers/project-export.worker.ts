import { exportProject } from "../infrastructure/excel/project";
import type { CatalogSnapshot } from "../domain/models/catalog";
self.onmessage = async (event: MessageEvent<CatalogSnapshot>) => {
  try {
    const bytes = await exportProject(event.data);
    self.postMessage({ ok: true, bytes }, { transfer: [bytes] });
  } catch {
    self.postMessage({
      ok: false,
      error: "專案檔產生失敗，請保留本機資料並重試。",
    });
  }
};
