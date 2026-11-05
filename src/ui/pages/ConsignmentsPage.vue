<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
import { balance } from "../../domain/inventory/operations";
import { consignmentSummary } from "../../domain/consignment/operations";
import PhysicalUnitPicker from "../components/PhysicalUnitPicker.vue";
import SaleRefundPanel from "../components/SaleRefundPanel.vue";
const workspaces = useWorkspaceStore(),
  catalog = useCatalogStore();
const selected = ref(""),
  notice = ref(""),
  error = ref("");
const create = reactive({ name: "", storePartyId: "", notes: "" });
const delivery = reactive({
  productId: "",
  sourceLocationId: "",
  quantity: 1,
  unitIds: [] as string[],
  reason: "",
});
const sale = reactive({
  productId: "",
  quantity: 1,
  unitPrice: null as number | null,
  unitIds: [] as string[],
  soldAt: "",
  reason: "",
});
const returned = reactive({
  productId: "",
  quantity: 1,
  toLocationId: "",
  unitIds: [] as string[],
  reason: "",
});
const statement = reactive({
  fee: null as number | null,
  adjustment: null as number | null,
  reason: "",
});
const payment = reactive({ amount: 1, receivedAt: "", reason: "" });
const statusReason = ref(""),
  reverseReason = ref(""),
  saleOperation = ref(crypto.randomUUID()),
  deliveryOperation = ref(crypto.randomUUID()),
  returnOperation = ref(crypto.randomUUID()),
  remittanceOperation = ref(crypto.randomUUID());
