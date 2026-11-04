<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type {
  CatalogSnapshot,
  SaleRecord,
  SaleLineInput,
  RefundLineInput,
  ExchangeInput,
} from "../../domain/models/catalog";
import { lineReturnSummary, refundSale } from "../../domain/sales/refunds";
import { saleTotal } from "../../domain/sales/operations";
import PhysicalUnitPicker from "./PhysicalUnitPicker.vue";
import PhysicalUnitReturnPicker from "./PhysicalUnitReturnPicker.vue";
const props = defineProps<{
  snapshot: CatalogSnapshot;
  sale: SaleRecord;
  busy: boolean;
  disabled?: boolean;
  locationId?: string;
  eventId?: string;
  submit: (input: ExchangeInput) => Promise<void>;
}>();
const opened = ref(false),
  saving = ref(false),
  error = ref(""),
  notice = ref(""),
  reason = ref(""),
  confirmed = ref(false),
  actualDifference = ref<number | null>(null);
const operationId = ref(crypto.randomUUID());
const uid = `exchange-${props.sale.id}`;
const location = ref(""),
  collector = ref("");
const returns = reactive<Record<string, RefundLineInput>>({});
const replacement = ref<(SaleLineInput & { key: string })[]>([]);
const item = reactive({
  productId: "",
  planId: "",
  quantity: 1,
  unitPrice: 0,
  unitIds: [] as string[],
});
const blocked = computed(() => props.busy || saving.value || !!props.disabled);
const plans = computed(() =>
  props.snapshot.salePlans.filter(
    (p) =>
      !p.archived &&
      (!p.eventIds.length ||
        p.eventIds.includes(props.eventId ?? props.sale.eventId)),
  ),
);
const products = computed(() =>
  props.snapshot.products.filter(
    (p) =>
      !p.archived &&
      (!item.planId ||
        plans.value
          .find((a) => a.id === item.planId)
          ?.productIds.includes(p.id)),
  ),
);
const refundLines = computed(() =>
  props.sale.lines
    .map((l) => returns[l.id])
    .filter(
      (l): l is RefundLineInput =>
        !!l && !!(l.amount || l.restockQuantity || l.damagedQuantity),
    )
    .map((l) => ({
      ...l,
      restockUnitIds: l.restockUnitIds?.length
        ? [...l.restockUnitIds]
        : undefined,
      damagedUnitIds: l.damagedUnitIds?.length
        ? [...l.damagedUnitIds]
        : undefined,
      returnLocationId: l.restockQuantity ? l.returnLocationId : "",
    })),
);
const refundTotal = computed(() => {
  try {
    return safeSum(refundLines.value.map((l) => l.amount));
  } catch {
    return null;
  }
});
const newTotal = computed(() => {
  try {
    return replacement.value.length ? saleTotal(replacement.value) : null;
  } catch {
    return null;
  }
});
const difference = computed(() =>
  refundTotal.value === null || newTotal.value === null
    ? null
    : newTotal.value - refundTotal.value,
);
watch(
  [refundLines, replacement, actualDifference, location, collector, reason],
  () => {
    confirmed.value = false;
  },
  { deep: true },
);
const projected = computed(() => {
  const s = JSON.parse(JSON.stringify(props.snapshot)) as CatalogSnapshot;
  try {
    if (refundLines.value.length)
      refundSale(s, {
        operationId: "exchange-ui-preview",
        saleId: props.sale.id,
        reason: reason.value || "換購預覽",
        lines: refundLines.value,
      });
  } catch {
    /* Real submission validates every return. */
  }
  return s;
});
function safeSum(values: number[]) {
  let n = 0n;
  for (const v of values) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error();
    n += BigInt(v);
  }
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
  return Number(n);
}
function remaining(id: string) {
  const l = props.sale.lines.find((l) => l.id === id)!;
  const used = lineReturnSummary(props.snapshot, id);
  return {
    amount: l.quantity * l.unitPrice - used.amount,
    quantity: l.quantity - used.restockQuantity - used.damagedQuantity,
  };
}
function open() {
  error.value = "";
  notice.value = "";
  reason.value = "";
  confirmed.value = false;
  actualDifference.value = null;
  operationId.value = crypto.randomUUID();
  location.value = props.locationId || props.sale.locationId;
  collector.value = props.sale.collectorId;
  replacement.value = [];
  Object.assign(item, {
    productId: "",
    planId: "",
    quantity: 1,
    unitPrice: 0,
    unitIds: [],
  });
  for (const l of props.sale.lines)
    returns[l.id] = {
      saleLineId: l.id,
      amount: 0,
      restockQuantity: 0,
      damagedQuantity: 0,
      returnLocationId: location.value,
      restockUnitIds: [],
      damagedUnitIds: [],
    };
  opened.value = true;
}
function choosePlan() {
  const p = plans.value.find((p) => p.id === item.planId);
  item.productId = "";
  item.unitIds = [];
  if (p) item.unitPrice = p.unitPrice;
}
function add() {
  error.value = "";
  try {
    if (!item.productId) throw new Error("請選擇新交付商品。");
    const plan = plans.value.find((p) => p.id === item.planId);
    const line: SaleLineInput & { key: string } = {
      key: crypto.randomUUID(),
      productId: item.productId,
      mode: plan?.mode || "direct",
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      ...(plan ? { planId: plan.id, planVersion: plan.version } : {}),
      ...(item.unitIds.length ? { unitIds: [...item.unitIds] } : {}),
    };
    saleTotal([line]);
    if (item.unitIds.length && item.unitIds.length !== item.quantity)
      throw new Error("數量必須與所選實物件數一致。");
    replacement.value.push(line);
    item.unitIds = [];
    item.productId = "";
    item.quantity = 1;
    confirmed.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "請核對商品數量與價格。";
  }
}
async function save() {
  if (blocked.value || !confirmed.value || difference.value === null) return;
  error.value = "";
  notice.value = "";
  saving.value = true;
  try {
    if (
      actualDifference.value === null ||
      !Number.isSafeInteger(actualDifference.value) ||
      actualDifference.value !== difference.value
    )
      throw new Error(
        "實際收退差額必須與本次換購差額一致；請先核對原退款及新售價。",
      );
    await props.submit({
      operationId: operationId.value,
      saleId: props.sale.id,
      reason: reason.value.trim(),
      refundLines: refundLines.value,
      replacement: {
        locationId: location.value,
        eventId: props.eventId ?? props.sale.eventId,
        collectorId: collector.value,
        notes: reason.value.trim(),
        lines: replacement.value.map(({ key, ...l }) => ({
          ...l,
          unitIds: l.unitIds ? [...l.unitIds] : undefined,
        })),
      },
      actualDifference: actualDifference.value,
      confirmed: true,
    });
    opened.value = false;
    notice.value = "換購已記錄，差額、退貨及新交付商品已一起保存。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "換購未完成，請重新核對。";
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <section class="exchange-panel" :aria-label="`換購差額 ${sale.code}`">
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error-notice" role="alert">{{ error }}</p>
    <button
      v-if="!opened && !sale.cancelledAt"
      type="button"
      class="button secondary"
      :disabled="blocked"
      @click="open"
    >
      換購／補退差額 {{ sale.code }}
    </button>
    <p v-if="disabled && !sale.cancelledAt" class="hint">
      請先完成或清空未成交購物車，再記錄換購。
    </p>
    <article
      v-for="r in snapshot.exchanges.filter(
        (r) => r.originalSaleId === sale.id || r.replacementSaleId === sale.id,
      )"
      :key="r.id"
      class="exchange-history"
    >
      <h4>換購紀錄 {{ r.code }}</h4>
      <p>
        原交易
        {{ snapshot.sales.find((s) => s.id === r.originalSaleId)?.code }} →
        新交付
        {{
          snapshot.sales.find((s) => s.id === r.replacementSaleId)?.code
        }}；原商品折抵 {{ r.refundTotal }} 元，新商品
        {{ r.replacementTotal }} 元。
      </p>
      <p>
        {{
          r.actualDifference > 0
            ? `已實際補收 ${r.actualDifference} 元`
            : r.actualDifference < 0
              ? `已實際退還 ${-r.actualDifference} 元`
              : "差額 0 元，無收退款"
        }}
        · {{ r.reason }}
      </p>
    </article>
    <form v-if="opened" class="confirmation" @submit.prevent="save">
      <h4>一次核對退貨、新交付與實際差額</h4>
      <p>
        這裡記錄本次換購的實際補收或退款，不代表顧客重新支付新商品全額。已另外記錄的退款不能再填一次。
      </p>
      <fieldset :disabled="blocked">
        <legend>一、原交易本次退回／折抵</legend>
        <article v-for="l in sale.lines" :key="l.id" class="line">
          <h5>{{ l.productName }}</h5>
          <p>
            尚可折抵／退款 {{ remaining(l.id).amount }} 元；尚可退回
            {{ remaining(l.id).quantity }} 件。
          </p>
          <div class="grid">
            <label :for="`${uid}-amount-${l.id}`"
              >本次原商品折抵／退款金額<input
                :id="`${uid}-amount-${l.id}`"
                v-model.number="returns[l.id]!.amount"
                type="number"
                min="0"
                step="1"
            /></label>
            <label :for="`${uid}-back-${l.id}`"
              >本次可售回庫數量<input
                :id="`${uid}-back-${l.id}`"
                v-model.number="returns[l.id]!.restockQuantity"
                type="number"
                min="0"
                step="1"
                :disabled="!!l.unitIds?.length"
            /></label>
            <label :for="`${uid}-damage-${l.id}`"
              >本次損壞退回數量<input
                :id="`${uid}-damage-${l.id}`"
                v-model.number="returns[l.id]!.damagedQuantity"
                type="number"
                min="0"
                step="1"
                :disabled="!!l.unitIds?.length"
            /></label>
            <label :for="`${uid}-returnloc-${l.id}`"
              >可售品回庫庫位<select
                :id="`${uid}-returnloc-${l.id}`"
                v-model="returns[l.id]!.returnLocationId"
                aria-label="可售品回庫庫位"
                :disabled="!!locationId"
              >
                <option
                  v-for="loc in snapshot.locations"
                  :key="loc.id"
                  :value="loc.id"
                >
                  {{ loc.name }}
                </option>
              </select></label
            >
          </div>
          <PhysicalUnitReturnPicker
            :snapshot="snapshot"
            :sale-line-id="l.id"
            :restock-unit-ids="returns[l.id]!.restockUnitIds || []"
            :damaged-unit-ids="returns[l.id]!.damagedUnitIds || []"
            :disabled="blocked"
            @update:restock-unit-ids="
              returns[l.id]!.restockUnitIds = $event;
              returns[l.id]!.restockQuantity = $event.length;
            "
            @update:damaged-unit-ids="
              returns[l.id]!.damagedUnitIds = $event;
              returns[l.id]!.damagedQuantity = $event.length;
            "
          />
        </article>
      </fieldset>
      <fieldset :disabled="blocked">
        <legend>二、新交付商品</legend>
        <div class="grid">
          <label :for="`${uid}-location`"
            >新商品出貨庫位<select
              :id="`${uid}-location`"
              v-model="location"
              aria-label="新商品出貨庫位"
              :disabled="!!locationId"
            >
              <option
                v-for="loc in snapshot.locations"
                :key="loc.id"
                :value="loc.id"
              >
                {{ loc.name }}
              </option>
            </select></label
          >
          <label :for="`${uid}-plan`"
            >換購新商品方案<select
              :id="`${uid}-plan`"
              v-model="item.planId"
              aria-label="換購新商品方案"
              @change="choosePlan"
            >
              <option value="">手動指定售價</option>
              <option v-for="p in plans" :key="p.id" :value="p.id">
                {{ p.name }} · {{ p.unitPrice }}元
              </option>
            </select></label
          >
          <label :for="`${uid}-product`"
            >換購新商品<select
              :id="`${uid}-product`"
              v-model="item.productId"
              aria-label="換購新商品"
            >
              <option value="">請選擇</option>
              <option v-for="p in products" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select></label
          >
          <label :for="`${uid}-qty`"
            >新交付數量<input
              :id="`${uid}-qty`"
              v-model.number="item.quantity"
              type="number"
              min="1"
              step="1"
          /></label>
          <label :for="`${uid}-price`"
            >新交付單價<input
              :id="`${uid}-price`"
              v-model.number="item.unitPrice"
              type="number"
              min="0"
              step="1"
              :disabled="!!item.planId"
          /></label>
        </div>
        <PhysicalUnitPicker
          :snapshot="projected"
          :product-id="item.productId"
          :location-id="location"
          v-model="item.unitIds"
          :excluded-ids="replacement.flatMap((l) => l.unitIds || [])"
          :disabled="blocked"
          label="換購實際新交付單件"
        />
        <button
          type="button"
          class="button secondary"
          :disabled="!item.productId"
          @click="add"
        >
          加入換購新商品
        </button>
        <ul>
          <li v-for="(l, i) in replacement" :key="l.key">
            {{ snapshot.products.find((p) => p.id === l.productId)?.name }} ×
            {{ l.quantity }} · {{ l.unitPrice }}元<button
              type="button"
              class="text-button"
              :aria-label="`移除換購商品 ${i + 1}`"
              @click="
                replacement.splice(i, 1);
                confirmed = false;
              "
            >
              移除
            </button>
          </li>
        </ul>
      </fieldset>
      <fieldset :disabled="blocked">
        <legend>三、確認實際補收或退款</legend>
        <p>
          本次原商品折抵 {{ refundTotal ?? "請核對" }} 元；新商品
          {{ newTotal ?? "尚未加入" }} 元。
        </p>
        <p class="difference" role="status">
          {{
            difference === null
              ? "請先完成商品與金額"
              : difference > 0
                ? `本次應補收 ${difference} 元`
                : difference < 0
                  ? `本次應退還 ${-difference} 元`
                  : "本次差額 0 元，無收退款"
          }}
        </p>
        <div class="grid">
          <label :for="`${uid}-cash`"
            >實際收退差額（補收填正數、退還填負數）<input
              :id="`${uid}-cash`"
              v-model.number="actualDifference"
              type="number"
              step="1"
              required
          /></label>
          <label :for="`${uid}-collector`"
            >本次差額收付經手人<select
              :id="`${uid}-collector`"
              v-model="collector"
              aria-label="本次差額收付經手人"
            >
              <option value="">未指定</option>
              <option v-for="p in snapshot.parties" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select></label
          >
        </div>
        <label :for="`${uid}-reason`"
          >換購原因與說明<textarea
            :id="`${uid}-reason`"
            v-model="reason"
            required
            maxlength="2000"
            rows="2"
          ></textarea>
        </label>
        <label class="check-option"
          ><input
            v-model="confirmed"
            type="checkbox"
          />我確認已完成以上實物交付，並已實際補收／退還所填差額；零元則無收退款</label
        >
      </fieldset>
      <div class="actions">
        <button
          class="button primary"
          :disabled="
            blocked ||
            !confirmed ||
            difference === null ||
            actualDifference !== difference ||
            !refundLines.length ||
            !reason.trim()
          "
        >
          確認換購並保存差額</button
        ><button
          type="button"
          class="button secondary"
          :disabled="blocked"
          @click="opened = false"
        >
          返回
        </button>
      </div>
    </form>
  </section>
</template>
<style scoped>
.exchange-panel {
  margin: 14px 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.confirmation {
  background: #f7faf3;
  border: 1px solid #b6c9ac;
  padding: 16px;
  border-radius: 10px;
  display: grid;
  gap: 16px;
}
fieldset {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  min-width: 0;
}
legend,
h4 {
  font-weight: 600;
}
h5 {
  font-size: 16px;
  margin: 8px 0;
}
p,
.hint {
  font-size: 14px;
  line-height: 1.8;
}
label {
  display: grid;
  gap: 6px;
  font-size: 14px;
}
input:not([type="checkbox"]),
select,
textarea {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 9px;
  border: 1px solid #aabca1;
  border-radius: 6px;
  background: white;
  color: var(--text);
  font: inherit;
}
.grid {
  display: grid;
  gap: 12px;
  margin: 12px 0;
}
.line {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.check-option {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-height: 44px;
  margin-top: 14px;
}
.check-option input {
  width: 20px;
  height: 20px;
  flex: none;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.difference {
  font-weight: 600;
  color: #234f3b;
}
@media (min-width: 700px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
