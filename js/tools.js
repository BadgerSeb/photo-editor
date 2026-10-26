// The tools in the left column. Each one gets pointer events in document pixels and draws its
// guides through setOverlay(). Painting tools paint into a separate stroke canvas that is shown
// live and applied to the layer when the mouse is released (so opacity doesn't build up and the
// selection can cut it cleanly).

import { canvas, ctx2d, cloneCanvas, hexToRgb, rgbToHex, emit } from './util.js';
import { app, paintable, status, setColors } from './state.js';
import { newLayer } from './doc.js';
import { selRect, selEllipse, selPolygon, combine, feather, wand, maskCanvas, offsetSel, selFromAlpha, alphaBounds, selBounds } from './selection.js';
import { setOverlay, requestRender, toScreen, toDoc, zoomStep, panBy, viewSize } from './view.js';
import { cropTo } from './ops.js';

const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${extra}<path d="${d}"/></svg>`;

export const ICONS = {
  move: I('M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3'),
  marquee: I('M4 5h3M10 5h4M17 5h3v3M20 11v3M20 17v2h-3M14 19h-4M7 19H4v-3M4 13v-3M4 8V5'),
  lasso: I('M7 17c-3-1-4-3-4-5 0-4 4-7 9-7s9 3 9 6-4 6-9 6c-1 0-2 0-3-.3M7 17c-1 1-1 3 1 3s1.5 1.5 0 2.5'),
  wand: I('M4 20L15 9M13 7l4 4M16 3v2M21 8h-2M19.5 4.5L18 6M11 4l.7 1.5M20 13l-1.5-.7'),
  crop: I('M6 2v16h16M2 6h16v16'),
  eyedropper: I('M14.5 4.5l5 5M17 2.5a2.1 2.1 0 0 1 3 3L18 7.5l-1.5-1.5zM16 8L7 17H5v-2l9-9M5 19l-1.5 1.5'),
  brush: I('M20 3.5L11 12.5M11 12.5c-2.3-1.2-5.5.3-5.5 3.5 0 1.8-1.2 3-2.5 3.5 4 1.5 9-.5 8.8-5.3z'),
  pencil: I('M4 20l1.5-5L16 4.5l3.5 3.5L9 18.5zM14 6.5l3.5 3.5'),
  eraser: I('M8 20h12M5.5 14.5l9-9a1.4 1.4 0 0 1 2 0l3 3a1.4 1.4 0 0 1 0 2l-9 9H9zM9.5 10.5l4.5 4.5'),
  bucket: I('M5 11l7-7 7 7-7 7zM5 11h14M20.5 15.5s-1.5 2-1.5 3a1.5 1.5 0 0 0 3 0c0-1-1.5-3-1.5-3z'),
  gradient: I('M3.5 5.5h17v13h-17z', '<defs><linearGradient id="gi"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="3.5" y="5.5" width="17" height="13" fill="url(#gi)" stroke="none"/>'),
  text: I('M5 5h14M12 5v14M9 19h6'),
  shape: I('M3.5 3.5h10v10h-10zM16.5 10.5a5 5 0 1 1-6 6'),
  clone: I('M9 3.5h6v5l3.5 4h-13L9 8.5zM5 16h14v4H5z'),
  blur: I('M12 3c4 5 6.5 8 6.5 11a6.5 6.5 0 0 1-13 0C5.5 11 8 8 12 3z'),
  dodge: I('M13.5 13.5L21 21M9.5 15a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z'),
  hand: I('M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V12M17 12V9a1.5 1.5 0 0 1 3 0v5c0 4-3 7-7 7h-1c-2.6 0-4.4-1.4-5.6-3.4L3.7 13.3a1.5 1.5 0 0 1 2.6-1.5L8 14'),
  zoom: I('M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM15.5 15.5L21 21M8 10.5h5M10.5 8v5'),
};

const SEL_MODES = [['new', '▢', 'New selection'], ['add', '+', 'Add to selection (hold Shift)'], ['subtract', '−', 'Subtract from selection (hold Alt)'], ['intersect', '∩', 'Intersect with selection (Shift+Alt)']];
const SIZE = (max = 1000) => ({ type: 'range', key: 'size', label: 'Size', min: 1, max, unit: 'px', log: true });

function selMode(o, e) {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return o.mode;
}

function applySelection(sel, mode, label, o) {
  const d = app.doc;
  if (o?.feather > 0 && sel) sel = feather(sel, o.feather);
  if (d.sel) app.lastSel = d.sel;
  d.sel = combine(d.sel, sel, mode);
  d.commit(label);
  emit('selection');
}

// ---------------------------------------------------------------- brush tips and strokes

const tips = new Map();
function softTip(size, hardness, color) {
  const key = `${size}|${hardness}|${color}`;
  let t = tips.get(key);
  if (t) return t;
  if (tips.size > 40) tips.clear();
  const d = Math.ceil(size) + 2;
  t = canvas(d, d);
  const g = ctx2d(t);
  const [r, gg, b] = hexToRgb(color) || [0, 0, 0];
  const rad = size / 2;
  if (hardness >= 100) {
    g.fillStyle = color;
    g.beginPath(); g.arc(d / 2, d / 2, rad, 0, Math.PI * 2); g.fill();
  } else {
    const grad = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, rad);
    const h = Math.max(0, Math.min(0.99, hardness / 100));
    grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    grad.addColorStop(h, `rgba(${r},${gg},${b},1)`);
    // a smooth falloff rather than a straight ramp
    for (let k = 1; k <= 4; k++) {
      const f = h + ((1 - h) * k) / 5;
      const a = Math.pow(1 - k / 5, 1.6);
      grad.addColorStop(f, `rgba(${r},${gg},${b},${a.toFixed(3)})`);
    }
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, d, d);
  }
  tips.set(key, t);
  return t;
}

/** A hard-edged pixel tip for the pencil: no antialiasing at all */
function pixelTip(size, color) {
  const key = `px|${size}|${color}`;
  let t = tips.get(key);
  if (t) return t;
  const n = Math.max(1, Math.round(size));
  t = canvas(n, n);
  const g = ctx2d(t);
  const img = g.createImageData(n, n);
  const [r, gg, b] = hexToRgb(color) || [0, 0, 0];
  const c = (n - 1) / 2, rr = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (n > 2 && (x - c) ** 2 + (y - c) ** 2 > rr * rr) continue;
    const o = (y * n + x) * 4;
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  tips.set(key, t);
  return t;
}

/** Calls stamp(x, y) every `spacing` pixels from a to b, carrying the leftover across segments */
function walk(stroke, a, b, spacing, stamp) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  let t = stroke.rest;
  if (dist === 0) return;
  while (t <= dist) {
    stamp(a.x + (dx * t) / dist, a.y + (dy * t) / dist);
    t += spacing;
  }
  stroke.rest = t - dist;
}

let lastPaint = null; // for Shift-click straight lines

function paintTool(id, { op = 'source-over', pencil = false } = {}) {
  let stroke = null;
  return {
    down(p, e) {
      if (e.altKey && id !== 'eraser') return pickColor(p, false, true);
      const l = paintable();
      if (!l) return;
      const d = app.doc;
      const o = app.opts[id];
      d.live = { layer: l, canvas: canvas(d.width, d.height), op, alpha: o.opacity / 100 };
      const color = op === 'destination-out' ? '#000000' : app.fg;
      const t = pencil ? pixelTip(o.size, color) : softTip(o.size, o.hardness, color);
      const g = ctx2d(d.live.canvas);
      g.imageSmoothingEnabled = !pencil;
      const stamp = (x, y) => {
        if (pencil) g.drawImage(t, Math.round(x - t.width / 2), Math.round(y - t.height / 2));
        else g.drawImage(t, x - t.width / 2, y - t.height / 2);
      };
      const spacing = pencil ? Math.max(1, o.size / 4) : Math.max(1, o.size * 0.12);
      stroke = { last: p, rest: 0, stamp, spacing };
      if (e.shiftKey && lastPaint) walk(stroke, lastPaint, p, spacing, stamp);
      else stamp(p.x, p.y);
      stroke.last = p;
      d.changed();
    },
    move(p) {
      if (!stroke) return;
      walk(stroke, stroke.last, p, stroke.spacing, stroke.stamp);
      stroke.last = p;
      app.doc.changed();
    },
    up(p) {
      if (!stroke) return;
      stroke = null;
      lastPaint = p;
      app.doc.finishLive();
      app.doc.commit({ brush: 'Brush', pencil: 'Pencil', eraser: 'Eraser' }[id]);
    },
  };
}

// ---------------------------------------------------------------- pixel tools (blur, dodge)

function dabTool(id, process) {
  let stroke = null;
  return {
    down(p) {
      const l = paintable();
      if (!l) return;
      app.doc.editable(l);
      stroke = { last: p, rest: 0 };
      const o = app.opts[id];
      stroke.stamp = (x, y) => dab(l, x, y, o, process);
      stroke.stamp(p.x, p.y);
      app.doc.changed();
    },
    move(p) {
      if (!stroke) return;
      walk(stroke, stroke.last, p, Math.max(1, app.opts[id].size * 0.2), stroke.stamp);
      stroke.last = p;
      app.doc.changed();
    },
    up() {
      if (!stroke) return;
      stroke = null;
      const o = app.opts[id];
      app.doc.commit(id === 'blur' ? (o.kind === 'blur' ? 'Blur Tool' : 'Sharpen Tool') : (o.kind === 'dodge' ? 'Dodge Tool' : 'Burn Tool'));
    },
  };
}

function dab(layer, cx, cy, o, process) {
  const d = app.doc;
  const r = o.size / 2;
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(d.width, Math.ceil(cx + r)), y1 = Math.min(d.height, Math.ceil(cy + r));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const g = ctx2d(layer.canvas);
  const img = g.getImageData(x0, y0, w, h);
  const src = img.data.slice();
  const res = process(src, w, h, o);
  const out = img.data;
  const sel = d.sel;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dist = Math.hypot(x0 + x + 0.5 - cx, y0 + y + 0.5 - cy) / r;
    if (dist >= 1) continue;
    let k = 1 - dist * dist;
    if (sel) k *= sel.mask[(y0 + y) * d.width + x0 + x] / 255;
    if (k <= 0) continue;
    const i = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) out[i + c] = src[i + c] + (res[i + c] - src[i + c]) * k;
  }
  g.putImageData(img, x0, y0);
}

function blurProcess(src, w, h, o) {
  const res = new Uint8ClampedArray(src.length);
  const s = o.strength / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = [0, 0, 0, 0], n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
      const j = (yy * w + xx) * 4;
      for (let c = 0; c < 4; c++) acc[c] += src[j + c];
      n++;
    }
    const i = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) {
      const avg = acc[c] / n;
      res[i + c] = o.kind === 'blur' ? src[i + c] + (avg - src[i + c]) * s : (c === 3 ? src[i + c] : src[i + c] + (src[i + c] - avg) * s * 1.5);
    }
  }
  return res;
}

function dodgeProcess(src, w, h, o) {
  const res = new Uint8ClampedArray(src.length);
  const k = (o.exposure / 100) * 0.25;
  for (let i = 0; i < src.length; i += 4) {
    const l = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) / 255;
    const wgt = o.range === 'shadows' ? Math.max(0, 1 - l * 1.6) : o.range === 'highlights' ? Math.max(0, l * 1.6 - 0.6) : 1 - Math.pow((l - 0.5) * 2, 2);
    for (let c = 0; c < 3; c++) {
      const v = src[i + c];
      res[i + c] = o.kind === 'dodge' ? v + (255 - v) * k * wgt : v * (1 - k * wgt);
    }
    res[i + 3] = src[i + 3];
  }
  return res;
}

// ---------------------------------------------------------------- colors

function sampleAt(p, size, allLayers) {
  const d = app.doc;
  const src = allLayers ? d.composite() : d.source(d.layer);
  const n = Math.max(1, size | 0), half = (n - 1) / 2;
  const x0 = Math.max(0, Math.floor(p.x) - Math.floor(half)), y0 = Math.max(0, Math.floor(p.y) - Math.floor(half));
  if (Math.floor(p.x) < 0 || Math.floor(p.y) < 0 || p.x >= d.width || p.y >= d.height) return null;
  const w = Math.min(n, d.width - x0), h = Math.min(n, d.height - y0);
  const px = ctx2d(src).getImageData(x0, y0, w, h).data;
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < px.length; i += 4) { const al = px[i + 3]; r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al; a += al; }
  if (!a) return null;
  return rgbToHex(r / a, g / a, b / a);
}

function pickColor(p, toBg, allLayers = app.opts.eyedropper.allLayers) {
  const c = sampleAt(p, app.opts.eyedropper.sample, allLayers);
  if (!c) return;
  if (toBg) setColors(null, c); else setColors(c, null);
}

// ---------------------------------------------------------------- tools

export const TOOLS = [];
const tool = (t) => { TOOLS.push(t); return t; };

tool({
  id: 'move', name: 'Move', key: 'V', cursor: 'move',
  hint: 'Drag to move the layer, or the selected pixels. Alt-drag copies them. Arrow keys nudge.',
  options: () => [{ type: 'check', key: 'autoSelect', label: 'Auto-select layer' }, { type: 'button', label: 'Free Transform (Ctrl+T)', action: () => startTransform() }],
  down(p, e) {
    const d = app.doc;
    if (app.opts.move.autoSelect) {
      for (let i = d.layers.length - 1; i >= 0; i--) {
        const l = d.layers[i];
        if (!l.visible || p.x < 0 || p.y < 0 || p.x >= d.width || p.y >= d.height) continue;
        if (ctx2d(l.canvas).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] > 0) { d.active = i; emit('layers'); break; }
      }
    }
    const l = paintable();
    if (!l) return;
    const inSel = d.sel && p.x >= 0 && p.y >= 0 && p.x < d.width && p.y < d.height && d.sel.mask[Math.floor(p.y) * d.width + Math.floor(p.x)] >= 128;
    this.drag = beginMove(l, inSel, e.altKey && inSel);
    this.drag.start = p;
  },
  move(p, e) {
    const m = this.drag;
    if (!m) return;
    let dx = Math.round(p.x - m.start.x), dy = Math.round(p.y - m.start.y);
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    m.update(dx, dy);
  },
  up() {
    const m = this.drag;
    this.drag = null;
    if (m) m.finish();
  },
  arrow(dx, dy) {
    const l = paintable();
    if (!l) return;
    const d = app.doc;
    const m = beginMove(l, !!d.sel, false);
    m.update(dx, dy);
    m.finish('Nudge');
  },
});

/** Moving a layer, or the selected part of it, by whole pixels */
function beginMove(l, withSel, copy) {
  const d = app.doc;
  const content = cloneCanvas(l.canvas);
  const base = canvas(d.width, d.height);
  if (withSel) {
    const gc = ctx2d(content);
    gc.globalCompositeOperation = 'destination-in';
    gc.drawImage(maskCanvas(d.sel), 0, 0);
    const gb = ctx2d(base);
    gb.drawImage(l.canvas, 0, 0);
    if (!copy) { gb.globalCompositeOperation = 'destination-out'; gb.drawImage(maskCanvas(d.sel), 0, 0); }
  }
  const out = canvas(d.width, d.height);
  const go = ctx2d(out);
  const bounds = withSel ? selBounds(d.sel) : alphaBounds(l.canvas);
  let dx = 0, dy = 0;
  app.hideEdges = true;
  const draw = () => {
    go.clearRect(0, 0, d.width, d.height);
    go.drawImage(base, 0, 0);
    go.drawImage(content, dx, dy);
    d.preview = { layer: l, canvas: out };
    d.changed();
  };
  setOverlay((g, v) => {
    if (!bounds) return;
    const a = toScreen(bounds.x + dx, bounds.y + dy);
    g.strokeStyle = 'rgba(232,101,15,.9)';
    g.setLineDash([5, 4]);
    g.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, bounds.w * v.zoom, bounds.h * v.zoom);
  });
  draw();
  return {
    update(x, y) { dx = x; dy = y; draw(); },
    finish(label = 'Move') {
      app.hideEdges = false;
      setOverlay(null);
      d.preview = null;
      if (!dx && !dy && !copy) { d.changed(); return; }
      const g = d.editable(l);
      g.globalCompositeOperation = 'copy';
      g.drawImage(out, 0, 0);
      g.globalCompositeOperation = 'source-over';
      if (withSel) d.sel = offsetSel(d.sel, dx, dy);
      d.commit(label);
      emit('selection');
    },
  };
}

tool({
  id: 'marquee', name: 'Marquee', key: 'M', cursor: 'crosshair',
  hint: 'Drag to select. Shift adds, Alt subtracts; Shift while dragging makes a square or circle.',
  options: () => [
    { type: 'seg', key: 'shape', options: [['rect', 'Rectangle', 'Rectangular marquee'], ['ellipse', 'Ellipse', 'Elliptical marquee']] },
    { type: 'seg', key: 'mode', options: SEL_MODES },
    { type: 'range', key: 'feather', label: 'Feather', min: 0, max: 250, unit: 'px' },
  ],
  down(p, e) { this.drag = { a: p, b: p, mode: selMode(app.opts.marquee, e), shiftAtStart: e.shiftKey }; },
  move(p, e) {
    const m = this.drag;
    if (!m) return;
    let b = { ...p };
    if (e.shiftKey && !m.shiftAtStart) {
      const s = Math.max(Math.abs(b.x - m.a.x), Math.abs(b.y - m.a.y));
      b = { x: m.a.x + Math.sign(b.x - m.a.x || 1) * s, y: m.a.y + Math.sign(b.y - m.a.y || 1) * s };
    }
    m.b = b;
    const ellipse = app.opts.marquee.shape === 'ellipse';
    setOverlay((g, v) => {
      const a = toScreen(Math.round(m.a.x), Math.round(m.a.y)), c = toScreen(Math.round(m.b.x), Math.round(m.b.y));
      g.beginPath();
      if (ellipse) g.ellipse((a.x + c.x) / 2, (a.y + c.y) / 2, Math.abs(c.x - a.x) / 2, Math.abs(c.y - a.y) / 2, 0, 0, Math.PI * 2);
      else g.rect(Math.min(a.x, c.x) + 0.5, Math.min(a.y, c.y) + 0.5, Math.abs(c.x - a.x), Math.abs(c.y - a.y));
      g.strokeStyle = '#fff'; g.stroke();
      g.setLineDash([4, 4]); g.strokeStyle = '#000'; g.stroke();
    });
    status(`${Math.abs(Math.round(m.b.x) - Math.round(m.a.x))} × ${Math.abs(Math.round(m.b.y) - Math.round(m.a.y))} px`);
  },
  up() {
    const m = this.drag;
    this.drag = null;
    setOverlay(null);
    if (!m) return;
    const d = app.doc;
    const x = Math.round(Math.min(m.a.x, m.b.x)), y = Math.round(Math.min(m.a.y, m.b.y));
    const w = Math.round(Math.max(m.a.x, m.b.x)) - x, h = Math.round(Math.max(m.a.y, m.b.y)) - y;
    if (w < 1 || h < 1) {
      if (m.mode === 'new' && d.sel) { app.lastSel = d.sel; d.sel = null; d.commit('Deselect'); emit('selection'); }
      return;
    }
    const sel = app.opts.marquee.shape === 'ellipse' ? selEllipse(d.width, d.height, x, y, w, h) : selRect(d.width, d.height, x, y, w, h);
    applySelection(sel, m.mode, app.opts.marquee.shape === 'ellipse' ? 'Elliptical Marquee' : 'Rectangular Marquee', app.opts.marquee);
  },
});

tool({
  id: 'lasso', name: 'Lasso', key: 'L', cursor: 'crosshair',
  hint: 'Freehand: drag around an area. Polygonal: click corners, double-click or Enter to close.',
  options: () => [
    { type: 'seg', key: 'kind', options: [['free', 'Freehand', 'Freehand lasso'], ['poly', 'Polygonal', 'Polygonal lasso: click each corner']] },
    { type: 'seg', key: 'mode', options: SEL_MODES },
    { type: 'range', key: 'feather', label: 'Feather', min: 0, max: 250, unit: 'px' },
  ],
  down(p, e) {
    const o = app.opts.lasso;
    if (o.kind === 'poly') {
      if (!this.poly) this.poly = { pts: [p], mode: selMode(o, e) };
      else {
        const first = toScreen(this.poly.pts[0].x, this.poly.pts[0].y), here = toScreen(p.x, p.y);
        if (e.detail >= 2 || (this.poly.pts.length > 2 && Math.hypot(first.x - here.x, first.y - here.y) < 8)) return this.closePoly();
        this.poly.pts.push(p);
      }
      this.drawPoly(p);
      app.session = { tool: 'lasso', commit: () => this.closePoly(), cancel: () => { this.poly = null; setOverlay(null); app.session = null; } };
      return;
    }
    this.drag = { pts: [p], mode: selMode(o, e) };
  },
  move(p) {
    if (this.poly) return this.drawPoly(p);
    const m = this.drag;
    if (!m) return;
    m.pts.push(p);
    setOverlay((g) => {
      g.beginPath();
      m.pts.forEach((q, i) => { const s = toScreen(q.x, q.y); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
      g.strokeStyle = '#fff'; g.stroke(); g.setLineDash([4, 4]); g.strokeStyle = '#000'; g.stroke();
    });
  },
  hover(p) { if (this.poly) this.drawPoly(p); },
  drawPoly(cur) {
    const pts = this.poly.pts;
    setOverlay((g) => {
      g.beginPath();
      [...pts, cur].forEach((q, i) => { const s = toScreen(q.x, q.y); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
      g.strokeStyle = '#fff'; g.stroke(); g.setLineDash([4, 4]); g.strokeStyle = '#000'; g.stroke();
      const f = toScreen(pts[0].x, pts[0].y);
      g.setLineDash([]); g.strokeStyle = '#e8650f'; g.strokeRect(f.x - 4, f.y - 4, 8, 8);
    });
  },
  closePoly() {
    const m = this.poly;
    this.poly = null;
    app.session = null;
    setOverlay(null);
    if (!m || m.pts.length < 3) return;
    applySelection(selPolygon(app.doc.width, app.doc.height, m.pts), m.mode, 'Polygonal Lasso', app.opts.lasso);
  },
  up() {
    const m = this.drag;
    this.drag = null;
    if (!m) return;
    setOverlay(null);
    if (m.pts.length < 3) return;
    applySelection(selPolygon(app.doc.width, app.doc.height, m.pts), m.mode, 'Lasso', app.opts.lasso);
  },
});

tool({
  id: 'wand', name: 'Magic Wand', key: 'W', cursor: 'crosshair',
  hint: 'Click a color to select it. Tolerance sets how similar colors must be.',
  options: () => [
    { type: 'seg', key: 'mode', options: SEL_MODES },
    { type: 'range', key: 'tolerance', label: 'Tolerance', min: 0, max: 255 },
    { type: 'check', key: 'contiguous', label: 'Contiguous' },
    { type: 'check', key: 'allLayers', label: 'Sample all layers' },
  ],
  down(p, e) {
    const d = app.doc, o = app.opts.wand;
    const src = o.allLayers ? d.composite() : d.layer.canvas;
    const sel = wand(ctx2d(src).getImageData(0, 0, d.width, d.height), p.x, p.y, o.tolerance, o.contiguous);
    if (!sel && selMode(o, e) === 'new') return;
    applySelection(sel, selMode(o, e), 'Magic Wand');
  },
});

tool({
  id: 'crop', name: 'Crop', key: 'C', cursor: 'crosshair',
  hint: 'Drag the area to keep, adjust its edges, then press Enter (Esc cancels).',
  options: () => {
    const s = app.session?.tool === 'crop' ? app.session : null;
    return [
      { type: 'label', text: s?.rect ? `${s.rect.w} × ${s.rect.h} px` : 'Drag over the picture' },
      { type: 'button', label: '✓ Crop', primary: true, disabled: !s, action: () => app.session?.commit() },
      { type: 'button', label: '✕ Cancel', disabled: !s, action: () => app.session?.cancel() },
    ];
  },
  down(p) {
    const s = app.session?.tool === 'crop' ? app.session : null;
    const handle = s && cropHandle(s.rect, p);
    if (s && handle) { this.drag = { handle, start: p, orig: { ...s.rect } }; return; }
    this.drag = { handle: 'new', start: p };
    startCrop({ x: Math.round(p.x), y: Math.round(p.y), w: 0, h: 0 });
  },
  move(p) {
    const m = this.drag, s = app.session;
    if (!m || !s || s.tool !== 'crop') return;
    const d = app.doc;
    const cx = (v) => Math.max(0, Math.min(d.width, Math.round(v))), cy = (v) => Math.max(0, Math.min(d.height, Math.round(v)));
    if (m.handle === 'new') {
      const x0 = cx(Math.min(m.start.x, p.x)), y0 = cy(Math.min(m.start.y, p.y));
      s.rect = { x: x0, y: y0, w: cx(Math.max(m.start.x, p.x)) - x0, h: cy(Math.max(m.start.y, p.y)) - y0 };
    } else if (m.handle === 'inside') {
      const o = m.orig;
      s.rect = { ...o, x: Math.max(0, Math.min(d.width - o.w, Math.round(o.x + p.x - m.start.x))), y: Math.max(0, Math.min(d.height - o.h, Math.round(o.y + p.y - m.start.y))) };
    } else {
      let { x, y, w, h } = m.orig;
      let x1 = x + w, y1 = y + h;
      if (m.handle.includes('w')) x = cx(Math.min(p.x, x1 - 1));
      if (m.handle.includes('e')) x1 = cx(Math.max(p.x, x + 1));
      if (m.handle.includes('n')) y = cy(Math.min(p.y, y1 - 1));
      if (m.handle.includes('s')) y1 = cy(Math.max(p.y, y + 1));
      s.rect = { x, y, w: x1 - x, h: y1 - y };
    }
    emit('options');
    requestRender();
  },
  up() { this.drag = null; const s = app.session; if (s?.tool === 'crop' && (s.rect.w < 1 || s.rect.h < 1)) s.cancel(); },
  cursorAt(p) {
    const s = app.session?.tool === 'crop' ? app.session : null;
    const h = s && cropHandle(s.rect, p);
    return h === 'inside' ? 'move' : h ? ({ n: 'ns', s: 'ns', e: 'ew', w: 'ew', ne: 'nesw', sw: 'nesw', nw: 'nwse', se: 'nwse' }[h] + '-resize') : 'crosshair';
  },
});

function cropHandle(r, p) {
  if (!r || r.w < 1) return null;
  const tol = 8 / app.doc.view.zoom;
  const nearL = Math.abs(p.x - r.x) < tol, nearR = Math.abs(p.x - (r.x + r.w)) < tol;
  const nearT = Math.abs(p.y - r.y) < tol, nearB = Math.abs(p.y - (r.y + r.h)) < tol;
  const inX = p.x > r.x - tol && p.x < r.x + r.w + tol, inY = p.y > r.y - tol && p.y < r.y + r.h + tol;
  let h = '';
  if (nearT && inX) h += 'n'; else if (nearB && inX) h += 's';
  if (nearL && inY) h += 'w'; else if (nearR && inY) h += 'e';
  if (h) return h;
  if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return 'inside';
  return null;
}

function startCrop(rect) {
  const s = {
    tool: 'crop', rect,
    commit() {
      const r = s.rect;
      end();
      if (r.w >= 1 && r.h >= 1) cropTo(r);
    },
    cancel: () => end(),
  };
  const end = () => { app.session = null; setOverlay(null); emit('options'); };
  app.session = s;
  setOverlay((g, v) => {
    const r = s.rect;
    const a = toScreen(r.x, r.y);
    const w = r.w * v.zoom, h = r.h * v.zoom;
    const vs = viewSize();
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.beginPath();
    g.rect(0, 0, vs.w, vs.h);
    g.rect(a.x, a.y, w, h);
    g.fill('evenodd');
    g.strokeStyle = '#fff';
    g.lineWidth = 1;
    g.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.beginPath();
    for (let k = 1; k < 3; k++) { g.moveTo(a.x + (w * k) / 3, a.y); g.lineTo(a.x + (w * k) / 3, a.y + h); g.moveTo(a.x, a.y + (h * k) / 3); g.lineTo(a.x + w, a.y + (h * k) / 3); }
    g.stroke();
    g.fillStyle = '#fff';
    for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) g.fillRect(a.x + w * hx - 4, a.y + h * hy - 4, 8, 8);
  });
  emit('options');
}

tool({
  id: 'eyedropper', name: 'Eyedropper', key: 'I', cursor: 'crosshair',
  hint: 'Click to pick the foreground color, Alt-click for the background color.',
  options: () => [
    { type: 'select', key: 'sample', label: 'Sample size', options: [[1, 'Point'], [3, '3 × 3 average'], [5, '5 × 5 average'], [11, '11 × 11 average']] },
    { type: 'check', key: 'allLayers', label: 'All layers' },
  ],
  down(p, e) { pickColor(p, e.altKey); this.dragging = e.altKey ? 'bg' : 'fg'; },
  move(p) { if (this.dragging) pickColor(p, this.dragging === 'bg'); },
  up() { this.dragging = null; },
});

const BRUSH_OPTS = (id) => () => [
  SIZE(id === 'pencil' ? 200 : 1000),
  ...(id === 'pencil' ? [] : [{ type: 'range', key: 'hardness', label: 'Hardness', min: 0, max: 100, unit: '%' }]),
  { type: 'range', key: 'opacity', label: 'Opacity', min: 1, max: 100, unit: '%' },
];

tool({ id: 'brush', name: 'Brush', key: 'B', cursor: 'crosshair', hint: 'Paint with the foreground color. Shift-click draws a straight line, Alt-click picks a color, [ and ] change the size.', options: BRUSH_OPTS('brush'), ...paintTool('brush') });
tool({ id: 'pencil', name: 'Pencil', key: 'B', cursor: 'crosshair', hint: 'Hard-edged pixels, no smoothing. Shift-click draws a straight line.', options: BRUSH_OPTS('pencil'), ...paintTool('pencil', { pencil: true }) });
tool({ id: 'eraser', name: 'Eraser', key: 'E', cursor: 'crosshair', hint: 'Erase to transparency. Shift-click erases a straight line.', options: BRUSH_OPTS('eraser'), ...paintTool('eraser', { op: 'destination-out' }) });

tool({
  id: 'bucket', name: 'Paint Bucket', key: 'G', cursor: 'crosshair',
  hint: 'Click to fill similar colors with the foreground color.',
  options: () => [
    { type: 'range', key: 'tolerance', label: 'Tolerance', min: 0, max: 255 },
    { type: 'range', key: 'opacity', label: 'Opacity', min: 1, max: 100, unit: '%' },
    { type: 'check', key: 'contiguous', label: 'Contiguous' },
    { type: 'check', key: 'allLayers', label: 'All layers' },
  ],
  down(p) {
    const l = paintable();
    if (!l) return;
    const d = app.doc, o = app.opts.bucket;
    const src = o.allLayers ? d.composite() : l.canvas;
    let sel = wand(ctx2d(src).getImageData(0, 0, d.width, d.height), p.x, p.y, o.tolerance, o.contiguous);
    if (sel && d.sel) sel = combine(d.sel, sel, 'intersect');
    if (!sel) return;
    const fill = canvas(d.width, d.height);
    const gf = ctx2d(fill);
    gf.fillStyle = app.fg;
    gf.fillRect(0, 0, d.width, d.height);
    gf.globalCompositeOperation = 'destination-in';
    gf.drawImage(maskCanvas(sel), 0, 0);
    const g = d.editable(l);
    g.globalAlpha = o.opacity / 100;
    g.drawImage(fill, 0, 0);
    g.globalAlpha = 1;
    d.commit('Paint Bucket');
  },
});

tool({
  id: 'gradient', name: 'Gradient', key: 'G', cursor: 'crosshair',
  hint: 'Drag to draw a gradient from the foreground to the background color. Shift keeps the angle at 45° steps.',
  options: () => [
    { type: 'seg', key: 'kind', options: [['linear', 'Linear'], ['radial', 'Radial'], ['reflected', 'Reflected']] },
    { type: 'select', key: 'colors', label: 'Colors', options: [['fg-bg', 'Foreground → Background'], ['fg-clear', 'Foreground → Transparent'], ['bw', 'Black → White']] },
    { type: 'range', key: 'opacity', label: 'Opacity', min: 1, max: 100, unit: '%' },
    { type: 'check', key: 'reverse', label: 'Reverse' },
  ],
  down(p) {
    const l = paintable();
    if (!l) return;
    const d = app.doc;
    d.live = { layer: l, canvas: canvas(d.width, d.height), op: 'source-over', alpha: app.opts.gradient.opacity / 100 };
    this.drag = { a: p, b: p };
  },
  move(p, e) {
    const m = this.drag;
    if (!m) return;
    let b = p;
    if (e.shiftKey) {
      const ang = Math.round(Math.atan2(p.y - m.a.y, p.x - m.a.x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(p.x - m.a.x, p.y - m.a.y);
      b = { x: m.a.x + Math.cos(ang) * len, y: m.a.y + Math.sin(ang) * len };
    }
    m.b = b;
    drawGradient(ctx2d(app.doc.live.canvas), m.a, m.b, app.opts.gradient);
    app.doc.changed();
    setOverlay((g) => {
      const a = toScreen(m.a.x, m.a.y), c = toScreen(m.b.x, m.b.y);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y);
      g.strokeStyle = '#000'; g.lineWidth = 3; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
    });
  },
  up() {
    const m = this.drag;
    this.drag = null;
    setOverlay(null);
    if (!m) return;
    const d = app.doc;
    if (Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) < 1) { d.live = null; d.changed(); return; }
    d.finishLive();
    d.commit('Gradient');
  },
});

export function drawGradient(g, a, b, o) {
  const { width: w, height: h } = g.canvas;
  let c0 = app.fg, c1 = app.bg;
  if (o.colors === 'bw') { c0 = '#000000'; c1 = '#ffffff'; }
  const rgb1 = hexToRgb(o.colors === 'fg-clear' ? c0 : c1);
  let s0 = c0, s1 = o.colors === 'fg-clear' ? `rgba(${rgb1.join(',')},0)` : c1;
  if (o.reverse) [s0, s1] = [s1, s0];
  let grad;
  if (o.kind === 'radial') grad = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)));
  else if (o.kind === 'reflected') {
    grad = g.createLinearGradient(2 * a.x - b.x, 2 * a.y - b.y, b.x, b.y);
    grad.addColorStop(0, s1); grad.addColorStop(0.5, s0); grad.addColorStop(1, s1);
  } else grad = g.createLinearGradient(a.x, a.y, b.x, b.y);
  if (o.kind !== 'reflected') { grad.addColorStop(0, s0); grad.addColorStop(1, s1); }
  g.clearRect(0, 0, w, h);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

const FONTS = ['Segoe UI', 'Arial', 'Bahnschrift', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'Consolas', 'Courier New', 'Comic Sans MS', 'Segoe Script'];

tool({
  id: 'text', name: 'Text', key: 'T', cursor: 'text',
  hint: 'Click where the text should go and type. Ctrl+Enter or ✓ places it on a new layer, Esc cancels.',
  options: () => {
    const editing = app.session?.tool === 'text';
    return [
      { type: 'select', key: 'font', label: '', options: FONTS.map(f => [f, f]), title: 'Font' },
      { type: 'range', key: 'size', label: 'Size', min: 4, max: 1000, unit: 'px', log: true },
      { type: 'check', key: 'bold', label: 'Bold' },
      { type: 'check', key: 'italic', label: 'Italic' },
      { type: 'seg', key: 'align', options: [['left', '⯇', 'Align left'], ['center', '≡', 'Center'], ['right', '⯈', 'Align right']] },
      { type: 'button', label: '✓ Place text', primary: true, disabled: !editing, action: () => app.session?.commit() },
      { type: 'button', label: '✕', disabled: !editing, action: () => app.session?.cancel() },
    ];
  },
  down(p) {
    if (app.session?.tool === 'text') { app.session.commit(); return; }
    startText(p);
  },
  optionsChanged() { app.session?.tool === 'text' && app.session.restyle(); },
});

function textFont(o, size = o.size) {
  return `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${size}px "${o.font}"`;
}

function startText(p) {
  const d = app.doc;
  const ta = document.getElementById('text-input');
  const o = app.opts.text;
  ta.value = '';
  ta.hidden = false;
  const place = () => {
    const s = toScreen(p.x, p.y);
    ta.style.font = textFont(o, o.size * d.view.zoom);
    ta.style.lineHeight = '1.2';
    ta.style.color = app.fg;
    ta.style.textAlign = o.align;
    ta.style.left = s.x + 'px';
    ta.style.top = s.y + 'px';
    autosize();
  };
  const autosize = () => {
    ta.style.width = '10px';
    ta.style.height = '10px';
    ta.style.width = Math.max(40, ta.scrollWidth + 10) + 'px';
    ta.style.height = ta.scrollHeight + 'px';
  };
  ta.oninput = autosize;
  const end = () => { ta.hidden = true; ta.oninput = null; app.session = null; emit('options'); };
  app.session = {
    tool: 'text',
    restyle: place,
    reposition: place,
    commit() {
      const text = ta.value.replace(/\s+$/, '');
      end();
      if (!text) return;
      const lines = text.split('\n');
      const l = newLayer(d.width, d.height, text.replace(/\s+/g, ' ').slice(0, 40));
      const g = ctx2d(l.canvas);
      g.font = textFont(o);
      g.fillStyle = app.fg;
      g.textBaseline = 'top';
      const widths = lines.map(t => g.measureText(t).width);
      const maxW = Math.max(...widths);
      lines.forEach((t, i) => {
        const x = o.align === 'center' ? p.x + (maxW - widths[i]) / 2 : o.align === 'right' ? p.x + maxW - widths[i] : p.x;
        // the textarea draws its first line a little lower than canvas text; match it
        g.fillText(t, x, p.y + i * o.size * 1.2 + o.size * 0.1);
      });
      d.addLayer(l);
      d.commit('Text');
    },
    cancel: end,
  };
  place();
  emit('options');
  setTimeout(() => ta.focus(), 0);
}

tool({
  id: 'shape', name: 'Shape', key: 'U', cursor: 'crosshair',
  hint: 'Drag to draw a shape on a new layer. Shift keeps it square (or the line at 45°), Alt draws from the center.',
  options: () => [
    { type: 'seg', key: 'kind', options: [['rect', '▭', 'Rectangle'], ['ellipse', '◯', 'Ellipse'], ['line', '╱', 'Line'], ['polygon', '⬠', 'Polygon'], ['star', '☆', 'Star']] },
    { type: 'select', key: 'fill', label: 'Fill', options: [['fg', 'Foreground'], ['bg', 'Background'], ['none', 'None']] },
    { type: 'select', key: 'stroke', label: 'Stroke', options: [['none', 'None'], ['fg', 'Foreground'], ['bg', 'Background']] },
    { type: 'range', key: 'width', label: 'Width', min: 1, max: 200, unit: 'px', log: true },
    { type: 'range', key: 'radius', label: 'Corners', min: 0, max: 500, unit: 'px' },
  ],
  down(p) {
    const d = app.doc;
    const l = newLayer(d.width, d.height, d.layerName({ rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', polygon: 'Polygon', star: 'Star' }[app.opts.shape.kind]));
    d.addLayer(l);
    d.live = { layer: l, canvas: canvas(d.width, d.height), op: 'source-over', alpha: 1 };
    this.drag = { a: p, b: p, layer: l };
  },
  move(p, e) {
    const m = this.drag;
    if (!m) return;
    const o = app.opts.shape;
    let b = { ...p };
    if (e.shiftKey) {
      if (o.kind === 'line') {
        const ang = Math.round(Math.atan2(p.y - m.a.y, p.x - m.a.x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(p.x - m.a.x, p.y - m.a.y);
        b = { x: m.a.x + Math.cos(ang) * len, y: m.a.y + Math.sin(ang) * len };
      } else {
        const s = Math.max(Math.abs(b.x - m.a.x), Math.abs(b.y - m.a.y));
        b = { x: m.a.x + Math.sign(b.x - m.a.x || 1) * s, y: m.a.y + Math.sign(b.y - m.a.y || 1) * s };
      }
    }
    let a = m.a;
    if (e.altKey && o.kind !== 'line') a = { x: 2 * m.a.x - b.x, y: 2 * m.a.y - b.y };
    m.b = b;
    m.from = a;
    const g = ctx2d(app.doc.live.canvas);
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    drawShape(g, a, b, o);
    app.doc.changed();
  },
  up() {
    const m = this.drag;
    this.drag = null;
    if (!m) return;
    const d = app.doc;
    if (Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) < 1) {
      d.live = null;
      d.layers.splice(d.layers.indexOf(m.layer), 1);
      d.active = Math.max(0, d.active - 1);
      d.changed();
      emit('layers');
      return;
    }
    d.finishLive();
    d.commit({ rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', polygon: 'Polygon', star: 'Star' }[app.opts.shape.kind]);
  },
});

export function drawShape(g, a, b, o) {
  const color = (k) => (k === 'fg' ? app.fg : app.bg);
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  if (o.kind === 'line') {
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineWidth = o.width;
    g.strokeStyle = o.stroke !== 'none' ? color(o.stroke) : o.fill !== 'none' ? color(o.fill) : app.fg;
    g.stroke();
    return;
  }
  if (o.kind === 'rect') {
    const r = Math.min(o.radius, w / 2, h / 2);
    if (r > 0) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
  } else if (o.kind === 'ellipse') g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else {
    const n = o.kind === 'star' ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI * 2) / n;
      const k = o.kind === 'star' && i % 2 ? 0.45 : 1;
      const px = x + w / 2 + (Math.cos(ang) * w * k) / 2, py = y + h / 2 + (Math.sin(ang) * h * k) / 2;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
  }
  if (o.fill !== 'none') { g.fillStyle = color(o.fill); g.fill(); }
  if (o.stroke !== 'none') { g.lineWidth = o.width; g.strokeStyle = color(o.stroke); g.stroke(); }
}

tool({
  id: 'clone', name: 'Clone Stamp', key: 'S', cursor: 'crosshair',
  hint: 'Alt-click to pick the spot to copy from, then paint to copy it somewhere else.',
  options: () => [
    SIZE(),
    { type: 'range', key: 'hardness', label: 'Hardness', min: 0, max: 100, unit: '%' },
    { type: 'range', key: 'opacity', label: 'Opacity', min: 1, max: 100, unit: '%' },
    { type: 'check', key: 'aligned', label: 'Aligned' },
    { type: 'check', key: 'allLayers', label: 'Sample all layers' },
  ],
  down(p, e) {
    const d = app.doc;
    if (e.altKey) { this.source = { x: p.x, y: p.y, doc: d }; this.offset = null; status('Clone source set. Now paint where the copy should go.'); return; }
    if (!this.source || this.source.doc !== d) { status('Alt-click first to choose the spot to copy from.', 'danger'); return; }
    const l = paintable();
    if (!l) return;
    const o = app.opts.clone;
    if (!o.aligned || !this.offset) this.offset = { x: this.source.x - p.x, y: this.source.y - p.y };
    const src = cloneCanvas(o.allLayers ? d.composite() : l.canvas);
    d.live = { layer: l, canvas: canvas(d.width, d.height), op: 'source-over', alpha: o.opacity / 100 };
    const t = softTip(o.size, o.hardness, '#000000');
    const tmp = canvas(t.width, t.height);
    const gt = ctx2d(tmp);
    const gs = ctx2d(d.live.canvas);
    const off = this.offset;
    const stamp = (x, y) => {
      gt.globalCompositeOperation = 'copy';
      gt.drawImage(src, -(x + off.x - t.width / 2), -(y + off.y - t.height / 2));
      gt.globalCompositeOperation = 'destination-in';
      gt.drawImage(t, 0, 0);
      gs.drawImage(tmp, x - t.width / 2, y - t.height / 2);
    };
    this.stroke = { last: p, rest: 0, stamp, spacing: Math.max(1, o.size * 0.1) };
    stamp(p.x, p.y);
    d.changed();
    setOverlay((g) => {
      const s = this.stroke && toScreen(this.stroke.last.x + off.x, this.stroke.last.y + off.y);
      if (!s) return;
      g.strokeStyle = '#fff';
      g.beginPath(); g.moveTo(s.x - 6, s.y); g.lineTo(s.x + 6, s.y); g.moveTo(s.x, s.y - 6); g.lineTo(s.x, s.y + 6); g.stroke();
    });
  },
  move(p) {
    const s = this.stroke;
    if (!s) return;
    walk(s, s.last, p, s.spacing, s.stamp);
    s.last = p;
    app.doc.changed();
  },
  up() {
    if (!this.stroke) return;
    this.stroke = null;
    setOverlay(null);
    app.doc.finishLive();
    app.doc.commit('Clone Stamp');
  },
});

tool({
  id: 'blur', name: 'Blur / Sharpen', key: 'R', cursor: 'crosshair',
  hint: 'Paint to soften (or sharpen) the pixels under the brush.',
  options: () => [{ type: 'seg', key: 'kind', options: [['blur', 'Blur'], ['sharpen', 'Sharpen']] }, SIZE(500), { type: 'range', key: 'strength', label: 'Strength', min: 1, max: 100, unit: '%' }],
  ...dabTool('blur', blurProcess),
});

tool({
  id: 'dodge', name: 'Dodge / Burn', key: 'O', cursor: 'crosshair',
  hint: 'Paint to lighten (dodge) or darken (burn) the pixels under the brush.',
  options: () => [
    { type: 'seg', key: 'kind', options: [['dodge', 'Dodge'], ['burn', 'Burn']] }, SIZE(500),
    { type: 'select', key: 'range', label: 'Range', options: [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']] },
    { type: 'range', key: 'exposure', label: 'Exposure', min: 1, max: 100, unit: '%' },
  ],
  ...dabTool('dodge', dodgeProcess),
});

tool({
  id: 'hand', name: 'Hand', key: 'H', cursor: 'grab',
  hint: 'Drag to scroll around the picture. Hold Space to use it with any tool.',
  options: () => [],
  down(p, e) { this.last = { x: e.clientX, y: e.clientY }; },
  move(p, e) { if (!this.last) return; panBy(e.clientX - this.last.x, e.clientY - this.last.y); this.last = { x: e.clientX, y: e.clientY }; },
  up() { this.last = null; },
});

tool({
  id: 'zoom', name: 'Zoom', key: 'Z', cursor: 'zoom-in',
  hint: 'Click to zoom in, Alt-click to zoom out.',
  options: () => [],
  down(p, e) { zoomStep(e.altKey ? -1 : 1, e.offsetX, e.offsetY); },
});

export const toolById = (id) => TOOLS.find(t => t.id === id) || TOOLS[0];

// ---------------------------------------------------------------- free transform

/** Ctrl+T: scale, rotate and move the layer (or the selected pixels) with handles */
export function startTransform() {
  const d = app.doc;
  if (!d || app.session) return;
  const l = paintable();
  if (!l) return;
  const sel = d.sel;
  const b = sel ? selBounds(sel) : alphaBounds(l.canvas);
  if (!b) { status('There is nothing on this layer to transform.', 'danger'); return; }
  const content = canvas(b.w, b.h);
  const gc = ctx2d(content);
  gc.drawImage(l.canvas, -b.x, -b.y);
  if (sel) { gc.globalCompositeOperation = 'destination-in'; gc.drawImage(maskCanvas(sel), -b.x, -b.y); }
  const base = cloneCanvas(l.canvas);
  const gb = ctx2d(base);
  if (sel) { gb.globalCompositeOperation = 'destination-out'; gb.drawImage(maskCanvas(sel), 0, 0); } else gb.clearRect(0, 0, d.width, d.height);
  const out = canvas(d.width, d.height);
  const go = ctx2d(out);
  const t = { cx: b.x + b.w / 2, cy: b.y + b.h / 2, sx: 1, sy: 1, angle: 0, w0: b.w, h0: b.h };
  app.hideEdges = true;

  const corners = () => {
    const c = Math.cos(t.angle), s = Math.sin(t.angle);
    const W = t.w0 * t.sx, H = t.h0 * t.sy;
    const pt = (hx, hy) => ({ x: t.cx + c * (hx * W / 2) - s * (hy * H / 2), y: t.cy + s * (hx * W / 2) + c * (hy * H / 2) });
    return { pt, c, s, W, H };
  };
  const draw = () => {
    go.setTransform(1, 0, 0, 1, 0, 0);
    go.clearRect(0, 0, d.width, d.height);
    go.drawImage(base, 0, 0);
    go.imageSmoothingQuality = 'high';
    go.translate(t.cx, t.cy);
    go.rotate(t.angle);
    go.scale(t.sx, t.sy);
    go.drawImage(content, -t.w0 / 2, -t.h0 / 2);
    go.setTransform(1, 0, 0, 1, 0, 0);
    d.preview = { layer: l, canvas: out };
    d.changed();
    emit('options');
  };
  const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  setOverlay((g) => {
    const { pt } = corners();
    const q = HANDLES.map(([hx, hy]) => { const p = pt(hx, hy); return toScreen(p.x, p.y); });
    g.beginPath();
    [q[0], q[2], q[4], q[6]].forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.strokeStyle = '#e8650f'; g.lineWidth = 1.5; g.stroke();
    for (const p of q) { g.fillStyle = '#fff'; g.fillRect(p.x - 4, p.y - 4, 8, 8); g.strokeStyle = '#333'; g.lineWidth = 1; g.strokeRect(p.x - 4, p.y - 4, 8, 8); }
    const c = toScreen(t.cx, t.cy);
    g.beginPath(); g.arc(c.x, c.y, 4, 0, Math.PI * 2); g.strokeStyle = '#fff'; g.stroke();
  });

  const hit = (p) => {
    const { pt } = corners();
    const sp = toScreen(p.x, p.y);
    for (const [hx, hy] of HANDLES) {
      const q = toScreen(pt(hx, hy).x, pt(hx, hy).y);
      if (Math.hypot(q.x - sp.x, q.y - sp.y) < 9) return { kind: 'scale', hx, hy };
    }
    // inside the box?
    const c = Math.cos(-t.angle), s = Math.sin(-t.angle);
    const lx = c * (p.x - t.cx) - s * (p.y - t.cy), ly = s * (p.x - t.cx) + c * (p.y - t.cy);
    if (Math.abs(lx) <= Math.abs(t.w0 * t.sx) / 2 && Math.abs(ly) <= Math.abs(t.h0 * t.sy) / 2) return { kind: 'move' };
    return { kind: 'rotate' };
  };

  const end = () => { app.hideEdges = false; app.session = null; setOverlay(null); d.preview = null; d.changed(); emit('options'); };
  app.session = {
    tool: 'transform', t,
    options: () => [
      { type: 'label', text: 'Free Transform' },
      { type: 'number', label: 'W', value: Math.round(t.sx * 1000) / 10, unit: '%', set: (v) => { t.sx = v / 100; draw(); } },
      { type: 'number', label: 'H', value: Math.round(t.sy * 1000) / 10, unit: '%', set: (v) => { t.sy = v / 100; draw(); } },
      { type: 'number', label: 'Angle', value: Math.round((t.angle * 180) / Math.PI * 10) / 10, unit: '°', set: (v) => { t.angle = (v * Math.PI) / 180; draw(); } },
      { type: 'label', text: 'Drag corners to scale (Shift keeps proportions), outside to rotate' },
      { type: 'button', label: '✓ Apply', primary: true, action: () => app.session.commit() },
      { type: 'button', label: '✕ Cancel', action: () => app.session.cancel() },
    ],
    down(p) { this.drag = { ...hit(p), start: p, orig: { ...t } }; },
    move(p, e) {
      const m = this.drag;
      if (!m) return;
      const o = m.orig;
      if (m.kind === 'move') { t.cx = o.cx + p.x - m.start.x; t.cy = o.cy + p.y - m.start.y; }
      else if (m.kind === 'rotate') {
        let a = o.angle + Math.atan2(p.y - o.cy, p.x - o.cx) - Math.atan2(m.start.y - o.cy, m.start.x - o.cx);
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        t.angle = a;
      } else {
        const c = Math.cos(o.angle), s = Math.sin(o.angle);
        const W = o.w0 * o.sx, H = o.h0 * o.sy;
        const { hx, hy } = m;
        // the opposite handle stays where it is
        const fx = o.cx + c * (-hx * W / 2) - s * (-hy * H / 2), fy = o.cy + s * (-hx * W / 2) + c * (-hy * H / 2);
        const dx = p.x - fx, dy = p.y - fy;
        const du = dx * c + dy * s, dv = -dx * s + dy * c;
        let nW = hx ? du * hx : W, nH = hy ? dv * hy : H;
        if (e.shiftKey && hx && hy) { const k = (nW / W + nH / H) / 2; nW = W * k; nH = H * k; }
        else if (e.shiftKey) { const k = hx ? nW / W : nH / H; nW = W * k; nH = H * k; }
        t.sx = nW / o.w0; t.sy = nH / o.h0;
        const ncx = fx + c * (hx * nW / 2) - s * (hy * nH / 2), ncy = fy + s * (hx * nW / 2) + c * (hy * nH / 2);
        t.cx = ncx;
        t.cy = ncy;
      }
      draw();
    },
    up() { this.drag = null; },
    cursorAt(p) { const h = hit(p); return h.kind === 'move' ? 'move' : h.kind === 'rotate' ? 'alias' : 'crosshair'; },
    commit() {
      const changed = t.sx !== 1 || t.sy !== 1 || t.angle !== 0 || t.cx !== b.x + b.w / 2 || t.cy !== b.y + b.h / 2;
      end();
      if (!changed) return;
      const g = d.editable(l);
      g.globalCompositeOperation = 'copy';
      g.drawImage(out, 0, 0);
      g.globalCompositeOperation = 'source-over';
      if (sel) {
        // the selection follows the pixels
        const m = canvas(d.width, d.height);
        const gm = ctx2d(m);
        gm.translate(t.cx, t.cy); gm.rotate(t.angle); gm.scale(t.sx, t.sy);
        gm.drawImage(maskCanvas(sel), -b.x - t.w0 / 2, -b.y - t.h0 / 2);
        d.sel = selFromAlpha(m);
      }
      d.commit('Free Transform');
      emit('selection');
    },
    cancel: end,
  };
  draw();
}

/** The doc coordinates under a pointer event on the view canvas */
export function eventPoint(e) {
  return toDoc(e.offsetX, e.offsetY);
}

