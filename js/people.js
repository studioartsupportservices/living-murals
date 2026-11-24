// Person detection on the camera feed (MediaPipe selfie segmentation).
// Gives two things: a soft mask so the AR art is never painted over people,
// and a head point so portraits can look at whoever is standing there.
const VER = '0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let segP = null;
async function segmenter() {
  segP ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/wasm`);
    const opts = d => ({ baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
    try { return await ImageSegmenter.createFromOptions(files, opts('GPU')); }
    catch { return await ImageSegmenter.createFromOptions(files, opts('CPU')); }
  })();
  return segP;
}

export class People {
  constructor(video) {
    this.video = video;
    this.mask = document.createElement('canvas');
    this.maskCtx = this.mask.getContext('2d', { willReadFrequently: true });
    this.head = null;          // {x, y} normalized in video frame, or null
    this.present = false;
    this.enabled = false;
    this.ready = false;
    this.error = null;
    this._last = 0;
    this._busy = false;
    this.interval = 90;        // ms between segmentations
  }

  async enable() {
    this.enabled = true;
    try { this.seg = await segmenter(); this.ready = true; }
    catch (e) { this.error = e; this.enabled = false; console.warn('people detection unavailable', e); }
  }
  disable() { this.enabled = false; this.present = false; this.head = null; }

  tick(now) {
    if (!this.enabled || !this.ready || this._busy) return;
    const v = this.video;
    if (!v || v.readyState < 2 || now - this._last < this.interval) return;
    this._last = now;
    this._busy = true;
    try {
      this.seg.segmentForVideo(v, now, res => {
        const m = res.confidenceMasks && res.confidenceMasks[0];
        if (m) this._ingest(m.getAsFloat32Array(), m.width, m.height);
      });
    } catch (e) { console.warn(e); }
    this._busy = false;
  }

  _ingest(data, w, h) {
    if (this.mask.width !== w || this.mask.height !== h) { this.mask.width = w; this.mask.height = h; }
    const img = this.maskCtx.createImageData(w, h);
    const px = img.data;
    let count = 0, top = h, sumX = 0, n = 0;
    const colHits = new Float32Array(w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, v = data[i];
        const a = Math.max(0, Math.min(1, (v - 0.35) / 0.3));
        px[i * 4 + 3] = a * 255;
        if (v > 0.5) { count++; if (y < top) top = y; colHits[x]++; }
      }
    }
    this.maskCtx.putImageData(img, 0, 0);
    this.present = count > w * h * 0.02;
    if (!this.present) { this.head = null; return; }
    // head ≈ centre of the mask pixels in the band just below the top of the blob
    const band = Math.max(3, Math.round(h * 0.08));
    for (let y = top; y < Math.min(h, top + band); y++) for (let x = 0; x < w; x++) {
      if (data[y * w + x] > 0.5) { sumX += x; n++; }
    }
    const hx = n ? sumX / n / w : 0.5, hy = (top + band * 0.6) / h;
    this.head = this.head ? { x: this.head.x * 0.6 + hx * 0.4, y: this.head.y * 0.6 + hy * 0.4 } : { x: hx, y: hy };
  }

  // Draw people (video pixels under the mask) into ctx over rect.
  drawCutout(ctx, rect) {
    if (!this.present) return;
    const { x, y, w, h } = rect;
    ctx.save();
    ctx.drawImage(this.video, x, y, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mask, x, y, w, h);
    ctx.restore();
  }
}

// rect where a video is shown with object-fit: cover inside (cw, ch)
export function coverRect(vw, vh, cw, ch) {
  const s = Math.max(cw / vw, ch / vh);
  const w = vw * s, h = vh * s;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}
