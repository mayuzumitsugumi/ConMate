# ConMate（場次小秘書）

提供台灣創作者與攤主使用的離線優先周邊管理、販售記錄及財務計算工具。

目前狀態：**v0.1 網站起步版**。已提供手機／桌面總覽、分頁導覽、本機工作區名稱保存，以及 Excel 空白／虛構範例模板下載。

目前更新至 **v0.1.1 易讀版**：Excel 改用12點微軟正黑體、空白輸入格加框線、可填欄位移到左側；第一張表與網站加入「星狐徽章」逐欄教學。請重新下載模板，詳細內容見[更新說明](docs/releases/v0.1.1.md)。

## 首畫面預覽

![ConMate 桌面總覽](docs/images/overview-desktop.png)

[查看手機版畫面](docs/images/overview-mobile.png)

## 本機開啟

需要 Node.js 22.12 以上，建議 Node.js 24。

```sh
npm ci
npm run dev
```

開啟終端顯示的 `/ConMate/` 網址。正式產物以 `npm run build` 建立，`npm run preview` 預覽。`build` 會先依欄位契約產生兩份 XLSX。

```sh
npm test
python -m unittest discover -s tests -p '*_checks.py' -v
npx playwright install chromium
npm run build
npm run test:e2e
```

已有系統 Chromium 時，可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`。

## 這一版可以做什麼

- 建立工作區名稱，保存至這台裝置的 IndexedDB；不儲存商品或交易。
- 開啟各分頁查看後續功能範圍；未完成功能清楚標為開發中。
- [下載空白模板](public/templates/conmate-blank-v1.xlsx)或[虛構範例模板](public/templates/conmate-example-v1.xlsx)：66 張可見工作表、底色、註解、純值與下拉提示。
- 首次準備離線資源後，網站與模板可離線開啟；更新由使用者確認。

**尚未提供 Excel 檔案驗證／匯入、完整工作區備份、商品建檔、販售、庫存或財務計算。** 模板是外部建檔起點，不是目前本機資料的備份。範例只有虛構建檔資料，不含已執行的入庫、交易或分潤。

## GitHub Pages

推送到 `main` 後，`.github/workflows/pages.yml` 先執行契約、單元、建置與手機／桌面端對端檢查，再發布 Pages。使用 `/ConMate/` base 及 Hash 路由，沒有後端或 CDN 依賴。

若尚未設定 Pages，workflow 會嘗試啟用；私有 repository 需帳戶支援對應 Pages 方案及適當權限。設定或方案阻擋時，程式不會改 repository 可見性；可至 **Settings → Pages → GitHub Actions** 設定並重跑 workflow。

## 開發依據

- [產品決策、範圍與任務追蹤](docs/product.md)
- [資料模型、狀態與不可破壞的規則](docs/contracts/domain.md)
- [命令、查詢與提交契約](docs/contracts/commands.md)
- [Excel 格式、欄位與匯入契約](docs/contracts/excel.md)
- [完整工作表欄位字典（機器可讀）](docs/contracts/workbook.json)
- [財務公式與核對契約](docs/contracts/finance.md)
- [錯誤與警告字典](docs/contracts/issues.json)
- [驗收案例與需求對照](docs/acceptance.md)
- [純虛構工作區及 Excel 新增資料案例](tests/fixtures/contracts/workspace.json)
- [精確財務驗收向量](tests/fixtures/contracts/finance.json)

第一批優先完成目前企劃的最小完整流程：商品建檔、成本及兩種合作試算、混池／指定販售、跨兩場庫存、盤點與基本備份。通用外部編輯、特殊單件操作及進階規則後續補齊；資料結構預留相容能力。

ConMate 計算與記錄，分款、追收及結案由使用者決定。IndexedDB 本機儲存不是外部備份；正式工具將提供完整 Excel 備份與還原。

文件及 JSON 案例保留完整 MVP 規格；尚未實作部分以分頁與後續任務標示，不能視為已可用。原始實際經費表未加入 repository。
