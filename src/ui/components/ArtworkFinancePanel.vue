<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import {
  previewArtworkAllocation,
  artworkUnitDisplay,
} from "../../domain/finance/artwork";
import { expenseReconciliation } from "../../domain/finance/payments";
import type {
  ArtworkAllocationInput,
  ExpensePaymentInput,
} from "../../domain/models/catalog";
const catalog = useCatalogStore();
const error = ref(""),
  notice = ref(""),
  selected = ref(""),
  confirming = ref(false);
const sourceForm = reactive({
  name: "",
  artworkId: "",
  amount: null as number | null,
  notes: "",
});
const allocation = reactive<ArtworkAllocationInput>({
  method: "unit-print",
  basis: "actual",
  targets: [],
  allowReplaceManual: false,
});
const payment = reactive<ExpensePaymentInput>({
  operationId: crypto.randomUUID(),
  category: "print",
  costId: "",
  artworkSourceId: "",
  payerId: "",
  recipient: "",
  amount: 0,
  notes: "",
});
const correction = reactive({
  kind: "" as "" | "allocation" | "source" | "payment",
  id: "",
  reason: "",
});
const source = computed(() =>
  catalog.snapshot?.artworkExpenses.find((a) => a.id === selected.value),
);
const active = computed(() =>
  source.value?.allocations.find((a) => !a.reversedAt),
);
const eligible = computed(
  () =>
    catalog.snapshot?.costs.filter(
      (c) =>
        !c.archived &&
        catalog.snapshot?.products.find((p) => p.id === c.productId)
          ?.artworkId === source.value?.artworkId,
    ) || [],
);
const preview = computed(() => {
  if (!source.value || !catalog.snapshot || active.value)
    return { targets: [], error: "" };
  try {
    return {
      targets: previewArtworkAllocation(
        catalog.snapshot,
        source.value,
        allocation,
      ),
      error: "",
    };
  } catch (e) {
    return { targets: [], error: e instanceof Error ? e.message : "無法試算" };
  }
});
const totals = computed(() => {
  if (!catalog.snapshot) return [];
  return [
    ...catalog.snapshot.costs.flatMap((c) =>
      (["print", "other"] as const).map((category) => ({
        name: c.name + (category === "print" ? "・印製費" : "・其他費用"),
        category,
        costId: c.id,
        artworkSourceId: "",
      })),
    ),
    ...catalog.snapshot.artworkExpenses
      .filter((a) => !a.voidedAt)
      .map((a) => ({
        name: a.name + "・柄圖費",
        category: "artwork" as const,
        costId: "",
        artworkSourceId: a.id,
      })),
  ].map((row) => ({
    ...row,
    ...expenseReconciliation(
      catalog.snapshot!,
      row.category,
      row.costId,
      row.artworkSourceId,
    ),
  }));
});
watch(selected, () => {
  allocation.targets = [];
  allocation.allowReplaceManual = false;
  confirming.value = false;
});
watch(
  () => catalog.snapshot?.workspaceId,
  () => {
    selected.value = "";
    error.value = "";
    notice.value = "";
    confirming.value = false;
    correction.kind = "";
    Object.assign(sourceForm, {
      name: "",
      artworkId: "",
      amount: null,
      notes: "",
    });
    Object.assign(payment, {
      operationId: crypto.randomUUID(),
      category: "print",
      costId: "",
      artworkSourceId: "",
      payerId: "",
      recipient: "",
      amount: 0,
      notes: "",
    });
  },
);
function toggle(costId: string, checked: boolean) {
  if (checked)
    allocation.targets.push({ costId, weight: "1", manualAmount: null });
  else
    allocation.targets = allocation.targets.filter((t) => t.costId !== costId);
  confirming.value = false;
}
async function run(action: () => Promise<void>, success: string) {
  error.value = "";
  notice.value = "";
  try {
    await action();
    notice.value = success;
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法儲存";
    return false;
  }
}
async function createSource() {
  if (sourceForm.amount === null) return;
  if (
    await run(
      () =>
        catalog.createArtworkExpense({
          ...sourceForm,
          amount: sourceForm.amount!,
        }),
      "柄圖費來源已建立，尚未分攤或產生付款。",
    )
  ) {
    selected.value = catalog.snapshot?.artworkExpenses.at(-1)?.id || "";
    sourceForm.name = "";
    sourceForm.amount = null;
    sourceForm.notes = "";
  }
}
async function apply() {
  if (
    await run(
      () =>
        catalog.allocateArtwork(selected.value, {
          ...allocation,
          targets: allocation.targets.map((t) => ({
            ...t,
            manualAmount:
              t.manualAmount === ("" as unknown) ? null : t.manualAmount,
          })),
        }),
      "柄圖費分攤已套用，精確分數與整元分攤分開保存。",
    )
  )
    confirming.value = false;
}
async function correct() {
  const c = correction;
  const action =
    c.kind === "allocation"
      ? () => catalog.undoArtworkAllocation(c.id, c.reason)
      : c.kind === "source"
        ? () => catalog.cancelArtworkExpense(c.id, c.reason)
        : () => catalog.undoExpensePayment(c.id, c.reason);
  if (await run(action, "已保存更正，原始歷史仍保留。")) correction.kind = "";
}
async function pay() {
  const value = {
    ...payment,
    costId: payment.category === "artwork" ? "" : payment.costId,
    artworkSourceId:
      payment.category === "artwork" ? payment.artworkSourceId : "",
  };
  if (
    await run(
      () => catalog.recordExpensePayment(value),
      "已記錄實際廠商付款，未自動建立代墊或新增成本。",
    )
  ) {
    payment.amount = 0;
    payment.notes = "";
    payment.operationId = crypto.randomUUID();
  }
}
const costName = (id: string) =>
  catalog.snapshot?.costs.find((c) => c.id === id)?.name || "—";
