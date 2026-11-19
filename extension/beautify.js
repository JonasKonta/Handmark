// Handmark: the look of styled screenshots and recordings.
// One renderer, used by the editor preview, the PNG export and the styled video export.
// Draws: a background, then the capture as a card with rounded corners, a soft shadow
// and an optional window frame, centred and padded, optionally expanded to an aspect ratio.
(() => {
  'use strict';
  if (globalThis.HMStyle) return;

  const BACKGROUNDS = Object.freeze([
    { id: 'sunrise', name: 'Handmark', stops: ['#FFC702', '#FA4101'] },
    { id: 'peach', name: 'Peach', stops: ['#FFD3A5', '#FD6585'] },
    { id: 'candy', name: 'Candy', stops: ['#FBC2EB', '#A6C1EE'] },
    { id: 'ocean', name: 'Ocean', stops: ['#2F6BFF', '#22D3EE'] },
    { id: 'grape', name: 'Grape', stops: ['#7F5AF0', '#E15FED'] },
    { id: 'mint', name: 'Mint', stops: ['#A8FF78', '#78FFD6'] },
    { id: 'forest', name: 'Forest', stops: ['#134E5E', '#71B280'] },
    { id: 'dusk', name: 'Dusk', stops: ['#141E30', '#3B5B85'] },
    { id: 'paper', name: 'Paper', stops: ['#F6F0E2', '#E2D5B8'] },
    { id: 'ink', name: 'Ink', stops: ['#141312', '#3A3833'] },
  ].map(Object.freeze));
  const FRAMES = Object.freeze([
    ['none', 'None'], ['browser-light', 'Browser · light'], ['browser-dark', 'Browser · dark'],
    ['mac-light', 'Window · light'], ['mac-dark', 'Window · dark'],
  ]);
  const RATIOS = Object.freeze([['auto', 'Auto'], ['16:9', '16:9'], ['4:3', '4:3'], ['1:1', '1:1'], ['4:5', '4:5'], ['9:16', '9:16']]);
  const DEFAULT_STYLE = Object.freeze({ bg: 'sunrise', custom: '#2F6BFF', pad: 45, radius: 12, shadow: 55, frame: 'browser-dark', ratio: 'auto' });
  const HEX = /^#[0-9a-fA-F]{6}$/;

  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
  function sanitizeStyle(s) {
    const o = { ...DEFAULT_STYLE };
    if (!s || typeof s !== 'object') return o;
    if (s.bg === 'none' || s.bg === 'custom' || BACKGROUNDS.some((b) => b.id === s.bg)) o.bg = s.bg;
    if (typeof s.custom === 'string' && HEX.test(s.custom)) o.custom = s.custom.toUpperCase();
    o.pad = num(s.pad, 0, 100, o.pad);
    o.radius = num(s.radius, 0, 40, o.radius);
    o.shadow = num(s.shadow, 0, 100, o.shadow);
    if (FRAMES.some(([k]) => k === s.frame)) o.frame = s.frame;
    if (RATIOS.some(([k]) => k === s.ratio)) o.ratio = s.ratio;
    return o;
  }

  // Sizes scale with the capture, so a small area and a 4K window get the same proportions.
  function layout(sw, sh, style, even) {
    const u = Math.max(0.4, Math.max(sw, Math.min(sh, sw * 1.4)) / 1000);
    const bar = style.frame.startsWith('browser') ? Math.round(44 * u) : style.frame.startsWith('mac') ? Math.round(34 * u) : 0;
    const pad = Math.round((style.pad / 100) * 140 * u);
    const cw = sw, ch = sh + bar;
    let W = cw + pad * 2, H = ch + pad * 2;
    if (style.ratio !== 'auto') {
      const [a, b] = style.ratio.split(':').map(Number), r = a / b;
      if (W / H < r) W = Math.round(H * r); else H = Math.round(W / r);
    }
    if (even) { W += W % 2; H += H % 2; }
    return { W, H, u, bar, pad, x: Math.round((W - cw) / 2), y: Math.round((H - ch) / 2), cw, ch, r: Math.min(style.radius * 1.5 * u, cw / 2, ch / 2) };
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  }

  function paintBackground(g, L, style) {
    g.clearRect(0, 0, L.W, L.H);
    if (style.bg === 'none') return;
    if (style.bg === 'custom') { g.fillStyle = style.custom; g.fillRect(0, 0, L.W, L.H); return; }
    const b = BACKGROUNDS.find((x) => x.id === style.bg) || BACKGROUNDS[0];
    const lg = g.createLinearGradient(0, 0, L.W, L.H);
    b.stops.forEach((c, i) => lg.addColorStop(i / (b.stops.length - 1), c));
    g.fillStyle = lg; g.fillRect(0, 0, L.W, L.H);
    // a soft light from the top left gives the flat gradient some depth
    const rg = g.createRadialGradient(L.W * 0.15, L.H * 0.1, 0, L.W * 0.15, L.H * 0.1, Math.max(L.W, L.H) * 0.8);
    rg.addColorStop(0, 'rgba(255,255,255,0.28)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, L.W, L.H);
  }

  function paintFrame(g, L, style, host) {
    if (!L.bar) return;
    const dark = style.frame.endsWith('dark'), u = L.u;
    g.fillStyle = dark ? '#262522' : '#EDEBE6';
    g.fillRect(L.x, L.y, L.cw, L.bar);
    g.fillStyle = dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.08)';
    g.fillRect(L.x, L.y + L.bar - Math.max(1, u), L.cw, Math.max(1, u));
    const cy = L.y + L.bar / 2, r = 6 * u;
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(L.x + 20 * u + i * 20 * u, cy, r, 0, Math.PI * 2); g.fill(); });
    if (style.frame.startsWith('browser')) {
      const w = Math.min(L.cw - 180 * u, 560 * u), h = 26 * u;
      if (w > 60 * u) {
        const x = L.x + (L.cw - w) / 2;
        g.fillStyle = dark ? '#363430' : '#FFFFFF';
        rr(g, x, cy - h / 2, w, h, h / 2); g.fill();
        if (host) {
          g.fillStyle = dark ? '#B9B3A7' : '#5D5A54';
          g.font = `500 ${Math.round(12.5 * u)}px system-ui,-apple-system,"Segoe UI",sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          let t = host; while (t.length > 3 && g.measureText(t).width > w - 30 * u) t = t.slice(0, -2);
          g.fillText(t === host ? t : t + '…', x + w / 2, cy + 0.5 * u);
        }
      }
    }
  }

  // src: an image, bitmap, canvas or video; sw/sh: its pixel size; meta.host: shown in the browser frame
  function draw(g, src, sw, sh, style, meta = {}) {
    const L = layout(sw, sh, style, meta.even);
    if (g.canvas.width !== L.W || g.canvas.height !== L.H) { g.canvas.width = L.W; g.canvas.height = L.H; }
    paintBackground(g, L, style);
    if (style.shadow > 0 && (L.pad > 0 || style.ratio !== 'auto')) {
      const k = style.shadow / 100;
      g.save();
      g.shadowColor = `rgba(0,0,0,${(0.18 + 0.4 * k).toFixed(3)})`;
      g.shadowBlur = 90 * k * L.u; g.shadowOffsetY = 30 * k * L.u;
      rr(g, L.x, L.y, L.cw, L.ch, L.r); g.fillStyle = '#000'; g.fill();
      g.restore();
    }
    g.save();
    rr(g, L.x, L.y, L.cw, L.ch, L.r); g.clip();
    paintFrame(g, L, style, meta.host);
    g.drawImage(src, 0, 0, sw, sh, L.x, L.y + L.bar, sw, sh);
    g.restore();
    if (L.bar || L.pad) {
      g.save(); rr(g, L.x + 0.5, L.y + 0.5, L.cw - 1, L.ch - 1, L.r);
      g.strokeStyle = style.frame.endsWith('dark') ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)'; g.lineWidth = Math.max(1, L.u); g.stroke(); g.restore();
    }
    return L;
  }

  globalThis.HMStyle = Object.freeze({ BACKGROUNDS, FRAMES, RATIOS, DEFAULT_STYLE, sanitizeStyle, layout, draw });
})();
