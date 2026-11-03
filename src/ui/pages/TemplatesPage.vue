<script setup lang="ts">
import { ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import workbook from "../../../docs/contracts/workbook.json";
import guide from "../../../docs/contracts/template-guide.json";
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
function showGuide() {
  document
    .getElementById("template-guide")
    ?.scrollIntoView({ behavior: "auto", block: "start" });
}
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">YOUR DATA, YOUR WAY</div>
      <h1>Excel 資料中心</h1>
      <p>先照「星狐徽章」的例子填，不需要一次處理 66 張工作表。</p>
    </div>
    <span class="release-label">格式 v1.0.0 · 易讀版 1.1</span>
  </section>
  <div class="info-banner">
    <AppIcon name="info" />
    <div>
      <strong>這是舊版進階模板，尚不支援匯入此格式。</strong>
      <p>
        可以先在 Excel 或 LibreOffice
        整理資料。這些模板沒有公式，網站也還不會匯入或計算你填入的內容；請保留原始檔案。
      </p>
    </div>
  </div>
  <button
    type="button"
    class="text-button template-guide-link"
    @click="showGuide"
  >
    不確定怎麼填？先看逐欄範例 ↓
  </button>
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
          <li>微軟正黑體 12 點字，輸入區有實際框線</li>
          <li>可填欄位移到左邊，灰色系統欄移到右邊</li>
          <li>第一張表附逐格示範；點欄位也會顯示提示</li>
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
  <section
    id="template-guide"
    class="section-block fill-guide"
    aria-labelledby="fill-guide-title"
  >
    <div class="section-title">
      <div>
        <h2 id="fill-guide-title">一步一步，先建立一個星狐徽章</h2>
        <p>
          每張表從第 2
          列填起。下面「填入範例」就是範例模板裡的值，換成自己的資料時，代號與參照要一起換。
        </p>
      </div>
    </div>
    <div class="color-key" aria-label="欄位顏色說明">
      <span><i class="blue"></i>淡藍：必填</span
      ><span><i class="yellow"></i>淡黃：選填／注意</span
      ><span><i class="gray"></i>灰色：系統填寫，先留白</span>
    </div>
    <p class="fill-guide-intro">
      「新增代號」是你自己取的暫時名稱，不是正式
      ID。例如先取名「星狐」，其他表填
      <code>new:星狐</code> 就是在說「使用剛剛那位星狐」。不必自己編流水號。
    </p>
    <details
      v-for="(step, index) in guide.starterSteps"
      :key="step.sheet"
      :open="index === 0"
      class="fill-step"
    >
      <summary>
        <span class="fill-step-number">{{
          String(index + 1).padStart(2, "0")
        }}</span
        ><span
          >{{ step.title }}<small>{{ step.sheet }}</small></span
        ><span class="fill-step-toggle"
          ><span class="when-closed">展開對照</span
          ><span class="when-open">收合對照</span></span
        >
      </summary>
      <div class="fill-step-body">
        <p>{{ step.explanation }}</p>
        <table>
          <thead>
            <tr>
              <th scope="col">Excel 欄位</th>
              <th scope="col">填入範例</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="field in step.fields" :key="field.key">
              <th scope="row">{{ field.label }}</th>
              <td>
                <code>{{ field.value }}</code>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="fill-step-footnote">
          未列出的選填欄位可以先留白；最右側灰色 ID、修訂號、時間都不用填。
        </p>
      </div>
    </details>
    <aside class="info-banner guide-followup">
      <AppIcon name="info" />
      <div>
        <strong>先把商品連起來，再補柄圖、製作與費用。</strong>
        <p>
          有圖稿時接著填 13、14、17；要記製作數量時再填
          19、20。模板第一張表也有接續示範。場次、販售、結算及系統紀錄先不用一次填完。
        </p>
      </div>
    </aside>
  </section>
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
          淡藍是必填，淡黃為選填或需注意。灰色欄位已移到最右側，新增時正式 ID
          留白。
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
          金額不加「元」，比例 20 代表 20%。計算交給 ConMate
          網站執行。此舊模板不支援匯入；請到網站建立成本與分潤資料。
        </p>
      </article>
    </div>
  </section>
  <details class="sheet-details">
    <summary>
      查看完整工作表索引 <span>{{ workbook.sheets.length }} 張工作表</span>
    </summary>
    <div class="sheet-index">
      <div v-for="sheet in workbook.sheets" :key="sheet.name">
        <strong>{{ sheet.name }}</strong>
        <p>
          {{
            guide.sheetPurposes[sheet.name as keyof typeof guide.sheetPurposes]
          }}
        </p>
      </div>
    </div>
  </details>
  <aside class="backup-note">
    <span class="backup-icon"><AppIcon name="shield" :size="22" /></span>
    <div>
      <strong>模板下載 ≠ 已備份工作區</strong>
      <p>
        這些模板不含目前工作區資料。請到「專案檔與備份」匯出目前工作區；該頁已支援網站專案檔的檢查與還原，與這裡的舊版模板格式不同。
      </p>
    </div>
  </aside>
</template>
