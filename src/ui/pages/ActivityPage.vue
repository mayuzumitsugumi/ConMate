<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
import { balance } from "../../domain/inventory/operations";
import { availableQuantity } from "../../domain/inventory/reservations";
import ReservationPanel from "../components/ReservationPanel.vue";
import { activityCashSummary } from "../../domain/activity/operations";
import { saleTotal } from "../../domain/sales/operations";
import { saleNetRevenue, lineReturnSummary } from "../../domain/sales/refunds";
import type { SaleLineInput } from "../../domain/models/catalog";
import type {
  ActivityPacket,
  ActivityCommand,
} from "../../domain/activity/types";
import {
  listActivities,
  readActivity,
  inspectActivityFile,
  previewActivityImport,
  saveImportedActivity,
  exportActivity,
  changeActivity,
  closeActivity,
  previewActivityMerge,
  mergeActivity,
} from "../../application/activities";
const route = useRoute(),
  router = useRouter(),
  workspaces = useWorkspaceStore(),
  catalog = useCatalogStore();
const packets = ref<ActivityPacket[]>([]),
  packet = ref<ActivityPacket | null>(null),
  busy = ref(false),
  error = ref(""),
  notice = ref("");
const incoming = ref<ActivityPacket | null>(null),
  importState = ref<Awaited<ReturnType<typeof previewActivityImport>> | null>(
    null,
  ),
  importConfirmed = ref(false);
const selectedId = ref(""),
  panel = ref("sales");
const saleForm = reactive({
  planId: "",
  productId: "",
  mode: "direct" as "direct" | "draw",
  quantity: 1,
  unitPrice: 0,
  collectorId: "",
  cashReceived: null as number | null,
  notes: "",
});
const cart = ref<SaleLineInput[]>([]),
  operationId = ref(crypto.randomUUID()),
  confirmingSale = ref(false);
