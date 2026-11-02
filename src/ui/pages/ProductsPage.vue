<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
import type { CatalogItem, ProductInput } from "../../domain/models/catalog";
import CustomFieldInput from "../components/CustomFieldInput.vue";
const workspaces = useWorkspaceStore();
const catalog = useCatalogStore();
const editingId = ref<string>();
const archiveId = ref<string>();
const showArchived = ref(false);
const notice = ref("");
const localError = ref("");
const nameInput = ref<HTMLInputElement>();
const form = reactive<ProductInput>({
  name: "",
  creatorId: "",
  creatorName: "",
  projectId: "",
  projectName: "",
  productType: "",
  specification: "",
  artwork: "",
  notes: "",
  tagIds: [],
  customValues: {},
});
const products = computed(
  () =>
    catalog.snapshot?.products.filter(
      (item) => showArchived.value || !item.archived,
    ) ?? [],
);
function reset() {
  editingId.value = undefined;
  Object.assign(form, {
    name: "",
    creatorId: "",
    creatorName: "",
    projectId: "",
    projectName: "",
    productType: "",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  localError.value = "";
}
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    reset();
    archiveId.value = undefined;
    notice.value = "";
    if (id) await catalog.load(id);
  },
  { immediate: true },
);
async function edit(item: CatalogItem) {
  reset();
  editingId.value = item.id;
  Object.assign(form, {
    name: item.name,
    creatorId: item.creatorId,
    projectId: item.projectId,
    productType:
      catalog.snapshot?.productTypes.find((type) => type.id === item.typeId)
        ?.name ?? "",
    specification: item.specification,
    artwork: item.artwork,
    notes: item.notes,
    tagIds: [...item.tagIds],
    customValues: JSON.parse(JSON.stringify(item.customValues)),
  });
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.scrollIntoView({ block: "center" });
}
async function save() {
  if (catalog.busy || !catalog.snapshot) return;
  localError.value = "";
  notice.value = "";
  try {
    await catalog.saveProduct(
      {
        ...form,
        name: form.name.trim(),
        creatorName: form.creatorId ? undefined : form.creatorName?.trim(),
        projectName: form.projectId ? undefined : form.projectName?.trim(),
        productType: form.productType.trim(),
        tagIds: [...form.tagIds],
        customValues: JSON.parse(JSON.stringify(form.customValues)),
      },
      editingId.value,
    );
    if (!catalog.error) {
      notice.value = editingId.value ? "商品已更新。" : "商品已建立。";
      reset();
    }
  } catch (error) {
    localError.value =
      error instanceof Error ? error.message : "儲存失敗，請重試。";
  }
}
async function archive() {
  if (!archiveId.value || catalog.busy) return;
  try {
    const id = archiveId.value;
    const restoring = catalog.snapshot?.products.find(
      (item) => item.id === id,
    )?.archived;
    localError.value = "";
    await catalog.archiveProduct(id);
    if (!catalog.error) {
      archiveId.value = undefined;
      if (editingId.value === id) reset();
      notice.value = restoring ? "商品已恢復。" : "商品已封存。";
    }
  } catch (error) {
    localError.value =
      error instanceof Error ? error.message : "封存失敗，請重試。";
  }
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">YOUR CREATIVE CATALOG</div>
      <h1>商品建檔</h1>
      <p>直接在網站整理商品，先留下每份創作的基本資料。</p>
    </div>
  </section>
  <section v-if="!workspaces.activeWorkspaceId" class="info-banner">
    <div>
      <h2>先建立工作區</h2>
      <p>商品會保存在所選工作區中。</p>
      <RouterLink class="button primary" to="/">前往工作區總覽</RouterLink>
    </div>
  </section>
  <template v-else>
    <div class="field workspace-picker">
      <label for="product-workspace">目前工作區</label
      ><select
        id="product-workspace"
        :value="workspaces.activeWorkspaceId"
        :disabled="catalog.busy"
        @change="workspaces.select(($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="workspace in workspaces.workspaces"
          :key="workspace.id"
          :value="workspace.id"
        >
          {{ workspace.name }}
        </option>
      </select>
    </div>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="catalog.error || localError" class="error-notice" role="alert">
      {{ localError || catalog.error
      }}<button
        type="button"
        class="text-button"
        :disabled="catalog.busy"
        @click="catalog.load(workspaces.activeWorkspaceId)"
      >
        重新讀取
      </button>
    </p>
    <p v-if="catalog.busy && !catalog.snapshot" role="status">正在讀取商品…</p>
    <template v-if="catalog.snapshot">
      <section
        class="catalog-panel section-block"
        aria-labelledby="product-form-title"
      >
        <div class="section-title">
          <div>
            <h2 id="product-form-title">
              {{ editingId ? "編輯商品" : "新增商品" }}
            </h2>
            <p>商品名稱為必填，其他資料可稍後補上。周邊種類可自由輸入。</p>
          </div>
        </div>
        <form @submit.prevent="save">
          <fieldset class="form-fields" :disabled="catalog.busy">
            <div class="field">
              <label for="product-name">商品名稱（必填）</label
              ><input
                id="product-name"
                ref="nameInput"
                v-model="form.name"
                required
                maxlength="80"
                placeholder="例如：星空壓克力吊飾"
              />
            </div>
            <div class="form-grid">
              <div class="field">
                <label
                  v-if="catalog.snapshot.parties.length"
                  for="product-creator"
                  >創作者</label
                ><select
                  v-if="catalog.snapshot.parties.length"
                  id="product-creator"
                  v-model="form.creatorId"
                >
                  <option value="">輸入新創作者／未指定</option>
                  <option
                    v-for="party in catalog.snapshot.parties"
                    :key="party.id"
                    :value="party.id"
                  >
                    {{ party.name }}
                  </option></select
                ><label v-if="!form.creatorId" for="creator-name"
                  >新創作者名稱</label
                ><input
                  v-if="!form.creatorId"
                  id="creator-name"
                  v-model="form.creatorName"
                  maxlength="80"
                  placeholder="可留白"
                />
              </div>
              <div class="field">
                <label
                  v-if="catalog.snapshot.projects.length"
                  for="product-project"
                  >企劃</label
                ><select
                  v-if="catalog.snapshot.projects.length"
                  id="product-project"
                  v-model="form.projectId"
                >
                  <option value="">輸入新企劃／未指定</option>
                  <option
                    v-for="project in catalog.snapshot.projects"
                    :key="project.id"
                    :value="project.id"
                  >
                    {{ project.name }}
                  </option></select
                ><label v-if="!form.projectId" for="project-name"
                  >新企劃名稱</label
                ><input
                  v-if="!form.projectId"
                  id="project-name"
                  v-model="form.projectName"
                  maxlength="80"
                  placeholder="可留白"
                />
              </div>
              <div class="field">
                <label for="product-type">周邊種類</label
                ><input
                  id="product-type"
                  v-model="form.productType"
                  maxlength="80"
                  placeholder="自由輸入，例如：吊飾、徽章"
                />
              </div>
              <div class="field">
                <label for="product-specification">規格</label
                ><input
                  id="product-specification"
                  v-model="form.specification"
                  placeholder="例如：透明壓克力・6 公分"
                />
              </div>
              <div class="field">
                <label for="product-artwork">款式／圖樣</label
                ><input id="product-artwork" v-model="form.artwork" />
              </div>
            </div>
            <div class="field">
              <label for="product-notes">備註</label
              ><textarea
                id="product-notes"
                v-model="form.notes"
                rows="3"
              ></textarea>
            </div>
            <fieldset v-if="catalog.snapshot.tags.some((tag) => !tag.archived)">
              <legend>標籤</legend>
              <div class="tag-options">
                <label
                  v-for="tag in catalog.snapshot.tags.filter(
                    (tag) => !tag.archived,
                  )"
                  :key="tag.id"
                  class="check-option"
                  ><input
                    v-model="form.tagIds"
                    type="checkbox"
                    :value="tag.id"
                  />{{ tag.name }}</label
                >
              </div>
            </fieldset>
            <div
              v-if="catalog.snapshot.fields.some((field) => !field.archived)"
              class="custom-fields"
            >
              <h3>自訂欄位</h3>
              <CustomFieldInput
                v-for="field in catalog.snapshot.fields.filter(
                  (field) => !field.archived,
                )"
                :key="field.id"
                v-model="form.customValues[field.id]"
                :field="field"
                :disabled="catalog.busy"
              />
            </div>
          </fieldset>
          <div class="dialog-actions">
            <button
              v-if="editingId"
              class="button secondary"
              type="button"
              :disabled="catalog.busy"
              @click="reset"
            >
              取消編輯</button
            ><button
              class="button primary"
              :disabled="catalog.busy || !form.name.trim()"
            >
              {{
                catalog.busy ? "儲存中…" : editingId ? "儲存變更" : "建立商品"
              }}
            </button>
          </div>
        </form>
      </section>
      <section class="section-block" aria-labelledby="product-list-title">
        <div class="section-title">
          <div>
            <h2 id="product-list-title">商品清單（{{ products.length }}）</h2>
            <p>編輯基本資料，或將不再使用的商品封存。</p>
          </div>
        </div>
        <label class="check-option"
          ><input v-model="showArchived" type="checkbox" />顯示封存商品</label
        >
        <p v-if="!products.length" class="info-banner">
          目前沒有符合條件的商品，可從上方表單建立商品。
        </p>
        <div class="product-list">
          <article
            v-for="item in products"
            :key="item.id"
            class="catalog-panel product-card"
          >
            <div>
              <span class="soft-label">{{ item.code }}</span>
              <h3>
                {{ item.name
                }}<span v-if="item.archived" class="soft-label">已封存</span>
              </h3>
              <p>
                {{
                  catalog.snapshot.productTypes.find(
                    (type) => type.id === item.typeId,
                  )?.name || "未指定種類"
                }}<span v-if="item.specification">
                  · {{ item.specification }}</span
                >
              </p>
            </div>
            <div v-if="item.tagIds.length" class="tag-options">
              <span v-for="tagId in item.tagIds" :key="tagId" class="soft-label"
                >{{ catalog.snapshot.tags.find((tag) => tag.id === tagId)?.name
                }}{{
                  catalog.snapshot.tags.find((tag) => tag.id === tagId)
                    ?.archived
                    ? "（已封存）"
                    : ""
                }}</span
              >
            </div>
            <div class="product-actions">
              <button
                type="button"
                class="button secondary"
                :disabled="catalog.busy"
                :aria-label="`編輯 ${item.name}`"
                @click="edit(item)"
              >
                編輯</button
              ><button
                type="button"
                class="text-button"
                :disabled="catalog.busy"
                :aria-label="`${item.archived ? '恢復' : '封存'} ${item.name}`"
                @click="archiveId = item.id"
              >
                {{ item.archived ? "恢復" : "封存" }}
              </button>
            </div>
            <section
              v-if="archiveId === item.id"
              class="archive-panel"
              :aria-labelledby="`archive-${item.id}`"
            >
              <h4 :id="`archive-${item.id}`">
                {{ item.archived ? "恢復" : "封存" }}「{{ item.name }}」？
              </h4>
              <p>
                {{
                  item.archived
                    ? "恢復後會重新顯示在商品清單。"
                    : "封存後會從商品清單隱藏，既有資料仍保留。"
                }}
              </p>
              <div v-if="item.tagIds.length" class="tag-options">
                <span
                  v-for="tagId in item.tagIds"
                  :key="tagId"
                  class="soft-label"
                  >{{
                    catalog.snapshot.tags.find((tag) => tag.id === tagId)?.name
                  }}{{
                    catalog.snapshot.tags.find((tag) => tag.id === tagId)
                      ?.archived
                      ? "（已封存）"
                      : ""
                  }}</span
                >
              </div>
              <div class="product-actions">
                <button
                  type="button"
                  class="button secondary"
                  :disabled="catalog.busy"
                  @click="archiveId = undefined"
                >
                  取消</button
                ><button
                  type="button"
                  class="button primary"
                  :disabled="catalog.busy"
                  @click="archive"
                >
                  {{ item.archived ? "確認恢復" : "確認封存" }}
                </button>
              </div>
            </section>
          </article>
        </div>
      </section>
    </template>
  </template>
