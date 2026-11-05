import { inspectProject } from "../infrastructure/excel/restore";
import {
  buildMasterDataImportWorkbook,
  parseMasterDataImport,
} from "../infrastructure/excel/master-data-import";
import type { MasterDataImportSource } from "../infrastructure/excel/master-data-import";

type Request =
  | { type: "restore"; bytes: ArrayBuffer }
  | { type: "parse"; bytes: ArrayBuffer }
  | { type: "template"; snapshot: MasterDataImportSource };

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const request = event.data;
    if (request.type === "restore") {
      self.postMessage({
        ok: true,
        snapshot: await inspectProject(request.bytes),
      });
      return;
    }
    const result =
      request.type === "template"
        ? await buildMasterDataImportWorkbook(request.snapshot)
        : await parseMasterDataImport(request.bytes);
    self.postMessage({ ok: true, result });
  } catch (e) {
    self.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : "無法讀取此檔案。",
    });
  }
};
