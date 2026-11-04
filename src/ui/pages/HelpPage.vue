<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { helpTopics } from "../content/help";
const route = useRoute();
const search = ref("");
const selected = ref("start");
watch(
  () => route.query.topic,
  (topic) => {
    selected.value =
      typeof topic === "string" && helpTopics.some((t) => t.id === topic)
        ? topic
        : "start";
    search.value = "";
  },
  { immediate: true },
);
const topics = computed(() => {
  const words = search.value
    .trim()
    .toLocaleLowerCase("zh-TW")
    .split(/\s+/)
    .filter(Boolean);
  return helpTopics.filter((t) =>
    words.every((word) =>
      [t.title, t.intro, ...t.steps, t.note]
        .join(" ")
        .toLocaleLowerCase("zh-TW")
        .includes(word),
    ),
  );
});
async function choose(id: string) {
  search.value = "";
  selected.value = id;
  await nextTick();
  const section = document.getElementById(
    `help-${id}`,
  ) as HTMLDetailsElement | null;
  if (section) section.open = true;
  section?.scrollIntoView({ block: "start" });
  section?.querySelector("summary")?.focus({ preventScroll: true });
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">A GUIDE AT YOUR SIDE</div>
      <h1>使用說明</h1>
      <p>從建檔到收攤，一次學會眼前需要的功能。這裡不用先建立工作區。</p>
    </div>
  </section>
  <aside class="help-callout">
    <strong>先在網站填資料，定期匯出備份。</strong>
    <p>
      不用先填 Excel，也不用編
      ID。你的資料保存在目前裝置的瀏覽器，重新開啟可繼續；換裝置請用專案檔交接。
    </p>
    <RouterLink class="text-button" to="/templates"
      >前往專案檔與備份 →</RouterLink
    >
  </aside>
  <section class="help-tools" aria-labelledby="help-search-title">
    <h2 id="help-search-title">想了解哪一部分？</h2>
    <label for="help-search">搜尋說明</label>
    <input
      id="help-search"
      v-model="search"
      type="search"
      placeholder="例如：封存、退款、柄圖、換裝置"
    />
    <p class="search-result" role="status">
      {{
        search.trim()
          ? `找到 ${topics.length} 個主題`
          : "選一個主題，或輸入遇到的問題。"
      }}
    </p>
    <nav class="topic-links" aria-label="說明主題">
      <button
        v-for="topic in helpTopics"
        :key="topic.id"
        type="button"
        class="topic-button"
        :class="{ chosen: selected === topic.id && !search.trim() }"
        @click="choose(topic.id)"
      >
        {{ topic.title.split("：")[0] }}
      </button>
    </nav>
  </section>
  <p v-if="!topics.length" class="help-callout">
    找不到符合的說明。試試較短的詞，例如「庫存」或「備份」，也可清空搜尋查看所有主題。
  </p>
  <section class="help-topics" aria-label="操作指南">
    <details
      v-for="topic in topics"
      :id="`help-${topic.id}`"
      :key="topic.id"
      class="help-topic"
      :open="!!search.trim() || selected === topic.id"
    >
      <summary>{{ topic.title }}</summary>
      <div class="topic-body">
        <p class="topic-intro">{{ topic.intro }}</p>
        <ol>
          <li v-for="step in topic.steps" :key="step">{{ step }}</li>
        </ol>
        <p class="topic-note"><strong>記得：</strong>{{ topic.note }}</p>
        <RouterLink class="button secondary" :to="topic.path"
          >{{ topic.action }} →</RouterLink
        >
      </div>
    </details>
  </section>
  <section class="help-limits" aria-labelledby="help-limits-title">
    <h2 id="help-limits-title">目前還有哪些範圍？</h2>
    <p>
      目前可使用建檔、販售方案／混合池、交易退款、庫存與盤點、成本分攤、人工分配及備份還原。以下流程仍需另行處理：
    </p>
    <ul>
      <li>
        自動背景雲端備份、Google／Microsoft 雲端授權、網店 API
        庫存同步、多人即時同步與分歧自動合併。
      </li>
      <li>系統隨機抽獎、保底、預售訂金與完整寄賣對帳。</li>
      <li>
        圖片及條碼掃描（特殊單件可用實物標記選取，入庫來源數量採批次追蹤）。換購差額可登記核對，實際收退款仍由使用者完成。
      </li>
      <li>自動套用分潤規則優先序、跨工作表自動抵付、實際匯款及正式會計帳。</li>
      <li>把 Excel 日常表的外部修改直接匯入；目前以網站編輯後再匯出為主。</li>
    </ul>
    <p>
      先用「練習工作區」跑一次小額虛構案例，確認操作和你們的合作約定一致，再用於正式場次。
    </p>
  </section>
</template>
<style scoped>
.help-callout,
.help-tools,
.help-limits,
.help-topic {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: white;
  padding: 22px;
  margin-bottom: 20px;
  overflow-wrap: anywhere;
}
.help-callout {
  background: #eef4e7;
  border-color: #b8c9aa;
}
h2 {
  font-size: 20px;
  margin: 0 0 14px;
}
p,
li {
  font-size: 16px;
  line-height: 1.9;
}
p {
  margin: 10px 0;
}
.help-tools label {
  display: block;
  font-weight: 600;
  margin-bottom: 8px;
}
.help-tools input {
  width: 100%;
  min-height: 46px;
  border: 1px solid #94a58b;
  border-radius: 7px;
  padding: 11px 12px;
  background: #fcfdf9;
  font: inherit;
  color: var(--text);
}
.search-result {
  color: #52634e;
}
.topic-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.topic-button {
  font: inherit;
  min-height: 44px;
  padding: 9px 12px;
  border: 1px solid #9fae98;
  border-radius: 7px;
  background: white;
  color: #275c50;
  text-align: left;
  cursor: pointer;
}
.topic-button.chosen {
  background: #275c50;
  color: white;
  border-color: #275c50;
}
.help-topic {
  padding: 0;
  scroll-margin-top: 20px;
}
.help-topic summary {
  padding: 20px 22px;
  min-height: 60px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.6;
  cursor: pointer;
}
.help-topic[open] summary {
  border-bottom: 1px solid var(--line);
}
.topic-body {
  padding: 4px 22px 22px;
}
.topic-intro {
  font-weight: 500;
}
.topic-body ol,
.help-limits ul {
  padding-left: 25px;
}
.topic-body li + li {
  margin-top: 12px;
}
.topic-note {
  background: #f6f7f3;
  border-left: 4px solid #a1b68f;
  padding: 12px 16px;
  margin: 20px 0;
}
.topic-body .button {
  white-space: normal;
  line-height: 1.6;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
@media (max-width: 520px) {
  .help-callout,
  .help-tools,
  .help-limits {
    padding: 18px;
  }
  .help-topic summary {
    padding: 17px;
  }
  .topic-body {
    padding: 0 17px 18px;
  }
  .topic-links {
    gap: 7px;
  }
  .topic-button {
    font-size: 15px;
  }
  .topic-body ol {
    padding-left: 22px;
  }
}
</style>
