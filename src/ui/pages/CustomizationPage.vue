<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useCatalogStore } from "../../app/catalog-store";
import { useWorkspaceStore } from "../../app/workspace-store";
import type { CustomField } from "../../domain/models/catalog";

const catalog = useCatalogStore();
const workspaces = useWorkspaceStore();
const notice = ref("");
const localError = ref("");
const tagId = ref<string>();
const tagName = ref("");
const fieldId = ref<string>();
const fieldName = ref("");
const fieldType = ref<CustomField["type"]>("text");
type EditableOption = {
  key: number;
  id?: string;
  label: string;
  archived: boolean;
};
let optionKey = 0;
const options = ref<EditableOption[]>([]);
const types: { value: CustomField["type"]; label: string }[] = [
  { value: "text", label: "文字" },
  { value: "number", label: "數字" },
  { value: "single", label: "單選" },
  { value: "multi", label: "多選" },
  { value: "boolean", label: "是／否" },
  { value: "date", label: "日期" },
];
const selectable = computed(() =>
  ["single", "multi"].includes(fieldType.value),
);
const tags = computed(
  () => catalog.snapshot?.tags.filter((tag) => !tag.archived) ?? [],
);
const fields = computed(
  () => catalog.snapshot?.fields.filter((field) => !field.archived) ?? [],
);
const archivedTags = computed(
  () => catalog.snapshot?.tags.filter((tag) => tag.archived) ?? [],
);
const archivedFields = computed(
  () => catalog.snapshot?.fields.filter((field) => field.archived) ?? [],
);
function cancelTag() {
  tagId.value = undefined;
  tagName.value = "";
}
function cancelField() {
  fieldId.value = undefined;
  fieldName.value = "";
  fieldType.value = "text";
  options.value = [];
}
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    cancelTag();
    cancelField();
    notice.value = "";
    localError.value = "";
    if (id) {
      try {
        await catalog.load(id);
      } catch (error) {
        localError.value =
          error instanceof Error ? error.message : "無法讀取設定，請重試。";
      }
    }
  },
  { immediate: true },
);
async function run(
  action: () => Promise<unknown>,
  message: string,
  after?: () => void,
) {
  if (catalog.busy) return;
  localError.value = "";
  notice.value = "";
  const workspaceId = workspaces.activeWorkspaceId;
  try {
    await action();
    if (workspaceId === workspaces.activeWorkspaceId) {
      after?.();
      notice.value = message;
    }
  } catch (error) {
    if (workspaceId === workspaces.activeWorkspaceId)
      localError.value =
        error instanceof Error ? error.message : "尚未儲存成功，請重試。";
  }
}
function editField(field: CustomField) {
  fieldId.value = field.id;
  fieldName.value = field.name;
  fieldType.value = field.type;
  options.value = field.options.map((option) => ({
    ...option,
    key: optionKey++,
  }));
}
function removeOption(option: EditableOption) {
  if (option.id) option.archived = true;
  else options.value = options.value.filter((item) => item.key !== option.key);
}
function saveField() {
  const input = {
    name: fieldName.value.trim(),
    type: fieldType.value,
    options:
      selectable.value || fieldId.value
        ? options.value.map((option) => ({
            ...(option.id ? { id: option.id } : {}),
            label: option.label.trim(),
            archived: option.archived,
          }))
        : [],
  };
  return run(
    () => catalog.saveField(input, fieldId.value),
    "自訂欄位已儲存。",
    cancelField,
  );
}
</script>

