// Generates the Chrome Web Store images from the real extension:
//   store/screenshots/1-draw-on-any-page.png   1280×800
//   store/screenshots/2-side-panel.png         1280×800
//   store/screenshots/3-saved-pages.png        1280×800
//   store/promo-small-440x280.png              440×280
//   store/promo-marquee-1400x560.png           1400×560
// Run: npm install && npx playwright install chromium && npm run store-assets
import { chromium } from 'playwright';
import { readFile, cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'store');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const html = await readFile(join(OUT, 'demo-page.html'));
// the demo article is served under a friendly address by intercepting requests
const BASE = 'https://thereadingroom.example';

const tmp = await mkdtemp(join(tmpdir(), 'handmark-store-'));
const EXT = join(tmp, 'extension');
await cp(join(ROOT, 'extension'), EXT, { recursive: true });
const m = JSON.parse(await readFile(join(EXT, 'manifest.json'), 'utf8'));
m.host_permissions = ['<all_urls>'];
await writeFile(join(EXT, 'manifest.json'), JSON.stringify(m));

const ctx = await chromium.launchPersistentContext(join(tmp, 'profile'), {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
try {
  await ctx.route(BASE + '/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  const setSettings = (s) => sw.evaluate(async (s) => { const cur = (await chrome.storage.local.get('settings')).settings; await chrome.storage.local.set({ settings: { ...cur, ...s } }); }, s);
  const start = () => sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return startOn(t.id, 'hm:activate'); });

  const draw = async (page, pts, hold = 0) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) { await page.mouse.move(x, y, { steps: 3 }); await wait(5); } if (hold) await wait(hold); await page.mouse.up(); };
  const ellipse = (cx, cy, rx, ry) => { const p = []; for (let i = 0; i <= 46; i++) { const a = (i / 40) * Math.PI * 2 - 1.3; p.push([cx + Math.cos(a) * rx * (1 + (i > 40 ? 0.04 : 0)), cy + Math.sin(a) * ry]); } return p; };
  // x = left edge of the article column, so the same marks fit at any window width
  const mark = async (page, x) => {
    await page.keyboard.press('3');
    await draw(page, ellipse(x + 420, 120, 146, 36));                       // circle "clear writers"
    await page.keyboard.press('2'); await page.keyboard.press('h');
    await draw(page, [[x + 2, 632], [x + 140, 633], [x + 272, 631], [x + 300, 631], [x + 300, 631]]);        // highlight "2. Use short sentences"
    await page.keyboard.press('a'); await page.keyboard.press('3');
    await draw(page, [[x + 520, 720], [x + 470, 700], [x + 400, 668], [x + 318, 644]]); // arrow to the highlight
    await page.keyboard.press('t'); await page.mouse.click(x + 470, 768); await page.keyboard.type('try this one!'); await page.keyboard.press('Enter');
    await page.keyboard.press('b'); await wait(700);
  };

  // 1: floating bar over an article with marks (1280 wide)
  await setSettings({ layout: 'floating' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/clear-writing`); await wait(800);
  await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return startOn(t.id, 'hm:toggle-session'); });
  await wait(500);
  await mark(page, 280);
  await page.mouse.move(1200, 780);
  await page.screenshot({ path: join(OUT, 'screenshots', '1-draw-on-any-page.png') });

  // 2: side panel next to the page (composited: page 960 wide + panel 320 wide), drawn at 960 so widths match
  await setSettings({ layout: 'side' });
  const page2 = await ctx.newPage(); await page2.setViewportSize({ width: 960, height: 800 });
  await page2.goto(`${BASE}/clear-writing-habits`); await wait(800);
  await start(); await wait(500);
  await mark(page2, 120);
  await page2.mouse.move(940, 780);
  const pageShot = await page2.screenshot();
  const panel = await ctx.newPage(); await panel.setViewportSize({ width: 320, height: 800 });
  await panel.goto(`chrome-extension://${id}/panel.html`); await wait(300);
  await page2.bringToFront(); await wait(900);
  const panelShot = await panel.screenshot();
  const comp = await ctx.newPage(); await comp.setViewportSize({ width: 1280, height: 800 });
  await comp.setContent(`<body style="margin:0;display:flex;background:#1b1a18"><img src="data:image/png;base64,${pageShot.toString('base64')}" width="960" height="800"><div style="width:1px;background:#3a3833"></div><img src="data:image/png;base64,${panelShot.toString('base64')}" width="319" height="800" style="object-fit:cover;object-position:left top"></body>`);
  await wait(200); await comp.screenshot({ path: join(OUT, 'screenshots', '2-side-panel.png') });

  // 3: settings page with saved drawings
  const opts = await ctx.newPage(); await opts.setViewportSize({ width: 1280, height: 800 });
  await opts.goto(`chrome-extension://${id}/options.html`); await wait(700);
  await opts.evaluate(() => window.scrollTo(0, document.querySelector('#saved').closest('.card').offsetTop - 300));
  await wait(200); await opts.screenshot({ path: join(OUT, 'screenshots', '3-saved-pages.png') });

  // promo tiles
  const icon = (await readFile(join(ROOT, 'extension', 'icons', 'icon-128.png'))).toString('base64');
  const tile = async (w, h, file, big) => {
    const p = await ctx.newPage(); await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<body style="margin:0;width:${w}px;height:${h}px;background:#141312;display:flex;align-items:center;gap:${big ? 48 : 22}px;padding:0 ${big ? 110 : 28}px;box-sizing:border-box;font-family:Georgia,serif;color:#F6F0E2">
      <img src="data:image/png;base64,${icon}" width="${big ? 200 : 80}" height="${big ? 200 : 80}">
      <div><div style="font:italic 400 ${big ? 104 : 50}px/1 Georgia,serif">Handmark</div>
      <div style="font:400 ${big ? 34 : 15}px/1.3 system-ui,sans-serif;white-space:nowrap;color:#d9d2c2;margin-top:${big ? 16 : 8}px">Draw on any webpage like it's paper.</div>
      <svg width="${big ? 520 : 250}" height="${big ? 30 : 16}" viewBox="0 0 400 24" preserveAspectRatio="none" style="margin-top:${big ? 14 : 6}px;display:block"><path d="M6 16 C 110 9, 240 13, 394 7" fill="none" stroke="#FFC702" stroke-width="7" stroke-linecap="round"/></svg></div></body>`);
    await wait(200); await p.screenshot({ path: join(OUT, file) }); await p.close();
  };
  await tile(440, 280, 'promo-small-440x280.png', false);
  await tile(1400, 560, 'promo-marquee-1400x560.png', true);
  console.log('Store assets written to', OUT);
} finally {
  await ctx.close(); await rm(tmp, { recursive: true, force: true });
}
