// Runs adjustments and filters on the active layer (inside the selection), with a live preview
// while the dialog is open. The pixel work happens in a worker.

import { el, ctx2d, canvas, store, nextFrame } from './util.js';
import { app, paintable, status } from './state.js';
import { FILTERS, runFilter, curveTable } from './filters.js';
import { dialog, sliderRow, checkRow, selectRow } from './dialogs.js';

let worker = null;
let seq = 0;
const waiting = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./filter-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(new Uint8ClampedArray(e.data.data));
    };
    worker.onerror = () => { worker = false; for (const w of waiting.values()) w.reject(new Error('worker failed')); waiting.clear(); };
  } catch { worker = false; }
  return worker;
}

/** The filter on a copy of `img` (ImageData); resolves with the new pixels */
export function compute(name, params, img, mask) {
  const w = getWorker();
  const data = img.data.slice();
  if (!w) return Promise.resolve(runFilter(name, data, img.width, img.height, params, mask));
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, {
      resolve, reject: () => {
        // fall back to running it here
        try { resolve(runFilter(name, img.data.slice(), img.width, img.height, params, mask)); } catch (e) { reject(e); }
      },
    });
    const m = mask ? mask.slice() : null;
    w.postMessage({ id, name, params, w: img.width, h: img.height, data: data.buffer, mask: m ? m.buffer : null }, m ? [data.buffer, m.buffer] : [data.buffer]);
  });
}

