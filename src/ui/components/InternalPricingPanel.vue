<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import { internalSummary } from "../../domain/finance/internal-pricing";
import type { InternalAgreementInput } from "../../domain/models/catalog";
const catalog = useCatalogStore();
const notice = ref(""),
  error = ref(""),
  selected = ref(""),
  previousId = ref(""),
  confirmed = ref(false);
const form = reactive<InternalAgreementInput>({
  name: "",
  sourceType: "cost",
  sourceId: "",
  burdenPartyId: "",
  quantity: 1,
  internalTotal: null,
  agreedUnit: null,
  differencePartyId: "",
  differenceTreatment: "",
  notes: "",
});
const receipt = reactive({
  payerId: "",
  collectorId: "",
  amount: 1,
  notes: "",
});
const correction = ref({ kind: "", id: "", reason: "" });
const s = computed(() => catalog.snapshot);
const agreements = computed(() => s.value?.internalAgreements ?? []);
const current = computed(() =>
  agreements.value.find((a) => a.id === selected.value),
);
const sources = computed(() =>
  form.sourceType === "cost"
    ? (s.value?.costs.filter((c) => !c.archived) ?? [])
    : (s.value?.artworkExpenses.filter((a) => !a.voidedAt) ?? []),
);
const chosenSource = computed(() =>
  sources.value.find((a) => a.id === form.sourceId),
);
const sourceNames = (type: string, id: string) =>
  type === "cost"
    ? s.value?.costs.find((c) => c.id === id)?.name
    : s.value?.artworkExpenses.find((a) => a.id === id)?.name;
const partyName = (id: string) =>
  s.value?.parties.find((p) => p.id === id)?.name || "未指定";
