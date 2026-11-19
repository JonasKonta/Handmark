// Handmark: recorder. Runs in an offscreen document while a recording is in progress.
// Receives a tab-capture stream, crops every frame to the area chosen on the page,
// encodes it with MediaRecorder and stores the result locally for the editor.
(() => {
  'use strict';
  const MAX_MS = 10 * 60 * 1000;
  let rec = null;

  function pickMime() {
    for (const m of ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);

  async function start({ streamId, rect, view, title, url }) {
    if (rec) return { error: 'Already recording' };
    const W = Math.round(view.vw * view.dpr), H = Math.round(view.vh * view.dpr);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, minWidth: W, maxWidth: W, minHeight: H, maxHeight: H, maxFrameRate: 30 } },
    });
    const track = stream.getVideoTracks()[0];
    const ow = even(rect.w * view.dpr), oh = even(rect.h * view.dpr);
    const canvas = new OffscreenCanvas(ow, oh);
    const g = canvas.getContext('2d', { alpha: false });
    // the crop is worked out from each frame's real size, in case Chrome scales the capture
    const drawCrop = (src, sw, sh) => {
      const kx = sw / view.vw, ky = sh / view.vh;
      g.drawImage(src, rect.x * kx, rect.y * ky, rect.w * kx, rect.h * ky, 0, 0, ow, oh);
    };

    let out, stopPipe = () => {};
    if (typeof MediaStreamTrackProcessor === 'function' && typeof MediaStreamTrackGenerator === 'function') {
      // event driven: one output frame per captured frame, no timers (offscreen documents are hidden)
      const proc = new MediaStreamTrackProcessor({ track });
      const gen = new MediaStreamTrackGenerator({ kind: 'video' });
      const ac = new AbortController();
      proc.readable.pipeThrough(new TransformStream({
        transform(frame, ctl) {
          try { drawCrop(frame, frame.displayWidth, frame.displayHeight); ctl.enqueue(new VideoFrame(canvas, { timestamp: frame.timestamp })); }
          catch {} finally { frame.close(); }
        },
      }), { signal: ac.signal }).pipeTo(gen.writable, { signal: ac.signal }).catch(() => {});
      out = new MediaStream([gen]);
      stopPipe = () => ac.abort();
    } else {
      const video = document.createElement('video');
      video.muted = true; video.srcObject = stream; await video.play();
      const c2 = document.createElement('canvas'); c2.width = ow; c2.height = oh;
      const g2 = c2.getContext('2d');
      const tick = () => { if (!rec) return; g2.drawImage(video, rect.x * video.videoWidth / view.vw, rect.y * video.videoHeight / view.vh, rect.w * video.videoWidth / view.vw, rect.h * video.videoHeight / view.vh, 0, 0, ow, oh); video.requestVideoFrameCallback(tick); };
      video.requestVideoFrameCallback(tick);
      out = c2.captureStream(30);
      stopPipe = () => { video.srcObject = null; };
    }

    const mime = pickMime();
    const mr = new MediaRecorder(out, { mimeType: mime || undefined, videoBitsPerSecond: Math.min(16e6, Math.max(3e6, ow * oh * 6)) });
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stopPipe();
      for (const t of stream.getTracks()) t.stop();
      for (const t of out.getTracks()) t.stop();
      clearTimeout(rec && rec.timer);
      rec = null;
      let id = null;
      try {
        const blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
        if (blob.size) id = await HMMedia.put({ kind: 'video', blob, mime: blob.type, mode: 'video', title, url });
      } catch {}
      chrome.runtime.sendMessage({ type: 'hm:rec-done', id }).catch(() => {});
    };
    track.addEventListener('ended', stop);
    mr.start(1000);
    rec = { mr, timer: setTimeout(stop, MAX_MS) };
    return { ok: true, width: ow, height: oh, mime };
  }

  function stop() {
    if (rec && rec.mr.state !== 'inactive') rec.mr.stop();
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !msg || sender.tab) return;
    if (msg.type === 'hm:off-start') {
      start(msg).then(reply, (e) => reply({ error: String(e && e.message || e).slice(0, 160) }));
      return true;
    }
    if (msg.type === 'hm:off-stop') { stop(); reply({ ok: true }); }
  });
})();
