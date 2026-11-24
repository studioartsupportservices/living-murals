// Animated mural: turns a composition (one or more pieces, each a stack of
// layer rasters) into a three.js group of depth-stacked planes, and drives the
// presets each piece ships with: sway, hair/fur flow, drift, breathe, pulse,
// eye gaze, blinking and head turn.
//
// Local space: width 1, x in [-0.5, 0.5], y up, height = aspect. z = depth
// toward the viewer (in mural widths), so real camera motion gives parallax.
import * as THREE from 'three';
import { layerRaster } from './pieces.js';

const VERT = /* glsl */`
uniform vec4 uRect;          // x0, yTop, w, h  (local)
uniform float uTime, uZ;
uniform vec4 uSway;          // amp, speed, length, wave
uniform vec2 uSwayRoot, uSwayDir;
uniform float uSwayRadial;
uniform vec3 uDrift;         // amp, speed, freq
uniform vec2 uOff, uScl, uSclPivot;
uniform float uRot;
uniform vec2 uRotPivot, uHeadOff, uParallax;
uniform vec4 uMaskRect;
varying vec2 vUv, vLocal, vMaskUv;
void main() {
  vUv = uv;
  vec2 p = vec2(uRect.x + uv.x * uRect.z, uRect.y - (1.0 - uv.y) * uRect.w);
  vLocal = p;
  if (uSway.x != 0.0) {
    vec2 d = uSwayRadial > 0.5 ? normalize(p - uSwayRoot + vec2(1e-5)) : uSwayDir;
    float w = clamp(dot(p - uSwayRoot, d) / uSway.z, 0.0, 1.0);
    w *= w;
    float ph = uTime * uSway.y + dot(p, vec2(1.0, 0.35)) * uSway.w;
    p += vec2(-d.y, d.x) * uSway.x * w * (sin(ph) + 0.35 * sin(ph * 2.3 + 1.7));
  }
  if (uDrift.x != 0.0) {
    float t = uTime * uDrift.y;
    p += uDrift.x * vec2(sin(t + p.y * uDrift.z) + 0.4 * sin(t * 1.7 + p.x * uDrift.z * 1.3),
                         cos(t * 0.8 + p.x * uDrift.z) + 0.4 * cos(t * 1.3 + p.y * uDrift.z * 0.9));
  }
  p += uOff;
  p = uSclPivot + (p - uSclPivot) * uScl;
  vMaskUv = vec2((p.x - uMaskRect.x) / uMaskRect.z, 1.0 - (uMaskRect.y - p.y) / uMaskRect.w);
  vec2 q = p - uRotPivot;
  float c = cos(uRot), s = sin(uRot);
  p = uRotPivot + vec2(c * q.x - s * q.y, s * q.x + c * q.y) + uHeadOff + uParallax * uZ;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, uZ, 1.0);
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap, uMask;
uniform float uHasMask, uTime, uHue, uSat, uOpacity;
uniform vec4 uFlow;          // ampU, ampV, speed, freq
uniform vec3 uFlowRoot;      // x, y, length
uniform vec2 uPulse;
varying vec2 vUv, vLocal, vMaskUv;
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
void main() {
  vec2 uv = vUv;
  if (uFlow.x != 0.0) {
    float w = clamp(length(vLocal - uFlowRoot.xy) / uFlowRoot.z, 0.0, 1.0);
    float t = uTime * uFlow.z;
    vec2 n = vec2(sin(vLocal.y * uFlow.w + t + sin(vLocal.x * uFlow.w * 0.7 - t * 0.6)),
                  cos(vLocal.x * uFlow.w * 0.8 - t * 1.1 + sin(vLocal.y * uFlow.w * 0.5 + t * 0.4)));
    uv += n * uFlow.xy * w;
  }
  vec4 col = texture2D(uMap, uv);
  if (uHasMask > 0.5) {
    float inside = step(0.0, vMaskUv.x) * step(vMaskUv.x, 1.0) * step(0.0, vMaskUv.y) * step(vMaskUv.y, 1.0);
    col.a *= texture2D(uMask, vMaskUv).a * inside;
  }
  if (uHue != 0.0) col.rgb = hueShift(col.rgb, uHue);
  if (uSat != 1.0) col.rgb = mix(vec3(dot(col.rgb, vec3(0.299, 0.587, 0.114))), col.rgb, uSat);
  if (uPulse.x != 0.0) col.a *= 1.0 - uPulse.x * 0.5 * (1.0 + sin(uTime * uPulse.y + vLocal.x * 37.0 + vLocal.y * 23.0));
  col.a *= uOpacity;
  if (col.a < 0.003) discard;
  gl_FragColor = col;
}`;