const summary = computed(() => {
  try {
    return s.value && current.value
      ? internalSummary(s.value, current.value)
      : null;
  } catch {
    return null;
  }
});
const superseded = computed(
  () =>
    !!current.value &&
    agreements.value.some((a) => a.previousId === current.value!.id),
);
const receipts = computed(
  () =>
    s.value?.internalReceipts.filter((r) => r.agreementId === selected.value) ??
    [],
);
const duplicates = computed(() =>
  agreements.value.filter(
    (a) =>
      !a.voidedAt &&
      a.sourceType === form.sourceType &&
      a.sourceId === form.sourceId &&
      a.id !== previousId.value &&
      !agreements.value.some((v) => v.previousId === a.id),
  ),
);
function reset() {
  Object.assign(form, {
    name: "",
    sourceType: "cost",
    sourceId: "",
    burdenPartyId: "",
    quantity: 1,
    internalTotal: null,
    agreedUnit: null,
    differencePartyId: "",
    differenceTreatment: "",
    notes: "",
  });
  previousId.value = "";
  confirmed.value = false;
}
watch(
  () => s.value?.workspaceId,
  () => {
    reset();
    selected.value = "";
    notice.value = "";
    error.value = "";
  },
);
watch(
  () => form.sourceType,
  () => {
    if (!previousId.value) form.sourceId = "";
    confirmed.value = false;
  },
);
watch(
  () => form.sourceId,
  () => {
    const source = chosenSource.value;
    if (source && "quantity" in source && !previousId.value)
      form.quantity = source.quantity;
    confirmed.value = false;
  },
);
watch(
  () => JSON.stringify(form),
  () => (confirmed.value = false),
);
async function run(action: () => Promise<unknown>, message: string) {
  error.value = "";
  notice.value = "";
  try {
    await action();
    notice.value = message;
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "儲存失敗，原資料未更動。";
    return false;
  }
}
async function save() {
  if (
    await run(
      () =>
        catalog.createInternalAgreement(
          { ...form },
          previousId.value || undefined,
        ),
      "內部計價約定已保存；未產生收入、欠款或付款。",
    )
  ) {
    selected.value = agreements.value.at(-1)?.id || "";
    reset();
  }
}
function revise() {
  if (!current.value) return;
  const a = current.value;
  Object.assign(form, {
    name: a.name,
    sourceType: a.sourceType,
    sourceId: a.sourceId,
    burdenPartyId: a.burdenPartyId,
    quantity: a.quantity,
    internalTotal: a.internalTotal,
    agreedUnit: a.agreedUnit,
    differencePartyId: a.differencePartyId,
    differenceTreatment: a.differenceTreatment,
    notes: "",
  });
  previousId.value = a.id;
  confirmed.value = false;
}
async function receive() {
  if (!current.value) return;
  if (
    await run(
      () =>
        catalog.recordInternalReceipt({
          agreementId: selected.value,
          ...receipt,
        }),
      "已記錄實際內部收款；未計入銷售營收或代墊償還。",
    )
  )
    receipt.notes = "";
}
async function correct() {
  const done = await run(
    () =>
      correction.value.kind === "receipt"
        ? catalog.reverseInternalReceipt(
            correction.value.id,
            correction.value.reason,
          )
        : catalog.voidInternalAgreement(
            correction.value.id,
            correction.value.reason,
          ),
    "更正已保存，歷史仍保留。",
  );
  if (done) Object.assign(correction.value, { kind: "", id: "", reason: "" });
}
</script>
<template>
  <section class="section-block" aria-labelledby="internal-pricing-title">
    <div class="section-title">
      <div>
        <h2 id="internal-pricing-title">內部計價與約定回收</h2>
        <p>把實際成本、成員負擔、約定回收及收款分開核對。</p>
      </div>
    </div>
    <aside class="info-banner">
      <div>
        <strong>約定不是付款，也不自動代表欠款或利潤。</strong>
        <p>
          廠商付款請使用實際費用付款；代墊償還請使用代墊紀錄。這裡的實際收款只記合作成員之間的回收，不是顧客銷售收款。同一筆現金不要再重複登記為代墊還款或結算轉款。約定資料不會自動扣入分潤。
        </p>
      </div>
    </aside>
    <p v-if="notice" role="status" class="success-notice">{{ notice }}</p>
    <p v-if="error" role="alert" class="error-notice">{{ error }}</p>
    <form class="panel" @submit.prevent="confirmed = true">
      <h3>{{ previousId ? "追加約定版本" : "新增內部約定" }}</h3>
      <p>空白表示未知；確定無負擔或無回收才填 0。每件回收最多四位小數。</p>
      <fieldset :disabled="catalog.busy">
        <div class="grid">
          <div class="field">
            <label for="internal-name">約定名稱（必填）</label
            ><input
              id="internal-name"
              v-model="form.name"
              required
              maxlength="80"
              placeholder="例如：立牌內部負擔"
            />
          </div>
          <div class="field">
            <label for="internal-source-type">費用來源類型</label
            ><select
              id="internal-source-type"
              v-model="form.sourceType"
              :disabled="!!previousId"
            >
              <option value="cost">製作成本</option>
              <option value="artwork">柄圖費來源</option>
            </select>
          </div>
          <div class="field">
            <label for="internal-source">費用來源（必填）</label
            ><select
              id="internal-source"
              v-model="form.sourceId"
              :disabled="!!previousId"
              required
            >
              <option value="">請選擇</option>
              <option v-for="a in sources" :key="a.id" :value="a.id">
                {{ a.name }}（{{ a.code }}）
              </option></select
            ><small>保存當時來源快照；來源之後修改不會改寫舊約定。</small>
          </div>
          <div class="field">
            <label for="internal-burden">內部負擔對象</label
            ><select id="internal-burden" v-model="form.burdenPartyId">
              <option value="">未指定</option>
              <option v-for="p in s?.parties" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="internal-quantity">約定回收件數（必填）</label
            ><input
              id="internal-quantity"
              v-model.number="form.quantity"
              type="number"
              min="1"
              step="1"
              required
            />
          </div>
          <div class="field">
            <label for="internal-total">內部負擔總額（元，選填）</label
            ><input
              id="internal-total"
              v-model="form.internalTotal"
              type="number"
              min="0"
              step="1"
              @change="
                form.internalTotal =
                  ($event.target as HTMLInputElement).value === ''
                    ? null
                    : Number(($event.target as HTMLInputElement).value)
              "
            /><small>記錄合作約定的負擔，不自動變成應收款或代墊。</small>
          </div>
          <div class="field">
            <label for="internal-unit">約定每件回收額（元，選填）</label
            ><input
              id="internal-unit"
              :value="form.agreedUnit ?? ''"
              inputmode="decimal"
              placeholder="例如：20.1"
              @input="
                form.agreedUnit =
                  ($event.target as HTMLInputElement).value || null
              "
            />
          </div>
          <div class="field">
            <label for="internal-difference-party">回收與成本差額歸屬</label
            ><select
              id="internal-difference-party"
              v-model="form.differencePartyId"
            >
              <option value="">尚未指定</option>
              <option v-for="p in s?.parties" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="internal-difference">差額處理說明（選填）</label
            ><textarea
              id="internal-difference"
              v-model="form.differenceTreatment"
              maxlength="2000"
              rows="2"
              placeholder="例如：超出成本的20元另留待團務決定"
            />
          </div>
          <div class="field">
            <label for="internal-notes">約定／版本原因（必填）</label
            ><textarea
              id="internal-notes"
              v-model="form.notes"
              maxlength="2000"
              rows="2"
              required
            />
          </div>
        </div>
      </fieldset>
      <p v-if="duplicates.length" class="warning">
        此來源已存在其他有效約定，請確認不是重複回收；各約定對照的是來源全額成本，系統不會替你合併或分攤來源成本。
      </p>
      <div class="actions">
        <button class="button primary" :disabled="catalog.busy">
          預覽確認約定</button
        ><button
          v-if="previousId"
          type="button"
          class="button secondary"
          @click="reset"
        >
          取消追加版本
        </button>
      </div>
      <div v-if="confirmed" class="confirmation">
        <p>
          即將保存來源與約定快照。來源成本不會因此新增或扣除，內部負擔與回收也不自動視為已付款。
        </p>
        <button
          type="button"
          class="button primary"
          :disabled="catalog.busy"
          @click="save"
        >
          確認保存約定
        </button>
      </div>
    </form>
    <div class="panel">
      <h3>約定與實際回收核對</h3>
      <div class="field">
        <label for="internal-select">選擇約定版本</label
        ><select id="internal-select" v-model="selected">
          <option value="">請選擇</option>
          <option v-for="a in agreements" :key="a.id" :value="a.id">
            {{ a.name }}（{{ a.code }}）{{ a.voidedAt ? "・已作廢" : ""
            }}{{
              agreements.some((v) => v.previousId === a.id) ? "・舊版本" : ""
            }}
          </option>
        </select>
      </div>
      <template v-if="current && summary"
        ><p>
          來源快照：{{ current.sourceName }}；內部負擔對象：{{
            partyName(current.burdenPartyId)
          }}。{{ current.notes }}
        </p>
        <dl class="summary">
          <div>
            <dt>來源總成本快照（未分攤）</dt>
            <dd>{{ summary.sourceTotal ?? "未知" }} 元</dd>
          </div>
          <div>
            <dt>內部負擔總額</dt>
            <dd>{{ summary.internalTotal ?? "未知" }} 元</dd>
          </div>
          <div>
            <dt>內部負擔與來源差額</dt>
            <dd>{{ summary.burdenDifference ?? "未知" }} 元</dd>
          </div>
          <div>
            <dt>約定全部回收</dt>
            <dd>{{ summary.plannedTotal ?? "未知" }} 元</dd>
          </div>
          <div>
            <dt>回收與來源差額</dt>
            <dd>{{ summary.difference ?? "未知" }} 元</dd>
          </div>
          <div>
            <dt>累計實際回收</dt>
            <dd>{{ summary.collected }} 元</dd>
          </div>
          <div>
            <dt>約定與實收差額</dt>
            <dd>{{ summary.remaining ?? "未知" }} 元</dd>
          </div>
        </dl>
        <p>
          差額歸屬：{{ partyName(current.differencePartyId) }}；處理：{{
            current.differenceTreatment || "尚未指定"
          }}。{{
            summary.differenceResolved
              ? "已填差額處理依據。"
              : "差額仍待確認，不自動列作團費或收入。"
          }}
        </p>
        <div class="actions">
          <button
            v-if="!superseded && !current.voidedAt"
            type="button"
            class="button secondary"
            :disabled="catalog.busy"
            @click="revise"
          >
            追加約定版本</button
          ><button
            v-if="!superseded && !current.voidedAt"
            type="button"
            class="button secondary"
            @click="
              correction = { kind: 'agreement', id: current.id, reason: '' }
            "
          >
            作廢約定
          </button>
        </div>
        <form
          v-if="!superseded && !current.voidedAt"
          class="receipt"
          @submit.prevent="receive"
        >
          <h4>記錄已實際收到的內部回收款</h4>
          <p>
            只記已實際收款；不是顧客售出商品的收入。累計回收包含此約定前版紀錄。
          </p>
          <fieldset :disabled="catalog.busy">
            <div class="grid">
              <div class="field">
                <label for="internal-payer">實際付款人</label
                ><select id="internal-payer" v-model="receipt.payerId" required>
                  <option value="">請選擇</option>
                  <option v-for="p in s?.parties" :key="p.id" :value="p.id">
                    {{ p.name }}
                  </option>
                </select>
              </div>
              <div class="field">
                <label for="internal-collector">實際收款人</label
                ><select
                  id="internal-collector"
                  v-model="receipt.collectorId"
                  required
                >
                  <option value="">請選擇</option>
                  <option v-for="p in s?.parties" :key="p.id" :value="p.id">
                    {{ p.name }}
                  </option>
                </select>
              </div>
              <div class="field">
                <label for="internal-amount">本次已收到金額（整元）</label
                ><input
                  id="internal-amount"
                  v-model.number="receipt.amount"
                  type="number"
                  min="1"
                  step="1"
                  required
                />
              </div>
              <div class="field">
                <label for="internal-receipt-notes">本次收款說明（必填）</label
                ><input
                  id="internal-receipt-notes"
                  v-model="receipt.notes"
                  maxlength="2000"
                  required
                />
              </div>
            </div>
          </fieldset>
          <button class="button primary" :disabled="catalog.busy">
            記錄已收到款項
          </button>
        </form>
        <h4>本版實際收款紀錄</h4>
        <p v-if="!receipts.length">
          本版本尚無收款紀錄；累計金額仍包含前版有效收款。
        </p>
        <ul class="history">
          <li v-for="r in receipts" :key="r.id">
            {{ partyName(r.payerId) }} → {{ partyName(r.collectorId) }}：{{
              r.amount
            }}
            元；{{ r.notes }} <span v-if="r.reversesId">（沖銷紀錄）</span
            ><span
              v-else-if="s?.internalReceipts.some((x) => x.reversesId === r.id)"
              >（已沖銷）</span
            ><button
              v-else
              type="button"
              class="text-button"
              :disabled="catalog.busy"
              @click="correction = { kind: 'receipt', id: r.id, reason: '' }"
            >
              沖銷收款
            </button>
          </li>
        </ul>
      </template>
    </div>
    <form v-if="correction.id" class="confirmation" @submit.prevent="correct">
      <h3>確認{{ correction.kind === "receipt" ? "沖銷收款" : "作廢約定" }}</h3>
      <label for="internal-correction">原因（必填）</label
      ><textarea
        id="internal-correction"
        v-model="correction.reason"
        required
        maxlength="2000"
        rows="2"
      />
      <div class="actions">
        <button class="button primary" :disabled="catalog.busy">確認更正</button
        ><button
          class="button secondary"
          type="button"
          @click="correction = { kind: '', id: '', reason: '' }"
        >
          取消
        </button>
      </div>
    </form>
  </section>
