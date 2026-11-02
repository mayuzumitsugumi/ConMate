<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import { useWorkspaceStore } from "../../app/workspace-store";
import { stockEffectLabels } from "../../domain/inventory/operations";
import type {
  InventoryMovementType,
  StockEffect,
} from "../../domain/models/catalog";
const catalog = useCatalogStore(),
  workspaces = useWorkspaceStore();
const form = reactive({ name: "", effect: "increase" as StockEffect });
const id = ref<string>(),
  notice = ref(""),
  error = ref("");
function reset() {
  id.value = undefined;
  form.name = "";
  form.effect = "increase";
}
watch(
  () => workspaces.activeWorkspaceId,
  () => {
    reset();
    notice.value = "";
    error.value = "";
  },
);
function edit(t: InventoryMovementType) {
  id.value = t.id;
  form.name = t.name;
  form.effect = t.effect;
}
async function save() {
  error.value = "";
  notice.value = "";
  try {
    await catalog.saveMovementType(form.name, form.effect, id.value);
    reset();
    notice.value = "異動類型已儲存，可在下方登記時選用。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "儲存失敗。";
  }
}
async function archive(typeId: string) {
  error.value = "";
  notice.value = "";
  try {
    await catalog.archiveMovementType(typeId);
    if (id.value === typeId) reset();
    notice.value = "類型狀態已更新，既有異動紀錄不受影響。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "儲存失敗。";
  }
}
</script>
<template>
  <section
    class="type-panel section-block"
    aria-labelledby="movement-types-title"
  >
    <h2 id="movement-types-title">自訂異動類型</h2>
    <p>
      用你熟悉的名稱，例如「廠商到貨」、「送給朋友」、「帶去場次」。只要選擇它會增加、減少或移動庫存。
    </p>
    <p>
      類型不會計算營收。庫存變化方式建立後不能修改；改名不會改動歷史紀錄上的名稱。
    </p>
    <p v-if="notice" role="status" class="success-notice">{{ notice }}</p>
    <p v-if="error" role="alert" class="error-notice">{{ error }}</p>
    <form @submit.prevent="save">
      <fieldset :disabled="catalog.busy">
        <label for="movement-type-name">類型名稱</label>
        <input
          id="movement-type-name"
          v-model="form.name"
          required
          maxlength="80"
          placeholder="例如：送給朋友"
        />
        <label for="movement-type-effect">庫存變化方式</label>
        <select
          id="movement-type-effect"
          v-model="form.effect"
          :disabled="!!id"
        >
          <option
            v-for="(label, effect) in stockEffectLabels"
            :key="effect"
            :value="effect"
          >
            {{ label }}
          </option>
        </select>
        <div class="dialog-actions">
          <button
            v-if="id"
            class="button secondary"
            type="button"
            @click="reset"
          >
            取消編輯類型
          </button>
          <button class="button secondary" :disabled="!form.name.trim()">
            {{ id ? "儲存類型名稱" : "建立異動類型" }}
          </button>
        </div>
      </fieldset>
    </form>
    <ul v-if="catalog.snapshot?.movementTypes.length">
      <li v-for="t in catalog.snapshot.movementTypes" :key="t.id">
        <span
          >{{ t.name }} · {{ stockEffectLabels[t.effect]
          }}{{ t.archived ? "（已封存）" : "" }}</span
        >
        <button
          type="button"
          class="text-button"
          :disabled="catalog.busy"
          :aria-label="`編輯類型 ${t.name}`"
          @click="edit(t)"
        >
          編輯名稱
        </button>
        <button
          type="button"
          class="text-button"
          :disabled="catalog.busy"
          :aria-label="`${t.archived ? '恢復' : '封存'}類型 ${t.name}`"
          @click="archive(t.id)"
        >
          {{ t.archived ? "恢復" : "封存" }}
        </button>
      </li>
    </ul>
    <p v-else>
      還沒建立類型也可以直接使用下方的「增加庫存、減少庫存、移動庫存」。
    </p>
  </section>
</template>
<style scoped>
.type-panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
}
p {
  line-height: 1.8;
}
fieldset {
  border: 0;
  padding: 0;
  display: grid;
  gap: 12px;
  min-width: 0;
}
input,
select {
  font: inherit;
  min-height: 46px;
  padding: 10px 12px;
  border: 1px solid #94a58b;
  border-radius: 6px;
  width: 100%;
  background: #fcfdf9;
  color: var(--text);
}
ul {
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  border-top: 1px solid var(--line);
  padding: 12px 0;
  overflow-wrap: anywhere;
}
button {
  min-height: 44px;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
</style>