const textureCache = new WeakMap();
function texFor(canvas) {
  if (!textureCache.has(canvas)) {
    const t = new THREE.CanvasTexture(canvas);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 4;
    textureCache.set(canvas, t);
  }
  return textureCache.get(canvas);
}

// ---------- composition specs ----------
// item = { piece, layers:[ids], map:{kx,ky,ox,oy}, hue, sat, zAdd, mirror }
export function pieceSpec(piece, { swapWith = null } = {}) {
  const [W, H] = piece.size;
  const aspect = H / W;
  const map = { kx: 1 / W, ky: 1 / W, ox: -0.5, oy: aspect / 2 };
  const own = (piece.layers || []).map(l => l.id);
  if (!swapWith || !piece.subject || !swapWith.subject) {
    return { aspect, items: [{ piece, layers: own, map }] };
  }
  const sub = new Set(piece.subject.layers);
  const items = [{ piece, layers: own.filter(id => !sub.has(id)), map }];
  // place the other piece's subject inside this piece's subject box
  const [bx, by, bw, bh] = piece.subject.box;
  const dst = [map.ox + bx * map.kx, map.oy - by * map.ky, bw * map.kx, bh * map.ky];
  items.push({ piece: swapWith, layers: swapWith.subject.layers, map: fitBox(swapWith.subject.box, dst, 'bottom'), hue: 0 });
  // keep foreground layers of the host on top of the swapped subject
  items.push({ piece, layers: own.filter(id => piece.roles[id] === 'foreground'), map, zAdd: 0.001 });
  items[0].layers = items[0].layers.filter(id => piece.roles[id] !== 'foreground');
  return { aspect, items };
}

// Map src box (piece px) into dst [x0, yTop, w, h] (local), preserving aspect.
export function fitBox(src, dst, align = 'center', mirror = false) {
  const [sx, sy, sw, sh] = src;
  const [dx, dyTop, dw, dh] = dst;
  const k = Math.min(dw / sw, dh / sh);
  const ox = dx + (dw - sw * k) / 2 - sx * k;
  const top = align === 'bottom' ? dyTop - (dh - sh * k) : dyTop - (dh - sh * k) / 2;
  const map = { kx: k, ky: k, ox, oy: top + sy * k };
  if (mirror) { map.kx = -k; map.ox = dx + dw - (dw - sw * k) / 2 + sx * k; }
  return map;
}

// Amalgamation of 2-3 works for create mode.
export function blendSpec(pieces, aspect, { seed = 1, harmony = 0.6 } = {}) {
  const rnd = mulberry(seed);
  const order = pieces.map((p, i) => i);
  const base = pieces[(seed - 1) % pieces.length];
  const [W, H] = base.size;
  const k = Math.max(1 / W, aspect / H);
  const cover = { kx: k, ky: k, ox: -W * k / 2, oy: H * k / 2 };
  const items = [{ piece: base, layers: base.layers.filter(l => base.roles[l.id] === 'background').map(l => l.id), map: cover }];
  const baseHue = hueOf(base);
  const tint = p => p === base ? 0 : wrap(baseHue - hueOf(p)) * harmony;
  // shuffle subject order
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const n = order.length, slotW = 1 / n;
  order.forEach((pi, slot) => {
    const p = pieces[pi];
    if (!p.subject) return;
    const big = n === 1 ? 0.92 : 0.86 - rnd() * 0.12;
    const dst = [-0.5 + slot * slotW + slotW * 0.03, -aspect / 2 + aspect * big + aspect * 0.02, slotW * 0.94, aspect * big];
    const mirror = n > 1 && ((slot < n / 2) !== (subjectFacesLeft(p))) && rnd() > 0.3;
    items.push({ piece: p, layers: p.subject.layers, map: fitBox(p.subject.box, dst, 'bottom', mirror), hue: tint(p), zAdd: 0.004 * slot });
  });
  // foreground dressing borrowed from a different work than the background
  const foreFrom = pieces[(seed) % pieces.length];
  const [FW, FH] = foreFrom.size;
  const fk = Math.max(1 / FW, aspect / FH);
  items.push({ piece: foreFrom, layers: foreFrom.layers.filter(l => foreFrom.roles[l.id] === 'foreground').map(l => l.id),
               map: { kx: fk, ky: fk, ox: -FW * fk / 2, oy: FH * fk / 2 }, hue: tint(foreFrom), zAdd: 0.01 });
  return { aspect, items };
}

