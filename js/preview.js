// Camera-free animated preview of a piece (piece page, studio review).
// The eyes follow your finger or pointer.
import * as THREE from 'three';
import { Mural, pieceSpec } from './mural.js';

export class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.3, -0.3, -10, 10);
    this.mural = null;
    this.target = null;
    this._last = performance.now();
    const move = e => {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (0.5 - (e.clientY - r.top) / r.height) * (this.mural?.aspect || 0.6);
      this.target = new THREE.Vector3(x, y, 0.35);
      this.mural?.parallax.set(-x * 0.5, -y * 0.5);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('pointerleave', () => { this.target = null; this.mural?.parallax.set(0, 0); });
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  async show(piece, swapWith = null) {
    const m = await Mural.build(pieceSpec(piece, { swapWith }));
    this.mural?.dispose();
    this.mural = m;
    this.scene.add(m.group);
    this.cam.top = m.aspect / 2; this.cam.bottom = -m.aspect / 2;
    this.cam.updateProjectionMatrix();
    return m;
  }

  _loop() {
    this._raf = requestAnimationFrame(this._loop);
    const now = performance.now(), dt = (now - this._last) / 1000; this._last = now;
    const c = this.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    const dpr = this.renderer.getPixelRatio();
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) this.renderer.setSize(w, h, false);
    if (!this.mural) return;
    // letterbox the mural inside the canvas
    const a = this.mural.aspect, ca = h / w;
    if (ca > a) { this.cam.left = -0.5; this.cam.right = 0.5; this.cam.top = ca / 2; this.cam.bottom = -ca / 2; }
    else { const hw = a / ca / 2; this.cam.left = -hw; this.cam.right = hw; this.cam.top = a / 2; this.cam.bottom = -a / 2; }
    this.cam.updateProjectionMatrix();
    this.mural.setGazeTarget(this.target || new THREE.Vector3(0, 0, 1.5));
    this.mural.update(dt);
    this.renderer.render(this.scene, this.cam);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.mural?.dispose();
    this.renderer.dispose();
  }
}
