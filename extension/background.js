// Handmark: service worker. Starts Handmark on a tab, opens the side panel,
// takes screenshots and recordings, and manages the optional "restore on revisit" permission.
'use strict';
importScripts('common.js', 'media.js');

const SCRIPT_FILES = ['common.js', 'controls.js', 'content.js'];
const AUTO_ID = 'handmark-auto-restore';
let cached = { ...HM.DEFAULTS };
let settingsQueue = Promise.resolve(cached);

async function loadSettings() {
  const got = await chrome.storage.local.get('settings');
  cached = HM.sanitizeSettings(got.settings);
  return cached;
}
async function applyLayout() {
  const s = await loadSettings();
  await chrome.action.setPopup({ popup: s.layout === 'popup' ? 'popup.html' : '' });
}

// "Restore drawings automatically" uses an optional permission the user grants in settings.
// Without it, Handmark only runs on a tab after the user clicks the icon or presses the shortcut.
async function syncAutoRestore() {
  const has = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  const regs = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_ID] }).catch(() => []);
  if (has && !regs.length) {
    await chrome.scripting.registerContentScripts([{
      id: AUTO_ID, matches: ['<all_urls>'], js: SCRIPT_FILES, runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
    }]).catch(() => {});
  } else if (!has && regs.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [AUTO_ID] }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const got = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: HM.sanitizeSettings(got.settings) });
  // storage is only readable by the extension itself, never by content in web pages
  await lockStorage();
  await applyLayout();
  await syncAutoRestore();
});
chrome.runtime.onStartup.addListener(async () => { await lockStorage(); await applyLayout(); await syncAutoRestore(); });
chrome.permissions.onAdded.addListener(syncAutoRestore);
chrome.permissions.onRemoved.addListener(syncAutoRestore);
// Storage is locked to trusted extension contexts. Content scripts on web pages
// never touch it directly: they ask this worker, which checks the website (see hm:load-page).
async function lockStorage() { try { await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }); } catch {} }
lockStorage();

async function broadcast(msg) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) if (t.id !== undefined) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) { applyLayout(); broadcast({ type: 'hm:settings', settings: HM.sanitizeSettings(changes.settings.newValue) }); }
  const keys = Object.keys(changes).filter((k) => k.startsWith(HM.KEY_PREFIX));
  if (keys.length) broadcast({ type: 'hm:page-changed', h: keys.slice(0, 500).map(HM.hashKey) });
});
loadSettings();

// A page may only read or write drawings for an address on its own website.
function originOf(u) { try { return new URL(u); } catch { return null; } }
function sameSite(sender, url) {
  if (!sender.tab || typeof sender.url !== 'string') return false;
  const a = originOf(sender.url), b = originOf(url);
  if (!a || !b) return false;
  if (a.protocol === 'file:' || b.protocol === 'file:') return a.protocol === 'file:' && b.protocol === 'file:';
  return a.origin === b.origin;
}

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: SCRIPT_FILES });
    return true;
  } catch {
    return false; // chrome:// pages, the Web Store, the PDF viewer, or no permission for this tab
  }
}
async function startOn(tabId, type) {
  if (!(await inject(tabId))) return { error: 'Chrome does not allow drawing on this page, or Handmark has no access to it yet. Click the Handmark icon on the page.' };
  try { return await chrome.tabs.sendMessage(tabId, { type }); } catch { return { error: 'Could not reach the page. Reload it and try again.' }; }
}

// Toolbar icon (side panel and floating layouts; the pop-up layout opens popup.html instead).
chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id === undefined) return;
  // sidePanel.open must be called straight away, while Chrome still counts the click as a user gesture
  if (cached.layout === 'side') chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  startOn(tab.id, cached.layout === 'floating' ? 'hm:toggle-session' : 'hm:activate');
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-handmark' || !tab || tab.id === undefined) return;
  if (cached.layout === 'side') chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  startOn(tab.id, 'hm:toggle-session');
});

// ---------- screenshots ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCapture = 0;
let capturing = false;
async function captureVisible(windowId) {
  // Chrome allows about two captures per second
  const wait = 600 - (Date.now() - lastCapture);
  if (wait > 0) await sleep(wait);
  lastCapture = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}