function subjectFacesLeft(p) { return p.subject.box[0] + p.subject.box[2] / 2 > p.size[0] / 2; }
function hueOf(p) { return p._hue ??= (() => { let x = 0, y = 0; for (const h of p.palette || []) { const [a, s] = hs(h); x += Math.cos(a) * s; y += Math.sin(a) * s; } return Math.atan2(y, x); })(); }
function hs(hex) { const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h * Math.PI / 3, d]; }
function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- the mural ----------
export class Mural {
  static async build(spec, opts = {}) {
    const m = new Mural(spec, opts);
    await m._init();
    return m;
  }

  constructor(spec, { depthScale = 1 } = {}) {
    this.spec = spec;
    this.aspect = spec.aspect;
    this.group = new THREE.Group();
    this.depthScale = depthScale;
    this.layers = [];      // {mesh, u, anims, item, meta}
    this.rigs = [];        // per item: {eyes:[...], head, blink}
    this.time = 0;
    this.speed = 1;
    this.intensity = 1;
    this.parallax = new THREE.Vector2();
    this.gazeTarget = new THREE.Vector3(0, 0, 2);
    this.lookMode = 'viewer';
  }

  async _init() {
    let order = 0;
    for (const item of this.spec.items) {
      const { piece, map } = item;
      const byId = new Map();
      const loaded = await Promise.all(item.layers.map(id => layerRaster(piece, id).then(r => [id, r])));
      for (const [id, raster] of loaded) {
        if (!raster) continue;
        const meta = piece.layerMeta.get(id) || { id, depth: 0 };
        const L = this._makeLayer(item, meta, raster, order++);
        byId.set(id, L);
      }
      this._makeRig(item, byId);
    }
    // sort by depth so nearer layers draw last
    const sorted = [...this.layers].sort((a, b) => a.z - b.z || a.order - b.order);
    sorted.forEach((L, i) => { L.mesh.renderOrder = i; this.group.add(L.mesh); });
  }

  // piece px -> local
  static P(map, x, y) { return [map.ox + x * map.kx, map.oy - y * map.ky]; }

