// Photo + video capture of the augmented view.
// sources(): returns [{el, x, y, w, h}] in container CSS px, back to front.
export class Capture {
  constructor(container, sources) {
    this.container = container;
    this.sources = sources;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.recorder = null;
    this._photo = null;
  }

  _size(scale) {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const s = Math.min(scale, 1920 / Math.max(w, h));
    const cw = Math.round(w * s / 2) * 2, ch = Math.round(h * s / 2) * 2;
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    return s;
  }

  _draw(scale) {
    const s = this._size(scale);
    const ctx = this.ctx;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.container.clientWidth, this.container.clientHeight);
    for (const src of this.sources()) {
      if (!src || !src.el) continue;
      try { ctx.drawImage(src.el, src.x, src.y, src.w, src.h); } catch (e) { /* not ready */ }
    }
  }

  // Call right after the WebGL frame renders (the drawing buffer is only valid then).
  afterRender() {
    if (this._photo) {
      this._draw(Math.min(3, devicePixelRatio || 2));
      const resolve = this._photo; this._photo = null;
      this.canvas.toBlob(b => resolve(b), 'image/jpeg', 0.92);
    } else if (this.recorder) {
      this._draw(1.5);
    }
  }

  photo() { return new Promise(r => { this._photo = r; }); }

  startVideo() {
    if (this.recorder || !window.MediaRecorder) return false;
    this._draw(1.5);
    const stream = this.canvas.captureStream(30);
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported?.(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined);
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    this._done = new Promise(res => { rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || type || 'video/mp4' })); });
    rec.start(250);
    this.recorder = rec;
    this.startedAt = performance.now();
    return true;
  }

  async stopVideo() {
    if (!this.recorder) return null;
    const rec = this.recorder;
    this.recorder = null;
    rec.stop();
    return this._done;
  }
}

// Bottom-sheet result with save/share.
export function showResult(blob, kind, title) {
  const ext = kind === 'video' ? (blob.type.includes('webm') ? 'webm' : 'mp4') : 'jpg';
  const name = `${(title || 'mural').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.${ext}`;
  const url = URL.createObjectURL(blob);
  const wrap = document.createElement('div');
  wrap.className = 'result';
  wrap.innerHTML = `
    <div class="result-card">
      ${kind === 'video' ? `<video src="${url}" autoplay loop muted playsinline controls></video>` : `<img src="${url}" alt="Captured photo">`}
      <p class="hint">${kind === 'photo' ? 'Press and hold the image to save it to Photos, or use Share.' : 'Use Share to save the video to Photos.'}</p>
      <div class="row">
        <button class="btn" data-act="share">Share or save</button>
        <a class="btn ghost" href="${url}" download="${name}">Download</a>
        <button class="btn ghost" data-act="close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); URL.revokeObjectURL(url); };
  wrap.addEventListener('click', async e => {
    const act = e.target.dataset.act;
    if (act === 'close' || e.target === wrap) close();
    if (act === 'share') {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: title || 'Mural' }); } catch { /* cancelled */ }
      } else {
        wrap.querySelector('a[download]').click();
      }
    }
  });
}
