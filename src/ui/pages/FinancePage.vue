<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
import { costSummary, advanceRepaid } from "../../domain/finance/operations";
import type {
  CostInput,
  CostRecord,
  AdvanceInput,
} from "../../domain/models/catalog";
const workspaces = useWorkspaceStore(),
  catalog = useCatalogStore();
const notice = ref(""),
  error = ref(""),
  editingId = ref<string>(),
  showArchived = ref(false);
const emptyCost = (): CostInput => ({
  name: "",
  productId: "",
  quantity: 1,
  estimatedPrint: null,
  actualPrint: null,
  artworkAllocated: null,
  otherCost: null,
  unitSalePrice: null,
  paidById: "",
  burdenPartyId: "",
  notes: "",
});
const form = reactive(emptyCost());
const advance = reactive<AdvanceInput>({
  name: "",
  payerId: "",
  debtorId: "",
  principal: 0,
  notes: "",
});
const repayId = ref(""),
  repayAmount = ref<number | null>(null),
  repayNotes = ref("");
const correction = reactive({
  kind: "" as "" | "repayment" | "advance",
  advanceId: "",
  repaymentId: "",
  reason: "",
});
const costs = computed(
  () =>
    catalog.snapshot?.costs.filter((c) => showArchived.value || !c.archived) ||
    [],
);
const numericKeys = [
  "estimatedPrint",
  "actualPrint",
  "artworkAllocated",
  "otherCost",
  "unitSalePrice",
] as const;
const labels = {
  estimatedPrint: "預估印製總額",
  actualPrint: "實際印製總額",
  artworkAllocated: "本批分配的柄圖費",
  otherCost: "其他成本總額",
  unitSalePrice: "試算單件售價",
};
function cleanCost(): CostInput {
  const c: CostInput = {
    name: form.name,
    productId: form.productId,
    quantity: form.quantity,
    estimatedPrint: form.estimatedPrint,
    actualPrint: form.actualPrint,
    artworkAllocated: form.artworkAllocated,
    otherCost: form.otherCost,
    unitSalePrice: form.unitSalePrice,
    paidById: form.paidById,
    burdenPartyId: form.burdenPartyId,
    notes: form.notes,
  };
  for (const k of numericKeys) if (c[k] === ("" as unknown)) c[k] = null;
  return c;
}
const preview = computed(() => {
  try {
    return costSummary(cleanCost());
  } catch {
    return null;
  }
});
function summary(c: CostRecord) {
  try {
    return costSummary(c);
  } catch {
    return null;
  }
}
function reset() {
  editingId.value = undefined;
  Object.assign(form, emptyCost());
}
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    reset();
    notice.value = "";
    error.value = "";
    repayId.value = "";
    correction.kind = "";
    Object.assign(advance, {
      name: "",
      payerId: "",
      debtorId: "",
      principal: 0,
      notes: "",
    });
    if (id) await catalog.load(id);
  },
  { immediate: true },
);
async function run(action: () => Promise<void>, msg: string) {
  if (catalog.busy) return false;
  error.value = "";
  notice.value = "";
  try {
    await action();
    notice.value = msg;
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法儲存，原資料仍保留。";
    return false;
  }
}
async function saveCost() {
  if (
    await run(
      () => catalog.saveCost(cleanCost(), editingId.value),
      "成本紀錄已儲存；沒有改變庫存或產生付款。",
    )
  )
    reset();
}
function edit(c: CostRecord) {
  editingId.value = c.id;
  Object.assign(form, { ...c });
  document.getElementById("cost-name")?.focus();
  document.getElementById("cost-name")?.scrollIntoView({ block: "center" });
}
async function saveAdvance() {
  if (
    await run(
      () => catalog.saveAdvance({ ...advance }),
      "已記錄實際代墊本金，未計入營收或利潤。",
    )
  )
    Object.assign(advance, {
      name: "",
      payerId: "",
      debtorId: "",
      principal: 0,
      notes: "",
    });
}
async function repay() {
  if (repayAmount.value === null) return;
  if (
    await run(
      () =>
        catalog.payAdvance(repayId.value, repayAmount.value!, repayNotes.value),
      "已記錄本金償還；不是利潤或新增費用。",
    )
  ) {
    repayId.value = "";
    repayAmount.value = null;
    repayNotes.value = "";
  }
}
async function correct() {
  if (
    await run(
      () =>
        correction.kind === "advance"
          ? catalog.voidAdvance(correction.advanceId, correction.reason)
          : catalog.reverseRepayment(
              correction.advanceId,
              correction.repaymentId,
              correction.reason,
            ),
      "更正紀錄已儲存，原紀錄仍保留。",
    )
  )
    correction.kind = "";
}
const when = (v: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(v));
const party = (id: string) =>
  catalog.snapshot?.parties.find((p) => p.id === id)?.name || "未指定";
