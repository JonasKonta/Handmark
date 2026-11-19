// Handmark: settings page.
(() => {
  'use strict';
  const HM = globalThis.HM, HP = globalThis.HMPages;
  const $ = (id) => document.getElementById(id);
  let settings = { ...HM.DEFAULTS };
  const ALL = { origins: ['<all_urls>'] };

  function save(p) { settings = HM.sanitizeSettings({ ...settings, ...p }); chrome.storage.local.set({ settings }); show(); }
  function show() {
    for (const r of document.querySelectorAll('input[name=layout]')) r.checked = r.value === settings.layout;
    $('fadeMs').value = String(settings.fadeMs);
    $('keepDefault').checked = settings.keepDefault;
    for (const r of document.querySelectorAll('input[name=afterShot]')) r.checked = r.value === settings.afterShot;
  }
  for (const r of document.querySelectorAll('input[name=afterShot]')) r.addEventListener('change', () => save({ afterShot: r.value }));
  for (const r of document.querySelectorAll('input[name=layout]')) r.addEventListener('change', () => save({ layout: r.value }));
  $('fadeMs').addEventListener('change', (e) => save({ fadeMs: Number(e.target.value) }));
  $('keepDefault').addEventListener('change', (e) => save({ keepDefault: e.target.checked }));
  $('shortcutsBtn').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

  async function showAuto() {
    const on = await chrome.permissions.contains(ALL);
    $('auto').checked = on; $('autoLabel').textContent = on ? 'On' : 'Off';
  }
  $('auto').addEventListener('change', async (e) => {
    if (e.target.checked) await chrome.permissions.request(ALL).catch(() => false);
    else await chrome.permissions.remove(ALL).catch(() => false);
    await chrome.runtime.sendMessage({ type: 'hm:sync-permissions' });
    showAuto();
  });

  const msg = (t) => { $('dataMsg').textContent = t; };
  const list = () => HP.renderList($('saved'), { filter: $('search').value.trim() });
  $('search').addEventListener('input', list);
  $('exportBtn').addEventListener('click', async () => { const n = await HP.exportAll(); msg(`Exported ${n} page${n === 1 ? '' : 's'}.`); });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const r = await HP.importFile(e.target.files[0]); e.target.value = '';
    msg(r.error ? r.error : `Imported ${r.added} new page${r.added === 1 ? '' : 's'}, replaced ${r.replaced}${r.skipped ? `, skipped ${r.skipped} invalid` : ''}.`);
    list();
  });
  let armed = false, timer = 0;
  $('deleteAllBtn').addEventListener('click', async () => {
    if (!armed) { armed = true; $('deleteAllBtn').textContent = 'Click again to delete everything'; timer = setTimeout(() => { armed = false; $('deleteAllBtn').textContent = 'Delete all drawings'; }, 4000); return; }
    clearTimeout(timer); armed = false; $('deleteAllBtn').textContent = 'Delete all drawings';
    const n = await HP.deleteAll(); msg(`Deleted drawings on ${n} page${n === 1 ? '' : 's'}.`); list();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if (c.settings) { settings = HM.sanitizeSettings(c.settings.newValue); show(); }
    if (Object.keys(c).some((k) => k.startsWith(HM.KEY_PREFIX))) list();
  });

  (async () => {
    const got = await chrome.storage.local.get('settings');
    settings = HM.sanitizeSettings(got.settings); show(); showAuto(); list();
  })();
})();
