// Handmark: shared constants, URL handling and data validation.
// Loaded by the service worker, the content script and the extension pages.
// Everything that comes from storage, an import file or a message passes
// through the sanitize* functions before it is used.
(() => {
  'use strict';
  if (globalThis.HM) return;

  const COLORS = Object.freeze([
    Object.freeze({ hex: '#FFC702', name: 'Yellow' }),
    Object.freeze({ hex: '#F6F0E2', name: 'Cream' }),
    Object.freeze({ hex: '#141312', name: 'Black' }),
    Object.freeze({ hex: '#FA4101', name: 'Orange' }),
  ]);
  const SIZES = Object.freeze({ 1: 4, 2: 7, 3: 12 });
  const TOOLS = Object.freeze(['brush', 'pen', 'hl', 'arrow', 'text', 'laser', 'eraser', 'through']);
  const STROKE_TOOLS = Object.freeze(['pen', 'brush', 'hl', 'arrow']);
  const LAYOUTS = Object.freeze(['side', 'popup', 'floating']);
  const FADE_TIMES = Object.freeze([3000, 5000, 8000]);
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const KEY_PREFIX = 'p:';

  const DEFAULTS = Object.freeze({
    tool: 'brush', color: '#FFC702', custom: '#2F6BFF', size: 2, stab: 1,
    fade: false, fadeMs: 5000, layout: 'side', keepDefault: true, afterShot: 'editor',
  });
  const AFTER_SHOT = Object.freeze(['editor', 'save']);

  const LIMITS = Object.freeze({
    strokesPerPage: 5000,
    pointsPerStroke: 20000,
    textLen: 500,
    titleLen: 300,
    urlLen: 2048,
    pages: 10000,
    importBytes: 50 * 1024 * 1024,
    coord: 1e6,
  });

  // Query parameters that only track where a click came from. Removing them
  // means the same article opened from a social media post or a bookmark finds the same drawings.
  const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|ref_src|si|trk|trackingId)$/i;

  function normalizeUrl(href) {
    let u;
    try { u = new URL(String(href)); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return null;
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    // Keep hash routes (#/page, #!page) used by single-page apps; drop plain anchors.
    if (!(u.hash.startsWith('#/') || u.hash.startsWith('#!'))) u.hash = '';
    u.username = '';
    u.password = '';
    const s = u.toString();
    return s.length > LIMITS.urlLen ? null : s;
  }

  function isOpenableUrl(href) {
    try { const u = new URL(String(href)); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
  }

  const pageKey = (url) => KEY_PREFIX + url;

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMITS.coord;
  const isColor = (v) => typeof v === 'string' && COLOR_RE.test(v);

  function sanitizeSettings(s) {
    const o = { ...DEFAULTS };
    if (!s || typeof s !== 'object') return o;
    if (TOOLS.includes(s.tool)) o.tool = s.tool;
    if (isColor(s.color)) o.color = s.color.toUpperCase();
    if (isColor(s.custom)) o.custom = s.custom.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(SIZES, s.size)) o.size = Number(s.size);
    if ([0, 1, 2].includes(s.stab)) o.stab = s.stab;
    o.fade = s.fade === true;
    if (FADE_TIMES.includes(s.fadeMs)) o.fadeMs = s.fadeMs;
    if (LAYOUTS.includes(s.layout)) o.layout = s.layout;
    o.keepDefault = s.keepDefault !== false;
    if (AFTER_SHOT.includes(s.afterShot)) o.afterShot = s.afterShot;
    return o;
  }

  // Stored stroke shapes:
  //   line:  { t: 'pen'|'brush'|'hl'|'arrow', c: '#RRGGBB', w: number, p: [x, y, ms, x, y, ms, ...] }
  //   text:  { t: 'text', c, x, y, fs, v }
  // Coordinates are document pixels; ms is time since the stroke started.
  function sanitizeStroke(s) {
    if (!s || typeof s !== 'object') return null;
    if (s.t === 'text') {
      if (typeof s.v !== 'string') return null;
      const v = s.v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, LIMITS.textLen);
      if (!v || !isColor(s.c) || !isNum(s.x) || !isNum(s.y) || !isNum(s.fs) || s.fs < 6 || s.fs > 200) return null;
      return { t: 'text', c: s.c.toUpperCase(), x: s.x, y: s.y, fs: s.fs, v };
    }
    if (!STROKE_TOOLS.includes(s.t) || !isColor(s.c) || !isNum(s.w) || s.w < 1 || s.w > 60) return null;
    if (!Array.isArray(s.p) || s.p.length < 6 || s.p.length % 3 !== 0 || s.p.length > LIMITS.pointsPerStroke * 3) return null;
    for (const v of s.p) if (!isNum(v)) return null;
    return { t: s.t, c: s.c.toUpperCase(), w: s.w, p: s.p.slice() };
  }

  function sanitizePage(r) {
    if (!r || typeof r !== 'object') return null;
    const url = typeof r.url === 'string' ? normalizeUrl(r.url) : null;
    if (!url) return null;
    const strokes = Array.isArray(r.strokes)
      ? r.strokes.slice(0, LIMITS.strokesPerPage).map(sanitizeStroke).filter(Boolean)
      : [];
    const updated = typeof r.updated === 'number' && Number.isFinite(r.updated) && r.updated > 0 ? Math.floor(r.updated) : 0;
    const title = typeof r.title === 'string' ? r.title.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, LIMITS.titleLen) : '';
    const vw = isNum(r.vw) && r.vw > 0 ? Math.round(r.vw) : 0;
    return { url, title, updated, vw, keep: r.keep !== false, strokes };
  }

  // Short non-reversible tag for a storage key, so change notices sent to every tab
  // never contain the addresses of other pages.
  function hashKey(k) {
    let h = 0x811c9dc5;
    for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }

  // JSON with object keys sorted, so two copies of the same record always compare equal
  // (chrome.storage may return keys in a different order than they were written).
  function stableJson(v) {
    if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }

  globalThis.HM = Object.freeze({
    COLORS, SIZES, TOOLS, STROKE_TOOLS, LAYOUTS, AFTER_SHOT, FADE_TIMES, COLOR_RE, KEY_PREFIX, DEFAULTS, LIMITS,
    normalizeUrl, isOpenableUrl, pageKey, hashKey, stableJson, isColor, sanitizeSettings, sanitizeStroke, sanitizePage,
  });
})();
