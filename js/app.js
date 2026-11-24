// App shell: routing, home/library, piece page, studio (QR + targets),
// QR-arrival splash, test-target screen, install hint.
import { allPieces, loadPiece, compositeCanvas, pieceURL, studioURL } from './pieces.js';
import { Preview } from './preview.js';
import { el, esc, toast } from './ui.js';
import { clearDeviceTargets, getTargets } from './targets.js';

const root = document.getElementById('app');
let unmount = null;
const go = h => { if (location.hash === h) route(); else location.hash = h; };

const params = new URLSearchParams(location.search);
const arrival = { piece: params.get('p'), src: params.get('src') };

async function route() {
  const token = {};
  route.token = token;
  if (unmount) { try { await unmount(); } catch (e) { console.warn(e); } unmount = null; }
  root.innerHTML = '';
  document.body.classList.remove('immersive');
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [name, ...args] = parts;
  try {
    if (name === 'scan') {
      document.body.classList.add('immersive');
      const { mountScan } = await import('./scan.js');
      if (route.token !== token) return;
      unmount = await mountScan(root, { pieceId: args[0] || null, go });
    } else if (name === 'create') {
      document.body.classList.add('immersive');
      const { mountCreate } = await import('./create.js');
      if (route.token !== token) return;
      unmount = await mountCreate(root, { preselect: args, go });
    } else if (name === 'piece' && args[0]) unmount = await pieceView(args[0]);
    else if (name === 'studio') unmount = await studioView();
    else if (name === 'target' && args[0]) unmount = await targetView(args[0]);
    else if (name === 'arrive' && args[0]) unmount = await arriveView(args[0]);
    else unmount = await homeView();
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="page"><p class="err">Something went wrong: ${esc(e.message)}</p><a class="btn" href="#home">Home</a></div>`;
  }
  window.scrollTo(0, 0);
}

// ---------------- home ----------------
async function homeView() {
  const pieces = await allPieces();
  const v = el(`
    <main class="page home">
      <header class="brand">
        <div class="mark" aria-hidden="true"><i></i><i></i><i></i></div>
        <div><h1>Living Murals</h1><p>Dina Saadi Studio</p></div>
      </header>
      <section class="hero">
        <canvas class="hero-art" aria-label="Animated preview of ${esc(pieces[0].title)}"></canvas>
        <div class="hero-copy">
          <h2>Point your phone at a mural and watch it wake up.</h2>
          <div class="actions">
            <a class="btn big" href="#/scan">Scan a mural</a>
            <a class="btn big ghost" href="#/create">Create on a wall</a>
          </div>
        </div>
      </section>
      <section>
        <h3 class="sec">The collection</h3>
        <div class="grid">${pieces.map(p => `
          <a class="card" href="#/piece/${encodeURIComponent(p.id)}">
            <img alt="" data-thumb="${esc(p.id)}">
            <span class="card-t">${esc(p.title)}</span>
            <span class="card-s">${esc(p.location?.label || '')}${p.placeholder ? ' · placeholder art' : ''}</span>
          </a>`).join('')}
        </div>
      </section>
      <footer class="foot">
        <a href="#/studio">Studio tools: QR codes and tracking</a>
        <span>Prototype build · working titles from the studio archive</span>
      </footer>
    </main>`);
  root.appendChild(v);
  thumbs(v, pieces);
  const prev = new Preview(v.querySelector('.hero-art'));
  prev.show(pieces[0]);
  return () => prev.dispose();
}

async function thumbs(v, pieces) {
  for (const p of pieces) {
    const c = await compositeCanvas(p, 640);
    const img = v.querySelector(`img[data-thumb="${CSS.escape(p.id)}"]`);
    if (img) img.src = c.toDataURL('image/jpeg', 0.85);
  }
}

// ---------------- piece ----------------
async function pieceView(id) {
  const piece = await loadPiece(id);
  const pieces = await allPieces();
  const v = el(`
    <main class="page piece">
      <a class="back" href="#home">← Collection</a>
      <canvas class="piece-art" aria-label="Animated ${esc(piece.title)}"></canvas>
      <p class="hint center">Move your finger over the mural: the eyes follow it.</p>
      <div class="piece-head">
        <div>
          <h2>${esc(piece.title)}</h2>
          <p class="meta">${esc(piece.artist)} · ${esc(piece.year || '')} · ${esc(piece.location?.label || '')}</p>
          ${piece.notes ? `<p>${esc(piece.notes)}</p>` : ''}
          ${piece.placeholder ? '<p class="tag">Placeholder artwork for testing</p>' : ''}
        </div>
        <div class="actions col">
          <a class="btn" href="#/scan/${encodeURIComponent(id)}">Scan this mural</a>
          <a class="btn ghost" href="#/create/${encodeURIComponent(id)}">Put it on a wall</a>
          <a class="btn ghost" href="#/target/${encodeURIComponent(id)}">Show as test target</a>
        </div>
      </div>
      ${piece.subject ? `<div class="ctl-group"><span>Swap subject (preview)</span><div class="chips">
        <button class="chip" data-swap="" aria-pressed="true">Original</button>
        ${pieces.filter(p => p.id !== id && p.subject).map(p => `<button class="chip" data-swap="${esc(p.id)}" aria-pressed="false">${esc(p.title)}</button>`).join('')}
      </div></div>` : ''}
    </main>`);
  root.appendChild(v);
  const prev = new Preview(v.querySelector('.piece-art'));
  await prev.show(piece);
  v.addEventListener('click', async e => {
    const b = e.target.closest('[data-swap]'); if (!b) return;
    v.querySelectorAll('[data-swap]').forEach(x => x.setAttribute('aria-pressed', x === b));
    await prev.show(piece, b.dataset.swap ? await loadPiece(b.dataset.swap) : null);
  });
  return () => prev.dispose();
}

// ---------------- test target (show the flat mural on a monitor) ----------------
async function targetView(id) {
  const piece = await loadPiece(id);
  const c = await compositeCanvas(piece, 2048);
  document.body.classList.add('immersive');
  const v = el(`<div class="target-screen" title="Tap to close"><img alt="${esc(piece.title)} tracking target"></div>`);
  v.querySelector('img').src = c.toDataURL('image/png');
  v.addEventListener('click', () => history.back());
  root.appendChild(v);
  return () => {};
}

// ---------------- QR arrival ----------------
async function arriveView(id) {
  let piece;
  try { piece = await loadPiece(id); } catch { go('#home'); return null; }
  const c = await compositeCanvas(piece, 900);
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const v = el(`
    <main class="page arrive">
      <p class="eyebrow">You're standing in front of</p>
      <h1>${esc(piece.title)}</h1>
      <p class="meta">${esc(piece.artist)}</p>
      <img class="arrive-art" alt="" src="${c.toDataURL('image/jpeg', 0.85)}">
      <a class="btn big" href="#/scan/${encodeURIComponent(id)}">Bring it to life</a>
      <p class="hint">The camera opens. Hold your phone so the whole mural fits on screen.</p>
      ${ios && !standalone ? `<div class="install"><b>Keep the app:</b> tap Share <span aria-hidden="true">⎋</span> then “Add to Home Screen”. It opens full-screen with the whole collection.</div>` : ''}
      <a class="link" href="#home">See the whole collection</a>
    </main>`);
  root.appendChild(v);
  return () => {};
}

// ---------------- studio ----------------
async function studioView() {
  const pieces = await allPieces();
  const qr = (text, size = 6) => {
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: size, margin: 2, scalable: true });
  };
  const v = el(`
    <main class="page studio">
      <a class="back" href="#home">← Collection</a>
      <h2>Studio tools</h2>
      <p>Each mural gets its own code: scanning it opens the app straight into that piece. The studio code (business cards, postcards) opens the collection.</p>
      <div class="qr-grid">
        <article class="qr-card">
          <div class="qr">${qr(studioURL())}</div>
          <h4>Studio card</h4><code>${esc(studioURL())}</code>
          <div class="row"><button class="btn small" data-copy="${esc(studioURL())}">Copy link</button>
          <button class="btn small ghost" data-dl="studio">Download SVG</button></div>
        </article>
        ${pieces.map(p => `
        <article class="qr-card">
          <div class="qr" data-id="${esc(p.id)}">${qr(pieceURL(p.id))}</div>
          <h4>${esc(p.title)}</h4><code>${esc(pieceURL(p.id))}</code>
          <div class="row"><button class="btn small" data-copy="${esc(pieceURL(p.id))}">Copy link</button>
          <button class="btn small ghost" data-dl="${esc(p.id)}">Download SVG</button></div>
        </article>`).join('')}
      </div>
      <h3 class="sec">Image tracking</h3>
      <p class="status">Checking…</p>
      <button class="btn ghost" data-act="rebuild">Rebuild tracking on this device</button>
      <h3 class="sec">Painting a code onto a mural</h3>
      <ul class="notes">
        <li>Keep at least 25 cm per side for a code read from 2 m away; scale up for higher walls.</li>
        <li>Dark modules on a light ground, with a quiet border two modules wide.</li>
        <li>Test the painted code with a phone before the paint cures.</li>
      </ul>
    </main>`);
  root.appendChild(v);
  const status = v.querySelector('.status');
  fetch('pieces/targets.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(info => {
    status.textContent = info ? `Prebuilt targets for ${info.ids.length} murals (${info.ids.join(', ')}), built ${info.built}.` : 'No prebuilt targets: phones compile them on first scan (takes ~20 s, then cached).';
  });
  v.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.copy) { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch { toast('Copy failed'); } }
    if (b.dataset.dl) {
      const svg = b.closest('.qr-card').querySelector('svg').outerHTML;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      a.download = `qr-${b.dataset.dl}.svg`; a.click();
    }
    if (b.dataset.act === 'rebuild') {
      await clearDeviceTargets();
      b.disabled = true;
      try { await getTargets(p => { status.textContent = `Compiling… ${Math.round(p)}%`; }); status.textContent += ' Done.'; }
      catch (err) { status.textContent = 'Compile failed: ' + err.message; }
      b.disabled = false;
    }
  });
  return () => {};
}

// ---------------- boot ----------------
window.addEventListener('hashchange', route);
if (arrival.piece && !location.hash) {
  history.replaceState(null, '', location.pathname + `#/arrive/${encodeURIComponent(arrival.piece)}`);
}
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