const current = computed(() =>
  catalog.snapshot?.consignments.find((c) => c.id === selected.value),
);
const reportedSales = computed(() =>
  catalog.snapshot && current.value
    ? catalog.snapshot.sales
        .filter((r) => current.value!.saleIds.includes(r.id))
        .slice()
        .reverse()
    : [],
);
const summary = computed(() =>
  catalog.snapshot && current.value
    ? consignmentSummary(catalog.snapshot, current.value)
    : null,
);
const ordinaryLocations = computed(
  () =>
    catalog.snapshot?.locations.filter(
      (l) =>
        !catalog.snapshot?.consignments.some((c) => c.locationId === l.id) &&
        !catalog.snapshot?.activityHandoffs.some((h) => h.locationId === l.id),
    ) || [],
);
const stock = computed(() =>
  catalog.snapshot && current.value
    ? catalog.snapshot.products
        .map((p) => ({
          product: p,
          quantity: balance(catalog.snapshot!, p.id, current.value!.locationId),
        }))
        .filter((r) => r.quantity)
    : [],
);
const when = (at: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(at));
function taipeiNow() {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return p.replace(" ", "T");
}
function instant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("請填寫完整的台灣日期與時間。");
  return new Date(value + ":00+08:00").toISOString();
}
async function run(action: () => Promise<unknown>, message: string) {
  if (catalog.busy) return;
  error.value = "";
  notice.value = "";
  try {
    await action();
    notice.value = message;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作未完成，請重新確認。";
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
  () => catalog.snapshot?.consignments,
  (rows) => {
    if (rows?.length && !rows.some((c) => c.id === selected.value))
      selected.value = rows[0]!.id;
  },
);
watch(
  () => selected.value,
  () => {
    delivery.unitIds = [];
    sale.unitIds = [];
    returned.unitIds = [];
    statement.fee = null;
    statement.adjustment = null;
    statement.reason = "";
    statusReason.value = "";
  },
);
sale.soldAt = taipeiNow();
payment.receivedAt = taipeiNow();
async function save() {
  await run(async () => {
    await catalog.saveConsignment({ ...create });
    create.name = "";
    create.notes = "";
  }, "寄賣單已建立，尚未交付商品或收款。");
}
async function deliver() {
  await run(async () => {
    await catalog.deliverConsignment(selected.value, {
      ...delivery,
      operationId: deliveryOperation.value,
      unitIds: [...delivery.unitIds],
    });
    deliveryOperation.value = crypto.randomUUID();
    delivery.unitIds = [];
    delivery.reason = "";
  }, "寄賣商品已交付；工作區總庫存不變。");
}
async function reportSale() {
  await run(async () => {
    if (sale.unitPrice === null)
      throw new Error("請填寫實際售出單價，免費請明確填 0。");
    await catalog.reportConsignmentSale(selected.value, {
      ...sale,
      unitPrice: sale.unitPrice,
      unitIds: [...sale.unitIds],
      soldAt: instant(sale.soldAt),
      operationId: saleOperation.value,
    });
    saleOperation.value = crypto.randomUUID();
    sale.unitIds = [];
    sale.reason = "";
  }, "寄賣銷售回報已保存。店家代收不代表你已收到匯款。");
}
async function returnStock() {
  await run(async () => {
    await catalog.returnConsignmentStock(selected.value, {
      ...returned,
      operationId: returnOperation.value,
      unitIds: [...returned.unitIds],
    });
    returnOperation.value = crypto.randomUUID();
    returned.unitIds = [];
    returned.reason = "";
  }, "剩餘商品已記錄實物收回。");
}
async function receivePayment() {
  await run(async () => {
    await catalog.recordConsignmentRemittance(selected.value, {
      ...payment,
      operationId: remittanceOperation.value,
      receivedAt: instant(payment.receivedAt),
    });
    remittanceOperation.value = crypto.randomUUID();
    payment.reason = "";
  }, "實際匯款已記錄，不會新增營收。");
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">CONSIGNMENT RECORDS</div>
      <h1>寄賣與對帳</h1>
      <p>分開記錄商品交付、店家銷售回報與你實際收到的款項。</p>
    </div>
  </section>
  <section v-if="!workspaces.activeWorkspaceId" class="info-banner">
    <div>
      <h2>先建立工作區</h2>
      <p>寄賣資料會保存在目前裝置的工作區。</p>
      <RouterLink class="button primary" to="/">前往工作區總覽</RouterLink>
    </div>
  </section>
  <template v-else>
    <div class="field workspace-picker">
      <label for="consignment-workspace">目前工作區</label
      ><select
        id="consignment-workspace"
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
    </p>
    <p class="info-banner">
      寄賣交付只移動實物位置。銷售回報表示店家已售出，並不代表創作者已收款；佣金／費用需要明確填寫，未知不當作零。網站不會實際轉帳或連接店家系統。
    </p>
    <template v-if="catalog.snapshot">
      <section class="business-panel">
        <h2>建立寄賣單</h2>
        <form @submit.prevent="save">
          <fieldset :disabled="catalog.busy">
            <div class="form-grid">
              <div class="field">
                <label for="consignment-name">寄賣單名稱</label
                ><input
                  id="consignment-name"
                  v-model="create.name"
                  required
                  maxlength="80"
                  placeholder="例如：星空書店長期寄賣"
                />
              </div>
              <div class="field">
                <label for="consignment-party">寄賣店家／合作對象</label
                ><select
                  id="consignment-party"
                  v-model="create.storePartyId"
                  required
                >
                  <option value="">請選擇</option>
                  <option
                    v-for="p in catalog.snapshot.parties.filter(
                      (p) => !p.archived,
                    )"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option></select
                ><small>可先在「創作者與柄圖」建立店家參與方。</small>
              </div>
            </div>
            <div class="field">
              <label for="consignment-notes">寄賣說明</label
              ><textarea
                id="consignment-notes"
                v-model="create.notes"
                maxlength="2000"
                rows="2"
              ></textarea>
            </div>
            <button
              class="button primary"
              :disabled="!create.name.trim() || !create.storePartyId"
            >
              建立寄賣單
            </button>
          </fieldset>
        </form>
      </section>
      <div v-if="catalog.snapshot.consignments.length" class="field">
        <label for="consignment-current">目前寄賣單</label
        ><select
          id="consignment-current"
          v-model="selected"
          :disabled="catalog.busy"
        >
          <option
            v-for="c in catalog.snapshot.consignments"
            :key="c.id"
            :value="c.id"
          >
            {{ c.name }}{{ c.closedAt ? "（已結束）" : "" }}
          </option>
        </select>
      </div>
      <template v-if="current && summary">
        <section class="business-panel">
          <h2>{{ current.name }}</h2>
          <p>
            合作對象：{{
              catalog.snapshot.parties.find(
                (p) => p.id === current!.storePartyId,
              )?.name
            }}
            · {{ current.closedAt ? "已結束" : "進行中" }}
          </p>
          <p>{{ current.notes }}</p>
          <dl class="report-grid">
            <div>
              <dt>店家銷售總額</dt>
              <dd>{{ summary.gross }} 元</dd>
            </div>
            <div>
              <dt>退款／調整前淨銷售</dt>
              <dd>{{ summary.netSales }} 元</dd>
            </div>
            <div>
              <dt>明確費用</dt>
              <dd>{{ summary.fee === null ? "未知" : summary.fee + " 元" }}</dd>
            </div>
            <div>
              <dt>明確其他調整</dt>
              <dd>
                {{
                  summary.adjustment === null
                    ? "未知"
                    : summary.adjustment + " 元"
                }}
              </dd>
            </div>
            <div>
              <dt>本單應匯款試算</dt>
              <dd>
                {{
                  summary.expected === null
                    ? "尚無法試算"
                    : summary.expected + " 元"
                }}
              </dd>
            </div>
            <div>
              <dt>實際已收匯款</dt>
              <dd>{{ summary.received }} 元</dd>
            </div>
            <div>
              <dt>待核對差額</dt>
              <dd>
                {{
                  summary.balance === null
                    ? "尚無法試算"
                    : summary.balance + " 元"
                }}
              </dd>
            </div>
          </dl>
          <small
            >差額不會自動產生代墊、欠款或可分配利潤。費用以人工明確金額記錄，不自動假設抽成比例。</small
          >
        </section>
        <section class="business-panel">
          <h2>店家現存庫存</h2>
          <p v-if="!stock.length">目前沒有寄賣庫存。</p>
          <div class="table-scroll" v-else>
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th>帳面現存</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in stock" :key="r.product.id">
                  <td>{{ r.product.name }}</td>
                  <td>{{ r.quantity }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <template v-if="!current.closedAt">
          <section class="business-panel">
            <h2>交付寄賣商品</h2>
            <form @submit.prevent="deliver">
              <fieldset :disabled="catalog.busy">
                <div class="form-grid">
                  <div class="field">
                    <label for="delivery-product">交付商品</label
                    ><select
                      id="delivery-product"
                      v-model="delivery.productId"
                      required
                    >
                      <option value="">請選擇</option>
                      <option
                        v-for="p in catalog.snapshot.products.filter(
                          (p) => !p.archived,
                        )"
                        :key="p.id"
                        :value="p.id"
                      >
                        {{ p.name }}
                      </option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="delivery-location">交付來源庫位</label
                    ><select
                      id="delivery-location"
                      v-model="delivery.sourceLocationId"
                      required
                    >
                      <option value="">請選擇</option>
                      <option
                        v-for="l in ordinaryLocations"
                        :key="l.id"
                        :value="l.id"
                      >
                        {{ l.name }}
                      </option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="delivery-quantity">交付數量</label
                    ><input
                      id="delivery-quantity"
                      v-model.number="delivery.quantity"
                      type="number"
                      min="1"
                      step="1"
                      required
                    />
                  </div>
                </div>
                <PhysicalUnitPicker
                  v-model="delivery.unitIds"
                  :snapshot="catalog.snapshot"
                  :product-id="delivery.productId"
                  :location-id="delivery.sourceLocationId"
                  label="本次交付寄賣的特殊單件"
                />
                <div class="field">
                  <label for="delivery-reason">交付原因／憑據</label
                  ><input
                    id="delivery-reason"
                    v-model="delivery.reason"
                    required
                    maxlength="2000"
                  />
                </div>
                <button class="button primary">確認實物已交付</button>
              </fieldset>
            </form>
          </section>
          <section class="business-panel">
            <h2>登記店家銷售回報</h2>
            <p>
              只登記已確認的實際售出商品與售價。銷售時間採台灣時間，不以回報時間假裝成交時間。
            </p>
            <form @submit.prevent="reportSale">
              <fieldset :disabled="catalog.busy">
                <div class="form-grid">
                  <div class="field">
                    <label for="consignment-sale-product">回報售出商品</label
                    ><select
                      id="consignment-sale-product"
                      v-model="sale.productId"
                      required
                    >
                      <option value="">請選擇</option>
                      <option
                        v-for="r in stock"
                        :key="r.product.id"
                        :value="r.product.id"
                      >
                        {{ r.product.name }}（{{ r.quantity }}）
                      </option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="consignment-sale-quantity">回報售出數量</label
                    ><input
                      id="consignment-sale-quantity"
                      v-model.number="sale.quantity"
                      type="number"
                      min="1"
                      step="1"
                      required
                    />
                  </div>
                  <div class="field">
                    <label for="consignment-sale-price"
                      >實際售出單價（元）</label
                    ><input
                      id="consignment-sale-price"
                      v-model.number="sale.unitPrice"
                      type="number"
                      min="0"
                      step="1"
                      required
                    />
                  </div>
                  <div class="field">
                    <label for="consignment-sale-time"
                      >實際銷售時間（台灣時間）</label
                    ><input
                      id="consignment-sale-time"
                      v-model="sale.soldAt"
                      type="datetime-local"
                      required
                    />
                  </div>
                </div>
                <PhysicalUnitPicker
                  v-model="sale.unitIds"
                  :snapshot="catalog.snapshot"
                  :product-id="sale.productId"
                  :location-id="current.locationId"
                  label="本次店家售出的特殊單件"
                />
                <div class="field">
                  <label for="consignment-sale-reason">銷售回報來源／說明</label
                  ><input
                    id="consignment-sale-reason"
                    v-model="sale.reason"
                    required
                    maxlength="2000"
                  />
                </div>
                <button class="button primary">確認銷售回報並扣庫</button>
              </fieldset>
            </form>
          </section>
          <section class="business-panel">
            <h2>收回剩餘實物</h2>
            <p>只有實物已交還時才記錄。結束寄賣或收到匯款不會自動收回庫存。</p>
            <form @submit.prevent="returnStock">
              <fieldset :disabled="catalog.busy">
                <div class="form-grid">
                  <div class="field">
                    <label for="consignment-return-product">收回商品</label
                    ><select
                      id="consignment-return-product"
                      v-model="returned.productId"
                      required
                    >
                      <option value="">請選擇</option>
                      <option
                        v-for="r in stock"
                        :key="r.product.id"
                        :value="r.product.id"
                      >
                        {{ r.product.name }}（{{ r.quantity }}）
                      </option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="consignment-return-location">收回目的庫位</label
                    ><select
                      id="consignment-return-location"
                      v-model="returned.toLocationId"
                      required
                    >
                      <option value="">請選擇</option>
                      <option
                        v-for="l in ordinaryLocations"
                        :key="l.id"
                        :value="l.id"
                      >
                        {{ l.name }}
                      </option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="consignment-return-quantity">實際收回數量</label
                    ><input
                      id="consignment-return-quantity"
                      v-model.number="returned.quantity"
                      type="number"
                      min="1"
                      step="1"
                      required
                    />
                  </div>
                </div>
                <PhysicalUnitPicker
                  v-model="returned.unitIds"
                  :snapshot="catalog.snapshot"
                  :product-id="returned.productId"
                  :location-id="current.locationId"
                  label="本次收回的特殊單件"
                />
                <div class="field">
                  <label for="consignment-return-reason">實物收回說明</label
                  ><input
                    id="consignment-return-reason"
                    v-model="returned.reason"
                    required
                    maxlength="2000"
                  />
                </div>
                <button class="button primary">確認實物已收回</button>
              </fieldset>
            </form>
          </section>
          <section class="business-panel">
            <h2>人工對帳金額</h2>
            <p>
              空白表示未知；無費用或無調整請明確填
              0。正調整增加應匯額，負調整減少應匯額。每次保存為新的累計約定，歷史保留。
            </p>
            <form
              @submit.prevent="
                run(
                  () =>
                    catalog.setConsignmentStatement(selected, {
                      ...statement,
                      fee:
                        typeof statement.fee === 'number'
                          ? statement.fee
                          : null,
                      adjustment:
                        typeof statement.adjustment === 'number'
                          ? statement.adjustment
                          : null,
                    }),
                  '對帳金額已保存，未產生實際收款。',
                )
              "
            >
              <fieldset :disabled="catalog.busy">
                <div class="form-grid">
                  <div class="field">
                    <label for="consignment-fee"
                      >累計店家費用（元，可留白）</label
                    ><input
                      id="consignment-fee"
                      v-model.number="statement.fee"
                      type="number"
                      min="0"
                      step="1"
                    />
                  </div>
                  <div class="field">
                    <label for="consignment-adjustment"
                      >累計其他調整（元，可正負或留白）</label
                    ><input
                      id="consignment-adjustment"
                      v-model.number="statement.adjustment"
                      type="number"
                      step="1"
                    />
                  </div>
                </div>
                <div class="field">
                  <label for="consignment-statement-reason"
                    >對帳依據／變更原因</label
                  ><input
                    id="consignment-statement-reason"
                    v-model="statement.reason"
                    required
                    maxlength="2000"
                  />
                </div>
                <button class="button primary">保存對帳版本</button>
              </fieldset>
            </form>
          </section>
        </template>
        <section class="business-panel">
          <h2>實際收到店家匯款</h2>
          <p>
            請只登記確實收妥的金額，可以分次。這是款項回收，不是新增商品營收。
          </p>
          <form @submit.prevent="receivePayment">
            <fieldset :disabled="catalog.busy">
              <div class="form-grid">
                <div class="field">
                  <label for="consignment-payment-amount"
                    >本次實收金額（元）</label
                  ><input
                    id="consignment-payment-amount"
                    v-model.number="payment.amount"
                    type="number"
                    min="1"
                    step="1"
                    required
                  />
                </div>
                <div class="field">
                  <label for="consignment-payment-time"
                    >實收時間（台灣時間）</label
                  ><input
                    id="consignment-payment-time"
                    v-model="payment.receivedAt"
                    type="datetime-local"
                    required
                  />
                </div>
              </div>
              <div class="field">
                <label for="consignment-payment-reason">實收說明／憑據</label
                ><input
                  id="consignment-payment-reason"
                  v-model="payment.reason"
                  required
                  maxlength="2000"
                />
              </div>
              <button class="button primary">確認已實際收款</button>
            </fieldset>
          </form>
        </section>
        <section
          class="business-panel"
          aria-labelledby="consignment-history-title"
        >
          <h2 id="consignment-history-title">店家銷售與退款紀錄</h2>
          <p>
            以下是店家回報的顧客銷售／退款；不得再當成創作者收到匯款重複記錄。更正使用有來源的退款／退貨，不刪除原紀錄。
          </p>
          <p v-if="!reportedSales.length">尚無店家銷售回報。</p>
          <article v-for="r in reportedSales" :key="r.id" class="history-card">
            <h3>{{ r.code }} · {{ when(r.createdAt) }}</h3>
            <p v-for="l in r.lines" :key="l.id">
              {{ l.productName }} × {{ l.quantity }}，單價 {{ l.unitPrice }} 元
            </p>
            <p>回報金額：{{ r.total }} 元；來源：{{ r.notes }}</p>
            <SaleRefundPanel
              v-if="!current.closedAt"
              :sale="r"
              @recorded="
                notice = '店家退款／退貨回報已保存；不代表創作者現金支出。'
              "
            />
          </article>
        </section>
        <section class="business-panel">
          <h2>對帳版本紀錄</h2>
          <p v-if="!current.statements.length">
            尚未指定對帳費用及調整，應匯款保持未知。
          </p>
          <article
            v-for="r in [...current.statements].reverse()"
            :key="r.id"
            class="history-card"
          >
            <p>
              {{ when(r.createdAt) }} · 費用
              {{ r.fee === null ? "未知" : r.fee + " 元" }}；其他調整
              {{ r.adjustment === null ? "未知" : r.adjustment + " 元" }}
            </p>
            <p>{{ r.reason }}</p>
          </article>
        </section>
        <section class="business-panel">
          <h2>實際匯款及更正紀錄</h2>
          <p v-if="!current.remittances.length">尚無實際匯款紀錄。</p>
          <div
            class="field"
            v-if="
              current.remittances.some(
                (r) =>
                  !r.reversesId &&
                  !current!.remittances.some((a) => a.reversesId === r.id),
              )
            "
          >
            <label for="consignment-reverse-reason">匯款沖銷原因</label
            ><input
              id="consignment-reverse-reason"
              v-model="reverseReason"
              maxlength="2000"
              placeholder="登記錯誤時填寫原因，另留沖銷歷史"
            />
          </div>
          <article
            v-for="r in [...current.remittances].reverse()"
            :key="r.id"
            class="history-card"
          >
            <p>
              {{ when(r.receivedAt) }} ·
              {{ r.reversesId ? "沖銷" : "實際收款" }} {{ r.amount }} 元
            </p>
            <p>{{ r.reason }}</p>
            <button
              v-if="
                !r.reversesId &&
                !current.remittances.some((a) => a.reversesId === r.id)
              "
              class="button secondary"
              :disabled="catalog.busy || !reverseReason.trim()"
              @click="
                run(
                  () =>
                    catalog.reverseConsignmentRemittance(
                      selected,
                      r.id,
                      reverseReason,
                    ),
                  '已另存匯款沖銷，原紀錄保留。',
                )
              "
            >
              沖銷這筆登記</button
            ><small v-else-if="!r.reversesId">已沖銷，原紀錄保留</small>
          </article>
        </section>
        <section class="business-panel">
          <h2>寄賣狀態</h2>
          <p>
            可在未收回商品、未知費用或款項未清時結束；不刪除紀錄，也不自動調整庫存或款項。
          </p>
          <div class="field">
            <label for="consignment-status-reason">結束／重新開啟原因</label
            ><input
              id="consignment-status-reason"
              v-model="statusReason"
              maxlength="2000"
            />
          </div>
          <button
            v-if="!current.closedAt"
            class="button secondary"
            :disabled="catalog.busy || !statusReason.trim()"
            @click="
              run(
                () => catalog.closeConsignment(selected, statusReason),
                '寄賣單已結束，庫存及未清款仍保留。',
              )
            "
          >
            確認結束寄賣單</button
          ><button
            v-else
            class="button secondary"
            :disabled="catalog.busy || !statusReason.trim()"
            @click="
              run(
                () => catalog.reopenConsignment(selected, statusReason),
                '寄賣單已重新開啟，原歷史保留。',
              )
            "
          >
            重新開啟寄賣單
          </button>
        </section>
      </template>
    </template>
  </template>
</template>
<style scoped>
@import "./business.css";
.history-card {
  border-top: 1px solid var(--line);
  padding: 14px 0;
}
.history-card p {
  margin: 6px 0;
}
.table-scroll {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  border: 1px solid var(--line);
  padding: 10px;
}
dd {
  margin: 6px 0 0;
}
dt {
  font-size: 14px;
}
h2 {
  margin-bottom: 12px;
}
input,
select,
textarea {
  max-width: 100%;
}
.business-panel {
  min-width: 0;
}
button {
  white-space: normal;
}
@media (min-width: 760px) {
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
