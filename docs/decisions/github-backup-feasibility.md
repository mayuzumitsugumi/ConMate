# GitHub 個人備份授權可行性

調查日期：2026-11-03（台灣時間）。本文件記錄 C02 技術研究。v0.16.0 已依此實作 fine-grained PAT 連接、手動備份與遠端還原；仍沒有 OAuth 登入，也未建立 OAuth／GitHub App。測試使用模擬 API，未取得真實使用者權杖。

## 結論

維持 GitHub Pages 純靜態、無後端與前端不放 client secret 的前提下，**目前不能直接承諾「按登入 GitHub 就能備份」的標準網頁 OAuth 流程**。

最適合先驗證的無後端替代是：使用者自行建立只授權專用私有 repository 的 fine-grained personal access token（PAT），每次工作階段輸入，網站僅在記憶體保存，再直接呼叫 GitHub REST Contents API。這可保留免費靜態架構，但操作比登入授權複雜，使用者已接受自行設定儲存庫的替代路徑；v0.16.0 已提供此流程。實際帳戶權限與 iOS／Android 實機仍需使用者驗證。

## 官方事實與判斷

| 方式 | 官方文件確認 | 對 ConMate 的判斷 |
| --- | --- | --- |
| OAuth App 網頁授權 | 支援 PKCE/S256，但交換 authorization code 的參數仍列 `client_secret` 為必要。官方也註明授權端點不支援 CORS preflight。 | PKCE 不等於可省略 secret。不能把 secret 放在公開前端，也不採用公用 token 交換代理。 |
| GitHub App 網頁授權 | code 換 user access token 仍需 client secret；App 權限可限制至指定安裝儲存庫，user token 只具有使用者與 App 共同權限。 | 細粒度授權適合長期整合，但純靜態前端無法安全持有 secret。 |
| GitHub App device flow | 輪詢 token 只需 client_id、device_code、grant_type；官方主要定位為 CLI、無瀏覽器及桌面工具。 | 不需要 secret 不代表瀏覽器一定可用。裝置碼與 token 端點位於 github.com，不可套用 api.github.com 的 CORS 保證；尚未完成可用的跨來源瀏覽器證明，不能視為現成解法。 |
| 使用者自行建立 fine-grained PAT | 可限定單一資源擁有者、選定 repository 與權限；Contents 寫入 API 支援此 token。REST API 支援任意來源 CORS 與 Authorization header。 | 是不另加後端的具體可行候選。首版只接專用私有 repository、Contents read/write，明確顯示作用範圍與撤銷方式。 |

官方來源：

- [OAuth App 授權參數與 PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub App user token 網頁及 device flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub 2025-07-14 PKCE 支援公告](https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/)
- [REST API CORS 支援](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)
- [Fine-grained PAT 的權限、期限及建立方式](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Contents API 讀寫與更新 SHA](https://docs.github.com/en/rest/repos/contents)

### 研究環境的有限探測

不帶 token，對 github.com 的 `/login/oauth/access_token` 與 `/login/device/code` 發送帶 ConMate Origin 的 OPTIONS，均得到 404 且沒有 Access-Control-Allow-* 回應標頭。這只證明本次 preflight 不可用，**不能單獨證明所有 simple POST 或未來官方實作皆不可用**。本環境對 api.github.com 的直接 shell 連線被網路政策阻擋，未把它當成 GitHub API 不支援 CORS；該支援以上述官方文件為準。

## 建議實作路徑

1. 將第一版介面命名為「使用個人存取權杖連接」，不可標成已完成 OAuth 登入。
2. 使用者自行建立專用私有 repository，再在 GitHub 建立有期限、只授權該 repository 的 fine-grained PAT，權限只開 Contents read/write；不要求 Workflows、Administration、組織或所有儲存庫權限。
3. 以遮蔽輸入欄接受 PAT。存在目前分頁的記憶體，斷開／離開／重新整理後清除；不寫 localStorage、IndexedDB、專案檔、URL、日誌或錯誤報告。憑證送出目的固定為 `https://api.github.com`，不接受自訂 API host。
4. 讀取使用者指定 repository 的 metadata，確認 private 與有效權限。PAT 通常涵蓋整個所選 repository 的 Contents，而非只限制備份路徑，因此必須是專用空間；UI 不宣稱只有單一檔案權限。
5. 備份採本機已驗證專案格式，讀取指定分支、檔案 SHA，再顯示目的與摘要；使用者確認後才 PUT。衝突停止，不強制覆蓋；首次路徑已存在或遠端 workspaceId 不符也阻擋。
6. 只在 GitHub 確認寫入成功並回傳 commit 後記錄備份成功。記錄 revision、SHA／commit 及時間；不保存 PAT。若本機同時變動，標示仍有未備份變更。
7. 還原下載透過同一安全解析／驗證／差異預覽及原子提交；斷線、限流、401/403/404、權杖到期與取消都保留本機資料。不能因遠端 404 就誤判檔案不存在並盲目覆蓋。
8. 在 Android Chrome、iOS Safari／主畫面 PWA 與桌面實測 CORS、權限、SHA 衝突、超限及還原後，再發布為選配功能。

若產品仍要求一鍵 GitHub 登入，不接受 PAT 操作，就需要另外評估可信任的 token 交換服務及 App 註冊／secret 保管；這會改變「完全無後端」的架構，需要另外確認，不能在此研究中暗中引入。
