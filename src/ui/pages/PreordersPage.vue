<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
import { preorderSummary } from "../../domain/preorder/operations";
import { lineReturnSummary } from "../../domain/sales/refunds";
import PhysicalUnitPicker from "../components/PhysicalUnitPicker.vue";
import PhysicalUnitReturnPicker from "../components/PhysicalUnitReturnPicker.vue";
const workspaces = useWorkspaceStore(),
  catalog = useCatalogStore();
const selected = ref(""),
  notice = ref(""),
  error = ref("");
const current = computed(() =>
  catalog.snapshot?.preorders.find((o) => o.id === selected.value),
);
const summary = computed(() =>
  catalog.snapshot && current.value
    ? preorderSummary(catalog.snapshot, current.value)
    : null,
);
const products = computed(
  () => catalog.snapshot?.products.filter((p) => !p.archived) || [],
);
const locations = computed(
  () =>
    catalog.snapshot?.locations.filter(
      (l) =>
        !catalog.snapshot?.consignments.some((c) => c.locationId === l.id) &&
        !catalog.snapshot?.activityHandoffs.some((h) => h.locationId === l.id),
    ) || [],
);
const create = reactive({
  name: "",
  customerReference: "",
  notes: "",
  lines: [{ productId: "", quantity: 1, unitPrice: null as number | null }],
});
const payment = reactive({
    amount: null as number | null,
    partyId: "",
    occurredAt: "",
    reason: "",
    kind: "receipt",
  }),
  paymentConfirmed = ref(false);
const deliver = reactive({
    orderLineId: "",
    locationId: "",
    quantity: 1,
    unitIds: [] as string[],
    reason: "",
  }),
  deliveryConfirmed = ref(false);
const cancellation = reactive({ orderLineId: "", quantity: 1, reason: "" });
const returned = reactive({
    saleLineId: "",
    restockQuantity: 0,
    damagedQuantity: 0,
    returnLocationId: "",
    restockUnitIds: [] as string[],
    damagedUnitIds: [] as string[],
    reason: "",
  }),
  returnConfirmed = ref(false);
const reverseReason = ref(""),
  statusReason = ref("");
const allowUnpaidDelivery = ref(false),
  confirmedOutstanding = ref(false);
