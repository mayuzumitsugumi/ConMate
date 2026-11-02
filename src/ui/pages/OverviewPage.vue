<script setup lang="ts">
import { nextTick, ref, useTemplateRef } from "vue";
import { useWorkspaceStore } from "../../app/workspace-store";
import AppIcon from "../components/AppIcon.vue";
const store = useWorkspaceStore();
const dialog = useTemplateRef<HTMLDialogElement>("createDialog");
const nameInput = useTemplateRef<HTMLInputElement>("nameInput");
const name = ref("");
const error = ref("");
const notice = ref("");
const openingButton = ref<HTMLElement | null>(null);
async function openCreate(event: MouseEvent) {
  openingButton.value = event.currentTarget as HTMLElement;
  error.value = "";
  name.value = "";
  dialog.value?.showModal();
  await nextTick();
  nameInput.value?.focus();
}
function closeCreate() {
  dialog.value?.close();
  openingButton.value?.focus();
}
async function create() {
  if (store.saving) return;
  try {
    const result = await store.create(name.value);
    if (result) {
      notice.value = `「${result.name}」已保存在這台裝置。可以直接前往商品建檔，再一鍵匯出專案檔。`;
      closeCreate();
    }
  } catch (reason) {
    error.value =
      reason instanceof Error ? reason.message : "儲存失敗，請重試。";
  }
}
const steps = [
  {
    number: "01",
    name: "直接在網站新增商品",
    text: "先填名稱，再慢慢補創作者、企劃與種類，不必先準備Excel。",
    link: "/products",
    action: "前往商品建檔",
    ready: true,
  },
  {
    number: "02",
    name: "整理適合自己的欄位",
    text: "標記、文字與下拉選項由你決定，不需要的功能先不填。",
    link: "/customize",
    action: "自訂商品資料",
    ready: true,
  },
  {
    number: "03",
    name: "一鍵帶走一份專案檔",
    text: "只呈現已有的資料，所有設定保存在同一份Excel裡。",
    link: "/templates",
    action: "匯出專案檔",
    ready: true,
  },
];
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">A LITTLE HELP FOR YOUR BIG DAY</div>
      <h1>工作區總覽</h1>
      <p>從商品準備到收攤，把繁瑣的小事交給小秘書。</p>
    </div>
    <span class="release-label">第一站，準備出發</span>
  </section>
  <section class="welcome-card">
    <div class="welcome-copy">
      <span class="pill">為創作者而生的小幫手</span>
      <h2>每一份創作，<br />都好好照顧。</h2>
      <p>
        整理周邊、準備場次，讓你把更多心力<br
          class="desktop-break"
        />留給喜歡的創作，與前來相遇的人。
      </p>
      <div class="hero-actions">
        <button
          class="button primary"
          :disabled="store.loading"
          @click="openCreate"
        >
          <AppIcon name="plus" />建立工作區</button
        ><RouterLink class="button secondary" to="/products"
          ><AppIcon name="box" />前往商品建檔</RouterLink
        >
      </div>
      <div class="hero-footnote">
        <AppIcon name="shield" :size="15" />免登入 · 資料保存在自己的裝置
      </div>
    </div>
    <svg
      class="stall-illustration"
      viewBox="0 0 430 310"
      role="img"
      aria-label="綠色棚頂的創作者攤位，擺著徽章、卡片與周邊商品"
    >
      <ellipse cx="230" cy="281" rx="171" ry="17" fill="#dce5d7" />
      <path d="M94 134v140m265-140v140" stroke="#758878" stroke-width="7" />
      <rect
        x="85"
        y="182"
        width="285"
        height="88"
        rx="7"
        fill="#fffdf7"
        stroke="#c7d1bd"
        stroke-width="2"
      />
      <path d="M85 218h285v52H85z" fill="#c6d9b8" />
      <path d="M113 220v50m228-50v50" stroke="#b5cda6" stroke-width="2" />
      <rect x="161" y="232" width="128" height="24" rx="12" fill="#f7faf2" />
      <text
        x="225"
        y="248"
        text-anchor="middle"
        fill="#57725a"
        font-size="12"
        letter-spacing="2"
      >
        MADE WITH LOVE
      </text>
      <path
        d="m94 86 28-42h209l28 42"
        fill="#f5edcd"
        stroke="#b5c6aa"
        stroke-width="2"
      />
      <path
        d="M94 86h265v36q-22 28-44 0-22 28-44 0-22 28-44 0-22 28-44 0-22 28-44 0-23 28-45 0V86Z"
        fill="#8caf90"
      />
      <path
        d="M139 86h44v36q-22 28-44 0zM227 86h44v36q-22 28-44 0zM315 86h44v36q-22 28-44 0z"
        fill="#e7ecd9"
      />
      <path
        d="M183 86 192 44h35v42m88 0-14-42h-36l6 42"
        fill="#a8c2a2"
        opacity=".6"
      />
      <rect
        x="125"
        y="142"
        width="71"
        height="41"
        rx="3"
        fill="#eee3c7"
        stroke="#cbbb95"
        transform="rotate(-6 125 142)"
      />
      <path d="m140 164 10-12 10 12-10 10z" fill="#9ab89b" />
      <circle cx="176" cy="161" r="9" fill="#e5ae8e" />
      <rect x="210" y="147" width="38" height="35" rx="3" fill="#d6e3d2" />
      <path d="m220 171 8-15 9 15z" fill="#749879" />
      <rect
        x="276"
        y="139"
        width="45"
        height="43"
        rx="3"
        fill="#fbfaf4"
        stroke="#c9d3bd"
        transform="rotate(8 276 139)"
      />
      <circle cx="297" cy="158" r="9" fill="#e7bc83" />
      <path
        d="M62 84h8m-4-4v8M378 162h12m-6-6v12M338 29h10m-5-5v10"
        stroke="#d4b96f"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <circle cx="64" cy="206" r="6" fill="#b7cdae" />
      <circle cx="378" cy="76" r="5" fill="#ead7a6" />
      <path
        d="M333 193q15-25 27 0"
        stroke="#648f73"
        stroke-width="3"
        fill="none"
      />
      <rect x="331" y="188" width="31" height="26" rx="3" fill="#f1d9ad" />
    </svg>
  </section>
  <p v-if="notice" class="success-notice" role="status">
    <AppIcon name="check" />{{ notice }}
  </p>
  <p
    v-if="store.storageError && !dialog?.open"
    class="error-notice"
    role="alert"
  >
    {{ store.storageError }}
    <button class="text-button" @click="store.load()">重新讀取</button>
  </p>
  <section class="quick-stats" aria-label="目前功能狀態">
    <div class="stat-card">
      <span class="stat-icon"><AppIcon name="layers" /></span>
      <div>
        <span class="stat-label">本機工作區</span
        ><strong
          >{{
            store.loading
              ? "…"
              : store.storageError
                ? "—"
                : store.workspaces.length
          }}<small>個</small></strong
        >
      </div>
      <span class="stat-note">直接在網站建檔</span>
    </div>
    <div class="stat-card">
      <span class="stat-icon peach"><AppIcon name="file" /></span>
      <div>
        <span class="stat-label">網站建檔</span
        ><strong class="stat-text">已開放</strong>
      </div>
      <RouterLink
        class="stat-link"
        to="/templates"
        aria-label="前往專案檔與備份"
        ><AppIcon name="arrow"
      /></RouterLink>
    </div>
    <div class="stat-card">
      <span class="stat-icon lavender"><AppIcon name="bag" /></span>
      <div>
        <span class="stat-label">攤位記帳</span
        ><strong class="stat-text">準備中</strong>
      </div>
      <span class="stat-note">接著逐步開放</span>
    </div>
  </section>
  <section class="section-block">
    <div class="section-title">
      <div>
        <h2>從這裡開始</h2>
        <p>不用一次填完所有資料，先踏出第一小步。</p>
      </div>
      <span class="muted-label">YOUR NEXT STEPS</span>
    </div>
    <div class="steps-grid">
      <article v-for="step in steps" :key="step.number" class="step-card">
        <span class="step-number">{{ step.number }}</span>
        <h3>{{ step.name }}</h3>
        <p>{{ step.text }}</p>
        <RouterLink
          :to="step.link"
          class="step-link"
          :class="{ pending: !step.ready }"
          >{{ step.action }}<AppIcon name="arrow" :size="17"
        /></RouterLink>
      </article>
    </div>
  </section>
  <section v-if="store.workspaces.length" class="section-block">
    <div class="section-title">
      <div>
        <h2>你的本機工作區</h2>
        <p>選擇工作區後，商品、標記與自訂欄位分開保存在自己的裝置。</p>
      </div>
    </div>
    <div class="workspace-list">
      <article
        v-for="workspace in store.workspaces"
        :key="workspace.id"
        class="workspace-card"
      >
        <AppIcon name="layers" />
        <div>
          <h3>{{ workspace.name }}</h3>
          <span
            >{{
              new Date(workspace.createdAt).toLocaleDateString("zh-TW", {
                timeZone: "Asia/Taipei",
              })
            }}
            建立 · 保存在本機</span
          >
        </div>
        <button
          class="button secondary"
          :aria-pressed="store.activeWorkspaceId === workspace.id"
          @click="store.select(workspace.id)"
        >
          {{
            store.activeWorkspaceId === workspace.id
              ? "目前工作區"
              : "切換工作區"
          }}
        </button>
      </article>
    </div>
  </section>
  <aside class="backup-note">
    <span class="backup-icon"><AppIcon name="info" :size="22" /></span>
    <div>
      <strong>多留一份備份，少一點擔心。</strong>
      <p>
        本機資料可能因清除瀏覽器或裝置故障而遺失。記得匯出專案檔並自行保存；目前匯入還原與記帳仍未開放，請保留本機資料。
      </p>
    </div>
    <RouterLink to="/templates"
      >匯出專案檔<AppIcon name="arrow" :size="16"
    /></RouterLink>
  </aside>
  <dialog
    ref="createDialog"
    class="create-dialog"
    aria-labelledby="create-title"
    @cancel.prevent="!store.saving && closeCreate()"
  >
    <form @submit.prevent="create">
      <div class="dialog-heading">
        <h2 id="create-title">建立你的工作區</h2>
        <button
          type="button"
          class="icon-button"
          aria-label="關閉"
          :disabled="store.saving"
          @click="closeCreate"
        >
          <AppIcon name="close" />
        </button>
      </div>
      <p>
        替商品與企劃取一個工作區名稱。建立後直接在網站填商品，標記與額外欄位可稍後設定。
      </p>
      <label for="workspace-name">工作區名稱</label
      ><input
        id="workspace-name"
        ref="nameInput"
        v-model="name"
        maxlength="80"
        required
        placeholder="例如：我的周邊工作室"
        autocomplete="off"
        :disabled="store.saving"
      />
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div class="dialog-actions">
        <button
          type="button"
          class="button secondary"
          :disabled="store.saving"
          @click="closeCreate"
        >
          取消</button
        ><button
          class="button primary"
          :disabled="store.saving || !name.trim()"
        >
          {{ store.saving ? "儲存中…" : "建立工作區" }}
        </button>
      </div>
    </form>
  </dialog>
</template>
