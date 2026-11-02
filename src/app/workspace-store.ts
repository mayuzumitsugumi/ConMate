import { defineStore } from "pinia";
import { ref } from "vue";
import type { Workspace } from "../domain/models/workspace";
import { workspaceRepository } from "../infrastructure/storage/workspaces";

export const useWorkspaceStore = defineStore("workspaces", () => {
  const workspaces = ref<Workspace[]>([]);
  const loading = ref(true);
  const saving = ref(false);
  const storageError = ref("");
  async function load() {
    try {
      workspaces.value = await workspaceRepository.list();
      storageError.value = "";
    } catch {
      storageError.value =
        "無法讀取本機資料。請確認瀏覽器允許網站儲存，並避免私人瀏覽模式。";
    } finally {
      loading.value = false;
    }
  }
  async function create(name: string) {
    if (saving.value) return;
    saving.value = true;
    try {
      const result = await workspaceRepository.create(name);
      workspaces.value.push(result);
      storageError.value = "";
      return result;
    } catch (error) {
      storageError.value =
        error instanceof Error && error.message.includes("工作區名稱")
          ? error.message
          : "尚未儲存成功。請確認儲存空間與瀏覽器設定後再試一次。";
      throw new Error(storageError.value);
    } finally {
      saving.value = false;
    }
  }
  return { workspaces, loading, saving, storageError, load, create };
});