const total = computed(() => {
  try {
    return cart.value.length ? saleTotal(cart.value) : 0;
  } catch {
    return null;
  }
});
const change = computed(() =>
  total.value !== null &&
  Number.isSafeInteger(saleForm.cashReceived) &&
  saleForm.cashReceived! >= total.value
    ? saleForm.cashReceived! - total.value
    : null,
);
const plans = computed(
  () => packet.value?.snapshot.salePlans.filter((p) => !p.archived) || [],
);
const chosenPlan = computed(() =>
  plans.value.find((p) => p.id === saleForm.planId),
);
const products = computed(
  () =>
    packet.value?.snapshot.products.filter(
      (p) =>
        !p.archived &&
        (!chosenPlan.value || chosenPlan.value.productIds.includes(p.id)),
    ) || [],
);
const summary = computed(() => {
  const s = packet.value?.snapshot;
  if (!s) return null;
  return {
    net: s.sales
      .reduce((a, r) => a + BigInt(saleNetRevenue(s, r)), 0n)
      .toString(),
    count: s.sales.length,
    refunds: s.refunds.reduce((a, r) => a + BigInt(r.total), 0n).toString(),
    ...activityCashSummary(packet.value!),
  };
});
watch(chosenPlan, (plan) => {
  if (plan) {
    saleForm.unitPrice = plan.unitPrice;
    saleForm.mode = plan.mode;
  }
  saleForm.productId = "";
});
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await action();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作未完成，原資料仍保留。";
  } finally {
    busy.value = false;
  }
}
async function refresh() {
  packets.value = await listActivities();
}
async function select(id: string) {
  if (cart.value.length && id !== selectedId.value) {
    error.value = "請先完成或清空目前購物車，再切換交接份。";
    return;
  }
  await run(async () => {
    packet.value = await readActivity(id);
    selectedId.value = id;
    await router.replace({ path: "/activity", query: { id } });
    resetForms();
  });
}
function resetForms() {
  cart.value = JSON.parse(JSON.stringify(packet.value?.draft || []));
  confirmingSale.value = false;
  Object.assign(saleForm, {
    planId: "",
    productId: "",
    mode: "direct",
    quantity: 1,
    unitPrice: 0,
    collectorId: "",
    cashReceived: null,
    notes: "",
  });
  operationId.value = crypto.randomUUID();
  mergePreview.value = null;
  counts.value = {};
  closureConfirmed.value = false;
}
onMounted(async () => {
  await run(async () => {
    await refresh();
    const id =
      typeof route.query.id === "string"
        ? route.query.id
        : packets.value[0]?.handoffId;
    if (id) {
      packet.value = await readActivity(id);
      selectedId.value = id;
      resetForms();
    }
  });
});
async function inspect(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  await run(async () => {
    incoming.value = null;
    importState.value = null;
    importConfirmed.value = false;
    const candidate = await inspectActivityFile(file);
    const state = await previewActivityImport(candidate);
    incoming.value = candidate;
    importState.value = state;
    notice.value = "活動檔檢查完成，尚未寫入本機。";
  });
}
async function importPacket() {
  await run(async () => {
    if (
      !incoming.value ||
      !importState.value?.canImport ||
      !importConfirmed.value
    )
      return;
    const candidate = JSON.parse(
      JSON.stringify(incoming.value),
    ) as ActivityPacket;
    await saveImportedActivity(candidate, importState.value.existing?.revision);
    await refresh();
    packet.value = await readActivity(candidate.handoffId);
    selectedId.value = candidate.handoffId;
    incoming.value = null;
    importState.value = null;
    resetForms();
    await router.replace({
      path: "/activity",
      query: { id: candidate.handoffId },
    });
    notice.value = "活動檔已匯入；請核對內容後繼續使用。";
  });
}
async function command(cmd: ActivityCommand, message: string) {
  await run(async () => {
    if (!packet.value) return;
    packet.value = await changeActivity(
      packet.value.handoffId,
      packet.value.revision,
      cmd,
    );
    await refresh();
    notice.value = message;
  });
}
async function reserveActivity(input: {
  planId: string;
  productId: string;
  locationId: string;
  quantity: number;
  reason: string;
}) {
  if (!packet.value || busy.value)
    throw new Error("請先載入活動，並等目前操作完成。");
  busy.value = true;
  try {
    packet.value = await changeActivity(
      packet.value.handoffId,
      packet.value.revision,
      { type: "reserve", input },
    );
    await refresh();
  } finally {
    busy.value = false;
  }
}
async function releaseActivityReservation(id: string, reason: string) {
  if (!packet.value || busy.value)
    throw new Error("請先載入活動，並等目前操作完成。");
  busy.value = true;
  try {
    packet.value = await changeActivity(
      packet.value.handoffId,
      packet.value.revision,
      { type: "release-reservation", id, reason },
    );
    await refresh();
  } finally {
    busy.value = false;
  }
}
function addCart() {
  error.value = "";
  try {
    if (!packet.value || !saleForm.productId)
      throw new Error("請選擇實際交付商品。");
    if (
      !Number.isSafeInteger(saleForm.quantity) ||
      saleForm.quantity < 1 ||
      !Number.isSafeInteger(saleForm.unitPrice) ||
      saleForm.unitPrice < 0
    )
      throw new Error("數量須為正整數，單價須為非負整元。");
    cart.value.push({
      productId: saleForm.productId,
      mode: chosenPlan.value?.mode || saleForm.mode,
      quantity: saleForm.quantity,
      unitPrice: chosenPlan.value?.unitPrice ?? saleForm.unitPrice,
      ...(chosenPlan.value
        ? { planId: chosenPlan.value.id, planVersion: chosenPlan.value.version }
        : {}),
    });
    saleForm.quantity = 1;
    confirmingSale.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function sell() {
  if (!packet.value) return;
  await command(
    {
      type: "sale",
      input: {
        operationId: operationId.value,
        locationId: packet.value.locationId,
        eventId: packet.value.eventId,
        collectorId: saleForm.collectorId,
        cashReceived: saleForm.cashReceived ?? -1,
        notes: saleForm.notes,
        lines: JSON.parse(JSON.stringify(cart.value)),
      },
    },
    "交易已保存，庫存已同步扣除。",
  );
  if (!error.value) {
    cart.value = [];
    confirmingSale.value = false;
    saleForm.cashReceived = null;
    operationId.value = crypto.randomUUID();
  }
}
async function saveDraft() {
  await command(
    { type: "draft", lines: JSON.parse(JSON.stringify(cart.value)) },
    "未成交購物車已保存；不保留庫存，也不算營收。",
  );
}
async function discardCart() {
  await command({ type: "draft", lines: [] }, "已清空未成交購物車。");
  if (!error.value) {
    cart.value = [];
    confirmingSale.value = false;
  }
}
async function downloadPacket() {
  await run(async () => {
    if (!packet.value) return;
    if (!packet.value.closure) {
      packet.value = await changeActivity(
        packet.value.handoffId,
        packet.value.revision,
        { type: "draft", lines: JSON.parse(JSON.stringify(cart.value)) },
      );
    }
    await exportActivity(packet.value.handoffId);
    await refresh();
    notice.value = "已發起活動檔下載，請確認檔案已保存。存檔不代表結案。";
  });
}
const productDisplay = reactive({ id: "", name: "", reason: "" });
watch(
  () => productDisplay.id,
  (id) => {
    productDisplay.name =
      packet.value?.snapshot.products.find((p) => p.id === id)?.name || "";
  },
);
async function renameProduct() {
  await command(
    { type: "rename-product", ...productDisplay },
    "活動商品展示名稱修訂已保存，原交付快照與已成交紀錄仍保留。",
  );
  if (!error.value) productDisplay.reason = "";
}
const add = reactive({ name: "", quantity: 1, reason: "" });
async function addProduct() {
  await command(
    { type: "add-product", ...add },
    "活動新品項及一次帶入量已記錄。",
  );
  if (!error.value) Object.assign(add, { name: "", quantity: 1, reason: "" });
}
const decrease = reactive({
  productId: "",
  quantity: 1,
  kind: "free" as "free" | "damage" | "adjust-out",
  reason: "",
});
async function decreaseStock() {
  await command(
    { type: "decrease", ...decrease },
    "庫存減少已保存，不會產生營收。",
  );
  if (!error.value) decrease.reason = "";
}
const price = reactive({
  id: "",
  name: "",
  mode: "direct" as "direct" | "draw",
  unitPrice: 0,
  productIds: [] as string[],
  reason: "",
});
watch(
  () => price.id,
  (id) => {
    const p = plans.value.find((p) => p.id === id);
    if (p)
      Object.assign(price, {
        name: p.name,
        mode: p.mode,
        unitPrice: p.unitPrice,
        productIds: [...p.productIds],
      });
  },
);
async function savePrice() {
  if (!packet.value) return;
  await command(
    {
      type: "price",
      id: price.id,
      reason: price.reason,
      input: {
        name: price.name,
        mode: price.mode,
        unitPrice: price.unitPrice,
        productIds: [...price.productIds],
        eventIds: [packet.value.eventId],
      },
    },
    "販售方案修訂已保存，舊成交價格不會改變。",
  );
}
const cash = reactive({
  kind: "expense" as "expense" | "handover" | "note" | "correction",
  amount: 0,
  payerId: "",
  recipientId: "",
  reason: "",
  correctsId: "",
});
async function saveCash() {
  await command({ type: "cash", input: { ...cash } }, "活動帳務紀錄已新增。");
  if (!error.value) {
    cash.reason = "";
    cash.amount = 0;
    cash.correctsId = "";
  }
}
const refund = reactive({
  saleId: "",
  saleLineId: "",
  amount: 0,
  restockQuantity: 0,
  damagedQuantity: 0,
  reason: "",
});
const refundSale = computed(() =>
  packet.value?.snapshot.sales.find((s) => s.id === refund.saleId),
);
watch(
  () => refund.saleId,
  () => {
    refund.saleLineId = "";
  },
);
async function recordRefund() {
  if (!packet.value) return;
  await command(
    {
      type: "refund",
      input: {
        operationId: crypto.randomUUID(),
        saleId: refund.saleId,
        reason: refund.reason,
        lines: [
          {
            saleLineId: refund.saleLineId,
            amount: refund.amount,
            restockQuantity: refund.restockQuantity,
            damagedQuantity: refund.damagedQuantity,
            returnLocationId: refund.restockQuantity
              ? packet.value.locationId
              : "",
          },
        ],
      },
    },
    "實際退款／退貨已保存。",
  );
  if (!error.value) {
    refund.amount = 0;
    refund.restockQuantity = 0;
    refund.damagedQuantity = 0;
    refund.reason = "";
  }
}
const counts = ref<Record<string, number | null>>({}),
  countReasons = reactive<Record<string, string>>({}),
  closureNotes = ref(""),
  closureConfirmed = ref(false);
const canClose = computed(
  () =>
    !!packet.value &&
    !cart.value.length &&
    !packet.value.draft.length &&
    packet.value.snapshot.products.every(
      (p) =>
        Number.isSafeInteger(counts.value[p.id]) && counts.value[p.id]! >= 0,
    ),
);
async function close() {
  await run(async () => {
    if (!packet.value || !closureConfirmed.value || !canClose.value) return;
    packet.value = await closeActivity(
      packet.value.handoffId,
      packet.value.revision,
      packet.value.snapshot.products.map((p) => ({
        productId: p.id,
        actual: counts.value[p.id]!,
        reason: countReasons[p.id] || "",
      })),
      closureNotes.value,
    );
    await refresh();
    notice.value =
      "活動已確認結案，此份檔案永久唯讀。請匯出結案檔後合回創作管理。";
  });
}
const mergePreview = ref<Awaited<
    ReturnType<typeof previewActivityMerge>
  > | null>(null),
  mergeConfirmed = ref(false),
  mappings = reactive<Record<string, string>>({});
async function previewMerge() {
  await run(async () => {
    if (!packet.value || !workspaces.activeWorkspaceId) return;
    await catalog.load(workspaces.activeWorkspaceId);
    mergePreview.value = await previewActivityMerge(
      workspaces.activeWorkspaceId,
      packet.value.handoffId,
    );
    mergeConfirmed.value = false;
    for (const key of Object.keys(mappings)) delete mappings[key];
    for (const a of packet.value.additions) mappings[a.productId] = "";
  });
}
async function merge() {
  await run(async () => {
    if (!packet.value || !mergePreview.value || !mergeConfirmed.value) return;
    await mergeActivity(
      workspaces.activeWorkspaceId,
      mergePreview.value.expectedRevision,
      packet.value.handoffId,
      { ...mappings },
    );
    await catalog.load(workspaces.activeWorkspaceId);
    mergePreview.value = null;
    notice.value =
      "活動結案紀錄已合回創作管理，剩餘實物仍留在活動交接庫位；實際交還後再確認退回。";
  });
}
function financeKind(kind: string) {
  return (
    (
      {
        costs: "製作成本",
        advances: "代墊",
        settlements: "分配工作單",
        artworkExpenses: "柄圖費用",
        internalAgreements: "內部計價約定",
      } as Record<string, string>
    )[kind] || "財務參考"
  );
}
function financeSummary(data: unknown) {
  if (!data || typeof data !== "object") return [];
  const labels: Record<string, string> = {
    name: "名稱",
    quantity: "製作數量",
    estimatedPrint: "預估印製費",
    actualPrint: "實際印製費",
    artworkAllocated: "柄圖分攤額",
    otherCost: "其他成本",
    unitSalePrice: "試算單價",
    principal: "代墊本金",
    amount: "金額",
    total: "總額",
    notes: "備註",
    createdAt: "建立時間",
    updatedAt: "更新時間",
    voidedAt: "作廢時間",
    closedAt: "結束時間",
    repayments: "還款紀錄",
    trials: "試算紀錄",
    decisions: "分配決定",
    payments: "實際付款",
    versions: "版本紀錄",
    receipts: "回收紀錄",
    actualAmount: "實際費用",
    estimatedAmount: "預估費用",
  };
  return Object.entries(data)
    .filter(([key]) => labels[key])
    .map(([key, value]) => ({
      label: labels[key]!,
      value: Array.isArray(value)
        ? `${value.length} 筆`
        : value === null
          ? "未知／尚未設定"
          : value === ""
            ? "未填寫"
            : typeof value === "boolean"
              ? value
                ? "是"
                : "否"
              : typeof value === "object"
                ? "保留來源明細"
                : String(value),
    }));
}
function name(id: string) {
  return packet.value?.snapshot.products.find((p) => p.id === id)?.name || id;
}
function party(id: string) {
  return (
    packet.value?.snapshot.parties.find((p) => p.id === id)?.name || "未指定"
  );
}
function time(value: string) {
  return new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">ONE ACTIVITY · ONE CLEAR HANDOFF</div>
      <h1>活動工作台</h1>
      <p>
        匯入本次活動檔即可使用。存檔可續作，確認結案後永久唯讀；這不是即時同步。
      </p>
    </div>
  </section>
  <p v-if="error" class="error-notice" role="alert">{{ error }}</p>
  <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
  <section class="panel section-block">
    <h2>開啟活動交接份</h2>
    <div class="grid">
      <div class="field">
        <label for="activity-import">匯入活動進行檔／結案檔（XLSX）</label
        ><input
          id="activity-import"
          type="file"
          accept=".xlsx"
          :disabled="busy"
          @change="inspect"
        />
      </div>
      <div class="field">
        <label for="activity-packet">本機活動交接份</label
        ><select
          id="activity-packet"
          :value="selectedId"
          :disabled="busy"
          @change="select(($event.target as HTMLSelectElement).value)"
        >
          <option value="">請選擇</option>
          <option v-for="p in packets" :key="p.handoffId" :value="p.handoffId">
            {{ p.name }} · {{ p.closure ? "已結案" : "進行中" }} · 修訂{{
              p.revision
            }}
          </option>
        </select>
      </div>
    </div>
    <RouterLink to="/activities">創作者：準備活動與交付商品 →</RouterLink>
    <div v-if="incoming && importState" class="inset">
      <h3>匯入預覽：{{ incoming.name }}</h3>
      <p>
        {{
          incoming.closure ? "已確認結案，匯入後唯讀" : "活動進行檔，可繼續操作"
        }}
        · 修訂{{ incoming.revision }} ·
        {{ incoming.snapshot.products.length }}項商品 ·
        {{ incoming.snapshot.sales.length }}筆交易
      </p>
      <p>{{ importState.reason }}</p>
      <p>此操作只保存活動檔，不會將活動結果合入完整工作區。</p>
      <label v-if="importState.canImport" class="check"
        ><input
          v-model="importConfirmed"
          type="checkbox"
        />我已核對交接份與版本，確認匯入續作或檢視</label
      ><button
        class="button primary"
        :disabled="busy || !importState.canImport || !importConfirmed"
        @click="importPacket"
      >
        確認匯入活動檔</button
      ><button
        class="button secondary"
        :disabled="busy"
        @click="
          incoming = null;
          importState = null;
        "
      >
        取消
      </button>
    </div>
  </section>
  <template v-if="packet">
    <section class="panel section-block">
      <h2>{{ packet.name }}</h2>
      <p>
        {{ packet.snapshot.events.find((e) => e.id === packet!.eventId)?.name }}
        · 修訂{{ packet.revision }} ·
        {{ packet.closure ? "已確認結案 · 永久唯讀" : "進行中" }}
      </p>
      <p>
        交付範圍與既有品項數量固定；創作管理後來追加的商品不會自動加入。每份交接檔同時只交給一人負責操作。
      </p>
      <div class="metrics" v-if="summary">
        <span>交易 {{ summary.count }} 筆</span
        ><span>退款後營收 {{ summary.net }} 元</span
        ><span>已退金額 {{ summary.refunds }} 元</span
        ><span>活動支出 {{ summary.expensesTotal }} 元</span
        ><span>實際交款 {{ summary.handoverTotal }} 元</span>
      </div>
      <button class="button primary" :disabled="busy" @click="downloadPacket">
        {{ packet.closure ? "匯出活動結案檔" : "匯出活動進行檔" }}
      </button>
      <p v-if="packet.closure">
        結案於
        {{
          time(packet.closure.createdAt)
        }}。如需更正，請由創作管理新增有來源的更正紀錄，不修改原結案檔。
      </p>
    </section>
    <nav class="work-tabs" aria-label="活動工作項目">
      <button
        v-for="t in [
          { id: 'sales', name: '快速販售' },
          { id: 'inventory', name: '商品與庫存' },
          { id: 'finance', name: '活動帳務' },
          { id: 'close', name: '盤點與結案' },
          { id: 'merge', name: '合回創作管理' },
        ]"
        :key="t.id"
        class="button"
        :class="panel === t.id ? 'primary' : 'secondary'"
        @click="panel = t.id"
      >
        {{ t.name }}
      </button>
    </nav>
    <section v-if="panel === 'sales'" class="section-block">
      <div v-if="packet.closure" class="info-banner">
        已結案，不能新增交易或退款。
      </div>
      <p
        v-if="!cart.length && packet.draft.length && !packet.closure"
        class="info-banner"
      >
        本機有已保存但尚未清除的交易草稿。<button
          class="button secondary"
          :disabled="busy"
          @click="discardCart"
        >
          捨棄已保存草稿
        </button>
      </p>
      <ReservationPanel
        :snapshot="packet.snapshot"
        :busy="busy"
        :readonly="!!packet.closure"
        :on-reserve="reserveActivity"
        :on-release="releaseActivityReservation"
      />
      <fieldset :disabled="busy || !!packet.closure">
        <legend>新增交易</legend>
        <div class="grid">
          <div class="field">
            <label for="activity-plan">販售方案</label
            ><select id="activity-plan" v-model="saleForm.planId">
              <option value="">手動指定價格／方式</option>
              <option v-for="p in plans" :key="p.id" :value="p.id">
                {{ p.name }} · {{ p.unitPrice }}元
              </option>
            </select>
          </div>
          <div class="field">
            <label for="activity-product">實際交付商品</label
            ><select id="activity-product" v-model="saleForm.productId">
              <option value="">請選擇</option>
              <option v-for="p in products" :key="p.id" :value="p.id">
                {{ p.name }} · 現存{{
                  balance(packet.snapshot, p.id, packet.locationId)
                }}
                · 可售{{
                  availableQuantity(
                    packet.snapshot,
                    p.id,
                    packet.locationId,
                    saleForm.planId || undefined,
                  )
                }}
              </option>
            </select>
          </div>
          <div v-if="!chosenPlan" class="field">
            <label for="activity-mode">販售方式</label
            ><select id="activity-mode" v-model="saleForm.mode">
              <option value="direct">指定購買</option>
              <option value="draw">抽選實際款式</option>
            </select>
          </div>
          <div class="field">
            <label for="activity-sale-quantity">販售數量</label
            ><input
              id="activity-sale-quantity"
              v-model.number="saleForm.quantity"
              type="number"
              min="1"
              step="1"
            />
          </div>
          <div class="field">
            <label for="activity-price">單價（新台幣整元）</label
            ><input
              id="activity-price"
              v-model.number="saleForm.unitPrice"
              :disabled="!!chosenPlan"
              type="number"
              min="0"
              step="1"
            />
          </div>
        </div>
        <button type="button" class="button secondary" @click="addCart">
          加入購物車
        </button>
        <div v-if="cart.length" class="inset">
          <h3>本筆購物車</h3>
          <div v-for="(line, i) in cart" :key="i" class="ledger-row">
            <span
              >{{ name(line.productId) }} · {{ line.quantity }}個 ×
              {{ line.unitPrice }}元</span
            ><button
              type="button"
              class="text-button"
              :aria-label="`移除購物車第${i + 1}項`"
              @click="
                cart.splice(i, 1);
                confirmingSale = false;
              "
            >
              移除
            </button>
          </div>
          <p>應收 {{ total ?? "尚無法計算" }} 元</p>
          <div class="grid">
            <div class="field">
              <label for="activity-collector">實際收款者</label
              ><select id="activity-collector" v-model="saleForm.collectorId">
                <option value="">未指定</option>
                <option
                  v-for="p in packet.snapshot.parties"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="activity-received">收到金額（新台幣整元）</label
              ><input
                id="activity-received"
                v-model.number="saleForm.cashReceived"
                type="number"
                min="0"
                step="1"
              />
            </div>
            <div class="field">
              <label for="activity-sale-notes">交易備註</label
              ><input
                id="activity-sale-notes"
                v-model="saleForm.notes"
                maxlength="2000"
              />
            </div>
          </div>
          <p>找零 {{ change ?? "尚無法計算" }} 元</p>
          <button
            v-if="!confirmingSale"
            class="button primary"
            :disabled="change === null"
            @click="confirmingSale = true"
          >
            核對本筆交易
          </button>
          <div v-else>
            <p>請確認商品、數量、售價及實際收款，確認後才扣庫記帳。</p>
            <button
              class="button primary"
              :disabled="change === null"
              @click="sell"
            >
              確認收款並成交</button
            ><button class="button secondary" @click="confirmingSale = false">
              返回修改
            </button>
          </div>
          <button class="button secondary" @click="saveDraft">
            儲存購物車草稿</button
          ><button class="button secondary" @click="discardCart">
            清空未成交購物車
          </button>
        </div>
      </fieldset>
      <details class="panel section-block">
        <summary>登記實際退款／退貨</summary>
        <fieldset :disabled="busy || !!packet.closure">
          <div class="grid">
            <div class="field">
              <label for="activity-refund-sale">原交易</label
              ><select id="activity-refund-sale" v-model="refund.saleId">
                <option value="">請選擇</option>
                <option
                  v-for="s in packet.snapshot.sales.filter(
                    (s) => !s.cancelledAt,
                  )"
                  :key="s.id"
                  :value="s.id"
                >
                  {{ s.code }} · {{ s.total }}元
                </option>
              </select>
            </div>
            <div class="field">
              <label for="activity-refund-line">原交易商品</label
              ><select id="activity-refund-line" v-model="refund.saleLineId">
                <option value="">請選擇</option>
                <option
                  v-for="l in refundSale?.lines"
                  :key="l.id"
                  :value="l.id"
                >
                  {{ l.productName }} · 售出{{ l.quantity }}個
                </option>
              </select>
            </div>
            <div class="field">
              <label for="activity-refund-amount">本次已實際退款金額</label
              ><input
                id="activity-refund-amount"
                v-model.number="refund.amount"
                type="number"
                min="0"
                step="1"
              />
            </div>
            <div class="field">
              <label for="activity-refund-restock">可售回庫數量</label
              ><input
                id="activity-refund-restock"
                v-model.number="refund.restockQuantity"
                type="number"
                min="0"
                step="1"
              />
            </div>
            <div class="field">
              <label for="activity-refund-damaged">損壞退回數量</label
              ><input
                id="activity-refund-damaged"
                v-model.number="refund.damagedQuantity"
                type="number"
                min="0"
                step="1"
              />
            </div>
          </div>
          <div class="field">
            <label for="activity-refund-reason">退款／退貨原因</label
            ><input
              id="activity-refund-reason"
              v-model="refund.reason"
              maxlength="2000"
            />
          </div>
          <button
            class="button primary"
            :disabled="
              !refund.saleId || !refund.saleLineId || !refund.reason.trim()
            "
            @click="recordRefund"
          >
            確認已退款／退貨並登記
          </button>
        </fieldset>
      </details>
      <section class="panel section-block">
        <h2>交易紀錄</h2>
        <p v-if="!packet.snapshot.sales.length">尚無交易。</p>
        <article
          v-for="s in [...packet.snapshot.sales].reverse()"
          :key="s.id"
          class="record"
        >
          <h3>{{ s.code }} · {{ s.total }}元</h3>
          <p>
            {{ time(s.createdAt) }} · 收款者{{ party(s.collectorId) }} · 收到{{
              s.cashReceived
            }}元／找零{{ s.change }}元
          </p>
          <p v-for="l in s.lines" :key="l.id">
            {{ l.productName }} × {{ l.quantity }} · 單價{{
              l.unitPrice
            }}元<span v-if="lineReturnSummary(packet.snapshot, l.id).amount">
              · 已退{{
                lineReturnSummary(packet.snapshot, l.id).amount
              }}元</span
            >
          </p>
          <p v-if="s.notes">{{ s.notes }}</p>
        </article>
      </section>
    </section>
    <section v-if="panel === 'inventory'" class="section-block">
      <section class="panel">
        <h2>本次商品與現存</h2>
        <div
          v-for="p in packet.snapshot.products"
          :key="p.id"
          class="ledger-row"
        >
          <strong>{{ p.name }}</strong
          ><span
            >{{ balance(packet.snapshot, p.id, packet.locationId) }}個</span
          >
        </div>
        <p>這是活動帳面現存；結案前仍須逐項實點。</p>
      </section>
      <details class="panel section-block">
        <summary>修訂商品展示名稱</summary>
        <p>
          只修改本活動的展示名稱，不能更動成本或交付數量。原交付快照與已成交名稱會保留，合回時不會改名創作管理的原商品。
        </p>
        <fieldset :disabled="busy || !!packet.closure">
          <form @submit.prevent="renameProduct">
            <div class="grid">
              <div class="field">
                <label for="activity-display-product"
                  >要修訂展示名稱的商品</label
                ><select
                  id="activity-display-product"
                  v-model="productDisplay.id"
                  required
                >
                  <option value="">請選擇商品</option>
                  <option
                    v-for="p in packet.snapshot.products"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option>
                </select>
              </div>
              <div class="field">
                <label for="activity-display-name">本活動商品展示名稱</label
                ><input
                  id="activity-display-name"
                  v-model="productDisplay.name"
                  required
                  maxlength="80"
                />
              </div>
            </div>
            <div class="field">
              <label for="activity-display-reason">展示名稱修訂原因</label
              ><input
                id="activity-display-reason"
                v-model="productDisplay.reason"
                required
                maxlength="2000"
              />
            </div>
            <button class="button primary" :disabled="!productDisplay.id">
              保存商品展示名稱修訂
            </button>
          </form>
        </fieldset>
        <h3>展示名稱修訂歷史</h3>
        <p v-if="!packet.productRevisions.length">尚無展示名稱修訂。</p>
        <article
          v-for="r in packet.productRevisions"
          :key="r.id"
          class="record"
        >
          <strong>{{ r.beforeName }} → {{ r.afterName }}</strong>
          <p>{{ time(r.createdAt) }} · {{ r.reason }}</p>
        </article>
      </details>
      <details class="panel section-block">
        <summary>新增活動品項與一次帶入量</summary>
        <p>
          可新增實際帶來的品項並一次記錄數量；不能增加既有品項。再次追加時，另建獨立活動品項並註明來源。
        </p>
        <fieldset :disabled="busy || !!packet.closure">
          <form @submit.prevent="addProduct">
            <div class="grid">
              <div class="field">
                <label for="activity-new-name">活動新品項名稱</label
                ><input
                  id="activity-new-name"
                  v-model="add.name"
                  required
                  maxlength="80"
                />
              </div>
              <div class="field">
                <label for="activity-new-quantity">一次實際帶入數量</label
                ><input
                  id="activity-new-quantity"
                  v-model.number="add.quantity"
                  required
                  type="number"
                  min="1"
                  step="1"
                />
              </div>
            </div>
            <div class="field">
              <label for="activity-new-reason">帶入來源與原因</label
              ><input
                id="activity-new-reason"
                v-model="add.reason"
                required
                maxlength="2000"
              />
            </div>
            <button class="button primary">確認新增品項與帶入量</button>
          </form>
        </fieldset>
      </details>
      <section class="panel section-block">
        <h2>無料、損耗與其他減少</h2>
        <fieldset :disabled="busy || !!packet.closure">
          <form @submit.prevent="decreaseStock">
            <div class="grid">
              <div class="field">
                <label for="activity-decrease-product">減少的商品</label
                ><select
                  id="activity-decrease-product"
                  v-model="decrease.productId"
                  required
                >
                  <option value="">請選擇</option>
                  <option
                    v-for="p in packet.snapshot.products"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option>
                </select>
              </div>
              <div class="field">
                <label for="activity-decrease-kind">減少原因類型</label
                ><select id="activity-decrease-kind" v-model="decrease.kind">
                  <option value="free">無料發放</option>
                  <option value="damage">瑕疵／損耗</option>
                  <option value="adjust-out">其他減少</option>
                </select>
              </div>
              <div class="field">
                <label for="activity-decrease-quantity">減少數量</label
                ><input
                  id="activity-decrease-quantity"
                  v-model.number="decrease.quantity"
                  type="number"
                  min="1"
                  step="1"
                  required
                />
              </div>
            </div>
            <div class="field">
              <label for="activity-decrease-reason">減少原因說明</label
              ><input
                id="activity-decrease-reason"
                v-model="decrease.reason"
                required
                maxlength="2000"
              />
            </div>
            <button class="button primary">確認登記庫存減少</button>
          </form>
        </fieldset>
      </section>
      <details class="panel section-block">
        <summary>修訂既有活動販售方案</summary>
        <fieldset :disabled="busy || !!packet.closure">
          <form @submit.prevent="savePrice">
            <div class="grid">
              <div class="field">
                <label for="activity-price-plan">要修訂的方案</label
                ><select id="activity-price-plan" v-model="price.id">
                  <option value="">請選擇要修訂的方案</option>
                  <option v-for="p in plans" :key="p.id" :value="p.id">
                    {{ p.name }}
                  </option>
                </select>
              </div>
              <div class="field">
                <label for="activity-price-name">方案名稱</label
                ><input
                  id="activity-price-name"
                  v-model="price.name"
                  required
                  maxlength="80"
                />
              </div>
              <div class="field">
                <label for="activity-price-mode">方案販售方式</label
                ><select id="activity-price-mode" v-model="price.mode">
                  <option value="direct">指定購買</option>
                  <option value="draw">抽選實際款式</option>
                </select>
              </div>
              <div class="field">
                <label for="activity-price-value">方案單價（整元）</label
                ><input
                  id="activity-price-value"
                  v-model.number="price.unitPrice"
                  type="number"
                  min="0"
                  step="1"
                  required
                />
              </div>
            </div>
            <label
              v-for="p in packet.snapshot.products"
              :key="p.id"
              class="check"
              ><input
                v-model="price.productIds"
                type="checkbox"
                :value="p.id"
              />{{ p.name }}</label
            >
            <div class="field">
              <label for="activity-price-reason">改價／新方案原因</label
              ><input
                id="activity-price-reason"
                v-model="price.reason"
                required
                maxlength="2000"
              />
            </div>
            <button class="button primary" :disabled="!price.id">
              保存方案修訂
            </button>
          </form>
        </fieldset>
      </details>
    </section>
    <section v-if="panel === 'finance'" class="section-block">
      <section class="panel">
        <h2>新增活動帳務紀錄</h2>
        <p>
          只記錄已實際發生的款項；新增不代表網站已轉帳。成本與原始歷史不能在活動端改寫或刪除。
        </p>
        <fieldset :disabled="busy || !!packet.closure">
          <form @submit.prevent="saveCash">
            <div class="grid">
              <div class="field">
                <label for="activity-cash-kind">帳務類型</label
                ><select id="activity-cash-kind" v-model="cash.kind">
                  <option value="expense">活動支出</option>
                  <option value="handover">實際交款</option>
                  <option value="note">帳務註記</option>
                  <option value="correction">來源更正註記</option>
                </select>
              </div>
              <div class="field">
                <label for="activity-cash-amount">已實際支付金額（整元）</label
                ><input
                  id="activity-cash-amount"
                  v-model.number="cash.amount"
                  type="number"
                  min="0"
                  step="1"
                  required
                />
              </div>
              <div class="field">
                <label for="activity-cash-payer">實際付款者</label
                ><select id="activity-cash-payer" v-model="cash.payerId">
                  <option value="">未指定</option>
                  <option
                    v-for="p in packet.snapshot.parties"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option>
                </select>
              </div>
              <div class="field">
                <label for="activity-cash-recipient">實際收款者</label
                ><select
                  id="activity-cash-recipient"
                  v-model="cash.recipientId"
                >
                  <option value="">未指定</option>
                  <option
                    v-for="p in packet.snapshot.parties"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option>
                </select>
              </div>
              <div v-if="cash.kind === 'correction'" class="field">
                <label for="activity-cash-source">更正來源紀錄</label
                ><select id="activity-cash-source" v-model="cash.correctsId">
                  <option value="">請選擇來源</option>
                  <option
                    v-for="c in packet.cashEntries"
                    :key="c.id"
                    :value="c.id"
                  >
                    {{ c.reason }} · {{ c.amount }}元
                  </option>
                </select>
              </div>
            </div>
            <div class="field">
              <label for="activity-cash-reason">用途／更正說明</label
              ><input
                id="activity-cash-reason"
                v-model="cash.reason"
                required
                maxlength="2000"
              />
            </div>
            <button class="button primary">確認新增活動帳務</button>
          </form>
        </fieldset>
      </section>
      <section class="panel section-block">
        <h2>活動帳務歷史</h2>
        <p>
          來源更正保留舊紀錄，以最新更正金額核對；更正金額是替代值，不是額外新增支出。
        </p>
        <p>
          核對後活動支出 {{ summary?.expensesTotal }} 元，實際交款
          {{ summary?.handoverTotal }} 元。交款不會重複扣成費用。
        </p>
        <p v-if="!packet.cashEntries.length">尚無活動支出或交款紀錄。</p>
        <article v-for="c in packet.cashEntries" :key="c.id" class="record">
          <h3>
            {{
              c.kind === "expense"
                ? "活動支出"
                : c.kind === "handover"
                  ? "實際交款"
                  : c.kind === "correction"
                    ? "來源更正"
                    : "註記"
            }}
            · {{ c.amount }}元
          </h3>
          <p>
            {{ party(c.payerId) }} → {{ party(c.recipientId) }} ·
            {{ time(c.createdAt) }}
          </p>
          <p>{{ c.reason }}</p>
        </article>
      </section>
      <section class="panel section-block">
        <h2>交付的財務參考快照（唯讀）</h2>
        <p>
          只包含匯出者明確選擇的參考資料；不自動計入本次活動支出，不代表已付款或已分潤。
        </p>
        <p v-if="!packet.financialReferences.length">未攜帶私人財務資料。</p>
        <details v-for="(f, i) in packet.financialReferences" :key="i">
          <summary>{{ f.name }}（{{ financeKind(f.kind) }}）</summary>
          <dl class="reference-details">
            <template v-for="row in financeSummary(f.data)" :key="row.label"
              ><dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd></template
            >
          </dl>
          <p>完整來源快照隨活動檔保存，不能在此改寫原始財務資料。</p>
        </details>
      </section>
    </section>
    <section v-if="panel === 'close'" class="panel section-block">
      <h2>逐項盤點與確認結案</h2>
      <template v-if="packet.closure"
        ><p>本結案報告永久保留，不因重新匯出而更動。</p>
        <div
          v-for="c in packet.closure.counts"
          :key="c.productId"
          class="record"
        >
          <strong>{{ name(c.productId) }}</strong>
          <p>
            帳面{{ c.expected }}／實點{{ c.actual }}／差異{{
              c.actual - c.expected
            }}
          </p>
          <p>{{ c.reason || "無差異說明" }}</p>
        </div>
        <p>{{ packet.closure.notes }}</p></template
      ><template v-else
        ><p>
          所有交付及新增品項都必須填實點數量。確認結案會留下原因並釋放尚未售出的專用預留，不改變實物數量。盤差可以註記待查，未清款不阻止結案；實點不會自動調整庫存或變成銷售。
        </p>
        <p v-if="cart.length || packet.draft.length" class="error-notice">
          尚有未成交購物車，請先成交或清空。
        </p>
        <fieldset :disabled="busy">
          <div
            v-for="p in packet.snapshot.products"
            :key="p.id"
            class="count-row"
          >
            <h3>{{ p.name }}</h3>
            <p>
              帳面現存 {{ balance(packet.snapshot, p.id, packet.locationId) }}個
            </p>
            <div class="grid">
              <div class="field">
                <label :for="`activity-count-${p.id}`"
                  >{{ p.name }} 實點數量</label
                ><input
                  :id="`activity-count-${p.id}`"
                  v-model.number="counts[p.id]"
                  type="number"
                  min="0"
                  step="1"
                  required
                />
              </div>
              <div class="field">
                <label :for="`activity-count-reason-${p.id}`"
                  >{{ p.name }} 盤差／待查說明</label
                ><input
                  :id="`activity-count-reason-${p.id}`"
                  v-model="countReasons[p.id]"
                  maxlength="2000"
                />
              </div>
            </div>
          </div>
          <div class="field">
            <label for="activity-close-notes">活動結案備註與待查事項</label
            ><textarea
              id="activity-close-notes"
              v-model="closureNotes"
              rows="3"
              maxlength="2000"
            ></textarea>
          </div>
          <p>
            本次銷售{{ summary?.count }}筆，退款後營收{{
              summary?.net
            }}元；活動支出{{ summary?.expensesTotal }}元，實際交款{{
              summary?.handoverTotal
            }}元。請核對各項盤點與帳務紀錄，交款不是新增費用。
          </p>
          <label class="check"
            ><input
              v-model="closureConfirmed"
              type="checkbox"
            />我已完成全品項實點並確認結案；本活動檔結案後永久唯讀</label
          ><button
            class="button primary"
            :disabled="!canClose || !closureConfirmed"
            @click="close"
          >
            確認盤點完成並永久結案
          </button>
        </fieldset></template
      >
    </section>
    <section v-if="panel === 'merge'" class="panel section-block">
      <h2>合回創作管理</h2>
      <p>
        只將這一份交接的結案紀錄合回來源工作區，不覆蓋其他企劃或活動；同一結案不會重複扣庫或記帳。
      </p>
      <p v-if="!packet.closure" class="info-banner">
        活動尚未結案，不能合回創作管理。請先完成全品項盤點及結案。
      </p>
      <p v-if="!workspaces.workspaces.length">
        這台裝置沒有完整工作區。請回原創作者裝置匯入此結案檔，或先還原完整備份。
      </p>
      <template v-else
        ><div class="field">
          <label for="activity-merge-workspace">要合回的完整工作區</label
          ><select
            id="activity-merge-workspace"
            :value="workspaces.activeWorkspaceId"
            :disabled="busy"
            @change="
              workspaces.select(($event.target as HTMLSelectElement).value);
              mergePreview = null;
            "
          >
            <option
              v-for="w in workspaces.workspaces"
              :key="w.id"
              :value="w.id"
            >
              {{ w.name }}
            </option>
          </select>
        </div>
        <button
          class="button secondary"
          :disabled="busy || !packet.closure"
          @click="previewMerge"
        >
          檢查結案合回差異
        </button></template
      >
      <div v-if="mergePreview" class="inset">
        <h3>合回預覽</h3>
        <p>
          本活動含{{ packet.snapshot.sales.length }}筆交易、{{
            packet.snapshot.refunds.length
          }}筆退款／退貨、{{ packet.cashEntries.length }}筆活動帳務及{{
            packet.additions.length
          }}項現場新增商品。
        </p>
        <div v-for="a in packet.additions" :key="a.productId" class="field">
          <label :for="`activity-map-${a.productId}`"
            >{{ name(a.productId) }} 合回商品對應</label
          ><select
            :id="`activity-map-${a.productId}`"
            v-model="mappings[a.productId]"
          >
            <option value="">建立獨立新商品</option>
            <option
              v-for="p in catalog.snapshot?.products.filter((p) => !p.archived)"
              :key="p.id"
              :value="p.id"
            >
              連結既有商品：{{ p.name }}
            </option></select
          ><small>不依名稱自動配對，請核對是否為同一實物商品。</small>
        </div>
        <p v-if="mergePreview.alreadyMerged" class="success-notice">
          這份結案已合回，不會再次扣庫或記帳。
        </p>
        <dl class="reference-details">
          <dt>新增交易</dt>
          <dd>{{ mergePreview.sales }}筆</dd>
          <dt>退款／退貨</dt>
          <dd>{{ mergePreview.refunds }}筆</dd>
          <dt>庫存異動</dt>
          <dd>{{ mergePreview.movements }}筆</dd>
          <dt>活動帳務</dt>
          <dd>{{ mergePreview.cashEntries }}筆</dd>
          <dt>銷售原額</dt>
          <dd>{{ mergePreview.salesTotal }}元</dd>
          <dt>已退金額</dt>
          <dd>{{ mergePreview.refundTotal }}元</dd>
          <dt>剩餘帳面數量</dt>
          <dd>{{ mergePreview.remaining }}個</dd>
          <dt>盤差待查</dt>
          <dd>{{ mergePreview.pendingDiscrepancies }}項</dd>
        </dl>
        <p v-if="mergePreview.pendingDiscrepancies" class="info-banner">
          有實點差異的品項將保留待查，不會自動調成銷售或虛構入庫。確認實物退回前，需在創作管理明確處理盤差。
        </p>
        <p>剩餘品先留在交接庫位，合回不代表實物已交還。</p>
        <label class="check"
          ><input
            v-model="mergeConfirmed"
            type="checkbox"
          />我已核對新增紀錄、商品對應及衝突，確認合回這份活動結案</label
        ><button
          class="button primary"
          :disabled="busy || !mergeConfirmed || mergePreview.alreadyMerged"
          @click="merge"
        >
          確認合回活動結案
        </button>
      </div>
    </section>
  </template>
</template>
<style scoped>
.panel,
fieldset {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  min-width: 0;
  overflow-wrap: anywhere;
}
fieldset {
  margin: 16px 0;
}
legend {
  font-weight: 600;
  padding: 0 8px;
}
.field {
  display: grid;
  gap: 7px;
  margin: 10px 0;
  min-width: 0;
}
.grid {
  display: grid;
  gap: 12px;
}
input:not([type="checkbox"]),
select,
textarea {
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 10px 12px;
  font: inherit;
  border: 1px solid #acbda8;
  border-radius: 7px;
  background: #fcfdf9;
  color: var(--text);
}
.check {
  display: flex;
  gap: 9px;
  align-items: center;
  min-height: 44px;
  margin: 12px 0;
}
.check input {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.button {
  margin: 5px 5px 5px 0;
}
.work-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.inset {
  background: #f4f8f0;
  border: 1px solid #cbd7c4;
  padding: 16px;
  border-radius: 8px;
  margin-top: 18px;
}
.ledger-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding: 14px 0;
}
.record,
.count-row {
  border-bottom: 1px solid var(--line);
  padding: 14px 0;
}
.metrics {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  margin: 15px 0;
}
p {
  line-height: 1.9;
}
summary {
  cursor: pointer;
  min-height: 44px;
  padding: 12px 0;
  font-weight: 600;
}
.reference-details {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr);
  gap: 10px;
}
.reference-details dt {
  font-weight: 600;
}
.reference-details dd {
  margin: 0;
  overflow-wrap: anywhere;
}
h3 {
  margin: 12px 0;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (min-width: 760px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 520px) {
  .panel,
  fieldset {
    padding: 16px;
  }
}
</style>
