import {
  putProject,
  putEvent,
  toggleProjectArchive,
  toggleEventArchive,
} from "../domain/catalog/projects";
import { defineStore } from "pinia";
import { ref } from "vue";
import { catalogRepository } from "../infrastructure/storage/catalog";
import {
  putProduct,
  putTag,
  putField,
  SUGGESTED_TAGS,
} from "../domain/catalog/operations";
import type {
  CatalogSnapshot,
  FieldInput,
  ProductInput,
  ProjectInput,
  EventInput,
} from "../domain/models/catalog";
export const useCatalogStore = defineStore("catalog", () => {
  const snapshot = ref<CatalogSnapshot | null>(null),
    busy = ref(false),
    error = ref("");
  let request = 0;
  async function load(workspaceId: string) {
    const current = ++request;
    snapshot.value = null;
    error.value = "";
    if (!workspaceId) return;
    try {
      const next = await catalogRepository.read(workspaceId);
      if (current === request) snapshot.value = next;
    } catch (e) {
      if (current === request)
        error.value = e instanceof Error ? e.message : "無法讀取本機資料。";
    }
  }
  async function mutate(operation: (s: CatalogSnapshot) => void) {
    if (busy.value) throw new Error("正在儲存，請稍候。");
    const previous = snapshot.value;
    if (!previous) throw new Error("請先選擇並載入工作區。");
    busy.value = true;
    error.value = "";
    try {
      const next = await catalogRepository.change(
        previous.workspaceId,
        previous.revision,
        operation,
      );
      if (snapshot.value?.workspaceId === previous.workspaceId)
        snapshot.value = next;
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : "儲存失敗，原始資料未更動。";
      throw new Error(error.value);
    } finally {
      busy.value = false;
    }
  }
  const saveProduct = (input: ProductInput, id?: string) =>
    mutate((s) => {
      putProduct(s, input, id);
    });
  const archiveProduct = (id: string) =>
    mutate((s) => {
      const p = s.products.find((p) => p.id === id);
      if (!p) throw new Error("找不到商品。");
      p.archived = !p.archived;
      p.updatedAt = new Date().toISOString();
    });
  const saveTag = (name: string, id?: string) =>
    mutate((s) => putTag(s, name, id));
  const archiveTag = (id: string) =>
    mutate((s) => {
      const t = s.tags.find((t) => t.id === id);
      if (!t) throw new Error("找不到標記。");
      t.archived = !t.archived;
    });
  const saveField = (input: FieldInput, id?: string) =>
    mutate((s) => putField(s, input, id));
  const archiveField = (id: string) =>
    mutate((s) => {
      const f = s.fields.find((f) => f.id === id);
      if (!f) throw new Error("找不到欄位。");
      f.archived = !f.archived;
    });
  const addSuggestedTags = () =>
    mutate((s) => {
      for (const name of SUGGESTED_TAGS)
        if (!s.tags.some((t) => t.name === name)) putTag(s, name);
    });
  const saveProject = (input: ProjectInput, id?: string) =>
    mutate((s) => {
      putProject(s, input, id);
    });
  const saveEvent = (input: EventInput, id?: string) =>
    mutate((s) => {
      putEvent(s, input, id);
    });
  const archiveProject = (id: string) =>
    mutate((s) => toggleProjectArchive(s, id));
  const archiveEvent = (id: string) => mutate((s) => toggleEventArchive(s, id));
  return {
    saveProject,
    saveEvent,
    archiveProject,
    archiveEvent,
    snapshot,
    busy,
    error,
    load,
    saveProduct,
    archiveProduct,
    saveTag,
    archiveTag,
    saveField,
    archiveField,
    addSuggestedTags,
  };
});
