<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
import {
  queryOperationalReport,
  queryCashFlow,
  type ReportGroupBy,
} from "../../domain/reports/operations";
import { downloadReport } from "../../application/download-report";
const workspaces = useWorkspaceStore(),
  catalog = useCatalogStore();
const ALL = "__all__";
const filters = reactive({
  fromDate: "",
  toDate: "",
  eventId: ALL,
  creatorId: ALL,
  projectId: ALL,
  productId: ALL,
  groupBy: "product" as ReportGroupBy,
});
const tab = ref<"sales" | "cash">("sales"),
  exporting = ref(false),
  notice = ref(""),
  actionError = ref("");
const generatedAt = ref(new Date().toISOString());
const lineLimit = ref(200),
  stockLimit = ref(200),
  cashLimit = ref(200);
function chosen(id: string) {
  return id === ALL ? undefined : id;
}
const query = computed(() => {
  if (!catalog.snapshot) return { report: null, cash: null, error: "" };
  try {
    const dates = {
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      eventId: chosen(filters.eventId),
    };
    return {
      report: queryOperationalReport(
        catalog.snapshot,
        {
          ...dates,
          creatorId: chosen(filters.creatorId),
          projectId: chosen(filters.projectId),
          productId: chosen(filters.productId),
          groupBy: filters.groupBy,
        },
        generatedAt.value,
      ),
      cash: queryCashFlow(catalog.snapshot, dates, generatedAt.value),
      error: "",
    };
  } catch (e) {
    return {
      report: null,
      cash: null,
      error: e instanceof Error ? e.message : "無法建立報表，請檢查篩選條件。",
    };
  }
});
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    Object.assign(filters, {
      fromDate: "",
      toDate: "",
      eventId: ALL,
      creatorId: ALL,
      projectId: ALL,
      productId: ALL,
      groupBy: "product",
    });
    notice.value = "";
    actionError.value = "";
    if (id) await refresh();
  },
  { immediate: true },
);
watch(filters, () => {
  lineLimit.value = 200;
  stockLimit.value = 200;
  cashLimit.value = 200;
  notice.value = "";
});
async function refresh() {
  if (!workspaces.activeWorkspaceId) return;
  await catalog.load(workspaces.activeWorkspaceId);
  generatedAt.value = new Date().toISOString();
}
async function download() {
  if (exporting.value || !query.value.report || !query.value.cash) return;
  notice.value = "";
  actionError.value = "";
  exporting.value = true;
  try {
    await downloadReport(query.value.report, query.value.cash);
    notice.value =
      "已產生目前篩選結果並發起下載。這是閱讀用營運報表，不是可還原的專案備份；請確認檔案已保存。";
  } catch (e) {
    actionError.value =
      e instanceof Error ? e.message : "報表產生失敗，原資料未更動。";
  } finally {
    exporting.value = false;
  }
}
function when(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
const kinds = {
  sale: "成交實收",
  exchange: "換購實際差額",
  refund: "實際退款",
  cancel: "取消退款",
};
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">CHECK THE NUMBERS TOGETHER</div>
      <h1>營運報表</h1>
      <p>分開核對銷售成本與實際收退款，保留來源與未知項目。</p>
    </div>
  </section>
  <section v-if="!workspaces.activeWorkspaceId" class="info-banner">
    <div>
      <h2>先選擇或建立工作區</h2>
      <p>報表只讀取所選工作區，不會新增交易或改動庫存。</p>
      <RouterLink class="button primary" to="/">前往工作區總覽</RouterLink>
    </div>
  </section>
  <template v-else>
    <section
      class="report-panel section-block"
      aria-labelledby="report-filters-title"
    >
      <h2 id="report-filters-title">查詢範圍</h2>
      <div class="filters-grid">
        <div class="field">
          <label for="report-workspace">報表工作區</label
          ><select
            id="report-workspace"
            :value="workspaces.activeWorkspaceId"
            :disabled="catalog.busy || exporting"
            @change="
              workspaces.select(($event.target as HTMLSelectElement).value)
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
        <div class="field">
          <label for="report-from">開始日期（台灣時間）</label
          ><input id="report-from" v-model="filters.fromDate" type="date" />
        </div>
        <div class="field">
          <label for="report-to">結束日期（台灣時間，含當日）</label
          ><input id="report-to" v-model="filters.toDate" type="date" />
        </div>
        <div class="field">
          <label for="report-event">活動篩選</label
          ><select id="report-event" v-model="filters.eventId">
            <option :value="ALL">全部活動</option>
            <option
              v-for="o in query.report?.choices.events || []"
              :key="o.id"
              :value="o.id"
            >
              {{ o.label }}
            </option>
          </select>
        </div>
      </div>
      <p>
        日期留白表示不限。銷售頁籤按成交日期選交易；收退款頁籤按每次款項日期查詢，兩者不一定相等。
      </p>
      <div class="actions">
        <button
          type="button"
          class="button secondary"
          :disabled="catalog.busy || exporting"
          @click="refresh"
        >
          重新讀取資料</button
        ><button
          type="button"
          class="button primary"
          :disabled="exporting || !query.report || !query.cash"
          @click="download"
        >
          {{ exporting ? "正在產生報表…" : "匯出目前篩選報表（Excel）" }}
        </button>
      </div>
      <p v-if="query.report" class="muted">
        資料修訂 {{ query.report.sourceRevision }} · 產生時間
        {{
          when(query.report.generatedAt)
        }}。匯出同時包含兩頁籤的結果與各自查詢定義。
      </p>
    </section>
    <p v-if="catalog.busy && !catalog.snapshot" role="status">
      正在讀取工作區…
    </p>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p
      v-if="catalog.error || query.error || actionError"
      class="error-notice"
      role="alert"
    >
      {{ actionError || query.error || catalog.error }}
    </p>
    <template v-if="query.report && query.cash">
      <nav class="report-tabs" aria-label="報表類型">
        <button
          class="button"
          :class="tab === 'sales' ? 'primary' : 'secondary'"
          :aria-pressed="tab === 'sales'"
          @click="tab = 'sales'"
        >
          銷售與成本</button
        ><button
          class="button"
          :class="tab === 'cash' ? 'primary' : 'secondary'"
          :aria-pressed="tab === 'cash'"
          @click="tab = 'cash'"
        >
          實際收退款
        </button>
      </nav>
      <template v-if="tab === 'sales'">
        <section
          class="report-panel section-block"
          aria-labelledby="sales-report-title"
        >
          <h2 id="sales-report-title">銷售與成本</h2>
          <p>
            按成交日期選取交易，納入這些交易截至本次資料快照的全部退款／換購折抵，可能包含日期範圍以外的後續紀錄。
          </p>
          <div class="filters-grid">
            <div class="field">
              <label for="report-creator">成交時創作者</label
              ><select id="report-creator" v-model="filters.creatorId">
                <option :value="ALL">全部創作者</option>
                <option
                  v-for="o in query.report.choices.creators"
                  :key="o.id"
                  :value="o.id"
                >
                  {{ o.label }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="report-project">商品目前企劃</label
              ><select id="report-project" v-model="filters.projectId">
                <option :value="ALL">全部企劃</option>
                <option
                  v-for="o in query.report.choices.projects"
                  :key="o.id"
                  :value="o.id"
                >
                  {{ o.label }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="report-product">商品篩選</label
              ><select id="report-product" v-model="filters.productId">
                <option :value="ALL">全部商品</option>
                <option
                  v-for="o in query.report.choices.products"
                  :key="o.id"
                  :value="o.id"
                >
                  {{ o.label }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="report-group">分組方式</label
              ><select id="report-group" v-model="filters.groupBy">
                <option value="product">商品</option>
                <option value="creator">成交時創作者</option>
                <option value="project">商品目前企劃</option>
                <option value="event">活動</option>
              </select>
            </div>
          </div>
          <dl class="metrics" aria-label="銷售總計">
            <div>
              <dt>原成交額</dt>
              <dd>{{ query.report.totals.gross }} 元</dd>
            </div>
            <div>
              <dt>退款／換購折抵</dt>
              <dd>{{ query.report.totals.refunded }} 元</dd>
            </div>
            <div>
              <dt>退款後營收</dt>
              <dd>{{ query.report.totals.netRevenue }} 元</dd>
            </div>
            <div>
              <dt>原交付數量</dt>
              <dd>{{ query.report.totals.soldQuantity }}</dd>
            </div>
            <div>
              <dt>可售退回／損壞退回</dt>
              <dd>
                {{ query.report.totals.restockQuantity }} ／
                {{ query.report.totals.damagedQuantity }}
              </dd>
            </div>
            <div>
              <dt>未知成本數量</dt>
              <dd>{{ query.report.totals.unknownCostQuantity }}</dd>
            </div>
            <div>
              <dt>未回庫成本已知小計</dt>
              <dd>{{ query.report.totals.netKnownCost }} 元</dd>
            </div>
            <div>
              <dt>損壞退貨成本已知小計</dt>
              <dd>{{ query.report.totals.damagedKnownCost }} 元</dd>
            </div>
            <div>
              <dt>營收減未回庫成本</dt>
              <dd>
                {{
                  query.report.totals.revenueLessCost === null
                    ? "尚無法完整試算"
                    : query.report.totals.revenueLessCost + " 元"
                }}
              </dd>
            </div>
          </dl>
          <p class="important">
            營收減未回庫成本不是分潤或會計利潤，未計入所有費用、代墊、管理費與實際持款。未知成本不當作零；已知小計仍可供核對。
          </p>
          <ul v-if="query.report.warnings.length">
            <li v-for="warning in query.report.warnings" :key="warning">
              {{ warning }}
            </li>
          </ul>
        </section>
        <section class="report-panel section-block">
          <h2>分組核對</h2>
          <p v-if="!query.report.groups.length">目前篩選範圍沒有成交明細。</p>
          <div
            v-else
            class="table-scroll"
            role="region"
            aria-label="銷售分組表"
            tabindex="0"
          >
            <table>
              <thead>
                <tr>
                  <th>分組</th>
                  <th>交付數量</th>
                  <th>退款後營收</th>
                  <th>已知未回庫成本</th>
                  <th>未知成本數量</th>
                  <th>營收減未回庫成本</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="g in query.report.groups" :key="g.id">
                  <th scope="row">{{ g.name }}</th>
                  <td>{{ g.soldQuantity }}</td>
                  <td>{{ g.netRevenue }}</td>
                  <td>{{ g.netKnownCost }}</td>
                  <td>{{ g.unknownCostQuantity }}</td>
                  <td>{{ g.revenueLessCost ?? "尚無法完整試算" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <details class="report-panel section-block">
          <summary>成交明細（{{ query.report.lines.length }}）</summary>
          <p>名稱與創作者依成交快照；企劃依商品目前歸屬。金額單位為新台幣。</p>
          <div
            class="table-scroll"
            role="region"
            aria-label="成交明細表"
            tabindex="0"
          >
            <table>
              <thead>
                <tr>
                  <th>成交時間／交易</th>
                  <th>商品</th>
                  <th>創作者／目前企劃</th>
                  <th>數量</th>
                  <th>原成交額</th>
                  <th>退款／折抵</th>
                  <th>退款後營收</th>
                  <th>已知未回庫成本</th>
                  <th>未知成本數量</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="l in query.report.lines.slice(0, lineLimit)"
                  :key="l.id"
                >
                  <td>{{ when(l.saleAt) }}<br />{{ l.saleCode }}</td>
                  <th scope="row">{{ l.productName }}</th>
                  <td>{{ l.creatorName }}<br />{{ l.projectName }}</td>
                  <td>{{ l.soldQuantity }}</td>
                  <td>{{ l.gross }}</td>
                  <td>{{ l.refunded }}</td>
                  <td>{{ l.netRevenue }}</td>
                  <td>{{ l.netKnownCost }}</td>
                  <td>{{ l.unknownCostQuantity }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <button
            v-if="query.report.lines.length > lineLimit"
            class="button secondary"
            @click="lineLimit += 200"
          >
            再顯示 200 筆成交明細
          </button>
        </details>
        <details class="report-panel section-block">
          <summary>目前庫存（{{ query.report.currentStock.length }}）</summary>
          <p class="important">
            這是目前資料快照，不是所選日期的歷史期末庫存。活動與日期篩選不限制此表；創作者、企劃與商品依目前主資料篩選。
          </p>
          <div
            class="table-scroll"
            role="region"
            aria-label="目前庫存表"
            tabindex="0"
          >
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th>庫位</th>
                  <th>現存</th>
                  <th>預留</th>
                  <th>未預留可用</th>
                  <th>已標記可用實物</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in query.report.currentStock.slice(0, stockLimit)"
                  :key="r.productId + ':' + r.locationId"
                >
                  <th scope="row">{{ r.productName }}</th>
                  <td>{{ r.locationName }}</td>
                  <td>{{ r.quantity }}</td>
                  <td>{{ r.reserved }}</td>
                  <td>{{ r.available }}</td>
                  <td>{{ r.markedUnits }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <button
            v-if="query.report.currentStock.length > stockLimit"
            class="button secondary"
            @click="stockLimit += 200"
          >
            再顯示 200 筆庫存
          </button>
        </details>
      </template>
      <section
        v-else
        class="report-panel section-block"
        aria-labelledby="cash-report-title"
      >
        <h2 id="cash-report-title">實際收退款</h2>
        <p class="important">
          本頁只套用活動與款項日期，不套用創作者、企劃或商品篩選。一筆交易可能包含多方商品，不能按比例推算各人的持款。
        </p>
        <p>
          換購折抵不算現金退款；只列真正補收或退還差額。這不是完整現金帳或應收應付報表。
        </p>
        <dl class="metrics" aria-label="收退款總計">
          <div>
            <dt>實際流入</dt>
            <dd>{{ query.cash.receipts }} 元</dd>
          </div>
          <div>
            <dt>實際流出</dt>
            <dd>{{ query.cash.payouts }} 元</dd>
          </div>
          <div>
            <dt>收退淨額</dt>
            <dd>{{ query.cash.net }} 元</dd>
          </div>
          <div>
            <dt>退款付款對象未記錄</dt>
            <dd>{{ query.cash.unknownPayerCount }} 筆</dd>
          </div>
        </dl>
        <ul v-if="query.cash.warnings.length">
          <li v-for="w in query.cash.warnings" :key="w">{{ w }}</li>
        </ul>
        <p v-if="!query.cash.entries.length">
          目前活動與款項日期範圍沒有收退紀錄。
        </p>
        <div
          v-else
          class="table-scroll"
          role="region"
          aria-label="實際收退款明細表"
          tabindex="0"
        >
          <table>
            <thead>
              <tr>
                <th>時間</th>
                <th>類型／來源</th>
                <th>活動</th>
                <th>登記對象</th>
                <th>實際收退金額</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="e in query.cash.entries.slice(0, cashLimit)"
                :key="e.id"
              >
                <td>{{ when(e.at) }}</td>
                <th scope="row">{{ kinds[e.kind] }}<br />{{ e.saleCode }}</th>
                <td>{{ e.eventName }}</td>
                <td>{{ e.partyName }}</td>
                <td>{{ e.amount }}</td>
                <td>{{ e.description }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          v-if="query.cash.entries.length > cashLimit"
          class="button secondary"
          @click="cashLimit += 200"
        >
          再顯示 200 筆收退紀錄
        </button>
      </section>
      <details class="report-panel section-block">
        <summary>計算定義與資料範圍</summary>
        <ul>
          <li v-for="d in query.report.definitions" :key="d">{{ d }}</li>
          <li v-for="d in query.cash.definitions" :key="d">{{ d }}</li>
        </ul>
        <p>
          報表僅供閱讀核對，不會建立交易、分潤、付款或修改庫存。完整備份請到<RouterLink
            to="/templates"
            >專案檔與備份</RouterLink
          >。
        </p>
      </details>
    </template>
  </template>
</template>
<style scoped>
.report-panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  min-width: 0;
  overflow-wrap: anywhere;
}
h2 {
  font-size: 20px;
  margin-top: 0;
}
p,
li {
  line-height: 1.85;
}
.filters-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 18px 0;
}
.field {
  display: grid;
  gap: 7px;
  min-width: 0;
}
label {
  font-size: 14px;
  font-weight: 600;
}
input,
select {
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 10px 12px;
  border: 1px solid #acbda8;
  border-radius: 7px;
  background: #fcfdf9;
  color: var(--text);
  font: inherit;
}
.actions,
.report-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.actions .button {
  min-height: 46px;
}
.report-tabs {
  margin: 20px 0;
}
.report-tabs .button {
  flex: 1 1 170px;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin: 20px 0;
}
.metrics > div {
  padding: 14px;
  background: #f5f7ef;
  border: 1px solid #dce4d6;
  border-radius: 8px;
  min-width: 0;
}
dt {
  font-size: 14px;
  line-height: 1.6;
  color: #52634f;
}
dd {
  margin: 7px 0 0;
  font-size: 19px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.important {
  padding: 12px 14px;
  border-left: 4px solid #91a270;
  background: #f5f7ed;
}
.muted {
  color: #566950;
  font-size: 14px;
}
.table-scroll {
  max-width: 100%;
  overflow-x: auto;
  margin: 16px 0;
}
table {
  border-collapse: collapse;
  min-width: 660px;
  width: 100%;
  font-size: 14px;
}
th,
td {
  padding: 11px 12px;
  border: 1px solid #c9d3c0;
  text-align: left;
  vertical-align: top;
  line-height: 1.65;
}
th {
  background: #eef2e7;
  font-weight: 600;
}
tbody th {
  background: #f8faf4;
}
summary {
  cursor: pointer;
  font-size: 18px;
  font-weight: 600;
  min-height: 44px;
  line-height: 1.6;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (max-width: 650px) {
  .filters-grid {
    grid-template-columns: 1fr;
  }
  .metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .report-panel {
    padding: 17px;
  }
}
@media (max-width: 380px) {
  .metrics {
    grid-template-columns: 1fr;
  }
}
</style>
