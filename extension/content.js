// Handmark: content script. Draws on the page, restores saved drawings and,
// in floating mode, shows the toolbar inside the page.
//
// Security notes (see SECURITY.md):
// - Everything lives in a closed shadow root, so page scripts cannot reach the canvas, the controls or note text.
// - Only real user input is accepted: every pointer and key handler checks event.isTrusted,
//   so a page cannot draw, erase, clear or take screenshots by sending fake events.
// - Messages are only accepted from this extension (sender.id), with a fixed list of types.
// - No innerHTML, no eval and no network requests. Stored data is validated on every load.
(() => {
  'use strict';
  if (globalThis.__handmarkContent) return;
  globalThis.__handmarkContent = true;
  const HM = globalThis.HM;
  const HC = globalThis.HandmarkControls;
  if (!HM || !HC) return;

  const STAB = [1, 0.45, 0.2];
  const HOLD_MS = 500;
  const FONT = '"Handmark Caveat", "Segoe Print", "Bradley Hand", cursive';
  const INCOGNITO = !!(chrome.extension && chrome.extension.inIncognitoContext);

  const st = {
    settings: { ...HM.DEFAULTS },
    active: false,      // a Handmark session is running on this tab (icon / shortcut / pop-up)
    drawing: false,     // pointer input goes to the canvas
    url: null, key: null, keep: true, vwSaved: 0,
    strokes: [], undo: [], redo: [],
    lastWritten: null,
    capturing: false,
    widthNoticeDismissed: false,
  };

  let ui = null;
  let cur = null, last = null, holdTimer = 0, laserPts = [], textEl = null, raf = 0, saveTimer = 0;
  let fontState = 'none'; // none | loading | ready | failed
  let ready = null;

  const dpr = () => Math.min(3, window.devicePixelRatio || 1);
  const now = () => performance.now();

  // ---------- UI (closed shadow root) ----------
  const CSS = `
:host{all:initial}
.ink{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;touch-action:none}
.ink.on{pointer-events:auto;cursor:crosshair}
.bar{position:fixed;left:20px;top:16px;display:flex;align-items:center;gap:2px;padding:6px;background:rgba(27,26,24,.96);border:1px solid #3c3a35;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:auto;user-select:none;max-width:calc(100vw - 24px)}
.bar[hidden],.notice[hidden],.toast[hidden]{display:none}
.bar[data-collapsed="true"] .hmc{display:none}
.grip{width:30px;height:30px;border-radius:7px;background:#FFC702;border:0;cursor:grab;display:grid;place-items:center;flex:none;padding:0}
.grip svg{width:18px;height:18px;stroke:#141312;fill:none;stroke-width:2.2;stroke-linecap:round}
.grip:focus-visible{outline:2px solid #FFC702;outline-offset:2px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1d1c1a;color:#f3eee4;border:1px solid #3c3a35;border-radius:10px;padding:8px 16px;font:500 13px system-ui,sans-serif;max-width:min(560px,90vw);pointer-events:none}
.notice{position:fixed;right:16px;bottom:16px;width:min(320px,calc(100vw - 32px));background:#1d1c1a;color:#f3eee4;border:1px solid #3c3a35;border-radius:10px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;pointer-events:auto;display:grid;gap:10px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.notice .acts{display:flex;gap:8px;justify-content:flex-end}
.notice button{font:600 12.5px system-ui,sans-serif;border-radius:7px;padding:6px 10px;cursor:pointer;border:1px solid #3c3a35;background:transparent;color:#f3eee4}
.notice button.primary{background:#FFC702;color:#141312;border-color:#FFC702}
.textin{position:fixed;pointer-events:auto;font-family:${FONT};font-weight:700;background:rgba(255,255,255,.04);border:1px dashed rgba(127,127,127,.7);outline:none;padding:0 4px;min-width:80px;line-height:1.1}
`;

  function ensureUI() {
    if (ui) { if (!ui.host.isConnected) (document.documentElement || document.body).appendChild(ui.host); return ui; }
    const host = document.createElement('div');
    const hs = host.style;
    hs.setProperty('all', 'initial', 'important');
    hs.setProperty('position', 'fixed', 'important');
    hs.setProperty('inset', '0', 'important');
    hs.setProperty('pointer-events', 'none', 'important');
    hs.setProperty('z-index', '2147483647', 'important');
    hs.setProperty('display', 'block', 'important');
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS + HC.CSS);
    root.adoptedStyleSheets = [sheet];

    const canvas = document.createElement('canvas');
    canvas.className = 'ink';
    const ctx = canvas.getContext('2d');

    const bar = document.createElement('div');
    bar.className = 'bar'; bar.hidden = true; bar.dataset.collapsed = 'false';
    const grip = document.createElement('button');
    grip.className = 'grip'; grip.type = 'button'; grip.title = 'Drag to move · click or F to turn drawing on/off';
    grip.setAttribute('aria-label', 'Move toolbar or turn drawing on and off');
    const gsvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); gsvg.setAttribute('viewBox', '0 0 24 24');
    const gp = document.createElementNS('http://www.w3.org/2000/svg', 'path'); gp.setAttribute('d', 'M6 13c3-6 9-7 12-3s-3 8-7 6');
    gsvg.appendChild(gp); grip.appendChild(gsvg);
    const controls = HC.build(document, {
      layout: 'bar',
      onSetting: (p) => setSettings(p),
      onAction: (n) => runAction(n),
      onOpenSettings: () => chrome.runtime.sendMessage({ type: 'hm:open-options' }).catch(() => {}),
    });
    bar.append(grip, controls.el);

    const toast = document.createElement('div'); toast.className = 'toast'; toast.hidden = true; toast.setAttribute('role', 'status');
    const notice = document.createElement('div'); notice.className = 'notice'; notice.hidden = true;

    root.append(canvas, bar, notice, toast);
    (document.documentElement || document.body).appendChild(host);
    ui = { host, root, canvas, ctx, bar, grip, controls, toast, notice };

    // drag the floating bar
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      if (!e.isTrusted) return;
      const r = bar.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag || !e.isTrusted) return;
      drag.moved = true;
      const x = Math.max(4, Math.min(innerWidth - bar.offsetWidth - 4, e.clientX - drag.dx));
      const y = Math.max(4, Math.min(innerHeight - bar.offsetHeight - 4, e.clientY - drag.dy));
      bar.style.left = x + 'px'; bar.style.top = y + 'px';
    });
    grip.addEventListener('pointerup', (e) => { if (e.isTrusted && drag && !drag.moved) toggleDrawing(); drag = null; });
    grip.addEventListener('keydown', (e) => { if (e.isTrusted && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleDrawing(); } });

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', () => { sizeCanvas(); checkWidth(); }, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    sizeCanvas();
    controls.update(st.settings);
    return ui;
  }

  function sizeCanvas() {
    if (!ui) return;
    const d = dpr();
    ui.canvas.width = Math.max(1, Math.round(innerWidth * d));
    ui.canvas.height = Math.max(1, Math.round(innerHeight * d));
    schedule();
  }

  let toastTimer = 0;
  function toast(msg) {
    if (!ui || st.capturing) return;
    ui.toast.textContent = msg; ui.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { if (ui) ui.toast.hidden = true; }, 2400);
  }

  function refreshUI() {
    if (!ui) return;
    ui.canvas.classList.toggle('on', st.active && st.drawing && st.settings.tool !== 'through');
    ui.bar.hidden = !(st.active && st.settings.layout === 'floating') || st.capturing;
    ui.bar.dataset.collapsed = String(!st.drawing);
    ui.controls.update(st.settings);
    schedule();
  }

  // ---------- settings ----------
  async function loadSettings() {
    st.settings = HM.sanitizeSettings(await chrome.runtime.sendMessage({ type: 'hm:get-settings' }));
  }
  let pendingSettings = 0;
  function setSettings(partial) {
    const next = HM.sanitizeSettings({ ...st.settings, ...partial });
    if (partial.tool && partial.tool !== 'text') commitText();
    st.settings = next;
    if (!st.drawing && partial.tool && partial.tool !== 'through') st.drawing = true;
    refreshUI();
    // While our own changes are on their way, ignore settings echoed back by the service worker:
    // they can be older than what the user just pressed. The last reply is the final state.
    pendingSettings++;
    chrome.runtime.sendMessage({ type: 'hm:set-settings', settings: partial })
      .then((r) => { if (--pendingSettings === 0 && r) { st.settings = HM.sanitizeSettings(r); refreshUI(); } })
      .catch(() => { pendingSettings = Math.max(0, pendingSettings - 1); });
  }

  // ---------- page data ----------
  function unpack(s) {
    const o = { ...s, done: 0, fade: false };
    o.bb = bbox(o);
    return o;
  }
  function pack(s) {
    if (s.t === 'text') return { t: 'text', c: s.c, x: r1(s.x), y: r1(s.y), fs: s.fs, v: s.v };
    return { t: s.t, c: s.c, w: s.w, p: s.p.map(r1) };
  }
  const r1 = (v) => Math.round(v * 10) / 10;

  function bbox(s) {
    if (s.t === 'text') {
      const wid = textWidth(s);
      return [s.x - 4, s.y - s.fs * 1.1, s.x + wid + 4, s.y + s.fs * 0.5];
    }
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (let i = 0; i < s.p.length; i += 3) { const x = s.p[i], y = s.p[i + 1]; if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
    const pad = s.w * 3 + 24;
    return [a - pad, b - pad, c + pad, d + pad];
  }
  function textWidth(s) {
    if (!ui) return s.v.length * s.fs * 0.45;
    const g = ui.ctx; g.save(); g.font = `700 ${s.fs}px ${FONT}`; const w = g.measureText(s.v).width; g.restore(); return w;
  }

  async function loadPage() {
    commitText();
    const url = HM.normalizeUrl(location.href);
    st.url = url; st.key = url ? HM.pageKey(url) : null;
    st.strokes = []; st.undo = []; st.redo = []; st.keep = st.settings.keepDefault; st.vwSaved = 0;
    st.widthNoticeDismissed = false;
    if (st.key && !INCOGNITO) {
      // Storage is locked to the extension itself; the service worker hands back
      // only this page's record, and only to a page on the same website.
      const raw = await chrome.runtime.sendMessage({ type: 'hm:load-page', url }).catch(() => null);
      const rec = HM.sanitizePage(raw);
      st.lastWritten = raw ? HM.stableJson(raw) : null;
      if (rec && rec.url === url) {
        st.keep = rec.keep; st.vwSaved = rec.vw;
        st.strokes = rec.strokes.map(unpack);
      }
    }
    if (st.strokes.length) { ensureUI(); if (st.strokes.some((s) => s.t === 'text')) loadFont(); }
    if (ui) { for (const s of st.strokes) s.bb = bbox(s); }
    checkWidth();
    schedule();
  }

  function savedStrokes() { return st.strokes.filter((s) => !s.fade); }

  function scheduleSave() {
    if (INCOGNITO || !st.key) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }
  // Saves run one after another, so a change notice never sees a half-finished save.
  let savePromise = Promise.resolve();
  function save() {
    clearTimeout(saveTimer); saveTimer = 0;
    savePromise = savePromise.then(doSave, doSave);
    return savePromise;
  }
  async function doSave() {
    if (INCOGNITO || !st.key) return;
    const strokes = savedStrokes().map(pack);
    try {
      if (st.keep && !strokes.length) {
        if (st.lastWritten !== null) { st.lastWritten = null; await chrome.runtime.sendMessage({ type: 'hm:save-page', url: st.url, record: null }); }
        return;
      }
      if (!st.vwSaved || !strokes.length) st.vwSaved = Math.round(innerWidth);
      const rec = {
        url: st.url, title: (document.title || '').slice(0, HM.LIMITS.titleLen), updated: Date.now(),
        vw: st.vwSaved, keep: st.keep, strokes: st.keep ? strokes : [],
      };
      const r = await chrome.runtime.sendMessage({ type: 'hm:save-page', url: st.url, record: rec });
      if (!r || !r.stored) throw new Error(r && r.error ? r.error : 'not saved');
      st.lastWritten = HM.stableJson(r.stored);
    } catch (e) {
      toast('Could not save drawings: ' + (e && e.message ? e.message : 'storage error'));
    }
  }

  // ---------- history ----------
  function pushHistory() { st.undo.push(st.strokes.slice()); if (st.undo.length > 200) st.undo.shift(); st.redo = []; }
  function undo() { if (!st.undo.length) return; st.redo.push(st.strokes.slice()); st.strokes = st.undo.pop(); changed(); }
  function redo() { if (!st.redo.length) return; st.undo.push(st.strokes.slice()); st.strokes = st.redo.pop(); changed(); }
  function clearPage() {
    if (!st.strokes.length) return;
    pushHistory(); st.strokes = []; changed(); toast('Page cleared · Ctrl+Z to undo');
  }
  function changed() { schedule(); scheduleSave(); notifyPanel(); }
  function notifyPanel() { chrome.runtime.sendMessage({ type: 'hm:changed' }).catch(() => {}); }

  // ---------- input ----------
  function docPoint(e) { return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY, t: now() }; }

  function onDown(e) {
    if (!e.isTrusted || e.button !== 0 || !st.active || !st.drawing) return;
    e.preventDefault(); e.stopPropagation();
    const tool = st.settings.tool;
    const p = docPoint(e);
    if (tool === 'text') { placeText(e.clientX, e.clientY, p); return; }
    ui.canvas.setPointerCapture(e.pointerId);
    if (tool === 'laser') { cur = { laser: true }; laserPts.push({ x: e.clientX, y: e.clientY, t: p.t }); schedule(); return; }
    if (tool === 'eraser') { pushHistory(); cur = { erase: true, hit: false }; eraseAt(p); return; }
    if (!HM.STROKE_TOOLS.includes(tool)) return;
    cur = { t: tool, c: st.settings.color, w: HM.SIZES[st.settings.size], p: [p.x, p.y, 0], t0: p.t, straight: false };
    last = p; armHold(); schedule();
  }
  function onMove(e) {
    if (!e.isTrusted || !cur) return;
    if (cur.laser) { laserPts.push({ x: e.clientX, y: e.clientY, t: now() }); if (laserPts.length > 400) laserPts.shift(); schedule(); return; }
    const p = docPoint(e);
    if (cur.erase) { eraseAt(p); return; }
    if (cur.straight) { if (Math.hypot(p.x - cur.end.x, p.y - cur.end.y) > 14) cur.straight = false; else return; }
    const k = STAB[st.settings.stab];
    const sp = { x: last.x + (p.x - last.x) * k, y: last.y + (p.y - last.y) * k, t: p.t };
    if (Math.hypot(sp.x - last.x, sp.y - last.y) < 0.8) return;
    if (cur.p.length >= HM.LIMITS.pointsPerStroke * 3) return;
    cur.p.push(sp.x, sp.y, sp.t - cur.t0);
    last = sp; armHold(); schedule();
  }
  function onUp(e) {
    if (e && !e.isTrusted) return;
    clearTimeout(holdTimer);
    if (!cur) return;
    if (cur.laser) { cur = null; return; }
    if (cur.erase) { const hit = cur.hit; cur = null; if (hit) changed(); else st.undo.pop(); return; }
    const s = cur; cur = null;
    if (s.p.length === 3) s.p.push(s.p[0] + 0.5, s.p[1] + 0.5, 10);
    if (st.strokes.length >= HM.LIMITS.strokesPerPage) { toast('This page has reached the limit of ' + HM.LIMITS.strokesPerPage + ' marks'); schedule(); return; }
    const stroke = { t: s.t, c: s.c, w: s.w, p: s.p, done: now(), fade: st.settings.fade, fadeMs: st.settings.fadeMs };
    stroke.bb = bbox(stroke);
    pushHistory(); st.strokes.push(stroke);
    schedule();
    if (!stroke.fade) { scheduleSave(); notifyPanel(); }
  }
  function armHold() { clearTimeout(holdTimer); holdTimer = setTimeout(straighten, HOLD_MS); }
  function straighten() {
    if (!cur || !cur.p || cur.p.length < 18) return;
    const ax = cur.p[0], ay = cur.p[1], bx = cur.p[cur.p.length - 3], by = cur.p[cur.p.length - 2];
    const L = Math.hypot(bx - ax, by - ay); if (L < 30) return;
    const n = Math.max(8, Math.round(L / 6)), p = [];
    for (let i = 0; i <= n; i++) { const u = i / n; p.push(ax + (bx - ax) * u + Math.sin(u * Math.PI) * 0.6, ay + (by - ay) * u, u * 240); }
    cur.p = p; cur.straight = true; cur.end = { x: bx, y: by }; schedule(); toast('Straightened');
  }
  function eraseAt(p) {
    const before = st.strokes.length;
    st.strokes = st.strokes.filter((s) => {
      const b = s.bb; if (p.x < b[0] || p.x > b[2] || p.y < b[1] || p.y > b[3]) return true;
      if (s.t === 'text') return false;
      const r = 12 + s.w;
      for (let i = 0; i < s.p.length; i += 3) if (Math.hypot(s.p[i] - p.x, s.p[i + 1] - p.y) < r) return false;
      return true;
    });
    if (st.strokes.length !== before) { cur.hit = true; schedule(); }
  }

  // text notes
  function placeText(cx, cy, p) {
    commitText();
    loadFont();
    const fs = HM.SIZES[st.settings.size] * 4 + 12;
    const input = document.createElement('input');
    input.className = 'textin'; input.type = 'text'; input.maxLength = HM.LIMITS.textLen;
    input.setAttribute('aria-label', 'Note text');
    input.style.left = cx + 'px'; input.style.top = (cy - fs * 0.85) + 'px';
    input.style.fontSize = fs + 'px'; input.style.color = st.settings.color;
    textEl = { input, x: p.x, y: p.y, fs, c: st.settings.color, fade: st.settings.fade, fadeMs: st.settings.fadeMs };
    ui.root.appendChild(input);
    input.focus({ preventScroll: true });
    setTimeout(() => { if (textEl && textEl.input === input) input.focus({ preventScroll: true }); }, 0);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (!e.isTrusted) return;
      if (e.key === 'Enter') commitText();
      if (e.key === 'Escape') { input.remove(); textEl = null; }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (textEl && textEl.input === input) commitText(); }, 0));
  }
  function commitText() {
    if (!textEl) return;
    const t = textEl; textEl = null;
    const v = t.input.value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, HM.LIMITS.textLen);
    t.input.remove();
    if (!v) return;
    const s = { t: 'text', c: t.c, x: t.x, y: t.y, fs: t.fs, v, done: now(), fade: t.fade, fadeMs: t.fadeMs };
    s.bb = bbox(s);
    pushHistory(); st.strokes.push(s); schedule();
    if (!s.fade) { scheduleSave(); notifyPanel(); }
  }

  // The note font is bundled with the extension and handed over by the service worker
  // as bytes, so no page CSP, network request or web-accessible resource is involved.
  async function loadFont() {
    if (fontState !== 'none') return;
    fontState = 'loading';
    try {
      const faces = await chrome.runtime.sendMessage({ type: 'hm:font' });
      if (!Array.isArray(faces)) throw new Error('no font');
      for (const f of faces) {
        const bin = atob(f.data); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const face = new FontFace('Handmark Caveat', bytes.buffer, { weight: '700', unicodeRange: f.range });
        await face.load(); document.fonts.add(face);
      }
      fontState = 'ready';
      for (const s of st.strokes) s.bb = bbox(s);
      schedule();
    } catch { fontState = 'failed'; }
  }

  // ---------- rendering ----------
  function schedule() { if (!raf && ui) raf = requestAnimationFrame(render); }

  function widths(s) {
    const p = s.p, n = p.length / 3, out = new Array(n); let v = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) { const d = Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2]); const dt = Math.max(1, p[i * 3 + 2] - p[i * 3 - 1]); v = v * 0.7 + (d / dt) * 0.3; }
      let w = s.w * Math.max(0.65, 1 - v * 0.18);
      const e = Math.min(i, n - 1 - i); if (e < 3) w *= 0.72 + 0.28 * (e / 3);
      out[i] = w;
    }
    return out;
  }
  function pathLine(g, p) {
    const n = p.length / 3;
    g.beginPath(); g.moveTo(p[0], p[1]);
    for (let i = 1; i < n - 1; i++) g.quadraticCurveTo(p[i * 3], p[i * 3 + 1], (p[i * 3] + p[i * 3 + 3]) / 2, (p[i * 3 + 1] + p[i * 3 + 4]) / 2);
    g.lineTo(p[(n - 1) * 3], p[(n - 1) * 3 + 1]);
  }
  function drawStroke(g, s, alpha) {
    g.save(); g.globalAlpha = alpha;
    if (s.t === 'text') { g.fillStyle = s.c; g.font = `700 ${s.fs}px ${FONT}`; g.fillText(s.v, s.x, s.y); g.restore(); return; }
    const p = s.p, n = p.length / 3;
    if (s.t === 'hl') { g.globalCompositeOperation = 'multiply'; g.globalAlpha = alpha * 0.38; g.strokeStyle = s.c; g.lineWidth = s.w * 3.2; g.lineCap = 'butt'; g.lineJoin = 'round'; pathLine(g, p); g.stroke(); g.restore(); return; }
    if (s.t === 'pen') { g.strokeStyle = s.c; g.lineWidth = Math.max(2, s.w * 0.6); g.lineCap = 'round'; g.lineJoin = 'round'; pathLine(g, p); g.stroke(); g.restore(); return; }
    // marker brush and arrow: a filled outline whose width follows speed
    const ws = widths(s), L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1]; const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
      const w = ws[i] / 2;
      L.push(p[i * 3] - dy * w, p[i * 3 + 1] + dx * w); R.push(p[i * 3] + dy * w, p[i * 3 + 1] - dx * w);
    }
    const poly = L; for (let i = R.length - 2; i >= 0; i -= 2) poly.push(R[i], R[i + 1]);
    g.fillStyle = s.c; g.beginPath(); g.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length - 2; i += 2) g.quadraticCurveTo(poly[i], poly[i + 1], (poly[i] + poly[i + 2]) / 2, (poly[i + 1] + poly[i + 3]) / 2);
    g.closePath(); g.fill();
    g.beginPath(); g.arc(p[0], p[1], ws[0] / 2, 0, Math.PI * 2); g.arc(p[(n - 1) * 3], p[(n - 1) * 3 + 1], ws[n - 1] / 2, 0, Math.PI * 2); g.fill();
    if (s.t === 'arrow' && n > 2) {
      const ex = p[(n - 1) * 3], ey = p[(n - 1) * 3 + 1]; let k = n - 1;
      while (k > 0 && Math.hypot(p[k * 3] - ex, p[k * 3 + 1] - ey) < s.w * 3 + 10) k--;
      const ang = Math.atan2(ey - p[k * 3 + 1], ex - p[k * 3]), h = s.w * 2.6 + 12;
      g.strokeStyle = s.c; g.lineWidth = ws[n - 1] * 0.95; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
      g.moveTo(ex + Math.cos(ang + Math.PI - 0.5) * h, ey + Math.sin(ang + Math.PI - 0.5) * h); g.lineTo(ex, ey);
      g.lineTo(ex + Math.cos(ang + Math.PI + 0.42) * h * 0.92, ey + Math.sin(ang + Math.PI + 0.42) * h * 0.92); g.stroke();
    }
    g.restore();
  }

  function render() {
    raf = 0;
    if (!ui) return;
    if (!ui.host.isConnected) (document.documentElement || document.body).appendChild(ui.host);
    const g = ui.ctx, d = dpr(), t = now();
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    const before = st.strokes.length;
    st.strokes = st.strokes.filter((s) => !(s.fade && t - s.done > s.fadeMs));
    if (st.strokes.length !== before) notifyPanel();
    const sx = window.scrollX, sy = window.scrollY, vx2 = sx + innerWidth, vy2 = sy + innerHeight;
    g.setTransform(d, 0, 0, d, -sx * d, -sy * d);
    let animate = false;
    for (const s of st.strokes) {
      const b = s.bb; if (b[2] < sx || b[0] > vx2 || b[3] < sy || b[1] > vy2) { if (s.fade) animate = true; continue; }
      let a = 1; if (s.fade) { a = Math.max(0, 1 - (t - s.done) / s.fadeMs); animate = true; }
      drawStroke(g, s, a);
    }
    if (cur && cur.p) { drawStroke(g, cur, 1); animate = true; }
    laserPts = laserPts.filter((q) => t - q.t < 700);
    if (laserPts.length) {
      g.setTransform(d, 0, 0, d, 0, 0);
      for (let i = 1; i < laserPts.length; i++) {
        const q = laserPts[i], o = laserPts[i - 1], a = 1 - (t - q.t) / 700;
        g.strokeStyle = `rgba(250,65,1,${a * 0.85})`; g.lineWidth = 6 * a + 1; g.lineCap = 'round';
        g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(q.x, q.y); g.stroke();
      }
      const h = laserPts[laserPts.length - 1];
      g.fillStyle = 'rgba(250,65,1,.95)'; g.shadowColor = 'rgba(250,65,1,.9)'; g.shadowBlur = 16;
      g.beginPath(); g.arc(h.x, h.y, 6, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
      animate = true;
    }
    if (animate) schedule();
  }

  // ---------- width notice ----------
  function widthMismatch() {
    return !!(st.vwSaved && savedStrokes().length && Math.abs(innerWidth - st.vwSaved) / st.vwSaved > 0.08);
  }
  function checkWidth() {
    if (!ui) return;
    const n = ui.notice;
    if (!st.active || st.widthNoticeDismissed || !widthMismatch() || st.capturing) { n.hidden = true; return; }
    n.replaceChildren();
    const msg = document.createElement('div');
    msg.textContent = `These drawings were made in a ${st.vwSaved}px wide window. This one is ${Math.round(innerWidth)}px, so marks may not line up with the text.`;
    const acts = document.createElement('div'); acts.className = 'acts';
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Show anyway';
    const match = document.createElement('button'); match.type = 'button'; match.className = 'primary'; match.textContent = 'Match width';
    dismiss.addEventListener('click', (e) => { if (!e.isTrusted) return; st.widthNoticeDismissed = true; n.hidden = true; });
    match.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      chrome.runtime.sendMessage({ type: 'hm:resize', width: Math.round(window.outerWidth + (st.vwSaved - innerWidth)) }).catch(() => {});
      st.widthNoticeDismissed = true; n.hidden = true;
    });
    acts.append(dismiss, match); n.append(msg, acts); n.hidden = false;
  }

  // ---------- session ----------
  async function activate() {
    await ready;
    ensureUI();
    st.active = true; st.drawing = true;
    refreshUI(); checkWidth();
    toast(st.settings.layout === 'floating' ? 'Handmark on · F turns drawing on/off' : 'Handmark on · F turns drawing on/off · Esc to click the page');
  }
  function deactivate() {
    commitText(); cur = null;
    st.active = false; st.drawing = false;
    if (ui) ui.notice.hidden = true;
    refreshUI(); save();
  }
  function toggleDrawing() {
    if (!st.active) { activate(); return; }
    commitText();
    st.drawing = !st.drawing;
    if (st.drawing && st.settings.tool === 'through') setSettings({ tool: 'brush' });
    refreshUI(); toast(st.drawing ? 'Drawing on' : 'Drawing off · F to turn back on');
    notifyPanel();
  }
  function runAction(name) {
    if (name === 'undo') undo();
    else if (name === 'redo') redo();
    else if (name === 'clear') clearPage();
    else if (name === 'shot-visible' || name === 'shot-full') {
      chrome.runtime.sendMessage({ type: 'hm:capture', mode: name === 'shot-full' ? 'full' : 'visible' })
        .then((r) => { if (r && r.error) toast(r.error); })
        .catch(() => toast('Screenshot failed'));
    }
  }

  // keyboard: only while a session is running, only real key presses, never inside text fields
  function isEditable(e) {
    const t = e.composedPath()[0];
    if (!t || t.nodeType !== 1) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }
  window.addEventListener('keydown', (e) => {
    // our own note box lives in a closed shadow root, so check it directly
    if (!st.active || !e.isTrusted || textEl || isEditable(e) || e.repeat) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    let handled = true;
    if (mod && !e.altKey && k === 'z' && st.drawing) { e.shiftKey ? redo() : undo(); }
    else if (mod && e.shiftKey && !e.altKey && k === 's') runAction('shot-visible');
    else if (mod && e.shiftKey && !e.altKey && k === 'f') runAction('shot-full');
    else if (mod || e.altKey) handled = false;
    else if (k === 'f') toggleDrawing();
    else if (k === 'escape') { if (st.drawing) setSettings({ tool: 'through' }); else handled = false; }
    else if (!st.drawing) handled = false;
    else {
      const map = { p: 'pen', b: 'brush', h: 'hl', a: 'arrow', t: 'text', l: 'laser', e: 'eraser', v: 'through' };
      if (map[k]) setSettings({ tool: map[k] });
      else if (k === '1' || k === '2' || k === '3') setSettings({ size: Number(k) });
      else if (k === 's') { const v = (st.settings.stab + 1) % 3; setSettings({ stab: v }); toast('Stabiliser: ' + ['Off', 'Low', 'High'][v]); }
      else if (k === 'g') { setSettings({ fade: !st.settings.fade }); toast(st.settings.fade ? `Fade on: new marks disappear after ${st.settings.fadeMs / 1000} s` : 'Fade off'); }
      else if (k === 'c') clearPage();
      else handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------- messages from the extension ----------
  function status() {
    return {
      active: st.active, drawing: st.drawing, url: st.url, title: (document.title || '').slice(0, 200),
      count: savedStrokes().length, keep: st.keep, vwSaved: st.vwSaved, vw: Math.round(innerWidth),
      outerWidth: Math.round(window.outerWidth), mismatch: widthMismatch(), incognito: INCOGNITO,
    };
  }
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let captureRestore = null;

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'hm:activate': activate().then(() => reply(status())); return true;
      case 'hm:toggle-session': (st.active ? Promise.resolve(deactivate()) : activate()).then(() => reply(status())); return true;
      case 'hm:toggle-drawing': toggleDrawing(); reply(status()); return;
      case 'hm:status': ready.then(() => reply(status())); return true;
      case 'hm:action':
        if (['undo', 'redo', 'clear'].includes(msg.name)) runAction(msg.name);
        reply(status()); return;
      case 'hm:set-keep':
        if (typeof msg.keep === 'boolean') { st.keep = msg.keep; save().then(() => reply(status())); return true; }
        reply(status()); return;
      case 'hm:capture-prepare':
        commitText();
        st.capturing = true; captureRestore = { x: window.scrollX, y: window.scrollY };
        if (ui) { ui.toast.hidden = true; ui.notice.hidden = true; }
        refreshUI();
        frames().then(() => reply({
          x: window.scrollX, y: window.scrollY, vw: innerWidth, vh: innerHeight, dpr: window.devicePixelRatio || 1,
          docH: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
        }));
        return true;
      case 'hm:capture-scroll': {
        const y = Number(msg.y);
        if (!st.capturing || !Number.isFinite(y) || y < 0) { reply(null); return; }
        window.scrollTo(captureRestore ? captureRestore.x : 0, y);
        frames().then(() => sleep(120)).then(() => { render(); reply({ y: window.scrollY }); });
        return true;
      }
      case 'hm:settings': {
        if (pendingSettings > 0) return;
        const prevLayout = st.settings.layout;
        st.settings = HM.sanitizeSettings(msg.settings);
        if (prevLayout !== st.settings.layout) commitText();
        refreshUI(); return;
      }
      case 'hm:page-changed': onPageChanged(msg.h); return;
      case 'hm:capture-end':
        if (captureRestore) window.scrollTo(captureRestore.x, captureRestore.y);
        st.capturing = false; captureRestore = null; refreshUI(); checkWidth();
        reply(true); return;
      default: return;
    }
  });

  // Other tabs, the side panel or an import may change settings or this page's drawings.
  // The service worker announces changes; this page then asks for its own record again.
  async function onPageChanged(hashes) {
    if (!st.key || INCOGNITO || !Array.isArray(hashes) || !hashes.includes(HM.hashKey(st.key))) return;
    await savePromise;
    if (saveTimer || cur) return; // our own pending save or a stroke in progress wins
    const raw = await chrome.runtime.sendMessage({ type: 'hm:load-page', url: st.url }).catch(() => null);
    if ((raw ? HM.stableJson(raw) : null) === st.lastWritten) return;
    const fading = st.strokes.filter((x) => x.fade);
    await loadPage();
    st.strokes.push(...fading); schedule(); notifyPanel();
  }

  // single-page apps change the address without reloading
  setInterval(() => {
    const u = HM.normalizeUrl(location.href);
    if (u !== st.url) { save().finally(() => loadPage().then(notifyPanel)); }
  }, 1000);
  window.addEventListener('pagehide', () => { if (saveTimer) save(); });

  ready = loadSettings().then(loadPage).catch(() => {});
})();