const operationIds = reactive<Record<string, string>>({});
function op(key: string) {
  return (operationIds[key] ||= crypto.randomUUID());
}
function done(key: string) {
  operationIds[key] = crypto.randomUUID();
}
function taipeiNow() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(" ", "T");
}
function instant(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v))
    throw new Error("請填寫完整台灣日期及時間。");
  return new Date(v + ":00+08:00").toISOString();
}
const when = (at: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(at));
const deliveryLine = computed(() =>
  current.value?.lines.find((l) => l.id === deliver.orderLineId),
);
const deliveryNeedsCredit = computed(
  () =>
    !!summary.value &&
    !!deliveryLine.value &&
    summary.value.netPaid <
      summary.value.netDeliveredValue +
        deliveryLine.value.unitPrice * deliver.quantity,
);
const refundLeavesOutstanding = computed(
  () =>
    payment.kind === "refund" &&
    !!summary.value &&
    payment.amount !== null &&
    payment.amount >
      Math.max(0, summary.value.netPaid - summary.value.activeTotal),
);
const deliverySales = computed(
  () =>
    catalog.snapshot?.sales.filter((s) =>
      current.value?.fulfillments.some((f) => f.saleId === s.id),
    ) || [],
);
const returnSource = computed(() => {
  for (const sale of deliverySales.value) {
    const line = sale.lines.find((l) => l.id === returned.saleLineId);
    if (line) return { sale, line };
  }
  return null;
});
const returnPrior = computed(() =>
  catalog.snapshot && returnSource.value
    ? lineReturnSummary(catalog.snapshot, returnSource.value.line.id)
    : null,
);
const returnedCredit = computed(() =>
  returnSource.value
    ? (returned.restockQuantity + returned.damagedQuantity) *
      returnSource.value.line.unitPrice
    : 0,
);
async function run(fn: () => Promise<unknown>, message: string) {
  if (catalog.busy) return;
  error.value = "";
  notice.value = "";
  try {
    await fn();
    notice.value = message;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作未完成，原資料仍保留。";
  }
}
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    selected.value = "";
    notice.value = "";
    error.value = "";
    if (id) await catalog.load(id);
  },
  { immediate: true },
);
watch(
  () => catalog.snapshot?.preorders,
  (rows) => {
    if (rows?.length && !rows.some((o) => o.id === selected.value))
      selected.value = rows[0]!.id;
  },
);
watch(selected, () => {
  deliver.orderLineId = "";
  deliver.unitIds = [];
  returned.saleLineId = "";
  cancellation.orderLineId = "";
  paymentConfirmed.value = false;
  deliveryConfirmed.value = false;
  returnConfirmed.value = false;
  statusReason.value = "";
  for (const key of Object.keys(operationIds)) done(key);
});
watch(
  () => [
    payment.amount,
    payment.partyId,
    payment.occurredAt,
    payment.reason,
    payment.kind,
  ],
  () => {
    paymentConfirmed.value = false;
    confirmedOutstanding.value = false;
  },
);
watch(
  () => JSON.stringify(deliver),
  () => {
    deliveryConfirmed.value = false;
    allowUnpaidDelivery.value = false;
  },
);
watch(
  () => JSON.stringify(returned),
  () => (returnConfirmed.value = false),
);
watch(
  () => returned.saleLineId,
  () => {
    returned.restockQuantity = 0;
    returned.damagedQuantity = 0;
    returned.restockUnitIds = [];
    returned.damagedUnitIds = [];
    returned.returnLocationId = "";
  },
);
watch(
  () => [returned.restockUnitIds.length, returned.damagedUnitIds.length],
  () => {
    if (returnSource.value?.line.unitIds?.length) {
      returned.restockQuantity = returned.restockUnitIds.length;
      returned.damagedQuantity = returned.damagedUnitIds.length;
    }
  },
);
payment.occurredAt = taipeiNow();
async function save() {
  await run(async () => {
    const operationId = op("create");
    await catalog.createPreorder({
      ...create,
      operationId,
      lines: create.lines.map((l) => {
        if (l.unitPrice === null)
          throw new Error("請填寫約定單價，免費請明確填0。");
        return { ...l, unitPrice: l.unitPrice };
      }),
    });
    selected.value =
      catalog.snapshot?.preorders.find(
        (o) => o.createOperationId === operationId,
      )?.id || selected.value;
    done("create");
    create.name = "";
    create.customerReference = "";
    create.notes = "";
    create.lines = [
      { productId: "", quantity: 1, unitPrice: null as number | null },
    ];
  }, "預售單已建立；尚未收款、認列交付或扣庫。");
}
async function receive() {
  await run(async () => {
    if (!paymentConfirmed.value || payment.amount === null)
      throw new Error("請填金額並確認實際收退已完成。");
    const input = {
      operationId: op("payment"),
      amount: payment.amount,
      confirmedOutstanding: confirmedOutstanding.value,
      partyId: payment.partyId,
      occurredAt: instant(payment.occurredAt),
      reason: payment.reason,
    };
    if (payment.kind === "receipt")
      await catalog.receivePreorder(selected.value, input);
    else await catalog.refundPreorderPayment(selected.value, input);
    done("payment");
    payment.amount = null;
    payment.reason = "";
    paymentConfirmed.value = false;
  }, "實際款項已保存；不會重複認列交付營收或增加庫存。");
}
async function fulfill() {
  await run(async () => {
    if (!deliveryConfirmed.value) throw new Error("請確認商品已實際交付。");
    await catalog.fulfillPreorder(selected.value, {
      operationId: op("deliver"),
      locationId: deliver.locationId,
      allowUnpaidDelivery: allowUnpaidDelivery.value,
      lines: [
        {
          orderLineId: deliver.orderLineId,
          quantity: deliver.quantity,
          unitIds: [...deliver.unitIds],
        },
      ],
      reason: deliver.reason,
    });
    done("deliver");
    deliver.unitIds = [];
    deliver.reason = "";
    deliveryConfirmed.value = false;
  }, "交付已保存並扣除實際庫存；本次不再虛構收款。");
}
async function cancel() {
  await run(async () => {
    await catalog.cancelPreorder(selected.value, {
      operationId: op("cancel"),
      lines: [
        {
          orderLineId: cancellation.orderLineId,
          quantity: cancellation.quantity,
        },
      ],
      reason: cancellation.reason,
    });
    done("cancel");
    cancellation.reason = "";
  }, "未交付數量已取消；尚未實際退款，請另記款項。");
}
async function returnGoods() {
  await run(async () => {
    if (!returnConfirmed.value || !returnSource.value)
      throw new Error("請選擇原交付明細並確認實物退回。");
    await catalog.returnPreorderGoods(selected.value, {
      operationId: op("return"),
      saleId: returnSource.value.sale.id,
      reason: returned.reason,
      lines: [
        {
          saleLineId: returned.saleLineId,
          amount: returnedCredit.value,
          restockQuantity: returned.restockQuantity,
          damagedQuantity: returned.damagedQuantity,
          returnLocationId: returned.restockQuantity
            ? returned.returnLocationId
            : "",
          restockUnitIds: [...returned.restockUnitIds],
          damagedUnitIds: [...returned.damagedUnitIds],
        },
      ],
    });
    done("return");
    returned.reason = "";
    returnConfirmed.value = false;
  }, "退貨與交付抵減已保存；這不是現金退款，實際退錢請另記款項。");
}
async function reverse(id: string) {
  await run(async () => {
    await catalog.reversePreorderReceipt(selected.value, {
      operationId: op("reverse-" + id),
      paymentId: id,
      reason: reverseReason.value,
    });
    done("reverse-" + id);
    reverseReason.value = "";
  }, "誤記收款已新增沖銷，原紀錄保留。");
}
async function changeStatus() {
  await run(async () => {
    const input = { operationId: op("status"), reason: statusReason.value };
    if (current.value?.closedAt)
      await catalog.reopenPreorder(selected.value, input);
    else await catalog.closePreorder(selected.value, input);
    done("status");
    statusReason.value = "";
  }, "預售狀態已更新，歷史與待查款項保留。");
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">PREORDERS AND DELIVERY</div>
      <h1>預售與交付</h1>
      <p>
        先建訂單與分次收款，實際交付時才扣庫；收款、交付營收及退款分開核對。
      </p>
    </div>
  </section>
  <section v-if="!workspaces.activeWorkspaceId" class="info-banner">
    <div>
      <h2>先建立工作區</h2>
      <RouterLink class="button primary" to="/">前往工作區總覽</RouterLink>
    </div>
  </section>
  <template v-else>
    <div class="field workspace-picker">
      <label for="preorder-workspace">目前工作區</label
      ><select
        id="preorder-workspace"
        :value="workspaces.activeWorkspaceId"
        :disabled="catalog.busy"
        @change="workspaces.select(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="w in workspaces.workspaces" :value="w.id" :key="w.id">
          {{ w.name }}
        </option>
      </select>
    </div>
    <p v-if="notice" role="status" class="success-notice">{{ notice }}</p>
    <p v-if="error || catalog.error" role="alert" class="error-notice">
      {{ error || catalog.error }}
    </p>
    <p class="info-banner">
      預售單不保證有庫存，也不自動預留。訂金／尾款是已確認的實收紀錄，不是實際線上收款；交付使用一般庫位；若仍有欠款，必須另外明確確認已實際交付並保留未收款差額。活動交接及寄賣庫位不適用此交付流程。
    </p>
    <template v-if="catalog.snapshot">
      <section class="business-panel section-block">
        <h2>建立預售單</h2>
        <form @submit.prevent="save">
          <fieldset :disabled="catalog.busy">
            <div class="form-grid">
              <div class="field">
                <label for="preorder-name">預售單名稱（必填）</label
                ><input
                  id="preorder-name"
                  v-model="create.name"
                  required
                  maxlength="80"
                />
              </div>
              <div class="field">
                <label for="preorder-customer">顧客參考代號</label
                ><input
                  id="preorder-customer"
                  v-model="create.customerReference"
                  maxlength="120"
                  placeholder="例如：訂單 A001；避免填寫不必要的個資"
                />
              </div>
            </div>
            <div v-for="(line, i) in create.lines" :key="i" class="line-box">
              <div class="form-grid">
                <div class="field">
                  <label :for="`preorder-product-${i}`"
                    >預售商品 {{ i + 1 }}</label
                  ><select
                    :id="`preorder-product-${i}`"
                    v-model="line.productId"
                    required
                  >
                    <option value="">請選商品</option>
                    <option v-for="p in products" :value="p.id" :key="p.id">
                      {{ p.name }}
                    </option>
                  </select>
                </div>
                <div class="field">
                  <label :for="`preorder-quantity-${i}`"
                    >預訂數量 {{ i + 1 }}</label
                  ><input
                    :id="`preorder-quantity-${i}`"
                    v-model.number="line.quantity"
                    type="number"
                    min="1"
                    step="1"
                    required
                  />
                </div>
                <div class="field">
                  <label :for="`preorder-price-${i}`"
                    >約定單價 {{ i + 1 }}（元）</label
                  ><input
                    :id="`preorder-price-${i}`"
                    v-model.number="line.unitPrice"
                    type="number"
                    min="0"
                    step="1"
                    required
                  />
                </div>
              </div>
              <button
                v-if="create.lines.length > 1"
                type="button"
                class="text-button"
                @click="create.lines.splice(i, 1)"
              >
                移除第 {{ i + 1 }} 項
              </button>
            </div>
            <button
              type="button"
              class="button secondary"
              :disabled="create.lines.length >= 100"
              @click="
                create.lines.push({
                  productId: '',
                  quantity: 1,
                  unitPrice: null,
                })
              "
            >
              增加預售商品
            </button>
            <div class="field">
              <label for="preorder-notes">訂單說明</label
              ><textarea
                id="preorder-notes"
                v-model="create.notes"
                maxlength="2000"
              />
            </div>
          </fieldset>
          <button class="button primary" :disabled="catalog.busy">
            建立預售單
          </button>
        </form>
      </section>
      <section class="business-panel section-block">
        <div class="field">
          <label for="preorder-select">目前預售單</label
          ><select
            id="preorder-select"
            v-model="selected"
            :disabled="catalog.busy"
          >
            <option value="">請選預售單</option>
            <option
              v-for="o in catalog.snapshot.preorders"
              :value="o.id"
              :key="o.id"
            >
              {{ o.name }}{{ o.closedAt ? "（已結束）" : "" }}
            </option>
          </select>
        </div>
        <template v-if="current && summary"
          ><h2>{{ current.name }}</h2>
          <p>
            顧客參考：{{ current.customerReference || "未填" }} ·
            {{ current.closedAt ? "已結束／歷史保留" : "進行中" }}
          </p>
          <p>{{ current.notes }}</p>
          <dl class="summary-grid">
            <div>
              <dt>原約定總額</dt>
              <dd>{{ summary.total }} 元</dd>
            </div>
            <div>
              <dt>目前有效訂單額</dt>
              <dd>{{ summary.activeTotal }} 元</dd>
            </div>
            <div>
              <dt>累計交付價值（退貨後）</dt>
              <dd>{{ summary.netDeliveredValue }} 元</dd>
            </div>
            <div>
              <dt>累計實收／實退</dt>
              <dd>{{ summary.received }}／{{ summary.refunded }} 元</dd>
            </div>
            <div>
              <dt>款項差額（正數待收／負數多收）</dt>
              <dd>{{ summary.balance }} 元</dd>
            </div>
            <div>
              <dt>退款上限（已實收淨額）</dt>
              <dd>{{ summary.refundable }} 元</dd>
            </div>
          </dl>
          <div class="table-scroll">
            <table>
              <caption>
                預售品項與交付進度
              </caption>
              <thead>
                <tr>
                  <th>商品</th>
                  <th>單價</th>
                  <th>原訂</th>
                  <th>取消</th>
                  <th>已交付</th>
                  <th>尚未交付</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in summary.lines" :key="line.id">
                  <td>{{ line.productName }}</td>
                  <td>{{ line.unitPrice }}</td>
                  <td>{{ line.quantity }}</td>
                  <td>{{ line.cancelledQuantity }}</td>
                  <td>{{ line.deliveredQuantity }}</td>
                  <td>{{ line.remainingQuantity }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            原約定品項、數量與單價不直接改寫。取消未交付品項或退回已交付商品會追加紀錄；收到訂金不等於交付營收。
          </p>
          <details :open="!current.closedAt">
            <summary>實際訂金／尾款與退款</summary>
            <form @submit.prevent="receive">
              <fieldset :disabled="catalog.busy">
                <div class="form-grid">
                  <div class="field">
                    <label for="preorder-payment-kind">款項類型</label
                    ><select id="preorder-payment-kind" v-model="payment.kind">
                      <option value="receipt">實際收到款項</option>
                      <option value="refund">實際退還款項</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="preorder-payment-amount"
                      >本次實際金額（元）</label
                    ><input
                      id="preorder-payment-amount"
                      v-model.number="payment.amount"
                      type="number"
                      min="1"
                      step="1"
                      required
                    />
                  </div>
                  <div class="field">
                    <label for="preorder-payment-party">收退經手人</label
                    ><select
                      id="preorder-payment-party"
                      v-model="payment.partyId"
                    >
                      <option value="">未記錄</option>
                      <option
                        v-for="p in catalog.snapshot.parties"
                        :key="p.id"
                        :value="p.id"
                      >
                        {{ p.name }}
                      </option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="preorder-payment-at">實際收退時間（台灣）</label
                    ><input
                      id="preorder-payment-at"
                      v-model="payment.occurredAt"
                      type="datetime-local"
                      required
                    />
                  </div>
                </div>
                <div class="field">
                  <label for="preorder-payment-reason">收退說明</label
                  ><input
                    id="preorder-payment-reason"
                    v-model="payment.reason"
                    maxlength="2000"
                    required
                  />
                </div>
                <label class="check-option"
                  ><input
                    v-model="paymentConfirmed"
                    type="checkbox"
                  />我確認本次款項已實際收到或退還</label
                >
              </fieldset>
              <label v-if="refundLeavesOutstanding" class="check-option"
                ><input
                  v-model="confirmedOutstanding"
                  type="checkbox"
                  :disabled="catalog.busy"
                />我了解若退款超過多收款，將保留尚待收款；退款不會自動取消訂單。</label
              >
              <button
                class="button primary"
                :disabled="catalog.busy || !paymentConfirmed"
              >
                保存實際款項
              </button>
            </form>
            <h3>收退歷史</h3>
            <ul class="history">
              <li v-for="p in current.payments" :key="p.id">
                <strong
                  >{{
                    p.kind === "receipt"
                      ? "實收"
                      : p.kind === "refund"
                        ? "實退"
                        : "收款沖銷"
                  }}
                  {{ p.amount }} 元</strong
                >
                · {{ when(p.occurredAt) }}
                <p>{{ p.reason }}</p>
                <button
                  v-if="
                    p.kind === 'receipt' &&
                    !current.payments.some((r) => r.reversesId === p.id)
                  "
                  type="button"
                  class="text-button"
                  :disabled="catalog.busy || !reverseReason.trim()"
                  @click="reverse(p.id)"
                >
                  沖銷誤記收款 {{ p.amount }} 元
                </button>
              </li>
            </ul>
            <div class="field">
              <label for="preorder-reverse-reason">誤記收款沖銷原因</label
              ><input
                id="preorder-reverse-reason"
                v-model="reverseReason"
                maxlength="2000"
              />
            </div>
          </details>
          <template v-if="!current.closedAt"
            ><details>
              <summary>分批實際交付</summary>
              <form @submit.prevent="fulfill">
                <fieldset :disabled="catalog.busy">
                  <div class="form-grid">
                    <div class="field">
                      <label for="preorder-deliver-line">交付訂單品項</label
                      ><select
                        id="preorder-deliver-line"
                        v-model="deliver.orderLineId"
                        required
                      >
                        <option value="">請選品項</option>
                        <option
                          v-for="l in summary.lines.filter(
                            (l) => l.remainingQuantity > 0,
                          )"
                          :key="l.id"
                          :value="l.id"
                        >
                          {{ l.productName }}（待交 {{ l.remainingQuantity }}）
                        </option>
                      </select>
                    </div>
                    <div class="field">
                      <label for="preorder-deliver-location">實際出貨庫位</label
                      ><select
                        id="preorder-deliver-location"
                        v-model="deliver.locationId"
                        required
                      >
                        <option value="">請選一般庫位</option>
                        <option
                          v-for="l in locations"
                          :value="l.id"
                          :key="l.id"
                        >
                          {{ l.name }}
                        </option>
                      </select>
                    </div>
                    <div class="field">
                      <label for="preorder-deliver-quantity">本次交付數量</label
                      ><input
                        id="preorder-deliver-quantity"
                        v-model.number="deliver.quantity"
                        type="number"
                        min="1"
                        step="1"
                        required
                      />
                    </div>
                  </div>
                  <PhysicalUnitPicker
                    :snapshot="catalog.snapshot"
                    :product-id="deliveryLine?.productId || ''"
                    :location-id="deliver.locationId"
                    v-model="deliver.unitIds"
                    label="本次預售交付的特殊單件"
                  />
                  <div class="field">
                    <label for="preorder-deliver-reason">實際交付說明</label
                    ><input
                      id="preorder-deliver-reason"
                      v-model="deliver.reason"
                      maxlength="2000"
                      required
                    />
                  </div>
                  <p>
                    本次交付價值：{{
                      deliveryLine
                        ? deliveryLine.unitPrice * deliver.quantity
                        : 0
                    }}
                    元。若尚未足額支付累計交付價值，可先記實收款，或明確確認欠款交付；未預留的可用庫存及特殊單件會在提交時重新驗證。
                  </p>
                  <label class="check-option"
                    ><input
                      v-model="deliveryConfirmed"
                      type="checkbox"
                    />我確認本次商品已實際交付顧客</label
                  >
                </fieldset>
                <label v-if="deliveryNeedsCredit" class="check-option"
                  ><input
                    v-model="allowUnpaidDelivery"
                    type="checkbox"
                    :disabled="catalog.busy"
                  />我確認即使尚未足額收款，仍已實際交付，並保留未收款差額。</label
                >
                <button
                  class="button primary"
                  :disabled="catalog.busy || !deliveryConfirmed"
                >
                  保存實際交付並扣庫
                </button>
              </form>
            </details>
            <details>
              <summary>取消尚未交付品項</summary>
              <form @submit.prevent="cancel">
                <fieldset :disabled="catalog.busy">
                  <div class="form-grid">
                    <div class="field">
                      <label for="preorder-cancel-line">取消訂單品項</label
                      ><select
                        id="preorder-cancel-line"
                        v-model="cancellation.orderLineId"
                        required
                      >
                        <option value="">請選未交付品項</option>
                        <option
                          v-for="l in summary.lines.filter(
                            (l) => l.remainingQuantity > 0,
                          )"
                          :value="l.id"
                          :key="l.id"
                        >
                          {{ l.productName }}（待交 {{ l.remainingQuantity }}）
                        </option>
                      </select>
                    </div>
                    <div class="field">
                      <label for="preorder-cancel-quantity">本次取消數量</label
                      ><input
                        id="preorder-cancel-quantity"
                        v-model.number="cancellation.quantity"
                        type="number"
                        min="1"
                        step="1"
                        required
                      />
                    </div>
                  </div>
                  <div class="field">
                    <label for="preorder-cancel-reason">取消原因</label
                    ><input
                      id="preorder-cancel-reason"
                      v-model="cancellation.reason"
                      maxlength="2000"
                      required
                    />
                  </div>
                  <p>
                    取消不自動退款，也不增加庫存。若有多收款，請實際退款後另記款項；不預設訂金沒收。
                  </p>
                </fieldset>
                <button class="button secondary" :disabled="catalog.busy">
                  確認取消未交付數量
                </button>
              </form>
            </details>
            <details>
              <summary>已交付商品退貨</summary>
              <form @submit.prevent="returnGoods">
                <fieldset :disabled="catalog.busy">
                  <div class="field">
                    <label for="preorder-return-line">原交付明細</label
                    ><select
                      id="preorder-return-line"
                      v-model="returned.saleLineId"
                      required
                    >
                      <option value="">請選原明細</option>
                      <optgroup
                        v-for="s in deliverySales"
                        :key="s.id"
                        :label="s.code"
                      >
                        <option v-for="l in s.lines" :key="l.id" :value="l.id">
                          {{ l.productName }} · {{ l.quantity }} 件
                        </option>
                      </optgroup>
                    </select>
                  </div>
                  <template v-if="returnSource"
                    ><p>
                      原單價 {{ returnSource.line.unitPrice }} 元；已可售退回
                      {{ returnPrior?.restockQuantity || 0 }} 件，已不可售退回
                      {{ returnPrior?.damagedQuantity || 0 }} 件。
                    </p>
                    <PhysicalUnitReturnPicker
                      v-if="returnSource.line.unitIds?.length"
                      :snapshot="catalog.snapshot"
                      :sale-line-id="returned.saleLineId"
                      v-model:restock-unit-ids="returned.restockUnitIds"
                      v-model:damaged-unit-ids="returned.damagedUnitIds"
                    />
                    <div class="form-grid">
                      <div class="field">
                        <label for="preorder-return-restock">可售退回數量</label
                        ><input
                          id="preorder-return-restock"
                          v-model.number="returned.restockQuantity"
                          type="number"
                          min="0"
                          step="1"
                          :readonly="!!returnSource.line.unitIds?.length"
                        />
                      </div>
                      <div class="field">
                        <label for="preorder-return-damage"
                          >不可售退回數量</label
                        ><input
                          id="preorder-return-damage"
                          v-model.number="returned.damagedQuantity"
                          type="number"
                          min="0"
                          step="1"
                          :readonly="!!returnSource.line.unitIds?.length"
                        />
                      </div>
                      <div class="field">
                        <label for="preorder-return-location"
                          >可售退回庫位</label
                        ><select
                          id="preorder-return-location"
                          v-model="returned.returnLocationId"
                          :required="returned.restockQuantity > 0"
                        >
                          <option value="">未回可售庫存</option>
                          <option
                            v-for="l in locations"
                            :key="l.id"
                            :value="l.id"
                          >
                            {{ l.name }}
                          </option>
                        </select>
                      </div>
                    </div>
                    <p>
                      本次交付抵減
                      {{ returnedCredit }}
                      元，不代表已退錢。實際退款請在上方另行登記。
                    </p></template
                  >
                  <div class="field">
                    <label for="preorder-return-reason">實物退貨原因</label
                    ><input
                      id="preorder-return-reason"
                      v-model="returned.reason"
                      maxlength="2000"
                      required
                    />
                  </div>
                  <label class="check-option"
                    ><input
                      v-model="returnConfirmed"
                      type="checkbox"
                    />我確認所填商品已退回，並核對可售／不可售狀態</label
                  >
                </fieldset>
                <button
                  class="button primary"
                  :disabled="catalog.busy || !returnConfirmed"
                >
                  保存退貨與交付抵減
                </button>
              </form>
            </details></template
          >
          <details>
            <summary>交付與取消歷史</summary>
            <ul class="history">
              <li v-for="f in current.fulfillments" :key="f.id">
                {{ when(f.createdAt) }} ·
                {{
                  catalog.snapshot.sales.find((s) => s.id === f.saleId)?.code
                }}
                <p v-for="l in f.lines" :key="l.saleLineId">
                  {{
                    current.lines.find((x) => x.id === l.orderLineId)
                      ?.productName
                  }}
                  × {{ l.quantity }}
                </p>
              </li>
              <li v-for="c in current.cancellations" :key="c.id">
                {{ when(c.createdAt) }} · 取消：{{ c.reason }}
                <p v-for="l in c.lines" :key="l.orderLineId">
                  {{
                    current.lines.find((x) => x.id === l.orderLineId)
                      ?.productName
                  }}
                  × {{ l.quantity }}
                </p>
              </li>
            </ul>
          </details>
          <form @submit.prevent="changeStatus">
            <div class="field">
              <label for="preorder-status-reason">結束／重新開啟原因</label
              ><input
                id="preorder-status-reason"
                v-model="statusReason"
                maxlength="2000"
                required
              />
            </div>
            <p>
              結束作業不表示款項已付清或所有商品已交付。保留未交付與待查金額，必要時可明確重新開啟。
            </p>
            <button
              class="button secondary"
              :disabled="catalog.busy || !statusReason.trim()"
            >
              {{ current.closedAt ? "重新開啟預售單" : "結束預售單" }}
            </button>
          </form>
        </template>
        <p v-else>目前沒有選取預售單，可先建立訂單；尚未到貨也能建單。</p>
      </section>
    </template></template
  >
