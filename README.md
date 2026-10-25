# MES 交易日誌

MES 日內交易的檢討日誌：盤前提醒、每日檢討（K 線＋進出場標記＋規則檢查）、圖解筆記、趨勢總覽、交易手冊。

網頁：https://hsiang689.github.io/mes-journal/

## 運作方式

- **網頁**（`index.html`、`store.js`）由 GitHub Pages 發布。只有這兩個檔變動時才會重新發布。
- **資料**都在 `data/`，網頁直接從 repo 讀取；在網頁上寫的東西會用你的 GitHub token 直接 commit 回來，所以每次修改都有版本紀錄。
- **K 線**：新增交易日後，GitHub Actions「補 K 線」會自動抓 Yahoo 的 MES=F 5 分 K（含前一日），寫回該交易日的檔案。收盤後也會定時再檢查一次。Yahoo 的 5 分 K 只保留約 60 天。
- **Claude**：圖解筆記的「整理出的注意事項」和每日檢討的「請 Claude 逐筆檢討」用你自己的 Anthropic API key，從瀏覽器直接呼叫。

## 第一次設定

1. **開啟 Pages**：Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。然後到 Actions → 發布網頁 → Run workflow 跑一次。
2. **GitHub token**：Settings（個人）→ Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
   - Repository access：Only select repositories → `mes-journal`
   - Permissions → Repository permissions → **Contents：Read and write**（其他都不用）
   - 建議設到期日，到期再換一把
3. **Anthropic API key**（要用 AI 整理才需要）：console.anthropic.com → API Keys 建立，並在 Billing 設每月上限。
4. 打開網頁 → 右上角「設定」→ 貼上 token 和 key → 儲存。兩個都只存在這台電腦的瀏覽器，不會進 repo。

沒填 token 也能看，只是唯讀。

## 安裝成應用程式

- **電腦（Chrome / Edge）**：打開網頁，網址列右邊的「安裝」圖示 → 安裝。之後從開始選單或桌面開啟，會是獨立視窗。
- **iPhone（Safari）**：分享 → 加入主畫面。
- **Android（Chrome）**：右上角選單 → 安裝應用程式／加到主畫面。

應用程式和網頁共用同一份設定與資料；網頁改版後，下次開啟會自動更新。

## 安全

- 金鑰存在瀏覽器 localStorage，只有這台電腦這個瀏覽器有；別在公用電腦上填。
- 網頁設了 Content-Security-Policy，只允許連到 api.github.com、raw.githubusercontent.com、api.anthropic.com，其他網站一律擋掉。
- 注意：`hsiang689.github.io` 底下的所有 Pages（例如其他 repo 的網頁）共用同一個瀏覽器儲存空間，所以那些 repo 也只放自己寫的程式。
- 這個 repo 是公開的：交易紀錄和檢討任何人都看得到。

## 資料結構

| 路徑 | 內容 |
| --- | --- |
| `data/days/YYYY-MM-DD.json` | 一個交易日：成交 `fills`、部位 `pos`、K 線 `bars`（[開,高,低,收,EMA20]）、前一日 `prevBars`、價位 `levels`、逐筆註記 `notes`、叫停點 `intervene`、比較 `compare` |
| `data/reviews.json` | 每個部位你寫的檢討，key 是 `YYYY-MM-DD_pNN` |
| `data/premarket.json` | 盤前提醒（背景判斷、檢查表、計畫），key 是日期 |
| `data/charts.json` | 圖解筆記，`asset` 對應 `data/img/` 的圖檔 |
| `data/cases.json` | 交易手冊的案例 |
| `data/handbook.json` | 風控規則 |

## 手動補 K 線

Actions → 補 K 線 → Run workflow，可以指定日期，或勾「已經有 K 線也重抓」。本機也可以跑：

```sh
node scripts/fetch-bars.mjs 2026-10-23 --force
```

時間都是台灣時間；K 線是 Yahoo 的連續合約，EMA 和平台可能差幾毛。這是交易紀錄與複盤，不是交易建議。
