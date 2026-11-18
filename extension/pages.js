// Handmark: saved pages list, export and import. Used by the side panel and the settings page.
(() => {
  'use strict';
  const HM = globalThis.HM;

  async function listPages() {
    const all = await chrome.storage.local.get(null);
    const pages = [];
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith(HM.KEY_PREFIX)) continue;
      const p = HM.sanitizePage(v);
      if (p && HM.pageKey(p.url) === k && (p.strokes.length || !p.keep)) pages.push(p);
    }
    pages.sort((a, b) => b.updated - a.updated);
    return pages;
  }

  function drawPreview(canvas, page) {
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W, H);
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const s of page.strokes) {
      if (s.t === 'text') { a = Math.min(a, s.x); b = Math.min(b, s.y - s.fs); c = Math.max(c, s.x + s.v.length * s.fs * 0.45); d = Math.max(d, s.y); continue; }
      for (let i = 0; i < s.p.length; i += 3) { a = Math.min(a, s.p[i]); b = Math.min(b, s.p[i + 1]); c = Math.max(c, s.p[i]); d = Math.max(d, s.p[i + 1]); }
    }
    if (!Number.isFinite(a)) return;
    const pad = 6, sc = Math.min((W - pad * 2) / Math.max(1, c - a), (H - pad * 2) / Math.max(1, d - b));
    const X = (x) => pad + (x - a) * sc, Y = (y) => pad + (y - b) * sc;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of page.strokes) {
      g.strokeStyle = s.c === '#F6F0E2' ? '#c9bfa6' : s.c;
      g.fillStyle = g.strokeStyle;
      if (s.t === 'text') { g.globalAlpha = 0.7; g.fillRect(X(s.x), Y(s.y - s.fs * 0.6), Math.max(4, s.v.length * s.fs * 0.45 * sc), Math.max(2, s.fs * 0.5 * sc)); g.globalAlpha = 1; continue; }
      g.globalAlpha = s.t === 'hl' ? 0.4 : 1;
      g.lineWidth = Math.max(1.2, s.w * sc * (s.t === 'hl' ? 3 : 1));
      g.beginPath(); g.moveTo(X(s.p[0]), Y(s.p[1]));
      for (let i = 3; i < s.p.length; i += 3) g.lineTo(X(s.p[i]), Y(s.p[i + 1]));
      g.stroke(); g.globalAlpha = 1;
    }
  }

  function host(url) { try { return new URL(url).host || url; } catch { return url; } }
  function when(ts) {
    if (!ts) return '';
    const d = new Date(ts), diff = Date.now() - ts;
    if (diff < 60e3) return 'just now';
    if (diff < 3600e3) return Math.round(diff / 60e3) + ' min ago';
    if (diff < 86400e3) return Math.round(diff / 3600e3) + ' h ago';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }

  // Renders with textContent only: titles and URLs come from web pages and are never parsed as HTML.
  async function renderList(container, { limit = 0, filter = '' } = {}) {
    const pages = (await listPages()).filter((p) => !filter || (p.title + ' ' + p.url).toLowerCase().includes(filter.toLowerCase()));
    container.replaceChildren();
    if (!pages.length) {
      const e = document.createElement('p'); e.className = 'empty';
      e.textContent = filter ? 'No saved pages match.' : 'No saved drawings yet. Draw on a page and it appears here.';
      container.appendChild(e); return pages.length;
    }
    for (const p of limit ? pages.slice(0, limit) : pages) {
      const row = document.createElement('div'); row.className = 'page';
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 80; cv.className = 'prev'; drawPreview(cv, p);
      const info = document.createElement('div'); info.className = 'info';
      const t = document.createElement('div'); t.className = 'ptitle'; t.textContent = p.title || host(p.url); t.title = p.url;
      const m = document.createElement('div'); m.className = 'meta';
      m.textContent = `${host(p.url)} · ${p.strokes.length} mark${p.strokes.length === 1 ? '' : 's'} · ${when(p.updated)}${p.keep ? '' : ' · not saving'}`;
      const acts = document.createElement('div'); acts.className = 'acts';
      const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Open';
      open.disabled = !HM.isOpenableUrl(p.url);
      open.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'hm:open-page', url: p.url }));
      const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete'; del.className = 'danger';
      let armed = false, timer = 0;
      del.addEventListener('click', async () => {
        if (!armed) { armed = true; del.textContent = 'Delete?'; timer = setTimeout(() => { armed = false; del.textContent = 'Delete'; }, 3000); return; }
        clearTimeout(timer); await chrome.storage.local.remove(HM.pageKey(p.url)); row.remove();
      });
      acts.append(open, del); info.append(t, m, acts); row.append(cv, info); container.appendChild(row);
    }
    return pages.length;
  }

  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function exportAll() {
    const pages = await listPages();
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    downloadText(`handmark-backup-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}.json`,
      JSON.stringify({ app: 'handmark', version: 1, exported: d.toISOString(), pages }, null, 0));
    return pages.length;
  }

  // Import is treated as untrusted input: size limit, strict JSON parsing,
  // every page and stroke re-validated, unknown fields dropped, URL keys recomputed.
  async function importFile(file) {
    if (!file) return { error: 'No file chosen' };
    if (file.size > HM.LIMITS.importBytes) return { error: 'File is too large (max 50 MB)' };
    let data;
    try { data = JSON.parse(await file.text()); } catch { return { error: 'This is not a Handmark backup file (not valid JSON)' }; }
    if (!data || typeof data !== 'object' || data.app !== 'handmark' || !Array.isArray(data.pages)) return { error: 'This is not a Handmark backup file' };
    if (data.version !== 1) return { error: 'This backup was made by a newer version of Handmark' };
    const existing = await chrome.storage.local.get(null);
    const out = {}; let added = 0, replaced = 0, skipped = 0;
    for (const raw of data.pages.slice(0, HM.LIMITS.pages)) {
      const p = HM.sanitizePage(raw);
      if (!p || (!p.strokes.length && p.keep)) { skipped++; continue; }
      const k = HM.pageKey(p.url);
      if (existing[k] || out[k]) replaced++; else added++;
      out[k] = p;
    }
    skipped += Math.max(0, data.pages.length - HM.LIMITS.pages);
    if (Object.keys(out).length) await chrome.storage.local.set(out);
    return { added, replaced, skipped };
  }

  async function deleteAll() {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(HM.KEY_PREFIX));
    if (keys.length) await chrome.storage.local.remove(keys);
    return keys.length;
  }

  globalThis.HMPages = Object.freeze({ listPages, renderList, exportAll, importFile, deleteAll, drawPreview });
})();
