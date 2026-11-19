// End-to-end tests: loads the real extension into Chromium and checks drawing,
// saving, restoring, undo, fade, import validation, site isolation and screenshots.
//
//   npm install
//   npx playwright install chromium
//   npm test
//
// The test copies the extension to a temp folder and grants it access to all sites,
// because a test cannot click the toolbar icon to give it access to a tab.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'tests', 'fixtures');
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// local web server for the test page
const html = await readFile(join(FIX, 'article.html'));
const server = createServer((req, res) => {
  if (req.url.startsWith('/favicon')) { res.writeHead(204); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// test copy of the extension with host access
const tmp = await mkdtemp(join(tmpdir(), 'handmark-'));
const EXT = join(tmp, 'extension');
await cp(join(ROOT, 'extension'), EXT, { recursive: true });
const manifest = JSON.parse(await readFile(join(EXT, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
await writeFile(join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const ctx = await chromium.launchPersistentContext(join(tmp, 'profile'), {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, acceptDownloads: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const activeTab = 'const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });';
  const status = () => sw.evaluate(new Function(`return (async () => { ${activeTab} return chrome.tabs.sendMessage(t.id, { type: 'hm:status' }); })()`));
  const store = () => sw.evaluate(() => chrome.storage.local.get(null));

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/?utm_source=social&x=1`);
  await wait(800);

  const started = await sw.evaluate(new Function(`return (async () => { ${activeTab} return startOn(t.id, 'hm:activate'); })()`));
  check('starts on a page', started && started.active === true);

  const draw = async (pts, hold = 0) => {
    await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
    for (const [x, y] of pts.slice(1)) { await page.mouse.move(x, y, { steps: 4 }); await wait(6); }
    if (hold) await wait(hold);
    await page.mouse.up();
  };
  const loop = []; for (let i = 0; i <= 44; i++) { const a = (i / 40) * Math.PI * 2 - 1.2; loop.push([640 + Math.cos(a) * 200, 120 + Math.sin(a) * 40]); }
  await draw(loop);
  await page.keyboard.press('a'); await draw([[900, 450], [880, 400], [840, 360], [780, 330]]);
  await page.keyboard.press('h'); await draw([[300, 300], [500, 302], [700, 299]]);
  await page.keyboard.press('p'); await draw([[80, 600], [200, 606], [320, 596], [420, 604]], 700); // hold to straighten
  await page.keyboard.press('t'); await page.mouse.click(900, 520); await page.keyboard.type('Café ąčęėįšųūž!'); await page.keyboard.press('Enter');
  await page.keyboard.press('b');
  await wait(900);

  let s = await store();
  const keys = Object.keys(s).filter((k) => k.startsWith('p:'));
  check('saves under the clean address (tracking parameter removed)', keys.length === 1 && keys[0] === `p:${BASE}/?x=1`, keys.join(', '));
  check('saves all 5 marks', keys.length === 1 && s[keys[0]].strokes.length === 5, String(keys.length && s[keys[0]].strokes.length));
  check('note text keeps accented letters', keys.length === 1 && s[keys[0]].strokes.some((x) => x.v === 'Café ąčęėįšųūž!'));

  await page.evaluate(() => { for (const k of ['c', 'f']) window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
  await wait(300);
  let st = await status();
  check('ignores fake key presses from the page', st.count === 5 && st.drawing === true);

  await page.keyboard.press('Control+z'); await wait(600);
  const afterUndo = (await status()).count;
  await page.keyboard.press('Control+Shift+z'); await wait(600);
  const afterRedo = (await status()).count;
  check('undo and redo', afterUndo === 4 && afterRedo === 5, `${afterUndo} → ${afterRedo}`);

  // quick key presses must all stick (size, then tool), even though settings round-trip through the service worker
  await page.keyboard.press('2'); await page.keyboard.press('h'); await wait(500);
  const quick = await sw.evaluate(() => chrome.storage.local.get('settings'));
  check('quick key presses are not lost', quick.settings.size === 2 && quick.settings.tool === 'hl', JSON.stringify(quick.settings));
  await page.keyboard.press('b');
  await page.keyboard.press('3'); await page.keyboard.press('g');
  await draw([[200, 700], [500, 710], [700, 690]]);
  await wait(800);
  st = await status();
  check('fading marks are not saved', st.count === 5, String(st.count));
  await page.keyboard.press('g');

  await page.keyboard.press('v');
  await page.click('#field'); await page.keyboard.type('fbc');
  st = await status();
  check('typing in a page text field does not trigger shortcuts', (await page.inputValue('#field')) === 'fbc' && st.count === 5 && st.active);

  await page.goto(`${BASE}/?fbclid=abc&x=1`); await wait(1500);
  st = await status();
  check('restores drawings after reopening the page', st.count === 5 && st.active === false, String(st.count));

  // import a crafted backup through the settings page
  const opts = await ctx.newPage();
  const dialogs = [];
  opts.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await opts.goto(`chrome-extension://${extId}/options.html`); await wait(500);
  await opts.setInputFiles('#importFile', join(FIX, 'malicious-backup.json')); await wait(800);
  s = await store();
  check('import rejects javascript: addresses', !Object.keys(s).some((k) => k.includes('javascript')));
  const evil = s['p:https://evil.example/a'];
  check('import drops invalid marks and unknown fields', evil && evil.strokes.length === 2 && !('extra' in evil.strokes[1]));
  check('import cleans tracking parameters from keys', !!s['p:https://ok.example/b']);
  check('import cannot pollute prototypes', (await sw.evaluate(() => ({}).polluted)) === undefined && (await opts.evaluate(() => ({}).polluted)) === undefined);
  check('page titles are shown as text, never HTML', (await opts.evaluate(() => document.querySelectorAll('#saved img').length)) === 0 && dialogs.length === 0);

  // a page must not reach another site's drawings
  await page.bringToFront(); await wait(300);
  const cross = await sw.evaluate(new Function(`return (async () => { ${activeTab}
    const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: async () => {
      const read = await chrome.runtime.sendMessage({ type: 'hm:load-page', url: 'https://ok.example/b' });
      const write = await chrome.runtime.sendMessage({ type: 'hm:save-page', url: 'https://ok.example/b', record: { strokes: [] } });
      let direct = 'allowed'; try { await chrome.storage.local.get(null); } catch { direct = 'blocked'; }
      return { read, write, direct };
    } });
    return r.result; })()`));
  check('a page cannot read another site\'s drawings', cross.read === null);
  check('a page cannot write another site\'s drawings', cross.write && cross.write.error === 'not allowed');
  check('a page cannot read extension storage directly', cross.direct === 'blocked');

  // screenshots saved straight away (Settings → After a screenshot → Save straight away)
  await sw.evaluate(() => chrome.storage.local.set({ settings: { ...HM.DEFAULTS, afterShot: 'save' } }));
  await wait(300);
  const shots = await sw.evaluate(new Function(`return (async () => { ${activeTab}
    await startOn(t.id, 'hm:activate'); return [await capture(t, 'visible'), await capture(t, 'full'), await capture(t, 'area', { rect: { x: 100, y: 100, w: 300, h: 200 } })]; })()`));
  await wait(1500);
  const dls = await sw.evaluate(() => chrome.downloads.search({ state: 'complete' }));
  check('window, full-page and area screenshots save', shots.every((r) => r && r.saved) && dls.length >= 3, JSON.stringify(shots));
  const areaSize = await sw.evaluate(async () => {
    const all = await chrome.downloads.search({ state: 'complete', orderBy: ['startTime'] });
    return all.slice(-3).map((d) => d.fileSize); // window, full page, area
  });
  check('area screenshot is cropped', areaSize[2] > 0 && areaSize[2] < areaSize[0] && areaSize[0] < areaSize[1], JSON.stringify(areaSize));

  // screenshots open in the editor (the default)
  await sw.evaluate(() => chrome.storage.local.set({ settings: { ...HM.DEFAULTS } }));
  await page.bringToFront(); await wait(2200);
  const editorOpened = ctx.waitForEvent('page', { predicate: (p) => p.url().includes('/editor.html#'), timeout: 10000 });
  // choose an area by dragging on the page, like a user would
  await page.keyboard.press('Control+Shift+E'); await wait(200);
  await page.mouse.move(200, 150); await page.mouse.down(); await page.mouse.move(500, 350, { steps: 6 }); await page.mouse.up();
  const ed = await editorOpened;
  await ed.waitForLoadState(); await wait(800);
  const edInfo = await ed.evaluate(() => { const c = document.getElementById('out'); return { w: c.width, h: c.height, kind: document.getElementById('kind').textContent }; });
  check('area selection opens the editor with a styled image', edInfo.kind === 'Area' && edInfo.w > 300 && edInfo.h > 200, JSON.stringify(edInfo));
  await ed.click('#frames button:nth-child(1)'); await ed.click('#ratios button:nth-child(4)'); await wait(300);
  const sq = await ed.evaluate(() => { const c = document.getElementById('out'); return [c.width, c.height]; });
  const saved = await sw.evaluate(() => chrome.storage.local.get('shotStyle'));
  check('editor applies and remembers the style', sq[0] === sq[1] && saved.shotStyle && saved.shotStyle.ratio === '1:1' && saved.shotStyle.frame === 'none', JSON.stringify(sq));
  // your own gradient, your own background image, inset border
  await ed.click('#bgs [data-v="gradient"]'); await wait(300);
  const gradOk = await ed.evaluate(() => !document.getElementById('gradPanel').hidden);
  await ed.focus('#gAngle'); await ed.keyboard.press('Home'); await wait(400);
  let st2 = (await sw.evaluate(() => chrome.storage.local.get('shotStyle'))).shotStyle;
  check('custom gradient: panel opens and angle is saved', gradOk && st2.bg === 'gradient' && st2.gAngle === 0, JSON.stringify(st2));
  await ed.setInputFiles('#bgFile', join(ROOT, 'extension', 'icons', 'icon-128.png')); await wait(1200);
  const bgStored = await sw.evaluate(() => chrome.storage.local.get('shotBgImage'));
  st2 = (await sw.evaluate(() => chrome.storage.local.get('shotStyle'))).shotStyle;
  const imgPanel = await ed.evaluate(() => !document.getElementById('imgPanel').hidden);
  check('own background image is imported and used', bgStored.shotBgImage && /^data:image\/webp/.test(bgStored.shotBgImage.data) && st2.bg === 'image' && imgPanel, st2.bg);
  const w0 = await ed.evaluate(() => document.getElementById('out').width);
  await ed.click('#ratios button:nth-child(1)');
  const w1 = await ed.evaluate(() => document.getElementById('out').width);
  await ed.focus('#inset'); await ed.keyboard.press('End'); await wait(200);
  await ed.click('#insets [data-v="glass"]');
  await ed.focus('#innerRadius'); await ed.keyboard.press('End'); await wait(500);
  const w2 = await ed.evaluate(() => document.getElementById('out').width);
  st2 = (await sw.evaluate(() => chrome.storage.local.get('shotStyle'))).shotStyle;
  check('inset border widens the card and keeps its own corners', w2 > w1 && st2.inset === 100 && st2.insetColor === 'glass' && st2.innerRadius === 40, JSON.stringify([w0, w1, w2, st2.inset, st2.insetColor, st2.innerRadius]));
  await ed.click('#bgRemoveBtn'); await wait(500);
  const bgGone = await sw.evaluate(() => chrome.storage.local.get('shotBgImage'));
  check('own background image can be removed', !bgGone.shotBgImage);
  const before = (await sw.evaluate(() => chrome.downloads.search({}))).length;
  await ed.click('#saveBtn'); await wait(1500);
  const after = await sw.evaluate(() => chrome.downloads.search({}));
  check('editor downloads the styled PNG', after.length === before + 1, JSON.stringify(after.map((d) => [d.filename, d.state, d.error])));
  await ed.close();

  // recording an area: Chrome only allows tab capture after the toolbar icon or shortcut was used
  // on the tab, which a test cannot do, so this checks the message, then the recorder on its own.
  await page.bringToFront(); await wait(2200);
  await page.keyboard.press('Control+Shift+K'); await wait(200);
  await page.mouse.move(100, 100); await page.mouse.down(); await page.mouse.move(500, 400, { steps: 6 }); await page.mouse.up();
  await wait(1200);
  const recSt = await sw.evaluate(() => recState());
  const recErr = await sw.evaluate(new Function(`return (async () => { ${activeTab} await new Promise((r) => setTimeout(r, 2100));
    return recordStart(t, { x: 10, y: 10, w: 200, h: 100 }, { vw: 1280, vh: 800, dpr: 1 }); })()`));
  check('recording without an icon click explains what to do', !recSt.recording && /Handmark icon/.test(recErr.error || ''), JSON.stringify(recErr));

  // the recorder: crops a moving test video to the area, encodes it, and the editor opens it
  const rp = await ctx.newPage();
  await rp.addInitScript(() => {
    if (!location.pathname.endsWith('/offscreen.html')) return;
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 800;
      const g = c.getContext('2d'); let f = 0;
      setInterval(() => { f++; g.fillStyle = '#223'; g.fillRect(0, 0, 1280, 800); g.fillStyle = '#FFC702'; g.fillRect(100 + (f * 7) % 300, 120, 80, 80); }, 33);
      return c.captureStream(30);
    };
  });
  await rp.goto(`chrome-extension://${extId}/offscreen.html`); await wait(500);
  const recOpened = ctx.waitForEvent('page', { predicate: (p) => p.url().includes('/editor.html#'), timeout: 20000 }).catch(() => null);
  const recStarted = await sw.evaluate(() => chrome.runtime.sendMessage({ type: 'hm:off-start', streamId: 'test', rect: { x: 100, y: 100, w: 400, h: 240 }, view: { vw: 1280, vh: 800, dpr: 1 }, title: 'Test', url: 'https://example.com/x' }));
  await wait(2500);
  await sw.evaluate(() => chrome.runtime.sendMessage({ type: 'hm:off-stop' }));
  const rv = await recOpened;
  check('recorder crops to the area', recStarted && recStarted.ok && recStarted.width === 400 && recStarted.height === 240, JSON.stringify(recStarted));
  if (rv) {
    await rv.waitForLoadState(); await wait(2500);
    const v = await rv.evaluate(() => ({ kind: document.getElementById('kind').textContent, w: document.getElementById('out').width, gone: !document.getElementById('gone').hidden, dims: document.getElementById('dims').textContent, save: document.getElementById('saveBtn').textContent }));
    check('recording opens in the editor as a styled video', v.kind === 'Recording' && v.w > 400 && !v.gone && /video/.test(v.save), JSON.stringify(v));
    const n0 = (await sw.evaluate(() => chrome.downloads.search({}))).length;
    await rv.click('#saveBtn');
    await rv.waitForFunction(() => !document.getElementById('busy').hidden, null, { timeout: 5000 }).catch(() => {});
    await rv.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 20000 }).catch(() => {});
    await wait(1500);
    const dl = await sw.evaluate(() => chrome.downloads.search({ orderBy: ['-startTime'] }));
    check('styled video exports', dl.length === n0 + 1 && dl[0].state === 'complete' && /^video\//.test(dl[0].mime) && dl[0].fileSize > 1000, dl[0] && JSON.stringify([dl[0].mime, dl[0].fileSize]));
    await rv.close();
  } else check('recording opens in the editor as a styled video', false, 'no editor tab');
  await rp.close();

  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
} catch (e) {
  console.error(e); failures++;
} finally {
  await ctx.close();
  server.close();
  await rm(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
