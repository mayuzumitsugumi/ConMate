<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import { onlineComparison } from "../../domain/inventory/online";
import type {
  OnlineListing,
  OnlineListingInput,
} from "../../domain/models/catalog";
const catalog = useCatalogStore();
const editing = ref<string>(),
  notice = ref(""),
  error = ref(""),
  showArchived = ref(false);
const form = reactive<OnlineListingInput>({
  name: "",
  productId: "",
  locationId: "",
  url: "",
  quantity: 0,
  notes: "",
});
function reset() {
  editing.value = undefined;
  Object.assign(form, {
    name: "",
    productId: "",
    locationId: "",
    url: "",
    quantity: 0,
    notes: "",
  });
}
watch(
  () => catalog.snapshot?.workspaceId,
  () => {
    reset();
    notice.value = "";
    error.value = "";
  },
);
const listings = computed(
  () =>
    catalog.snapshot?.onlineListings.filter(
      (l) => showArchived.value || !l.archived,
    ) || [],
);
const comparisons = computed(() => {
  const s = catalog.snapshot;
  if (!s) return [];
  const pairs = new Map<string, { productId: string; locationId: string }>();
  for (const l of s.onlineListings.filter((l) => !l.archived))
    pairs.set(JSON.stringify([l.productId, l.locationId]), l);
  return [...pairs.values()].map((l) => ({
    ...l,
    ...onlineComparison(s, l.productId, l.locationId),
  }));
});
function edit(l: OnlineListing) {
  editing.value = l.id;
  Object.assign(form, {
    name: l.name,
    productId: l.productId,
    locationId: l.locationId,
    url: l.url,
    quantity: l.quantity,
    notes: l.notes,
  });
}
async function save() {
  error.value = "";
  notice.value = "";
  try {
    await catalog.saveOnlineListing({ ...form }, editing.value);
    reset();
    notice.value = "通販對照已儲存，核對時間已更新。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "儲存失敗。";
  }
}
async function archive(l: OnlineListing) {
  error.value = "";
  notice.value = "";
  try {
    await catalog.archiveOnlineListing(l.id);
    if (editing.value === l.id) reset();
    notice.value = l.archived
      ? "通販對照已恢復。"
      : "通販對照已封存，已從合計移除。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "儲存失敗。";
  }
}
const name = (kind: "products" | "locations", id: string) =>
  catalog.snapshot?.[kind].find((r) => r.id === id)?.name || "";
