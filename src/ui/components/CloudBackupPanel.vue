<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { catalogRepository } from "../../infrastructure/storage/catalog";
import { GitHubBackupClient } from "../../infrastructure/cloud/github";
import { recordCloudBackup } from "../../infrastructure/storage/local-backups";
import { database } from "../../infrastructure/storage/workspaces";
import type { BackupStatus } from "../../infrastructure/storage/local-backups";
import type { CatalogSnapshot } from "../../domain/models/catalog";
const emit = defineEmits<{
  preview: [snapshot: CatalogSnapshot, label: string];
  backedUp: [];
}>();
const workspaces = useWorkspaceStore();
const owner = ref(""),
  repo = ref(""),
  branch = ref("main"),
  token = ref("");
const busy = ref(false),
  error = ref(""),
  notice = ref("");
const client = shallowRef<GitHubBackupClient>();
const connection = ref<Awaited<ReturnType<GitHubBackupClient["connect"]>>>();
const prepared =
  shallowRef<Awaited<ReturnType<GitHubBackupClient["prepareBackup"]>>>();
const backups = ref<Awaited<ReturnType<GitHubBackupClient["listBackups"]>>>([]);
const versions = ref<Awaited<ReturnType<GitHubBackupClient["history"]>>>([]);
const selectedPath = ref(""),
  version = ref("");