  _makeLayer(item, meta, raster, order) {
    const { map } = item;
    const k = Math.abs(map.kx);
    const [rx, ry, rw, rh] = raster.rect;
    const [x0, yTop] = Mural.P(map, rx, ry);
    const anims = meta.anim || [];
    const needsSegs = anims.some(a => a.type === 'sway' || a.type === 'drift');
    const geo = new THREE.PlaneGeometry(1, 1, needsSegs ? 40 : 1, needsSegs ? 28 : 1);
    const z = ((meta.depth || 0) + (item.zAdd || 0)) * this.depthScale;
    const u = {
      uMap: { value: texFor(raster.canvas) }, uMask: { value: null }, uHasMask: { value: 0 },
      uRect: { value: new THREE.Vector4(x0, yTop, rw * map.kx, rh * map.ky) },
      uTime: { value: 0 }, uZ: { value: z },
      uSway: { value: new THREE.Vector4() }, uSwayRoot: { value: new THREE.Vector2() }, uSwayDir: { value: new THREE.Vector2(0, 1) }, uSwayRadial: { value: 0 },
      uDrift: { value: new THREE.Vector3() },
      uOff: { value: new THREE.Vector2() }, uScl: { value: new THREE.Vector2(1, 1) }, uSclPivot: { value: new THREE.Vector2() },
      uRot: { value: 0 }, uRotPivot: { value: new THREE.Vector2() }, uHeadOff: { value: new THREE.Vector2() },
      uParallax: { value: this.parallax }, uMaskRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFlow: { value: new THREE.Vector4() }, uFlowRoot: { value: new THREE.Vector3(0, 0, 1) },
      uHue: { value: item.hue || 0 }, uSat: { value: item.sat ?? 1 }, uOpacity: { value: 1 }, uPulse: { value: new THREE.Vector2() },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    const L = { id: meta.id, mesh, u, anims, item, z, order, k, rect: raster.rect, base: {} };
    // static anim params, converted to local units
    for (const a of anims) {
      if (a.type === 'sway') {
        const [sx, sy] = Mural.P(map, ...a.root);
        u.uSwayRoot.value.set(sx, sy);
        u.uSwayDir.value.set(a.dir[0] * Math.sign(map.kx), a.dir[1]).normalize();
        u.uSwayRadial.value = a.radial ? 1 : 0;
        L.base.sway = [a.amp * k, a.speed, a.length * k, (a.wave || 0.004) / k];
      } else if (a.type === 'flow') {
        const [fx, fy] = Mural.P(map, ...a.root);
        u.uFlowRoot.value.set(fx, fy, a.length * k);
        L.base.flow = [a.amp / rw, a.amp / rh, a.speed, a.scale * 3 / (k * 1600)];
      } else if (a.type === 'drift') {
        L.base.drift = [a.amp * k, a.speed, 9];
      } else if (a.type === 'breathe') {
        const [px, py] = Mural.P(map, ...a.pivot);
        u.uSclPivot.value.set(px, py);
        L.base.breathe = [a.amp, a.speed];
      } else if (a.type === 'pulse') {
        L.base.pulse = [a.amp, a.speed];
      }
    }
    this.layers.push(L);
    return L;
  }

  _makeRig(item, byId) {
    const { piece, map } = item;
    const r = piece.rigs || {};
    const k = Math.abs(map.kx);
    const rig = { eyes: [], head: null, blink: r.blink || { every: [3, 6], duration: 0.15 }, nextBlink: 1 + Math.random() * 2, blinkT: -1, sacc: new THREE.Vector2(), saccT: 0 };
    for (const e of r.eyes || []) {
      const white = byId.get(e.white), iris = byId.get(e.iris), lid = byId.get(e.lid);
      if (!iris) continue;
      const [cx, cy] = Mural.P(map, ...e.center);
      if (white) {
        iris.u.uMask.value = white.u.uMap.value;
        iris.u.uHasMask.value = 1;
        iris.u.uMaskRect.value.copy(white.u.uRect.value);
      }
      if (lid) {
        const [lx, ly] = Mural.P(map, ...e.lidPivot);
        lid.u.uSclPivot.value.set(lx, ly);
        lid.u.uScl.value.set(1, 0.0001);
        lid.isLid = true;
      }
      rig.eyes.push({ iris, lid, center: new THREE.Vector2(cx, cy), range: new THREE.Vector2(e.range[0] * k, e.range[1] * k) });
    }
    if (r.head) {
      const [px, py] = Mural.P(map, ...r.head.pivot);
      const layers = Object.entries(r.head.layers).map(([id, w]) => [byId.get(id), w]).filter(([L]) => L);
      for (const [L] of layers) L.u.uRotPivot.value.set(px, py);
      rig.head = { layers, maxTurn: r.head.maxTurn * Math.sign(map.kx), shift: r.head.shift * k };
    }
    rig.gaze = new THREE.Vector2();
    rig.headGaze = new THREE.Vector2();
    if (rig.eyes.length || rig.head) this.rigs.push(rig);
  }

  // Look target in local 3D (x, y, z toward viewer). null = idle wander.
  setGazeTarget(v) { if (v) this.gazeTarget.copy(v); this._hasTarget = !!v; }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.time += dt * this.speed;
    const t = this.time, I = this.intensity;
    for (const L of this.layers) {
      const u = L.u, b = L.base;
      u.uTime.value = t;
      if (b.sway) u.uSway.value.set(b.sway[0] * I, b.sway[1], b.sway[2], b.sway[3]);
      if (b.flow) u.uFlow.value.set(b.flow[0] * I, b.flow[1] * I, b.flow[2], b.flow[3]);
      if (b.drift) u.uDrift.value.set(b.drift[0] * I, b.drift[1], b.drift[2]);
      if (b.breathe) { const s = 1 + b.breathe[0] * I * Math.sin(t * b.breathe[1] * Math.PI * 2 * 0.25); u.uScl.value.set(s, 1 + (s - 1) * 1.6); }
      if (b.pulse) u.uPulse.value.set(b.pulse[0] * Math.min(1, I), b.pulse[1]);
    }
    for (const rig of this.rigs) this._updateRig(rig, dt);
  }

