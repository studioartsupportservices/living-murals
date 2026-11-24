// Small shared UI pieces: element helper, escape, controls sheet, shutter, toast.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, ms = 2600) {
  const t = el(`<div class="toast" role="status">${esc(msg)}</div>`);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('on'));
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, ms);
}

// state: {speed, intensity, look, people, swap}
export function controlsSheet(state, onChange, { swapOptions = [], people = true, blend = false } = {}) {
  const sheet = el(`
    <div class="sheet" aria-hidden="true">
      <div class="sheet-grip"></div>
      <h3>Play with the mural</h3>
      <label class="ctl"><span>Speed</span><input type="range" id="c-speed" min="0" max="2.5" step="0.05" value="${state.speed}"><output>${state.speed.toFixed(2)}×</output></label>
      <label class="ctl"><span>Motion</span><input type="range" id="c-int" min="0" max="2" step="0.05" value="${state.intensity}"><output>${Math.round(state.intensity * 100)}%</output></label>
      ${blend ? `<label class="ctl"><span>Harmony</span><input type="range" id="c-harm" min="0" max="1" step="0.05" value="${state.harmony}"><output>${Math.round(state.harmony * 100)}%</output></label>` : ''}
      <div class="ctl-group"><span>Eyes follow</span>
        <div class="seg" role="radiogroup">
          ${[['auto', 'Auto'], ['viewer', 'You'], ['people', 'People'], ['off', 'Wander']].map(([v, l]) =>
            `<button role="radio" data-look="${v}" aria-checked="${state.look === v}">${l}</button>`).join('')}
        </div>
      </div>
      ${people ? `<label class="switch"><input type="checkbox" id="c-people" ${state.people ? 'checked' : ''}><span>Keep people in front of the art</span></label>` : ''}
      ${swapOptions.length ? `<div class="ctl-group"><span>Swap subject</span>
        <div class="chips">
          <button class="chip" data-swap="" aria-pressed="${!state.swap}">Original</button>
          ${swapOptions.map(o => `<button class="chip" data-swap="${esc(o.id)}" aria-pressed="${state.swap === o.id}">${esc(o.title)}</button>`).join('')}
        </div></div>` : ''}
      ${blend ? `<button class="btn ghost wide" id="c-reshuffle">Try another arrangement</button>` : ''}
      <button class="btn ghost wide" id="c-blink">Blink</button>
    </div>`);
  const out = (id, f) => {
    const i = sheet.querySelector(id);
    if (!i) return;
    i.addEventListener('input', () => { i.nextElementSibling.textContent = f(+i.value); onChange(id, +i.value); });
  };
  out('#c-speed', v => `${v.toFixed(2)}×`);
  out('#c-int', v => `${Math.round(v * 100)}%`);
  out('#c-harm', v => `${Math.round(v * 100)}%`);
  sheet.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.look) {
      sheet.querySelectorAll('[data-look]').forEach(x => x.setAttribute('aria-checked', x === b));
      onChange('look', b.dataset.look);
    } else if (b.dataset.swap !== undefined) {
      sheet.querySelectorAll('[data-swap]').forEach(x => x.setAttribute('aria-pressed', x === b));
      onChange('swap', b.dataset.swap || null);
    } else if (b.id === 'c-reshuffle') onChange('reshuffle');
    else if (b.id === 'c-blink') onChange('blink');
  });
  sheet.querySelector('#c-people')?.addEventListener('change', e => onChange('people', e.target.checked));
  sheet.toggle = (open = sheet.getAttribute('aria-hidden') === 'true') => sheet.setAttribute('aria-hidden', String(!open));
  return sheet;
}

// Tap = photo, press and hold = video.
export function bindShutter(btn, { photo, startVideo, stopVideo }) {
  let timer = null, recording = false, t0 = 0, tick = null;
  const label = btn.querySelector('.rec-time');
  const down = e => {
    e.preventDefault();
    try { btn.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    timer = setTimeout(() => {
      timer = null;
      if (startVideo()) {
        recording = true; t0 = performance.now();
        btn.classList.add('rec');
        tick = setInterval(() => { if (label) label.textContent = fmt((performance.now() - t0) / 1000); }, 250);
      }
    }, 380);
  };
  const up = e => {
    e.preventDefault();
    if (timer) { clearTimeout(timer); timer = null; photo(); }
    else if (recording) { recording = false; btn.classList.remove('rec'); clearInterval(tick); if (label) label.textContent = ''; stopVideo(); }
  };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('contextmenu', e => e.preventDefault());
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
