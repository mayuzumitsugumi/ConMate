<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import { batchCostReport } from "../../domain/finance/batch-costs";
const catalog = useCatalogStore();
const form = reactive({ batchId: "", costId: "", notes: "" });
const confirming = ref(false),
  notice = ref(""),
  error = ref("");
const receipts = computed(
  () =>
    catalog.snapshot?.movements.filter(
      (m, index) =>
        m.kind === "receipt" &&
        index >= catalog.snapshot!.batchTrackingStart &&
        !catalog.snapshot!.movements.some((r) => r.reversesId === m.id),
    ) ?? [],
);
const selected = computed(() =>
  receipts.value.find((m) => m.id === form.batchId),
);
const eligible = computed(
  () =>
    catalog.snapshot?.costs.filter(
      (c) =>
        !c.archived &&
        c.productId === selected.value?.productId &&
        c.quantity === selected.value?.quantity &&
        !catalog.snapshot!.batchCostVersions.some(
          (v) => v.costId === c.id && v.batchId !== form.batchId,
        ),
    ) ?? [],
);
const versions = computed(
  () =>
    catalog.snapshot?.batchCostVersions.filter(
      (v) => v.batchId === form.batchId,
    ) ?? [],
);
const chosenCost = computed(() =>
  eligible.value.find((c) => c.id === form.costId),
);
const report = computed(() => {
  try {
    return {
      data: catalog.snapshot ? batchCostReport(catalog.snapshot) : null,
      error: "",
    };
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : "無法計算批次成本。",
    };
  }
});
function batchName(id: string) {
  const m = catalog.snapshot?.movements.find((m) => m.id === id);
  return m ? `${m.batchName || m.code}（${m.code}）` : "舊資料／來源未知";
}
function productName(id: string) {
  return (
    catalog.snapshot?.products.find((p) => p.id === id)?.name || "未知商品"
  );
}
function locationName(id: string) {
  return (
    catalog.snapshot?.locations.find((l) => l.id === id)?.name || "未知庫位"
  );
}
function when(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}
watch(
  () => catalog.snapshot?.workspaceId,
  () => {
    Object.assign(form, { batchId: "", costId: "", notes: "" });
    confirming.value = false;
    notice.value = "";
    error.value = "";
  },
);
watch(
  () => form.batchId,
  () => {
    form.costId = "";
    confirming.value = false;
  },
);
watch(
  () => [form.costId, form.notes],
  () => {
    confirming.value = false;
  },
);
async function save() {
  if (catalog.busy || !selected.value) return;
  notice.value = "";
  error.value = "";
  try {
    await catalog.saveBatchCost(form.batchId, form.costId, form.notes);
    notice.value = form.costId
      ? "批次成本版本已保存，之後的出庫將依此版本計算。"
      : "已保存解除連結版本，之後的成本將列為未知。";
    confirming.value = false;
    form.notes = "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "儲存失敗，原資料未更動。";
  }
}
</script>
<template>
  <section class="section-block" aria-labelledby="batch-cost-title">
    <div class="section-title">
      <div>
        <h2 id="batch-cost-title">批次成本與已售成本</h2>
        <p>把明確的製作成本連到實物入庫來源，依實際出庫批次核對成本。</p>
      </div>
    </div>
    <aside class="info-banner">
      <div>
        <strong>只有明確連結後的交易才能取得批次成本。</strong>
        <p>
          每次連結保存當時成本快照。後來修改成本或重新連結，不會回填舊銷售；舊來源或不完整費用仍列為未知。損壞退貨成本另列核對，不替你決定損失負擔。此處不新增付款、代墊、庫存或分潤，也不自動把已售成本扣入結算工作單。
        </p>
      </div>
    </aside>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="error || report.error" class="error-notice" role="alert">
      {{ error || report.error }}
    </p>
    <form class="panel" @submit.prevent="confirming = true">
      <h3>設定之後使用的成本版本</h3>
      <fieldset :disabled="catalog.busy">
        <div class="field">
          <label for="batch-cost-receipt">入庫批次（必填）</label
          ><select id="batch-cost-receipt" v-model="form.batchId" required>
            <option value="">選擇製作入庫來源</option>
            <option v-for="m in receipts" :key="m.id" :value="m.id">
              {{ productName(m.productId) }} · {{ batchName(m.id) }} ·
              {{ m.quantity }} 件
            </option>
          </select>
        </div>
        <p v-if="!receipts.length">
          尚無可連結的製作入庫。請先在庫存頁記錄新的製作入庫；舊來源未知庫存不會推算成製作批次。
        </p>
        <div class="field">
          <label for="batch-cost-record">製作成本紀錄</label
          ><select
            id="batch-cost-record"
            v-model="form.costId"
            :disabled="!selected"
          >
            <option value="">解除連結／之後成本未知</option>
            <option v-for="c in eligible" :key="c.id" :value="c.id">
              {{ c.name }}（{{ c.code }}） · {{ c.quantity }} 件
            </option></select
          ><small
            >只顯示同商品、製作數量與這次入庫一致且未封存的成本紀錄。費用不完整時允許保存，但不會視為零成本。</small
          >
        </div>
        <div class="field">
          <label for="batch-cost-notes">版本說明（必填）</label
          ><textarea
            id="batch-cost-notes"
            v-model="form.notes"
            rows="2"
            required
            maxlength="2000"
            placeholder="例如：依廠商結算單確認這批印製費"
          />
        </div>
      </fieldset>
      <button
        class="button secondary"
        :disabled="catalog.busy || !selected || !form.notes.trim()"
      >
        預覽連結
      </button>
      <section
        v-if="confirming && selected"
        class="confirmation"
        aria-labelledby="batch-cost-confirm"
      >
        <h4 id="batch-cost-confirm">確認保存新的成本版本？</h4>
        <p>
          入庫來源：{{ batchName(selected.id) }}；數量
          {{ selected.quantity }} 件。
        </p>
        <p>
          成本來源：{{ chosenCost ? chosenCost.name : "未連結（成本未知）" }}。
        </p>
        <p>
          只對保存之後的出庫生效，歷史銷售維持當時版本。若選錯來源，請再建一個版本更正，不會刪除舊版本。
        </p>
        <div class="actions">
          <button
            type="button"
            class="button secondary"
            :disabled="catalog.busy"
            @click="confirming = false"
          >
            取消</button
          ><button
            type="button"
            class="button primary"
            :disabled="catalog.busy"
            @click="save"
          >
            確認保存成本版本
          </button>
        </div>
      </section>
    </form>
    <section
      v-if="form.batchId"
      class="panel history"
      aria-labelledby="batch-cost-history"
    >
      <h3 id="batch-cost-history">此批次版本紀錄</h3>
      <p v-if="!versions.length">尚未建立版本；相關成本保持未知。</p>
      <ol v-else class="version-list">
        <li v-for="(v, i) in versions" :key="v.id">
          <strong
            >{{ v.code }}
            {{ i === versions.length - 1 ? " · 最新版本" : "" }}</strong
          >
          <p>
            {{ when(v.createdAt) }} · 成本來源：{{ v.costName || "未連結" }}
          </p>
          <p>
            總額：{{
              v.exactTotal
                ? `${v.exactTotal.numerator} ÷ ${v.exactTotal.denominator} 元（精確值）`
                : "未知"
            }}
            · {{ v.quantity }} 件
          </p>
          <p>
            生效起點：已保存
            {{ v.effectiveMovementCount }} 筆異動之後；先前出庫不重算。
          </p>
          <p class="notes">{{ v.notes }}</p>
        </li>
      </ol>
    </section>
    <template v-if="report.data">
      <section class="panel report" aria-labelledby="batch-sales-title">
        <h3 id="batch-sales-title">銷售成本核對</h3>
        <p>
          已知成本合計：{{ report.data.totalKnownCost }} 元 · 成本未知數量：{{
            report.data.totalUnknownQuantity
          }}
          件。已知部分不是完整總成本。
        </p>
        <p v-if="!report.data.sales.length">尚無銷售明細。</p>
        <div
          v-else
          class="table-scroll"
          tabindex="0"
          role="region"
          aria-label="銷售批次成本明細"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">交易／商品</th>
                <th scope="col">銷售與退回</th>
                <th scope="col">營收與退款</th>
                <th scope="col">批次成本</th>
                <th scope="col">成本扣除後差額</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in report.data.sales" :key="r.lineId">
                <th scope="row">{{ r.saleCode }}<br />{{ r.productName }}</th>
                <td>
                  售出 {{ r.soldQuantity }} 件<br />退回
                  {{ r.returnedQuantity }} 件可售品<br />損壞退貨
                  {{ r.damagedQuantity }} 件
                </td>
                <td>原營收 {{ r.gross }} 元<br />退款 {{ r.refunded }} 元</td>
                <td>
                  已知售出成本 {{ r.knownCost }} 元<br />退回後已知成本
                  {{ r.netKnownCost }} 元<br />未知
                  {{ r.unknownQuantity }} 件<br /><small
                    >其中損壞退貨已知成本 {{ r.damagedKnownCost }} 元、未知
                    {{ r.damagedUnknownQuantity }} 件（不重複加總）</small
                  >
                </td>
                <td>
                  {{ r.margin === null ? "尚無法完整試算" : r.margin + " 元"
                  }}<br /><small
                    >營收減未回可售庫存的成本；不是會計損失認列或分配決定</small
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel report" aria-labelledby="batch-stock-title">
        <h3 id="batch-stock-title">現存批次成本參考</h3>
        <p>
          依目前批次版本顯示，尚未連結或費用未完整時為未知；不會回填歷史售出成本。
        </p>
        <p v-if="!report.data.stock.length">尚無現存批次數量。</p>
        <div
          v-else
          class="table-scroll"
          tabindex="0"
          role="region"
          aria-label="現存批次成本"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">商品／批次</th>
                <th scope="col">庫位</th>
                <th scope="col">現存數量</th>
                <th scope="col">單件成本</th>
                <th scope="col">現存成本參考</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in report.data.stock"
                :key="r.batchId + '-' + r.locationId"
              >
                <th scope="row">
                  {{ productName(r.productId) }}<br />{{ batchName(r.batchId) }}
                </th>
                <td>{{ locationName(r.locationId) }}</td>
                <td>{{ r.quantity }} 件</td>
                <td>{{ r.unitCost === null ? "未知" : r.unitCost + " 元" }}</td>
                <td>{{ r.value === null ? "未知" : r.value + " 元" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </section>
</template>
<style scoped>
.panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  margin-top: 18px;
  overflow-wrap: anywhere;
}
.panel p,
.section-title p {
  line-height: 1.85;
}
.field {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
}
label {
  font-weight: 600;
}
select,
textarea {
  font: inherit;
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 10px 12px;
  background: #fcfdf9;
  border: 1px solid #a6b79e;
  border-radius: 7px;
  color: var(--text);
}
textarea {
  resize: vertical;
}
fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
small {
  color: #52614c;
  line-height: 1.8;
}
.confirmation {
  background: #f6f7f3;
  border: 1px solid var(--line);
  padding: 16px;
  border-radius: 8px;
  margin-top: 18px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.version-list {
  padding-left: 24px;
}
.version-list li {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.notes {
  white-space: pre-wrap;
}
.table-scroll {
  overflow-x: auto;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
  min-width: 680px;
}
th,
td {
  padding: 12px;
  text-align: left;
  vertical-align: top;
  border: 1px solid var(--line);
  line-height: 1.8;
}
thead {
  background: #f1f5eb;
}
tbody th {
  font-weight: 500;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (max-width: 520px) {
  .panel {
    padding: 16px;
  }
}
</style>
