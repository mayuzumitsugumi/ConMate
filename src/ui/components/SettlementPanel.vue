<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import { costSummary, fractionDecimal } from "../../domain/finance/operations";
import { lineReturnSummary } from "../../domain/sales/refunds";
import {
  settlementBalances,
  settlementTrialChanged,
} from "../../domain/finance/settlements";
import type {
  SettlementTrialInput,
  SettlementDecision,
} from "../../domain/models/catalog";
const catalog = useCatalogStore();
const selectedId = ref("");
const group = computed(() =>
  catalog.snapshot?.settlements.find((g) => g.id === selectedId.value),
);
const notice = ref(""),
  error = ref("");
const newGroup = reactive({ name: "", notes: "" });
const sources = reactive({
  saleLineIds: [] as string[],
  costIds: [] as string[],
});
const rules = reactive({
  base: "",
  ratePercent: "",
  fixedFee: null as number | null,
  fixedOrder: "",
  negativePolicy: "",
  feePartyId: "",
  notes: "",
});
const shares = reactive<Record<string, string>>({});
const decision = reactive({ trialId: "", reason: "" });
const manual = reactive<Record<string, number | null>>({});
const payment = reactive({
  fromPartyId: "",
  toPartyId: "",
  amount: null as number | null,
  notes: "",
  confirmed: false,
  operationId: crypto.randomUUID(),
});
const holdings = reactive<Record<string, number | null>>({});
const reopenReason = ref("");
const closeReason = ref("");
const correction = reactive({ id: "", reason: "" });
const eventFilter = ref(""),
  productFilter = ref(""),
  planFilter = ref("");