const netRevenue = computed(() =>
  (catalog.snapshot?.sales || [])
    .filter((s) => !s.cancelledAt)
    .reduce((sum, s) => sum + BigInt(s.total), 0n)
    .toString(),
);
const pending = computed(() =>
  (catalog.snapshot?.advances || [])
    .filter((a) => !a.voidedAt)
    .reduce(
      (sum, a) => sum + BigInt(a.principal) - BigInt(advanceRepaid(a)),
      0n,
    )
    .toString(),
);
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">CLEAR COSTS, YOUR DECISIONS</div>
      <h1>成本與財務</h1>
      <p>先分清商品成本、付款者與代墊本金，再由你決定如何分款。</p>
    </div>
  </section>
  <aside class="info-banner">
    <div>
      <strong>目前提供批次成本試算與代墊本金紀錄。</strong>
      <p>
        空白成本表示未知；確定沒有費用時請填
        0。成本表不代表實際付款，也不會增加庫存。柄圖分攤額由你填入，尚未提供自動分攤、管理費、抽成與分潤結算；系統不替你決定結案或追收。
      </p>
    </div>
  </aside>
  <RouterLink v-if="!workspaces.activeWorkspaceId" to="/" class="button primary"
    >先建立工作區</RouterLink
  >
  <template v-else>
    <div class="field workspace-picker">
      <label for="finance-workspace">目前工作區</label
      ><select
        id="finance-workspace"
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
      {{ error || catalog.error
      }}<button
        type="button"
        class="text-button"
        :disabled="catalog.busy"
        @click="catalog.load(workspaces.activeWorkspaceId)"
      >
        重新讀取
      </button>
    </p>
    <template v-if="catalog.snapshot">
      <section class="section-block">
        <h2>工作區概況</h2>
        <dl class="report-grid">
          <div>
            <dt>有效交易營收</dt>
            <dd>{{ netRevenue }} 元</dd>
          </div>
          <div>
            <dt>尚未償還代墊本金</dt>
            <dd>{{ pending }} 元</dd>
          </div>
          <div>
            <dt>可分配利潤</dt>
            <dd class="unknown">尚無法試算（未設定分潤規則）</dd>
          </div>
        </dl>
        <p>
          營收不是利潤；代墊償還不會從營收再扣一次，也不會自動成為商品成本。
        </p>
      </section>
      <section class="business-panel section-block">
        <h2>{{ editingId ? "編輯成本紀錄" : "新增批次成本" }}</h2>
        <p>
          每筆對應一個實際商品的一個製作批次。金額用新台幣整元；單件綜合成本保留四位小數顯示，中間以精確分數計算。
        </p>
        <form @submit.prevent="saveCost">
          <fieldset class="form-grid" :disabled="catalog.busy">
            <div class="field">
              <label for="cost-name">批次／成本名稱</label
              ><input
                id="cost-name"
                v-model="form.name"
                required
                maxlength="80"
                placeholder="例如：第一批徽章"
              />
            </div>
            <div class="field">
              <label for="cost-product">成本商品</label
              ><select id="cost-product" v-model="form.productId" required>
                <option value="">請選擇商品</option>
                <option
                  v-for="p in catalog.snapshot.products"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }}{{ p.archived ? "（已封存）" : "" }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="cost-quantity">製作數量</label
              ><input
                id="cost-quantity"
                v-model.number="form.quantity"
                type="number"
                min="1"
                step="1"
                required
              />
            </div>
            <div class="field" v-for="key in numericKeys" :key="key">
              <label :for="'cost-' + key">{{ labels[key] }}（元）</label
              ><input
                :id="'cost-' + key"
                v-model.number="form[key]"
                type="number"
                min="0"
                step="1"
                placeholder="留白＝未知；沒有費用請填 0"
              />
            </div>
            <div class="field">
              <label for="cost-payer">印製費付款者（註記）</label
              ><select id="cost-payer" v-model="form.paidById">
                <option value="">未指定</option>
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
              <label for="cost-burden">成本負擔者（註記）</label
              ><select id="cost-burden" v-model="form.burdenPartyId">
                <option value="">未指定</option>
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
              <label for="cost-notes">成本備註</label
              ><textarea
                id="cost-notes"
                v-model="form.notes"
                maxlength="2000"
                rows="2"
                placeholder="柄圖分攤來源、其他費用內容或付款說明"
              ></textarea>
            </div>
          </fieldset>
          <p v-if="preview">
            綜合成本總額 {{ preview.total }} 元；單件
            {{ preview.unitCost }} 元。全部按試算售價售出時，預估毛利
            {{ preview.profit ?? "尚無法試算" }} 元。
          </p>
          <p v-else>
            實際印製費、分配柄圖費與其他成本未完整填寫，尚無法試算綜合成本。
          </p>
          <div class="actions">
            <button
              class="button primary"
              :disabled="catalog.busy || !form.name.trim() || !form.productId"
            >
              {{ editingId ? "儲存成本變更" : "建立成本紀錄" }}</button
            ><button
              v-if="editingId"
              type="button"
              class="button secondary"
              :disabled="catalog.busy"
              @click="reset"
            >
              取消編輯
            </button>
          </div>
        </form>
      </section>
      <section class="section-block">
        <h2>批次成本紀錄（{{ costs.length }}）</h2>
        <label class="check-option"
          ><input type="checkbox" v-model="showArchived" />顯示封存成本</label
        >
        <article v-for="c in costs" :key="c.id" class="business-panel">
          <h3>
            {{ c.name }}
            <span v-if="c.archived" class="soft-label">已封存</span>
          </h3>
          <p>
            {{
              catalog.snapshot.products.find((p) => p.id === c.productId)?.name
            }}
            · 製作 {{ c.quantity }} 件 · 付款者 {{ party(c.paidById) }} · 負擔者
            {{ party(c.burdenPartyId) }}
          </p>
          <p>
            預估印製
            {{
              c.estimatedPrint === null ? "未知" : c.estimatedPrint + " 元"
            }}；實際印製
            {{
              c.actualPrint === null ? "未知" : c.actualPrint + " 元"
            }}；柄圖分配
            {{
              c.artworkAllocated === null ? "未知" : c.artworkAllocated + " 元"
            }}；其他成本
            {{ c.otherCost === null ? "未知" : c.otherCost + " 元" }}。
          </p>
          <dl v-if="summary(c)" class="report-grid">
            <div>
              <dt>成本總額</dt>
              <dd>{{ summary(c)!.total }} 元</dd>
            </div>
            <div>
              <dt>單件綜合成本</dt>
              <dd>{{ summary(c)!.unitCost }} 元</dd>
            </div>
            <div>
              <dt>全部售出預估毛利</dt>
              <dd>
                {{ summary(c)!.profit ?? "尚無法試算"
                }}{{ summary(c)!.profit === null ? "" : " 元" }}
              </dd>
            </div>
            <div>
              <dt>以本筆售價回收本批成本所需銷量</dt>
              <dd>
                {{
                  summary(c)!.breakEven === null
                    ? "尚無法試算"
                    : summary(c)!.breakEven + " 件"
                }}
              </dd>
            </div>
          </dl>
          <p v-else>成本未完整，尚無法試算。</p>
          <p>本筆為成本試算，不是實際銷售毛利或可分配利潤。</p>
          <p v-if="c.notes">{{ c.notes }}</p>
          <div class="actions">
            <button
              type="button"
              class="button secondary"
              :disabled="catalog.busy"
              @click="edit(c)"
            >
              編輯成本 {{ c.name }}</button
            ><button
              type="button"
              class="text-button"
              :disabled="catalog.busy"
              @click="
                run(() => catalog.archiveCost(c.id), '成本封存狀態已更新。')
              "
            >
              {{ c.archived ? "恢復" : "封存" }}成本 {{ c.name }}
            </button>
          </div>
        </article>
        <p v-if="!costs.length">尚無成本紀錄。</p>
      </section>
      <section class="business-panel section-block">
        <h2>記錄實際代墊本金</h2>
        <p>
          只記錄已付款、而且合作雙方約定需償還的部分。成本表的付款者註記不會自動建立欠款；不追收的投入請不要填為代墊。
        </p>
        <p v-if="catalog.snapshot.parties.length < 2">
          請先在商品建檔建立至少兩位創作者，才能記錄彼此代墊。
        </p>
        <form @submit.prevent="saveAdvance">
          <fieldset class="form-grid" :disabled="catalog.busy">
            <div class="field">
              <label for="advance-name">代墊名稱</label
              ><input
                id="advance-name"
                v-model="advance.name"
                required
                maxlength="80"
              />
            </div>
            <div class="field">
              <label for="advance-payer">實際代墊付款者</label
              ><select id="advance-payer" v-model="advance.payerId" required>
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
              <label for="advance-debtor">約定償還本金的負擔者</label
              ><select id="advance-debtor" v-model="advance.debtorId" required>
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
              <label for="advance-principal">已實付且約定可追收本金（元）</label
              ><input
                id="advance-principal"
                v-model.number="advance.principal"
                type="number"
                min="1"
                step="1"
                required
              />
            </div>
            <div class="field">
              <label for="advance-notes">代墊備註</label
              ><textarea
                id="advance-notes"
                v-model="advance.notes"
                maxlength="2000"
                rows="2"
              ></textarea>
            </div>
          </fieldset>
          <button
            class="button primary"
            :disabled="catalog.busy || catalog.snapshot.parties.length < 2"
          >
            記錄代墊本金
          </button>
        </form>
      </section>
      <section class="section-block">
        <h2>代墊與還款紀錄</h2>
        <article
          v-for="a in catalog.snapshot.advances.slice().reverse()"
          :key="a.id"
          class="business-panel"
        >
          <h3>
            {{ a.name }}
            <span v-if="a.voidedAt" class="soft-label">已作廢</span>
          </h3>
          <p>
            {{ party(a.payerId) }} 代 {{ party(a.debtorId) }} 支付
            {{ a.principal }} 元。有效已還 {{ advanceRepaid(a) }} 元；{{
              a.voidedAt
                ? "作廢不再列未還本金"
                : "未還 " + (a.principal - advanceRepaid(a)) + " 元"
            }}。
          </p>
          <p v-if="a.notes">{{ a.notes }}</p>
          <p v-if="a.voidedAt">作廢原因：{{ a.voidReason }}</p>
          <div v-if="!a.voidedAt" class="actions">
            <button
              v-if="advanceRepaid(a) < a.principal"
              class="button secondary"
              :disabled="catalog.busy"
              @click="
                repayId = a.id;
                repayAmount = null;
                repayNotes = '';
              "
            >
              登記償還 {{ a.name }}</button
            ><button
              v-if="advanceRepaid(a) === 0"
              class="text-button"
              :disabled="catalog.busy"
              @click="
                Object.assign(correction, {
                  kind: 'advance',
                  advanceId: a.id,
                  repaymentId: '',
                  reason: '',
                })
              "
            >
              作廢代墊 {{ a.name }}
            </button>
          </div>
          <form
            v-if="repayId === a.id"
            class="confirmation"
            @submit.prevent="repay"
          >
            <div class="field">
              <label :for="'repay-amount-' + a.id">已實際償還金額（元）</label
              ><input
                :id="'repay-amount-' + a.id"
                v-model.number="repayAmount"
                required
                type="number"
                min="1"
                step="1"
                :max="a.principal - advanceRepaid(a)"
                :disabled="catalog.busy"
              />
            </div>
            <div class="field">
              <label :for="'repay-note-' + a.id">還款備註</label
              ><input
                :id="'repay-note-' + a.id"
                v-model="repayNotes"
                maxlength="2000"
                :disabled="catalog.busy"
              />
            </div>
            <div class="actions">
              <button class="button primary" :disabled="catalog.busy">
                確認已償還</button
              ><button
                class="button secondary"
                type="button"
                :disabled="catalog.busy"
                @click="repayId = ''"
              >
                取消登記
              </button>
            </div>
          </form>
          <ul>
            <li v-for="r in a.repayments" :key="r.id">
              {{ when(r.createdAt) }} ·
              {{ r.reversesId ? "沖銷還款" : "已償還" }} {{ r.amount }} 元 ·
              {{ r.notes }}
              <button
                v-if="
                  !r.reversesId &&
                  !a.voidedAt &&
                  !a.repayments.some((x) => x.reversesId === r.id)
                "
                class="text-button"
                :disabled="catalog.busy"
                @click="
                  Object.assign(correction, {
                    kind: 'repayment',
                    advanceId: a.id,
                    repaymentId: r.id,
                    reason: '',
                  })
                "
              >
                沖銷這筆還款</button
              ><span v-if="a.repayments.some((x) => x.reversesId === r.id)"
                >（已沖銷）</span
              >
            </li>
          </ul>
          <form
            v-if="correction.kind && correction.advanceId === a.id"
            class="confirmation"
            @submit.prevent="correct"
          >
            <h4>
              {{ correction.kind === "advance" ? "作廢代墊" : "沖銷錯誤還款" }}
            </h4>
            <div class="field">
              <label :for="'correct-' + a.id">更正原因</label
              ><input
                :id="'correct-' + a.id"
                v-model="correction.reason"
                required
                maxlength="2000"
                :disabled="catalog.busy"
              />
            </div>
            <div class="actions">
              <button
                class="button primary"
                :disabled="catalog.busy || !correction.reason.trim()"
              >
                確認更正並保留歷史</button
              ><button
                class="button secondary"
                type="button"
                :disabled="catalog.busy"
                @click="correction.kind = ''"
              >
                返回
              </button>
            </div>
          </form>
        </article>
        <p v-if="!catalog.snapshot.advances.length">尚無代墊紀錄。</p>
      </section>
    </template>
  </template>
</template>
<style scoped src="./business.css"></style>