const when = (time: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(time));
</script>
<template>
  <section
    v-if="catalog.snapshot"
    class="online-panel section-block"
    aria-labelledby="online-title"
  >
    <h2 id="online-title">通販庫存對照</h2>
    <p>
      貼上網店商品連結，手動記錄網店顯示的可售數量。連結不會自動讀取或同步庫存；每次核對後更新數量並儲存。
    </p>
    <p>
      同商品、同出貨庫位的所有啟用網店數量會合計對照。差額為「本機帳面現存 −
      網店記錄合計」；本機現存仍需實物盤點核實。記錄不會預留或扣除實物庫存，未完成訂單也未計入。
    </p>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error-notice" role="alert">{{ error }}</p>
    <h3>{{ editing ? "更新通販對照" : "新增通販對照" }}</h3>
    <form @submit.prevent="save">
      <fieldset :disabled="catalog.busy" class="online-grid">
        <div class="field">
          <label for="online-shop">商店／通路名稱</label
          ><input
            id="online-shop"
            v-model="form.name"
            required
            maxlength="80"
            placeholder="例如：我的賣貨便"
          />
        </div>
        <div class="field">
          <label for="online-product">網店對應商品</label
          ><select id="online-product" v-model="form.productId" required>
            <option value="">請選擇商品</option>
            <option
              v-for="p in catalog.snapshot.products.filter(
                (p) => !p.archived || p.id === form.productId,
              )"
              :key="p.id"
              :value="p.id"
            >
              {{ p.name }} · {{ p.code }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="online-location">實物出貨庫位</label
          ><select id="online-location" v-model="form.locationId" required>
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
        <div class="field">
          <label for="online-url">網店商品連結</label
          ><input
            id="online-url"
            v-model="form.url"
            required
            type="url"
            maxlength="2000"
            placeholder="https://…"
          />
        </div>
        <div class="field">
          <label for="online-quantity">網店顯示的可售數量</label
          ><input
            id="online-quantity"
            v-model.number="form.quantity"
            required
            type="number"
            min="0"
            step="1"
            max="9007199254740991"
          />
        </div>
        <div class="field">
          <label for="online-notes">核對備註（選填）</label
          ><input id="online-notes" v-model="form.notes" maxlength="2000" />
        </div>
      </fieldset>
      <div class="actions">
        <button class="button primary" :disabled="catalog.busy">
          儲存通販對照</button
        ><button
          v-if="editing"
          class="button secondary"
          type="button"
          :disabled="catalog.busy"
          @click="reset"
        >
          取消編輯
        </button>
      </div>
    </form>
    <h3>庫存差額摘要</h3>
    <p v-if="!comparisons.length">尚無啟用的通販對照。</p>
    <div v-else class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>商品／庫位</th>
            <th>本機現存</th>
            <th>網店合計</th>
            <th>差額</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in comparisons" :key="r.productId + r.locationId">
            <td>
              {{ name("products", r.productId) }}／{{
                name("locations", r.locationId)
              }}
            </td>
            <td>{{ r.physical }}</td>
            <td>{{ r.listed }}</td>
            <td>
              {{ r.difference
              }}<strong v-if="r.difference < 0">
                · 網店數量超過現存，請核對</strong
              ><span v-else-if="r.difference === 0"> · 記錄相符</span
              ><span v-else> · 尚有差額，請核對是否保留其他用途</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <label class="archive-filter"
      ><input v-model="showArchived" type="checkbox" />顯示已封存通販對照</label
    >
    <article v-for="l in listings" :key="l.id" class="listing">
      <h3>{{ l.name }}{{ l.archived ? "（已封存）" : "" }}</h3>
      <p>
        {{ name("products", l.productId) }}／{{
          name("locations", l.locationId)
        }}
        · 網店記錄 {{ l.quantity }} 件
      </p>
      <p>最後手動核對：{{ when(l.checkedAt) }}（台灣時間）</p>
      <p v-if="l.notes">{{ l.notes }}</p>
      <a
        :href="l.url"
        target="_blank"
        rel="noopener noreferrer"
        class="button secondary"
        >開啟網店商品頁 ↗</a
      >
      <div class="actions">
        <button
          type="button"
          class="button secondary"
          :disabled="catalog.busy || l.archived"
          @click="edit(l)"
        >
          編輯／重新核對</button
        ><button
          type="button"
          class="text-button"
          :disabled="catalog.busy"
          @click="archive(l)"
        >
          {{ l.archived ? "恢復對照" : "封存對照" }}
        </button>
      </div>
    </article>
  </section>
</template>
<style scoped>
.online-panel {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  overflow-wrap: anywhere;
}
p {
  line-height: 1.8;
}
.online-grid {
  display: grid;
  gap: 16px;
  border: 0;
  padding: 0;
  min-width: 0;
}
.field {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}
label {
  font-weight: 600;
}
input:not([type="checkbox"]),
select {
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 10px 12px;
  border: 1px solid #94a58b;
  border-radius: 6px;
  background: #fcfdf9;
  color: var(--text);
  font: inherit;
}
.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 16px 0;
}
.table-scroll {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 12px;
  border: 1px solid #b5c2b1;
  text-align: left;
}
th {
  background: #edf2e8;
}
.listing {
  border-top: 1px solid #b5c2b1;
  padding: 16px 0;
}
.archive-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin-top: 16px;
}
input[type="checkbox"] {
  width: 20px;
  height: 20px;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (min-width: 700px) {
  .online-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
