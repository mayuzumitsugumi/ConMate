import ActivitiesPage from "../ui/pages/ActivitiesPage.vue";
import ActivityPage from "../ui/pages/ActivityPage.vue";
import MasterDataPage from "../ui/pages/MasterDataPage.vue";
import HelpPage from "../ui/pages/HelpPage.vue";
import SalesPage from "../ui/pages/SalesPage.vue";
import FinancePage from "../ui/pages/FinancePage.vue";
import InventoryPage from "../ui/pages/InventoryPage.vue";
import { createRouter, createWebHashHistory } from "vue-router";
import OverviewPage from "../ui/pages/OverviewPage.vue";
import TemplatesPage from "../ui/pages/TemplatesPage.vue";
import ProductsPage from "../ui/pages/ProductsPage.vue";
import CustomizationPage from "../ui/pages/CustomizationPage.vue";
import ProjectsPage from "../ui/pages/ProjectsPage.vue";
import DataPage from "../ui/pages/DataPage.vue";
import UpcomingPage from "../ui/pages/UpcomingPage.vue";

export const sections = [
  { path: "/", label: "工作區總覽", icon: "grid", ready: true },
  {
    path: "/activities",
    label: "活動配置與交接",
    icon: "calendar",
    ready: true,
  },
  { path: "/activity", label: "活動工作台", icon: "bag", ready: true },
  {
    path: "/projects",
    label: "企劃與場次",
    icon: "calendar",
    ready: true,
    description:
      "在同一個工作區管理企劃、創作者與多個場次。可新增、編輯、封存與恢復資料。",
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
    ready: true,
    description: "登記實際交付款式、指定購買與收款找零，成交時同步扣庫。",
  },
  {
    path: "/inventory",
    label: "庫存與盤點",
    icon: "layers",
    ready: true,
    description:
      "支援跨兩場的庫存調撥、免費發放、退貨與收攤核對，不把盤差自動算成銷售。",
  },
  {
    path: "/finance",
    label: "成本與財務",
    icon: "chart",
    ready: true,
    description: "記錄成本分攤、代墊、分潤試算與實際付款；分款與結案由你決定。",
  },
  { path: "/creators", label: "創作者與柄圖", icon: "box", ready: true },
  { path: "/customize", label: "自訂商品資料", icon: "layers", ready: true },
  { path: "/templates", label: "專案檔與備份", icon: "file", ready: true },
  { path: "/help", label: "使用說明", icon: "info", ready: true },
] as const;

export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    ...sections.map((section) => ({
      path: section.path,
      component:
        section.path === "/activities"
          ? ActivitiesPage
          : section.path === "/activity"
            ? ActivityPage
            : section.path === "/creators"
              ? MasterDataPage
              : section.path === "/"
                ? OverviewPage
                : section.path === "/help"
                  ? HelpPage
                  : section.path === "/templates"
                    ? DataPage
                    : section.path === "/sales"
                      ? SalesPage
                      : section.path === "/finance"
                        ? FinancePage
                        : section.path === "/inventory"
                          ? InventoryPage
                          : section.path === "/projects"
                            ? ProjectsPage
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
