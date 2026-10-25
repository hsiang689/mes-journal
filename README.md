# MES 交易日誌

MES 日內交易的檢討日誌：盤前提醒、每日檢討（K 線＋進出場標記＋規則檢查）、圖解筆記、趨勢總覽、交易手冊。

網頁：https://hsiang689.github.io/mes-journal/

這個 repo 只有網頁程式（公開）。**資料放在私人 repo `hsiang689/mes-journal-data`**，網頁用你的 GitHub token 讀寫；沒有 token 的人打開網頁什麼資料都看不到。

## 運作方式

- **網頁**（`index.html`、`store.js`、`sw.js`、`manifest.webmanifest`、`icons/`）由 GitHub Pages 發布，只有這些檔變動時才重新發布。
- **資料**在 `mes-journal-data` 的 `data/`；網頁上的每次修改都直接 commit 到那裡，有完整版本紀錄，而且只有你看得到。
- **K 線**：`mes-journal-data` 的 Actions「補 K 線」會在新增交易日後自動抓 Yahoo 的 MES=F 5 分 K。
- **Claude**：圖解筆記的「整理出的注意事項」和每日檢討的「請 Claude 逐筆檢討」用你自己的 Anthropic API key，從瀏覽器直接呼叫。

## 設定

1. **GitHub token**：Settings → Developer settings → Fine-grained tokens
   - Repository access：Only select repositories → `mes-journal-data`
   - Permissions → Contents：**Read and write**
2. **Anthropic API key**（要用 AI 整理才需要）：console.anthropic.com 建立，並設每月花費上限。
3. 打開網頁 → 右上角「設定」→ 貼上 → 儲存。金鑰只存在這台電腦的瀏覽器。

## 安裝成應用程式

- **電腦（Chrome / Edge）**：網址列右邊的「安裝」圖示 → 安裝。
- **iPhone（Safari）**：分享 → 加入主畫面。
- **Android（Chrome）**：選單 → 安裝應用程式。

## 安全

- 金鑰存在瀏覽器 localStorage，別在公用電腦上填。
- 網頁的 Content-Security-Policy 只允許連到 api.github.com 和 api.anthropic.com。
- `hsiang689.github.io` 底下的所有 Pages 共用同一個瀏覽器儲存空間，所以其他 repo 的 Pages 也只放自己寫的程式。

這是交易紀錄與複盤，不是交易建議。
