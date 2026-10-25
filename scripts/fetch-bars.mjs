// 補 K 線：替 data/days/*.json 裡還沒有 K 線的交易日，抓 Yahoo 的 MES=F 5 分鐘資料。
// 用法：node scripts/fetch-bars.mjs [YYYY-MM-DD ...] [--force]
//   不帶日期：處理所有缺 K 線（或 needsBars=true、或缺前一日 K 線）的交易日
//   --force：已經有 K 線也重抓（會覆蓋 bars / prevBars / levels）
import fs from 'node:fs';
import { toText } from './fmt.mjs';

const DIR = 'data/days';
const args = process.argv.slice(2).filter(Boolean);
const FORCE = args.includes('--force');
const ONLY = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const NOW = Date.now();

const ETF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
function etParts(ms) { const o = {}; ETF.formatToParts(new Date(ms)).forEach((p) => (o[p.type] = p.value)); return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24 }; }
// 美股開盤（09:30 ET）對應的 UTC 毫秒
function openUtc(dayMs) { return dayMs + ((etParts(dayMs + 12 * 3600e3).h === 8) ? 13 : 14) * 3600e3 + 30 * 60e3; }
const WK = ['日', '一', '二', '三', '四', '五', '六'];
const shortLabel = (ms) => { const d = new Date(ms); return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')}（週${WK[d.getUTCDay()]}）`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function yahoo(p1, p2) {
  let last = null;
  for (let i = 0; i < 6; i++) {
    const host = i % 2 ? 'query2' : 'query1';
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/MES=F?interval=5m&period1=${p1}&period2=${p2}`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'application/json' } });
      if (r.ok) { const j = await r.json(); const res = j?.chart?.result?.[0]; if (res && res.timestamp) return res; last = 'Yahoo 沒有回傳資料'; }
      else last = `Yahoo HTTP ${r.status}`;
    } catch (e) { last = String(e.message || e); }
    await sleep(2000 * (i + 1));
  }
  throw new Error(last || 'Yahoo 失敗');
}

async function fill(day) {
  const [Y, M, D] = day.date.split('-').map(Number), sd = Date.UTC(Y, M - 1, D);
  let pd = sd - 864e5; while ([0, 6].includes(new Date(pd).getUTCDay())) pd -= 864e5;
  const pOpen = openUtc(pd), sOpen = openUtc(sd);
  const lastExit = Math.max(sOpen + 390 * 60e3, ...(day.trades || []).map((r) => r[3] || 0));
  const p1 = Math.floor((pOpen - 3600e3) / 1000), p2 = Math.floor(Math.min(NOW, Math.max(sOpen + 395 * 60e3, lastExit + 600e3)) / 1000);
  const res = await yahoo(p1, p2);
  const q = res.indicators.quote[0];
  const rows = res.timestamp.map((t, i) => [t * 1000, q.open[i], q.high[i], q.low[i], q.close[i]]).filter((r) => r[1] != null && r[4] != null);
  // 20 EMA：從前一日開盤前 1 小時開始連續計算（包含夜盤）
  const k = 2 / 21; let e = null;
  rows.forEach((r) => { e = e == null ? r[4] : r[4] * k + e * (1 - k); r.push(Math.round(e * 100) / 100); });
  const r2 = (x) => Math.round(x * 100) / 100;
  const ohlc = (r) => [r2(r[1]), r2(r[2]), r2(r[3]), r2(r[4]), r[5]];
  const prev = rows.filter((r) => r[0] >= pOpen && r[0] < pOpen + 390 * 60e3);
  const on = rows.filter((r) => r[0] >= pOpen + 390 * 60e3 && r[0] < sOpen);
  const dayRows = rows.filter((r) => r[0] >= sOpen && r[0] < Math.max(sOpen + 390 * 60e3, lastExit + 1));
  if (!dayRows.length) throw new Error('Yahoo 沒有這一天美股時段的 K 線（假日或日期不對？）');
  const bars = dayRows.map(ohlc);
  const lo = Math.min(...bars.map((b) => b[2])), hi = Math.max(...bars.map((b) => b[1]));
  const cand = [];
  if (prev.length) cand.push([r2(prev[prev.length - 1][4]), '昨收'], [r2(Math.max(...prev.map((r) => r[2]))), '昨高'], [r2(Math.min(...prev.map((r) => r[3]))), '昨低']);
  if (on.length) cand.push([r2(Math.max(...on.map((r) => r[2]))), '夜盤高'], [r2(Math.min(...on.map((r) => r[3]))), '夜盤低']);
  const levels = []; cand.forEach(([p, n]) => { if (p >= lo - 25 && p <= hi + 25 && !levels.some((x) => Math.abs(x[0] - p) < 1)) levels.push([p, n]); });
  return { bars, levels, prevBars: prev.map(ohlc), prevLabel: shortLabel(pd) };
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
let failed = 0, changed = 0;
for (const f of files) {
  const date = f.slice(0, 10);
  if (ONLY.length && !ONLY.includes(date)) continue;
  const p = `${DIR}/${f}`;
  const day = JSON.parse(fs.readFileSync(p, 'utf8'));
  const hasBars = (day.bars || []).length > 0, hasPrev = (day.prevBars || []).length > 0;
  const want = FORCE || !hasBars || day.needsBars === true || !hasPrev;
  if (!want) continue;
  const [Y, M, D] = date.split('-').map(Number), sd = Date.UTC(Y, M - 1, D), sOpen = openUtc(sd);
  if (NOW < sOpen + 395 * 60e3) { console.log(`${date}：還沒收盤，先跳過`); continue; }
  if (NOW - sd > 58 * 864e5) { console.log(`${date}：超過 Yahoo 5 分 K 的 60 天範圍，抓不到了`); continue; }
  try {
    const r = await fill(day);
    if (FORCE || !hasBars || day.needsBars === true) {
      day.bars = r.bars;
      if (FORCE || !(day.levels || []).length) day.levels = r.levels;
      day.needsBars = false;
      day.barsAt = new Date().toISOString();
    }
    if (r.prevBars.length) { day.prevBars = r.prevBars; day.prevLabel = r.prevLabel; }
    fs.writeFileSync(p, toText(day));
    changed++;
    console.log(`${date}：當日 ${day.bars.length} 根、前一日 ${r.prevBars.length} 根`);
  } catch (e) {
    failed++;
    console.error(`${date}：失敗 — ${e.message || e}`);
  }
  await sleep(1500);
}
console.log(`完成：更新 ${changed} 天，失敗 ${failed} 天`);
if (failed) process.exitCode = 1;
