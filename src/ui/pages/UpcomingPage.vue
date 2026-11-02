<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { sections } from "../../app/router";
import AppIcon from "../components/AppIcon.vue";
const route = useRoute();
const section = computed(() => sections.find((s) => s.path === route.path));
const description = computed(() =>
  section.value && "description" in section.value
    ? section.value.description
    : "這個頁面不存在，回到工作區總覽繼續。",
);
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">ONE STEP AT A TIME</div>
      <h1>{{ $route.meta.title }}</h1>
      <p>先把急用的流程做好，再一頁一頁加上。</p>
    </div>
  </section>
  <section class="upcoming-card">
    <span class="upcoming-icon"
      ><AppIcon :name="section?.icon || 'file'" :size="38" /></span
    ><span class="soft-label">{{
      section ? "分頁已預留 · 功能開發中" : "頁面不存在"
    }}</span>
    <h2>{{ section ? "小秘書正在準備這一頁" : "換個方向，繼續準備吧" }}</h2>
    <p>{{ description }}</p>
    <div class="hero-actions">
      <RouterLink class="button primary" to="/products"
        ><AppIcon name="download" />先建立商品資料</RouterLink
      ><RouterLink class="button secondary" to="/">回到總覽</RouterLink>
    </div>
    <div class="upcoming-note">
      目前可使用：網站商品建檔、自訂標記與欄位、單檔匯出。<br />此頁尚無資料輸入或記帳功能，不會產生交易。
    </div>
  </section>
</template>
