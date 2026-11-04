<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import { batchBalances } from "../../domain/inventory/batches";
import { unitStates } from "../../domain/inventory/units";
const catalog = useCatalogStore();
const form = reactive({
  productId: "",
  locationId: "",
  batchId: "",
  labels: "",
});
const notice = ref(""),
  error = ref("");
const units = computed(() =>
  catalog.snapshot ? unitStates(catalog.snapshot) : [],
);
const lots = computed(() => {
  const s = catalog.snapshot;
  if (!s || !form.productId || !form.locationId) return [];
  const batches = batchBalances(s);
  return [...batches.lots.values()]
    .filter(
      (l) =>
        !!l.sourceMovementId &&
        l.productId === form.productId &&
        batches.quantity(l.id, form.locationId) > 0,
    )
    .map((l) => ({
      id: l.id,
      name: l.name,
      quantity: batches.quantity(l.id, form.locationId),
      registered: units.value.filter(
        (u) =>
          u.batchId === l.id &&
          u.locationId === form.locationId &&
          u.state === "available",
      ).length,
    }));
});
const stateLabel = {
  available: "可用",
  sold: "已售出",
  free: "已發放",
  damage: "瑕疵／損耗",
  removed: "已移出",
};
watch(
  () => [form.productId, form.locationId],
  () => {
    form.batchId = "";
  },
);
watch(
  () => catalog.snapshot?.workspaceId,
  () => {
    Object.assign(form, {
      productId: "",
      locationId: "",
      batchId: "",
      labels: "",
    });
    notice.value = "";
    error.value = "";
  },
);
async function register() {
  if (catalog.busy) return;
  notice.value = "";
  error.value = "";
  try {
    await catalog.registerUnits({
      productId: form.productId,
      locationId: form.locationId,
      batchId: form.batchId,
      labels: form.labels
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
    form.labels = "";
    notice.value = "特殊單件已登記，現存總數量不變。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "單件登記失敗，原資料保留。";
  }
}
</script>
<template>
  <section
    v-if="catalog.snapshot"
    class="units-panel section-block"
    aria-labelledby="physical-units-title"
  >
    <h2 id="physical-units-title">特殊單件追蹤</h2>
    <p>
      親簽、編號品等實物可以逐件登記。請先確認商品已入庫，再選現存批次填寫實物標記；這不會追加庫存，也不會推定以前售出的實物身分。
    </p>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error-notice" role="alert">{{ error }}</p>
    <form @submit.prevent="register">
      <fieldset :disabled="catalog.busy" class="units-fields">
        <div class="field">
          <label for="unit-product">單件商品</label
          ><select id="unit-product" v-model="form.productId" required>
            <option value="">請選擇商品</option>
            <option
              v-for="p in catalog.snapshot.products.filter((p) => !p.archived)"
              :key="p.id"
              :value="p.id"
            >
              {{ p.name }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="unit-location">實物所在庫位</label
          ><select id="unit-location" v-model="form.locationId" required>
            <option value="">請選擇庫位</option>
            <option
              v-for="l in catalog.snapshot.locations"
              :key="l.id"
              :value="l.id"
            >
              {{ l.name }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="unit-batch">單件來源批次</label
          ><select id="unit-batch" v-model="form.batchId" required>
            <option value="">請選擇現存批次</option>
            <option v-for="l in lots" :key="l.id" :value="l.id">
              {{ l.name }} · 現存 {{ l.quantity }}／已登記 {{ l.registered }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="unit-labels">實物標記（一行一件）</label
          ><textarea
            id="unit-labels"
            v-model="form.labels"
            rows="4"
            required
            placeholder="例如：親簽 A01&#10;親簽 A02"
          /><small>請使用能在實物上辨認的不同標記。正式 ID 由系統產生。</small>
        </div>
        <button
          class="button primary"
          :disabled="!form.batchId || !form.labels.trim()"
        >
          登記特殊單件
        </button>
      </fieldset>
    </form>
    <div class="unit-list">
      <article v-for="u in units" :key="u.unitId">
        <strong>{{ u.label }}</strong>
        <p>
          {{
            catalog.snapshot.products.find((p) => p.id === u.productId)?.name
          }}
          · {{ stateLabel[u.state] }} ·
          {{
            catalog.snapshot.locations.find((l) => l.id === u.locationId)
              ?.name || "不在可售庫位"
          }}
        </p>
      </article>
      <p v-if="!units.length">尚未登記特殊單件；一般商品繼續使用數量管理。</p>
    </div>
  </section>
</template>
<style scoped>
.units-panel {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: white;
  padding: 20px;
}
.units-panel p,
small {
  line-height: 1.9;
}
.units-fields {
  border: 0;
  padding: 0;
  display: grid;
  gap: 14px;
  min-width: 0;
}
.field {
  display: grid;
  gap: 8px;
  min-width: 0;
}
select,
textarea {
  width: 100%;
  min-width: 0;
  min-height: 46px;
  font: inherit;
  padding: 10px;
  border: 1px solid #acbda8;
  border-radius: 7px;
}
.unit-list {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}
.unit-list article {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  overflow-wrap: anywhere;
}
button {
  justify-self: start;
}
</style>