</template>
<style scoped>
.panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  margin-top: 18px;
  display: grid;
  gap: 16px;
  min-width: 0;
}
.panel p,
.info-banner p {
  line-height: 1.9;
}
.grid {
  display: grid;
  gap: 16px;
}
.field {
  display: grid;
  gap: 8px;
  min-width: 0;
}
label {
  font-weight: 600;
}
input,
select,
textarea {
  font: inherit;
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 10px 12px;
  border: 1px solid #a6b79e;
  border-radius: 7px;
  color: var(--text);
  background: #fcfdf9;
}
textarea {
  resize: vertical;
}
fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.confirmation {
  border: 1px solid var(--line);
  padding: 16px;
  background: #f6f7f3;
  border-radius: 8px;
  margin: 16px 0;
  display: grid;
  gap: 12px;
}
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin: 0;
}
.summary div {
  border: 1px solid var(--line);
  padding: 12px;
  border-radius: 8px;
}
.summary dt {
  font-size: 14px;
}
.summary dd {
  margin: 8px 0 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.warning {
  background: #fff8db;
  padding: 12px;
  border: 1px solid #d7bf70;
  border-radius: 8px;
}
.receipt {
  border-top: 1px solid var(--line);
  padding-top: 16px;
  display: grid;
  gap: 16px;
}
.history {
  padding-left: 22px;
  line-height: 1.9;
}
.history li {
  padding: 8px 0;
  overflow-wrap: anywhere;
}
small {
  line-height: 1.8;
  color: #52614c;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (min-width: 760px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 520px) {
  .panel {
    padding: 16px;
  }
}
</style>
