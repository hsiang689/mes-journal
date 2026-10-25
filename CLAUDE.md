# MES 交易日誌 — 給 Claude 的說明

使用者只做 MES 日內交易（Topstep 50K，TopstepX，Al Brooks 5 分 K 價格行為），一律用正體中文回覆。

## 結構
- `index.html`：整個網頁（單檔，inline script）。`store.js` 提供 `window.claude.use('db'|'assets'|'sample')` 介面，背後是 GitHub Contents API 和 Anthropic API，金鑰在使用者瀏覽器的 localStorage。
- 資料在 `data/`（見 README 的資料結構表）。JSON 一律用 `scripts/fmt.mjs` 的格式（key 排序、數字陣列同一行），手改後用它重新輸出，讓 diff 乾淨。
- `scripts/fetch-bars.mjs`：補 K 線（Yahoo MES=F 5m；EMA20 從前一日美股開盤前 1 小時起連續計算；美股時段 = 09:30–16:00 ET，台灣時間夏令 21:30、冬令 22:30 開盤）。

## 常見工作
- 「補 MM/DD 的 K 線」：通常 Actions 已自動處理；若失敗，可在對話裡用其他方式取得 K 線後寫入 `data/days/<date>.json` 的 `bars`/`prevBars`/`levels`，`needsBars` 設 false。
- 檢討某一天：依 K 線寫 `notes[k].t`（每個部位 1～3 句，提到棒號與價位）、`intervene`（[時間標籤, 說明]，最多 3 個）、`compareNote`。不要改使用者在 `data/reviews.json` 寫的內容。
- 使用者的規則：每日停損 $500；連虧 3 筆離場；虧損後只能一口。

## 注意
- 網頁本身也會即時 commit 到 main（memo 自動儲存），推送前先 `git pull --rebase`。
- repo 是公開的，不要放任何金鑰。
