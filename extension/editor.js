// Handmark: the screenshot and recording editor.
// Opens with a capture id in the address (#id), loads the capture from the extension's
// local store and lets you style it: background, window frame, aspect ratio, padding,
// corners and shadow. Exports a PNG (download or copy) or a styled video.
(() => {
  'use strict';
  const S = globalThis.HMStyle, M = globalThis.HMMedia;
  const $ = (id) => document.getElementById(id);
  const out = $('out'), g = out.getContext('2d');
  let style = { ...S.DEFAULT_STYLE };
  let rec = null, src = null, sw = 0, sh = 0, host = '', video = null, objUrl = null, exporting = null;

  // ---------- helpers ----------
  let toastTimer = 0;
  function toast(t) { $('toast').textContent = t; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2600); }
  function stamp() {
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  }
  const NAMES = { visible: 'window', full: 'fullpage', area: 'area', video: 'recording' };
  const extOf = (mime) => (/mp4/.test(mime) ? 'mp4' : /webm/.test(mime) ? 'webm' : 'png');
  async function download(blob, suffix) {
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename: `Handmark/handmark-${NAMES[rec.mode] || 'capture'}${suffix}-${stamp()}.${extOf(blob.type)}`, saveAs: false });
      toast('Saved to Downloads/Handmark');
    } catch (e) { toast('Could not save: ' + String(e && e.message || e).slice(0, 80)); }
    setTimeout(() => URL.revokeObjectURL(url), 60e3);
  }
  const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  function pickMime() {
    for (const m of ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }

  // ---------- rendering ----------
  let raf = 0;
  function render() {
    raf = 0;
    if (!src) return;
    const L = S.draw(g, src, sw, sh, style, { host, even: !!video });
    $('wrap').classList.toggle('tall', L.H / L.W > 2.2);
    $('dims').textContent = `${L.W} × ${L.H} px${video ? '' : ' · PNG'}`;
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };

  // ---------- style controls ----------
  let saveTimer = 0;
  function setStyle(p) {
    style = S.sanitizeStyle({ ...style, ...p });
    showStyle(); schedule();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ shotStyle: style }), 250);
  }
  const btn = (cls, label, onClick) => {
    const b = document.createElement('button'); b.type = 'button'; if (cls) b.className = cls;
    b.title = label; b.setAttribute('aria-label', label);
    b.addEventListener('click', (e) => { if (e.isTrusted) onClick(); });
    return b;
  };
  const bgBtns = [];
  for (const b of S.BACKGROUNDS) {
    const el = btn('sw', b.name, () => setStyle({ bg: b.id }));
    el.style.background = `linear-gradient(135deg, ${b.stops.join(', ')})`;
    el.dataset.v = b.id; bgBtns.push(el); $('bgs').appendChild(el);
  }
  const noneBtn = btn('sw none', 'Transparent', () => setStyle({ bg: 'none' })); noneBtn.dataset.v = 'none';
  const customBtn = document.createElement('label'); customBtn.className = 'sw custom'; customBtn.title = 'Custom colour'; customBtn.dataset.v = 'custom';
  const customIn = document.createElement('input'); customIn.type = 'color'; customIn.setAttribute('aria-label', 'Custom background colour');
  customIn.addEventListener('input', (e) => { if (e.isTrusted) setStyle({ bg: 'custom', custom: customIn.value }); });
  customIn.addEventListener('click', (e) => { if (e.isTrusted && style.bg !== 'custom') setStyle({ bg: 'custom' }); });
  customBtn.appendChild(customIn);
  bgBtns.push(noneBtn, customBtn); $('bgs').append(noneBtn, customBtn);

  const frameBtns = S.FRAMES.map(([k, label]) => { const b = btn(null, label, () => setStyle({ frame: k })); b.textContent = label; b.dataset.v = k; $('frames').appendChild(b); return b; });
  const ratioBtns = S.RATIOS.map(([k, label]) => { const b = btn(null, 'Aspect ratio ' + label, () => setStyle({ ratio: k })); b.textContent = label; b.dataset.v = k; $('ratios').appendChild(b); return b; });
  for (const k of ['pad', 'radius', 'shadow']) $(k).addEventListener('input', (e) => { if (e.isTrusted) setStyle({ [k]: Number(e.target.value) }); });
  $('resetBtn').addEventListener('click', () => setStyle({ ...S.DEFAULT_STYLE }));
  $('plainBtn').addEventListener('click', () => setStyle({ bg: 'none', pad: 0, radius: 0, shadow: 0, frame: 'none', ratio: 'auto' }));

  function showStyle() {
    for (const b of bgBtns) b.setAttribute('aria-pressed', String(b.dataset.v === style.bg));
    customBtn.style.background = style.custom; customIn.value = style.custom.toLowerCase();
    for (const b of frameBtns) b.setAttribute('aria-pressed', String(b.dataset.v === style.frame));
    for (const b of ratioBtns) b.setAttribute('aria-pressed', String(b.dataset.v === style.ratio));
    for (const k of ['pad', 'radius', 'shadow']) { $(k).value = String(style[k]); $(k + 'Out').textContent = String(style[k]); }
  }

  // ---------- actions ----------
  const canvasBlob = () => new Promise((r) => out.toBlob(r, 'image/png'));
  $('saveBtn').addEventListener('click', async () => {
    if (!rec) return;
    if (video) { exportVideo(); return; }
    render(); download(await canvasBlob(), '');
  });
  $('origBtn').addEventListener('click', () => { if (rec) download(rec.blob, '-original'); });
  $('copyBtn').addEventListener('click', async () => {
    if (!rec || video) return;
    try {
      render();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasBlob() })]);
      toast('Copied. Paste it anywhere.');
    } catch { toast('Chrome did not allow copying. Use Download instead.'); }
  });
  document.addEventListener('keydown', (e) => {
    if (!e.isTrusted || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); $('saveBtn').click(); }
    else if (k === 'c' && !video && !String(window.getSelection())) { e.preventDefault(); $('copyBtn').click(); }
  });

  // ---------- video ----------
  // MediaRecorder WebM files have no duration in their header; seeking to the end makes Chrome work it out.
  async function fixDuration(v) {
    if (Number.isFinite(v.duration)) return;
    await new Promise((res) => {
      const done = () => { v.removeEventListener('durationchange', check); res(); };
      const check = () => { if (Number.isFinite(v.duration)) done(); };
      v.addEventListener('durationchange', check);
      v.currentTime = 1e7;
      setTimeout(done, 3000);
    });
    v.currentTime = 0;
  }
  function setPlaying(on) {
    $('playIcon').setAttribute('d', on ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5l11 7-11 7z');
    $('playBtn').setAttribute('aria-label', on ? 'Pause' : 'Play');
  }
  function frameLoop() {
    if (!video) return;
    render();
    if (Number.isFinite(video.duration) && video.duration > 0) {
      $('seek').value = String(Math.round((video.currentTime / video.duration) * 1000));
      $('vtime').textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
    }
    if (exporting) {
      const p = Number.isFinite(video.duration) && video.duration > 0 ? video.currentTime / video.duration : 0;
      $('busyBar').style.width = Math.round(p * 100) + '%';
    }
    if (!video.paused && !video.ended) video.requestVideoFrameCallback(frameLoop);
  }
  async function setupVideo() {
    video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    objUrl = URL.createObjectURL(rec.blob);
    video.src = objUrl;
    await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = () => rej(new Error('This video could not be played')); });
    await fixDuration(video);
    await new Promise((r) => { if (video.readyState >= 2 && !video.seeking) r(); else video.addEventListener('seeked', r, { once: true }); });
    src = video; sw = video.videoWidth; sh = video.videoHeight;
    $('vctl').hidden = false;
    $('copyBtn').hidden = true;
    $('saveBtn').textContent = 'Export styled video';
    $('origBtn').textContent = 'Save original video';
    video.addEventListener('play', () => { setPlaying(true); video.requestVideoFrameCallback(frameLoop); });
    video.addEventListener('pause', () => setPlaying(false));
    video.addEventListener('ended', () => { setPlaying(false); if (!exporting) { video.currentTime = 0; } });
    video.addEventListener('seeked', () => { if (video.paused) { render(); frameLoop(); } });
    $('playBtn').addEventListener('click', () => { if (exporting) return; if (video.paused) video.play(); else video.pause(); });
    $('seek').addEventListener('input', (e) => { if (exporting || !Number.isFinite(video.duration)) return; video.currentTime = (Number(e.target.value) / 1000) * video.duration; });
    $('vtime').textContent = `0:00 / ${fmt(video.duration)}`;
  }

  // Re-encodes the recording with the current style: the video plays once in real time
  // while each frame is drawn styled onto the canvas, which is itself recorded.
  async function exportVideo() {
    if (exporting) return;
    const mime = pickMime();
    video.pause(); video.loop = false;
    video.currentTime = 0;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    render();
    const stream = out.captureStream(30);
    const L = S.layout(sw, sh, style, true);
    const mr = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: Math.min(20e6, Math.max(4e6, L.W * L.H * 5)) });
    const chunks = [];
    let cancelled = false;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const finished = new Promise((r) => { mr.onstop = r; });
    exporting = { cancel: () => { cancelled = true; video.pause(); if (mr.state !== 'inactive') mr.stop(); } };
    document.querySelector('aside').inert = true;
    $('busy').hidden = false; $('busyBar').style.width = '0%'; $('busyMsg').textContent = 'Exporting styled video…';
    for (const b of ['saveBtn', 'origBtn']) $(b).disabled = true;
    mr.start(1000);
    const ended = new Promise((r) => video.addEventListener('ended', r, { once: true }));
    await video.play();
    await Promise.race([ended, finished]);
    if (mr.state !== 'inactive') { render(); await new Promise((r) => setTimeout(r, 120)); mr.stop(); }
    await finished;
    for (const t of stream.getTracks()) t.stop();
    exporting = null;
    document.querySelector('aside').inert = false;
    $('busy').hidden = true;
    for (const b of ['saveBtn', 'origBtn']) $(b).disabled = false;
    video.currentTime = 0;
    if (cancelled) { toast('Export cancelled'); return; }
    download(new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] }), '-styled');
  }
  $('cancelBtn').addEventListener('click', () => { if (exporting) exporting.cancel(); });

  // ---------- start ----------
  (async () => {
    const got = await chrome.storage.local.get('shotStyle');
    style = S.sanitizeStyle(got.shotStyle);
    showStyle();
    rec = await M.get(location.hash.slice(1)).catch(() => null);
    if (!rec || !(rec.blob instanceof Blob)) {
      $('gone').hidden = false; $('wrap').hidden = true;
      for (const b of ['saveBtn', 'origBtn', 'copyBtn']) $(b).disabled = true;
      return;
    }
    try { const u = new URL(rec.url); if (u.protocol === 'http:' || u.protocol === 'https:') host = u.host; } catch {}
    $('kind').textContent = rec.kind === 'video' ? 'Recording' : { full: 'Full page', visible: 'Window', area: 'Area' }[rec.mode] || 'Screenshot';
    $('from').textContent = rec.title || host;
    document.title = `${$('kind').textContent} · Handmark`;
    try {
      if (rec.kind === 'video') await setupVideo();
      else { src = await createImageBitmap(rec.blob); sw = src.width; sh = src.height; }
    } catch (e) {
      $('gone').textContent = String(e && e.message || e); $('gone').hidden = false; $('wrap').hidden = true; return;
    }
    render();
  })();

  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.shotStyle && !exporting) { style = S.sanitizeStyle(c.shotStyle.newValue); showStyle(); schedule(); }
  });
  window.addEventListener('pagehide', () => { if (objUrl) URL.revokeObjectURL(objUrl); });
})();
