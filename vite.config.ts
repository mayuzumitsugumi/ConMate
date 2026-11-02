import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/ConMate/",
  plugins: [
    vue(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "icons/*.png", "templates/*.xlsx"],
      manifest: {
        name: "ConMate 場次小秘書",
        short_name: "ConMate",
        lang: "zh-Hant-TW",
        description: "創作者的周邊與場次管理小幫手",
        start_url: "/ConMate/",
        scope: "/ConMate/",
        display: "standalone",
        background_color: "#f6f7f3",
        theme_color: "#275c50",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,xlsx}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: "/ConMate/index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
