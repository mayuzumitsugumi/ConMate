<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import type { SalePlan } from "../../domain/models/catalog";
const catalog = useCatalogStore();
const editing = ref<string>();
const notice = ref("");
const error = ref("");
const showArchived = ref(false);
const form = reactive({
  name: "",
  mode: "direct" as "direct" | "draw",
  unitPrice: null as number | null,
  productIds: [] as string[],
  eventIds: [] as string[],
});
const plans = computed(
  () =>
    catalog.snapshot?.salePlans.filter(
      (p) => showArchived.value || !p.archived,
    ) || [],
);
function reset() {
  editing.value = undefined;
  Object.assign(form, {
    name: "",
    mode: "direct",
    unitPrice: null,
    productIds: [],
    eventIds: [],
  });
}
function edit(p: SalePlan) {
  editing.value = p.id;
  Object.assign(form, {
    name: p.name,
    mode: p.mode,
    unitPrice: p.unitPrice,
    productIds: [...p.productIds],
    eventIds: [...p.eventIds],
  });
}
async function save() {
  error.value = "";
  notice.value = "";
  try {
    await catalog.saveSalePlan(
      { ...form, unitPrice: form.unitPrice! },
      editing.value,
    );
    reset();
    notice.value = "販售方案已儲存。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法儲存。";
  }
}
async function archive(p: SalePlan) {
  error.value = "";
  notice.value = "";
  try {
    await catalog.archiveSalePlan(p.id);
    if (editing.value === p.id) reset();
    notice.value = p.archived ? "方案已恢復。" : "方案已封存。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法儲存。";
  }
}
</script>
<template>
  <section
    v-if="catalog.snapshot"
    class="business-panel section-block"
    aria-labelledby="plans-title"
  >
    <h2 id="plans-title">販售方案與抽選池</h2>
    <p>
      先設定售價及可交付商品。抽選池可混合創作者與周邊種類，現場選擇實際抽出的款式；所有方案共用實物庫存，不會另外增加或保留數量。
    </p>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error-notice" role="alert">{{ error }}</p>
    <details :open="Boolean(editing)">
      <summary>{{ editing ? "編輯販售方案" : "建立販售方案／抽選池" }}</summary>
      <form @submit.prevent="save">
        <fieldset :disabled="catalog.busy">
          <div class="form-grid">
            <div class="field">
              <label for="plan-name">方案名稱（必填）</label
              ><input
                id="plan-name"
                v-model="form.name"
                required
                maxlength="80"
                placeholder="例如：徽章＋吊飾混合抽選"
              />
            </div>
            <div class="field">
              <label for="plan-mode">販售方式</label
              ><select id="plan-mode" v-model="form.mode">
                <option value="direct">指定購買</option>
                <option value="draw">抽選池（記錄實際抽出商品）</option>
              </select>
            </div>
            <div class="field">
              <label for="plan-price">每件／每抽售價（整元）</label
              ><input
                id="plan-price"
                v-model.number="form.unitPrice"
                required
                type="number"
                min="0"
                step="1"
              />
            </div>
          </div>
          <fieldset>
            <legend>可交付商品（至少一項）</legend>
            <p>一個方案內每件商品採同一售價；不同價格可建立不同方案。</p>
            <label
              v-for="p in catalog.snapshot.products.filter(
                (p) => !p.archived || form.productIds.includes(p.id),
              )"
              :key="p.id"
              class="check-option"
              ><input
                type="checkbox"
                v-model="form.productIds"
                :value="p.id"
              />{{ p.name }} · {{ p.code
              }}{{ p.archived ? "（已封存）" : "" }}</label
            >
            <p v-if="!catalog.snapshot.products.length">請先建立商品。</p>
          </fieldset>
          <fieldset>
            <legend>適用場次（不勾選表示不限場次）</legend>
            <label
              v-for="e in catalog.snapshot.events.filter(
                (e) => !e.archived || form.eventIds.includes(e.id),
              )"
              :key="e.id"
              class="check-option"
              ><input type="checkbox" v-model="form.eventIds" :value="e.id" />{{
                e.name
              }}{{ e.archived ? "（已封存）" : "" }}</label
            >
          </fieldset>
        </fieldset>
        <div class="actions">
          <button
            class="button primary"
            :disabled="
              catalog.busy ||
              !form.name.trim() ||
              form.unitPrice === null ||
              !form.productIds.length
            "
          >
            儲存販售方案</button
          ><button
            type="button"
            class="button secondary"
            :disabled="catalog.busy"
            @click="reset"
          >
            {{ editing ? "取消編輯" : "清空表單" }}
          </button>
        </div>
      </form>
    </details>
    <label class="check-option"
      ><input type="checkbox" v-model="showArchived" />顯示已封存方案</label
    >
    <article v-for="p in plans" :key="p.id" class="plan-card">
      <h3>
        {{ p.name }} <span v-if="p.archived" class="soft-label">已封存</span>
      </h3>
      <p>
        {{ p.mode === "draw" ? "抽選池" : "指定購買" }} · 每件／抽
        {{ p.unitPrice }} 元 · {{ p.productIds.length }} 款 · 版本
        {{ p.version }}
      </p>
      <p>
        適用：{{
          p.eventIds.length
            ? p.eventIds
                .map(
                  (id) =>
                    catalog.snapshot!.events.find((e) => e.id === id)?.name ||
                    "未知場次",
                )
                .join("、")
            : "不限場次"
        }}
      </p>
      <div class="actions">
        <button
          type="button"
          class="button secondary"
          :disabled="catalog.busy"
          @click="edit(p)"
        >
          編輯 {{ p.name }}</button
        ><button
          type="button"
          class="text-button"
          :disabled="catalog.busy"
          @click="archive(p)"
        >
          {{ p.archived ? "恢復" : "封存" }} {{ p.name }}
        </button>
      </div>
    </article>
    <p v-if="!plans.length">尚無販售方案，可先建立，或繼續使用手動售價。</p>
  </section>
</template>
<style scoped src="../pages/business.css"></style>
<style scoped>
.plan-card {
  border-top: 1px solid var(--line);
  padding: 16px 0;
}
summary {
  cursor: pointer;
  padding: 12px 0;
  font-weight: 600;
}
form {
  margin: 12px 0;
}
fieldset {
  margin: 10px 0;
}
.check-option {
  min-height: 44px;
}
</style>