</script>
<template>
  <section
    v-if="catalog.snapshot"
    class="art-panel section-block"
    aria-labelledby="art-finance-title"
  >
    <h2 id="art-finance-title">柄圖費分攤與實際付款核對</h2>
    <p>
      柄圖來源金額只記一次，再分配到使用該圖的製作成本。實際付款、代墊本金與內部負擔分開記錄，不自動互相抵扣。
    </p>
    <p v-if="notice" role="status" class="success-notice">{{ notice }}</p>
    <p v-if="error" role="alert" class="error-notice">{{ error }}</p>
    <details>
      <summary>新增柄圖費來源</summary>
      <p>
        請先在商品建檔填入款式／圖樣，讓相關商品使用同一張柄圖。來源金額建立後不能直接改寫；登記錯誤可先撤銷分攤／付款，再作廢來源。
      </p>
      <form @submit.prevent="createSource">
        <fieldset :disabled="catalog.busy">
          <div class="grid">
            <div class="field">
              <label for="art-source-name">柄圖費名稱</label
              ><input
                id="art-source-name"
                v-model="sourceForm.name"
                required
                maxlength="80"
              />
            </div>
            <div class="field">
              <label for="art-source-artwork">使用的柄圖</label
              ><select
                id="art-source-artwork"
                v-model="sourceForm.artworkId"
                required
              >
                <option value="">請選擇</option>
                <option
                  v-for="a in catalog.snapshot.artworks"
                  :key="a.id"
                  :value="a.id"
                >
                  {{ a.name }}・{{ a.code }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="art-source-amount">本次柄圖費總額（元）</label
              ><input
                id="art-source-amount"
                v-model.number="sourceForm.amount"
                type="number"
                min="0"
                step="1"
                required
              />
            </div>
            <div class="field">
              <label for="art-source-notes">柄圖費備註</label
              ><input
                id="art-source-notes"
                v-model="sourceForm.notes"
                maxlength="2000"
              />
            </div>
          </div>
          <button class="button primary">建立柄圖費來源</button>
        </fieldset>
      </form>
    </details>
    <div class="field">
      <label for="art-source-select">分攤來源</label
      ><select
        id="art-source-select"
        v-model="selected"
        :disabled="catalog.busy"
      >
        <option value="">請選擇</option>
        <option
          v-for="a in catalog.snapshot.artworkExpenses"
          :key="a.id"
          :value="a.id"
        >
          {{ a.name }}・{{ a.amount }}元{{ a.voidedAt ? "（已作廢）" : "" }}
        </option>
      </select>
    </div>
    <template v-if="source"
      ><p>
        來源金額 {{ source.amount }} 元；{{
          source.voidedAt ? "已作廢" : active ? "分攤生效中" : "尚無生效分攤"
        }}。
      </p>
      <template v-if="!source.voidedAt && !active"
        ><fieldset :disabled="catalog.busy">
          <div class="grid">
            <div class="field">
              <label for="art-method">柄圖分攤方式</label
              ><select
                id="art-method"
                v-model="allocation.method"
                @change="confirming = false"
              >
                <option value="unit-print">按各品項單件印製成本比例</option>
                <option value="total-print">按製作印製總額比例</option>
                <option value="equal">按成本品項平均</option>
                <option value="custom">自訂權重</option>
                <option value="manual">人工指定整元金額</option>
              </select>
            </div>
            <div class="field">
              <label for="art-basis">印製費權重基準</label
              ><select
                id="art-basis"
                v-model="allocation.basis"
                @change="confirming = false"
              >
                <option value="actual">實際印製費</option>
                <option value="estimated">預估印製費</option>
              </select>
            </div>
          </div>
          <p>
            單件成本比例＝柄圖費 ×（此批印製總額 ÷ 此批數量）÷
            各批單件印製成本合計；各批製作數量分別計算。
          </p>
          <p v-if="!eligible.length">
            沒有使用此圖的啟用成本紀錄。請先建立相關商品的製作成本。
          </p>
          <div v-for="c in eligible" :key="c.id" class="target">
            <label class="check"
              ><input
                type="checkbox"
                :checked="allocation.targets.some((t) => t.costId === c.id)"
                @change="
                  toggle(c.id, ($event.target as HTMLInputElement).checked)
                "
              />{{ c.name }}・{{ c.quantity }}件・目前柄圖費{{
                c.artworkAllocated ?? "未知"
              }}元{{ c.artworkAllocation ? "（已由分攤管理）" : "" }}</label
            ><template
              v-for="t in allocation.targets.filter((t) => t.costId === c.id)"
              :key="t.costId"
              ><div v-if="allocation.method === 'custom'" class="field">
                <label :for="'art-weight-' + c.id">{{ c.name }}權重</label
                ><input
                  :id="'art-weight-' + c.id"
                  v-model="t.weight"
                  inputmode="decimal"
                  @input="confirming = false"
                />
              </div>
              <div v-if="allocation.method === 'manual'" class="field">
                <label :for="'art-manual-' + c.id">{{ c.name }}人工分攤額</label
                ><input
                  :id="'art-manual-' + c.id"
                  v-model.number="t.manualAmount"
                  type="number"
                  min="0"
                  step="1"
                  @input="confirming = false"
                /></div
            ></template>
          </div>
          <label class="check"
            ><input
              v-model="allocation.allowReplaceManual"
              type="checkbox"
              @change="confirming = false"
            />我確認取代所選成本原有的人工柄圖費（撤銷分攤時會還原）</label
          >
        </fieldset>
        <p v-if="preview.error">{{ preview.error }}</p>
        <div v-if="preview.targets.length">
          <h3>分攤預覽</h3>
          <p v-for="t in preview.targets" :key="t.costId">
            {{ costName(t.costId) }}：精確分攤 {{ t.exactAmount.numerator }}／{{
              t.exactAmount.denominator
            }}
            元；整元分攤 {{ t.integerAmount }} 元；單件柄圖成本約
            {{ artworkUnitDisplay(t) }} 元。
          </p>
          <p>
            單件成本以精確分數計算；整元分攤採最大餘數法，尾差相同按固定成本ID排序，合計等於來源總額。
          </p>
          <button
            class="button primary"
            :disabled="catalog.busy"
            @click="confirming = true"
          >
            確認分攤預覽
          </button>
          <section v-if="confirming" class="confirm" aria-label="柄圖分攤確認">
            <p>
              套用後會管理所選成本的柄圖費；要變更其數量或印製基準，需先撤銷本次分攤。此操作不會產生付款、代墊或庫存。
            </p>
            <button class="button secondary" @click="confirming = false">
              返回檢查</button
            ><button
              class="button primary"
              :disabled="catalog.busy"
              @click="apply"
            >
              套用柄圖費分攤
            </button>
          </section>
        </div></template
      >
      <article
        v-for="a in [...source.allocations].reverse()"
        :key="a.version"
        class="target"
      >
        <h3>
          分攤版本 {{ a.version }}・{{ a.reversedAt ? "已撤銷" : "生效" }}
        </h3>
        <p v-for="t in a.targets" :key="t.costId">
          {{ costName(t.costId) }}：整元
          {{ t.integerAmount }} 元・單件精確成本約
          {{ artworkUnitDisplay(t) }} 元。
        </p>
        <p v-if="a.reversedAt">撤銷原因：{{ a.reverseReason }}</p>
        <button
          v-else
          class="button secondary"
          :disabled="catalog.busy"
          @click="
            Object.assign(correction, {
              kind: 'allocation',
              id: source.id,
              reason: '',
            })
          "
        >
          撤銷此分攤並還原原值
        </button>
      </article>
      <button
        v-if="!source.voidedAt && !active"
        class="text-button"
        :disabled="catalog.busy"
        @click="
          Object.assign(correction, {
            kind: 'source',
            id: source.id,
            reason: '',
          })
        "
      >
        作廢此柄圖費來源
      </button></template
    >
    <details>
      <summary>記錄已實際支付的廠商款項</summary>
      <p>
        只記已付款。付款不重複增加成本，不自動變成他人的代墊欠款；需要追收時另在代墊區明確登記。
      </p>
      <form @submit.prevent="pay">
        <fieldset :disabled="catalog.busy">
          <div class="grid">
            <div class="field">
              <label for="expense-category">付款費用類別</label
              ><select id="expense-category" v-model="payment.category">
                <option value="print">印製費</option>
                <option value="other">其他製作費用</option>
                <option value="artwork">柄圖費來源</option>
              </select>
            </div>
            <div v-if="payment.category !== 'artwork'" class="field">
              <label for="expense-cost">付款成本來源</label
              ><select id="expense-cost" v-model="payment.costId" required>
                <option value="">請選擇</option>
                <option
                  v-for="c in catalog.snapshot.costs"
                  :key="c.id"
                  :value="c.id"
                >
                  {{ c.name }}{{ c.archived ? "（已封存）" : "" }}
                </option>
              </select>
            </div>
            <div v-else class="field">
              <label for="expense-artwork">付款柄圖費來源</label
              ><select
                id="expense-artwork"
                v-model="payment.artworkSourceId"
                required
              >
                <option value="">請選擇</option>
                <option
                  v-for="a in catalog.snapshot.artworkExpenses.filter(
                    (a) => !a.voidedAt,
                  )"
                  :key="a.id"
                  :value="a.id"
                >
                  {{ a.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="expense-payer">實際廠商付款人</label
              ><select id="expense-payer" v-model="payment.payerId" required>
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
              <label for="expense-recipient">實際收款廠商／對象</label
              ><input
                id="expense-recipient"
                v-model="payment.recipient"
                required
                maxlength="120"
              />
            </div>
            <div class="field">
              <label for="expense-paid-amount">已實付金額（元）</label
              ><input
                id="expense-paid-amount"
                v-model.number="payment.amount"
                type="number"
                min="1"
                step="1"
                required
              />
            </div>
            <div class="field">
              <label for="expense-paid-notes">付款註記</label
              ><input
                id="expense-paid-notes"
                v-model="payment.notes"
                maxlength="2000"
              />
            </div>
          </div>
          <button class="button primary">記錄廠商實際付款</button>
        </fieldset>
      </form>
    </details>
    <details>
      <summary>費用與付款核對</summary>
      <p>
        差額＝已知實際費用－已付款。正數表示尚未付款，負數表示多付款待查；費用未知時不假設為0。柄圖費只按來源總額核對，不把各成本分攤額再次當作付款來源。
      </p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>費用來源</th>
              <th>實際費用</th>
              <th>已付款</th>
              <th>差額</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in totals"
              :key="r.category + r.costId + r.artworkSourceId"
            >
              <td>{{ r.name }}</td>
              <td>{{ r.expected ?? "未知" }}</td>
              <td>{{ r.paid }}</td>
              <td>{{ r.difference ?? "尚無法核對" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        內部計價、負擔者約定及代墊餘額另列，這裡不是完整現金帳或可分配利潤。
      </p>
    </details>
    <details>
      <summary>廠商付款歷史</summary>
      <article
        v-for="p in [...catalog.snapshot.expensePayments].reverse()"
        :key="p.id"
        class="target"
      >
        <p>
          {{ p.code }}・{{ p.recipient }}・{{ p.amount }}元・{{
            p.reversedAt ? "已沖銷" : "有效"
          }}；{{ p.notes }}
        </p>
        <p v-if="p.reversedAt">沖銷原因：{{ p.reverseReason }}</p>
        <button
          v-else
          class="button secondary"
          :disabled="catalog.busy"
          @click="
            Object.assign(correction, { kind: 'payment', id: p.id, reason: '' })
          "
        >
          沖銷廠商付款紀錄
        </button>
      </article>
    </details>
    <section v-if="correction.kind" class="confirm" aria-label="費用更正確認">
      <h3>
        確認{{
          correction.kind === "allocation"
            ? "撤銷分攤"
            : correction.kind === "source"
              ? "作廢來源"
              : "沖銷付款"
        }}
      </h3>
      <div class="field">
        <label for="expense-correction-reason">費用更正原因</label
        ><input
          id="expense-correction-reason"
          v-model="correction.reason"
          maxlength="2000"
        />
      </div>
      <button class="button secondary" @click="correction.kind = ''">
        返回</button
      ><button
        class="button primary"
        :disabled="catalog.busy || !correction.reason.trim()"
        @click="correct"
      >
        確認保存費用更正
      </button>
    </section>
  </section>
</template>
<style scoped>
.art-panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  display: grid;
  gap: 16px;
}
.art-panel p {
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.field {
  display: grid;
  gap: 8px;
}
.grid {
  display: grid;
  gap: 16px;
}
input:not([type="checkbox"]),
select {
  width: 100%;
  min-height: 46px;
  border: 1px solid #acbda8;
  border-radius: 7px;
  padding: 10px;
  font: inherit;
  background: #fcfdf9;
  min-width: 0;
}
fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.check {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  line-height: 1.7;
}
.check input {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.target,
.confirm {
  border: 1px solid var(--line);
  padding: 16px;
  border-radius: 8px;
  margin: 12px 0;
}
.confirm {
  background: #f4f7eb;
}
details > summary {
  cursor: pointer;
  min-height: 44px;
  padding: 12px 0;
  font-weight: 600;
}
button {
  margin: 12px 8px 0 0;
}
.table-scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td,
th {
  border: 1px solid var(--line);
  padding: 10px;
  text-align: left;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (min-width: 760px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