  _updateRig(rig, dt) {
    const I = this.intensity;
    // eye/head centre
    const c = rig.eyes.length ? rig.eyes.reduce((a, e) => a.add(e.center), new THREE.Vector2()).multiplyScalar(1 / rig.eyes.length) : new THREE.Vector2();
    // saccades: small random fixation shifts every 0.4-2.5 s
    rig.saccT -= dt;
    if (rig.saccT <= 0) {
      rig.saccT = 0.4 + Math.random() * 2.1;
      const amp = this._hasTarget ? 0.12 : 0.55;
      rig.sacc.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp * 0.6);
    }
    let gx = rig.sacc.x, gy = rig.sacc.y;
    if (this._hasTarget || this.lookMode !== 'off') {
      const T = this.gazeTarget;
      const dx = T.x - c.x, dy = T.y - c.y, dz = Math.max(0.05, T.z);
      const len = Math.hypot(dx, dy, dz);
      gx += dx / len * 1.6; gy += dy / len * 1.6;
    }
    gx = THREE.MathUtils.clamp(gx, -1, 1); gy = THREE.MathUtils.clamp(gy, -1, 1);
    const eyeEase = 1 - Math.exp(-dt * 18), headEase = 1 - Math.exp(-dt * 2.2);
    rig.gaze.x += (gx - rig.gaze.x) * eyeEase; rig.gaze.y += (gy - rig.gaze.y) * eyeEase;
    rig.headGaze.x += (gx - rig.headGaze.x) * headEase; rig.headGaze.y += (gy - rig.headGaze.y) * headEase;
    const g = rig.gaze;
    for (const e of rig.eyes) {
      e.iris.u.uOff.value.set(g.x * e.range.x * Math.min(1, I), g.y * e.range.y * Math.min(1, I));
    }
    if (rig.head) {
      const h = rig.headGaze;
      const rot = -h.x * rig.head.maxTurn * 0.5 * I;
      for (const [L, w] of rig.head.layers) {
        L.u.uRot.value = rot;
        L.u.uHeadOff.value.set(h.x * rig.head.shift * w * I, h.y * rig.head.shift * 0.5 * w * I);
      }
    }
    // blink
    if (rig.blinkT < 0) {
      rig.nextBlink -= dt * this.speed;
      if (rig.nextBlink <= 0) { rig.blinkT = 0; }
    }
    let lid = 0.0001;
    if (rig.blinkT >= 0) {
      rig.blinkT += dt;
      const d = rig.blink.duration || 0.15;
      const p = rig.blinkT / d;
      if (p >= 1) {
        rig.blinkT = -1;
        const [a, b] = rig.blink.every;
        rig.nextBlink = Math.random() < (rig.blink.double || 0) ? 0.18 : a + Math.random() * (b - a);
      } else lid = Math.max(0.0001, Math.sin(p * Math.PI) ** 0.7);
    }
    for (const e of rig.eyes) if (e.lid) { e.lid.u.uScl.value.y = lid; e.lid.mesh.visible = lid > 0.001; }
  }

  blinkNow() { for (const r of this.rigs) if (r.blinkT < 0) r.blinkT = 0; }

  dispose() {
    for (const L of this.layers) { L.mesh.geometry.dispose(); L.mesh.material.dispose(); }
    this.group.removeFromParent();
  }
}
