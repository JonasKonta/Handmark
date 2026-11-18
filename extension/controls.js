// Handmark: the tool controls. One builder used in three places:
// the side panel, the toolbar pop-up and the floating bar inside the page.
// Built only with DOM methods (no innerHTML), so no markup is ever parsed
// from strings, including inside pages that enforce Trusted Types.
(() => {
  'use strict';
  if (globalThis.HandmarkControls) return;
  const HM = globalThis.HM;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const ICONS = {
    brush: [['path', 'M14 4l6 6-8 8H6v-6z'], ['path', 'M4 20c2 0 3-1 3-3']],
    pen: [['path', 'M4 20l4-1 11-11-3-3L5 16z']],
    hl: [['path', 'M9 14l7-7 3 3-7 7z'], ['path', 'M9 14l-3 3v3h3l3-3'], ['path', 'M14 21h7']],
    arrow: [['path', 'M5 19C9 13 13 9 19 6'], ['path', 'M13 5.5l6 .5-1.5 6']],
    text: [['path', 'M5 6h14M12 6v13']],
    laser: [['circle', 12, 12, 3], ['path', 'M12 3v3M12 18v3M3 12h3M18 12h3']],
    eraser: [['path', 'M7 20h12'], ['path', 'M4 15l9-9 6 6-7 7H8z']],
    through: [['path', 'M6 3l12 7-6 1.5L9 18z']],
    fade: [['circle', 12, 13, 7], ['path', 'M12 9v4l2.5 2M9 3h6']],
    undo: [['path', 'M9 14L4 9l5-5'], ['path', 'M4 9h10a6 6 0 010 12h-3']],
    redo: [['path', 'M15 14l5-5-5-5'], ['path', 'M20 9H10a6 6 0 000 12h3']],
    clear: [['path', 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13']],
    shot: [['path', 'M4 8h3l2-3h6l2 3h3v11H4z'], ['circle', 12, 13, 3.5]],
    settings: [['circle', 12, 12, 3], ['path', 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1']],
  };
  const TOOL_INFO = [
    ['brush', 'Marker brush (B)'], ['pen', 'Pen (P)'], ['hl', 'Highlighter (H)'], ['arrow', 'Arrow (A)'],
    ['text', 'Text (T)'], ['laser', 'Laser pointer (L)'], ['eraser', 'Eraser (E)'], ['through', 'Click-through: use the page (V or Esc)'],
  ];
  const STAB_NAMES = ['Off', 'Low', 'High'];

  function icon(doc, name) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, ...a] of ICONS[name]) {
      const el = doc.createElementNS(SVG_NS, tag);
      if (tag === 'path') el.setAttribute('d', a[0]);
      else { el.setAttribute('cx', a[0]); el.setAttribute('cy', a[1]); el.setAttribute('r', a[2]); }
      svg.appendChild(el);
    }
    return svg;
  }

  const CSS = `
.hmc{display:grid;gap:12px;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#f3eee4}
.hmc .grp{display:grid;gap:6px}
.hmc .lbl{font-weight:600;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#a29c90}
.hmc .row{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.hmc button{font:inherit;color:#d8d3c9;background:transparent;border:0;cursor:pointer;margin:0}
.hmc .t{width:34px;height:34px;border-radius:7px;display:grid;place-items:center;flex:none;padding:0}
.hmc .t:hover{background:#2f2d29}
.hmc .t[aria-pressed="true"]{background:#FFC702;color:#141312}
.hmc svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.hmc .sw{width:22px;height:22px;border-radius:50%;border:2px solid #3c3a35;margin:0 2px;padding:0;flex:none}
.hmc .sw[aria-pressed="true"]{outline:2px solid #f3eee4;outline-offset:2px}
.hmc .custom{position:relative;width:22px;height:22px;border-radius:50%;overflow:hidden;border:0;margin:0 2px;flex:none;display:block;cursor:pointer;background:conic-gradient(from 0deg,#ff3b30,#ff9500,#ffcc00,#34c759,#00c7be,#007aff,#5856d6,#af52de,#ff2d55,#ff3b30)}
.hmc .custom::before{content:"";position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.9) 0,rgba(255,255,255,0) 70%);pointer-events:none}
.hmc .custom::after{content:"";position:absolute;inset:5px;border-radius:50%;background:var(--c,#2F6BFF);box-shadow:0 0 0 2px #1b1a18;opacity:0;pointer-events:none}
.hmc .custom[data-on="true"]{outline:2px solid #f3eee4;outline-offset:2px}
.hmc .custom[data-on="true"]::after{opacity:1}
.hmc .custom:hover{transform:scale(1.08)}
.hmc .custom input{position:absolute;inset:-6px;width:40px;height:40px;opacity:0;cursor:pointer;border:0;padding:0}
.hmc .mini{font-weight:600;font-size:11.5px;border-radius:7px;padding:6px 9px}
.hmc .mini:hover{background:#2f2d29}
.hmc .mini[aria-pressed="true"]{background:#3a3833;color:#FFC702}
.hmc button:focus-visible,.hmc input:focus-visible{outline:2px solid #FFC702;outline-offset:2px}
.hmc.horiz{display:flex;flex-wrap:wrap;align-items:center;gap:2px}
.hmc.horiz .grp{display:flex;align-items:center;gap:2px}
.hmc.horiz .grp+.grp{border-left:1px solid #3c3a35;padding-left:4px;margin-left:2px}
.hmc.horiz .lbl{display:none}
.hmc.horiz .row{flex-wrap:nowrap;gap:2px}
.hmc .menu{position:absolute;z-index:5;background:#1d1c1a;border:1px solid #3c3a35;border-radius:10px;padding:6px;display:grid;min-width:200px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
.hmc .menu button{text-align:left;padding:8px 10px;border-radius:6px;color:#f3eee4;display:flex;justify-content:space-between;gap:12px}
.hmc .menu button:hover{background:#2f2d29}
.hmc .menu span{color:#a29c90}
`;

  // opts: { layout: 'vertical'|'bar', onSetting(partial), onAction(name), onOpenSettings() }
  function build(doc, opts) {
    const root = doc.createElement('div');
    root.className = 'hmc ' + (opts.layout === 'bar' ? 'horiz' : 'vertical');
    root.style.position = 'relative';
    const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const group = (label) => { const g = el('div', 'grp'); g.appendChild(el('div', 'lbl', label)); const r = el('div', 'row'); g.appendChild(r); root.appendChild(g); return r; };
    const tbtn = (name, title, onClick) => {
      const b = el('button', 't'); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title.replace(/ \(.*\)$/, ''));
      b.appendChild(icon(doc, name)); b.addEventListener('click', (e) => { if (e.isTrusted) onClick(e); }); return b;
    };

    const toolRow = group('Tools');
    const toolBtns = {};
    for (const [name, title] of TOOL_INFO) { toolBtns[name] = tbtn(name, title, () => opts.onSetting({ tool: name })); toolRow.appendChild(toolBtns[name]); }

    const colorRow = group('Colour');
    const swatches = [];
    for (const c of HM.COLORS) {
      const b = el('button', 'sw'); b.type = 'button'; b.title = c.name; b.setAttribute('aria-label', c.name); b.style.background = c.hex; b.dataset.c = c.hex;
      b.addEventListener('click', (e) => { if (e.isTrusted) opts.onSetting({ color: c.hex }); });
      swatches.push(b); colorRow.appendChild(b);
    }
    const custom = el('label', 'custom'); custom.title = 'Pick any colour';
    const customIn = el('input'); customIn.type = 'color'; customIn.setAttribute('aria-label', 'Custom colour');
    customIn.addEventListener('input', (e) => { if (e.isTrusted) opts.onSetting({ color: customIn.value.toUpperCase(), custom: customIn.value.toUpperCase() }); });
    custom.appendChild(customIn); colorRow.appendChild(custom);

    const sizeRow = group('Size & smoothing');
    const sizeBtns = {};
    for (const [n, label] of [[1, 'S'], [2, 'M'], [3, 'L']]) {
      const b = el('button', 'mini', label); b.type = 'button'; b.title = ['Small', 'Medium', 'Large'][n - 1] + ' (' + n + ')';
      b.addEventListener('click', (e) => { if (e.isTrusted) opts.onSetting({ size: n }); });
      sizeBtns[n] = b; sizeRow.appendChild(b);
    }
    const stabBtn = el('button', 'mini'); stabBtn.type = 'button'; stabBtn.title = 'Stabiliser: smooths shaky lines (S)';
    let current = HM.DEFAULTS;
    stabBtn.addEventListener('click', (e) => { if (e.isTrusted) opts.onSetting({ stab: (current.stab + 1) % 3 }); });
    sizeRow.appendChild(stabBtn);

    const pageRow = group('Page');
    const fadeBtn = tbtn('fade', 'Fade new marks (G)', () => opts.onSetting({ fade: !current.fade }));
    pageRow.append(
      fadeBtn,
      tbtn('undo', 'Undo (Ctrl+Z)', () => opts.onAction('undo')),
      tbtn('redo', 'Redo (Ctrl+Shift+Z)', () => opts.onAction('redo')),
      tbtn('clear', 'Clear page (C)', () => opts.onAction('clear')),
    );
    let menu = null;
    const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
    const shotBtn = tbtn('shot', 'Screenshot', () => {
      if (menu) { closeMenu(); return; }
      menu = el('div', 'menu');
      for (const [k, label, keys] of [['shot-visible', 'Visible area', 'Ctrl+Shift+S'], ['shot-full', 'Full page', 'Ctrl+Shift+F']]) {
        const b = el('button'); b.type = 'button'; b.append(el('b', null, label), el('span', null, keys));
        b.addEventListener('click', (e) => { if (!e.isTrusted) return; closeMenu(); opts.onAction(k); });
        menu.appendChild(b);
      }
      root.appendChild(menu);
      menu.style.left = Math.max(0, shotBtn.offsetLeft - 120) + 'px';
      menu.style.top = (shotBtn.offsetTop + shotBtn.offsetHeight + 6) + 'px';
    });
    pageRow.append(shotBtn, tbtn('settings', 'Settings', () => opts.onOpenSettings()));
    doc.addEventListener('click', (e) => { if (menu && !e.composedPath().includes(menu) && !e.composedPath().includes(shotBtn)) closeMenu(); }, true);

    function update(s) {
      current = s;
      for (const [name, b] of Object.entries(toolBtns)) b.setAttribute('aria-pressed', String(s.tool === name));
      for (const b of swatches) b.setAttribute('aria-pressed', String(b.dataset.c === s.color));
      customIn.value = s.custom.toLowerCase();
      custom.style.setProperty('--c', s.custom);
      custom.dataset.on = String(!HM.COLORS.some((c) => c.hex === s.color));
      for (const [n, b] of Object.entries(sizeBtns)) b.setAttribute('aria-pressed', String(Number(n) === s.size));
      stabBtn.textContent = 'Smooth: ' + STAB_NAMES[s.stab];
      fadeBtn.setAttribute('aria-pressed', String(s.fade));
      fadeBtn.title = s.fade ? `Fade on: new marks disappear after ${s.fadeMs / 1000} s (G)` : 'Fade new marks (G)';
    }
    update(HM.DEFAULTS);
    return { el: root, update, closeMenu };
  }

  globalThis.HandmarkControls = Object.freeze({ build, CSS, icon });
})();
