<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import { eventSummary, stocktakeStale } from "../../domain/inventory/stocktake";
import type {
  StocktakeCountInput,
  StocktakeRecord,
} from "../../domain/models/catalog";
const catalog = useCatalogStore();
const form = reactive({ name: "", locationId: "", eventId: "", notes: "" });
const selected = ref(""),
  notice = ref(""),
  error = ref(""),
  confirmation = ref(false);
const counts = ref<StocktakeCountInput[]>([]);
const summaryEvent = ref("");
const take = computed(() =>
  catalog.snapshot?.stocktakes.find((t) => t.id === selected.value),
);
const summary = computed(() =>
  catalog.snapshot ? eventSummary(catalog.snapshot, summaryEvent.value) : null,
);
watch(
  () => catalog.snapshot?.workspaceId,
  () => {
    selected.value = "";
    counts.value = [];
    notice.value = "";
    error.value = "";
    confirmation.value = false;
    summaryEvent.value = "";
    Object.assign(form, { name: "", locationId: "", eventId: "", notes: "" });
  },
);
function edit(t: StocktakeRecord) {
  selected.value = t.id;
  counts.value = t.lines.map((l) => ({
    productId: l.productId,
    actual: l.actual,
    action: l.action,
    reason: l.reason,
  }));
  confirmation.value = false;
  error.value = "";
}
async function run(action: () => Promise<void>, message: string) {
  error.value = "";
  notice.value = "";
  try {
    await action();
    notice.value = message;
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法儲存盤點。";
    return false;
  }
}
async function create() {
  if (
    await run(
      () => catalog.startStocktake({ ...form }),
      "盤點單已建立，請逐項填入實點數量。",
    )
  ) {
    const t = catalog.snapshot?.stocktakes.at(-1);
    if (t) edit(t);
    form.name = "";
    form.notes = "";
  }
}
function inputCounts() {
  return counts.value.map((l) => ({
    ...l,
    actual: l.actual === ("" as unknown) ? null : l.actual,
  }));
}
async function save() {
  if (!take.value) return;
  await run(
    () => catalog.updateStocktake(take.value!.id, inputCounts()),
    "實點數量已儲存，尚未調整庫存。",
  );
}
async function finish() {
  if (!take.value) return;
  if (
    await run(
      () => catalog.closeStocktake(take.value!.id, inputCounts()),
      "盤點單已完成；只有明確選擇套用的差異才會調整庫存。",
    )
  ) {
    confirmation.value = false;
    const t = take.value;
    if (t) edit(t);
  }
}
const location = (id: string) =>
  catalog.snapshot?.locations.find((l) => l.id === id)?.name || "—";
const when = (s: string) =>
  new Date(s).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
