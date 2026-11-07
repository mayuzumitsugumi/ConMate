import { exportProject } from "../infrastructure/excel/project";
import type { CatalogSnapshot } from "../domain/models/catalog";
self.onmessage = async (event: MessageEvent<CatalogSnapshot>) => {
  try {
    const bytes = await exportProject(event.data);
    self.postMessage({ ok: true, bytes }, { transfer: [bytes] });
  } catch (error) {
    self.postMessage({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "專案檔產生失敗，請保留本機資料並重試。",
    });
  }
};
