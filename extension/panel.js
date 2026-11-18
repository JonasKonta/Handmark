// Handmark: side panel and toolbar pop-up.
(() => {
  'use strict';
  const HM = globalThis.HM, HC = globalThis.HandmarkControls, HP = globalThis.HMPages;
  const MODE = document.body.dataset.mode; // 'side' | 'popup'
  const $ = (id) => document.getElementById(id);
  let settings = { ...HM.DEFAULTS };
  let tabId = null;
  let status = null;

  $('settingsBtn').appendChild(HC.icon(document, 'settings'));
  $('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  if (MODE === 'popup') { $('savedSec').hidden = true; $('keysSec').hidden = true; }

  const style = document.createElement('style');
  style.textContent = HC.CSS;
  document.head.appendChild(style);
  const controls = HC.build(document, {
    layout: 'vertical',
    onSetting: (p) => { settings = HM.sanitizeSettings({ ...settings, ...p }); controls.update(settings); chrome.storage.local.set({ settings }); },
    onAction: (name) => action(name),
    onOpenSettings: () => chrome.runtime.openOptionsPage(),
  });
  $('controls').appendChild(controls.el);

  async function sendTab(msg) {
    if (tabId === null) return null;
    try { return await chrome.tabs.sendMessage(tabId, msg); } catch { return null; }
  }

  async function action(name) {
    if (name === 'shot-visible' || name === 'shot-full') {
      setMsg('Taking screenshot…');
      const r = await chrome.runtime.sendMessage({ type: 'hm:capture', mode: name === 'shot-full' ? 'full' : 'visible', tabId });
      setMsg(r && r.error ? r.error : r && r.ok ? 'Saved to Downloads/Handmark' : 'Screenshot failed');
      return;
    }
    status = await sendTab({ type: 'hm:action', name });
    if (!status) setMsg('Start Handmark on this page first');
    render();
  }

  function setMsg(t) {
    const el = MODE === 'popup' ? $('sub') : $('dataMsg');
    el.textContent = t;
  }

  async function refresh() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab ? tab.id : null;
    status = await sendTab({ type: 'hm:status' });
    render();
  }

  function render() {
    const s = status;
    const where = $('where'), sub = $('sub');
    where.replaceChildren();
    const dot = document.createElement('span'); dot.className = 'dot' + (s && s.active ? ' on' : '');
    where.appendChild(dot);
    if (!s) {
      where.appendChild(document.createTextNode('Not running on this page'));
      sub.textContent = 'Click the Handmark icon or press Alt+Shift+D on the page. Chrome pages, the Web Store and PDFs can’t be drawn on.';
      $('startBtn').hidden = false; $('drawBtn').hidden = true; $('keepRow').hidden = true; $('widthWarn').hidden = true;
      return;
    }
    let host = '';
    try { host = new URL(s.url).host; } catch {}
    where.appendChild(document.createTextNode(s.title || host || 'This page'));
    where.title = s.url || '';
    sub.textContent = s.active
      ? `${s.drawing ? 'Drawing' : 'Drawing off'} · ${s.count} saved mark${s.count === 1 ? '' : 's'}${s.incognito ? ' · incognito: nothing is saved' : ''}`
      : `${s.count} saved mark${s.count === 1 ? '' : 's'} · not active`;
    $('startBtn').hidden = s.active;
    $('drawBtn').hidden = !s.active;
    $('drawBtn').textContent = s.drawing ? 'Turn drawing off (F)' : 'Turn drawing on (F)';
    $('keepRow').hidden = !!s.incognito || !s.url;
    $('keep').checked = s.keep;
    $('widthWarn').hidden = !s.mismatch;
    $('widthMsg').textContent = `Drawn in a ${s.vwSaved}px wide window; this one is ${s.vw}px. Marks may not line up with the text.`;
  }

  $('startBtn').addEventListener('click', async () => {
    const r = await chrome.runtime.sendMessage({ type: 'hm:start', tabId });
    if (r && r.error) $('sub').textContent = r.error; else { status = r; render(); }
  });
  $('drawBtn').addEventListener('click', async () => { status = await sendTab({ type: 'hm:toggle-drawing' }); render(); });
  $('keep').addEventListener('change', async (e) => { status = await sendTab({ type: 'hm:set-keep', keep: e.target.checked }); render(); renderSaved(); });
  $('matchBtn').addEventListener('click', () => {
    if (status) chrome.runtime.sendMessage({ type: 'hm:resize', tabId, width: status.outerWidth + (status.vwSaved - status.vw) });
  });

  // saved pages
  let savedTimer = 0;
  function renderSaved() {
    if (MODE === 'popup') return;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => HP.renderList($('saved'), { limit: 30 }), 150);
  }
  $('exportBtn').addEventListener('click', async () => { const n = await HP.exportAll(); setMsg(`Exported ${n} page${n === 1 ? '' : 's'}`); });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const r = await HP.importFile(e.target.files[0]); e.target.value = '';
    setMsg(r.error ? r.error : `Imported ${r.added} new, ${r.replaced} replaced${r.skipped ? `, ${r.skipped} skipped` : ''}`);
    renderSaved();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) { settings = HM.sanitizeSettings(changes.settings.newValue); controls.update(settings); }
    if (Object.keys(changes).some((k) => k.startsWith(HM.KEY_PREFIX))) renderSaved();
  });
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== 'hm:changed') return;
    if (sender.tab && sender.tab.id === tabId) refresh();
  });
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.status === 'complete') setTimeout(refresh, 300); });

  (async () => {
    const got = await chrome.storage.local.get('settings');
    settings = HM.sanitizeSettings(got.settings);
    controls.update(settings);
    await refresh();
    // The pop-up opens from the toolbar icon, which gives Handmark access to this tab: start right away.
    if (MODE === 'popup' && (!status || !status.active)) {
      const r = await chrome.runtime.sendMessage({ type: 'hm:start', tabId });
      if (r && !r.error) status = r; else if (r && r.error) $('sub').textContent = r.error;
      render();
    }
    renderSaved();
  })();
})();