const sourceSales = computed(
  () =>
    catalog.snapshot?.sales.flatMap((s) =>
      s.lines
        .filter(
          (l) =>
            (!eventFilter.value || s.eventId === eventFilter.value) &&
            (!productFilter.value || l.productId === productFilter.value) &&
            (!planFilter.value || l.planId === planFilter.value),
        )
        .map((l) => ({
          sale: s,
          line: l,
          net: s.cancelledAt
            ? 0
            : l.quantity * l.unitPrice -
              lineReturnSummary(catalog.snapshot!, l.id).amount,
        })),
    ) || [],
);
const sourceCosts = computed(
  () =>
    catalog.snapshot?.costs.filter(
      (c) => !productFilter.value || c.productId === productFilter.value,
    ) || [],
);
const balances = computed(() =>
  catalog.snapshot && group.value
    ? settlementBalances(catalog.snapshot, group.value.id)
    : [],
);
const cash = reactive({
  partyId: "",
  amount: null as number | null,
  reason: "",
  confirmed: false,
  operationId: crypto.randomUUID(),
});
const cashCorrection = reactive({ id: "", reason: "" });
function resetForm() {
  sources.saleLineIds = [];
  sources.costIds = [];
  Object.assign(rules, {
    base: "",
    ratePercent: "",
    fixedFee: null,
    fixedOrder: "",
    negativePolicy: "",
    feePartyId: "",
    notes: "",
  });
  for (const key of Object.keys(shares)) delete shares[key];
  for (const key of Object.keys(manual)) delete manual[key];
  decision.trialId = "";
  decision.reason = "";
  Object.assign(payment, {
    fromPartyId: "",
    toPartyId: "",
    amount: null,
    notes: "",
    confirmed: false,
    operationId: crypto.randomUUID(),
  });
  Object.assign(cash, {
    partyId: "",
    amount: null,
    reason: "",
    confirmed: false,
    operationId: crypto.randomUUID(),
  });
  cashCorrection.id = "";
  closeReason.value = "";
  reopenReason.value = "";
  correction.id = "";
  for (const key of Object.keys(holdings)) delete holdings[key];
  notice.value = "";
  error.value = "";
}
watch(selectedId, resetForm);
watch(
  () => catalog.snapshot?.workspaceId,
  () => {
    selectedId.value = "";
    resetForm();
    newGroup.name = "";
    newGroup.notes = "";
  },
);
async function run(fn: () => Promise<unknown>, message: string) {
  notice.value = "";
  error.value = "";
  try {
    await fn();
    notice.value = message;
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法保存，原資料未更動。";
    return false;
  }
}
async function create() {
  if (
    await run(
      () => catalog.createSettlement(newGroup.name, newGroup.notes),
      "結算工作表已建立。",
    )
  ) {
    const created = catalog.snapshot?.settlements.at(-1);
    selectedId.value = created?.id || "";
    newGroup.name = "";
    newGroup.notes = "";
    notice.value = "結算工作表已建立。";
  }
}
async function trial() {
  if (!group.value) return;
  const input: SettlementTrialInput = {
    saleLineIds: [...sources.saleLineIds],
    costIds: [...sources.costIds],
    base: (rules.base || null) as SettlementTrialInput["base"],
    ratePercent: rules.ratePercent.trim() || null,
    fixedFee: rules.fixedFee === ("" as unknown) ? null : rules.fixedFee,
    fixedOrder: (rules.fixedOrder ||
      null) as SettlementTrialInput["fixedOrder"],
    negativePolicy: (rules.negativePolicy ||
      null) as SettlementTrialInput["negativePolicy"],
    feePartyId: rules.feePartyId,
    shares: Object.entries(shares)
      .filter(([, percent]) => percent.trim() !== "")
      .map(([partyId, percent]) => ({ partyId, percent })),
    notes: rules.notes,
  };
  await run(
    () => catalog.recordSettlementTrial(group.value!.id, input),
    "試算快照已保存；這不會扣款或產生付款。",
  );
}
async function decide() {
  if (!group.value) return;
  const allocations = Object.entries(manual)
    .filter(([, amount]) => amount !== null && amount !== ("" as unknown))
    .map(([partyId, amount]) => ({ partyId, amount: amount! }));
  if (
    await run(
      () =>
        catalog.decideSettlement(group.value!.id, {
          trialId: decision.trialId,
          allocations,
          reason: decision.reason,
        }),
      "人工分配決定已保存；先前版本與實付紀錄均保留。",
    )
  )
    decision.reason = "";
}
async function pay() {
  if (!group.value || !payment.confirmed) return;
  if (
    await run(
      () =>
        catalog.paySettlement(group.value!.id, {
          operationId: payment.operationId,
          fromPartyId: payment.fromPartyId,
          toPartyId: payment.toPartyId,
          amount: payment.amount!,
          notes: payment.notes,
        }),
      "已記錄實際付款；不是新增利潤或費用。",
    )
  ) {
    payment.amount = null;
    payment.notes = "";
    payment.confirmed = false;
    payment.operationId = crypto.randomUUID();
  }
}
function exact(value: { numerator: string; denominator: string } | null) {
  return value
    ? fractionDecimal(BigInt(value.numerator), BigInt(value.denominator))
    : "未知";
}
function copyTrial(id: string) {
  const t = group.value?.trials.find((t) => t.id === id);
  if (!t) return;
  for (const key of Object.keys(manual)) delete manual[key];
  for (const a of t.result.allocations) manual[a.partyId] = a.amount;
  decision.trialId = id;
  notice.value = "試算金額已帶入人工決定表單，仍需由你確認並保存。";
}
async function declareHoldings() {
  if (!group.value) return;
  await run(
    () =>
      catalog.setSettlementHoldings(
        group.value!.id,
        Object.entries(holdings)
          .filter(([, amount]) => amount !== null && amount !== ("" as unknown))
          .map(([partyId, amount]) => ({ partyId, amount: amount! })),
      ),
    "開始持款聲明已保存。",
  );
}
async function undoPayment() {
  if (!group.value) return;
  if (
    await run(
      () =>
        catalog.reverseSettlementPayment(
          group.value!.id,
          correction.id,
          correction.reason,
        ),
      "已新增反向更正紀錄，原付款仍保留。",
    )
  )
    correction.id = "";
}
async function recordCash() {
  if (!group.value || !cash.confirmed) return;
  if (
    await run(
      () =>
        catalog.recordSettlementCash(group.value!.id, {
          operationId: cash.operationId,
          partyId: cash.partyId,
          amount: cash.amount!,
          reason: cash.reason,
        }),
      "已記錄外部現金增減，未改寫來源營收或成本。",
    )
  ) {
    cash.amount = null;
    cash.reason = "";
    cash.confirmed = false;
    cash.operationId = crypto.randomUUID();
  }
}
async function undoCash() {
  if (!group.value) return;
  if (
    await run(
      () =>
        catalog.reverseSettlementCash(
          group.value!.id,
          cashCorrection.id,
          cashCorrection.reason,
        ),
      "已保存外部現金反向更正，原紀錄仍保留。",
    )
  )
    cashCorrection.id = "";
}
async function reopen() {
  if (!group.value) return;
  await run(
    () => catalog.reopenSettlement(group.value!.id, reopenReason.value),
    "已記錄重新開啟，歷史決定與累計實付均保留。",
  );
}
async function close() {
  if (!group.value) return;
  await run(
    () => catalog.closeSettlement(group.value!.id, closeReason.value),
    "已記錄使用者結案決定，財務紀錄完整保留。",
  );
}
const named = (id: string) =>
  catalog.snapshot?.parties.find((p) => p.id === id)?.name || "未指定";
