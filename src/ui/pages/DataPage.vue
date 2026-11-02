<script setup lang="ts">
import { computed, ref } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { downloadProject } from "../../application/export-project";
import { checkProjectFile } from "../../application/restore-project";
import { restoreWorkspace } from "../../infrastructure/storage/restore";
import type { CatalogSnapshot } from "../../domain/models/catalog";
import AppIcon from "../components/AppIcon.vue";
const workspaces = useWorkspaceStore();
const exporting = ref(false),
  notice = ref(""),
  error = ref("");
const checking = ref(false),
  restoring = ref(false),
  restoreError = ref(""),
  restoreNotice = ref("");
const preview = ref<CatalogSnapshot | null>(null),
  filename = ref(""),
  confirmed = ref(false);
const duplicate = computed(
  () =>
    !!preview.value &&
    workspaces.workspaces.some((w) => w.id === preview.value?.workspaceId),
);
async function checkFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  preview.value = null;
  confirmed.value = false;
  restoreError.value = "";
  restoreNotice.value = "";
  if (!file || checking.value || restoring.value) return;
  checking.value = true;
  filename.value = file.name;
  try {
    preview.value = await checkProjectFile(file);
  } catch (e) {
    restoreError.value = e instanceof Error ? e.message : "檔案檢查失敗。";
  } finally {
    checking.value = false;
  }
}
async function restore() {
  if (!preview.value || !confirmed.value || duplicate.value || restoring.value)
    return;
  restoring.value = true;
  restoreError.value = "";
  try {
    const id = await restoreWorkspace(
      JSON.parse(JSON.stringify(preview.value)),
    );
    await workspaces.load();
    workspaces.select(id);
    preview.value = null;
    confirmed.value = false;
    restoreNotice.value =
      "還原完成。已選取還原的工作區，可前往商品或企劃頁檢視。";
  } catch (e) {
    restoreError.value =
      e instanceof Error ? e.message : "還原失敗，既有工作區未更動。";
  } finally {
    restoring.value = false;
  }
}
async function download() {
  if (exporting.value || !workspaces.activeWorkspaceId) return;
  exporting.value = true;
  notice.value = "";
  error.value = "";
  try {
    await downloadProject(workspaces.activeWorkspaceId);
    notice.value =
      "已產生一份完整建檔專案檔並發起下載。請確認已保存；下載不等於已存入雲端。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "匯出失敗，本機資料仍保留。";
  } finally {
    exporting.value = false;
  }
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">ONE PROJECT, ONE FILE</div>
      <h1>專案檔與備份</h1>
      <p>先在網站填資料，再一鍵帶走一份檔案。不需要先學會 Excel 模板。</p>
    </div>
  </section>
  <section class="catalog-panel section-block">
    <h2>一個工作區，一份專案檔</h2>
    <p>
      日常表只呈現你已建立的商品、企劃、場次與自訂設定。沒有使用的成本、代墊、抽選等功能，不會先放一堆空白表；不用為每個功能管理不同檔案。
    </p>
    <template v-if="workspaces.activeWorkspaceId"
      ><label for="export-workspace">要匯出的工作區</label
      ><select
        id="export-workspace"
        :value="workspaces.activeWorkspaceId"
        :disabled="exporting"
        @change="workspaces.select(($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="workspace in workspaces.workspaces"
          :key="workspace.id"
          :value="workspace.id"
        >
          {{ workspace.name }}
        </option></select
      ><button class="button primary" :disabled="exporting" @click="download">
        <AppIcon name="download" />{{
          exporting ? "正在整理專案檔…" : "一鍵匯出專案檔（Excel）"
        }}
      </button></template
    >
    <RouterLink v-else class="button primary" to="/">先建立工作區</RouterLink>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error-notice" role="alert">{{ error }}</p>
  </section>
  <section class="catalog-panel section-block" aria-labelledby="restore-title">
    <h2 id="restore-title">檢查與還原專案檔</h2>
    <p>
      選擇從網站匯出的專案檔，先檢查並預覽，確認後才存入本機。檔案只在你的裝置處理。
    </p>
    <label for="restore-file">選擇 Excel 專案檔（.xlsx，最多 10 MB）</label>
    <input
      id="restore-file"
      type="file"
      accept=".xlsx"
      :disabled="checking || restoring"
      @change="checkFile"
    />
    <p v-if="checking" role="status">正在檢查檔案，尚未寫入工作區…</p>
    <p v-if="restoreError" class="error-notice" role="alert">
      {{ restoreError }}
    </p>
    <p v-if="restoreNotice" class="success-notice" role="status">
      {{ restoreNotice }}
    </p>
    <div v-if="preview" class="restore-preview">
      <h3>檢查通過：{{ preview.workspace.name }}</h3>
      <p>{{ filename }} · 來源修訂 {{ preview.revision }}</p>
      <ul>
        <li>商品 {{ preview.products.length }} 項（含封存）</li>
        <li>創作者 {{ preview.parties.length }} 位</li>
        <li>
          庫存異動 {{ preview.movements.length }} 筆、交易
          {{ preview.sales.length }} 筆
        </li>
        <li>
          成本 {{ preview.costs.length }} 筆、代墊
          {{ preview.advances.length }} 筆
        </li>
        <li>
          企劃 {{ preview.projects.length }} 個、場次
          {{ preview.events.length }} 個
        </li>
        <li>
          標記 {{ preview.tags.length }} 個、自訂欄位
          {{ preview.fields.length }} 個
        </li>
      </ul>
      <p v-if="duplicate" class="error-notice" role="alert">
        本機已有相同工作區。為保護資料，本版不會覆蓋或合併。若要驗證跨裝置還原，可在另一台裝置或另一個瀏覽器開啟網站後選取這份檔案。
      </p>
      <template v-else>
        <label class="restore-confirm"
          ><input
            v-model="confirmed"
            type="checkbox"
            :disabled="restoring"
          />我確認以檔案中的完整紀錄新增工作區；日常工作表的外部修改不會套用。</label
        >
        <button
          class="button primary"
          :disabled="!confirmed || restoring"
          @click="restore"
        >
          {{ restoring ? "正在還原…" : "確認新增還原工作區" }}
        </button>
      </template>
      <button
        class="button secondary"
        :disabled="restoring"
        @click="
          preview = null;
          confirmed = false;
        "
      >
        取消預覽
      </button>
    </div>
    <p>
      目前支援網站專案格式
      2.1.0、2.2.0、2.3.0、2.4.0、2.5.0、2.6.0、2.7.0、2.8.0。還原保留原
      ID、修訂與封存內容；不自動改編號，也不會覆蓋現有工作區。
    </p>
  </section>
  <section class="section-block">
    <div class="section-title">
      <div><h2>從這三步開始</h2></div>
    </div>
    <div class="steps-grid">
      <article class="step-card">
        <span class="step-number">01</span>
        <h3>直接新增商品</h3>
        <p>填名稱就能先存；創作者、企劃和種類可逐步補齊。種類自由輸入。</p>
        <RouterLink class="step-link" to="/products">前往商品建檔 →</RouterLink>
      </article>
      <article class="step-card">
        <span class="step-number">02</span>
        <h3>需要時才加欄位</h3>
        <p>
          新商品、限定販售、清倉等標記由你決定；還能設定自己的文字或下拉欄位。
        </p>
        <RouterLink class="step-link" to="/customize"
          >自訂商品資料 →</RouterLink
        >
      </article>
      <article class="step-card">
        <span class="step-number">03</span>
        <h3>定期保存同一份檔案</h3>
        <p>商品、選項、封存內容及穩定關聯一併保存，不必填寫 new: 或正式 ID。</p>
      </article>
    </div>
  </section>
  <aside class="info-banner section-block">
    <AppIcon name="info" />
    <div>
      <strong>可匯出並在新裝置還原網站專案檔。</strong>
      <p>
        檔案包含全部「目前網站能建立的資料」，包含已開放的交易、成本與代墊；尚不包含未開放的進階分潤規則。完整紀錄放在同一檔案的隱藏系統表，隱藏不是加密。還原以完整系統紀錄為準；請回網站編輯後再匯出，不要修改系統表。下載後請確認檔案已保存，也不要因此清除本機資料。
      </p>
    </div>
  </aside>
  <details class="sheet-details">
    <summary>進階：舊版完整 Excel 模板</summary>
    <div class="legacy-note">
      <p>
        保留供先前已使用模板的人參考。它有大量預留工作表，現在不需要從這裡開始；新版網站專案檔採簡化呈現，兩者不是相同匯入格式。
      </p>
      <RouterLink class="text-button" to="/templates/advanced"
        >查看舊版模板與填寫指南 →</RouterLink
      >
    </div>
  </details>
  <aside class="backup-note">
    <AppIcon name="shield" />
    <div>
      <strong>備份放哪裡，由你決定。</strong>
      <p>
        可自行把這份檔案放到裝置、Google Drive、OneDrive 或自己的私有 GitHub
        repository。自動雲端備份尚未提供，網站不會上傳你的商品資料。
      </p>
    </div>
  </aside>
</template>
<style scoped>
.restore-preview {
  border: 1px solid #acbda8;
  border-radius: 8px;
  padding: 18px;
  display: grid;
  gap: 14px;
  overflow-wrap: anywhere;
}
.restore-preview ul {
  margin: 0;
  padding-left: 24px;
  line-height: 1.9;
}
.restore-confirm {
  display: flex;
  align-items: start;
  gap: 10px;
}
.restore-confirm input {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
input[type="file"] {
  max-width: 100%;
  font: inherit;
  min-height: 44px;
}

.catalog-panel {
  background: white;
  border: 1px solid var(--line);
  padding: 24px;
  border-radius: 12px;
  display: grid;
  gap: 18px;
}
.catalog-panel p,
.legacy-note p {
  font-size: 15px;
  line-height: 1.9;
}
.catalog-panel label {
  font-size: 15px;
  font-weight: 600;
}
.catalog-panel select {
  font: inherit;
  border: 1px solid #94a58b;
  border-radius: 6px;
  padding: 11px;
  min-height: 46px;
  max-width: 100%;
  min-width: 0;
}
.catalog-panel .button {
  justify-self: start;
}
.legacy-note {
  padding: 0 20px 20px;
}
h2 {
  font-size: 20px;
}
.info-banner {
  margin-top: 28px;
}
</style>