<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">MAKE IT YOURS</div>
      <h1>自訂商品資料</h1>
      <p>直接在網站建立適合你的標記與欄位，依照自己的整理習慣建檔。</p>
    </div>
  </section>
  <aside class="info-banner">
    <div>
      <strong>周邊種類、標記與自訂欄位，各有用途。</strong>
      <p>
        周邊種類可自由輸入，例如徽章或壓克力立牌。標記描述行銷資訊；自訂欄位儲存額外資料，不取代庫存與財務欄位，也不參與計算。標記不會改變價格或訂單行為。
      </p>
    </div>
  </aside>
  <div v-if="!workspaces.activeWorkspaceId" class="section-block">
    <h2>先選擇工作區</h2>
    <p>每個工作區都能有自己的商品設定。</p>
    <RouterLink class="button primary" to="/">前往工作區總覽</RouterLink>
  </div>
  <template v-else>
    <p v-if="localError || catalog.error" class="error-notice" role="alert">
      {{ localError || catalog.error }}
    </p>
    <button
      v-if="!catalog.snapshot && !catalog.busy"
      class="button secondary"
      type="button"
      @click="
        run(
          () => catalog.load(workspaces.activeWorkspaceId!),
          '設定已重新讀取。',
        )
      "
    >
      重新讀取設定
    </button>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="catalog.busy" role="status">正在處理，請稍候…</p>
    <section
      class="section-block"
      aria-labelledby="tags-title"
      :aria-busy="catalog.busy"
    >
      <div class="section-title">
        <div>
          <h2 id="tags-title">商品標記</h2>
          <p>可以新增自己的用語，也能選擇加入建議標記。</p>
        </div>
      </div>
      <p>
        建議：新商品、限定販售、清倉、再販、預購、親簽。僅作資訊描述，不會自動套用規則。
      </p>
      <button
        class="button secondary"
        type="button"
        :disabled="catalog.busy || !catalog.snapshot"
        @click="run(() => catalog.addSuggestedTags(), '建議標記已加入。')"
      >
        添加建議標記
      </button>
      <ul class="definition-list" aria-label="目前的商品標記">
        <li v-for="tag in tags" :key="tag.id">
          <strong>{{ tag.name }}</strong>
          <div class="actions">
            <button
              class="button secondary"
              type="button"
              :disabled="catalog.busy"
              :aria-label="`編輯標記 ${tag.name}`"
              @click="
                tagId = tag.id;
                tagName = tag.name;
              "
            >
              編輯</button
            ><button
              class="button secondary"
              type="button"
              :disabled="catalog.busy"
              :aria-label="`封存標記 ${tag.name}`"
              @click="
                run(
                  () => catalog.archiveTag(tag.id),
                  '標記已封存，歷史資料會保留。',
                  () => {
                    if (tagId === tag.id) cancelTag();
                  },
                )
              "
            >
              封存
            </button>
          </div>
        </li>
      </ul>
      <p v-if="!tags.length && catalog.snapshot">還沒有標記，可從下方新增。</p>
      <form
        class="settings-form"
        @submit.prevent="
          run(
            () => catalog.saveTag(tagName.trim(), tagId),
            '標記已儲存。',
            cancelTag,
          )
        "
      >
        <h3>{{ tagId ? "編輯標記" : "新增標記" }}</h3>
        <label for="tag-name">標記名稱（必填）</label
        ><input
          id="tag-name"
          v-model="tagName"
          required
          :disabled="catalog.busy"
        />
        <div class="actions">
          <button
            class="button primary"
            :disabled="catalog.busy || !catalog.snapshot || !tagName.trim()"
          >
            儲存標記</button
          ><button
            class="button secondary"
            type="button"
            :disabled="catalog.busy"
            @click="cancelTag"
          >
            取消
          </button>
        </div>
      </form>
    </section>
    <section
      class="section-block"
      aria-labelledby="fields-title"
      :aria-busy="catalog.busy"
    >
      <div class="section-title">
        <div>
          <h2 id="fields-title">自訂商品欄位</h2>
          <p>例如作品名稱、材質或發售日期。封存設定會保留歷史資料。</p>
        </div>
      </div>
      <ul class="definition-list" aria-label="目前的自訂欄位">
        <li v-for="field in fields" :key="field.id">
          <div>
            <strong>{{ field.name }}</strong>
            <p>{{ types.find((type) => type.value === field.type)?.label }}</p>
          </div>
          <div class="actions">
            <button
              class="button secondary"
              type="button"
              :disabled="catalog.busy"
              :aria-label="`編輯欄位 ${field.name}`"
              @click="editField(field)"
            >
              編輯</button
            ><button
              class="button secondary"
              type="button"
              :disabled="catalog.busy"
              :aria-label="`封存欄位 ${field.name}`"
              @click="
                run(
                  () => catalog.archiveField(field.id),
                  '欄位已封存，歷史資料會保留。',
                  () => {
                    if (fieldId === field.id) cancelField();
                  },
                )
              "
            >
              封存
            </button>
          </div>
        </li>
      </ul>
      <p v-if="!fields.length && catalog.snapshot">還沒有自訂欄位。</p>
      <form class="settings-form" @submit.prevent="saveField">
        <h3>{{ fieldId ? "編輯欄位" : "新增欄位" }}</h3>
        <label for="field-name">欄位名稱（必填）</label
        ><input
          id="field-name"
          v-model="fieldName"
          required
          :disabled="catalog.busy"
        />
        <label for="field-type">資料類型</label
        ><select
          id="field-type"
          v-model="fieldType"
          :disabled="catalog.busy || !!fieldId"
          aria-describedby="field-type-help"
        >
          <option v-for="type in types" :key="type.value" :value="type.value">
            {{ type.label }}
          </option>
        </select>
        <p id="field-type-help">
          建立後可修改名稱；如需不同類型，請新增欄位，以保留既有資料。
        </p>
        <fieldset v-if="selectable" :disabled="catalog.busy">
          <legend>可選項目</legend>
          <p>封存選項會保留原有資料，可在儲存前恢復。</p>
          <div
            v-for="(option, index) in options"
            :key="option.key"
            class="option-row"
          >
            <label :for="`option-${option.key}`"
              >選項 {{ index + 1
              }}{{ option.archived ? "（已封存）" : "（必填）" }}</label
            >
            <input
              :id="`option-${option.key}`"
              v-model="option.label"
              :disabled="option.archived"
              :required="!option.archived"
            />
            <button
              v-if="option.archived"
              class="button secondary"
              type="button"
              :aria-label="`恢復選項 ${option.label}`"
              @click="option.archived = false"
            >
              恢復
            </button>
            <button
              v-else
              class="button secondary"
              type="button"
              :aria-label="`${option.id ? '封存' : '移除'}選項 ${index + 1}`"
              @click="removeOption(option)"
            >
              {{ option.id ? "封存選項" : "移除此列" }}
            </button>
          </div>
          <button
            class="button secondary"
            type="button"
            @click="
              options.push({ key: optionKey++, label: '', archived: false })
            "
          >
            新增選項
          </button>
        </fieldset>
        <div class="actions">
          <button
            class="button primary"
            :disabled="catalog.busy || !catalog.snapshot || !fieldName.trim()"
          >
            儲存欄位</button
          ><button
            class="button secondary"
            type="button"
            :disabled="catalog.busy"
            @click="cancelField"
          >
            取消
          </button>
        </div>
      </form>
    </section>
    <details class="section-block archived-settings">
      <summary>
        已封存的標記與欄位（{{ archivedTags.length + archivedFields.length }}）
      </summary>
      <p>封存保留歷史資料；恢復後可再次用於商品建檔。</p>
      <h3>已封存的標記</h3>
      <p v-if="!archivedTags.length">沒有已封存的標記。</p>
      <ul class="definition-list">
        <li v-for="tag in archivedTags" :key="tag.id">
          <strong>{{ tag.name }}</strong
          ><button
            class="button secondary"
            type="button"
            :disabled="catalog.busy"
            :aria-label="`恢復標記 ${tag.name}`"
            @click="run(() => catalog.archiveTag(tag.id), '標記已恢復。')"
          >
            恢復標記
          </button>
        </li>
      </ul>
      <h3>已封存的欄位</h3>
      <p v-if="!archivedFields.length">沒有已封存的欄位。</p>
      <ul class="definition-list">
        <li v-for="field in archivedFields" :key="field.id">
          <strong>{{ field.name }}</strong
          ><button
            class="button secondary"
            type="button"
            :disabled="catalog.busy"
            :aria-label="`恢復欄位 ${field.name}`"
            @click="run(() => catalog.archiveField(field.id), '欄位已恢復。')"
          >
            恢復欄位
          </button>
        </li>
      </ul>
    </details>
  </template>