function decisionComparison(d: SettlementDecision) {
  const trial = group.value?.trials.find((t) => t.id === d.trialId);
  const ids = new Set([
    ...d.allocations.map((a) => a.partyId),
    ...(trial?.result.allocations.map((a) => a.partyId) || []),
  ]);
  return [...ids].map((partyId) => {
    const amount =
      d.allocations.find((a) => a.partyId === partyId)?.amount ?? 0;
    const expected =
      trial?.result.status === "complete"
        ? (trial.result.allocations.find((a) => a.partyId === partyId)
            ?.amount ?? 0)
        : null;
    return {
      partyId,
      amount,
      expected,
      difference:
        expected === null
          ? null
          : (BigInt(amount) - BigInt(expected)).toString(),
    };
  });
}
const when = (v: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(v));
const costTotal = (c: Parameters<typeof costSummary>[0]) => {
  try {
    return costSummary(c)?.total ?? "未知";
  } catch {
    return "未知";
  }
};
</script>
<template>
  <section
    v-if="catalog.snapshot"
    class="business-panel section-block"
    aria-labelledby="settlement-title"
  >
    <h2 id="settlement-title">分潤試算與人工分配</h2>
    <p>
      試算、你的分配決定、實際付款分開保存。系統不替你追收或決定結案；未設定規則或尚未清款仍可自行結案。
    </p>
    <p v-if="notice" role="status" class="success-notice">{{ notice }}</p>
    <p v-if="error" role="alert" class="error-notice">{{ error }}</p>
    <details>
      <summary>建立結算工作表</summary>
      <form @submit.prevent="create">
        <div class="field">
          <label for="settlement-group-name">結算工作表名稱</label
          ><input
            id="settlement-group-name"
            v-model="newGroup.name"
            required
            maxlength="80"
          />
        </div>
        <div class="field">
          <label for="settlement-group-notes">工作表說明</label
          ><textarea
            id="settlement-group-notes"
            v-model="newGroup.notes"
            maxlength="2000"
          ></textarea>
        </div>
        <button
          class="button primary"
          :disabled="catalog.busy || !newGroup.name.trim()"
        >
          建立結算工作表
        </button>
      </form>
    </details>
    <div class="field">
      <label for="settlement-group">目前結算工作表</label
      ><select
        id="settlement-group"
        v-model="selectedId"
        :disabled="catalog.busy"
      >
        <option value="">請選擇工作表</option>
        <option
          v-for="g in catalog.snapshot.settlements"
          :key="g.id"
          :value="g.id"
        >
          {{ g.name }}{{ g.closedAt ? "（使用者已結案）" : "" }}
        </option>
      </select>
    </div>
    <template v-if="group"
      ><h3>{{ group.name }}</h3>
      <p>{{ group.notes }}</p>
      <p v-if="group.closedAt">
        使用者於 {{ when(group.closedAt) }} 決定結案：{{ group.closeReason }}
      </p>
      <details v-if="!group.closedAt">
        <summary>選擇來源並保存試算</summary>
        <p>
          可分配基礎固定為「所選淨營收－所選整批成本」；下方的抽成基礎只影響管理抽成。成本採所選整批的實際綜合成本，不是本次已售商品成本。未售出商品也可能包含在內，請先確認你的合作約定。代墊及供應商實付不會再自動扣一次。篩選只縮小列表，已勾選來源仍保留。
        </p>
        <div class="form-grid">
          <div class="field">
            <label for="settlement-event-filter">篩選場次</label
            ><select id="settlement-event-filter" v-model="eventFilter">
              <option value="">全部</option>
              <option
                v-for="e in catalog.snapshot.events"
                :key="e.id"
                :value="e.id"
              >
                {{ e.name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="settlement-product-filter">篩選商品</label
            ><select id="settlement-product-filter" v-model="productFilter">
              <option value="">全部</option>
              <option
                v-for="p in catalog.snapshot.products"
                :key="p.id"
                :value="p.id"
              >
                {{ p.name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="settlement-plan-filter">篩選方案</label
            ><select id="settlement-plan-filter" v-model="planFilter">
              <option value="">全部</option>
              <option
                v-for="p in catalog.snapshot.salePlans"
                :key="p.id"
                :value="p.id"
              >
                {{ p.name }}
              </option>
            </select>
          </div>
        </div>
        <fieldset>
          <legend>營收來源（逐項選擇實際售出商品）</legend>
          <label
            v-for="row in sourceSales"
            :key="row.line.id"
            class="check-option"
            ><input
              type="checkbox"
              v-model="sources.saleLineIds"
              :value="row.line.id"
            />{{ row.sale.code }} · {{ row.line.productName }} ·
            {{ row.line.planName || "手動售價" }} · 淨營收
            {{ row.net }} 元</label
          >
          <p v-if="!sourceSales.length">
            尚無符合交易。未選來源不會自動包含所有交易。
          </p>
        </fieldset>
        <fieldset>
          <legend>成本來源（選取整批成本）</legend>
          <label v-for="c in sourceCosts" :key="c.id" class="check-option"
            ><input type="checkbox" v-model="sources.costIds" :value="c.id" />{{
              c.name
            }}
            · {{ costTotal(c) }} 元{{ c.archived ? "（已封存）" : "" }}</label
          >
          <p v-if="!sourceCosts.length">尚無符合成本紀錄。</p>
        </fieldset>
        <form @submit.prevent="trial">
          <fieldset :disabled="catalog.busy">
            <div class="form-grid">
              <div class="field">
                <label for="settlement-base">抽成基礎</label
                ><select id="settlement-base" v-model="rules.base">
                  <option value="">尚未設定</option>
                  <option value="revenue">所選淨營收</option>
                  <option value="revenue-minus-costs">
                    所選淨營收－所選整批成本
                  </option>
                </select>
              </div>
              <div class="field">
                <label for="settlement-rate">管理抽成比例（%）</label
                ><input
                  id="settlement-rate"
                  v-model="rules.ratePercent"
                  inputmode="decimal"
                  placeholder="未知留白；確定不抽成填0"
                />
              </div>
              <div class="field">
                <label for="settlement-fixed">固定管理費（元）</label
                ><input
                  id="settlement-fixed"
                  v-model.number="rules.fixedFee"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="未知留白；確定無費用填0"
                />
              </div>
              <div class="field">
                <label for="settlement-fixed-order">固定費計算順序</label
                ><select id="settlement-fixed-order" v-model="rules.fixedOrder">
                  <option value="">尚未設定</option>
                  <option value="before-rate">先扣固定費再算比例</option>
                  <option value="after-rate">先算比例再加固定費</option>
                </select>
              </div>
              <div class="field">
                <label for="settlement-negative">抽成基礎為負值時</label
                ><select
                  id="settlement-negative"
                  v-model="rules.negativePolicy"
                >
                  <option value="">尚未設定</option>
                  <option value="zero-fee">
                    負值不計比例抽成（固定費仍計入）
                  </option>
                  <option value="signed">保留正負值比例抽成</option>
                  <option value="manual">保留未計算，由我決定</option>
                </select>
              </div>
              <div class="field">
                <label for="settlement-fee-party">管理費歸屬</label
                ><select id="settlement-fee-party" v-model="rules.feePartyId">
                  <option value="">尚未設定</option>
                  <option
                    v-for="p in catalog.snapshot.parties"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option>
                </select>
              </div>
            </div>
            <fieldset>
              <legend>剩餘金額的分配比例（填寫者合計須100%）</legend>
              <div
                v-for="p in catalog.snapshot.parties"
                :key="p.id"
                class="field"
              >
                <label :for="'settlement-share-' + p.id"
                  >{{ p.name }} 的分配比例（%）</label
                ><input
                  :id="'settlement-share-' + p.id"
                  v-model="shares[p.id]"
                  inputmode="decimal"
                  placeholder="未參與留白"
                />
              </div>
              <p v-if="!catalog.snapshot.parties.length">
                請先在商品建檔建立參與創作者。
              </p>
            </fieldset>
            <p>
              公式：可分配基礎＝所選淨營收－所選整批成本；管理費＝固定費＋依所選順序計算的比例抽成；剩餘額＝可分配基礎－管理費，再依設定比例分配。金額以精確分數計算，最後整元分配並核對總和。
            </p>
            <div class="field">
              <label for="settlement-trial-notes">試算約定／備註</label
              ><textarea
                id="settlement-trial-notes"
                v-model="rules.notes"
                maxlength="2000"
              ></textarea>
            </div>
          </fieldset>
          <button class="button primary" :disabled="catalog.busy">
            保存試算快照
          </button>
        </form>
      </details>
      <section class="section-block">
        <h4>已保存試算（{{ group.trials.length }}）</h4>
        <p>
          試算只是快照，不會自動計收費用。再次使用相同來源不會自動扣款；來源若已用於其他工作表，請留意警告。
        </p>
        <article
          v-for="t in [...group.trials].reverse()"
          :key="t.id"
          class="settlement-record"
        >
          <h5>
            {{ when(t.createdAt) }} ·
            {{ t.result.status === "complete" ? "可試算" : "部分未知" }}
          </h5>
          <p v-if="settlementTrialChanged(catalog.snapshot, t)" class="unknown">
            來源在這次試算後已變更。以下仍是當時快照，尚未套用後續退款或成本更新；如需更新，請另存一次試算再自行決定。
          </p>
          <p>
            淨營收 {{ t.result.revenue }} 元；所選整批成本
            {{ exact(t.result.exactCosts) }} 元；抽成基礎
            {{ exact(t.result.exactBase) }} 元；管理費合計
            {{ exact(t.result.exactFee) }} 元；剩餘分配額
            {{ exact(t.result.exactDistributable) }} 元。
          </p>
          <p v-if="t.result.roundedBase !== null">
            扣所選成本後的整元分配基礎：{{ t.result.roundedBase }}
            元（管理費與剩餘分配合計；部分未知時尚未完成分配）。
          </p>
          <ul v-if="t.result.unknownItems.length">
            <li v-for="item in t.result.unknownItems" :key="item">
              尚無法試算：{{ item }}
            </li>
          </ul>
          <ul v-if="t.result.warnings.length">
            <li v-for="item in t.result.warnings" :key="item" class="unknown">
              {{ item }}
            </li>
          </ul>
          <ul>
            <li v-for="a in t.result.allocations" :key="a.partyId">
              {{ named(a.partyId) }}：{{ a.amount }} 元
            </li>
          </ul>
          <p>
            來源：{{ t.saleSources.length }} 項銷售明細、{{
              t.costSources.length
            }}
            筆整批成本。此快照不隨後續退款或成本修改自動重算。
          </p>
          <button
            v-if="t.result.allocations.length && !group.closedAt"
            type="button"
            class="button secondary"
            :disabled="catalog.busy"
            @click="copyTrial(t.id)"
          >
            帶入此試算，供我決定金額
          </button>
        </article>
        <p v-if="!group.trials.length">尚無試算，仍可直接保存人工分配決定。</p>
      </section>
      <details v-if="!group.closedAt">
        <summary>保存人工分配決定</summary>
        <form @submit.prevent="decide">
          <p>
            金額是這張工作表「截至目前的累計分配目標」，新決定取代舊目標，不會再加一次。正數為應取得的分配，負數為負擔；空白表示本次決定未列入該成員，保存後其累計分配目標視為0（不沿用舊決定）。分配與試算不同可留原因，系統不替你決定。
          </p>
          <fieldset :disabled="catalog.busy">
            <div class="field">
              <label for="settlement-decision-trial">參考試算</label
              ><select
                id="settlement-decision-trial"
                v-model="decision.trialId"
              >
                <option value="">不依試算，直接人工決定</option>
                <option
                  v-for="(t, i) in group.trials"
                  :key="t.id"
                  :value="t.id"
                >
                  試算 {{ i + 1 }} · {{ when(t.createdAt) }} ·
                  {{ t.result.status === "complete" ? "可試算" : "部分未知" }}
                </option>
              </select>
            </div>
            <div
              v-for="p in catalog.snapshot.parties"
              :key="p.id"
              class="field"
            >
              <label :for="'settlement-manual-' + p.id"
                >{{ p.name }} 的累計分配目標（整元，可負數）</label
              ><input
                :id="'settlement-manual-' + p.id"
                v-model.number="manual[p.id]"
                type="number"
                step="1"
                placeholder="未列入留白；確定為零填0"
              />
            </div>
            <div class="field">
              <label for="settlement-reason">分配決定／差異原因</label
              ><textarea
                id="settlement-reason"
                v-model="decision.reason"
                required
                maxlength="2000"
              ></textarea>
            </div>
          </fieldset>
          <button
            class="button primary"
            :disabled="catalog.busy || !decision.reason.trim()"
          >
            保存人工分配決定
          </button>
        </form>
      </details>
      <section class="section-block">
        <h4>分配決定歷史（{{ group.decisions.length }}）</h4>
        <article
          v-for="(d, i) in group.decisions"
          :key="d.id"
          class="settlement-record"
        >
          <h5>
            決定 {{ i + 1
            }}{{
              i === group.decisions.length - 1
                ? "（目前累計目標）"
                : "（歷史版本）"
            }}
          </h5>
          <p>{{ when(d.createdAt) }} · {{ d.reason }}</p>
          <p>
            分配合計 {{ d.total }} 元；與參考來源扣成本後總額差異：{{
              d.variance === null
                ? "來源總額未知或未選參考試算"
                : d.variance + " 元"
            }}
          </p>
          <ul>
            <li v-for="a in decisionComparison(d)" :key="a.partyId">
              {{ named(a.partyId) }}：人工目標 {{ a.amount }} 元；參考試算
              {{
                a.expected === null ? "未知或未選" : a.expected + " 元"
              }}；差異
              {{ a.difference === null ? "尚無法比較" : a.difference + " 元" }}
            </li>
          </ul>
        </article>
      </section>
      <details
        v-if="
          group.openingHoldings === null &&
          !group.closedAt &&
          !group.payments.length &&
          !group.cashAdjustments.length
        "
      >
        <summary>聲明開始分款時各人實際持款</summary>
        <form @submit.prevent="declareHoldings">
          <p>
            實際持款不是利潤歸屬。退款可能由不同人支付，系統不會把原收款者當作持款或受益人。請輸入這張工作表開始分款時，屬於本次分配的各人實際持款；未知留白，確定沒有才填0。此聲明需在登記實付前完成，之後的付款會持續累計。
          </p>
          <fieldset :disabled="catalog.busy">
            <div
              v-for="p in catalog.snapshot.parties"
              :key="p.id"
              class="field"
            >
              <label :for="'settlement-holding-' + p.id"
                >{{ p.name }} 的開始實際持款（整元）</label
              ><input
                :id="'settlement-holding-' + p.id"
                v-model.number="holdings[p.id]"
                type="number"
                step="1"
                placeholder="未知留白"
              />
            </div>
          </fieldset>
          <button class="button secondary" :disabled="catalog.busy">
            保存持款聲明
          </button>
        </form>
      </details>
      <section class="section-block">
        <h4>目前分配與款項核對</h4>
        <p>
          應收／應付差額＝目前累計分配目標－開始實際持款－此工作表內部累計淨收款－外部現金增減。正數表示尚應收取，負數表示尚應付出；缺目標或持款時保留未知。數字不代表系統要求你清償。
        </p>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>成員</th>
                <th>累計分配目標</th>
                <th>開始持款</th>
                <th>內部累計淨收款</th>
                <th>外部現金增減</th>
                <th>尚應收／付</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in balances" :key="b.partyId">
                <td>{{ named(b.partyId) }}</td>
                <td>{{ b.target === null ? "未知" : b.target }}</td>
                <td>{{ b.openingHeld === null ? "未知" : b.openingHeld }}</td>
                <td>{{ b.receivedNet }}</td>
                <td>{{ b.externalNet }}</td>
                <td>{{ b.due === null ? "尚無法核對" : b.due }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <details>
        <summary>登記已實際付款</summary>
        <form @submit.prevent="pay">
          <p>
            只記錄已完成的內部款項移轉，不會自動匯款。此工作表的所有決定版本共用同一份實付紀錄，不因改分配目標而歸零；代墊還款仍請在代墊紀錄登記，避免重複。
          </p>
          <fieldset :disabled="catalog.busy">
            <div class="form-grid">
              <div class="field">
                <label for="settlement-payment-payer">實際付款人</label
                ><select
                  id="settlement-payment-payer"
                  v-model="payment.fromPartyId"
                  required
                >
                  <option value="">請選擇</option>
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
                <label for="settlement-payment-recipient">實際收款人</label
                ><select
                  id="settlement-payment-recipient"
                  v-model="payment.toPartyId"
                  required
                >
                  <option value="">請選擇</option>
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
                <label for="settlement-payment-amount">已實付金額（整元）</label
                ><input
                  id="settlement-payment-amount"
                  v-model.number="payment.amount"
                  type="number"
                  min="1"
                  step="1"
                  required
                />
              </div>
            </div>
            <div class="field">
              <label for="settlement-payment-notes">款項說明</label
              ><input
                id="settlement-payment-notes"
                v-model="payment.notes"
                maxlength="2000"
              />
            </div>
            <label class="check-option"
              ><input
                type="checkbox"
                v-model="payment.confirmed"
              />我確認這筆款項已實際支付</label
            >
          </fieldset>
          <button
            class="button primary"
            :disabled="catalog.busy || !payment.confirmed"
          >
            記錄實際分款
          </button>
        </form>
      </details>
      <section class="section-block">
        <h4>實際付款歷史（{{ group.payments.length }}）</h4>
        <article
          v-for="p in group.payments"
          :key="p.id"
          class="settlement-record"
        >
          <p>
            {{ when(p.createdAt) }} · {{ named(p.fromPartyId) }} →
            {{ named(p.toPartyId) }} · {{ p.amount }} 元{{
              p.reversesId ? "（更正反向紀錄）" : ""
            }}
          </p>
          <p>{{ p.notes }}</p>
          <button
            v-if="
              !p.reversesId &&
              !group.payments.some((r) => r.reversesId === p.id)
            "
            type="button"
            class="text-button"
            :disabled="catalog.busy"
            @click="
              correction.id = p.id;
              correction.reason = '';
            "
          >
            更正這筆實付紀錄
          </button>
          <form v-if="correction.id === p.id" @submit.prevent="undoPayment">
            <div class="field">
              <label :for="'settlement-payment-correction-' + p.id"
                >實付更正原因</label
              ><input
                :id="'settlement-payment-correction-' + p.id"
                v-model="correction.reason"
                maxlength="2000"
                required
              />
            </div>
            <button
              class="button secondary"
              :disabled="catalog.busy || !correction.reason.trim()"
            >
              保存反向更正紀錄</button
            ><button
              type="button"
              class="text-button"
              @click="correction.id = ''"
            >
              返回
            </button>
          </form>
        </article>
      </section>
      <details>
        <summary>工作單以外的實際現金增減</summary>
        <form @submit.prevent="recordCash">
          <p>
            持款聲明之後，若由某成員實際退款給顧客、支付外部款項或收到外部款項，可在此記錄現金增減。正數為實際收進、負數為實際付出。這只調整本工作表的持款核對，不會再計收入、成本或代墊；內部成員轉帳請用上方實際分款，不能重複填寫。
          </p>
          <fieldset :disabled="catalog.busy">
            <div class="form-grid">
              <div class="field">
                <label for="settlement-cash-party">現金增減成員</label
                ><select
                  id="settlement-cash-party"
                  v-model="cash.partyId"
                  required
                >
                  <option value="">請選擇</option>
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
                <label for="settlement-cash-amount"
                  >已實際收進／付出（整元，正收負付）</label
                ><input
                  id="settlement-cash-amount"
                  v-model.number="cash.amount"
                  type="number"
                  step="1"
                  required
                />
              </div>
            </div>
            <div class="field">
              <label for="settlement-cash-reason">外部現金增減原因</label
              ><textarea
                id="settlement-cash-reason"
                v-model="cash.reason"
                required
                maxlength="2000"
              ></textarea>
            </div>
            <label class="check-option"
              ><input
                type="checkbox"
                v-model="cash.confirmed"
              />我確認已完成這筆外部收付款，且未重複登記內部分款</label
            >
          </fieldset>
          <button
            class="button primary"
            :disabled="catalog.busy || !cash.confirmed || !cash.reason.trim()"
          >
            記錄外部現金增減
          </button>
        </form>
      </details>
      <section v-if="group.cashAdjustments.length">
        <h4>外部現金增減歷史</h4>
        <article
          v-for="c in group.cashAdjustments"
          :key="c.id"
          class="settlement-record"
        >
          <p>
            {{ when(c.createdAt) }} · {{ named(c.partyId) }} ·
            {{ c.amount }} 元{{ c.reversesId ? "（反向更正）" : "" }} ·
            {{ c.reason }}
          </p>
          <button
            v-if="
              !c.reversesId &&
              !group.cashAdjustments.some((r) => r.reversesId === c.id)
            "
            class="text-button"
            type="button"
            :disabled="catalog.busy"
            @click="
              cashCorrection.id = c.id;
              cashCorrection.reason = '';
            "
          >
            更正這筆外部現金紀錄
          </button>
          <form v-if="cashCorrection.id === c.id" @submit.prevent="undoCash">
            <div class="field">
              <label :for="'settlement-cash-correction-' + c.id"
                >外部現金更正原因</label
              ><input
                :id="'settlement-cash-correction-' + c.id"
                v-model="cashCorrection.reason"
                required
                maxlength="2000"
              />
            </div>
            <button
              class="button secondary"
              :disabled="catalog.busy || !cashCorrection.reason.trim()"
            >
              保存外部現金反向更正</button
            ><button
              class="text-button"
              type="button"
              @click="cashCorrection.id = ''"
            >
              返回
            </button>
          </form>
        </article>
      </section>
      <details v-if="group.closedAt">
        <summary>由我重新開啟工作表</summary>
        <form @submit.prevent="reopen">
          <p>
            重新開啟後可追加試算或決定；之前結案、分配及累計實付款項全部保留。
          </p>
          <div class="field">
            <label for="settlement-reopen-reason">重新開啟原因</label
            ><textarea
              id="settlement-reopen-reason"
              v-model="reopenReason"
              required
              maxlength="2000"
            ></textarea>
          </div>
          <button
            class="button secondary"
            :disabled="catalog.busy || !reopenReason.trim()"
          >
            記錄由我重新開啟
          </button>
        </form>
      </details>
      <section v-if="group.statusHistory.length">
        <h4>結案與重新開啟歷史</h4>
        <ul>
          <li v-for="h in group.statusHistory" :key="h.id">
            {{ when(h.createdAt) }} ·
            {{ h.kind === "close" ? "使用者決定結案" : "使用者重新開啟" }} ·
            {{ h.reason }}
          </li>
        </ul>
      </section>
      <details v-if="!group.closedAt">
        <summary>由我決定結案</summary>
        <form @submit.prevent="close">
          <p>
            可以在未清款、未回本或規則不完整時結案。這只記錄你的決定，不會把未知金額改成0、免除欠款或自動分款。
          </p>
          <div class="field">
            <label for="settlement-close-reason">結案決定與說明</label
            ><textarea
              id="settlement-close-reason"
              v-model="closeReason"
              required
              maxlength="2000"
            ></textarea>
          </div>
          <button
            class="button secondary"
            :disabled="catalog.busy || !closeReason.trim()"
          >
            記錄由我決定結案
          </button>
        </form>
      </details>
    </template>
  </section>
</template>
<style scoped src="../pages/business.css"></style>
<style scoped>
summary {
  cursor: pointer;
  font-weight: 600;
  padding: 14px 0;
}
details {
  border-top: 1px solid var(--line);
  margin: 12px 0;
}
.settlement-record {
  padding: 12px 0;
  border-top: 1px solid var(--line);
}
.settlement-record h5 {
  font-size: 16px;
}
.table-scroll {
  max-width: 100%;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  border: 1px solid var(--line);
  padding: 10px;
  text-align: left;
  white-space: nowrap;
}
</style>
