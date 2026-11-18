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

  // screenshots
  const shots = await sw.evaluate(new Function(`return (async () => { ${activeTab}
    await startOn(t.id, 'hm:activate'); return [await capture(t, 'visible'), await capture(t, 'full')]; })()`));
  await wait(1500);
  const dls = await sw.evaluate(() => chrome.downloads.search({ state: 'complete' }));
  check('visible and full-page screenshots save', shots.every((r) => r && r.ok) && dls.length >= 2, JSON.stringify(shots));

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
