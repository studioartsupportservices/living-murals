// Piece library: loads piece.json + master SVG, splits the SVG into layer
// rasters (cropped to each layer's bounds so small parts like eyes stay sharp),
// and renders the flat "as painted" composite used for tracking.

const BASE = new URL('../pieces/', import.meta.url);
const cache = new Map();
let manifestP = null;

export function manifest() {
  manifestP ??= fetch(new URL('manifest.json', BASE)).then(r => r.json());
  return manifestP;
}

export async function allPieces() {
  const m = await manifest();
  return Promise.all(m.pieces.map(loadPiece));
}

export function loadPiece(id) {
  if (!cache.has(id)) cache.set(id, _load(id));
  return cache.get(id);
}

async function _load(id) {
  const dir = new URL(`${encodeURIComponent(id)}/`, BASE);
  const meta = await fetch(new URL('piece.json', dir)).then(r => {
    if (!r.ok) throw new Error(`Unknown piece ${id}`);
    return r.json();
  });
  const svgText = await fetch(new URL(meta.master, dir)).then(r => r.text());
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const piece = { ...meta, dir, doc, layerCache: new Map(), compositeCache: new Map() };
  piece.layerMeta = new Map((meta.layers || []).map((l, i) => [l.id, { ...l, order: i }]));
  piece.roles = {};
  for (const g of topGroups(doc)) piece.roles[g.id] = g.getAttribute('data-role') || 'subject';
  return piece;
}

function topGroups(doc) {
  return [...doc.documentElement.children].filter(e => e.tagName.toLowerCase() === 'g' && e.id);
}

function serialize(doc, { keep = null, viewBox = null, w, h }) {
  const clone = doc.documentElement.cloneNode(true);
  for (const g of [...clone.children]) {
    if (g.tagName.toLowerCase() !== 'g' || !g.id) continue;
    if (keep && g.id !== keep) g.remove();
    else if (keep) g.removeAttribute('style'); // reveal hidden layers (eyelids) when isolated
  }
  if (viewBox) clone.setAttribute('viewBox', viewBox.join(' '));
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.setAttribute('preserveAspectRatio', 'none');
  return new XMLSerializer().serializeToString(clone);
}

async function rasterSVG(text, w, h) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

function alphaBounds(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 2) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

// Returns { canvas, rect:[x,y,w,h] in piece px } for one layer.
export async function layerRaster(piece, layerId, density = 1.25) {
  const key = layerId + '@' + density;
  if (piece.layerCache.has(key)) return piece.layerCache.get(key);
  const p = (async () => {
    const [W, H] = piece.size;
    const probeW = 400, probeH = Math.round(400 * H / W);
    const probe = await rasterSVG(serialize(piece.doc, { keep: layerId, w: probeW, h: probeH }), probeW, probeH);
    const b = alphaBounds(probe);
    if (!b) return null;
    const s = W / probeW, pad = 28;
    let x = Math.max(0, b[0] * s - pad), y = Math.max(0, b[1] * s - pad);
    let x2 = Math.min(W, b[2] * s + pad), y2 = Math.min(H, b[3] * s + pad);
    const rw = x2 - x, rh = y2 - y;
    const max = 2048;
    const k = Math.min(density, max / rw, max / rh);
    const tw = Math.max(2, Math.round(rw * k)), th = Math.max(2, Math.round(rh * k));
    const canvas = await rasterSVG(serialize(piece.doc, { keep: layerId, viewBox: [x, y, rw, rh], w: tw, h: th }), tw, th);
    return { canvas, rect: [x, y, rw, rh] };
  })();
  piece.layerCache.set(key, p);
  return p;
}

// Flat image of the mural as painted (eyelids stay hidden). Used as the
// image-tracking target and for "show target" test screens.
export async function compositeCanvas(piece, width = 1024) {
  if (piece.compositeCache.has(width)) return piece.compositeCache.get(width);
  const p = (async () => {
    const [W, H] = piece.size;
    const h = Math.round(width * H / W);
    if (piece.tracking) {
      const img = new Image();
      img.src = new URL(piece.tracking, piece.dir).href;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = width; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, width, h);
      return c;
    }
    return rasterSVG(serialize(piece.doc, { w: width, h }), width, h);
  })();
  piece.compositeCache.set(width, p);
  return p;
}

export function pieceURL(id) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('p', id);
  u.searchParams.set('src', 'qr');
  return u.href;
}

export function studioURL() {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('src', 'card');
  return u.href;
}

// Hue of a palette (circular mean, weighted by saturation) for blend harmony.
export function paletteHue(piece) {
  let x = 0, y = 0;
  for (const hex of piece.palette || []) {
    const [h, s] = hsl(hex);
    x += Math.cos(h) * s; y += Math.sin(h) * s;
  }
  return Math.atan2(y, x);
}

function hsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * Math.PI / 3, d / (1 - Math.abs(max + min - 1) || 1)];
}