</template>
<style scoped>
.catalog-panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
}
.workspace-picker {
  max-width: 440px;
}
.field {
  display: grid;
  gap: 8px;
}
label,
legend {
  font-size: 14px;
  font-weight: 500;
}
input:not([type="checkbox"]),
select,
textarea {
  width: 100%;
  min-width: 0;
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
  border: 1px solid #dce4d6;
  border-radius: 8px;
  padding: 12px;
}
.form-fields {
  border: 0;
  padding: 0;
  display: grid;
  gap: 20px;
}
.form-grid {
  display: grid;
  gap: 20px;
}
.custom-fields {
  display: grid;
  gap: 16px;
}
.custom-fields h3 {
  font-size: 16px;
}
.tag-options,
.product-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.check-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
input[type="checkbox"] {
  width: 20px;
  height: 20px;
}
.product-list {
  display: grid;
  gap: 12px;
}
.product-card {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  overflow-wrap: anywhere;
}
.product-card h3 {
  font-size: 17px;
  margin: 10px 0;
}
.product-card p {
  font-size: 14px;
  line-height: 1.8;
  color: #58674f;
}
.archive-panel {
  width: 100%;
  background: #f6f7f3;
  border: 1px solid #cad7bf;
  padding: 16px;
  border-radius: 8px;
}
.archive-panel h4 {
  margin: 0 0 8px;
}
.archive-panel .product-actions {
  margin-top: 14px;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (min-width: 700px) {
  .form-grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 520px) {
  .catalog-panel {
    padding: 17px;
  }
  .dialog-actions {
    flex-wrap: wrap;
  }
}
</style>