</template>

<style scoped>
.archived-settings summary {
  cursor: pointer;
  min-height: 44px;
  padding: 12px 0;
  font-weight: 600;
}
.archived-settings h3 {
  margin-top: 18px;
}
.settings-form {
  display: grid;
  gap: 12px;
  max-width: 650px;
  margin-top: 24px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: white;
}
.settings-form input,
.settings-form select {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #94a58b;
  border-radius: 6px;
  background: #fff;
  color: var(--text);
  font: inherit;
}
.settings-form label,
legend {
  font-weight: 600;
}
.settings-form p,
.section-block > p,
.definition-list p {
  line-height: 1.8;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.definition-list {
  padding: 0;
  list-style: none;
  margin-top: 20px;
}
.definition-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}
.definition-list strong {
  overflow-wrap: anywhere;
  min-width: 0;
}
fieldset {
  min-width: 0;
  border: 1px solid var(--line);
  padding: 16px;
  border-radius: 6px;
}
.option-row {
  display: grid;
  gap: 8px;
  margin-bottom: 18px;
}
.option-row .button {
  justify-self: start;
}
.button {
  min-height: 44px;
}
@media (max-width: 520px) {
  .settings-form {
    padding: 16px;
  }
  .definition-list li {
    align-items: flex-start;
  }
}
</style>
