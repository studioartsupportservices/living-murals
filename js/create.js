// Create mode: put one work, or a blend of 2-3, on any blank wall.
// No LiDAR / plane detection on the web, so the wall is defined by dragging
// four corners (perspective-correct via a homography); "Lock to wall" uses the
// gyroscope to hold it in place as you move the phone.
import * as THREE from 'three';
import { allPieces } from './pieces.js';
import { Mural, pieceSpec, blendSpec } from './mural.js';
import { People, coverRect } from './people.js';
import { Capture, showResult } from './capture.js';
import { el, esc, controlsSheet, bindShutter, toast } from './ui.js';
import { flash } from './scan.js';

const QUAD_FRAG = /* glsl */`
uniform sampler2D uTex; uniform mat3 uHinv; uniform vec2 uShift;
void main() {
  vec3 q = uHinv * vec3(gl_FragCoord.xy - uShift, 1.0);
  vec2 uv = q.xy / q.z;
  if (q.z <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  gl_FragColor = texture2D(uTex, uv);
}`;

export async function mountCreate(root, { preselect = [], go }) {
  const pieces = await allPieces();
  const view = el(`
    <section class="ar create" aria-label="Create on a wall">
      <video class="cam" playsinline muted autoplay></video>
      <canvas class="gl"></canvas>
      <canvas class="occl"></canvas>
      <div class="handles">${[0, 1, 2, 3].map(i => `<div class="handle" data-i="${i}"></div>`).join('')}</div>
      <header class="hud top">
        <button class="icon-btn" data-act="back" aria-label="Back">←</button>
        <div class="hud-title"><b class="t">Create</b><small class="s">Drag the corners onto your wall</small></div>
        <button class="icon-btn" data-act="tools" aria-label="Controls">⋯</button>
      </header>
      <div class="create-bar">
        <button class="pill" data-act="pick">Works</button>
        <button class="pill" data-act="lock" aria-pressed="false">Lock to wall</button>
        <button class="pill" data-act="edit" aria-pressed="true">Corners</button>
        <button class="pill" data-act="fit">Reset</button>
      </div>
      <footer class="hud bottom">
        <span class="hint-left">Tap for photo<br>Hold for video</span>
        <button class="shutter" aria-label="Take photo, hold for video"><span class="rec-time"></span></button>
        <span class="hint-right"></span>
      </footer>
      <div class="picker" aria-hidden="true">
        <div class="sheet-grip"></div>
        <h3>Pick 1 to 3 works</h3>
        <p class="hint">Pick more than one and the app blends them into one composition for this wall.</p>
        <div class="pick-grid">${pieces.map(p => `
          <button class="pick" data-id="${esc(p.id)}" aria-pressed="false">
            <img alt="" data-thumb="${esc(p.id)}"><span>${esc(p.title)}</span></button>`).join('')}
        </div>
        <button class="btn wide" data-act="apply">Put it on the wall</button>
      </div>
    </section>`);
  root.appendChild(view);
  const video = view.querySelector('.cam'), glc = view.querySelector('.gl'), occl = view.querySelector('.occl');
  const handles = [...view.querySelectorAll('.handle')], picker = view.querySelector('.picker');
  const subEl = view.querySelector('.hud-title .s');
  const state = { speed: 1, intensity: 1, look: 'auto', people: true, swap: null, harmony: 0.6, seed: 1 };
  let selected = preselect.length ? preselect.slice(0, 3) : [pieces[0].id];
  let mural = null, aspect = 0.625, stopped = false;

  // thumbnails
  import('./pieces.js').then(async ({ compositeCanvas }) => {
    for (const p of pieces) {
      const c = await compositeCanvas(p, 320);
      const img = view.querySelector(`img[data-thumb="${CSS.escape(p.id)}"]`);
      if (img) img.src = c.toDataURL('image/jpeg', 0.8);
    }
  });
  const syncPicks = () => view.querySelectorAll('.pick').forEach(b => b.setAttribute('aria-pressed', selected.includes(b.dataset.id)));
  syncPicks();

  // ---- renderer: art -> render target -> homography quad on screen ----
  const renderer = new THREE.WebGLRenderer({ canvas: glc, alpha: true, antialias: false });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const artScene = new THREE.Scene();
  const artCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.3, -0.3, -10, 10);
  let rt = new THREE.WebGLRenderTarget(16, 16);
  const quadMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: rt.texture }, uHinv: { value: new THREE.Matrix3() }, uShift: { value: new THREE.Vector2() } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: QUAD_FRAG, transparent: true, depthTest: false,
  });
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const quadCam = new THREE.Camera();

  // corners in CSS px: TL, TR, BR, BL
  let corners = [];
  function fitCorners() {
    const w = view.clientWidth, h = view.clientHeight;
    const qw = Math.min(w * 0.86, (h * 0.5) / aspect), qh = qw * aspect;
    const x = (w - qw) / 2, y = h * 0.42 - qh / 2;
    corners = [[x, y], [x + qw, y], [x + qw, y + qh], [x, y + qh]];
    shift.set(0, 0); lockBase = null;
    placeHandles();
  }
  const shift = new THREE.Vector2(); // gyro compensation in CSS px
  function placeHandles() {
    handles.forEach((h, i) => { h.style.transform = `translate(${corners[i][0] + shift.x}px, ${corners[i][1] + shift.y}px)`; });
  }

  async function rebuild() {
    const chosen = selected.map(id => pieces.find(p => p.id === id)).filter(Boolean);
    let spec;
    if (chosen.length === 1) {
      const swapWith = state.swap ? pieces.find(p => p.id === state.swap) : null;
      spec = pieceSpec(chosen[0], { swapWith: swapWith?.id !== chosen[0].id ? swapWith : null });
    } else {
      spec = blendSpec(chosen, wallAspect(), { seed: state.seed, harmony: state.harmony });
    }
    const next = await Mural.build(spec, { depthScale: 1 });
    if (stopped) { next.dispose(); return; }
    mural?.dispose();
    mural = next;
    const prevAspect = aspect;
    aspect = spec.aspect;
    artScene.add(mural.group);
    artCam.top = aspect / 2; artCam.bottom = -aspect / 2; artCam.updateProjectionMatrix();
    const rw = 1600, rh = Math.round(1600 * aspect);
    rt.dispose();
    rt = new THREE.WebGLRenderTarget(rw, rh, { samples: 0 });
    quadMat.uniforms.uTex.value = rt.texture;
    if (!corners.length || (chosen.length === 1 && Math.abs(prevAspect - aspect) > 0.01)) fitCorners();
    subEl.textContent = chosen.length > 1 ? `Blend of ${chosen.map(p => p.title).join(' + ')}` : chosen[0].title;
    applyState();
  }
  function applyState() { if (mural) { mural.speed = state.speed; mural.intensity = state.intensity; mural.lookMode = state.look; } }
  function wallAspect() {
    if (!corners.length) return aspect;
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const w = (d(corners[0], corners[1]) + d(corners[3], corners[2])) / 2;
    const h = (d(corners[0], corners[3]) + d(corners[1], corners[2])) / 2;
    return THREE.MathUtils.clamp(h / w, 0.3, 1.6);
  }

  // ---- controls ----
  const sheet = controlsSheet(state, async (k, v) => {
    if (k === '#c-speed') state.speed = v;
    else if (k === '#c-int') state.intensity = v;
    else if (k === '#c-harm') { state.harmony = v; clearTimeout(rebuild._t); rebuild._t = setTimeout(rebuild, 250); }
    else if (k === 'look') state.look = v;
    else if (k === 'blink') mural?.blinkNow();
    else if (k === 'people') { state.people = v; v ? people.enable() : people.disable(); }
    else if (k === 'swap') { state.swap = v; await rebuild(); }
    else if (k === 'reshuffle') { state.seed++; await rebuild(); }
    applyState();
  }, { swapOptions: pieces.map(p => ({ id: p.id, title: p.title })), blend: true });
  view.appendChild(sheet);

  let editing = true, locked = false, lockBase = null;
  view.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'back') go('#home');
    else if (a === 'tools') sheet.toggle();
    else if (a === 'pick') picker.setAttribute('aria-hidden', 'false');
    else if (a === 'apply') { picker.setAttribute('aria-hidden', 'true'); state.seed = 1; await rebuild(); }
    else if (a === 'fit') fitCorners();
    else if (a === 'edit') { editing = !editing; b.setAttribute('aria-pressed', editing); view.classList.toggle('no-edit', !editing); }
    else if (a === 'lock') {
      if (!locked) {
        const ok = await askMotion();
        if (!ok) { toast('Motion access is needed to lock to the wall'); return; }
        locked = true; lockBase = null;
      } else { locked = false; bakeShift(); }
      b.setAttribute('aria-pressed', locked);
    }
  });
  picker.addEventListener('click', e => {
    const b = e.target.closest('.pick'); if (!b) return;
    const id = b.dataset.id;
    if (selected.includes(id)) { if (selected.length > 1) selected = selected.filter(x => x !== id); }
    else if (selected.length < 3) selected.push(id);
    else toast('Up to 3 works');
    syncPicks();
  });

  // ---- corner + whole-quad dragging, pinch to scale ----
  const pointers = new Map();
  let dragMode = null, startCorners = null, startPts = null;
  view.addEventListener('pointerdown', e => {
    if (!editing || e.target.closest('button, .sheet, .picker, .hud, .create-bar')) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const h = e.target.closest('.handle');
    if (h) dragMode = { corner: +h.dataset.i };
    else if (insideQuad(e.clientX - shift.x, e.clientY - shift.y) || pointers.size === 2) dragMode = { all: true };
    else return;
    startCorners = corners.map(c => c.slice());
    startPts = new Map(pointers);
    try { view.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
  });
  view.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId) || !dragMode) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (dragMode.corner !== undefined) {
      const [sx, sy] = startPts.get(e.pointerId) || [e.clientX, e.clientY];
      const c = startCorners[dragMode.corner];
      corners[dragMode.corner] = [c[0] + e.clientX - sx, c[1] + e.clientY - sy];
    } else if (pointers.size >= 2 && startPts.size >= 2) {
      const [a0, b0] = [...startPts.values()], [a1, b1] = [...pointers.values()];
      const s = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]) / Math.max(1, Math.hypot(a0[0] - b0[0], a0[1] - b0[1]));
      const c0 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2], c1 = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
      corners = startCorners.map(([x, y]) => [c1[0] + (x - c0[0]) * s, c1[1] + (y - c0[1]) * s]);
    } else {
      const [sx, sy] = startPts.get(e.pointerId) || [e.clientX, e.clientY];
      corners = startCorners.map(([x, y]) => [x + e.clientX - sx, y + e.clientY - sy]);
    }
    placeHandles();
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragMode = null;
    else { startCorners = corners.map(c => c.slice()); startPts = new Map(pointers); }
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  function insideQuad(x, y) {
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const [xi, yi] = corners[i], [xj, yj] = corners[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ---- gyro: hold the quad still in the world, and feed parallax ----
  let orient = null;
  const onOrient = e => { orient = { a: e.alpha || 0, b: e.beta || 0, g: e.gamma || 0 }; };
  async function askMotion() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', onOrient);
      return true;
    } catch { return false; }
  }
  function bakeShift() { corners = corners.map(([x, y]) => [x + shift.x, y + shift.y]); shift.set(0, 0); lockBase = null; placeHandles(); }
  const pxPerDeg = () => view.clientHeight / 60;
  const angDiff = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

  // ---- camera ----
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = stream;
    await video.play().catch(() => {});
  } catch (e) {
    subEl.textContent = 'Camera unavailable: allow camera access, then reload';
  }
  const people = new People(video);
  if (state.people) people.enable();

  await rebuild();
  if (!preselect.length) picker.setAttribute('aria-hidden', 'false');

  const capture = new Capture(view, () => {
    const r = vRect();
    return [{ el: video, ...r }, { el: glc, x: 0, y: 0, w: view.clientWidth, h: view.clientHeight }, { el: occl, x: 0, y: 0, w: view.clientWidth, h: view.clientHeight }];
  });
  const vRect = () => coverRect(video.videoWidth || 16, video.videoHeight || 9, view.clientWidth, view.clientHeight);
  bindShutter(view.querySelector('.shutter'), {
    photo: async () => { flash(view); const b = await capture.photo(); showResult(b, 'photo', 'Wall'); },
    startVideo: () => capture.startVideo(),
    stopVideo: async () => { const b = await capture.stopVideo(); if (b) showResult(b, 'video', 'Wall'); },
  });

  // ---- loop ----
  const octx = occl.getContext('2d');
  const H = new THREE.Matrix3(), target = new THREE.Vector3();
  let last = performance.now(), raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    const cw = view.clientWidth, ch = view.clientHeight, dpr = renderer.getPixelRatio();
    if (glc.width !== Math.round(cw * dpr) || glc.height !== Math.round(ch * dpr)) {
      renderer.setSize(cw, ch, false);
      occl.width = Math.round(cw * dpr); occl.height = Math.round(ch * dpr);
    }
    people.tick(now);
    // gyro
    if (orient) {
      if (!lockBase) lockBase = { ...orient };
      const dYaw = angDiff(orient.a, lockBase.a), dPitch = orient.b - lockBase.b;
      if (locked) { shift.set(dYaw * pxPerDeg(), dPitch * pxPerDeg()); placeHandles(); }
      mural?.parallax.set(THREE.MathUtils.clamp(dYaw / 25, -1, 1) * 0.35, THREE.MathUtils.clamp(-dPitch / 25, -1, 1) * 0.35);
    }
    if (mural) {
      // gaze: person on screen -> wall uv -> local; else straight out at the viewer
      let have = false;
      if ((state.look === 'auto' || state.look === 'people') && people.head) {
        const r = vRect();
        const X = r.x + people.head.x * r.w - shift.x, Y = r.y + people.head.y * r.h - shift.y;
        const uv = screenToUV(X, Y);
        if (uv) { target.set(uv[0] - 0.5, (0.5 - uv[1]) * aspect, 0.3); have = true; }
      }
      if (!have && (state.look === 'auto' || state.look === 'viewer')) {
        target.set((mural.parallax.x) * 1.2, (mural.parallax.y) * 1.2, 1.4); have = true;
      }
      mural.setGazeTarget(have ? target : null);
      mural.update(dt);
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(artScene, artCam);
      renderer.setRenderTarget(null);
      // homography: uv (0..1, v up) -> device px (origin bottom-left)
      const toDev = ([x, y]) => [x * dpr, (ch - y) * dpr];
      const h = homography([[0, 1], [1, 1], [1, 0], [0, 0]], corners.map(toDev));
      H.set(...h).invert();
      quadMat.uniforms.uHinv.value.copy(H);
      quadMat.uniforms.uShift.value.set(shift.x * dpr, -shift.y * dpr);
      renderer.clear();
      renderer.render(quadScene, quadCam);
    }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, cw, ch);
    if (state.people && people.present) people.drawCutout(octx, vRect());
    capture.afterRender();
  }
  function screenToUV(x, y) {
    const h = homography([[0, 0], [1, 0], [1, 1], [0, 1]], corners);
    const m = new THREE.Matrix3().set(...h).invert().elements; // column-major
    const X = m[0] * x + m[3] * y + m[6], Y = m[1] * x + m[4] * y + m[7], Z = m[2] * x + m[5] * y + m[8];
    return Z ? [X / Z, Y / Z] : null;
  }
  frame();

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('deviceorientation', onOrient);
    stream?.getTracks().forEach(t => t.stop());
    people.disable();
    mural?.dispose();
    rt.dispose();
    renderer.dispose();
    view.remove();
  };
}

// 3x3 homography (row-major array of 9) mapping 4 src points to 4 dst points.
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}
