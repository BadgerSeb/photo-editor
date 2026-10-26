// Selections are a mask (0 = not selected, 255 = selected, anything between is partly selected),
// one byte per pixel of the document. A selection object is never changed once made, so the
// history can keep it as it is; the canvas and outline versions are worked out once and cached.

import { canvas, ctx2d } from './util.js';

export function makeSel(mask, w, h) {
  let any = false;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { any = true; break; }
  return any ? { mask, w, h } : null;
}

/** A selection from a shape drawn by `draw(g)` (filled in white) */
export function selFromShape(w, h, draw) {
  const c = canvas(w, h);
  const g = ctx2d(c);
  g.fillStyle = '#fff';
  draw(g);
  return selFromAlpha(c);
}

export function selFromAlpha(c) {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  const m = new Uint8Array(c.width * c.height);
  for (let i = 0, j = 3; i < m.length; i++, j += 4) m[i] = d[j];
  return makeSel(m, c.width, c.height);
}

export function selAll(w, h) {
  return { mask: new Uint8Array(w * h).fill(255), w, h };
}

export function selRect(w, h, x, y, rw, rh) {
  return selFromShape(w, h, g => g.fillRect(x, y, rw, rh));
}

export function selEllipse(w, h, x, y, rw, rh) {
  return selFromShape(w, h, g => { g.beginPath(); g.ellipse(x + rw / 2, y + rh / 2, Math.abs(rw / 2), Math.abs(rh / 2), 0, 0, Math.PI * 2); g.fill(); });
}

export function selPolygon(w, h, pts) {
  return selFromShape(w, h, g => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fill();
  });
}

/** mode: 'new', 'add', 'subtract', 'intersect' */
export function combine(old, sel, mode) {
  if (mode === 'new' || !old) return mode === 'subtract' || mode === 'intersect' ? null : sel;
  const w = old.w, h = old.h;
  const a = old.mask, b = sel ? sel.mask : new Uint8Array(w * h);
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) {
    if (mode === 'add') m[i] = a[i] > b[i] ? a[i] : b[i];
    else if (mode === 'subtract') m[i] = (a[i] * (255 - b[i])) / 255;
    else m[i] = a[i] < b[i] ? a[i] : b[i];
  }
  return makeSel(m, w, h);
}

export function invert(sel, w, h) {
  if (!sel) return selAll(w, h);
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = 255 - sel.mask[i];
  return makeSel(m, w, h);
}

export function feather(sel, r) {
  if (!sel || r <= 0) return sel;
  const m = Float32Array.from(sel.mask);
  boxBlurChannel(m, sel.w, sel.h, r);
  return makeSel(Uint8Array.from(m, v => Math.round(v)), sel.w, sel.h);
}

/** Grows (n > 0) or shrinks (n < 0) a selection by n pixels */
export function grow(sel, n) {
  if (!sel || !n) return sel;
  const { w, h } = sel;
  const src = sel.mask;
  const grow = n > 0;
  const r = Math.abs(n);
  // two passes of a square min/max, then rounded by a circle test on the distance
  const pass = (from, horizontal) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let best = grow ? 0 : 255;
      for (let k = -r; k <= r; k++) {
        const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
        const v = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : from[yy * w + xx];
        best = grow ? (v > best ? v : best) : (v < best ? v : best);
      }
      out[y * w + x] = best;
    }
    return out;
  };
  return makeSel(pass(pass(src, true), false), w, h);
}

/** Separable box blur run three times, which looks like a Gaussian blur */
export function boxBlurChannel(a, w, h, r) {
  const tmp = new Float32Array(a.length);
  const rad = Math.max(1, Math.round(r / 1.7));
  for (let pass = 0; pass < 3; pass++) {
    blurLine(a, tmp, w, h, rad, 1, w);
    blurLine(tmp, a, h, w, rad, w, 1);
  }
}

