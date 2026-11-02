<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
const workspaces = useWorkspaceStore();
const catalog = useCatalogStore();
const projectId = ref<string>();
const eventId = ref<string>();
const showArchived = ref(false);
const notice = ref("");
const error = ref("");
const confirmation = ref<{
  kind: "project" | "event";
  id: string;
  name: string;
  archived: boolean;
}>();
const projectForm = reactive({ name: "", description: "" });
const eventForm = reactive({
  name: "",
  startDate: "",
  endDate: "",
  venue: "",
  notes: "",
  projectIds: [] as string[],
});
const projects = computed(
  () =>
    catalog.snapshot?.projects.filter(
      (p) => showArchived.value || !p.archived,
    ) ?? [],
);
const events = computed(
  () =>
    catalog.snapshot?.events.filter((e) => showArchived.value || !e.archived) ??
    [],
);
const existingLinks = computed(
  () =>
    catalog.snapshot?.projectEvents
      .filter((link) => link.eventId === eventId.value)
      .map((link) => link.projectId) ?? [],
);
const selectableProjects = computed(
  () =>
    catalog.snapshot?.projects.filter(
      (p) => !p.archived || existingLinks.value.includes(p.id),
    ) ?? [],
);
function resetProject() {
  projectId.value = undefined;
  Object.assign(projectForm, { name: "", description: "" });
}
function resetEvent() {
  eventId.value = undefined;
  Object.assign(eventForm, {
    name: "",
    startDate: "",
    endDate: "",
    venue: "",
    notes: "",
    projectIds: [],
  });
}
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    resetProject();
    resetEvent();
    confirmation.value = undefined;
    notice.value = "";
    error.value = "";
    if (id) await catalog.load(id);
  },
  { immediate: true },
);
function editProject(id: string) {
  const p = catalog.snapshot?.projects.find((p) => p.id === id);
  if (!p) return;
  projectId.value = id;
  Object.assign(projectForm, { name: p.name, description: p.description });
  document.getElementById("project-name")?.focus();
}
function editEvent(id: string) {
  const e = catalog.snapshot?.events.find((e) => e.id === id);
  if (!e) return;
  eventId.value = id;
  Object.assign(eventForm, {
    name: e.name,
    startDate: e.startDate,
    endDate: e.endDate,
    venue: e.venue,
    notes: e.notes,
    projectIds:
      catalog.snapshot?.projectEvents
        .filter((link) => link.eventId === id)
        .map((link) => link.projectId) ?? [],
  });
  document.getElementById("event-name")?.focus();
}
async function saveProject() {
  if (catalog.busy) return;
  error.value = "";
  notice.value = "";
  try {
    await catalog.saveProject({ ...projectForm }, projectId.value);
    notice.value = projectId.value ? "企劃已更新。" : "企劃已建立。";
    resetProject();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "企劃儲存失敗。";
  }
}
async function saveEvent() {
  if (catalog.busy) return;
  error.value = "";
  notice.value = "";
  try {
    await catalog.saveEvent(
      {
        ...eventForm,
        endDate: eventForm.endDate || eventForm.startDate,
        projectIds: [...eventForm.projectIds],
      },
      eventId.value,
    );
    notice.value = eventId.value ? "場次已更新。" : "場次已建立。";
    resetEvent();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "場次儲存失敗。";
  }
}
async function requestArchive(target: NonNullable<typeof confirmation.value>) {
  confirmation.value = target;
  await nextTick();
  document.getElementById("archive-plan-title")?.focus();
}
async function toggleArchived() {
  const target = confirmation.value;
  if (!target || catalog.busy) return;
  error.value = "";
  notice.value = "";
  try {
    if (target.kind === "project") await catalog.archiveProject(target.id);
    else await catalog.archiveEvent(target.id);
    notice.value = `${target.kind === "project" ? "企劃" : "場次"}已${target.archived ? "恢復" : "封存"}。`;
    if (target.kind === "project") {
      if (projectId.value === target.id) resetProject();
      if (!target.archived && !existingLinks.value.includes(target.id))
        eventForm.projectIds = eventForm.projectIds.filter(
          (id) => id !== target.id,
        );
    } else if (eventId.value === target.id) resetEvent();
    confirmation.value = undefined;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "變更失敗。";
  }
}
function projectNames(id: string) {
  return (
    catalog.snapshot?.projectEvents
      .filter((link) => link.eventId === id)
      .map((link) => {
        const p = catalog.snapshot?.projects.find(
          (p) => p.id === link.projectId,
        );
        return p ? p.name + (p.archived ? "（已封存）" : "") : "未知企劃";
      })
      .join("、") || "尚未連結企劃"
  );
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">PLAN YOUR NEXT MEETING</div>
      <h1>企劃與場次</h1>
      <p>整理創作企劃，並連結準備參加的場次。</p>
    </div>
  </section>
  <div class="info-banner">
    <div>
      <strong>封存用來整理清單，並不代表結案。</strong>
      <p>
        封存不會清除庫存或款項。本頁提供企劃與場次建檔，不含販售、收款或庫存功能。
      </p>
    </div>
  </div>
  <section v-if="!workspaces.activeWorkspaceId" class="panel">
    <h2>先建立工作區</h2>
    <p>企劃與場次會保存在所選工作區中。</p>
    <RouterLink class="button primary" to="/">前往工作區總覽</RouterLink>
  </section>
  <template v-else>
    <div class="field workspace-picker">
      <label for="plans-workspace">目前工作區</label
      ><select
        id="plans-workspace"
        :value="workspaces.activeWorkspaceId"
        :disabled="catalog.busy"
        @change="workspaces.select(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="w in workspaces.workspaces" :key="w.id" :value="w.id">
          {{ w.name }}
        </option>
      </select>
    </div>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="error || catalog.error" class="error-notice" role="alert">
      {{ error || catalog.error
      }}<button
        type="button"
        class="text-button"
        :disabled="catalog.busy"
        @click="catalog.load(workspaces.activeWorkspaceId)"
      >
        重新讀取
      </button>
    </p>
    <p v-if="!catalog.snapshot && !catalog.error" role="status">
      正在讀取企劃與場次…
    </p>
    <template v-if="catalog.snapshot">
      <label class="check-option"
        ><input
          v-model="showArchived"
          type="checkbox"
        />顯示封存的企劃與場次</label
      >
      <section
        v-if="confirmation"
        class="panel confirmation"
        aria-labelledby="archive-plan-title"
      >
        <h2 id="archive-plan-title" tabindex="-1">
          {{ confirmation.archived ? "恢復" : "封存" }}「{{
            confirmation.name
          }}」？
        </h2>
        <p>
          {{
            confirmation.archived
              ? "恢復後會重新顯示在使用中的清單。"
              : "封存後仍保留資料與連結，可隨時恢復。這不代表結案，也不會清除庫存或款項。"
          }}
        </p>
        <div class="actions">
          <button
            class="button secondary"
            type="button"
            :disabled="catalog.busy"
            @click="confirmation = undefined"
          >
            取消</button
          ><button
            class="button primary"
            type="button"
            :disabled="catalog.busy"
            @click="toggleArchived"
          >
            確認{{ confirmation.archived ? "恢復" : "封存" }}
          </button>
        </div>
      </section>
      <section class="section-block" aria-labelledby="projects-title">
        <div class="section-title">
          <div>
            <h2 id="projects-title">創作企劃</h2>
            <p>企劃可與多個場次連結，商品仍可在商品建檔頁整理。</p>
          </div>
        </div>
        <form class="panel" @submit.prevent="saveProject">
          <h3>{{ projectId ? "編輯企劃" : "新增企劃" }}</h3>
          <fieldset :disabled="catalog.busy">
            <div class="field">
              <label for="project-name">企劃名稱（必填）</label
              ><input
                id="project-name"
                v-model="projectForm.name"
                required
                maxlength="80"
                placeholder="例如：星空旅行系列"
              />
            </div>
            <div class="field">
              <label for="project-description">企劃說明</label
              ><textarea
                id="project-description"
                v-model="projectForm.description"
                maxlength="2000"
                rows="3"
              ></textarea>
            </div>
          </fieldset>
          <div class="actions">
            <button
              v-if="projectId"
              type="button"
              class="button secondary"
              :disabled="catalog.busy"
              @click="resetProject"
            >
              取消編輯企劃</button
            ><button
              class="button primary"
              :disabled="catalog.busy || !projectForm.name.trim()"
            >
              {{
                catalog.busy ? "儲存中…" : projectId ? "儲存企劃" : "建立企劃"
              }}
            </button>
          </div>
        </form>
        <p v-if="!projects.length" class="empty-state">
          目前沒有符合條件的企劃。
        </p>
        <div class="record-list">
          <article v-for="p in projects" :key="p.id" class="panel record">
            <div>
              <span class="soft-label">{{ p.code }}</span
              ><span v-if="p.archived" class="soft-label">已封存</span>
              <h3>{{ p.name }}</h3>
              <p v-if="p.description" class="preserve-lines">
                {{ p.description }}
              </p>
              <p>
                使用中商品：{{
                  catalog.snapshot.products.filter(
                    (item) => item.projectId === p.id && !item.archived,
                  ).length
                }}
                項（商品建檔筆數）
              </p>
            </div>
            <div class="actions">
              <button
                type="button"
                class="button secondary"
                :disabled="catalog.busy"
                :aria-label="`編輯企劃 ${p.name}`"
                @click="editProject(p.id)"
              >
                編輯</button
              ><button
                type="button"
                class="text-button"
                :disabled="catalog.busy"
                :aria-label="`${p.archived ? '恢復' : '封存'}企劃 ${p.name}`"
                @click="
                  requestArchive({
                    kind: 'project',
                    id: p.id,
                    name: p.name,
                    archived: p.archived,
                  })
                "
              >
                {{ p.archived ? "恢復" : "封存" }}
              </button>
            </div>
          </article>
        </div>
      </section>
      <section class="section-block" aria-labelledby="events-title">
        <div class="section-title">
          <div>
            <h2 id="events-title">參加場次</h2>
            <p>記錄日期、地點與本次帶上的企劃。</p>
          </div>
        </div>
        <form class="panel" @submit.prevent="saveEvent">
          <h3>{{ eventId ? "編輯場次" : "新增場次" }}</h3>
          <fieldset :disabled="catalog.busy">
            <div class="field">
              <label for="event-name">場次名稱（必填）</label
              ><input
                id="event-name"
                v-model="eventForm.name"
                required
                maxlength="80"
              />
            </div>
            <div class="date-grid">
              <div class="field">
                <label for="event-start">開始日期（必填）</label
                ><input
                  id="event-start"
                  v-model="eventForm.startDate"
                  type="date"
                  required
                />
              </div>
              <div class="field">
                <label for="event-end">結束日期</label
                ><input
                  id="event-end"
                  v-model="eventForm.endDate"
                  type="date"
                  :min="eventForm.startDate || undefined"
                  aria-describedby="event-end-help"
                /><small id="event-end-help">留白時使用開始日期。</small>
              </div>
            </div>
            <div class="field">
              <label for="event-venue">場次地點</label
              ><input
                id="event-venue"
                v-model="eventForm.venue"
                maxlength="200"
              />
            </div>
            <div class="field">
              <label for="event-notes">場次備註</label
              ><textarea
                id="event-notes"
                v-model="eventForm.notes"
                maxlength="2000"
                rows="3"
              ></textarea>
            </div>
            <div class="field">
              <span id="event-projects-label">連結企劃（可複選）</span>
              <div role="group" aria-labelledby="event-projects-label">
                <p v-if="!selectableProjects.length">
                  尚無可連結的企劃，請先新增企劃。
                </p>
                <label
                  v-for="p in selectableProjects"
                  :key="p.id"
                  class="check-option"
                  ><input
                    v-model="eventForm.projectIds"
                    type="checkbox"
                    :value="p.id"
                    :disabled="
                      p.archived && !eventForm.projectIds.includes(p.id)
                    "
                  />{{ p.name
                  }}{{
                    catalog.snapshot.projects.filter(
                      (item) => item.name === p.name,
                    ).length > 1
                      ? `（${p.code}）`
                      : ""
                  }}{{ p.archived ? "（已封存，可取消連結）" : "" }}</label
                >
              </div>
            </div>
          </fieldset>
          <div class="actions">
            <button
              v-if="eventId"
              type="button"
              class="button secondary"
              :disabled="catalog.busy"
              @click="resetEvent"
            >
              取消編輯場次</button
            ><button
              class="button primary"
              :disabled="
                catalog.busy || !eventForm.name.trim() || !eventForm.startDate
              "
            >
              {{ catalog.busy ? "儲存中…" : eventId ? "儲存場次" : "建立場次" }}
            </button>
          </div>
        </form>
        <p v-if="!events.length" class="empty-state">
          目前沒有符合條件的場次。
        </p>
        <div class="record-list">
          <article v-for="e in events" :key="e.id" class="panel record">
            <div>
              <span class="soft-label">{{ e.code }}</span
              ><span v-if="e.archived" class="soft-label">已封存</span>
              <h3>{{ e.name }}</h3>
              <p>
                {{ e.startDate
                }}<span v-if="e.endDate !== e.startDate">
                  ～ {{ e.endDate }}</span
                >
              </p>
              <p v-if="e.venue">地點：{{ e.venue }}</p>
              <p>連結企劃：{{ projectNames(e.id) }}</p>
              <p v-if="e.notes" class="preserve-lines">{{ e.notes }}</p>
            </div>
            <div class="actions">
              <button
                type="button"
                class="button secondary"
                :disabled="catalog.busy"
                :aria-label="`編輯場次 ${e.name}`"
                @click="editEvent(e.id)"
              >
                編輯</button
              ><button
                type="button"
                class="text-button"
                :disabled="catalog.busy"
                :aria-label="`${e.archived ? '恢復' : '封存'}場次 ${e.name}`"
                @click="
                  requestArchive({
                    kind: 'event',
                    id: e.id,
                    name: e.name,
                    archived: e.archived,
                  })
                "
              >
                {{ e.archived ? "恢復" : "封存" }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>
  </template>
</template>
<style scoped>
.panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  margin-top: 16px;
  overflow-wrap: anywhere;
}
.panel h2 {
  font-size: 19px;
}
.panel h3 {
  font-size: 17px;
  margin: 10px 0 16px;
}
.panel p,
.empty-state {
  font-size: 14px;
  line-height: 1.9;
  color: #58674f;
  margin-top: 8px;
}
.workspace-picker {
  max-width: 440px;
}
.field {
  display: grid;
  gap: 8px;
  min-width: 0;
}
label,
legend,
#event-projects-label {
  font-size: 14px;
  font-weight: 500;
}
input:not([type="checkbox"]),
select,
textarea {
  min-width: 0;
  width: 100%;
  min-height: 46px;
  border: 1px solid #acbda8;
  border-radius: 7px;
  padding: 10px 12px;
  background: #fcfdf9;
  color: var(--text);
  font: inherit;
}
textarea {
  resize: vertical;
}
fieldset {
  min-width: 0;
  border: 0;
  padding: 0;
  display: grid;
  gap: 18px;
  margin: 0;
}
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 18px;
}
.check-option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin-top: 8px;
}
input[type="checkbox"] {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.record-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}
.record {
  margin-top: 0;
}
.soft-label + .soft-label {
  margin-left: 8px;
}
.confirmation {
  border-color: #b7c7a7;
  background: #f4f7ed;
}
.date-grid {
  display: grid;
  gap: 18px;
}
small {
  font-size: 13px;
  color: #58674f;
}
.preserve-lines {
  white-space: pre-wrap;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (min-width: 700px) {
  .date-grid {
    grid-template-columns: 1fr 1fr;
  }
  .record {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  .record .actions {
    flex-shrink: 0;
  }
}
@media (max-width: 520px) {
  .panel {
    padding: 17px;
  }
}
</style>
