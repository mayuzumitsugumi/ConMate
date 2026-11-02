<script setup lang="ts">
import { ref } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import { downloadProject } from "../../application/export-project";
import AppIcon from "../components/AppIcon.vue";
const workspaces = useWorkspaceStore();
const exporting = ref(false),
  notice = ref(""),
  error = ref("");
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
      日常表只呈現你已建立的商品與自訂設定。沒有使用的成本、代墊、抽選等功能，不會先放一堆空白表；不用為每個功能管理不同檔案。
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
      <strong>目前可匯出，網站匯入與還原尚未開放。</strong>
      <p>
        檔案包含全部「目前網站能建立的資料」，不是尚未開放的庫存、銷售或財務。完整紀錄放在同一檔案的隱藏系統表，隱藏不是加密。請回網站編輯後再匯出，不要修改系統表，也不要因為下載就清除本機資料。
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
