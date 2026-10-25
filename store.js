/* MES 交易日誌 — GitHub 資料層
 * 提供和 claude.ai artifact 相同介面的 window.claude.use('db' | 'assets' | 'sample')，
 * 資料存在另一個私人 repo（預設 <owner>/mes-journal-data）的 data/ 底下，
 * 讀寫都用 GitHub API 帶 token，沒有 token 就讀不到。
 *   data/days/<YYYY-MM-DD>.json   每個交易日一個檔
 *   data/<collection>.json        其他集合：{ docId: doc }
 *   data/img/<id>.<ext>           截圖
 * 金鑰只存在這台電腦的瀏覽器（localStorage），不會進 repo。
 */
(() => {
  'use strict';
  const LS = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} },
  };
  const K = { gh: 'mj-gh-token', ai: 'mj-anthropic-key', model: 'mj-model', repo: 'mj-data-repo' };
  const DEFAULT_MODEL = 'claude-opus-5-5';

  function dataRepo() {
    const o = LS.get(K.repo);
    if (o && /^[\w.-]+\/[\w.-]+$/.test(o)) return o.split('/');
    const host = location.hostname;
    const owner = host.endsWith('.github.io') ? host.split('.')[0] : 'hsiang689';
    return [owner, 'mes-journal-data'];
  }
  const [OWNER, REPO] = dataRepo();
  const BRANCH = 'main';
  const SPLIT = { days: true };
  const COLLS = ['days', 'reviews', 'handbook', 'cases', 'charts', 'premarket'];
  const fileOf = (coll, id) => (SPLIT[coll] ? `data/${coll}/${id}.json` : `data/${coll}.json`);

  const token = () => LS.get(K.gh);
  const S = { head: null, sha: {}, data: {}, loaded: false, ops: {}, timers: {}, waiters: {}, chain: Promise.resolve(), localImg: {} };
  COLLS.forEach((c) => (S.data[c] = {}));
  const L = { coll: {}, doc: {} };
  const status = { mode: 'loading', error: '' };
  const statusCbs = [];
  function setStatus(mode, error) { status.mode = mode; status.error = error || ''; statusCbs.forEach((f) => { try { f(status); } catch (e) {} }); }

  /* ---------- JSON 格式：數字陣列放同一行，方便看 git diff ---------- */
  function fmt(v, ind = '') {
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      if (v.every((x) => x === null || typeof x !== 'object')) return '[' + v.map((x) => JSON.stringify(x)).join(',') + ']';
      if (v.every((x) => Array.isArray(x) && x.every((y) => y === null || typeof y !== 'object'))) return '[\n' + v.map((x) => ind + '  ' + fmt(x)).join(',\n') + '\n' + ind + ']';
      return '[\n' + v.map((x) => ind + '  ' + fmt(x, ind + '  ')).join(',\n') + '\n' + ind + ']';
    }
    if (v && typeof v === 'object') {
      const ks = Object.keys(v).filter((k) => v[k] !== undefined).sort();
      if (!ks.length) return '{}';
      return '{\n' + ks.map((k) => ind + '  ' + JSON.stringify(k) + ': ' + fmt(v[k], ind + '  ')).join(',\n') + '\n' + ind + '}';
    }
    return JSON.stringify(v);
  }
  const toText = (v) => fmt(v) + '\n';

  /* ---------- base64 ---------- */
  function b64FromBytes(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  const b64FromText = (t) => b64FromBytes(new TextEncoder().encode(t));
  function textFromB64(b) { const bin = atob(b.replace(/\s/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }

  /* ---------- GitHub API ---------- */
  async function gh(path, opt = {}) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.headers || {}) };
    const t = token(); if (t) headers.Authorization = 'Bearer ' + t;
    if (opt.body && typeof opt.body !== 'string') { opt = { ...opt, body: JSON.stringify(opt.body) }; headers['Content-Type'] = 'application/json'; }
    const r = await fetch('https://api.github.com' + path, { ...opt, headers, cache: 'no-store' });
    if (!r.ok) { let m = ''; try { m = (await r.json()).message || ''; } catch (e) {} const err = new Error(m || ('GitHub ' + r.status)); err.status = r.status; throw err; }
    return r.status === 204 ? null : r.json();
  }
  const repoPath = (p) => `/repos/${OWNER}/${REPO}${p}`;
  // 私人 repo 不能用 raw.githubusercontent.com，改用 contents API 取原始內容
  async function ghRaw(path, ref) {
    const t = token(); if (!t) { const e = new Error('no token'); e.status = 401; throw e; }
    const r = await fetch('https://api.github.com' + repoPath(`/contents/${path}?ref=${ref}`), { headers: { Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28', Authorization: 'Bearer ' + t }, cache: 'no-store' });
    if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; }
    return r;
  }

  async function headSha() { const r = await gh(repoPath(`/git/ref/heads/${BRANCH}`)); return r.object.sha; }

  async function loadAll() {
    const head = await headSha();
    const tree = await gh(repoPath(`/git/trees/${head}?recursive=1`));
    const sha = {}; (tree.tree || []).forEach((e) => { if (e.type === 'blob' && e.path.startsWith('data/')) sha[e.path] = e.sha; });
    const data = {}; COLLS.forEach((c) => (data[c] = {}));
    const jobs = [];
    COLLS.forEach((c) => {
      if (SPLIT[c]) {
        Object.keys(sha).filter((p) => p.startsWith(`data/${c}/`) && p.endsWith('.json')).forEach((p) => {
          const id = p.slice(`data/${c}/`.length, -5);
          jobs.push(ghRaw(p, head).then((r) => r.json()).then((v) => { if (v) data[c][id] = v; }));
        });
      } else if (sha[`data/${c}.json`]) {
        jobs.push(ghRaw(`data/${c}.json`, head).then((r) => r.json()).then((v) => { data[c] = v || {}; }));
      }
    });
    await Promise.all(jobs);
    return { head, sha, data };
  }

  /* ---------- 通知 ---------- */
  function snap(coll, local) {
    const m = S.data[coll] || {};
    return { docs: Object.keys(m).sort().map((id) => ({ id, exists: true, data: () => m[id] })), metadata: { hasPendingWrites: !!local }, size: Object.keys(m).length };
  }
  function emit(coll, local) {
    (L.coll[coll] || []).forEach((f) => { try { f(snap(coll, local)); } catch (e) { console.error(e); } });
    Object.keys(L.doc).forEach((p) => {
      const [c, id] = p.split('/'); if (c !== coll) return;
      const v = S.data[c][id];
      L.doc[p].forEach((f) => { try { f({ id, exists: v !== undefined, data: () => v, metadata: { hasPendingWrites: !!local } }); } catch (e) { console.error(e); } });
    });
  }

  /* ---------- 寫入：本地先更新，1.2 秒內的修改合併成一個 commit ---------- */
  function applyOp(map, op) {
    if (op.t === 'set') map[op.id] = op.v;
    else if (op.t === 'update') map[op.id] = { ...(map[op.id] || {}), ...op.v };
    else if (op.t === 'delete') delete map[op.id];
  }
  function stripDeletes(v) { const o = { ...v }; Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === 'object' && o[k].__delete__) delete o[k]; }); return o; }

  function write(coll, id, t, v) {
    if (!token()) return Promise.reject(Object.assign(new Error('沒有設定 GitHub token，目前是唯讀'), { code: 'no_token' }));
    if (!COLLS.includes(coll)) return Promise.reject(new Error('unknown collection ' + coll));
    const op = { t, id, v: v && stripDeletes(v) };
    if (t === 'update' && v) Object.keys(v).forEach((k) => { if (v[k] && v[k].__delete__) op.del = (op.del || []).concat(k); });
    applyOp(S.data[coll], op); if (op.del && S.data[coll][id]) { S.data[coll][id] = { ...S.data[coll][id] }; op.del.forEach((k) => delete S.data[coll][id][k]); }
    else if (S.data[coll][id]) S.data[coll][id] = { ...S.data[coll][id] };
    emit(coll, true);
    const file = fileOf(coll, id);
    (S.ops[file] = S.ops[file] || { coll, id: SPLIT[coll] ? id : null, list: [] }).list.push(op);
    clearTimeout(S.timers[file]);
    S.timers[file] = setTimeout(() => flush(file), 1200);
    setStatus('saving');
    return new Promise((res, rej) => (S.waiters[file] = S.waiters[file] || []).push({ res, rej }));
  }

  // 所有寫入排成一列依序送出；前一個失敗不會卡住後面的
  function queue(fn) { const p = S.chain.then(fn); S.chain = p.catch(() => {}); return p; }
  function flush(file) { queue(() => persist(file)).catch(() => {}); }

  async function fetchRemote(file) {
    try {
      const r = await gh(repoPath(`/contents/${file}?ref=${BRANCH}`));
      return { sha: r.sha, text: textFromB64(r.content || '') };
    } catch (e) { if (e.status === 404) return { sha: null, text: null }; throw e; }
  }

  async function persist(file) {
    const job = S.ops[file]; if (!job) return;
    delete S.ops[file];
    const waiters = S.waiters[file] || []; delete S.waiters[file];
    const { coll, id } = job;
    const label = SPLIT[coll] ? `${coll}/${id}` : `${coll}/${[...new Set(job.list.map((o) => o.id))].join(',')}`;
    let attempt = 0;
    for (;;) {
      try {
        const sha = S.sha[file];
        if (SPLIT[coll] && S.data[coll][id] === undefined) {
          if (sha) await gh(repoPath(`/contents/${file}`), { method: 'DELETE', body: { message: `journal: delete ${label}`, sha, branch: BRANCH } });
          delete S.sha[file];
        } else {
          const body = SPLIT[coll] ? S.data[coll][id] : S.data[coll];
          const r = await gh(repoPath(`/contents/${file}`), { method: 'PUT', body: { message: `journal: update ${label}`, content: b64FromText(toText(body)), branch: BRANCH, ...(sha ? { sha } : {}) } });
          S.sha[file] = r.content.sha; if (r.commit && r.commit.sha) S.head = r.commit.sha;
        }
        waiters.forEach((w) => w.res());
        if (!Object.keys(S.ops).length) setStatus('ready');
        return;
      } catch (e) {
        attempt++;
        if ((e.status === 409 || e.status === 422) && attempt < 4) {
          // 別處（例如 GitHub Actions 補 K 線）改過這個檔：抓最新內容，把這次的修改重新套上去
          const rem = await fetchRemote(file).catch(() => null);
          if (rem) {
            S.sha[file] = rem.sha || undefined;
            let base = {};
            if (rem.text) { try { const v = JSON.parse(rem.text); base = SPLIT[coll] ? { [id]: v } : v; } catch (x) {} }
            job.list.forEach((op) => { applyOp(base, op); if (op.del && base[op.id]) op.del.forEach((k) => delete base[op.id][k]); });
            if (SPLIT[coll]) { if (base[id] === undefined) delete S.data[coll][id]; else S.data[coll][id] = base[id]; }
            else S.data[coll] = base;
            emit(coll, false);
          }
          continue;
        }
        console.error('save failed', file, e);
        setStatus('error', e.status === 401 || e.status === 403 ? 'GitHub token 無效或沒有寫入權限' : (e.message || '儲存失敗'));
        waiters.forEach((w) => w.rej(e));
        return;
      }
    }
  }

  window.addEventListener('beforeunload', (e) => {
    if (Object.keys(S.ops).length) { Object.keys(S.ops).forEach((f) => { clearTimeout(S.timers[f]); flush(f); }); e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- 定期檢查遠端（例如 Actions 補好 K 線） ---------- */
  let polling = false;
  async function poll() {
    if (polling || document.hidden || Object.keys(S.ops).length || !S.loaded) return;
    polling = true;
    try {
      const h = await headSha();
      if (h !== S.head && !Object.keys(S.ops).length) {
        const fresh = await loadAll();
        if (Object.keys(S.ops).length) return;
        S.head = fresh.head; S.sha = fresh.sha;
        COLLS.forEach((c) => { const changed = JSON.stringify(S.data[c]) !== JSON.stringify(fresh.data[c]); S.data[c] = fresh.data[c]; if (changed) emit(c, false); });
      }
    } catch (e) {} finally { polling = false; }
  }
  setInterval(poll, 3 * 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  // 清掉沒有任何圖解筆記用到的截圖（例如刪除時網路中斷留下的），只清 10 分鐘前上傳的
  function cleanOrphans() {
    if (!token() || Object.keys(S.ops).length) return;
    const used = new Set(Object.values(S.data.charts || {}).map((c) => c && c.asset).filter(Boolean));
    Object.keys(S.sha).filter((p) => p.startsWith('data/img/')).forEach((p) => {
      const id = p.slice(9), m = id.match(/^([0-9a-z]{8})[0-9a-f]{16}\./);
      if (used.has(id) || !m) return;
      const at = parseInt(m[1], 36);
      if (!(at > 1.6e12 && Date.now() - at > 10 * 60e3)) return;
      assets.delete(id).catch(() => {});
    });
  }

  let ready = null;
  function init() {
    if (!ready) ready = loadAll().then((r) => {
      S.head = r.head; S.sha = r.sha; COLLS.forEach((c) => (S.data[c] = r.data[c])); S.loaded = true;
      setStatus('ready');
      if (token()) setTimeout(cleanOrphans, 4000);
    }).catch((e) => {
      if (!token()) setStatus('readonly');
      else setStatus('error', e.status === 401 ? 'GitHub token 無效' : e.status === 404 ? `token 看不到 ${OWNER}/${REPO}` : ('讀不到資料：' + (e.message || e)));
      throw e;
    });
    return ready;
  }

  function docRef(path) {
    const [coll, id] = path.split('/');
    return {
      id,
      set: (v) => write(coll, id, 'set', v),
      update: (v) => write(coll, id, 'update', v),
      delete: () => write(coll, id, 'delete'),
      get: async () => { await init(); const v = S.data[coll][id]; return { id, exists: v !== undefined, data: () => v }; },
      onSnapshot(cb, err) {
        (L.doc[path] = L.doc[path] || []).push(cb);
        init().then(() => { const v = S.data[coll][id]; cb({ id, exists: v !== undefined, data: () => v, metadata: { hasPendingWrites: false } }); }).catch((e) => err && err(e));
        return () => { L.doc[path] = (L.doc[path] || []).filter((f) => f !== cb); };
      },
    };
  }
  const db = {
    doc: docRef,
    collection(coll) {
      return {
        doc: (id) => docRef(coll + '/' + id),
        onSnapshot(cb, err) {
          (L.coll[coll] = L.coll[coll] || []).push(cb);
          init().then(() => cb(snap(coll, false))).catch((e) => err && err(e));
          return () => { L.coll[coll] = (L.coll[coll] || []).filter((f) => f !== cb); };
        },
      };
    },
  };

  /* ---------- 截圖 ---------- */
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
  const imgJobs = {};
  function assetBlob(id) { return ghRaw('data/img/' + id, BRANCH).then((r) => r.blob()); }
  // 有快取就回傳網址字串，沒有就回傳 Promise（下載完成後是 blob: 網址）
  function assetUrl(id) {
    if (S.localImg[id]) return S.localImg[id];
    return imgJobs[id] || (imgJobs[id] = assetBlob(id).then((b) => (S.localImg[id] = URL.createObjectURL(b))).catch((e) => { delete imgJobs[id]; throw e; }));
  }
  const assets = {
    async upload(file) {
      if (!token()) throw Object.assign(new Error('no token'), { code: 'no_token' });
      const ext = EXT[file.type] || 'png';
      const rnd = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const id = `${Date.now().toString(36)}${rnd}.${ext}`;
      const path = 'data/img/' + id;
      const bytes = new Uint8Array(await file.arrayBuffer());
      S.localImg[id] = URL.createObjectURL(file);
      await queue(async () => {
        const r = await gh(repoPath(`/contents/${path}`), { method: 'PUT', body: { message: `journal: add image ${id}`, content: b64FromBytes(bytes), branch: BRANCH } });
        S.sha[path] = r.content.sha; if (r.commit) S.head = r.commit.sha;
      });
      return { id, url: S.localImg[id] };
    },
    async delete(id) {
      const path = 'data/img/' + id;
      await queue(async () => {
        for (let attempt = 0; ; attempt++) {
          let sha = attempt ? null : S.sha[path];
          if (!sha) { const r = await fetchRemote(path).catch(() => null); sha = r && r.sha; }
          if (!sha) { delete S.sha[path]; return; }
          try {
            const r = await gh(repoPath(`/contents/${path}`), { method: 'DELETE', body: { message: `journal: delete image ${id}`, sha, branch: BRANCH } });
            delete S.sha[path]; if (r && r.commit) S.head = r.commit.sha;
            return;
          } catch (e) {
            if (attempt >= 3 || !(e.status === 409 || e.status === 422 || e.status === 404)) { console.error('delete image failed', id, e); throw e; }
            await new Promise((s) => setTimeout(s, 800 * (attempt + 1)));
          }
        }
      });
    },
    url: assetUrl,
  };

  /* ---------- Claude（Anthropic API，用你自己的 key） ---------- */
  async function blobToImage(b) {
    const bytes = new Uint8Array(await b.arrayBuffer());
    let mt = b.type && EXT[b.type] ? b.type : '';
    if (!mt) mt = bytes[0] === 0xff ? 'image/jpeg' : bytes[0] === 0x52 ? 'image/webp' : bytes[0] === 0x47 ? 'image/gif' : 'image/png';
    return { type: 'image', source: { type: 'base64', media_type: mt, data: b64FromBytes(bytes) } };
  }
  function pickJson(t) {
    const s = t.replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { return JSON.parse(s); } catch (e) {}
    const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch (e) {} }
    throw Object.assign(new Error('invalid json'), { code: 'invalid_json' });
  }
  const sample = {
    async limits() { return { images: true }; },
    async text(prompt, opt = {}) {
      const key = LS.get(K.ai); if (!key) throw Object.assign(new Error('no key'), { code: 'not_granted' });
      const imgs = opt.images ? (Array.isArray(opt.images) ? opt.images : [opt.images]) : [];
      const content = [...(await Promise.all(imgs.map(blobToImage))), { type: 'text', text: prompt }];
      let r;
      try {
        r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: LS.get(K.model) || DEFAULT_MODEL, max_tokens: opt.maxTokens || 4000, messages: [{ role: 'user', content }] }),
        });
      } catch (e) { throw Object.assign(new Error('network'), { code: 'network' }); }
      if (!r.ok) {
        let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) {}
        const code = r.status === 401 || r.status === 403 ? 'bad_key' : r.status === 429 || r.status === 529 ? 'rate_limited' : r.status === 402 || /credit/i.test(m) ? 'no_credit' : /image/i.test(m) ? 'image_rejected' : /model/i.test(m) ? 'bad_model' : 'api_error';
        throw Object.assign(new Error(m || ('Anthropic ' + r.status)), { code });
      }
      const j = await r.json();
      if (j.stop_reason === 'refusal') throw Object.assign(new Error('refused'), { code: 'refused' });
      return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    },
    async json(prompt, opt = {}) { return pickJson(await sample.text(prompt + '\n\n只輸出 JSON，不要加任何其他文字或 ``` 標記。', opt)); },
  };

  /* ---------- 對外介面 ---------- */
  window.claude = {
    async use(name) {
      if (name === 'db') { init().catch(() => {}); return db; }
      if (name === 'assets') { if (!token()) throw Object.assign(new Error('read only'), { code: 'not_granted' }); return assets; }
      if (name === 'sample') { if (!LS.get(K.ai)) throw Object.assign(new Error('no key'), { code: 'not_granted' }); return sample; }
      throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    },
  };
  window.MJ = {
    repo: `${OWNER}/${REPO}`, keys: K, defaultModel: DEFAULT_MODEL, assetUrl, assetBlob,
    get: LS.get, set: LS.set, status, onStatus: (f) => { statusCbs.push(f); f(status); },
    hasToken: () => !!token(), hasKey: () => !!LS.get(K.ai),
    pending: () => Object.keys(S.ops).length,
    async checkKey(key, model) {
      let r;
      try {
        r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: model || DEFAULT_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        });
      } catch (e) { return { ok: false, msg: '連不到 Anthropic，檢查網路後再試' }; }
      if (r.ok) return { ok: true };
      let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) {}
      if (r.status === 401 || r.status === 403) return { ok: false, msg: 'Anthropic API key 無效' };
      if (r.status === 402 || /credit|balance|billing/i.test(m)) return { ok: false, msg: 'key 有效，但帳戶餘額不足，請到 console 儲值' };
      if (r.status === 404 || /model/i.test(m)) return { ok: false, msg: `找不到模型「${model || DEFAULT_MODEL}」，檢查模型名稱` };
      if (r.status === 429 || r.status === 529) return { ok: true, warn: 'key 有效，但 Anthropic 目前忙碌或用量到上限' };
      return { ok: false, msg: 'Anthropic 回應 ' + r.status + (m ? '：' + m : '') };
    },
    async checkToken(t) {
      const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + t }, cache: 'no-store' });
      if (!r.ok) return { ok: false, msg: r.status === 401 ? 'token 無效' : r.status === 404 ? `token 看不到 ${OWNER}/${REPO}` : 'GitHub 回應 ' + r.status };
      // fine-grained token 的實際權限要等第一次寫入才知道；寫入失敗時右上角會顯示原因
      return { ok: true };
    },
  };
})();
