// Scan mode: image-track a mural on the wall and replace it, in place, with
// its animated version. People stay in front; eyes follow them or you.
import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';
import { loadPiece, allPieces } from './pieces.js';
import { Mural, pieceSpec } from './mural.js';
import { getTargets } from './targets.js';
import { People } from './people.js';
import { Capture, showResult } from './capture.js';
import { el, esc, controlsSheet, bindShutter, toast } from './ui.js';

export async function mountScan(root, { pieceId = null, go }) {
  const view = el(`
    <section class="ar" aria-label="Scan a mural">
      <div class="stage"></div>
      <canvas class="occl"></canvas>
      <div class="scan-frame"><div class="corners"></div><p class="scan-msg">Getting the camera ready…</p></div>
      <header class="hud top">
        <button class="icon-btn" data-act="back" aria-label="Back">←</button>
        <div class="hud-title"><b class="t">Scan</b><small class="s"></small></div>
        <button class="icon-btn" data-act="tools" aria-label="Controls">⋯</button>
      </header>
      <footer class="hud bottom">
        <span class="hint-left">Tap for photo<br>Hold for video</span>
        <button class="shutter" aria-label="Take photo, hold for video"><span class="rec-time"></span></button>
        <span class="hint-right"></span>
      </footer>
    </section>`);
  root.appendChild(view);
  const stage = view.querySelector('.stage'), occl = view.querySelector('.occl');
  const msg = view.querySelector('.scan-msg'), frame = view.querySelector('.scan-frame');
  const titleEl = view.querySelector('.hud-title .t'), subEl = view.querySelector('.hud-title .s');
  const state = { speed: 1, intensity: 1, look: 'auto', people: true, swap: null };
  const pieces = await allPieces();
  let current = null; // {piece, mural, anchor}
  let mindar = null, people = null, capture = null, stopped = false;
  const murals = new Map();

  const sheet = controlsSheet(state, async (k, v) => {
    if (k === '#c-speed') state.speed = v;
    else if (k === '#c-int') state.intensity = v;
    else if (k === 'look') state.look = v;
    else if (k === 'blink') current?.mural.blinkNow();
    else if (k === 'people') { state.people = v; v ? people?.enable() : people?.disable(); }
    else if (k === 'swap') { state.swap = v; if (current) await attach(current.anchor, current.piece, true); }
    applyState();
  }, { swapOptions: pieces.map(p => ({ id: p.id, title: p.title })) });
  view.appendChild(sheet);

  function applyState() {
    for (const m of murals.values()) { m.speed = state.speed; m.intensity = state.intensity; m.lookMode = state.look; }
  }

  view.addEventListener('click', e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'back') go('#home');
    if (a === 'tools') sheet.toggle();
  });

  async function attach(anchor, piece, rebuild = false) {
    const swapWith = state.swap && state.swap !== piece.id ? await loadPiece(state.swap) : null;
    const key = piece.id + '|' + (swapWith?.id || '');
    if (current && current.anchor === anchor && current.key === key && !rebuild) return;
    let mural = murals.get(key);
    if (!mural) {
      mural = await Mural.build(pieceSpec(piece, { swapWith }));
      murals.set(key, mural);
    }
    anchor.group.children.slice().forEach(c => anchor.group.remove(c));
    anchor.group.add(mural.group);
    current = { piece, mural, anchor, key };
    applyState();
    titleEl.textContent = piece.title;
    subEl.textContent = swapWith ? `with ${swapWith.title}` : piece.artist;
  }

  // ---- start AR ----
  let targets;
  try {
    targets = await getTargets(p => { msg.textContent = `Learning the murals… ${Math.round(p)}%`; });
  } catch (e) {
    msg.textContent = 'Could not prepare image tracking on this device.';
    console.error(e);
    return () => view.remove();
  }
  if (stopped) return () => {};
  mindar = new MindARThree({
    container: stage, imageTargetSrc: targets.src, maxTrack: 1,
    uiLoading: 'no', uiScanning: 'no', uiError: 'no',
    filterMinCF: 0.0001, filterBeta: 0.001, missTolerance: 6, warmupTolerance: 3,
  });
  const { renderer, scene, camera } = mindar;
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));

  const anchors = targets.ids.map((id, i) => {
    const a = mindar.addAnchor(i);
    a.onTargetFound = async () => {
      frame.classList.add('found');
      const piece = await loadPiece(id);
      await attach(a, piece);
    };
    a.onTargetLost = () => { frame.classList.remove('found'); msg.textContent = 'Point at the whole mural'; };
    return a;
  });

  msg.textContent = 'Starting camera…';
  try {
    await mindar.start();
  } catch (e) {
    msg.innerHTML = 'Camera unavailable. Allow camera access for this site in Settings › Safari › Camera, then reload.';
    return () => view.remove();
  }
  const want = pieceId && pieces.find(p => p.id === pieceId);
  msg.textContent = want ? `Point at “${want.title}”` : 'Point at any Dina Saadi mural';
  if (want) { titleEl.textContent = want.title; subEl.textContent = 'Looking for the mural…'; }

  people = new People(mindar.video);
  if (state.people) people.enable().then(() => { if (people.error) toast('People detection is off on this device'); });

  const octx = occl.getContext('2d');
  const videoRect = () => {
    const s = mindar.video.style;
    return { x: parseFloat(s.left) || 0, y: parseFloat(s.top) || 0, w: parseFloat(s.width) || stage.clientWidth, h: parseFloat(s.height) || stage.clientHeight };
  };
  capture = new Capture(view, () => {
    const r = videoRect();
    return [{ el: mindar.video, ...r },
            { el: renderer.domElement, x: 0, y: 0, w: view.clientWidth, h: view.clientHeight },
            { el: occl, x: 0, y: 0, w: view.clientWidth, h: view.clientHeight }];
  });
  bindShutter(view.querySelector('.shutter'), {
    photo: async () => { flash(view); const b = await capture.photo(); showResult(b, 'photo', current?.piece.title); },
    startVideo: () => capture.startVideo(),
    stopVideo: async () => { const b = await capture.stopVideo(); if (b) showResult(b, 'video', current?.piece.title); },
  });

  const ray = new THREE.Raycaster(), inv = new THREE.Matrix4(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), target = new THREE.Vector3();
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    const cw = view.clientWidth, ch = view.clientHeight, dpr = Math.min(2, devicePixelRatio);
    if (occl.width !== Math.round(cw * dpr)) { occl.width = Math.round(cw * dpr); occl.height = Math.round(ch * dpr); }
    people?.tick(now);
    if (current && current.anchor.visible) {
      const g = current.anchor.group;
      g.updateMatrixWorld();
      inv.copy(g.matrixWorld).invert();
      let haveTarget = false;
      const usePeople = (state.look === 'auto' || state.look === 'people') && people?.head;
      if (usePeople) {
        const r = videoRect();
        const X = r.x + people.head.x * r.w, Y = r.y + people.head.y * r.h;
        ray.setFromCamera({ x: X / cw * 2 - 1, y: -(Y / ch * 2 - 1) }, camera);
        tmp.copy(ray.ray.origin).applyMatrix4(inv);
        tmp2.copy(ray.ray.origin).add(ray.ray.direction).applyMatrix4(inv).sub(tmp);
        if (Math.abs(tmp2.z) > 1e-6) {
          const t = (0.3 - tmp.z) / tmp2.z;
          if (t > 0) { target.copy(tmp).addScaledVector(tmp2, t); haveTarget = true; }
        }
      }
      if (!haveTarget && (state.look === 'auto' || state.look === 'viewer')) {
        target.set(0, 0, 0).applyMatrix4(inv); // camera sits at the world origin
        haveTarget = true;
      }
      current.mural.setGazeTarget(haveTarget ? target : null);
      current.mural.update(dt);
    }
    renderer.render(scene, camera);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, cw, ch);
    if (state.people && people?.present && current?.anchor.visible) people.drawCutout(octx, videoRect());
    capture.afterRender();
  });

  return () => {
    stopped = true;
    try { renderer.setAnimationLoop(null); mindar.stop(); } catch { /* already stopped */ }
    people?.disable();
    for (const m of murals.values()) m.dispose();
    renderer.dispose();
    view.remove();
  };
}

export function flash(view) {
  const f = el('<div class="flash"></div>');
  view.appendChild(f);
  setTimeout(() => f.remove(), 350);
}
