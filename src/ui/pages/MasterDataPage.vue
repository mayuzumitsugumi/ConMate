<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
const workspaces = useWorkspaceStore(),
  catalog = useCatalogStore();
const partyId = ref<string>(),
  artworkId = ref<string>();
const showArchived = ref(false),
  notice = ref(""),
  error = ref("");
const partyForm = reactive({ name: "", notes: "" });
const artworkForm = reactive({
  name: "",
  projectId: "",
  authorIds: [] as string[],
  notes: "",
});
const confirmation = ref<{
  kind: "party" | "artwork";
  id: string;
  name: string;
  archived: boolean;
}>();
const parties = computed(
  () =>
    catalog.snapshot?.parties.filter(
      (p) => showArchived.value || !p.archived,
    ) ?? [],
);
const artworks = computed(
  () =>
    catalog.snapshot?.artworks.filter(
      (a) => showArchived.value || !a.archived,
    ) ?? [],
);
const priorArtwork = computed(() =>
  catalog.snapshot?.artworks.find((a) => a.id === artworkId.value),
);
const selectableAuthors = computed(
  () =>
    catalog.snapshot?.parties.filter(
      (p) => !p.archived || priorArtwork.value?.authorIds.includes(p.id),
    ) ?? [],
);
const selectableProjects = computed(
  () =>
    catalog.snapshot?.projects.filter(
      (p) => !p.archived || priorArtwork.value?.projectId === p.id,
    ) ?? [],
);
function resetParty() {
  partyId.value = undefined;
  Object.assign(partyForm, { name: "", notes: "" });
}
function resetArtwork() {
  artworkId.value = undefined;
  Object.assign(artworkForm, {
    name: "",
    projectId: "",
    authorIds: [],
    notes: "",
  });
}
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    resetParty();
    resetArtwork();
    confirmation.value = undefined;
    notice.value = "";
    error.value = "";
    if (id) await catalog.load(id);
  },
  { immediate: true },
);
async function editParty(id: string) {
  const p = catalog.snapshot?.parties.find((p) => p.id === id);
  if (!p) return;
  partyId.value = id;
  Object.assign(partyForm, { name: p.name, notes: p.notes });
  await nextTick();
  document.getElementById("master-party-name")?.focus();
}
async function editArtwork(id: string) {
  const a = catalog.snapshot?.artworks.find((a) => a.id === id);
  if (!a) return;
  artworkId.value = id;
  Object.assign(artworkForm, {
    name: a.name,
    projectId: a.projectId,
    authorIds: [...a.authorIds],
    notes: a.notes,
  });
  await nextTick();
  document.getElementById("master-artwork-name")?.focus();
}
async function saveParty() {
  if (catalog.busy) return;
  error.value = "";
  notice.value = "";
  try {
    await catalog.saveParty({ ...partyForm }, partyId.value);
    notice.value = partyId.value ? "參與方已更新。" : "參與方已建立。";
    resetParty();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "儲存失敗。";
  }
}
async function saveArtwork() {
  if (catalog.busy) return;
  error.value = "";
  notice.value = "";
  try {
    await catalog.saveArtwork(
      { ...artworkForm, authorIds: [...artworkForm.authorIds] },
      artworkId.value,
    );
    notice.value = artworkId.value ? "柄圖已更新。" : "柄圖已建立。";
    resetArtwork();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "儲存失敗。";
  }
}
async function archive() {
  const c = confirmation.value;
  if (!c || catalog.busy) return;
  error.value = "";
  notice.value = "";
  try {
    if (c.kind === "party") await catalog.archiveParty(c.id);
    else await catalog.archiveArtwork(c.id);
    notice.value = `${c.kind === "party" ? "參與方" : "柄圖"}已${c.archived ? "恢復" : "封存"}。`;
    if (c.kind === "party" && partyId.value === c.id) resetParty();
    if (c.kind === "artwork" && artworkId.value === c.id) resetArtwork();
    confirmation.value = undefined;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "變更失敗。";
  }
}
function authorNames(ids: string[]) {
  return (
    ids
      .map(
        (id) =>
          catalog.snapshot?.parties.find((p) => p.id === id)?.name ??
          "未知作者",
      )
      .join("、") || "未指定作者"
  );
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">PEOPLE AND ARTWORK</div>
      <h1>創作者與柄圖</h1>
      <p>管理參與方與柄圖作者，保留每份創作的來源。</p>
    </div>
  </section>
  <aside class="info-banner">
    <div>
      <strong>商品創作者、商品擁有者與柄圖作者可以是不同的人。</strong>
      <p>
        本頁只整理基本資料，不會建立帳號、權限、欠款或分潤。作者請依實際合作填寫；未指定會保留未知。
      </p>
    </div>
  </aside>
  <section v-if="!workspaces.activeWorkspaceId" class="panel section-block">
    <h2>先建立工作區</h2>
    <p>創作者與柄圖會保存在所選工作區。</p>
    <RouterLink class="button primary" to="/">前往工作區總覽</RouterLink>
  </section>
  <template v-else>
    <div class="field workspace-picker">
      <label for="master-workspace">目前工作區</label
      ><select
        id="master-workspace"
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
      {{ error || catalog.error }}
      <button
        type="button"
        class="text-button"
        :disabled="catalog.busy"
        @click="catalog.load(workspaces.activeWorkspaceId)"
      >
        重新讀取
      </button>
    </p>
    <p v-if="!catalog.snapshot && !catalog.error" role="status">
      正在讀取基本資料…
    </p>
    <template v-if="catalog.snapshot">
      <label class="check-option"
        ><input
          v-model="showArchived"
          type="checkbox"
        />顯示已封存的參與方與柄圖</label
      >
      <section
        v-if="confirmation"
        class="panel confirmation"
        aria-labelledby="master-confirm"
      >
        <h2 id="master-confirm">
          {{ confirmation.archived ? "恢復" : "封存" }}「{{
            confirmation.name
          }}」？
        </h2>
        <p>
          封存後不供新商品或新柄圖關聯選用，既有商品、歷史及財務往來仍保留；之後可以恢復。封存不代表結案。
        </p>
        <div class="actions">
          <button
            type="button"
            class="button secondary"
            :disabled="catalog.busy"
            @click="confirmation = undefined"
          >
            取消</button
          ><button
            type="button"
            class="button primary"
            :disabled="catalog.busy"
            @click="archive"
          >
            確認{{ confirmation.archived ? "恢復" : "封存" }}
          </button>
        </div>
      </section>
      <section class="section-block" aria-labelledby="party-heading">
        <h2 id="party-heading">創作者與參與方</h2>
        <p>可建立創作者、總召、付款者或收款者，名稱改動不會更換識別碼。</p>
        <form class="panel" @submit.prevent="saveParty">
          <h3>{{ partyId ? "編輯參與方" : "新增參與方" }}</h3>
          <fieldset :disabled="catalog.busy">
            <div class="field">
              <label for="master-party-name">參與方名稱（必填）</label
              ><input
                id="master-party-name"
                v-model="partyForm.name"
                required
                maxlength="80"
                placeholder="例如：小星、團體總召"
              />
            </div>
            <div class="field">
              <label for="master-party-notes">參與方備註</label
              ><textarea
                id="master-party-notes"
                v-model="partyForm.notes"
                rows="3"
                maxlength="2000"
              />
            </div>
          </fieldset>
          <div class="actions">
            <button
              v-if="partyId"
              type="button"
              class="button secondary"
              :disabled="catalog.busy"
              @click="resetParty"
            >
              取消編輯</button
            ><button
              class="button primary"
              :disabled="catalog.busy || !partyForm.name.trim()"
            >
              {{
                catalog.busy
                  ? "儲存中…"
                  : partyId
                    ? "儲存參與方變更"
                    : "建立參與方"
              }}
            </button>
          </div>
        </form>
        <p v-if="!parties.length" class="empty">目前沒有符合條件的參與方。</p>
        <div class="cards">
          <article v-for="p in parties" :key="p.id" class="panel">
            <span class="soft-label">{{ p.code }}</span>
            <h3>
              {{ p.name }}
              <span v-if="p.archived" class="soft-label">已封存</span>
            </h3>
            <p v-if="p.notes" class="notes">{{ p.notes }}</p>
            <p>
              創作商品
              {{
                catalog.snapshot.products.filter((x) => x.creatorId === p.id)
                  .length
              }}
              項 · 作者柄圖
              {{
                catalog.snapshot.artworks.filter((a) =>
                  a.authorIds.includes(p.id),
                ).length
              }}
              張
            </p>
            <div class="actions">
              <button
                type="button"
                class="button secondary"
                :disabled="catalog.busy"
                :aria-label="`編輯參與方 ${p.name}`"
                @click="editParty(p.id)"
              >
                編輯</button
              ><button
                type="button"
                class="text-button"
                :disabled="catalog.busy"
                :aria-label="`${p.archived ? '恢復' : '封存'}參與方 ${p.name}`"
                @click="
                  confirmation = {
                    kind: 'party',
                    id: p.id,
                    name: p.name,
                    archived: p.archived,
                  }
                "
              >
                {{ p.archived ? "恢復" : "封存" }}
              </button>
            </div>
          </article>
        </div>
      </section>
      <section class="section-block" aria-labelledby="artwork-heading">
        <h2 id="artwork-heading">柄圖主檔</h2>
        <p>
          同一張柄圖可以用在多種商品。柄圖作者由你指定，不會沿用商品創作者。
        </p>
        <form class="panel" @submit.prevent="saveArtwork">
          <h3>{{ artworkId ? "編輯柄圖" : "新增柄圖" }}</h3>
          <fieldset :disabled="catalog.busy">
            <div class="field">
              <label for="master-artwork-name">柄圖名稱（必填）</label
              ><input
                id="master-artwork-name"
                v-model="artworkForm.name"
                required
                maxlength="120"
                placeholder="例如：星空旅行主視覺"
              />
            </div>
            <div class="field">
              <label for="master-artwork-project">柄圖所屬企劃</label
              ><select
                id="master-artwork-project"
                v-model="artworkForm.projectId"
              >
                <option value="">未指定企劃</option>
                <option
                  v-for="p in selectableProjects"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }}{{ p.archived ? "（已封存）" : "" }}
                </option>
              </select>
            </div>
            <fieldset class="author-options">
              <legend>柄圖作者（可複選）</legend>
              <p v-if="!selectableAuthors.length">
                可先從上方建立參與方，或保留未指定。
              </p>
              <label
                v-for="p in selectableAuthors"
                :key="p.id"
                class="check-option"
                ><input
                  v-model="artworkForm.authorIds"
                  type="checkbox"
                  :value="p.id"
                />{{ p.name }}（{{ p.code }}）{{
                  p.archived ? " · 已封存" : ""
                }}</label
              >
            </fieldset>
            <div class="field">
              <label for="master-artwork-notes">柄圖備註</label
              ><textarea
                id="master-artwork-notes"
                v-model="artworkForm.notes"
                rows="3"
                maxlength="2000"
              />
            </div>
          </fieldset>
          <div class="actions">
            <button
              v-if="artworkId"
              type="button"
              class="button secondary"
              :disabled="catalog.busy"
              @click="resetArtwork"
            >
              取消編輯</button
            ><button
              class="button primary"
              :disabled="catalog.busy || !artworkForm.name.trim()"
            >
              {{
                catalog.busy
                  ? "儲存中…"
                  : artworkId
                    ? "儲存柄圖變更"
                    : "建立柄圖"
              }}
            </button>
          </div>
        </form>
        <p v-if="!artworks.length" class="empty">目前沒有符合條件的柄圖。</p>
        <div class="cards">
          <article v-for="a in artworks" :key="a.id" class="panel">
            <span class="soft-label">{{ a.code }}</span>
            <h3>
              {{ a.name }}
              <span v-if="a.archived" class="soft-label">已封存</span>
            </h3>
            <p>作者：{{ authorNames(a.authorIds) }}</p>
            <p>
              企劃：{{
                catalog.snapshot.projects.find((p) => p.id === a.projectId)
                  ?.name || "未指定企劃"
              }}
              · 使用商品
              {{
                catalog.snapshot.products.filter((p) => p.artworkId === a.id)
                  .length
              }}
              項
            </p>
            <p v-if="a.notes" class="notes">{{ a.notes }}</p>
            <div class="actions">
              <button
                type="button"
                class="button secondary"
                :disabled="catalog.busy"
                :aria-label="`編輯柄圖 ${a.name}`"
                @click="editArtwork(a.id)"
              >
                編輯</button
              ><button
                type="button"
                class="text-button"
                :disabled="catalog.busy"
                :aria-label="`${a.archived ? '恢復' : '封存'}柄圖 ${a.name}`"
                @click="
                  confirmation = {
                    kind: 'artwork',
                    id: a.id,
                    name: a.name,
                    archived: a.archived,
                  }
                "
              >
                {{ a.archived ? "恢復" : "封存" }}
              </button>
            </div>
          </article>
        </div>
      </section>
      <RouterLink class="button secondary" to="/products"
        >前往商品建檔，選擇擁有者與柄圖</RouterLink
      >
    </template></template
  >
</template>
<style scoped>
.panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  overflow-wrap: anywhere;
}
.panel h3 {
  margin: 8px 0 14px;
}
.panel p,
.section-block > p {
  line-height: 1.85;
  color: #52614c;
}
.workspace-picker {
  max-width: 440px;
  margin: 24px 0;
}
.field {
  display: grid;
  gap: 8px;
  margin: 0 0 16px;
}
label,
legend {
  font-weight: 600;
}
input:not([type="checkbox"]),
select,
textarea {
  font: inherit;
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 10px 12px;
  background: #fcfdf9;
  border: 1px solid #a6b79e;
  border-radius: 7px;
  color: var(--text);
}
textarea {
  resize: vertical;
}
fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.author-options {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}
.check-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
.check-option input {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}
.cards {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}
.notes {
  white-space: pre-wrap;
}
.confirmation {
  margin-top: 20px;
  background: #f6f7f3;
}
.empty {
  padding: 16px;
  background: #f6f7f3;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (min-width: 900px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 520px) {
  .panel {
    padding: 17px;
  }
}
</style>