function stamp() {
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,` + btoa(s);
}
const SHOT_NAMES = { visible: 'window', full: 'fullpage', area: 'area', video: 'recording' };

// Open the editor next to the tab, or save straight to Downloads/Handmark (Settings → After a capture).
async function deliver(tab, kind, blob, mode, direct) {
  const s = await loadSettings();
  if (kind === 'image' && (direct || s.afterShot === 'save')) {
    await chrome.downloads.download({ url: await blobToDataUrl(blob), filename: `Handmark/handmark-${SHOT_NAMES[mode]}-${stamp()}.png`, saveAs: false });
    return { ok: true, saved: true };
  }
  const id = await HMMedia.put({ kind, blob, mime: blob.type, title: tab.title || '', url: tab.url || '', mode });
  const where = { url: chrome.runtime.getURL('editor.html#' + id) };
  if (Number.isInteger(tab.index)) { where.index = tab.index + 1; where.openerTabId = tab.id; where.windowId = tab.windowId; }
  await chrome.tabs.create(where);
  return { ok: true, editor: true };
}

// A rectangle in CSS pixels inside the viewport, checked and clamped.
function cleanRect(r, vw, vh) {
  if (!r || typeof r !== 'object') return null;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  let x = n(r.x), y = n(r.y), w = n(r.w), h = n(r.h);
  if ([x, y, w, h].some(Number.isNaN)) return null;
  x = Math.max(0, Math.min(vw, x)); y = Math.max(0, Math.min(vh, y));
  w = Math.min(vw - x, w); h = Math.min(vh - y, h);
  return w >= 8 && h >= 8 ? { x, y, w, h } : null;
}

// mode: 'visible' (the whole window), 'full' (the whole page) or 'area' (opts.rect, chosen on the page)
async function capture(tab, mode, opts = {}) {
  if (capturing) return { error: 'A screenshot is already being taken' };
  capturing = true;
  let prep = null;
  try {
    prep = await chrome.tabs.sendMessage(tab.id, { type: 'hm:capture-prepare' }).catch(() => null);
    let blob;
    if (mode === 'visible' || mode === 'area' || !prep) {
      if (mode !== 'visible' && !prep) return { error: 'Start Handmark on this page first' };
      await sleep(60);
      const shot = await (await fetch(await captureVisible(tab.windowId))).blob();
      if (mode === 'area') {
        const r = cleanRect(opts.rect, prep.vw, prep.vh);
        if (!r) return { error: 'Select a larger area' };
        const bmp = await createImageBitmap(shot);
        const k = bmp.width / Math.max(1, prep.vw);
        const w = Math.max(1, Math.round(r.w * k)), h = Math.max(1, Math.round(r.h * k));
        const c = new OffscreenCanvas(w, h);
        c.getContext('2d').drawImage(bmp, Math.round(r.x * k), Math.round(r.y * k), w, h, 0, 0, w, h);
        blob = await c.convertToBlob({ type: 'image/png' });
      } else blob = shot;
    } else {
      const vh = Math.max(1, prep.vh);
      // cap the height so a very long page cannot exhaust memory
      const maxH = Math.min(prep.docH, Math.floor(30000 / Math.max(1, prep.dpr)), vh * 40);
      const slices = [];
      for (let y = 0; y < maxH; y += vh) {
        const r = await chrome.tabs.sendMessage(tab.id, { type: 'hm:capture-scroll', y });
        if (!r) break;
        const shot = await captureVisible(tab.windowId);
        slices.push({ y: r.y, bmp: await createImageBitmap(await (await fetch(shot)).blob()) });
        if (r.y + vh >= maxH) break;
      }
      if (!slices.length) return { error: 'Could not capture this page' };
      const scale = slices[0].bmp.height / vh;
      const canvas = new OffscreenCanvas(slices[0].bmp.width, Math.min(32000, Math.round(maxH * scale)));
      const g = canvas.getContext('2d');
      for (const s of slices) g.drawImage(s.bmp, 0, Math.round(s.y * scale));
      blob = await canvas.convertToBlob({ type: 'image/png' });
    }
    if (prep) { await chrome.tabs.sendMessage(tab.id, { type: 'hm:capture-end' }).catch(() => {}); prep = null; }
    return await deliver(tab, 'image', blob, mode, opts.direct);
  } catch (e) {
    const m = String(e && e.message || e);
    if (/permission|activeTab|all_urls/i.test(m)) return { error: 'Click the Handmark icon on this tab first, then take the screenshot.' };
    return { error: 'Screenshot failed: ' + m.slice(0, 120) };
  } finally {
    if (prep) await chrome.tabs.sendMessage(tab.id, { type: 'hm:capture-end' }).catch(() => {});
    capturing = false;
  }
}

// ---------- recording an area of the tab ----------
// The tab is captured with chrome.tabCapture; an offscreen document crops each frame to the
// chosen area and encodes it. The page shows a frame around the area (outside it, so it is not
// recorded) and a Stop button. The finished video opens in the editor.
const OFFSCREEN = 'offscreen.html';
async function offscreenOpen() {
  const c = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => []);
  return c.length > 0;
}
async function recState() {
  const { rec } = await chrome.storage.session.get('rec');
  if (rec && !(await offscreenOpen())) { await chrome.storage.session.remove('rec'); return { recording: false }; }
  return rec ? { recording: true, tabId: rec.tabId, started: rec.started } : { recording: false };
}
async function announceRec() {
  const st = await recState();
  chrome.runtime.sendMessage({ type: 'hm:rec-state', ...st }).catch(() => {});
  return st;
}
async function recordStart(tab, rect, view) {
  if (await offscreenOpen()) return { error: 'Already recording. Stop the current recording first.' };
  const vw = Number(view && view.vw), vh = Number(view && view.vh), dpr = Number(view && view.dpr);
  if (![vw, vh, dpr].every((v) => Number.isFinite(v) && v > 0 && v < 20000)) return { error: 'Could not read the page size' };
  const r = cleanRect(rect, vw, vh);
  if (!r) return { error: 'Select a larger area' };
  let streamId;
  try { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }); }
  catch (e) { return { error: 'Chrome did not allow recording this tab. Click the Handmark icon on it, then try again.' }; }
  try {
    await chrome.offscreen.createDocument({ url: OFFSCREEN, reasons: ['USER_MEDIA'], justification: 'Record the area of the tab you selected' });
    const res = await chrome.runtime.sendMessage({ type: 'hm:off-start', streamId, rect: r, view: { vw, vh, dpr: Math.min(3, dpr) }, title: tab.title || '', url: tab.url || '' });
    if (!res || res.error) throw new Error(res ? res.error : 'no answer');
  } catch (e) {
    await chrome.offscreen.closeDocument().catch(() => {});
    return { error: 'Could not start recording: ' + String(e && e.message || e).slice(0, 120) };
  }
  await chrome.storage.session.set({ rec: { tabId: tab.id, started: Date.now(), title: tab.title || '', url: tab.url || '' } });
  announceRec();
  return { ok: true, rect: r };
}
async function recordStop() {
  if (!(await offscreenOpen())) { await chrome.storage.session.remove('rec'); announceRec(); return { error: 'Not recording' }; }
  await chrome.runtime.sendMessage({ type: 'hm:off-stop' }).catch(() => {});
  return { ok: true };
}
async function recordDone(msg) {
  const { rec } = await chrome.storage.session.get('rec');
  await chrome.storage.session.remove('rec');
  await chrome.offscreen.closeDocument().catch(() => {});
  const tabId = rec ? rec.tabId : null;
  let tab = null;
  if (Number.isInteger(tabId)) { tab = await chrome.tabs.get(tabId).catch(() => null); chrome.tabs.sendMessage(tabId, { type: 'hm:rec-ended' }).catch(() => {}); }
  announceRec();
  if (typeof msg.id !== 'string' || !(await HMMedia.get(msg.id))) return;
  const where = { url: chrome.runtime.getURL('editor.html#' + msg.id) };
  if (tab) { where.index = tab.index + 1; where.openerTabId = tab.id; where.windowId = tab.windowId; }
  await chrome.tabs.create(where);
}
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { rec } = await chrome.storage.session.get('rec');
  if (rec && rec.tabId === tabId) recordStop();
});
HMMedia.prune().catch(() => {});

// ---------- font bytes for note text ----------
let fontCache = null;
async function fontFaces() {
  if (fontCache) return fontCache;
  const files = [
    ['fonts/caveat-700-latin.woff2', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'],
    ['fonts/caveat-700-latin-ext.woff2', 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF'],
  ];
  const out = [];
  for (const [path, range] of files) {
    const buf = new Uint8Array(await (await fetch(chrome.runtime.getURL(path))).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    out.push({ data: btoa(s), range });
  }
  fontCache = out;
  return out;
}

// ---------- messages ----------
// Simple per-tab rate limit for actions a page can ask for (screenshots, resizing, opening settings),
// so even a compromised page cannot spam downloads or windows.
const lastAction = new Map();
function tooSoon(sender, kind, ms) {
  const key = kind + ':' + (sender.tab ? sender.tab.id : 'ext');
  const t = Date.now(), prev = lastAction.get(key) || 0;
  if (t - prev < ms) return true;
  lastAction.set(key, t);
  return false;
}
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

const isExtensionPage = (sender) => !sender.tab && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
async function activeTabById(tabId) {
  if (!Number.isInteger(tabId)) return null;
  try { const t = await chrome.tabs.get(tabId); return t && t.active ? t : null; } catch { return null; }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return;
  const run = async () => {
    switch (msg.type) {
      case 'hm:get-settings':
        return loadSettings();
      case 'hm:set-settings': {
        if (!msg.settings || typeof msg.settings !== 'object') return null;
        // one change at a time, so quick key presses never overwrite each other
        settingsQueue = settingsQueue.then(async () => {
          const next = HM.sanitizeSettings({ ...(await loadSettings()), ...msg.settings });
          await chrome.storage.local.set({ settings: next });
          cached = next;
          return next;
        }).catch(() => cached);
        return settingsQueue;
      }
      case 'hm:load-page': {
        const url = HM.normalizeUrl(msg.url);
        if (!url || !sameSite(sender, url)) return null;
        const k = HM.pageKey(url);
        return (await chrome.storage.local.get(k))[k] || null;
      }
      case 'hm:save-page': {
        const url = HM.normalizeUrl(msg.url);
        if (!url || !sameSite(sender, url) || (sender.tab && sender.tab.incognito)) return { error: 'not allowed' };
        const k = HM.pageKey(url);
        if (msg.record === null) { await chrome.storage.local.remove(k); return { removed: true }; }
        const rec = HM.sanitizePage({ ...msg.record, url });
        if (!rec) return { error: 'invalid drawing data' };
        if (JSON.stringify(rec).length > MAX_PAGE_BYTES) return { error: 'too many drawings on this page' };
        await chrome.storage.local.set({ [k]: rec });
        return { stored: rec };
      }
      case 'hm:font':
        return sender.tab ? fontFaces() : null;
      case 'hm:capture': {
        const mode = ['full', 'area'].includes(msg.mode) ? msg.mode : 'visible';
        if (tooSoon(sender, 'capture', 2000)) return { error: 'Wait a moment before the next screenshot' };
        // from a page: only that page, and only while it is the visible tab. An area is always chosen on the page.
        if (sender.tab) { const t = await activeTabById(sender.tab.id); return t ? capture(t, mode, { rect: msg.rect }) : { error: 'Switch to the tab first' }; }
        if (!isExtensionPage(sender) || mode === 'area') return null;
        const t = await activeTabById(msg.tabId);
        return t ? capture(t, mode) : { error: 'No active tab' };
      }
      case 'hm:record-start': {
        if (!sender.tab || tooSoon(sender, 'record', 2000)) return { error: 'Wait a moment and try again' };
        const t = await activeTabById(sender.tab.id);
        return t ? recordStart(t, msg.rect, msg.view) : { error: 'Switch to the tab first' };
      }
      case 'hm:record-stop': {
        const st = await recState();
        if (sender.tab && st.tabId !== sender.tab.id) return null;
        if (!sender.tab && !isExtensionPage(sender)) return null;
        return recordStop();
      }
      case 'hm:rec-state':
        return recState();
      case 'hm:rec-done':
        // only the recorder page may report a finished recording (web pages cannot open extension pages)
        if (typeof sender.url !== 'string' || !sender.url.startsWith(chrome.runtime.getURL(OFFSCREEN))) return null;
        await recordDone(msg);
        return { ok: true };
      case 'hm:start': {
        if (!isExtensionPage(sender)) return null;
        const t = await activeTabById(msg.tabId);
        return t ? startOn(t.id, 'hm:activate') : { error: 'No active tab' };
      }
      case 'hm:resize': {
        const width = Math.round(Number(msg.width));
        if (!Number.isFinite(width) || tooSoon(sender, 'resize', 3000)) return null;
        if (sender.tab && !(await activeTabById(sender.tab.id))) return null;
        let windowId = null;
        if (sender.tab) windowId = sender.tab.windowId;
        else if (isExtensionPage(sender)) { const t = await activeTabById(msg.tabId); windowId = t ? t.windowId : null; }
        if (windowId === null) return null;
        await chrome.windows.update(windowId, { width: Math.max(500, Math.min(7680, width)), state: 'normal' }).catch(() => {});
        return { ok: true };
      }
      case 'hm:open-options':
        if (tooSoon(sender, 'options', 2000)) return null;
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      case 'hm:open-page': {
        if (!isExtensionPage(sender) || !HM.isOpenableUrl(msg.url)) return null;
        await chrome.tabs.create({ url: msg.url });
        return { ok: true };
      }
      case 'hm:sync-permissions':
        if (!isExtensionPage(sender)) return null;
        await syncAutoRestore();
        return { ok: true };
      default:
        return undefined;
    }
  };
  run().then(reply, () => reply(null));
  return true;
});
