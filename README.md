# ConMate（場次小秘書）

提供台灣創作者與攤主使用的離線優先周邊管理、販售記錄及財務計算工具。

目前狀態：**v0.12.0 保存與操作效率版**。新增購物車草稿恢復、商品搜尋／批量建檔、備份提醒，以及同工作區差異預覽與明確取代還原。詳見[決策更新](docs/decisions/website-first.md)與[版本說明](docs/releases/v0.12.0.md)。

[開啟ConMate](https://mayuzumitsugumi.github.io/ConMate/)

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

- [企劃與場次分頁](https://mayuzumitsugumi.github.io/ConMate/#/projects)：新增、編輯、封存／恢復，支援同企劃跨多場、同場多企劃。
- 網站新增、編輯與封存／恢復商品；只填名稱也能先存，周邊種類自由輸入。
- 攤位販售：指定購買或已知款式的抽選，可選預設方案或手動填價，確認收款找零後原子成交並扣庫；支援整筆全額退款，或分次登記實際退款與可售／損壞退貨。
- 基礎財務：商品批次成本、單件綜合成本、預估毛利與回本銷量；未知成本不當作0。代墊與還款另列，不重複扣進利潤。
- 自訂庫存異動類型：以自己的名稱登記增加、減少或移動庫存；類型變化方式不可改，封存仍保留歷史。
- 自訂標記及文字、數字、單選、多選、是／否、日期欄位。是否加入建議標記由使用者決定。
- 每個工作區資料獨立保存至IndexedDB，重新開啟可繼續；舊版工作區名稱保留。
- 一鍵匯出單份XLSX：只有有資料的商品、企劃／場次與設定日常表，穩定ID與封存資料保存在同一檔案的隱藏技術表。微軟正黑體12點、實際框線、全部純值。
- 準備離線資源後，可離線建檔與匯出；更新由使用者確認。
- 舊版66表模板與教學留在資料中心的進階入口，不作為入門門檻。

**進階功能仍分批開發。** 尚未提供自動雲端備份、換購差額自動收退、製作批次FIFO、預留、自動柄圖分攤或分潤規則。通販數量是手動核對，不會自動同步／預留／扣庫。財務頁是明確輸入的試算與往來紀錄，不是完整會計系統，不替使用者分款或禁止結案。

網站專案格式升至2.8.0/schema10，仍支援還原2.1.0至2.7.0舊檔。所有已開放資料保存在同一專案檔中；還原同一工作區需預覽差異並明確確認取代，取代前的本機資料會原子保留為本機復原點，Excel日常表的手動修改不會被採用。

已將[個人GitHub雲端備份](docs/decisions/personal-cloud-backup.md)正式納入後續規劃：使用者選配授權自己的私有儲存庫，手動備份、版本核對與跨裝置還原；先完成本機還原及安全授權驗證。這不是即時同步，基本功能仍免帳號、可離線。

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

ConMate 計算與記錄，分款、追收及結案由使用者決定。IndexedDB 本機儲存不是外部備份；匯出已提供，網站還原已提供。

文件及 JSON 案例保留完整 MVP 規格；尚未實作部分以分頁與後續任務標示，不能視為已可用。原始實際經費表未加入 repository。
