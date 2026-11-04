<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import type { CatalogSnapshot } from "../../domain/models/catalog";
const props = defineProps<{
  snapshot?: CatalogSnapshot;
  busy?: boolean;
  readonly?: boolean;
  onReserve?: (input: {
    planId: string;
    productId: string;
    locationId: string;
    quantity: number;
    reason: string;
  }) => Promise<unknown>;
  onRelease?: (id: string, reason: string) => Promise<unknown>;
}>();
import {
  availableQuantity,
  reservationRemaining,
} from "../../domain/inventory/reservations";
const catalog = useCatalogStore();
const snapshot = computed(() => props.snapshot || catalog.snapshot);
const pending = ref(false);
const isBusy = computed(
  () => pending.value || props.busy || (!props.snapshot && catalog.busy),
);
const form = reactive({
  planId: "",
  productId: "",
  locationId: "",
  quantity: null as number | null,
  reason: "",
});
const error = ref(""),
  notice = ref(""),
  showReleased = ref(false),
  releaseId = ref(""),
  releaseReason = ref("");
const plan = computed(() =>
  snapshot.value?.salePlans.find((p) => p.id === form.planId),
);
const products = computed(
  () =>
    snapshot.value?.products.filter(
      (p) => !p.archived && plan.value?.productIds.includes(p.id),
    ) || [],
);
const locations = computed(
  () =>
    snapshot.value?.locations.filter(
      (l) =>
        !snapshot.value!.activityHandoffs.some(
          (h) =>
            h.locationId === l.id &&
            !snapshot.value!.activityMerges.some((m) => m.handoffId === h.id),
        ),
    ) || [],
);
const rows = computed(
  () =>
    snapshot.value?.inventoryReservations.filter(
      (r) => showReleased.value || !r.releasedAt,
    ) || [],
);
const shared = computed(() =>
  snapshot.value && form.productId && form.locationId
    ? availableQuantity(snapshot.value, form.productId, form.locationId)
    : null,
);
watch(
  () => form.planId,
  () => {
    form.productId = "";
  },
);
watch(
  () => snapshot.value?.workspaceId,
  () => {
    Object.assign(form, {
      planId: "",
      productId: "",
      locationId: "",
      quantity: null,
      reason: "",
    });
    error.value = "";
    notice.value = "";
    releaseId.value = "";
    releaseReason.value = "";
  },
);
function name(kind: "salePlans" | "products" | "locations", id: string) {
  return snapshot.value?.[kind].find((r) => r.id === id)?.name || "未指定";
}
function remaining(row: (typeof rows.value)[number]) {
  return snapshot.value ? reservationRemaining(snapshot.value, row) : 0;
}
async function save() {
  error.value = "";
  notice.value = "";
  if (isBusy.value || props.readonly) return;
  pending.value = true;
  try {
    await (props.onReserve || catalog.reserveInventory)({
      ...form,
      quantity: form.quantity!,
    });
    form.quantity = null;
    form.reason = "";
    notice.value = "專用庫存已預留；實物總量未改變。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法預留，請重新核對。";
  } finally {
    pending.value = false;
  }
}
async function release() {
  error.value = "";
  notice.value = "";
  if (isBusy.value || props.readonly) return;
  pending.value = true;
  try {
    await (props.onRelease || catalog.releaseInventoryReservation)(
      releaseId.value,
      releaseReason.value,
    );
    releaseId.value = "";
    releaseReason.value = "";
    notice.value = "預留已釋放；未售數量回到共用可用庫存，歷史仍保留。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法釋放，請重新核對。";
  } finally {
    pending.value = false;
  }
}
</script>
<template>
  <section
    v-if="snapshot"
    class="business-panel section-block reservation-panel"
    aria-labelledby="reservation-title"
  >
    <h2 id="reservation-title">方案專用庫存</h2>
    <p>
      一般方案預設共用庫存。只有需要替某方案／抽選池保留數量時才在這裡預留，實物仍留在原庫位，不會多出一份庫存。
    </p>
    <p>
      專用方案只可售出自己的預留數量；其他售法、無料、損耗與調撥只能使用未預留部分。若要改用共用庫存或封存方案，請先明確釋放預留。退款回到仍有效的原預留；已釋放的預留不會自動恢復。
    </p>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error-notice" role="alert">{{ error }}</p>
    <p v-if="readonly" class="info-banner">活動已結案，預留紀錄唯讀。</p>
    <details v-if="!readonly">
      <summary>建立專用庫存預留</summary>
      <form @submit.prevent="save">
        <fieldset :disabled="isBusy">
          <div class="form-grid">
            <div class="field">
              <label for="reservation-plan">預留方案</label
              ><select id="reservation-plan" v-model="form.planId" required>
                <option value="">請選擇</option>
                <option
                  v-for="p in snapshot.salePlans.filter((p) => !p.archived)"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="reservation-product">預留商品</label
              ><select
                id="reservation-product"
                v-model="form.productId"
                required
              >
                <option value="">先選方案，再選商品</option>
                <option v-for="p in products" :key="p.id" :value="p.id">
                  {{ p.name }} · {{ p.code }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="reservation-location">預留庫位</label
              ><select
                id="reservation-location"
                v-model="form.locationId"
                required
              >
                <option value="">請選擇</option>
                <option v-for="l in locations" :key="l.id" :value="l.id">
                  {{ l.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="reservation-quantity">預留數量</label
              ><input
                id="reservation-quantity"
                v-model.number="form.quantity"
                type="number"
                min="1"
                step="1"
                required
              />
            </div>
          </div>
          <p v-if="shared !== null">
            此商品在目前庫位的未預留可用數量：{{
              shared
            }}。每組方案、商品與庫位僅能有一筆有效預留；調整數量時先釋放舊筆，再建立新筆。
          </p>
          <div class="field">
            <label for="reservation-reason">預留原因</label
            ><input
              id="reservation-reason"
              v-model="form.reason"
              maxlength="2000"
              required
              placeholder="例如：保留給徽章＋吊飾混合抽選"
            />
          </div>
          <button
            class="button primary"
            :disabled="
              isBusy ||
              !form.planId ||
              !form.productId ||
              !form.locationId ||
              form.quantity === null ||
              !form.reason.trim()
            "
          >
            確認預留庫存
          </button>
        </fieldset>
      </form>
    </details>
    <label class="check-option"
      ><input v-model="showReleased" type="checkbox" />顯示已釋放預留</label
    >
    <p v-if="!rows.length">
      目前沒有{{ showReleased ? "" : "有效" }}專用預留。
    </p>
    <article v-for="r in rows" :key="r.id" class="reservation-card">
      <h3>
        {{ name("salePlans", r.planId) }} · {{ name("products", r.productId) }}
      </h3>
      <p>
        {{ name("locations", r.locationId) }} · 初始預留 {{ r.quantity }} ·
        {{ r.releasedAt ? "已釋放" : "仍有效"
        }}<template v-if="!r.releasedAt"> · 尚可售 {{ remaining(r) }}</template>
      </p>
      <p>預留原因：{{ r.reason }}</p>
      <p v-if="r.releasedAt">釋放原因：{{ r.releaseReason }}</p>
      <button
        v-else-if="!readonly"
        class="button secondary"
        type="button"
        :disabled="isBusy"
        :aria-label="`釋放預留 ${r.code}`"
        @click="
          releaseId = r.id;
          releaseReason = '';
        "
      >
        釋放預留
      </button>
      <form
        v-if="releaseId === r.id"
        class="release-form"
        @submit.prevent="release"
      >
        <p>釋放後，不再保留這筆未售數量；之後的退款不會重新占用原預留。</p>
        <label :for="`release-reason-${r.id}`">釋放原因</label
        ><input
          :id="`release-reason-${r.id}`"
          v-model="releaseReason"
          maxlength="2000"
          required
          :disabled="isBusy"
        />
        <div class="actions">
          <button
            class="button primary"
            :disabled="isBusy || !releaseReason.trim()"
          >
            確認釋放預留</button
          ><button
            type="button"
            class="button secondary"
            :disabled="isBusy"
            @click="releaseId = ''"
          >
            取消
          </button>
        </div>
      </form>
    </article>
  </section>
</template>
<style scoped>
.reservation-panel {
  display: grid;
  gap: 16px;
  overflow-wrap: anywhere;
}
p {
  line-height: 1.8;
  margin: 0;
}
fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
  display: grid;
  gap: 16px;
}
form {
  margin-top: 16px;
}
.form-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
}
.field,
.release-form {
  display: grid;
  gap: 8px;
}
input:not([type="checkbox"]),
select {
  font: inherit;
  min-width: 0;
  width: 100%;
  min-height: 46px;
  border: 1px solid #9baa95;
  border-radius: 6px;
  padding: 10px;
  background: #fff;
  color: var(--text);
}
.check-option {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 44px;
}
input[type="checkbox"] {
  width: 20px;
  height: 20px;
}
.reservation-card {
  border-top: 1px solid var(--line);
  padding-top: 18px;
  display: grid;
  gap: 10px;
}
h3 {
  font-size: 17px;
  margin: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.button {
  justify-self: start;
}
summary {
  min-height: 44px;
  cursor: pointer;
  line-height: 1.7;
}
</style>
