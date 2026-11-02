<script setup lang="ts">
import { onMounted } from "vue";
import { useWorkspaceStore } from "../app/workspace-store";
import { sections } from "../app/router";
import {
  isOnline,
  offlineReady,
  pwaError,
  updateAvailable,
  updateServiceWorker,
} from "../infrastructure/pwa/status";
import AppIcon from "./components/AppIcon.vue";
const store = useWorkspaceStore();
const base = import.meta.env.BASE_URL;
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
      <div class="sidebar-label">你的創作後援</div>
      <nav aria-label="主要導覽">
        <RouterLink
          v-for="section in sections"
          :key="section.path"
          :to="section.path"
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
        <p>不需要帳號，不上傳雲端。<br />記得定期保留外部備份。</p>
      </div>
      <div class="sidebar-version">
        <span class="status-dot"></span> v0.1 · 起步版本
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <span class="breadcrumb"
          >ConMate <span>/</span> {{ $route.meta.title }}</span
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
