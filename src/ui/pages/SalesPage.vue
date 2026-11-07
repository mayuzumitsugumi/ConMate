<script setup lang="ts">
import BarcodePicker from "../components/BarcodePicker.vue";
import { salesDraftRepository } from "../../application/sales-drafts";
import type { SalesDraft } from "../../application/sales-drafts";
import { onBeforeRouteLeave } from "vue-router";
import PhysicalUnitPicker from "../components/PhysicalUnitPicker.vue";
import SaleRefundPanel from "../components/SaleRefundPanel.vue";
import ExchangePanel from "../components/ExchangePanel.vue";
import { saleNetRevenue } from "../../domain/sales/refunds";
import type { ExchangeInput, RefundRecord } from "../../domain/models/catalog";
import ReservationPanel from "../components/ReservationPanel.vue";
import { availableQuantity } from "../../domain/inventory/reservations";
import { balance } from "../../domain/inventory/operations";
import SalePlansPanel from "../components/SalePlansPanel.vue";
import { computed, reactive, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
import { saleTotal } from "../../domain/sales/operations";
import type { SaleInput, SaleLineInput } from "../../domain/models/catalog";
const workspaces = useWorkspaceStore(),
  catalog = useCatalogStore();
const notice = ref(""),
  error = ref(""),
  search = ref(""),
  confirming = ref(false);
const replacesRefundId = ref("");
async function submitExchange(input: ExchangeInput) {
  if (cart.value.length) throw new Error("請先完成或清空購物車，再記錄換購。");
  await catalog.exchangeSale(input);
}
function startReplacement(refund: RefundRecord) {
  if (cart.value.length) {
    error.value = "請先完成或清空購物車，再建立換貨交易。";
    return;
  }
  replacesRefundId.value = refund.id;
  context.notes = `換貨來源 ${refund.code}`;
  notice.value =
    "已連結退款紀錄。請選擇新交付商品，並獨立填寫本筆實際應收與收款；系統不會自動抵扣退款。";
  document.getElementById("sales-plan")?.focus();
}
const selectedPlanId = ref("");
const availablePlans = computed(
  () =>
    catalog.snapshot?.salePlans.filter(
      (p) =>
        !p.archived &&
        (!p.eventIds.length || p.eventIds.includes(context.eventId)),
    ) || [],
);
const selectedPlan = computed(() =>
  availablePlans.value.find((p) => p.id === selectedPlanId.value),
);
const draftReady = ref(false);
const draftNotice = ref("");
let draftRequest = 0;
let lastDraftSave: Promise<unknown> = Promise.resolve();
const operationId = ref<string>(crypto.randomUUID());
const context = reactive({
  locationId: "",
  eventId: "",
  collectorId: "",
  notes: "",
  cashReceived: null as number | null,
});
const cart = ref<
  (Omit<SaleLineInput, "unitPrice"> & {
    key: string;
    productName: string;
    unitPrice: number | null;
  })[]
>([]);
const cancelId = ref(""),
  cancelReason = ref(""),
  refundConfirmed = ref(false);
const products = computed(
  () =>
    catalog.snapshot?.products.filter(
      (p) =>
        !p.archived &&
        (!selectedPlan.value || selectedPlan.value.productIds.includes(p.id)) &&
        (!search.value ||
          p.name.includes(search.value) ||
          p.code === search.value),
    ) || [],
);
const recent = computed(() => [...(catalog.snapshot?.sales || [])].reverse());
const total = computed(() => {
  try {
    if (
      !cart.value.length ||
      cart.value.some(
        (l) => l.unitPrice === null || l.unitPrice === ("" as unknown),
      )
    )
      return null;
    return saleTotal(cart.value as SaleLineInput[]);
  } catch {
    return null;
  }
});
const change = computed(() =>
  total.value === null ||
  context.cashReceived === null ||
  !Number.isSafeInteger(context.cashReceived) ||
  context.cashReceived < total.value
    ? null
    : context.cashReceived - total.value,
);
const netRevenue = computed(() =>
  (catalog.snapshot?.sales || [])
    .filter((s) => !s.cancelledAt)
    .reduce((sum, s) => sum + BigInt(saleNetRevenue(catalog.snapshot!, s)), 0n)
    .toString(),
);
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    const request = ++draftRequest;
    draftReady.value = false;
    draftNotice.value = "";
    cart.value = [];
    replacesRefundId.value = "";
    selectedPlanId.value = "";
    confirming.value = false;
    cancelId.value = "";
    notice.value = "";
    error.value = "";
    Object.assign(context, {
      locationId: "",
      eventId: "",
      collectorId: "",
      notes: "",
      cashReceived: null,
    });
    operationId.value = crypto.randomUUID();
    if (id) {
      await catalog.load(id);
      if (request !== draftRequest || !catalog.snapshot) return;
      try {
        const draft = await salesDraftRepository.read(catalog.snapshot);
        if (request !== draftRequest) return;
        if (draft) {
          Object.assign(context, draft.context);
          cart.value = draft.cart;
          operationId.value = draft.operationId;
          selectedPlanId.value = draft.selectedPlanId;
          replacesRefundId.value = draft.replacesRefundId;
          if (draft.cart.length)
            draftNotice.value =
              "已恢復這台裝置的未成交購物車，請重新核對庫存、方案及收款。草稿不算銷售，也不保留庫存。";
        }
      } catch (e) {
        if (request === draftRequest)
          draftNotice.value =
            e instanceof Error ? e.message : "無法恢復購物車草稿。";
      }
      if (request === draftRequest) draftReady.value = true;
    }
  },
  { immediate: true },
);
function persistDraft() {
  if (!draftReady.value || !workspaces.activeWorkspaceId) return;
  const id = workspaces.activeWorkspaceId;
  try {
    const draft: SalesDraft = JSON.parse(
      JSON.stringify({
        version: 1,
        workspaceId: id,
        operationId: operationId.value,
        selectedPlanId: selectedPlanId.value,
        replacesRefundId: replacesRefundId.value,
        context,
        cart: cart.value,
      }),
    );
    lastDraftSave = salesDraftRepository.save(draft).catch(() => {
      if (workspaces.activeWorkspaceId === id)
        draftNotice.value =
          "購物車草稿未能保存，離開前請先完成交易或稍後重試。";
    });
  } catch {
    draftNotice.value = "草稿含無法保存的輸入，請檢查數量及金額。";
  }
}
watch(
  [context, cart, operationId, selectedPlanId, replacesRefundId],
  persistDraft,
  { deep: true, flush: "post" },
);
onBeforeRouteLeave(async () => {
  persistDraft();
  await lastDraftSave;
});
function clearCart() {
  cart.value = [];
  replacesRefundId.value = "";
  confirming.value = false;
  context.cashReceived = null;
  operationId.value = crypto.randomUUID();
}
function add(productId: string, mode: "direct" | "draw") {
  const p = catalog.snapshot?.products.find((p) => p.id === productId);
  if (!p || catalog.busy) return;
  const plan = selectedPlan.value;
  if (selectedPlanId.value && !plan) return;
  if (plan) mode = plan.mode;
  const line = cart.value.find(
    (l) =>
      l.productId === productId &&
      l.mode === mode &&
      l.planId === plan?.id &&
      l.planVersion === plan?.version &&
      !l.unitIds?.length,
  );
  if (line) line.quantity++;
  else
    cart.value.push({
      key: crypto.randomUUID(),
      productId,
      productName: p.name,
      mode,
      quantity: 1,
      unitIds: [],
      unitPrice: plan?.unitPrice ?? null,
      ...(plan ? { planId: plan.id, planVersion: plan.version } : {}),
    });
  confirming.value = false;
}
function duplicateCartLine(line: (typeof cart.value)[number]) {
  cart.value.push({
    ...line,
    key: crypto.randomUUID(),
    quantity: 1,
    unitIds: [],
  });
  confirming.value = false;
}
function physicalStock(id: string) {
  return catalog.snapshot && context.locationId
    ? balance(catalog.snapshot, id, context.locationId)
    : "—";
}
function stock(id: string) {
  return catalog.snapshot && context.locationId
    ? availableQuantity(
        catalog.snapshot,
        id,
        context.locationId,
        selectedPlanId.value || undefined,
      )
    : "—";
}
async function submit() {
  if (catalog.busy || total.value === null || change.value === null) return;
  error.value = "";
  notice.value = "";
  try {
    await catalog.finishSale({
      ...context,
      cashReceived: context.cashReceived!,
      operationId: operationId.value,
      ...(replacesRefundId.value
        ? { replacesRefundId: replacesRefundId.value }
        : {}),
      lines: cart.value.map(
        ({
          productId,
          mode,
          quantity,
          unitPrice,
          planId,
          planVersion,
          unitIds,
        }) => ({
          ...(planId ? { planId, planVersion } : {}),
          productId,
          ...(unitIds?.length ? { unitIds: [...unitIds] } : {}),
          mode,
          quantity,
          unitPrice: unitPrice!,
        }),
      ),
    } satisfies SaleInput);
    cart.value = [];
    replacesRefundId.value = "";
    context.cashReceived = null;
    context.notes = "";
    confirming.value = false;
    operationId.value = crypto.randomUUID();
    await salesDraftRepository
      .remove(workspaces.activeWorkspaceId)
      .catch(() => {
        draftNotice.value =
          "交易已完成，但舊草稿清理失敗；下次開啟會依成交紀錄排除重複。";
      });
    notice.value = "交易已完成，已同步扣除實際商品庫存。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "成交失敗，請重試。";
    confirming.value = false;
  }
}
async function cancel() {
  if (catalog.busy || !refundConfirmed.value) return;
  error.value = "";
  notice.value = "";
  try {
    await catalog.refundSale(cancelId.value, cancelReason.value);
    cancelId.value = "";
    cancelReason.value = "";
    refundConfirmed.value = false;
    notice.value = "已記錄全額退款並全數回庫，原交易仍保留。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法取消交易。";
  }
}
const when = (v: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(v));
const named = (key: "locations" | "events" | "parties", id: string) =>
  catalog.snapshot?.[key].find((r) => r.id === id)?.name || "未指定";
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">QUICK BOOTH SALES</div>
      <h1>攤位販售</h1>
      <p>選擇實際交付的商品、確認收款，成交時一起扣庫。</p>
    </div>
  </section>
  <aside class="info-banner">
    <div>
      <strong>先開放指定購買與已知款式的抽選記錄。</strong>
      <p>
        抽選按實際交付商品逐筆登記，不替你抽獎。可先建立指定價或混合抽選池，也能手動填寫價格；同商品共用實物庫存。可分開記錄實退金額、可售回庫及瑕疵退回。需要一次處理退貨及新交付時，可從原交易使用「換購／補退差額」，明確核對本次實際收退；已另外完成的退款仍可連結獨立新交易，請勿重複折抵。整筆取消僅適用「已全額退款且商品全數回到原庫位」。
      </p>
    </div>
  </aside>
  <RouterLink v-if="!workspaces.activeWorkspaceId" to="/" class="button primary"
    >先建立工作區</RouterLink
  >
  <template v-else>
    <div class="field workspace-picker">
      <label for="sales-workspace">目前工作區</label
      ><select
        id="sales-workspace"
        :value="workspaces.activeWorkspaceId"
        :disabled="catalog.busy || cart.length > 0"
        @change="workspaces.select(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="w in workspaces.workspaces" :key="w.id" :value="w.id">
          {{ w.name }}
        </option></select
      ><small v-if="cart.length">請先完成或清空購物車，再切換工作區。</small>
    </div>
    <p v-if="draftNotice" class="info-banner" role="status">
      {{ draftNotice }}
    </p>
    <p v-if="notice" role="status" class="success-notice">{{ notice }}</p>
    <p v-if="error || catalog.error" role="alert" class="error-notice">
      {{ error || catalog.error
      }}<button
        class="text-button"
        :disabled="catalog.busy"
        @click="catalog.load(workspaces.activeWorkspaceId)"
      >
        重新讀取
      </button>
    </p>
    <p v-if="catalog.snapshot && !draftReady" role="status">
      正在讀取本機購物車草稿…
    </p>
    <template v-if="catalog.snapshot && draftReady">
      <section class="business-panel section-block">
        <h2>本次販售</h2>
        <div class="form-grid">
          <div class="field">
            <label for="sales-location">出貨庫位（必填）</label
            ><select
              id="sales-location"
              v-model="context.locationId"
              :disabled="catalog.busy || cart.length > 0"
            >
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
            <label for="sales-event">場次</label
            ><select
              id="sales-event"
              v-model="context.eventId"
              :disabled="catalog.busy || cart.length > 0"
            >
              <option value="">未指定</option>
              <option
                v-for="e in catalog.snapshot.events.filter((e) => !e.archived)"
                :key="e.id"
                :value="e.id"
              >
                {{ e.name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="sales-collector">實際收款者</label
            ><select
              id="sales-collector"
              v-model="context.collectorId"
              :disabled="catalog.busy"
            >
              <option value="">未指定</option>
              <option
                v-for="p in catalog.snapshot.parties"
                :key="p.id"
                :value="p.id"
              >
                {{ p.name }}
              </option></select
            ><small>持款者不等於收入所有者；未指定不會自動認定歸屬。</small>
          </div>
        </div>
        <RouterLink v-if="!catalog.snapshot.locations.length" to="/inventory"
          >先建立庫位並登記入庫 →</RouterLink
        >
      </section>
      <SalePlansPanel />
      <ReservationPanel />
      <section class="business-panel section-block">
        <div class="field">
          <label for="sales-plan">目前販售方案</label
          ><select
            id="sales-plan"
            v-model="selectedPlanId"
            :disabled="catalog.busy"
          >
            <option value="">手動售價（不套用方案）</option>
            <option v-for="p in availablePlans" :key="p.id" :value="p.id">
              {{ p.name }} · {{ p.unitPrice }} 元 ·
              {{ p.mode === "draw" ? "抽選" : "指定" }}
            </option></select
          ><small
            >只顯示適用目前場次的啟用方案。切換方案可將不同售法加入同一購物車；既有品項保留加入時的版本。</small
          >
        </div>
        <p v-if="selectedPlanId && !selectedPlan" class="error-notice">
          目前方案已不適用，請重新選擇。
        </p>
      </section>
      <div class="sales-layout">
        <section class="section-block">
          <h2>選擇交付商品</h2>
          <BarcodePicker
            :products="
              catalog.snapshot.products.filter(
                (p) =>
                  !p.archived &&
                  (!selectedPlan || selectedPlan.productIds.includes(p.id)),
              )
            "
            :disabled="catalog.busy"
            @select="(p) => (search = p.code)"
          />
          <div class="field">
            <label for="sales-search">搜尋商品</label
            ><input id="sales-search" type="search" v-model="search" />
          </div>
          <p v-if="!products.length">
            尚無符合的啟用商品，請先到商品建檔建立。
          </p>
          <div class="product-grid">
            <article v-for="p in products" :key="p.id" class="business-panel">
              <img
                v-if="p.thumbnail"
                :src="p.thumbnail"
                :alt="p.name + '縮圖'"
                width="64"
                height="64"
                loading="lazy"
                style="object-fit: contain"
              />
              <h3>{{ p.name }}</h3>
              <p>{{ p.code }} · 目前庫位現存 {{ physicalStock(p.id) }}</p>
              <p>
                目前{{ selectedPlan ? "方案" : "共用" }}可售 {{ stock(p.id) }}
              </p>
              <div class="actions">
                <button
                  type="button"
                  class="button primary"
                  :disabled="
                    catalog.busy || !context.locationId || stock(p.id) === 0
                  "
                  v-if="!selectedPlan || selectedPlan.mode === 'direct'"
                  @click="add(p.id, 'direct')"
                >
                  指定購買</button
                ><button
                  type="button"
                  class="button secondary"
                  :disabled="
                    catalog.busy || !context.locationId || stock(p.id) === 0
                  "
                  v-if="!selectedPlan || selectedPlan.mode === 'draw'"
                  @click="add(p.id, 'draw')"
                >
                  抽選結果
                </button>
              </div>
            </article>
          </div>
        </section>
        <section class="business-panel section-block cart">
          <h2>購物車</h2>
          <p v-if="replacesRefundId">
            這是一筆連結退款紀錄的新交付交易，金額請按實際約定填寫。<button
              type="button"
              class="text-button"
              @click="replacesRefundId = ''"
            >
              解除換貨連結
            </button>
          </p>
          <p v-if="!cart.length">
            先選出貨庫位，再點選商品。購物車尚不扣庫或保留庫存。未成交草稿會保存在這台裝置，回到此頁或重新開啟可恢復；草稿不包含在
            Excel 備份內。
          </p>
          <fieldset :disabled="catalog.busy">
            <article v-for="line in cart" :key="line.key" class="cart-line">
              <h3>
                {{ line.productName }} ·
                {{ line.mode === "draw" ? "抽選" : "指定" }}
              </h3>
              <p v-if="line.planId">
                方案版本
                {{ line.planVersion }}（價格固定；需改價請移除此項再選方案）
              </p>
              <button
                type="button"
                class="text-button"
                @click="duplicateCartLine(line)"
              >
                另列一項相同商品（一般／特殊單件分開）
              </button>
              <PhysicalUnitPicker
                :snapshot="catalog.snapshot"
                :product-id="line.productId"
                :location-id="context.locationId"
                :model-value="line.unitIds || []"
                :excluded-ids="
                  cart
                    .filter((l) => l.key !== line.key)
                    .flatMap((l) => l.unitIds || [])
                "
                @update:model-value="
                  line.unitIds = $event;
                  if ($event.length) line.quantity = $event.length;
                  confirming = false;
                "
                :disabled="catalog.busy"
              />
              <div class="form-grid">
                <div class="field">
                  <label :for="'qty-' + line.key">數量</label
                  ><input
                    :id="'qty-' + line.key"
                    v-model.number="line.quantity"
                    type="number"
                    min="1"
                    step="1"
                    required
                    @input="confirming = false"
                  />
                </div>
                <div class="field">
                  <label :for="'price-' + line.key">單價（新台幣整元）</label
                  ><input
                    :id="'price-' + line.key"
                    v-model.number="line.unitPrice"
                    type="number"
                    min="0"
                    step="1"
                    required
                    :readonly="Boolean(line.planId)"
                    placeholder="請輸入售價"
                    @input="confirming = false"
                  />
                </div>
              </div>
              <button
                type="button"
                class="text-button"
                :aria-label="'移除 ' + line.productName + ' ' + line.mode"
                @click="
                  cart = cart.filter((l) => l.key !== line.key);
                  confirming = false;
                "
              >
                移除
              </button>
            </article>
            <p class="amount">
              應收：{{ total === null ? "請填完整數量與單價" : total + " 元" }}
            </p>
            <div class="field">
              <label for="sales-cash">收到金額（新台幣整元）</label
              ><input
                id="sales-cash"
                v-model.number="context.cashReceived"
                type="number"
                min="0"
                step="1"
                @input="confirming = false"
              />
            </div>
            <p>找零：{{ change === null ? "尚無法計算" : change + " 元" }}</p>
            <div class="field">
              <label for="sales-notes">交易備註</label
              ><input
                id="sales-notes"
                v-model="context.notes"
                maxlength="2000"
              />
            </div>
          </fieldset>
          <div class="actions">
            <button
              class="button primary"
              :disabled="
                catalog.busy ||
                !cart.length ||
                change === null ||
                !context.locationId
              "
              @click="confirming = true"
            >
              確認收款</button
            ><button
              type="button"
              class="button secondary"
              :disabled="catalog.busy || !cart.length"
              @click="clearCart"
            >
              清空購物車
            </button>
          </div>
          <section
            v-if="confirming"
            class="confirmation"
            role="region"
            aria-label="成交確認"
          >
            <h3>確認已收款並交付商品？</h3>
            <p>
              應收 {{ total }} 元，收到 {{ context.cashReceived }} 元，找零
              {{ change }} 元。確認後會正式記帳並扣庫。
            </p>
            <button
              class="button primary"
              :disabled="catalog.busy"
              @click="submit"
            >
              {{ catalog.busy ? "儲存中…" : "完成交易並扣庫" }}</button
            ><button
              class="button secondary"
              :disabled="catalog.busy"
              @click="confirming = false"
            >
              返回檢查
            </button>
          </section>
        </section>
      </div>
      <section class="section-block">
        <h2>交易紀錄（{{ recent.length }}）</h2>
        <p>
          工作區有效交易營收：{{ netRevenue }}
          元（扣除已記錄退款；不是利潤）。
        </p>
        <article v-for="sale in recent" :key="sale.id" class="business-panel">
          <h3>
            {{ sale.code }} · {{ sale.total }} 元
            <span v-if="sale.cancelledAt" class="soft-label"
              >已全額退款並回庫</span
            >
          </h3>
          <p>
            {{ when(sale.createdAt) }} · {{ named("events", sale.eventId) }} ·
            {{ named("locations", sale.locationId) }}
          </p>
          <p v-if="sale.exchangeId">
            換購差額收付人：{{ named("parties", sale.collectorId) }}；原商品折抵
            {{ sale.exchangeCredit }} 元，實際補收
            {{ sale.cashReceived }} 元，實際退還 {{ sale.change }} 元。
          </p>
          <p v-else>
            收款者：{{ named("parties", sale.collectorId) }}；收到
            {{ sale.cashReceived }} 元，找零 {{ sale.change }} 元。
          </p>
          <ul>
            <li v-for="l in sale.lines" :key="l.id">
              {{ l.productName }} · {{ l.mode === "draw" ? "抽選" : "指定" }} ×
              {{ l.quantity }} · 單價 {{ l.unitPrice }} 元<span v-if="l.planId">
                · {{ l.planName }}（版本 {{ l.planVersion }}）</span
              >
              <small v-if="l.attribution" style="display: block"
                >成交時創作者：{{
                  l.attribution.creatorName || "未指定"
                }}；商品擁有者：{{
                  l.attribution.ownerName || "未指定"
                }}；柄圖作者：{{
                  l.attribution.authorNames.join("、") || "未指定"
                }}</small
              >
              <small v-else style="display: block"
                >舊交易未記錄歸屬快照，不以目前商品設定回填。</small
              >
            </li>
          </ul>
          <p v-if="sale.replacesRefundId">
            換貨來源：{{
              catalog.snapshot.refunds.find(
                (r) => r.id === sale.replacesRefundId,
              )?.code
            }}
          </p>
          <ExchangePanel
            v-if="!sale.cancelledAt"
            :snapshot="catalog.snapshot"
            :sale="sale"
            :busy="catalog.busy"
            :disabled="!!cart.length"
            :submit="submitExchange"
          />
          <SaleRefundPanel :sale="sale" @replacement="startReplacement" />
          <p v-if="sale.notes">{{ sale.notes }}</p>
          <p v-if="sale.cancelledAt">
            {{ when(sale.cancelledAt) }} 取消原因：{{ sale.cancelReason }}
          </p>
          <button
            v-else-if="
              !sale.exchangeId &&
              !catalog.snapshot.refunds.some((r) => r.saleId === sale.id)
            "
            class="button secondary"
            :disabled="catalog.busy"
            @click="
              cancelId = sale.id;
              cancelReason = '';
              refundConfirmed = false;
            "
          >
            取消／全額退款並回庫
          </button>
          <form
            v-if="cancelId === sale.id"
            class="confirmation"
            @submit.prevent="cancel"
          >
            <h4>確認整筆取消</h4>
            <p>
              此操作記錄全額退款
              {{ sale.total }}
              元，並把全部商品回到原庫位；尚未退款、部分退款或損壞退貨不適用。
            </p>
            <div class="field">
              <label :for="'cancel-' + sale.id">取消原因</label
              ><input
                :id="'cancel-' + sale.id"
                v-model="cancelReason"
                required
                maxlength="2000"
                :disabled="catalog.busy"
              />
            </div>
            <label class="check-option"
              ><input
                type="checkbox"
                v-model="refundConfirmed"
                :disabled="catalog.busy"
              />我已全額退款，且全部商品已回到原庫位</label
            >
            <div class="actions">
              <button
                class="button primary"
                :disabled="
                  catalog.busy || !refundConfirmed || !cancelReason.trim()
                "
              >
                記錄退款並回庫</button
              ><button
                type="button"
                class="button secondary"
                :disabled="catalog.busy"
                @click="cancelId = ''"
              >
                返回
              </button>
            </div>
          </form>
        </article>
        <p v-if="!recent.length">尚無交易紀錄。</p>
      </section>
    </template>
  </template>
</template>
<style scoped src="./business.css"></style>