function defaults(name) {
  const f = FILTERS[name];
  const saved = store.get('filter.' + name, null);
  const p = {};
  for (const fld of f.fields || []) p[fld.id] = saved && saved[fld.id] !== undefined ? saved[fld.id] : fld.value;
  if (f.custom === 'curves') return saved || { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
  return p;
}

/** Opens the filter's dialog (or runs it straight away when it has no settings) */
export async function runFilterUI(name, { repeat = false } = {}) {
  const d = app.doc;
  if (!d) return;
  const l = paintable();
  if (!l) return;
  const f = FILTERS[name];
  const img = ctx2d(l.canvas).getImageData(0, 0, d.width, d.height);
  const mask = d.sel ? d.sel.mask : null;
  const out = canvas(d.width, d.height);
  const go = ctx2d(out);

  const apply = (data) => {
    const g = d.editable(l);
    g.putImageData(new ImageData(data, d.width, d.height), 0, 0);
    d.commit(f.name);
  };

  if ((!f.fields && !f.custom) || repeat) {
    const params = repeat && app.lastFilter?.name === name ? app.lastFilter.params : defaults(name);
    status(`${f.name}…`);
    await nextFrame();
    try {
      apply(await compute(name, params, img, mask));
      app.lastFilter = { name, params };
      status('');
    } catch (e) { status(`${f.name} didn't work: ${e.message}`, 'danger'); }
    return;
  }

  const params = defaults(name);
  let previewOn = true;
  let latest = null;   // { key, data } of the last finished preview
  let running = false, again = false;
  const keyOf = () => JSON.stringify(params);
  const busy = el('span', { class: 'busy' });

  const preview = async () => {
    if (running) { again = true; return; }
    running = true;
    busy.textContent = 'Working…';
    try {
      do {
        again = false;
        const key = keyOf();
        const data = await compute(name, JSON.parse(key), img, mask);
        latest = { key, data };
        if (!again && previewOn && keyOf() === key) {
          go.putImageData(new ImageData(data, d.width, d.height), 0, 0);
          d.preview = { layer: l, canvas: out };
          d.changed();
        }
      } while (again);
    } catch (e) { status(`${f.name} didn't work: ${e.message}`, 'danger'); }
    running = false;
    busy.textContent = '';
  };
  let timer;
  const changed = () => { clearTimeout(timer); timer = setTimeout(preview, 60); };

  const body = el('div', { class: 'filter-body' });
  const curves = f.custom === 'curves' ? curvesEditor(params, changed) : null;
  if (curves) body.append(curves);
  const controls = [];
  for (const fld of f.fields || []) {
    const set = (v) => { params[fld.id] = v; changed(); };
    const row = fld.type === 'check' ? checkRow(fld.label, params[fld.id], set)
      : fld.type === 'select' ? selectRow(fld.label, fld.options, params[fld.id], set)
        : sliderRow(fld, params[fld.id], set);
    controls.push({ fld, row });
    body.append(row);
  }
  const reset = () => {
    for (const { fld, row } of controls) {
      params[fld.id] = fld.value;
      if (row.set) row.set(fld.value);
      else if (fld.type === 'check') row.input.checked = fld.value;
      else row.input.value = fld.value;
    }
    if (curves) curves.reset();
    changed();
  };
  body.append(el('div', { class: 'row preview-row' },
    checkRow('Preview', true, (v) => { previewOn = v; if (v) preview(); else { d.preview = null; d.changed(); } }),
    el('span', { class: 'spacer' }),
    busy,
    el('button', { class: 'btn small', onclick: reset }, 'Reset')));

  preview();
  const result = await dialog({ title: f.name, body, wide: !!curves });  clearTimeout(timer);
  if (!result) { d.preview = null; d.changed(); return; }
  store.set('filter.' + name, params);
  app.lastFilter = { name, params: JSON.parse(keyOf()) };
  let data = latest && latest.key === keyOf() ? latest.data : null;
  if (!data) {
    status(`${f.name}…`);
    while (running) await new Promise(r => setTimeout(r, 30));
    data = latest && latest.key === keyOf() ? latest.data : await compute(name, JSON.parse(keyOf()), img, mask);
    status('');
  }
  d.preview = null;
  apply(data);
}

/** The Curves graph: click to add a point, drag to move it, drag it off the graph to remove it */
function curvesEditor(params, changed) {
  const size = 256;
  const c = canvas(size, size);
  c.className = 'curves';
  let ch = 'rgb';
  let drag = -1;
  const g = ctx2d(c);
  const draw = () => {
    g.fillStyle = '#181a1c';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = '#383b40';
    g.lineWidth = 1;
    g.beginPath();
    for (let k = 1; k < 4; k++) { g.moveTo((k * size) / 4 + 0.5, 0); g.lineTo((k * size) / 4 + 0.5, size); g.moveTo(0, (k * size) / 4 + 0.5); g.lineTo(size, (k * size) / 4 + 0.5); }
    g.moveTo(0, size); g.lineTo(size, 0);
    g.stroke();
    const t = curveTable(params[ch]);
    g.strokeStyle = { rgb: '#e8e9eb', r: '#f87171', g: '#4ade80', b: '#60a5fa' }[ch];
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < 256; x++) { const y = 255 - t[x]; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    for (const [x, y] of params[ch]) { g.fillStyle = '#e8650f'; g.fillRect(x - 4, 255 - y - 4, 8, 8); }
  };
  const pos = (e) => {
    const r = c.getBoundingClientRect();
    return [Math.max(0, Math.min(255, Math.round(((e.clientX - r.left) / r.width) * 255))), Math.max(0, Math.min(255, Math.round(255 - ((e.clientY - r.top) / r.height) * 255)))];
  };
  c.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e);
    const pts = params[ch];
    drag = pts.findIndex(([px, py]) => Math.abs(px - x) < 8 && Math.abs(py - y) < 8);
    if (drag < 0) { pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]); drag = pts.findIndex(p => p[0] === x && p[1] === y); }
    c.setPointerCapture(e.pointerId);
    draw(); changed();
  });
  c.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const r = c.getBoundingClientRect();
    const pts = params[ch];
    const outside = e.clientY < r.top - 20 || e.clientY > r.bottom + 20 || e.clientX < r.left - 20 || e.clientX > r.right + 20;
    if (outside && pts.length > 2) { pts.splice(drag, 1); drag = -1; draw(); changed(); return; }
    const [x, y] = pos(e);
    const lo = drag > 0 ? pts[drag - 1][0] + 1 : 0, hi = drag < pts.length - 1 ? pts[drag + 1][0] - 1 : 255;
    pts[drag] = [Math.max(lo, Math.min(hi, x)), y];
    draw(); changed();
  });
  c.addEventListener('pointerup', () => { drag = -1; });
  const seg = el('div', { class: 'seg' }, [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']].map(([k, t]) => {
    const b = el('button', { class: k === ch ? 'on' : '', onclick: () => { ch = k; seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); } }, t);
    return b;
  }));
  draw();
  const box = el('div', { class: 'curves-box' }, seg, c, el('small', { class: 'muted' }, 'Click to add a point, drag to bend the curve, drag a point off the graph to remove it.'));
  box.reset = () => { for (const k of ['rgb', 'r', 'g', 'b']) params[k] = [[0, 0], [255, 255]]; draw(); };
  return box;
}