</template>
<style scoped>
@import "./business.css";
.workspace-picker {
  max-width: 440px;
  margin-bottom: 20px;
}
.section-block {
  margin-top: 24px;
}
.business-panel {
  overflow-wrap: anywhere;
}
.line-box {
  border: 1px solid #d5dfd0;
  padding: 14px;
  border-radius: 8px;
  margin: 12px 0;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin: 18px 0;
}
.summary-grid div {
  padding: 12px;
  border: 1px solid #d6e1cf;
  border-radius: 8px;
}
.summary-grid dt {
  font-size: 14px;
  color: #58674f;
}
.summary-grid dd {
  margin: 8px 0 0;
  font-size: 18px;
  font-weight: 600;
}
.history {
  padding-left: 22px;
  line-height: 1.9;
}
.history li {
  margin: 14px 0;
}
.table-scroll {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  min-width: 520px;
}
th,
td {
  border: 1px solid #c8d6c2;
  padding: 10px;
  text-align: left;
}
caption {
  text-align: left;
  padding: 10px 0;
}
details {
  margin: 20px 0;
  border-top: 1px solid #d6dfd1;
  padding-top: 12px;
}
summary {
  cursor: pointer;
  min-height: 44px;
  font-weight: 600;
}
fieldset {
  min-width: 0;
}
select,
input,
textarea {
  max-width: 100%;
}
form > .button {
  margin-top: 14px;
}
</style>