function blurLine(src, dst, len, lines, r, step, lineStep) {
  const scale = 1 / (r * 2 + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[base + Math.min(len - 1, Math.max(0, k)) * step];
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = acc * scale;
      const add = Math.min(len - 1, i + r + 1), sub = Math.max(0, i - r);
      acc += src[base + add * step] - src[base + sub * step];
    }
  }
}

/** Magic wand: pixels whose color is within `tol` (0-255) of the clicked one */
export function wand(img, x, y, tol, contiguous) {
  const { width: w, height: h, data: d } = img;
  x = Math.floor(x); y = Math.floor(y);
  const m = new Uint8Array(w * h);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const o = (y * w + x) * 4;
  const r0 = d[o], g0 = d[o + 1], b0 = d[o + 2], a0 = d[o + 3];
  const near = (i) => {
    const j = i * 4;
    return Math.abs(d[j] - r0) <= tol && Math.abs(d[j + 1] - g0) <= tol && Math.abs(d[j + 2] - b0) <= tol && Math.abs(d[j + 3] - a0) <= tol;
  };
  if (!contiguous) {
    for (let i = 0; i < m.length; i++) if (near(i)) m[i] = 255;
    return makeSel(m, w, h);
  }
  // scanline flood fill
  const stack = [x, y];
  while (stack.length) {
    const sy = stack.pop(), sx = stack.pop();
    let lx = sx;
    while (lx >= 0 && !m[sy * w + lx] && near(sy * w + lx)) lx--;
    lx++;
    let rx = sx;
    while (rx < w && !m[sy * w + rx] && near(sy * w + rx)) rx++;
    rx--;
    if (lx > rx) continue;
    for (let i = lx; i <= rx; i++) m[sy * w + i] = 255;
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inRun = false;
      for (let i = lx; i <= rx; i++) {
        const ok = !m[ny * w + i] && near(ny * w + i);
        if (ok && !inRun) { stack.push(i, ny); inRun = true; } else if (!ok) inRun = false;
      }
    }
  }
  return makeSel(m, w, h);
}

const canvases = new WeakMap();
const outlines = new WeakMap();
const boundsCache = new WeakMap();

/** The selection as a white canvas whose transparency is the mask, for cutting things to it */
export function maskCanvas(sel) {
  let c = canvases.get(sel);
  if (c) return c;
  c = canvas(sel.w, sel.h);
  const g = ctx2d(c);
  const img = g.createImageData(sel.w, sel.h);
  const d = img.data;
  for (let i = 0, j = 0; i < sel.mask.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = sel.mask[i]; }
  g.putImageData(img, 0, 0);
  canvases.set(sel, c);
  return c;
}

/** The edge of the selection (where the mask crosses 50%), as a path in document pixels */
export function outline(sel) {
  let p = outlines.get(sel);
  if (p) return p;
  const { w, h, mask } = sel;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= 128;
  p = new Path2D();
  // horizontal edges between rows y-1 and y, merged into runs
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && inside(x, y) !== inside(x, y - 1);
      if (edge && start < 0) start = x;
      else if (!edge && start >= 0) { p.moveTo(start, y); p.lineTo(x, y); start = -1; }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && inside(x, y) !== inside(x - 1, y);
      if (edge && start < 0) start = y;
      else if (!edge && start >= 0) { p.moveTo(x, start); p.lineTo(x, y); start = -1; }
    }
  }
  outlines.set(sel, p);
  return p;
}

/** The smallest rectangle holding everything selected */
export function selBounds(sel) {
  if (!sel) return null;
  if (boundsCache.has(sel)) return boundsCache.get(sel);
  const { w, h, mask } = sel;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) if (mask[row + x]) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  const b = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  boundsCache.set(sel, b);
  return b;
}

/** Moves a selection by (dx, dy), as when its pixels are dragged */
export function offsetSel(sel, dx, dy) {
  if (!sel) return null;
  const c = canvas(sel.w, sel.h);
  ctx2d(c).drawImage(maskCanvas(sel), Math.round(dx), Math.round(dy));
  return selFromAlpha(c);
}

/** The bounding box of the visible pixels of a canvas */
export function alphaBounds(c) {
  const { width: w, height: h } = c;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
