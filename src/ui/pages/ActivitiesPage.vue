<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
import PhysicalUnitPicker from "../components/PhysicalUnitPicker.vue";
import { balance } from "../../domain/inventory/operations";
import type { ActivityPacket, HandoffInput } from "../../domain/activity/types";
import {
  createHandoff,
  listActivities,
  exportActivity,
  returnActivityStock,
} from "../../application/activities";
const workspaces = useWorkspaceStore(),
  catalog = useCatalogStore();
const busy = ref(false),
  error = ref(""),
  notice = ref("");
const packets = ref<ActivityPacket[]>([]);
const form = reactive({
  name: "",
  eventId: "",
  sourceLocationId: "",
  planIds: [] as string[],
  collectorIds: [] as string[],
  productIds: [] as string[],
  projectId: "",
  creatorId: "",
  search: "",
  financialKeys: [] as string[],
});
const quantities = reactive<Record<string, number>>({});
const chosenUnits = reactive<Record<string, string[]>>({});
const selected = computed(
  () =>
    catalog.snapshot?.products.filter((p) => form.productIds.includes(p.id)) ||
    [],
);
const products = computed(
  () =>
    catalog.snapshot?.products.filter(
      (p) =>
        !p.archived &&
        (!form.projectId || p.projectId === form.projectId) &&
        (!form.creatorId || p.creatorId === form.creatorId) &&
        (!form.search || p.name.includes(form.search)),
    ) || [],
);
const plans = computed(
  () =>
    catalog.snapshot?.salePlans.filter(
      (p) =>
        !p.archived &&
        (!p.eventIds.length || p.eventIds.includes(form.eventId)) &&
        p.productIds.every((id) => form.productIds.includes(id)),
    ) || [],
);
const longEvent = computed(() => {
  const event = catalog.snapshot?.events.find((e) => e.id === form.eventId);
  return (
    event?.startDate &&
    event.endDate &&
    (Date.parse(event.endDate) - Date.parse(event.startDate)) / 86400000 + 1 >
      14
  );
});
const financials = computed(() => {
  const s = catalog.snapshot;
  if (!s) return [];
  return (
    [
      "costs",
      "advances",
      "settlements",
      "artworkExpenses",
      "internalAgreements",
    ] as const
  ).flatMap((kind) =>
    s[kind].map((row) => ({
      key: `${kind}:${row.id}`,
      kind,
      id: row.id,
      name: row.name,
    })),
  );
});
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
async function refresh() {
  packets.value = await listActivities();
}
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    error.value = "";
    notice.value = "";
    form.productIds = [];
    for (const id of Object.keys(chosenUnits)) delete chosenUnits[id];
    form.planIds = [];
    form.collectorIds = [];
    form.financialKeys = [];
    if (id) await catalog.load(id);
    await refresh();
  },
  { immediate: true },
);
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
async function prepare() {
  await run(async () => {
    const s = catalog.snapshot;
    if (!s) return;
    const input: HandoffInput = {
      name: form.name,
      eventId: form.eventId,
      sourceLocationId: form.sourceLocationId,
      lines: selected.value.map((p) => ({
        productId: p.id,
        quantity: quantities[p.id] || 0,
        ...(chosenUnits[p.id]?.length
          ? { unitIds: [...chosenUnits[p.id]!] }
          : {}),
      })),
      planIds: form.planIds.filter((id) =>
        plans.value.some((p) => p.id === id),
      ),
      collectorIds: [...form.collectorIds],
      financialReferences: financials.value
        .filter((f) => form.financialKeys.includes(f.key))
        .map(({ kind, id }) => ({ kind, id })),
    };
    await createHandoff(s.workspaceId, s.revision, input);
    await catalog.load(s.workspaceId);
    await refresh();
    notice.value = "交接份已建立，交付量已轉入獨立交接庫位，總庫存沒有增加。";
    form.name = "";
    form.productIds = [];
  });
}
const ownPackets = computed(() =>
  packets.value.filter(
    (p) => p.sourceWorkspaceId === workspaces.activeWorkspaceId,
  ),
);
const eventProgress = computed(() => {
  const ids = [...new Set(ownPackets.value.map((p) => p.eventId))];
  return ids.map((id) => {
    const rows = ownPackets.value.filter((p) => p.eventId === id);
    const merged = rows.filter((p) => mergedRecord(p.handoffId)).length;
    return {
      id,
      name: catalog.snapshot?.events.find((e) => e.id === id)?.name || "活動",
      total: rows.length,
      merged,
      pending: rows.length - merged,
    };
  });
});
const returning = ref(""),
  returnLocationId = ref(""),
  returnReason = ref("");