const approved = ref(false);
const commitUrl = ref("");
const savedCloud = ref<BackupStatus["cloud"]>();
watch(
  () => workspaces.activeWorkspaceId,
  async (id) => {
    savedCloud.value = undefined;
    if (id) {
      const row = await database.backupStatus.get(id).catch(() => undefined);
      if (id === workspaces.activeWorkspaceId) savedCloud.value = row?.cloud;
    }
  },
  { immediate: true },
);
const canPrepare = computed(
  () => !!connection.value && !!workspaces.activeWorkspaceId && !busy.value,
);
watch(
  () => workspaces.activeWorkspaceId,
  () => {
    prepared.value = undefined;
    approved.value = false;
  },
);
function disconnect() {
  client.value?.disconnect();
  client.value = undefined;
  connection.value = undefined;
  token.value = "";
  prepared.value = undefined;
  approved.value = false;
  backups.value = [];
  versions.value = [];
  selectedPath.value = "";
  version.value = "";
  notice.value =
    "已斷開。未刪除本機工作區或 GitHub 檔案；權杖若不再使用，請到 GitHub 撤銷。";
  error.value = "";
}
onBeforeUnmount(() => {
  client.value?.disconnect();
  token.value = "";
});
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await action();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失敗，本機資料未更動。";
  } finally {
    busy.value = false;
  }
}
async function connect() {
  await run(async () => {
    const secret = token.value;
    token.value = "";
    const next = new GitHubBackupClient(secret);
    try {
      const result = await next.connect(
        owner.value.trim(),
        repo.value.trim(),
        branch.value.trim(),
      );
      client.value?.disconnect();
      client.value = next;
      connection.value = result;
      notice.value = `已以 ${result.login} 連接指定私有儲存庫；尚未上傳任何備份。`;
    } catch (e) {
      next.disconnect();
      throw e;
    }
  });
}
async function prepare() {
  prepared.value = undefined;
  approved.value = false;
  await run(async () => {
    if (!client.value || !workspaces.activeWorkspaceId) return;
    const id = workspaces.activeWorkspaceId;
    const snapshot = await catalogRepository.read(id);
    const result = await client.value.prepareBackup(snapshot);
    if (id !== workspaces.activeWorkspaceId)
      throw new Error("工作區已切換，請重新準備備份。");
    prepared.value = result;
  });
}
async function upload() {
  if (!approved.value || !prepared.value || !client.value) return;
  await run(async () => {
    const p = prepared.value!;
    const result = await client.value!.uploadBackup(p);
    let changed = true;
    try {
      const current = await catalogRepository.read(p.workspaceId);
      changed = JSON.stringify(current) !== JSON.stringify(p.snapshot);
    } catch {
      /* Remote success stays success even if local status cannot be read. */
    }
    const c = connection.value!;
    let recorded = true;
    const cloud = {
      revision: p.revision,
      at: result.at,
      commit: result.commit,
      owner: c.owner,
      repo: c.repo,
      branch: c.branch,
      path: p.path,
    };
    try {
      await recordCloudBackup(p.workspaceId, cloud);
      if (p.workspaceId === workspaces.activeWorkspaceId)
        savedCloud.value = cloud;
    } catch {
      recorded = false;
    }
    emit("backedUp");
    commitUrl.value = `https://github.com/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/commit/${result.commit}`;
    notice.value = `GitHub 已確認備份修訂 ${p.revision}，時間 ${new Date(result.at).toLocaleString("zh-TW")}。${changed ? "本機可能仍有未備份變更，請核對後再準備一份。" : "請另保留必要的本機外部備份。"}${recorded ? "" : " 雲端已寫入，但本機成功狀態未能保存，請保留 commit 連結。"}`;
    prepared.value = undefined;
    approved.value = false;
  });
}
async function list() {
  await run(async () => {
    backups.value = await client.value!.listBackups();
    selectedPath.value = backups.value[0]?.path || "";
    versions.value = [];
    version.value = "";
    if (!backups.value.length)
      notice.value = "指定儲存庫目前沒有 ConMate 備份。";
  });
}
async function loadHistory() {
  await run(async () => {
    versions.value = await client.value!.history(selectedPath.value);
    version.value = "";
  });
}
async function previewRemote() {
  await run(async () => {
    const result = await client.value!.downloadBackup(
      selectedPath.value,
      version.value || undefined,
    );
    emit(
      "preview",
      result.snapshot,
      `GitHub：${selectedPath.value}${version.value ? ` · ${version.value.slice(0, 8)}` : " · 目前版本"}`,
    );
    notice.value =
      "遠端檔案檢查通過。請到下方「檢查與還原專案檔」預覽差異；尚未寫入本機。";
    document
      .getElementById("restore-title")
      ?.scrollIntoView({ block: "start" });
  });
}
</script>
<template>
  <section class="cloud-panel section-block" aria-labelledby="cloud-title">
    <h2 id="cloud-title">選配：備份到自己的 GitHub</h2>
    <p>
      使用你自己的私有儲存庫保存一份 Excel 專案檔及版本。不需要 ConMate
      帳號；這是個人存取權杖連接，不是 GitHub OAuth 登入，也不是多人同步。
    </p>
    <p v-if="savedCloud">
      此裝置記錄的上次 GitHub 成功備份：修訂 {{ savedCloud.revision }}，{{
        new Date(savedCloud.at).toLocaleString("zh-TW")
      }}，{{ savedCloud.owner }}/{{
        savedCloud.repo
      }}。這是歷史成功紀錄，並未重新確認遠端檔案仍存在。
    </p>
    <details class="setup-guide">
      <summary>第一次設定：建立自己的私有儲存庫與權杖</summary>
      <ol>
        <li>
          在
          <a
            href="https://github.com/new"
            target="_blank"
            rel="noopener noreferrer"
            >GitHub 建立儲存庫</a
          >，選 Private，勾選加入 README 以建立第一個分支。建議只用來存 ConMate
          備份，不需要啟用 Pages。
        </li>
        <li>
          到
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noopener noreferrer"
            >建立 fine-grained personal access token</a
          >，設定到期日，選擇擁有者與「Only select
          repositories」，只勾選該備份儲存庫。
        </li>
        <li>
          Repository permissions 只需要 Contents：Read and write（Metadata
          為必要讀取權限）。權杖可讀寫整個所選儲存庫，不只備份路徑，請勿選存放其他重要資料的儲存庫。
        </li>
        <li>
          輸入擁有者、儲存庫名稱、既有分支與權杖後連接。組織儲存庫可能需要管理員批准；權杖只放在目前頁面的記憶體，離開此頁、重新整理或斷開後需重填。
        </li>
      </ol>
      <p>
        權杖只送往 GitHub API，不放入本機資料庫、Excel、網址或日誌。可到
        <a
          href="https://github.com/settings/personal-access-tokens"
          target="_blank"
          rel="noopener noreferrer"
          >GitHub 權杖設定</a
        >撤銷。Google Drive／OneDrive 目前請自行上傳下載檔，本版未接入
        Google／Microsoft 登入。
      </p>
    </details>
    <form v-if="!connection" @submit.prevent="connect" autocomplete="off">
      <fieldset :disabled="busy" class="connect-fields">
        <div>
          <label for="github-owner">GitHub 擁有者</label
          ><input
            id="github-owner"
            v-model="owner"
            required
            placeholder="你的 GitHub 帳號或組織"
            autocapitalize="none"
            spellcheck="false"
          />
        </div>
        <div>
          <label for="github-repo">私有儲存庫名稱</label
          ><input
            id="github-repo"
            v-model="repo"
            required
            placeholder="例如 conmate-backups，不含網址"
            autocapitalize="none"
            spellcheck="false"
          />
        </div>
        <div>
          <label for="github-branch">既有分支</label
          ><input
            id="github-branch"
            v-model="branch"
            required
            autocapitalize="none"
            spellcheck="false"
          />
        </div>
        <div>
          <label for="github-token">Fine-grained 個人存取權杖</label
          ><input
            id="github-token"
            v-model="token"
            type="password"
            required
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
          />
        </div>
      </fieldset>
      <button class="button primary" :disabled="busy">
        {{ busy ? "正在連接…" : "以權杖連接 GitHub" }}
      </button>
    </form>
    <template v-else>
      <p class="connection-state">
        已連接：{{ connection.login }} → {{ connection.owner }}/{{
          connection.repo
        }}（私有），分支 {{ connection.branch }}。連接成功不代表已備份。
      </p>
      <div class="actions">
        <button class="button secondary" :disabled="busy" @click="disconnect">
          斷開 GitHub</button
        ><button class="button secondary" :disabled="busy" @click="list">
          讀取雲端備份清單
        </button>
      </div>
      <label for="cloud-workspace">要備份的本機工作區</label>
      <select
        id="cloud-workspace"
        :value="workspaces.activeWorkspaceId"
        :disabled="busy"
        @change="workspaces.select(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="w in workspaces.workspaces" :key="w.id" :value="w.id">
          {{ w.name }}
        </option>
      </select>
      <p v-if="!workspaces.workspaces.length">
        可先讀取雲端備份還原，或回總覽建立工作區。
      </p>
      <button class="button primary" :disabled="!canPrepare" @click="prepare">
        準備 GitHub 備份預覽
      </button>
      <div v-if="prepared" class="cloud-preview">
        <h3>待確認備份：{{ prepared.snapshot.workspace.name }}</h3>
        <p>
          本機修訂 {{ prepared.revision }} · 商品
          {{ prepared.snapshot.products.length }} 項 · 交易
          {{ prepared.snapshot.sales.length }} 筆
        </p>
        <p>
          目的：{{ connection.owner }}/{{ connection.repo }} ·
          {{ connection.branch }}<br />{{ prepared.path }}
        </p>
        <p v-if="prepared.remote">
          遠端已有「{{ prepared.remote.snapshot.workspace.name }}」，修訂
          {{ prepared.remote.snapshot.revision }}。確認會以本次完整備份新增一個
          GitHub 版本；不會合併兩邊資料，修訂號也不能證明哪份內容較新。
        </p>
        <p v-else>將新增這個工作區的第一份備份。</p>
        <p>
          其他裝置可能有尚未備份的資料。提交前若遠端版本改變會停止；請先確認要保留的版本，並避免同時操作。
        </p>
        <label class="check"
          ><input
            v-model="approved"
            type="checkbox"
            :disabled="busy"
          />我已核對工作區、目的地及遠端內容，確認以這份完整專案檔取代該路徑目前版本；不同裝置的分歧不會自動合併</label
        >
        <div class="actions">
          <button
            class="button primary"
            :disabled="busy || !approved"
            @click="upload"
          >
            確認備份到 GitHub</button
          ><button
            class="button secondary"
            :disabled="busy"
            @click="
              prepared = undefined;
              approved = false;
            "
          >
            取消備份預覽
          </button>
        </div>
      </div>
      <div v-if="backups.length" class="cloud-preview">
        <h3>從 GitHub 檢查與還原</h3>
        <label for="cloud-path">遠端備份檔</label
        ><select
          id="cloud-path"
          v-model="selectedPath"
          :disabled="busy"
          @change="
            versions = [];
            version = '';
          "
        >
          <option v-for="b in backups" :key="b.path" :value="b.path">
            {{ b.workspaceId }} · {{ b.path }}
          </option>
        </select>
        <button
          class="button secondary"
          :disabled="busy || !selectedPath"
          @click="loadHistory"
        >
          讀取此檔版本紀錄
        </button>
        <label for="cloud-version">要檢查的版本</label
        ><select id="cloud-version" v-model="version" :disabled="busy">
          <option value="">分支目前版本</option>
          <option v-for="v in versions" :key="v.sha" :value="v.sha">
            {{ new Date(v.date).toLocaleString("zh-TW") }} ·
            {{ v.sha.slice(0, 8) }} · {{ v.message }}
          </option>
        </select>
        <button
          class="button primary"
          :disabled="busy || !selectedPath"
          @click="previewRemote"
        >
          下載並檢查遠端備份
        </button>
        <p>
          只會下載、驗證與預覽；還原到本機前仍需在下方確認。舊版本可能沒有後來的交易。
        </p>
      </div>
    </template>
    <p v-if="busy" role="status">正在處理 GitHub 操作，請稍候…</p>
    <p v-if="error" class="error-notice" role="alert">{{ error }}</p>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="commitUrl">
      <a :href="commitUrl" target="_blank" rel="noopener noreferrer"
        >查看最近成功備份的 GitHub commit</a
      >
    </p>
  </section>
