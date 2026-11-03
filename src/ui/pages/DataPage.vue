<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { useCatalogStore } from "../../app/catalog-store";
import {
  downloadProject,
  downloadSnapshot,
} from "../../application/export-project";
import { salesDraftRepository } from "../../application/sales-drafts";
import { checkProjectFile } from "../../application/restore-project";
import {
  restoreWorkspace,
  previewWorkspaceRestore,
  replaceWorkspace,
} from "../../infrastructure/storage/restore";
import { database } from "../../infrastructure/storage/workspaces";
import {
  confirmBackupSaved,
  backupReminder,
  type BackupStatus,
  type RecoverySnapshot,
} from "../../infrastructure/storage/local-backups";
import { validateRestoreSnapshot } from "../../domain/validation/restore";
import type { CatalogSnapshot } from "../../domain/models/catalog";
import AppIcon from "../components/AppIcon.vue";
import CloudBackupPanel from "../components/CloudBackupPanel.vue";
const workspaces = useWorkspaceStore(),
  catalog = useCatalogStore();
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
const restoreComparison = ref<Awaited<
  ReturnType<typeof previewWorkspaceRestore>
> | null>(null);
const replaceChosen = ref(false),
  replacePhrase = ref(""),
  previewSource = ref<"file" | "recovery">("file");
const duplicate = computed(() => !!restoreComparison.value?.local);
const changes = computed(
  () =>
    restoreComparison.value?.differences.filter(
      (d) => d.added || d.changed || d.removed,
    ) || [],
);
const backups = ref<BackupStatus>(),
  currentRevision = ref<number>(),
  recoveries = ref<RecoverySnapshot[]>([]);
const backupMessage = computed(() =>
  currentRevision.value === undefined
    ? ""
    : backupReminder(backups.value, currentRevision.value),
);
const storageInfo = ref("尚未讀取儲存空間資訊。"),
  storageBusy = ref(false),
  savingConfirmation = ref(false);
