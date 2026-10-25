# MES 交易日誌 — 給 Claude 的說明

使用者只做 MES 日內交易（Topstep 50K，TopstepX，Al Brooks 5 分 K 價格行為），一律用正體中文回覆。

## 結構
- 這個 repo（公開）只有網頁程式：`index.html`（單檔，inline script）、`store.js`（`window.claude.use('db'|'assets'|'sample')` 介面，背後是 GitHub API 和 Anthropic API）、`sw.js`、`manifest.webmanifest`、`icons/`。
- **資料在私人 repo `hsiang689/mes-journal-data`**（`data/`、補 K 線的 `scripts/` 和 Actions）。不要把任何交易資料、截圖、金鑰放進這個公開 repo。
- 使用者測試新功能時，有時會先在 claude.ai 的 artifact 版本試，確認後再移植到這裡。

## 注意
- Pages 由 `.github/workflows/pages.yml` 發布，只在網頁檔案變動時觸發。