function mergedRecord(id: string) {
  return catalog.snapshot?.activityMerges.find((r) => r.handoffId === id);
}
async function returnStock() {
  await run(async () => {
    await returnActivityStock(
      workspaces.activeWorkspaceId,
      catalog.snapshot!.revision,
      returning.value,
      returnLocationId.value,
      returnReason.value,
    );
    await catalog.load(workspaces.activeWorkspaceId);
    returning.value = "";
    notice.value = "已記錄實物退回。";
  });
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">PREPARE · HAND OFF · RECONCILE</div>
      <h1>活動配置與交接</h1>
      <p>從創作管理選取本次參售商品，分配交付量，交給活動工作台使用。</p>
    </div>
  </section>
  <p v-if="error || catalog.error" class="error-notice" role="alert">
    {{ error || catalog.error }}
  </p>
  <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
  <section v-if="!workspaces.activeWorkspaceId" class="info-banner">
    <div>
      <h2>先建立或還原完整工作區</h2>
      <p>活動交接由完整工作區準備；只有活動檔可直接到活動工作台匯入。</p>
      <RouterLink class="button primary" to="/">前往創作管理</RouterLink>
      <RouterLink class="button secondary" to="/activity"
        >匯入活動檔</RouterLink
      >
    </div>
  </section>
  <template v-else>
    <div class="field">
      <label for="handoff-workspace">目前工作區</label
      ><select
        id="handoff-workspace"
        :value="workspaces.activeWorkspaceId"
        :disabled="busy"
        @change="workspaces.select(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="w in workspaces.workspaces" :key="w.id" :value="w.id">
          {{ w.name }}
        </option>
      </select>
    </div>
    <section v-if="catalog.snapshot" class="panel section-block">
      <h2>建立一份活動交接</h2>
      <p>
        每份交接各有固定數量。同活動可分成多份，但同一份請輪流交接，避免離線副本分歧。
      </p>
      <form @submit.prevent="prepare">
        <fieldset :disabled="busy">
          <div class="grid">
            <div class="field">
              <label for="handoff-name">交接名稱（必填）</label
              ><input
                id="handoff-name"
                v-model="form.name"
                maxlength="80"
                required
                placeholder="例如：CWT 社團攤位・上午組"
              />
            </div>
            <div class="field">
              <label for="handoff-event">活動（必填）</label
              ><select id="handoff-event" v-model="form.eventId" required>
                <option value="">請選擇活動</option>
                <option
                  v-for="e in catalog.snapshot.events.filter(
                    (e) => !e.archived,
                  )"
                  :key="e.id"
                  :value="e.id"
                >
                  {{ e.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="handoff-source">交付來源庫位（必填）</label
              ><select
                id="handoff-source"
                v-model="form.sourceLocationId"
                required
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
          </div>
          <p v-if="longEvent" class="info-banner">
            這項活動超過兩週；活動工作台適合固定交付量的短期活動，持續補貨建議使用創作管理。
          </p>
          <p v-if="!catalog.snapshot.events.length">
            尚未建立活動，請先到<RouterLink to="/projects"
              >企劃與場次</RouterLink
            >新增。
          </p>
          <h3>選擇參售商品與數量</h3>
          <div class="grid">
            <div class="field">
              <label for="handoff-project">依企劃篩選商品</label
              ><select id="handoff-project" v-model="form.projectId">
                <option value="">全部企劃</option>
                <option
                  v-for="p in catalog.snapshot.projects"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="handoff-creator">依創作者篩選商品</label
              ><select id="handoff-creator" v-model="form.creatorId">
                <option value="">全部創作者</option>
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
              <label for="handoff-search">搜尋參售商品</label
              ><input id="handoff-search" v-model="form.search" type="search" />
            </div>
          </div>
          <div class="item-list">
            <div v-for="p in products" :key="p.id" class="item-row">
              <label class="check"
                ><input
                  v-model="form.productIds"
                  type="checkbox"
                  :value="p.id"
                />{{ p.name }}</label
              ><span
                >來源現存
                {{
                  form.sourceLocationId
                    ? balance(catalog.snapshot, p.id, form.sourceLocationId)
                    : "—"
                }}</span
              >
              <div v-if="form.productIds.includes(p.id)" class="field">
                <label :for="`handoff-qty-${p.id}`">{{ p.name }} 交付數量</label
                ><input
                  :id="`handoff-qty-${p.id}`"
                  v-model.number="quantities[p.id]"
                  type="number"
                  min="1"
                  step="1"
                  required
                />
                <PhysicalUnitPicker
                  :snapshot="catalog.snapshot"
                  :product-id="p.id"
                  :location-id="form.sourceLocationId"
                  :model-value="chosenUnits[p.id] || []"
                  @update:model-value="
                    chosenUnits[p.id] = $event;
                    if ($event.length) quantities[p.id] = $event.length;
                  "
                  :disabled="busy"
                  label="本份交付的特殊單件"
                />
              </div>
            </div>
          </div>
          <p>已選 {{ selected.length }} 項商品。變更篩選不會取消已選項目。</p>
          <fieldset>
            <legend>帶入販售方案</legend>
            <p>
              只列出本活動適用、且全部商品都已選取的方案；活動端仍可明確改價。
            </p>
            <label v-for="p in plans" :key="p.id" class="check"
              ><input v-model="form.planIds" type="checkbox" :value="p.id" />{{
                p.name
              }}
              · {{ p.unitPrice }} 元</label
            >
            <p v-if="!plans.length">
              目前沒有符合條件的方案，可先建立或在活動端登記售價。
            </p>
          </fieldset>
          <fieldset>
            <legend>活動收款與支出人員</legend>
            <p>
              只攜帶勾選人員及商品必要的歸屬資料，不會帶走完整工作區的人員備註。
            </p>
            <label
              v-for="p in catalog.snapshot.parties.filter((p) => !p.archived)"
              :key="p.id"
              class="check"
              ><input
                v-model="form.collectorIds"
                type="checkbox"
                :value="p.id"
              />{{ p.name }}</label
            >
          </fieldset>
          <details>
            <summary>選配：帶入相關財務參考摘要</summary>
            <p>
              預設不帶財務。勾選的資料可能含私人金額及合作資訊，請確認接手者確實需要。參考摘要在活動端唯讀，不會自動計入活動費用。
            </p>
            <label v-for="f in financials" :key="f.key" class="check"
              ><input
                v-model="form.financialKeys"
                type="checkbox"
                :value="f.key"
              />{{ f.name }}（{{ financeKind(f.kind) }}）</label
            >
          </details>
          <p class="info-banner">
            確認後會將交付量移到專屬交接庫位，不會複製庫存。商品製作成本及其他企劃資料不會自動帶入。
          </p>
          <button
            class="button primary"
            :disabled="
              !selected.length ||
              !form.name.trim() ||
              !form.eventId ||
              !form.sourceLocationId
            "
          >
            {{ busy ? "建立中…" : "確認交付並建立活動檔" }}
          </button>
        </fieldset>
      </form>
    </section>
    <section class="section-block">
      <h2>本工作區的交接份（{{ ownPackets.length }}）</h2>
      <p>
        匯出後可交給另一台裝置操作。已開始銷售但未結案的檔案不能合回；結案回傳請到活動工作台匯入。
      </p>
      <p v-for="event in eventProgress" :key="event.id" class="info-banner">
        {{ event.name }}：共 {{ event.total }} 份，已合回
        {{ event.merged }} 份，尚待回傳合回 {{ event.pending }} 份。
      </p>
      <p v-if="!ownPackets.length">尚未建立交接份。</p>
      <article
        v-for="p in ownPackets"
        :key="p.handoffId"
        class="panel packet-card"
      >
        <h3>{{ p.name }}</h3>
        <p>
          {{ p.closure ? "已確認結案 · 唯讀" : "進行中，可存檔續作" }} · 修訂
          {{ p.revision }} · {{ p.snapshot.products.length }} 項商品
        </p>
        <p>
          {{
            mergedRecord(p.handoffId)?.returnedAt
              ? "已合回並確認實物退回"
              : mergedRecord(p.handoffId)
                ? "已合回，剩餘品仍在交接庫位，待確認實物退回"
                : "尚未合回創作管理"
          }}
        </p>
        <div class="actions">
          <button
            class="button secondary"
            :disabled="busy"
            @click="
              run(async () => {
                await exportActivity(p.handoffId);
                notice = '已發起活動檔下載，請確認已保存。';
              })
            "
          >
            匯出 {{ p.name }}</button
          ><RouterLink
            class="button primary"
            :to="{ path: '/activity', query: { id: p.handoffId } }"
            >開啟活動工作台</RouterLink
          ><button
            v-if="
              mergedRecord(p.handoffId) &&
              !mergedRecord(p.handoffId)?.returnedAt
            "
            class="button secondary"
            :disabled="busy"
            @click="returning = p.handoffId"
          >
            確認實物退回
          </button>
        </div>
        <form
          v-if="returning === p.handoffId"
          class="return-form"
          @submit.prevent="returnStock"
        >
          <p>只有已合回的交接份可退回剩餘庫存，請先確認實物已收到。</p>
          <div class="field">
            <label for="activity-return-location">退回庫位</label
            ><select
              id="activity-return-location"
              v-model="returnLocationId"
              required
            >
              <option value="">請選擇庫位</option>
              <option
                v-for="l in catalog.snapshot?.locations.filter(
                  (l) => l.id !== p.locationId,
                )"
                :key="l.id"
                :value="l.id"
              >
                {{ l.name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="activity-return-reason">實物退回原因與核對</label
            ><input
              id="activity-return-reason"
              v-model="returnReason"
              required
              maxlength="2000"
            />
          </div>
          <div class="actions">
            <button class="button primary" :disabled="busy">
              確認已收回實物並退回庫存</button
            ><button
              type="button"
              class="button secondary"
              @click="returning = ''"
            >
              取消
            </button>
          </div>
        </form>
      </article>
    </section>
  </template>
</template>
<style scoped>
.panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  overflow-wrap: anywhere;
}
.field {
  display: grid;
  gap: 7px;
  margin: 10px 0;
  min-width: 0;
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
fieldset {
  min-width: 0;
  padding: 14px;
  border: 1px solid #dce4d6;
  border-radius: 8px;
  margin: 15px 0;
}
.grid {
  display: grid;
  gap: 12px;
}
.check {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 44px;
}
.check input {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.item-row {
  border-bottom: 1px solid var(--line);
  padding: 12px 0;
  display: grid;
  gap: 6px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}
.packet-card {
  margin: 14px 0;
}
.return-form {
  margin-top: 18px;
  background: #f5f8f2;
  padding: 15px;
  border-radius: 8px;
}
summary {
  cursor: pointer;
  min-height: 44px;
  padding: 12px 0;
  font-weight: 600;
}
p {
  line-height: 1.9;
}
h3 {
  margin-top: 22px;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (min-width: 760px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .item-row {
    grid-template-columns: minmax(0, 1fr) 160px minmax(160px, 1fr);
    align-items: center;
  }
}
@media (max-width: 520px) {
  .panel {
    padding: 16px;
  }
}
</style>
