<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
import { balance, movementLabels } from "../../domain/inventory/operations";
import type { MovementInput } from "../../domain/models/catalog";
const workspaces = useWorkspaceStore(),
  catalog = useCatalogStore();
const locationName = ref(""),
  notice = ref(""),
  error = ref(""),
  filter = ref("");
const reversing = ref(""),
  reverseReason = ref("");
const form = reactive<MovementInput>({
  productId: "",
  kind: "receipt",
  quantity: 1,
  fromLocationId: "",
  toLocationId: "",
  reason: "",
});
const incoming = computed(() => ["receipt", "adjust-in"].includes(form.kind));
const outgoing = computed(() =>
  ["free", "damage", "adjust-out"].includes(form.kind),
);
const rows = computed(() => {
  const s = catalog.snapshot;
  if (!s) return [];
  return s.products
    .filter((p) => !filter.value || p.name.includes(filter.value))
    .flatMap((p) =>
      s.locations
        .map((l) => ({
          product: p,
          location: l,
          quantity: balance(s, p.id, l.id),
        }))
        .filter(
          (r) =>
            r.quantity ||
            s.movements.some(
              (m) =>
                m.productId === p.id &&
                (m.fromLocationId === r.location.id ||
                  m.toLocationId === r.location.id),
            ),
        ),
    );
});
const recent = computed(() =>
  [...(catalog.snapshot?.movements || [])].reverse(),
);
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    notice.value = "";
    error.value = "";
    reversing.value = "";
    reverseReason.value = "";
    Object.assign(form, {
      productId: "",
      kind: "receipt",
      quantity: 1,
      fromLocationId: "",
      toLocationId: "",
      reason: "",
    });
    locationName.value = "";
    if (id) await catalog.load(id);
  },
  { immediate: true },
);
async function run(action: () => Promise<void>, success: string) {
  if (catalog.busy) return false;
  error.value = "";
  notice.value = "";
  try {
    await action();
    notice.value = success;
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法儲存，原資料仍保留。";
    return false;
  }
}
async function location() {
  if (await run(() => catalog.saveLocation(locationName.value), "庫位已建立。"))
    locationName.value = "";
}
async function save() {
  if (await run(() => catalog.saveMovement({ ...form }), "庫存異動已儲存。")) {
    form.quantity = 1;
    form.reason = "";
  }
}
async function reverse() {
  if (
    await run(
      () => catalog.cancelMovement(reversing.value, reverseReason.value),
      "已新增沖銷紀錄，原紀錄仍保留。",
    )
  ) {
    reversing.value = "";
    reverseReason.value = "";
  }
}
const name = (kind: "products" | "locations", id: string) =>
  catalog.snapshot?.[kind].find((r) => r.id === id)?.name || "—";
const reversed = (id: string) =>
  catalog.snapshot?.movements.some((m) => m.reversesId === id);