</template>
<style scoped>
.cloud-panel {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  display: grid;
  gap: 16px;
  overflow-wrap: anywhere;
}
h2 {
  font-size: 21px;
  margin: 0;
}
h3 {
  font-size: 18px;
  margin: 0;
}
p,
li {
  line-height: 1.9;
  font-size: 15px;
}
p {
  margin: 0;
}
ol {
  padding-left: 24px;
}
.setup-guide {
  background: #f5f7f0;
  border-radius: 8px;
  padding: 14px;
}
summary {
  cursor: pointer;
  font-weight: 600;
  min-height: 44px;
  display: flex;
  align-items: center;
}
.connect-fields {
  border: 0;
  padding: 0;
  display: grid;
  gap: 14px;
  margin: 0 0 16px;
  min-width: 0;
}
.connect-fields div {
  display: grid;
  gap: 8px;
}
label {
  font-size: 15px;
  font-weight: 600;
}
input:not([type="checkbox"]),
select {
  font: inherit;
  min-height: 46px;
  min-width: 0;
  width: 100%;
  border: 1px solid #94a58b;
  border-radius: 6px;
  padding: 11px;
  background: #fcfdf9;
  box-sizing: border-box;
}
.check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  line-height: 1.8;
}
.check input {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
.cloud-preview {
  border: 1px solid #b6c7ae;
  padding: 16px;
  border-radius: 8px;
  display: grid;
  gap: 14px;
  min-width: 0;
}
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.button {
  min-height: 44px;
  justify-self: start;
}
.connection-state {
  background: #edf4e8;
  padding: 12px;
  border-radius: 6px;
}
a {
  color: #245e4f;
  text-decoration: underline;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (max-width: 520px) {
  .cloud-panel {
    padding: 18px;
  }
  .actions .button {
    width: 100%;
  }
}
</style>