</script>
<template>
  <section
    v-if="catalog.snapshot"
    class="stocktake-panel section-block"
    aria-labelledby="stocktake-heading"
  >
    <h2 id="stocktake-heading">收攤盤點與場次摘要</h2>
    <p>
      盤點會保存開始時的帳面數量。實點差額可留待查，或明確登記為庫存調整；不會當成銷售，也不會自動產生營收。
    </p>
    <p v-if="notice" role="status" class="success-notice">{{ notice }}</p>
    <p v-if="error" role="alert" class="error-notice">{{ error }}</p>
    <details>
      <summary>場次營收摘要</summary>
      <div class="field">
        <label for="summary-event">摘要場次</label
        ><select id="summary-event" v-model="summaryEvent">
          <option value="">未指定場次的交易</option>
          <option
            v-for="e in catalog.snapshot.events"
            :key="e.id"
            :value="e.id"
          >
            {{ e.name }}
          </option>
        </select>
      </div>
      <p v-if="summary">
        交易 {{ summary.count }} 筆（有效
        {{ summary.activeCount }} 筆）・原交易應收
        {{ summary.gross }} 元・已記錄全額退款
        {{ summary.refunds }} 元・有效營收 {{ summary.net }} 元。
      </p>
      <p>
        金額是此場次目前全部紀錄，包含跨日期交易；不是利潤或收款者手上現金。
      </p>
    </details>
    <details>
      <summary>建立盤點單</summary>
      <form @submit.prevent="create">
        <fieldset :disabled="catalog.busy">
          <div class="form-grid">
            <div class="field">
              <label for="take-name">盤點名稱</label
              ><input
                id="take-name"
                v-model="form.name"
                required
                maxlength="80"
                placeholder="例如：CWT-74 首日收攤"
              />
            </div>
            <div class="field">
              <label for="take-location">盤點庫位</label
              ><select id="take-location" v-model="form.locationId" required>
                <option value="">請選擇</option>
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
              <label for="take-event">盤點場次（選填）</label
              ><select id="take-event" v-model="form.eventId">
                <option value="">未指定</option>
                <option
                  v-for="e in catalog.snapshot.events"
                  :key="e.id"
                  :value="e.id"
                >
                  {{ e.name }}{{ e.archived ? "（已封存）" : "" }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="take-notes">盤點備註</label
              ><input id="take-notes" v-model="form.notes" maxlength="2000" />
            </div>
          </div>
          <button
            class="button primary"
            :disabled="
              !form.name.trim() ||
              !form.locationId ||
              !catalog.snapshot.products.length
            "
          >
            開始盤點並保存帳面快照
          </button>
        </fieldset>
      </form>
    </details>
    <div class="field">
      <label for="take-select">盤點紀錄</label
      ><select
        id="take-select"
        :value="selected"
        :disabled="catalog.busy"
        @change="
          edit(
            catalog.snapshot!.stocktakes.find(
              (t) => t.id === ($event.target as HTMLSelectElement).value,
            )!,
          )
        "
      >
        <option disabled value="">請選擇盤點單</option>
        <option
          v-for="t in [...catalog.snapshot.stocktakes].reverse()"
          :key="t.id"
          :value="t.id"
        >
          {{ t.name }}・{{ location(t.locationId) }}・{{
            t.completedAt ? "已完成" : "盤點中"
          }}
        </option>
      </select>
    </div>
    <template v-if="take"
      ><h3>{{ take.name }}</h3>
      <p>
        庫位：{{ location(take.locationId) }}；開始：{{
          when(take.createdAt)
        }}；{{
          take.completedAt ? "完成：" + when(take.completedAt) : "尚未完成"
        }}。
      </p>
      <p
        v-if="stocktakeStale(catalog.snapshot, take) && !take.completedAt"
        class="error-notice"
      >
        開始後此庫位已有異動。舊差額不能直接套用；可保留待查後完成，並重新建立盤點。
      </p>
      <p v-if="take.staleAtCompletion">
        此單完成時庫位已有後續異動，數字僅供保留當時核對紀錄。
      </p>
      <fieldset :disabled="catalog.busy || !!take.completedAt">
        <div class="take-lines">
          <article
            v-for="(line, i) in take.lines"
            :key="line.productId"
            class="take-line"
          >
            <h4>{{ line.productName }}</h4>
            <p>
              開始時帳面：{{ line.expected }}；差異：{{
                counts[i]?.actual === null
                  ? "尚未實點"
                  : counts[i]!.actual! - line.expected
              }}
            </p>
            <div class="field">
              <label :for="'take-actual-' + i"
                >{{ line.productName }}實點數量</label
              ><input
                :id="'take-actual-' + i"
                v-model.number="counts[i]!.actual"
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                placeholder="未清點請留白"
              />
            </div>
            <div class="field">
              <label :for="'take-action-' + i"
                >{{ line.productName }}差異處理</label
              ><select :id="'take-action-' + i" v-model="counts[i]!.action">
                <option value="pending">保留待查，不調整庫存</option>
                <option value="adjust">以實點數量調整庫存</option>
              </select>
            </div>
            <div class="field">
              <label :for="'take-reason-' + i"
                >{{ line.productName }}差異原因</label
              ><input
                :id="'take-reason-' + i"
                v-model="counts[i]!.reason"
                maxlength="2000"
                placeholder="套用差異時必填"
              />
            </div>
            <p v-if="line.adjustmentMovementId">已建立盤點差異調整紀錄。</p>
          </article>
        </div>
      </fieldset>
      <div v-if="!take.completedAt" class="actions">
        <button
          type="button"
          class="button secondary"
          :disabled="catalog.busy"
          @click="save"
        >
          儲存實點數量</button
        ><button
          type="button"
          class="button primary"
          :disabled="catalog.busy"
          @click="confirmation = true"
        >
          完成盤點
        </button>
      </div>
      <section
        v-if="confirmation && !take.completedAt"
        class="confirm"
        aria-label="盤點完成確認"
      >
        <h3>確認完成盤點</h3>
        <p>
          系統只會調整選擇「以實點數量調整庫存」的差額。空白或待查項目會保留，不會阻止完成。完成後此單不可再編輯，錯誤請新建盤點單。
        </p>
        <div class="actions">
          <button
            class="button secondary"
            :disabled="catalog.busy"
            @click="confirmation = false"
          >
            返回檢查</button
          ><button
            class="button primary"
            :disabled="catalog.busy"
            @click="finish"
          >
            確認完成並套用所選差異
          </button>
        </div>
      </section>
    </template>
    <p v-else-if="!catalog.snapshot.stocktakes.length">
      尚無盤點單。建立前請暫停此庫位的交易與調撥，完成清點後再繼續。
    </p>
  </section>
</template>
<style scoped>
.stocktake-panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  display: grid;
  gap: 16px;
}
.stocktake-panel p {
  line-height: 1.85;
}
.field {
  display: grid;
  gap: 8px;
}
input,
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
.form-grid,
.take-lines {
  display: grid;
  gap: 16px;
}
.take-line {
  border: 1px solid var(--line);
  padding: 16px;
  border-radius: 8px;
  display: grid;
  gap: 12px;
}
.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.confirm {
  background: #f4f7eb;
  border: 1px solid #b4c49e;
  padding: 16px;
  border-radius: 8px;
}
details > summary {
  cursor: pointer;
  min-height: 44px;
  padding: 12px 0;
  font-weight: 600;
}
button {
  margin-top: 12px;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (min-width: 760px) {
  .form-grid,
  .take-lines {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
