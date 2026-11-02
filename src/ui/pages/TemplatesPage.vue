<script setup lang="ts">
import { ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import workbook from "../../../docs/contracts/workbook.json";
const base = import.meta.env.BASE_URL;
const downloadNotice = ref("");
const templates = [
  {
    kind: "blank",
    title: "空白模板",
    badge: "從零開始",
    text: "保留完整工作表與欄位，自行填入你的創作者、商品、柄圖與場次資料。",
    icon: "file",
    className: "green",
    file: "conmate-blank-v1.xlsx",
  },
  {
    kind: "example",
    title: "虛構範例模板",
    badge: "先看怎麼填",
    text: "用兩個企劃、兩個場次與虛構周邊，了解一張柄圖對應多種商品，以及混池配置的填法。",
    icon: "layers",
    className: "sand",
    file: "conmate-example-v1.xlsx",
  },
];
function downloaded(title: string) {
  downloadNotice.value = `已發起「${title}」下載。請確認檔案已保存；這是建檔模板，不是目前工作區的備份。`;
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">YOUR DATA, YOUR WAY</div>
      <h1>Excel 資料中心</h1>
      <p>先準備一份自己的清單，慢慢把創作整理好。</p>
    </div>
    <span class="release-label">格式 v1.0.0</span>
  </section>
  <div class="info-banner">
    <AppIcon name="info" />
    <div>
      <strong>目前開放模板下載，匯入與完整備份尚未開放。</strong>
      <p>
        可以先在 Excel 或 LibreOffice
        整理資料。這些模板沒有公式，網站也還不會匯入或計算你填入的內容；請保留原始檔案。
      </p>
    </div>
  </div>
  <section class="template-grid" aria-label="模板下載">
    <article v-for="item in templates" :key="item.kind" class="template-card">
      <div class="template-art" :class="item.className">
        <AppIcon :name="item.icon" :size="44" /><span>XLSX</span>
      </div>
      <div class="template-body">
        <span class="soft-label">{{ item.badge }}</span>
        <h2>{{ item.title }}</h2>
        <p>{{ item.text }}</p>
        <ul>
          <li>66 張可見工作表，欄位皆附說明</li>
          <li>灰／藍／黃底色與選項下拉提示</li>
          <li>
            {{
              item.kind === "blank"
                ? "新資料正式 ID 留白，用暫時代號參照"
                : "132 列虛構建檔資料，沒有真實個資"
            }}
          </li>
        </ul>
        <a
          class="button primary"
          :href="`${base}templates/${item.file}`"
          download
          @click="downloaded(item.title)"
          ><AppIcon name="download" />下載{{ item.title
          }}<span class="file-suffix">.xlsx</span></a
        >
      </div>
    </article>
  </section>
  <p v-if="downloadNotice" class="success-notice" role="status">
    <AppIcon name="check" />{{ downloadNotice }}
  </p>
  <section class="section-block">
    <div class="section-title">
      <div>
        <h2>填寫前，先記住這幾件事</h2>
        <p>完整說明也放在模板的第一張工作表。</p>
      </div>
    </div>
    <div class="guide-grid">
      <article>
        <span class="guide-swatch blue"></span>
        <h3>只填輸入欄位</h3>
        <p>
          淡藍是必填，淡黃為選填或需注意。灰色欄位留給系統，新增時正式 ID 留白。
        </p>
      </article>
      <article>
        <AppIcon name="layers" />
        <h3>關聯用代號，不用列號</h3>
        <p>
          新增代號例如「星狐徽章」，其他表填
          <code>new:星狐徽章</code>。整列排序不會改變關聯。
        </p>
      </article>
      <article>
        <AppIcon name="chart" />
        <h3>填數值，不填公式</h3>
        <p>
          金額不加「元」，比例 20 代表 20%。計算交給
          ConMate；目前尚未開放計算功能。
        </p>
      </article>
    </div>
  </section>
  <details class="sheet-details">
    <summary>
      查看完整工作表索引 <span>{{ workbook.sheets.length }} 張工作表</span>
    </summary>
    <div class="sheet-index">
      <span v-for="sheet in workbook.sheets" :key="sheet.name">{{
        sheet.name
      }}</span>
    </div>
  </details>
  <aside class="backup-note">
    <span class="backup-icon"><AppIcon name="shield" :size="22" /></span>
    <div>
      <strong>模板下載 ≠ 已備份工作區</strong>
      <p>
        模板是建檔起點，不含你在網站建立的工作區名稱。完整備份與驗證匯入將在後續版本開放，請勿把唯一重要資料只存進瀏覽器。
      </p>
    </div>
  </aside>
</template>