const when = (time: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(time));
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">KEEP EVERY ITEM IN VIEW</div>
      <h1>庫存與盤點</h1>
      <p>登記製作入庫、無料、損耗與庫位調撥，每筆異動都留下原因。</p>
    </div>
  </section>
  <section class="info-banner">
    <div>
      <strong>目前提供基本庫存異動。</strong>
      <p>
        先建立商品與庫位，再登記數量。盤差可手動調整並註記原因；正式盤點單、製作批次、預留庫存及販售扣庫尚未開放。本頁數量不代表營收。
      </p>
    </div>
  </section>
  <RouterLink v-if="!workspaces.activeWorkspaceId" class="button primary" to="/"
    >先建立工作區</RouterLink
  >
  <template v-else>
    <div class="field workspace-picker">
      <label for="inventory-workspace">目前工作區</label
      ><select
        id="inventory-workspace"
        :value="workspaces.activeWorkspaceId"
        :disabled="catalog.busy"
        @change="workspaces.select(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="w in workspaces.workspaces" :value="w.id" :key="w.id">
          {{ w.name }}
        </option>
      </select>
    </div>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="error || catalog.error" class="error-notice" role="alert">
      {{ error || catalog.error }}
      <button
        type="button"
        class="text-button"
        :disabled="catalog.busy"
        @click="catalog.load(workspaces.activeWorkspaceId)"
      >
        重新讀取
      </button>
    </p>
    <template v-if="catalog.snapshot">
      <section class="inventory-panel section-block">
        <h2>新增庫位</h2>
        <p>
          庫位是實物存放位置，例如家中、CWT-74攤位或寄賣店。建立庫位本身不會增加庫存。
        </p>
        <form class="inline-form" @submit.prevent="location">
          <div class="field">
            <label for="location-name">庫位名稱</label
            ><input
              id="location-name"
              v-model="locationName"
              required
              maxlength="80"
              :disabled="catalog.busy"
              placeholder="例如：家中存放箱"
            />
          </div>
          <button
            class="button secondary"
            :disabled="catalog.busy || !locationName.trim()"
          >
            建立庫位
          </button>
        </form>
        <p>
          {{
            catalog.snapshot.locations.map((l) => l.name).join("、") ||
            "尚未建立庫位"
          }}
        </p>
      </section>
      <section class="inventory-panel section-block">
        <h2>登記庫存異動</h2>
        <p>
          數量填正整數；調整必須填原因。送出後不能直接改歷史，可用沖銷更正。
        </p>
        <RouterLink
          v-if="!catalog.snapshot.products.length"
          to="/products"
          class="text-button"
          >先建立商品 →</RouterLink
        >
        <form @submit.prevent="save">
          <fieldset :disabled="catalog.busy" class="form-grid">
            <div class="field">
              <label for="movement-product">商品</label
              ><select id="movement-product" v-model="form.productId" required>
                <option value="">請選擇商品</option>
                <option
                  v-for="p in catalog.snapshot.products.filter(
                    (p) => !p.archived,
                  )"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }} · {{ p.code }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="movement-kind">異動類型</label
              ><select id="movement-kind" v-model="form.kind">
                <option
                  v-for="(label, kind) in movementLabels"
                  v-show="kind !== 'reversal'"
                  :key="kind"
                  :value="kind"
                  :disabled="kind === 'reversal'"
                >
                  {{ label }}
                </option>
              </select>
            </div>
            <div class="field" v-if="!incoming">
              <label for="movement-from">來源庫位</label
              ><select
                id="movement-from"
                v-model="form.fromLocationId"
                required
              >
                <option value="">請選擇來源</option>
                <option
                  v-for="l in catalog.snapshot.locations"
                  :key="l.id"
                  :value="l.id"
                >
                  {{ l.name }}
                </option>
              </select>
            </div>
            <div class="field" v-if="!outgoing">
              <label for="movement-to">目的庫位</label
              ><select id="movement-to" v-model="form.toLocationId" required>
                <option value="">請選擇目的</option>
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
              <label for="movement-quantity">數量</label
              ><input
                id="movement-quantity"
                v-model.number="form.quantity"
                required
                type="number"
                min="1"
                step="1"
                max="9007199254740991"
              />
            </div>
            <div class="field">
              <label for="movement-reason">異動原因／批次註記</label
              ><input
                id="movement-reason"
                v-model="form.reason"
                required
                maxlength="2000"
                placeholder="例如：第一批廠商到貨、包裝損壞"
              />
            </div>
          </fieldset>
          <button
            class="button primary"
            :disabled="catalog.busy || !form.productId || !form.reason.trim()"
          >
            {{ catalog.busy ? "儲存中…" : "確認登記異動" }}
          </button>
        </form>
      </section>
      <section class="section-block">
        <h2>各庫位現存數量</h2>
        <div class="field">
          <label for="inventory-filter">搜尋商品名稱</label
          ><input id="inventory-filter" v-model="filter" type="search" />
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>商品</th>
                <th>庫位</th>
                <th>現存數量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.product.id + r.location.id">
                <td>
                  {{ r.product.name }}
                  <span v-if="r.product.archived">（已封存）</span>
                </td>
                <td>{{ r.location.name }}</td>
                <td>{{ r.quantity }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!rows.length">尚無符合條件的庫存異動。</p>
      </section>
      <section class="section-block">
        <h2>庫存異動紀錄（{{ recent.length }}）</h2>
        <p>新紀錄在上方；沖銷會新增反向紀錄，原紀錄保留。</p>
        <article
          v-for="m in recent"
          :key="m.id"
          class="inventory-panel movement-card"
        >
          <div>
            <span class="soft-label">{{ m.code }}</span>
            <h3>
              {{ movementLabels[m.kind] }} ·
              {{ name("products", m.productId) }} × {{ m.quantity }}
            </h3>
            <p>
              {{ name("locations", m.fromLocationId) }} →
              {{ name("locations", m.toLocationId) }} ·
              {{ when(m.createdAt) }}（台灣時間）
            </p>
            <p>{{ m.reason }}</p>
            <p v-if="m.reversesId">
              沖銷來源：{{
                catalog.snapshot.movements.find((r) => r.id === m.reversesId)
                  ?.code
              }}
            </p>
            <p v-if="reversed(m.id)">此筆已沖銷。</p>
          </div>
          <button
            v-if="m.kind !== 'reversal' && !reversed(m.id)"
            type="button"
            class="button secondary"
            :disabled="catalog.busy"
            @click="
              reversing = m.id;
              reverseReason = '';
            "
          >
            沖銷更正
          </button>
          <form
            v-if="reversing === m.id"
            class="reversal"
            @submit.prevent="reverse"
          >
            <label :for="'reverse-' + m.id"
              >沖銷原因（若庫存已移走，需先處理後續異動）</label
            ><input
              :id="'reverse-' + m.id"
              v-model="reverseReason"
              required
              maxlength="2000"
              :disabled="catalog.busy"
            />
            <div class="dialog-actions">
              <button
                class="button secondary"
                type="button"
                :disabled="catalog.busy"
                @click="reversing = ''"
              >
                取消</button
              ><button
                class="button primary"
                :disabled="catalog.busy || !reverseReason.trim()"
              >
                確認沖銷
              </button>
            </div>
          </form>
        </article>
      </section>
    </template>
  </template>
</template>
<style scoped>
.inventory-panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  margin-bottom: 14px;
}
.inventory-panel p {
  line-height: 1.8;
}
.field {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
}
.workspace-picker {
  max-width: 440px;
  margin-top: 24px;
}
input,
select {
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 10px 12px;
  border: 1px solid #94a58b;
  border-radius: 6px;
  color: var(--text);
  background: #fcfdf9;
  font: inherit;
}
label {
  font-weight: 600;
}
.inline-form,
.form-grid {
  display: grid;
  gap: 16px;
}
fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.inline-form .button {
  align-self: end;
  margin-bottom: 16px;
}
.table-scroll {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: white;
}
th,
td {
  padding: 12px;
  text-align: left;
  border: 1px solid #b5c2b1;
}
th {
  background: #edf2e8;
}
.movement-card {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  overflow-wrap: anywhere;
}
.movement-card h3 {
  font-size: 17px;
}
.reversal {
  width: 100%;
  display: grid;
  gap: 12px;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (min-width: 700px) {
  .form-grid {
    grid-template-columns: 1fr 1fr;
  }
  .inline-form {
    grid-template-columns: 1fr auto;
  }
}
</style>
