// Image-tracking targets. Prefers the precompiled pieces/targets.mind made by
// tools/build_targets.py; if it's missing or out of date (a new piece was
// added), compiles in the browser from the flat composites and caches the
// result on this device.
import { manifest, loadPiece, compositeCanvas } from './pieces.js';

const MINDAR = 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js';
const BASE = new URL('../pieces/', import.meta.url);

export async function getTargets(onProgress = () => {}) {
  const m = await manifest();
  const key = `targets:${m.version}:${m.pieces.join(',')}`;
  try {
    const info = await fetch(new URL('targets.json', BASE), { cache: 'no-cache' }).then(r => r.ok ? r.json() : null);
    if (info && info.key === key) return { src: new URL('targets.mind', BASE).href, ids: info.ids, source: 'prebuilt' };
  } catch { /* fall through */ }
  const cached = await idbGet(key);
  if (cached) return { src: URL.createObjectURL(new Blob([cached])), ids: m.pieces, source: 'device-cache' };
  const buf = await compile(m.pieces, onProgress);
  await idbSet(key, buf);
  return { src: URL.createObjectURL(new Blob([buf])), ids: m.pieces, source: 'compiled' };
}

export async function compile(ids, onProgress = () => {}) {
  const { Compiler } = await import(MINDAR);
  const imgs = [];
  for (const id of ids) {
    const c = await compositeCanvas(await loadPiece(id), 1024);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await img.decode();
    imgs.push(img);
  }
  const compiler = new Compiler();
  await compiler.compileImageTargets(imgs, p => onProgress(p));
  return compiler.exportData();
}

export async function clearDeviceTargets() {
  const db = await idb();
  await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = res; t.onerror = rej; });
}

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('living-murals', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  try { const db = await idb(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); }
  catch { return null; }
}
async function idbSet(k, v) {
  try { const db = await idb(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); }
  catch { /* storage unavailable */ }
}
