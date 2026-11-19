// Handmark: a small local store for screenshots and recordings on their way to the editor.
// Lives in the extension's own IndexedDB, so web pages can never read it.
// Captures older than a day are removed, and at most 12 are kept.
(() => {
  'use strict';
  if (globalThis.HMMedia) return;
  const DB = 'handmark-media', STORE = 'captures', MAX_AGE = 24 * 3600e3, MAX_ITEMS = 12;

  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function tx(mode, fn) {
    const db = await open();
    try {
      return await new Promise((res, rej) => {
        const t = db.transaction(STORE, mode);
        const out = fn(t.objectStore(STORE));
        t.oncomplete = () => res(out && 'result' in out ? out.result : out);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    } finally { db.close(); }
  }
  function newId() {
    const b = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  // rec: { kind: 'image'|'video', blob, mime, title, url, mode }
  async function put(rec) {
    const id = newId();
    await tx('readwrite', (s) => s.put({
      id, created: Date.now(), kind: rec.kind === 'video' ? 'video' : 'image', blob: rec.blob, mime: String(rec.mime || rec.blob.type || ''),
      title: String(rec.title || '').slice(0, 300), url: String(rec.url || '').slice(0, 2048), mode: String(rec.mode || ''),
    }));
    prune().catch(() => {});
    return id;
  }
  async function get(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) return null;
    return (await tx('readonly', (s) => s.get(id))) || null;
  }
  async function prune() {
    const all = await tx('readonly', (s) => s.getAll());
    all.sort((a, b) => b.created - a.created);
    const old = all.filter((r, i) => i >= MAX_ITEMS || Date.now() - r.created > MAX_AGE).map((r) => r.id);
    if (old.length) await tx('readwrite', (s) => { for (const id of old) s.delete(id); });
  }

  globalThis.HMMedia = Object.freeze({ put, get, prune });
})();
