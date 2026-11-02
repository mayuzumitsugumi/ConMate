<script setup lang="ts">
import { watch, ref, onUnmounted } from "vue";
import { liveQuery } from "dexie";
import { useWorkspaceStore } from "../../app/workspace-store";
import { catalogRepository } from "../../infrastructure/storage/catalog";
import { database } from "../../infrastructure/storage/workspaces";
import { backupReminder } from "../../infrastructure/storage/local-backups";
const store = useWorkspaceStore(),
  message = ref("");
let subscription: { unsubscribe(): void } | undefined;
watch(
  () => store.activeWorkspaceId,
  (id) => {
    subscription?.unsubscribe();
    message.value = "";
    if (!id) return;
    subscription = liveQuery(async () => {
      const [snapshot, status] = await Promise.all([
        catalogRepository.read(id),
        database.backupStatus.get(id),
      ]);
      return backupReminder(status, snapshot.revision);
    }).subscribe({
      next: (next) => {
        message.value = next;
      },
      error: () => {
        message.value = "無法讀取備份狀態，建議先匯出一份專案檔。";
      },
    });
  },
  { immediate: true },
);
onUnmounted(() => subscription?.unsubscribe());
</script>
<template>
  <aside v-if="message" class="backup-reminder" aria-label="備份提醒">
    <span>{{ message }}</span> <RouterLink to="/templates">前往備份</RouterLink>
  </aside>
</template>
<style scoped>
.backup-reminder {
  padding: 12px 24px;
  background: #fff7de;
  color: #59441d;
  line-height: 1.8;
  border-bottom: 1px solid #decc9d;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 14px;
}
.backup-reminder a {
  font-weight: 600;
  min-height: 24px;
}
</style>
