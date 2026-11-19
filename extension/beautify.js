// Handmark: the look of styled screenshots and recordings.
// One renderer, used by the editor preview, the PNG export and the styled video export.
//
// Layers, from the back:
//   1. background: a preset gradient, a solid colour, your own gradient, your own image, or nothing
//   2. inset: an optional border (mat) around the capture, white, black, frosted glass or any colour,
//      with its own outer corners
//   3. the window: an optional browser or window frame, then the capture, with its own corners
// Everything is centred and padded, and the canvas can be expanded to an aspect ratio.
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
  const INSETS = Object.freeze([['white', 'White'], ['black', 'Black'], ['glass', 'Glass'], ['custom', 'Custom']]);
  const GRADIENT_TYPES = Object.freeze(['linear', 'radial']);
  const DEFAULT_STYLE = Object.freeze({
    bg: 'sunrise', custom: '#2F6BFF',
    g1: '#FF7EB3', g2: '#6A5BFF', gAngle: 135, gType: 'linear',   // your own gradient
    blur: 0, dim: 0,                                                // your own image
    pad: 45, radius: 12, shadow: 55, frame: 'browser-dark', ratio: 'auto',
    inset: 0, insetColor: 'white', insetCustom: '#FFFFFF', innerRadius: 8,
  });
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const BG_IDS = ['none', 'custom', 'gradient', 'image', ...BACKGROUNDS.map((b) => b.id)];

  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : d);
  function sanitizeStyle(s) {
    const o = { ...DEFAULT_STYLE };
    if (!s || typeof s !== 'object') return o;
    if (BG_IDS.includes(s.bg)) o.bg = s.bg;
    o.custom = hex(s.custom, o.custom);
    o.g1 = hex(s.g1, o.g1); o.g2 = hex(s.g2, o.g2);
    o.gAngle = num(s.gAngle, 0, 360, o.gAngle);
    if (GRADIENT_TYPES.includes(s.gType)) o.gType = s.gType;
    o.blur = num(s.blur, 0, 40, o.blur);
    o.dim = num(s.dim, 0, 80, o.dim);
    o.pad = num(s.pad, 0, 100, o.pad);
    o.radius = num(s.radius, 0, 40, o.radius);
    o.shadow = num(s.shadow, 0, 100, o.shadow);
    if (FRAMES.some(([k]) => k === s.frame)) o.frame = s.frame;
    if (RATIOS.some(([k]) => k === s.ratio)) o.ratio = s.ratio;
    o.inset = num(s.inset, 0, 100, o.inset);
    if (INSETS.some(([k]) => k === s.insetColor)) o.insetColor = s.insetColor;
    o.insetCustom = hex(s.insetCustom, o.insetCustom);
    o.innerRadius = num(s.innerRadius, 0, 40, o.innerRadius);
    return o;
  }

  // Sizes scale with the capture, so a small area and a 4K window get the same proportions.
  function layout(sw, sh, style, even) {
    const u = Math.max(0.4, Math.max(sw, Math.min(sh, sw * 1.4)) / 1000);
    const bar = style.frame.startsWith('browser') ? Math.round(44 * u) : style.frame.startsWith('mac') ? Math.round(34 * u) : 0;
    const pad = Math.round((style.pad / 100) * 140 * u);
    const ins = Math.round((style.inset / 100) * 90 * u);
    const iw = sw, ih = sh + bar;                // the window: frame bar + capture
    const cw = iw + ins * 2, ch = ih + ins * 2;  // the card: inset border + window
    let W = cw + pad * 2, H = ch + pad * 2;
    if (style.ratio !== 'auto') {
      const [a, b] = style.ratio.split(':').map(Number), r = a / b;
      if (W / H < r) W = Math.round(H * r); else H = Math.round(W / r);
    }
    if (even) { W += W % 2; H += H % 2; }
    const x = Math.round((W - cw) / 2), y = Math.round((H - ch) / 2);
    const r = Math.min(style.radius * 1.5 * u, cw / 2, ch / 2);
    // with an inset, the window gets its own corners; without one it shares the card's
    const ir = ins ? Math.min(style.innerRadius * 1.5 * u, iw / 2, ih / 2) : r;
    return { W, H, u, bar, pad, ins, x, y, cw, ch, r, ix: x + ins, iy: y + ins, iw, ih, ir };
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, Math.max(0, r));
    else { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  }

  // ---------- background (cached: it only changes with the style or size, not every video frame) ----------
  let bgCache = { key: '', canvas: null };
  function bgKey(L, style, img) {
    return [L.W, L.H, style.bg, style.custom, style.g1, style.g2, style.gAngle, style.gType, style.blur, style.dim, img ? img.width + 'x' + img.height + ':' + (img.__hmId || '') : ''].join('|');
  }
  function linear(g, W, H, angle, stops) {
    // CSS-style angle: 0 = upwards, 90 = to the right
    const a = ((angle - 90) * Math.PI) / 180, cx = W / 2, cy = H / 2;
    const len = Math.abs(W * Math.cos(a)) / 2 + Math.abs(H * Math.sin(a)) / 2;
    const lg = g.createLinearGradient(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    stops.forEach((c, i) => lg.addColorStop(i / (stops.length - 1), c));
    return lg;
  }
  function glow(g, W, H) {
    // a soft light from the top left gives flat gradients some depth
    const rg = g.createRadialGradient(W * 0.15, H * 0.1, 0, W * 0.15, H * 0.1, Math.max(W, H) * 0.8);
    rg.addColorStop(0, 'rgba(255,255,255,0.28)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  }
  function paintBackgroundInto(g, W, H, style, img) {
    g.clearRect(0, 0, W, H);
    let bg = style.bg;
    if (bg === 'image' && !img) bg = DEFAULT_STYLE.bg;
    if (bg === 'none') return;
    if (bg === 'custom') { g.fillStyle = style.custom; g.fillRect(0, 0, W, H); return; }
    if (bg === 'gradient') {
      if (style.gType === 'radial') {
        const rg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
        rg.addColorStop(0, style.g1); rg.addColorStop(1, style.g2);
        g.fillStyle = rg;
      } else g.fillStyle = linear(g, W, H, style.gAngle, [style.g1, style.g2]);
      g.fillRect(0, 0, W, H);
      return;
    }
    if (bg === 'image') {
      // cover: fill the whole canvas, crop what does not fit; blur is relative to the canvas size
      const k = Math.max(W / img.width, H / img.height);
      const dw = img.width * k, dh = img.height * k;
      const b = (style.blur / 1000) * Math.max(W, H);
      g.save();
      if (b > 0) g.filter = `blur(${b.toFixed(1)}px)`;
      // overscan so a blurred edge does not fade to transparent
      const o = b * 2;
      g.drawImage(img, (W - dw) / 2 - o, (H - dh) / 2 - o, dw + o * 2, dh + o * 2);
      g.restore();
      if (style.dim > 0) { g.fillStyle = `rgba(0,0,0,${(style.dim / 100).toFixed(2)})`; g.fillRect(0, 0, W, H); }
      return;
    }
    const p = BACKGROUNDS.find((x) => x.id === bg) || BACKGROUNDS[0];
    g.fillStyle = linear(g, W, H, 135, p.stops); g.fillRect(0, 0, W, H);
    glow(g, W, H);
  }
  function paintBackground(g, L, style, img) {
    const key = bgKey(L, style, img);
    if (bgCache.key !== key) {
      const c = bgCache.canvas && bgCache.canvas.width === L.W && bgCache.canvas.height === L.H ? bgCache.canvas : document.createElement('canvas');
      c.width = L.W; c.height = L.H;
      paintBackgroundInto(c.getContext('2d'), L.W, L.H, style, img);
      bgCache = { key, canvas: c };
    }
    g.clearRect(0, 0, L.W, L.H);
    g.drawImage(bgCache.canvas, 0, 0);
  }

  // A shadow that is only drawn outside the shape, so it never shows through a see-through inset.
  function outerShadow(g, x, y, w, h, r, blur, offY, alpha, W, H) {
    g.save();
    g.beginPath(); g.rect(0, 0, W, H);
    if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
    g.clip('evenodd');
    g.shadowColor = `rgba(0,0,0,${alpha.toFixed(3)})`; g.shadowBlur = blur; g.shadowOffsetY = offY;
    rr(g, x, y, w, h, r); g.fillStyle = '#000'; g.fill();
    g.restore();
  }

  function paintInset(g, L, style) {
    if (!L.ins) return;
    g.save();
    rr(g, L.x, L.y, L.cw, L.ch, L.r);
    if (style.insetColor === 'glass') {
      g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = Math.max(1, 1.5 * L.u); g.stroke();
    } else {
      g.fillStyle = style.insetColor === 'black' ? '#141312' : style.insetColor === 'custom' ? style.insetCustom : '#FFFFFF';
      g.fill();
    }
    g.restore();
  }

  function paintFrame(g, L, style, host) {
    if (!L.bar) return;
    const dark = style.frame.endsWith('dark'), u = L.u;
    g.fillStyle = dark ? '#262522' : '#EDEBE6';
    g.fillRect(L.ix, L.iy, L.iw, L.bar);
    g.fillStyle = dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.08)';
    g.fillRect(L.ix, L.iy + L.bar - Math.max(1, u), L.iw, Math.max(1, u));
    const cy = L.iy + L.bar / 2, r = 6 * u;
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(L.ix + 20 * u + i * 20 * u, cy, r, 0, Math.PI * 2); g.fill(); });
    if (style.frame.startsWith('browser')) {
      const w = Math.min(L.iw - 180 * u, 560 * u), h = 26 * u;
      if (w > 60 * u) {
        const x = L.ix + (L.iw - w) / 2;
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

  // src: an image, bitmap, canvas or video; sw/sh: its pixel size
  // meta.host: shown in the browser frame; meta.bgImage: your own background image; meta.even: even size (video)
  function draw(g, src, sw, sh, style, meta = {}) {
    const L = layout(sw, sh, style, meta.even);
    if (g.canvas.width !== L.W || g.canvas.height !== L.H) { g.canvas.width = L.W; g.canvas.height = L.H; }
    paintBackground(g, L, style, meta.bgImage || null);
    const floating = L.pad > 0 || style.ratio !== 'auto';
    if (style.shadow > 0 && floating) {
      const k = style.shadow / 100;
      outerShadow(g, L.x, L.y, L.cw, L.ch, L.r, 90 * k * L.u, 30 * k * L.u, 0.18 + 0.4 * k, L.W, L.H);
    }
    paintInset(g, L, style);
    // a small shadow lifts the window off the inset
    if (L.ins) outerShadow(g, L.ix, L.iy, L.iw, L.ih, L.ir, 24 * L.u, 6 * L.u, style.insetColor === 'black' ? 0.5 : 0.16, L.W, L.H);
    g.save();
    rr(g, L.ix, L.iy, L.iw, L.ih, L.ir); g.clip();
    paintFrame(g, L, style, meta.host);
    g.drawImage(src, 0, 0, sw, sh, L.ix, L.iy + L.bar, sw, sh);
    g.restore();
    if (L.bar || floating || L.ins) {
      g.save(); rr(g, L.ix + 0.5, L.iy + 0.5, L.iw - 1, L.ih - 1, L.ir);
      g.strokeStyle = style.frame.endsWith('dark') ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)'; g.lineWidth = Math.max(1, L.u); g.stroke(); g.restore();
    }
    return L;
  }

  globalThis.HMStyle = Object.freeze({ BACKGROUNDS, FRAMES, RATIOS, INSETS, DEFAULT_STYLE, sanitizeStyle, layout, draw });
})();
