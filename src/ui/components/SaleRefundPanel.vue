<script setup lang="ts">
import PhysicalUnitReturnPicker from "./PhysicalUnitReturnPicker.vue";
import { computed, reactive, ref } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import { lineReturnSummary } from "../../domain/sales/refunds";
import type { RefundRecord, SaleRecord } from "../../domain/models/catalog";
const props = defineProps<{ sale: SaleRecord }>();
const emit = defineEmits<{
  recorded: [];
  replacement: [refund: RefundRecord];
}>();
const catalog = useCatalogStore();
const opened = ref(false),
  confirmed = ref(false),
  error = ref(""),
  notice = ref(""),
  reason = ref("");
const operationId = ref(crypto.randomUUID());
const form = reactive<
  Record<
    string,
    {
      amount: number;
      restockQuantity: number;
      damagedQuantity: number;
      returnLocationId: string;
      restockUnitIds: string[];
      damagedUnitIds: string[];
    }
  >
>({});
const refunds = computed(
  () =>
    catalog.snapshot?.refunds.filter((r) => r.saleId === props.sale.id) || [],
);
const total = computed(() =>
  Object.values(form)
    .reduce(
      (n, l) =>
        n +
        BigInt(Number.isSafeInteger(l.amount) && l.amount >= 0 ? l.amount : 0),
      0n,
    )
    .toString(),
);
function remaining(id: string) {
  const l = props.sale.lines.find((l) => l.id === id)!;
  const used = catalog.snapshot
    ? lineReturnSummary(catalog.snapshot, id)
    : { amount: 0, restockQuantity: 0, damagedQuantity: 0 };
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
  operationId.value = crypto.randomUUID();
  for (const l of props.sale.lines)
    form[l.id] = {
      amount: 0,
      restockQuantity: 0,
      damagedQuantity: 0,
      returnLocationId: props.sale.locationId,
      restockUnitIds: [],
      damagedUnitIds: [],
    };
  opened.value = true;
}
async function save() {
  if (!catalog.snapshot || !confirmed.value) return;
  error.value = "";
  notice.value = "";
  try {
    await catalog.recordRefund({
      operationId: operationId.value,
      saleId: props.sale.id,
      reason: reason.value,
      lines: props.sale.lines
        .map((l) => ({
          saleLineId: l.id,
          ...form[l.id],
          restockUnitIds: form[l.id]!.restockUnitIds.length
            ? [...form[l.id]!.restockUnitIds]
            : undefined,
          damagedUnitIds: form[l.id]!.damagedUnitIds.length
            ? [...form[l.id]!.damagedUnitIds]
            : undefined,
          returnLocationId:
            form[l.id]!.restockQuantity > 0 ? form[l.id]!.returnLocationId : "",
        }))
        .filter((l) => l.amount || l.restockQuantity || l.damagedQuantity),
    });
    opened.value = false;
    notice.value = "退款／退貨已記錄，原交易仍保留。";
    emit("recorded");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法記錄退款。";
  }
}
const when = (v: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(v));
</script>
<template>
  <section aria-label="退款與退貨">
    <p v-if="notice" role="status" class="success-notice">{{ notice }}</p>
    <p v-if="error" role="alert" class="error-notice">{{ error }}</p>
    <button
      v-if="!sale.cancelledAt && !opened"
      class="button secondary"
      :disabled="catalog.busy"
      @click="open"
    >
      部分退款／退貨 {{ sale.code }}
    </button>
    <form v-if="opened" class="confirmation" @submit.prevent="save">
      <h4>
        {{
          sale.consignmentId
            ? "登記店家已完成的退款與退貨"
            : "記錄已實際完成的退款與退貨"
        }}
      </h4>
      <p v-if="sale.consignmentId">
        以下是店家已向顧客退款／收回商品的回報，不代表創作者支付現金。回庫僅能回到本寄賣庫位，損壞退貨不增加可售庫存。
      </p>
      <p v-else>
        退款金額與退回數量分開填寫。不退貨可只退款；瑕疵退回只留紀錄，不增加可售庫存。同時退貨並交付新商品，可返回使用「換購／補退差額」一次核對；若已完成退款，再另建實際交付交易，勿重複折抵。
      </p>
      <fieldset :disabled="catalog.busy">
        <article v-for="l in sale.lines" :key="l.id" class="refund-line">
          <h5>{{ l.productName }}</h5>
          <p>
            尚可退款 {{ remaining(l.id).amount }} 元；尚可退貨
            {{ remaining(l.id).quantity }} 件。
          </p>
          <PhysicalUnitReturnPicker
            v-if="catalog.snapshot"
            :snapshot="catalog.snapshot"
            :sale-line-id="l.id"
            :restock-unit-ids="form[l.id]!.restockUnitIds"
            :damaged-unit-ids="form[l.id]!.damagedUnitIds"
            @update:restock-unit-ids="
              form[l.id]!.restockUnitIds = $event;
              form[l.id]!.restockQuantity = $event.length;
            "
            @update:damaged-unit-ids="
              form[l.id]!.damagedUnitIds = $event;
              form[l.id]!.damagedQuantity = $event.length;
            "
            :disabled="catalog.busy"
          />
          <div class="form-grid">
            <div class="field">
              <label :for="'refund-money-' + l.id">本次實退金額（元）</label
              ><input
                :id="'refund-money-' + l.id"
                v-model.number="form[l.id]!.amount"
                type="number"
                min="0"
                :max="remaining(l.id).amount"
                step="1"
                required
              />
            </div>
            <div class="field">
              <label :for="'refund-restock-' + l.id">本次可售回庫數量</label
              ><input
                :id="'refund-restock-' + l.id"
                v-model.number="form[l.id]!.restockQuantity"
                type="number"
                min="0"
                :max="remaining(l.id).quantity"
                step="1"
                required
              />
            </div>
            <div class="field">
              <label :for="'refund-damage-' + l.id">本次瑕疵退回數量</label
              ><input
                :id="'refund-damage-' + l.id"
                v-model.number="form[l.id]!.damagedQuantity"
                type="number"
                min="0"
                :max="remaining(l.id).quantity"
                step="1"
                required
              />
            </div>
            <div v-if="form[l.id]!.restockQuantity > 0" class="field">
              <label :for="'refund-location-' + l.id">回庫庫位</label
              ><select
                :id="'refund-location-' + l.id"
                v-model="form[l.id]!.returnLocationId"
                required
              >
                <option value="">請選擇庫位</option>
                <option
                  v-for="loc in catalog.snapshot?.locations"
                  :key="loc.id"
                  :value="loc.id"
                >
                  {{ loc.name }}
                </option>
              </select>
            </div>
          </div>
        </article>
        <p>本次實退總額：{{ total }} 元</p>
        <div class="field">
          <label :for="'refund-reason-' + sale.id">退款／退貨原因</label
          ><input
            :id="'refund-reason-' + sale.id"
            v-model="reason"
            required
            maxlength="2000"
          />
        </div>
        <label class="check-option"
          ><input type="checkbox" v-model="confirmed" />{{
            sale.consignmentId
              ? "我確認店家已完成上述退款與退貨；回庫商品可再次販售"
              : "我確認已完成上述退款與退貨；填寫的回庫商品可再次販售"
          }}</label
        >
      </fieldset>
      <div class="actions">
        <button
          class="button primary"
          :disabled="catalog.busy || !confirmed || !reason.trim()"
        >
          記錄退款／退貨</button
        ><button
          type="button"
          class="button secondary"
          :disabled="catalog.busy"
          @click="opened = false"
        >
          返回
        </button>
      </div>
    </form>
    <article v-for="r in refunds" :key="r.id" class="refund-history">
      <h4>
        {{ r.code }} · {{ r.exchangeId ? "換購折抵" : "實退" }} {{ r.total }} 元
      </h4>
      <p v-if="r.exchangeId">
        此金額是換購原額折抵，不代表另行支付同額現金退款；實際補收／退還請查看關聯換購差額。
      </p>
      <p>{{ when(r.createdAt) }} · {{ r.reason }}</p>
      <ul>
        <li v-for="l in r.lines" :key="l.id">
          {{ sale.lines.find((s) => s.id === l.saleLineId)?.productName }}：{{
            r.exchangeId ? "換購折抵" : "實退"
          }}
          {{ l.amount }} 元，可售回庫 {{ l.restockQuantity }} 件，瑕疵退回
          {{ l.damagedQuantity }} 件
        </li>
      </ul>
      <button
        v-if="!r.exchangeId && !sale.consignmentId"
        class="button secondary"
        :disabled="catalog.busy"
        @click="emit('replacement', r)"
      >
        另建換貨交易 {{ r.code }}
      </button>
    </article>
  </section>
</template>
<style scoped src="../pages/business.css"></style>
<style scoped>
.refund-line,
.refund-history {
  border-top: 1px solid var(--line);
  padding: 12px 0;
}
.refund-line h5 {
  font-size: 16px;
  margin: 8px 0;
}
</style>