let loadRequest = 0;
async function refreshLocal() {
  const id = workspaces.activeWorkspaceId,
    request = ++loadRequest;
  if (!id) {
    backups.value = undefined;
    currentRevision.value = undefined;
    recoveries.value = [];
    return;
  }
  try {
    const [status, workspace, rows] = await Promise.all([
      database.backupStatus.get(id),
      database.catalogs.get(id),
      database.recoverySnapshots.where("workspaceId").equals(id).toArray(),
    ]);
    if (request !== loadRequest) return;
    backups.value = status;
    currentRevision.value = workspace?.revision ?? 0;
    recoveries.value = rows.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  } catch {
    if (request === loadRequest)
      error.value = "無法讀取本機備份狀態，請保留外部專案檔。";
  }
}
watch(
  () => workspaces.activeWorkspaceId,
  () => {
    void refreshLocal();
  },
  { immediate: true },
);
async function preparePreview(
  snapshot: CatalogSnapshot,
  source: "file" | "recovery",
) {
  restoreComparison.value = await previewWorkspaceRestore(snapshot);
  preview.value = restoreComparison.value.incoming;
  previewSource.value = source;
  confirmed.value = false;
  replaceChosen.value = false;
  replacePhrase.value = "";
}
async function previewCloud(snapshot: CatalogSnapshot, label: string) {
  if (checking.value || restoring.value) return;
  checking.value = true;
  restoreError.value = "";
  restoreNotice.value = "";
  try {
    filename.value = label;
    await preparePreview(snapshot, "file");
  } catch (e) {
    restoreError.value = e instanceof Error ? e.message : "無法預覽遠端備份。";
  } finally {
    checking.value = false;
  }
}
async function checkFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (checking.value || restoring.value) return;
  preview.value = null;
  restoreComparison.value = null;
  confirmed.value = false;
  restoreError.value = "";
  restoreNotice.value = "";
  if (!file) return;
  checking.value = true;
  filename.value = file.name;
  try {
    await preparePreview(await checkProjectFile(file), "file");
  } catch (e) {
    restoreError.value = e instanceof Error ? e.message : "檔案檢查失敗。";
  } finally {
    checking.value = false;
  }
}
async function previewRecovery(row: RecoverySnapshot) {
  if (checking.value || restoring.value) return;
  checking.value = true;
  restoreError.value = "";
  restoreNotice.value = "";
  try {
    filename.value = `本機復原快照：${new Date(row.createdAt).toLocaleString("zh-TW")}`;
    await preparePreview(JSON.parse(JSON.stringify(row.snapshot)), "recovery");
  } catch (e) {
    restoreError.value = e instanceof Error ? e.message : "無法預覽復原快照。";
  } finally {
    checking.value = false;
  }
}
async function refreshPreview() {
  if (!preview.value || checking.value || restoring.value) return;
  checking.value = true;
  restoreError.value = "";
  try {
    await preparePreview(
      JSON.parse(JSON.stringify(preview.value)),
      previewSource.value,
    );
  } catch (e) {
    restoreError.value = e instanceof Error ? e.message : "無法重新檢查差異。";
  } finally {
    checking.value = false;
  }
}
async function restore() {
  if (!preview.value || !confirmed.value || restoring.value) return;
  if (
    duplicate.value &&
    (!replaceChosen.value || replacePhrase.value !== "取代工作區")
  )
    return;
  restoring.value = true;
  restoreError.value = "";
  try {
    const input = JSON.parse(JSON.stringify(preview.value));
    let id: string;
    if (duplicate.value) {
      const result = await replaceWorkspace(
        input,
        restoreComparison.value!.expectedLocalContent!,
        previewSource.value,
      );
      id = result.workspaceId;
      restoreNotice.value = `取代完成，修訂已更新為 ${result.revision}。取代前資料已保留在本機復原快照；請另行匯出外部備份。`;
    } else {
      id = await restoreWorkspace(input);
      restoreNotice.value =
        "還原完成。已選取還原的工作區，可前往商品或企劃頁檢視。";
    }
    if (duplicate.value) {
      try {
        await salesDraftRepository.remove(id);
      } catch {
        restoreNotice.value +=
          " 購物車草稿清除未成功，請到販售頁確認並清空舊草稿。";
      }
    }
    await workspaces.load();
    workspaces.select(id);
    await catalog.load(id);
    await refreshLocal();
    preview.value = null;
    restoreComparison.value = null;
    confirmed.value = false;
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
    const result = await downloadProject(workspaces.activeWorkspaceId);
    notice.value = result.trackingStored
      ? "已產生專案檔並發起下載。請確認檔案已保存，再按下方確認；發起下載不代表已保存。"
      : "已發起下載，但無法記錄備份狀態。請自行確認檔案已保存。";
    await refreshLocal();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "匯出失敗，本機資料仍保留。";
  } finally {
    exporting.value = false;
  }
}
async function confirmSaved() {
  if (
    !workspaces.activeWorkspaceId ||
    !backups.value?.downloadedAt ||
    savingConfirmation.value
  )
    return;
  savingConfirmation.value = true;
  error.value = "";
  try {
    await confirmBackupSaved(
      workspaces.activeWorkspaceId,
      backups.value.downloadedAt,
    );
    await refreshLocal();
    notice.value =
      "已記錄你的保存確認。建議仍保留多份備份，並定期檢查能否還原。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "無法記錄保存確認。";
  } finally {
    savingConfirmation.value = false;
  }
}
async function downloadRecovery(row: RecoverySnapshot) {
  if (exporting.value) return;
  exporting.value = true;
  error.value = "";
  try {
    await downloadSnapshot(
      validateRestoreSnapshot(JSON.parse(JSON.stringify(row.snapshot))),
      true,
    );
    notice.value =
      "已發起復原快照檔案下載。這不是目前工作區的最新備份，請確認檔案已保存。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "復原快照匯出失敗。";
  } finally {
    exporting.value = false;
  }
}
async function inspectStorage(requestPersist = false) {
  if (storageBusy.value) return;
  storageBusy.value = true;
  try {
    const storage = navigator.storage;
    if (!storage) {
      storageInfo.value = "此瀏覽器未提供儲存空間查詢，請持續保留外部備份。";
      return;
    }
    const granted =
      requestPersist && storage.persist ? await storage.persist() : undefined;
    const persisted = storage.persisted ? await storage.persisted() : undefined;
    const estimate = storage.estimate ? await storage.estimate() : {};
    const usage = estimate.usage,
      quota = estimate.quota;
    storageInfo.value = `${persisted ? "已取得較持久的儲存資格" : "尚未取得較持久的儲存資格"}。${usage !== undefined && quota !== undefined ? `此網站來源約使用 ${(usage / 1048576).toFixed(1)} MB／總額度 ${(quota / 1048576).toFixed(1)} MB。` : "瀏覽器未回報容量。"}${requestPersist && granted === false ? "瀏覽器未批准申請。" : ""}清除網站資料、裝置故障仍可能遺失資料，請保留外部備份。`;
  } catch {
    storageInfo.value = "無法取得儲存資訊，請檢查瀏覽器設定並保留外部備份。";
  } finally {
    storageBusy.value = false;
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
    <template v-if="workspaces.activeWorkspaceId">
      <p>{{ backupMessage || "目前修訂已由你確認保存外部備份。" }}</p>
      <p v-if="backups?.downloadedAt">
        最近發起下載：修訂 {{ backups.downloadedRevision }}，{{
          new Date(backups.downloadedAt).toLocaleString("zh-TW")
        }}（不代表已保存）
      </p>
      <p v-if="backups?.confirmedAt">
        最近由你確認保存：修訂 {{ backups.confirmedRevision }}，{{
          new Date(backups.confirmedAt).toLocaleString("zh-TW")
        }}
      </p>
      <button
        v-if="backups?.downloadedAt"
        class="button secondary"
        :disabled="savingConfirmation || exporting"
        @click="confirmSaved"
      >
        我已確認下載檔已保存
      </button>
    </template>
  </section>
  <aside class="info-banner section-block">
    <div>
      <strong>完整備份與活動檔分開處理</strong>
      <p>
        本頁匯出及還原完整工作區。只交付本次販售資料，請到
        <RouterLink to="/activities">活動配置與交接</RouterLink
        >；接手活動進行檔或結案檔，請到
        <RouterLink to="/activity">活動工作台</RouterLink
        >匯入，不會取代整個工作區。
      </p>
    </div>
  </aside>
  <CloudBackupPanel @preview="previewCloud" @backed-up="refreshLocal" />
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
      <template v-if="duplicate">
        <p class="error-notice" role="alert">
          本機已有相同工作區。預設不會覆蓋或合併；你可以比對下列差異後，明確選擇用檔案取代整個工作區。
        </p>
        <p>
          本機修訂 {{ restoreComparison?.local?.revision }} → 檔案修訂
          {{
            preview.revision
          }}。較舊備份會取代後來的交易與修改；修訂號不代表內容比較結果。
        </p>
        <p
          v-if="
            restoreComparison?.local?.workspace.name !== preview.workspace.name
          "
        >
          工作區名稱：{{ restoreComparison?.local?.workspace.name }} →
          {{ preview.workspace.name }}
        </p>
        <div v-if="changes.length" class="difference-table">
          <table>
            <thead>
              <tr>
                <th>資料</th>
                <th>新增</th>
                <th>改變</th>
                <th>移除</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in changes" :key="row.key">
                <th>{{ row.label }}</th>
                <td>{{ row.added }}</td>
                <td>{{ row.changed }}</td>
                <td>{{ row.removed }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else>清單內容沒有差異；原始工作區資料及修訂仍以完整取代處理。</p>
        <p>
          取代前會在同一裝置保存復原快照。它仍會隨網站資料清除而消失，建議先匯出目前工作區到外部。
        </p>
        <label class="restore-confirm"
          ><input
            v-model="replaceChosen"
            type="checkbox"
            :disabled="restoring"
          />我要以檔案完整取代本機同一工作區，不進行合併</label
        >
        <label for="replace-phrase">請輸入「取代工作區」確認</label
        ><input
          id="replace-phrase"
          v-model="replacePhrase"
          :disabled="restoring"
          autocomplete="off"
        />
        <label class="restore-confirm"
          ><input
            v-model="confirmed"
            type="checkbox"
            :disabled="restoring"
          />我已檢視差異，了解檔案以外的本機更新會被取代，且復原快照不是外部備份</label
        >
        <button
          class="button primary"
          :disabled="
            !confirmed ||
            !replaceChosen ||
            replacePhrase !== '取代工作區' ||
            restoring
          "
          @click="restore"
        >
          {{ restoring ? "正在取代…" : "確認取代本機工作區" }}
        </button>
      </template>
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
        :disabled="checking || restoring"
        @click="refreshPreview"
      >
        重新檢查差異
      </button>
      <button
        class="button secondary"
        :disabled="restoring"
        @click="
          preview = null;
          restoreComparison = null;
          confirmed = false;
        "
      >
        取消預覽
      </button>
    </div>
    <p>
      目前支援網站專案格式 2.1.0 至 2.15.0。還原保留原
      ID與封存內容；新增還原保留原修訂，明確取代時提高修訂以避免其他分頁覆寫。
    </p>
  </section>
  <section class="catalog-panel section-block" aria-labelledby="recovery-title">
    <h2 id="recovery-title">本機復原快照與儲存空間</h2>
    <p>
      每次明確取代工作區前，系統會在同一筆安全提交中保存原資料。這些快照只在此瀏覽器，不能取代外部備份。
    </p>
    <p v-if="!recoveries.length">目前工作區尚無取代前的復原快照。</p>
    <article
      v-for="row in recoveries.slice(0, 10)"
      :key="row.id"
      class="recovery-row"
    >
      <p>
        {{ new Date(row.createdAt).toLocaleString("zh-TW") }} · 原修訂
        {{ row.snapshot.revision }} · 商品
        {{ row.snapshot.products.length }} 項／交易
        {{ row.snapshot.sales.length }} 筆
      </p>
      <button
        class="button secondary"
        :disabled="checking || restoring"
        @click="previewRecovery(row)"
      >
        預覽此復原快照
      </button>
      <button
        class="button secondary"
        :disabled="exporting"
        @click="downloadRecovery(row)"
      >
        下載此復原快照
      </button>
    </article>
    <p v-if="recoveries.length > 10">
      顯示最近10份，共保留 {{ recoveries.length }} 份。
    </p>
    <p>{{ storageInfo }}</p>
    <div class="storage-actions">
      <button
        class="button secondary"
        :disabled="storageBusy"
        @click="inspectStorage(false)"
      >
        查看儲存空間</button
      ><button
        class="button secondary"
        :disabled="storageBusy"
        @click="inspectStorage(true)"
      >
        申請較持久的本機儲存
      </button>
    </div>
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
        可下載到裝置、自行放進 Google
        Drive／OneDrive，或選配以權杖連接自己的私有 GitHub
        備份。只有在雲端區確認備份後才會上傳；沒有自動同步或背景備份。
      </p>
    </div>
  </aside>
</template>
<style scoped>
.difference-table {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  border: 1px solid #acbda8;
  padding: 9px;
  text-align: left;
}
.recovery-row {
  border: 1px solid #acbda8;
  padding: 14px;
  border-radius: 8px;
}
.recovery-row button {
  margin: 4px 8px 4px 0;
}
.storage-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
#replace-phrase {
  font: inherit;
  padding: 12px;
  border: 1px solid #94a58b;
  border-radius: 6px;
  max-width: 100%;
  min-width: 0;
}

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
