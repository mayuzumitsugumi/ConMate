<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useWorkspaceStore } from "../app/workspace-store";
import { sections } from "../app/router";
import {
  isOnline,
  offlineReady,
  pwaError,
  updateAvailable,
  updateServiceWorker,
} from "../infrastructure/pwa/status";
import BackupReminder from "./components/BackupReminder.vue";
import AppIcon from "./components/AppIcon.vue";
import { version } from "../../package.json";
const store = useWorkspaceStore();
const base = import.meta.env.BASE_URL;
const route = useRoute();
const activityMode = computed(
  () =>
    route.path === "/activity" ||
    (route.path === "/help" && route.query.topic === "activity"),
);
const visibleSections = computed(() =>
  activityMode.value
    ? sections.filter(
        (section) => section.path === "/activity" || section.path === "/help",
      )
    : sections.filter((section) => section.path !== "/activity"),
);
onMounted(() => {
  void store.load();
});
</script>
<template>
  <a class="skip-link" href="#main-content">跳到主要內容</a>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink class="brand" to="/" aria-label="ConMate 首頁"
        ><img :src="`${base}icon.svg`" alt="" /><span
          >ConMate<small>場次小秘書</small></span
        ></RouterLink
      >
      <div class="entrance-switch" aria-label="操作入口">
        <RouterLink to="/" :class="{ active: !activityMode }"
          >創作管理</RouterLink
        >
        <RouterLink to="/activity" :class="{ active: activityMode }"
          >活動工作台</RouterLink
        >
      </div>
      <div class="sidebar-label">
        {{ activityMode ? "本次活動的現場作業" : "你的創作後援" }}
      </div>
      <nav aria-label="主要導覽">
        <RouterLink
          v-for="section in visibleSections"
          :key="section.path"
          :to="
            activityMode && section.path === '/help'
              ? { path: '/help', query: { topic: 'activity' } }
              : section.path
          "
          class="nav-link"
          :class="{ current: $route.path === section.path }"
          ><AppIcon :name="section.icon" /><span>{{ section.label }}</span
          ><span
            v-if="!section.ready"
            class="nav-pending"
            aria-label="開發中"
          ></span
        ></RouterLink>
      </nav>
      <div class="sidebar-note">
        <AppIcon name="shield" :size="24" /><strong
          >你的資料，留在你手上</strong
        >
        <p>基本功能免帳號、本機保存。<br />可選配備份到自己的 GitHub。</p>
      </div>
      <div class="sidebar-version">
        <span class="status-dot"></span> v{{ version }} · 起步版本
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <span class="breadcrumb"
          >ConMate <span>/</span> {{ $route.meta.title }}</span
        >
        <RouterLink
          v-if="$route.path !== '/help'"
          class="header-help"
          :to="{
            path: '/help',
            query: {
              topic:
                $route.path === '/'
                  ? 'start'
                  : $route.path === '/customize'
                    ? 'products'
                    : $route.path.split('/')[1],
            },
          }"
          >這頁怎麼用？</RouterLink
        >
        <div class="connection">
          <span class="status-dot" :class="{ muted: !isOnline }"></span
          >{{ isOnline ? "目前連線中" : "目前離線"
          }}<span class="connection-detail">{{
            offlineReady
              ? "· 已可離線開啟"
              : pwaError
                ? "· 離線準備未完成"
                : "· 離線資源準備中"
          }}</span>
        </div>
      </header>
      <div v-if="updateAvailable" class="update-notice" role="status">
        新版本已準備好。確認沒有未完成輸入後再更新。<button
          class="text-button"
          @click="updateServiceWorker(true)"
        >
          更新並重新開啟
        </button>
      </div>
      <BackupReminder v-if="!activityMode" />
      <main id="main-content" tabindex="-1"><RouterView /></main>
      <footer class="site-footer">
        <span>ConMate 場次小秘書</span><span>陪每一份創作，走到攤位前。</span
        ><a
          href="https://github.com/mayuzumitsugumi/ConMate"
          target="_blank"
          rel="noopener noreferrer"
          >GitHub ↗</a
        >
      </footer>
    </div>
  </div>
</template>

<style scoped>
@media (min-width: 801px) {
  .sidebar {
    overflow-y: auto;
  }
  .sidebar > * {
    flex-shrink: 0;
  }
  .sidebar-label {
    margin-top: 20px;
  }
}

.entrance-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  margin: 16px 18px 12px;
  border: 1px solid #c9d8cb;
  border-radius: 9px;
  padding: 4px;
}
.entrance-switch a {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 14px;
  color: #275c50;
  text-decoration: none;
}
.entrance-switch a.active {
  background: #275c50;
  color: white;
}
.entrance-switch a:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 2px;
}

.header-help {
  margin-left: auto;
  margin-right: 16px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  font-size: 14px;
  color: #275c50;
  white-space: nowrap;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.header-help:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .header-help {
    margin-right: 8px;
    font-size: 13px;
  }
  .breadcrumb {
    min-width: 0;
  }
}
</style>
