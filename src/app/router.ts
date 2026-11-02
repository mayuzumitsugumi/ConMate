import { createRouter, createWebHashHistory } from "vue-router";
import OverviewPage from "../ui/pages/OverviewPage.vue";
import TemplatesPage from "../ui/pages/TemplatesPage.vue";
import ProductsPage from "../ui/pages/ProductsPage.vue";
import CustomizationPage from "../ui/pages/CustomizationPage.vue";
import DataPage from "../ui/pages/DataPage.vue";
import UpcomingPage from "../ui/pages/UpcomingPage.vue";

export const sections = [
  { path: "/", label: "工作區總覽", icon: "grid", ready: true },
  {
    path: "/projects",
    label: "企劃與場次",
    icon: "calendar",
    ready: false,
    description:
      "在同一個工作區管理企劃、創作者與多個場次。下一步先支援這次企劃的基本建檔。",
  },
  {
    path: "/products",
    label: "商品建檔",
    icon: "box",
    ready: true,
    description:
      "管理徽章、吊飾、拍立得與立牌，保留柄圖、款式、批次及成本的關聯。",
  },
  {
    path: "/sales",
    label: "攤位販售",
    icon: "bag",
    ready: false,
    description:
      "直接登記抽中款式與指定購買，共用庫存。先做好你急用的混池與快速收款流程。",
  },
  {
    path: "/inventory",
    label: "庫存與盤點",
    icon: "layers",
    ready: false,
    description:
      "支援跨兩場的庫存調撥、免費發放、退貨與收攤核對，不把盤差自動算成銷售。",
  },
  {
    path: "/finance",
    label: "成本與財務",
    icon: "chart",
    ready: false,
    description:
      "分開呈現成本、代墊、抽成、試算與實際付款。最後如何分款與結案由你決定。",
  },
  { path: "/customize", label: "自訂商品資料", icon: "layers", ready: true },
  { path: "/templates", label: "專案檔與備份", icon: "file", ready: true },
] as const;

export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    ...sections.map((section) => ({
      path: section.path,
      component:
        section.path === "/"
          ? OverviewPage
          : section.path === "/templates"
            ? DataPage
            : section.path === "/products"
              ? ProductsPage
              : section.path === "/customize"
                ? CustomizationPage
                : UpcomingPage,
      meta: { title: section.label },
    })),
    {
      path: "/templates/advanced",
      component: TemplatesPage,
      meta: { title: "舊版 Excel 模板" },
    },
    {
      path: "/:pathMatch(.*)*",
      component: UpcomingPage,
      meta: { title: "找不到這個頁面" },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
router.afterEach((to) => {
  document.title = `${String(to.meta.title)}｜ConMate 場次小秘書`;
});
