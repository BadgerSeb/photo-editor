// Adjustments and filters. Plain functions on RGBA pixel arrays, so they run in the worker
// (filter-worker.js) and the page stays responsive. Each one returns the new pixels.
//
// FILTERS describes them for the menus and dialogs: `fields` become sliders, a filter without
// fields runs straight away.

export const FILTERS = {
  'brightness-contrast': {
    name: 'Brightness/Contrast', menu: 'adjust', key: '',
    fields: [{ id: 'brightness', label: 'Brightness', min: -150, max: 150, value: 0 }, { id: 'contrast', label: 'Contrast', min: -100, max: 100, value: 0 }],
  },
  levels: {
    name: 'Levels', menu: 'adjust', key: 'Ctrl+L',
    fields: [
      { id: 'inLow', label: 'Input black', min: 0, max: 253, value: 0 },
      { id: 'gamma', label: 'Midtones (gamma)', min: 0.1, max: 9.99, step: 0.01, value: 1 },
      { id: 'inHigh', label: 'Input white', min: 2, max: 255, value: 255 },
      { id: 'outLow', label: 'Output black', min: 0, max: 255, value: 0 },
      { id: 'outHigh', label: 'Output white', min: 0, max: 255, value: 255 },
    ],
  },
  curves: { name: 'Curves', menu: 'adjust', key: 'Ctrl+M', custom: 'curves' },
  exposure: {
    name: 'Exposure', menu: 'adjust',
    fields: [
      { id: 'exposure', label: 'Exposure (stops)', min: -5, max: 5, step: 0.01, value: 0 },
      { id: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.001, value: 0 },
      { id: 'gamma', label: 'Gamma', min: 0.1, max: 9.99, step: 0.01, value: 1 },
    ],
  },
  'hue-saturation': {
    name: 'Hue/Saturation', menu: 'adjust', key: 'Ctrl+U',
    fields: [
      { id: 'hue', label: 'Hue', min: -180, max: 180, value: 0 },
      { id: 'saturation', label: 'Saturation', min: -100, max: 100, value: 0 },
      { id: 'lightness', label: 'Lightness', min: -100, max: 100, value: 0 },
      { id: 'colorize', label: 'Colorize', type: 'check', value: false },
    ],
  },
  'color-balance': {
    name: 'Color Balance', menu: 'adjust', key: 'Ctrl+B',
    fields: [
      { id: 'cr', label: 'Cyan ↔ Red', min: -100, max: 100, value: 0 },
      { id: 'mg', label: 'Magenta ↔ Green', min: -100, max: 100, value: 0 },
      { id: 'yb', label: 'Yellow ↔ Blue', min: -100, max: 100, value: 0 },
      { id: 'range', label: 'Tones', type: 'select', options: [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']], value: 'midtones' },
    ],
  },
  vibrance: {
    name: 'Vibrance', menu: 'adjust',
    fields: [{ id: 'vibrance', label: 'Vibrance', min: -100, max: 100, value: 0 }, { id: 'saturation', label: 'Saturation', min: -100, max: 100, value: 0 }],
  },
  invert: { name: 'Invert', menu: 'adjust', key: 'Ctrl+I', sep: true },
  desaturate: { name: 'Desaturate', menu: 'adjust', key: 'Ctrl+Shift+U' },
  sepia: { name: 'Sepia', menu: 'adjust' },
  threshold: { name: 'Threshold', menu: 'adjust', fields: [{ id: 'level', label: 'Threshold level', min: 1, max: 255, value: 128 }] },
  posterize: { name: 'Posterize', menu: 'adjust', fields: [{ id: 'levels', label: 'Levels', min: 2, max: 64, value: 4 }] },

  'gaussian-blur': { name: 'Gaussian Blur', menu: 'filter', group: 'Blur', fields: [{ id: 'radius', label: 'Radius (px)', min: 0.5, max: 250, step: 0.1, value: 4, log: true }] },
  'motion-blur': {
    name: 'Motion Blur', menu: 'filter', group: 'Blur',
    fields: [{ id: 'angle', label: 'Angle (°)', min: -180, max: 180, value: 0 }, { id: 'distance', label: 'Distance (px)', min: 1, max: 200, value: 20 }],
  },
  sharpen: { name: 'Sharpen', menu: 'filter', group: 'Sharpen' },
  'unsharp-mask': {
    name: 'Unsharp Mask', menu: 'filter', group: 'Sharpen',
    fields: [
      { id: 'amount', label: 'Amount (%)', min: 1, max: 500, value: 100 },
      { id: 'radius', label: 'Radius (px)', min: 0.1, max: 100, step: 0.1, value: 1.5, log: true },
      { id: 'threshold', label: 'Threshold (levels)', min: 0, max: 255, value: 0 },
    ],
  },
  noise: {
    name: 'Add Noise', menu: 'filter', group: 'Noise',
    fields: [{ id: 'amount', label: 'Amount (%)', min: 0.1, max: 200, step: 0.1, value: 12 }, { id: 'mono', label: 'Monochromatic', type: 'check', value: false }],
  },
  median: { name: 'Median (despeckle)', menu: 'filter', group: 'Noise', fields: [{ id: 'radius', label: 'Radius (px)', min: 1, max: 10, value: 1 }] },
  pixelate: { name: 'Pixelate (mosaic)', menu: 'filter', group: 'Pixelate', fields: [{ id: 'size', label: 'Cell size (px)', min: 2, max: 200, value: 10 }] },
  emboss: {
    name: 'Emboss', menu: 'filter', group: 'Stylize',
    fields: [{ id: 'angle', label: 'Angle (°)', min: -180, max: 180, value: 135 }, { id: 'height', label: 'Height (px)', min: 1, max: 10, value: 2 }, { id: 'amount', label: 'Amount (%)', min: 1, max: 500, value: 100 }],
  },
  'find-edges': { name: 'Find Edges', menu: 'filter', group: 'Stylize' },
  vignette: {
    name: 'Vignette', menu: 'filter', group: 'Stylize',
    fields: [{ id: 'amount', label: 'Amount (%)', min: -100, max: 100, value: 50 }, { id: 'size', label: 'Size (%)', min: 0, max: 100, value: 50 }],
  },
};

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Runs filter `name` on RGBA `d` (w × h); `mask` limits it to the selection */
export function runFilter(name, d, w, h, p = {}, mask = null) {
  const src = mask ? d.slice() : null;
  const out = FN[name](d, w, h, p) || d;
  if (mask) {
    for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
      const m = mask[i];
      if (m === 255) continue;
      if (m === 0) { out[j] = src[j]; out[j + 1] = src[j + 1]; out[j + 2] = src[j + 2]; out[j + 3] = src[j + 3]; continue; }
      const k = m / 255;
      for (let c = 0; c < 4; c++) out[j + c] = src[j + c] + (out[j + c] - src[j + c]) * k;
    }
  }
  return out;
}

function lut(d, f) {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = f(i);
  for (let i = 0; i < d.length; i += 4) { d[i] = t[d[i]]; d[i + 1] = t[d[i + 1]]; d[i + 2] = t[d[i + 2]]; }
  return d;
}

function lut3(d, tr, tg, tb) {
  for (let i = 0; i < d.length; i += 4) { d[i] = tr[d[i]]; d[i + 1] = tg[d[i + 1]]; d[i + 2] = tb[d[i + 2]]; }
  return d;
}

/** A smooth curve through the points [[x, y], ...] (0-255), as a lookup table */
export function curveTable(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const t = new Uint8ClampedArray(256);
  if (n < 2) { for (let i = 0; i < 256; i++) t[i] = i; return t; }
  // monotone cubic (Fritsch–Carlson), so the curve never overshoots between points
  const dx = [], m = [], s = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6; s[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  m[0] = s[0]; m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / s[i], b = m[i + 1] / s[i], q = a * a + b * b;
    if (q > 9) { const k = 3 / Math.sqrt(q); m[i] = k * a * s[i]; m[i + 1] = k * b * s[i]; }
  }
  for (let x = 0; x < 256; x++) {
    if (x <= pts[0][0]) { t[x] = pts[0][1]; continue; }
    if (x >= pts[n - 1][0]) { t[x] = pts[n - 1][1]; continue; }
    let i = 0;
    while (x > pts[i + 1][0]) i++;
    const h = dx[i], u = (x - pts[i][0]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    t[x] = h00 * pts[i][1] + h10 * h * m[i] + h01 * pts[i + 1][1] + h11 * h * m[i + 1];
  }
  return t;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const dd = max - min;
  const s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
  let h;
  if (max === r) h = (g - b) / dd + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / dd + 2;
  else h = (r - g) / dd + 4;
  return [h / 6, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

/** A random-number generator that always gives the same numbers, so the preview matches the result */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Blur in premultiplied color, so transparent edges don't turn dark */
function blurRGBA(d, w, h, radius) {
  if (radius <= 0) return d;
  const n = w * h;
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = d[j + 3] / 255;
    ch[0][i] = d[j] * a; ch[1][i] = d[j + 1] * a; ch[2][i] = d[j + 2] * a; ch[3][i] = d[j + 3];
  }
  // three box blurs approximate a Gaussian with this standard deviation
  const sigma = radius;
  const boxes = boxSizes(sigma, 3);
  const tmp = new Float32Array(n);
  for (const c of ch) for (const b of boxes) { boxH(c, tmp, w, h, (b - 1) / 2); boxV(tmp, c, w, h, (b - 1) / 2); }
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = ch[3][i];
    const k = a > 0 ? 255 / a : 0;
    d[j] = ch[0][i] * k; d[j + 1] = ch[1][i] * k; d[j + 2] = ch[2][i] * k; d[j + 3] = a;
  }
  return d;
}

function boxSizes(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes.map(s => Math.max(1, s));
}

function boxH(src, dst, w, h, r) {
  if (r < 1) { dst.set(src); return; }
  const k = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const first = src[row], last = src[row + w - 1];
    let acc = (r + 1) * first;
    for (let x = 0; x < r; x++) acc += src[row + Math.min(x, w - 1)];
    for (let x = 0; x < w; x++) {
      acc += (x + r < w ? src[row + x + r] : last) - (x - r - 1 >= 0 ? src[row + x - r - 1] : first);
      dst[row + x] = acc * k;
    }
  }
}

function boxV(src, dst, w, h, r) {
  if (r < 1) { dst.set(src); return; }
  const k = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    const first = src[x], last = src[x + (h - 1) * w];
    let acc = (r + 1) * first;
    for (let y = 0; y < r; y++) acc += src[x + Math.min(y, h - 1) * w];
    for (let y = 0; y < h; y++) {
      acc += (y + r < h ? src[x + (y + r) * w] : last) - (y - r - 1 >= 0 ? src[x + (y - r - 1) * w] : first);
      dst[x + y * w] = acc * k;
    }
  }
}

function convolve(d, w, h, kernel, bias = 0) {
  const src = d.slice();
  const size = Math.sqrt(kernel.length) | 0, half = size >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let ky = 0; ky < size; ky++) {
      const yy = Math.min(h - 1, Math.max(0, y + ky - half));
      for (let kx = 0; kx < size; kx++) {
        const xx = Math.min(w - 1, Math.max(0, x + kx - half));
        const o = (yy * w + xx) * 4, k = kernel[ky * size + kx];
        r += src[o] * k; g += src[o + 1] * k; b += src[o + 2] * k;
      }
    }
    const o = (y * w + x) * 4;
    d[o] = r + bias; d[o + 1] = g + bias; d[o + 2] = b + bias;
  }
  return d;
}

function unsharp(d, w, h, amount, radius, threshold) {
  const blurred = blurRGBA(d.slice(), w, h, radius);
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = d[i + c] - blurred[i + c];
      if (Math.abs(diff) * 2 >= threshold) d[i + c] = clamp8(d[i + c] + diff * amount);
    }
  }
  return d;
}

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

const FN = {
  'brightness-contrast'(d, w, h, p) {
    const b = +p.brightness || 0, c = (+p.contrast || 0) * 2.55;
    const f = (259 * (c + 255)) / (255 * (259 - c));
    return lut(d, v => f * (v + b - 128) + 128);
  },
  levels(d, w, h, p) {
    const lo = +p.inLow, hi = Math.max(lo + 1, +p.inHigh), g = +p.gamma || 1, ol = +p.outLow, oh = +p.outHigh;
    return lut(d, v => {
      const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      return ol + Math.pow(x, 1 / g) * (oh - ol);
    });
  },
  curves(d, w, h, p) {
    const base = curveTable(p.rgb || [[0, 0], [255, 255]]);
    const ch = (pts) => { const t = curveTable(pts || [[0, 0], [255, 255]]); return Uint8ClampedArray.from(base, v => t[v]); };
    return lut3(d, ch(p.r), ch(p.g), ch(p.b));
  },
  exposure(d, w, h, p) {
    const k = Math.pow(2, +p.exposure || 0), o = +p.offset || 0, g = +p.gamma || 1;
    return lut(d, v => Math.pow(Math.max(0, (v / 255) * k + o), 1 / g) * 255);
  },
  'hue-saturation'(d, w, h, p) {
    const dh = (+p.hue || 0) / 360, ds = (+p.saturation || 0) / 100, dl = (+p.lightness || 0) / 100;
    for (let i = 0; i < d.length; i += 4) {
      let [hh, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      if (p.colorize) { hh = ((+p.hue || 0) + 360) % 360 / 360; s = Math.max(0, Math.min(1, 0.25 + ds * 0.75)); }
      else {
        hh = (hh + dh + 1) % 1;
        s = ds > 0 ? s + (1 - s) * ds * (s > 0 ? 1 : 0) : s * (1 + ds);
      }
      l = dl > 0 ? l + (1 - l) * dl : l * (1 + dl);
      const [r, g, b] = hslToRgb(hh, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    return d;
  },
  'color-balance'(d, w, h, p) {
    const weight = (v) => {
      const x = v / 255;
      if (p.range === 'shadows') return Math.max(0, 1 - x * 2.2);
      if (p.range === 'highlights') return Math.max(0, x * 2.2 - 1.2);
      return 1 - Math.pow((x - 0.5) * 2, 2);
    };
    const t = (amt) => { const a = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) a[v] = v + amt * 0.8 * weight(v); return a; };
    const cr = +p.cr || 0, mg = +p.mg || 0, yb = +p.yb || 0;
    // each slider pushes one channel up and the other two down a little, like Photoshop's
    return lut3(d, t(cr - (mg + yb) / 2), t(mg - (cr + yb) / 2), t(yb - (cr + mg) / 2));
  },
  vibrance(d, w, h, p) {
    const vib = (+p.vibrance || 0) / 100, sat = (+p.saturation || 0) / 100;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // vibrance lifts dull colors more than ones that are already strong
      const amt = vib * (1 - (Math.max(r, g, b) - Math.min(r, g, b)) / 255) * 2 + sat;
      const l = lum(r, g, b);
      d[i] = l + (r - l) * (1 + amt); d[i + 1] = l + (g - l) * (1 + amt); d[i + 2] = l + (b - l) * (1 + amt);
    }
    return d;
  },
  invert(d) {
    for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
    return d;
  },
  desaturate(d) {
    for (let i = 0; i < d.length; i += 4) { const l = lum(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = l; }
    return d;
  },
  sepia(d) {
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = r * 0.393 + g * 0.769 + b * 0.189;
      d[i + 1] = r * 0.349 + g * 0.686 + b * 0.168;
      d[i + 2] = r * 0.272 + g * 0.534 + b * 0.131;
    }
    return d;
  },
  threshold(d, w, h, p) {
    const t = +p.level;
    for (let i = 0; i < d.length; i += 4) { const v = lum(d[i], d[i + 1], d[i + 2]) >= t ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
    return d;
  },
  posterize(d, w, h, p) {
    const n = Math.max(2, +p.levels | 0);
    return lut(d, v => Math.round(Math.round((v / 255) * (n - 1)) * (255 / (n - 1))));
  },
  'gaussian-blur'(d, w, h, p) { return blurRGBA(d, w, h, +p.radius); },
  'motion-blur'(d, w, h, p) {
    const src = d.slice();
    const dist = Math.max(1, +p.distance | 0), a = ((+p.angle || 0) * Math.PI) / 180;
    const dx = Math.cos(a), dy = -Math.sin(a);
    const steps = dist * 2 + 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let s = -dist; s <= dist; s++) {
        const xx = Math.min(w - 1, Math.max(0, Math.round(x + dx * s))), yy = Math.min(h - 1, Math.max(0, Math.round(y + dy * s)));
        const o = (yy * w + xx) * 4, k = src[o + 3];
        r += src[o] * k; g += src[o + 1] * k; b += src[o + 2] * k; al += k;
      }
      const o = (y * w + x) * 4;
      if (al > 0) { d[o] = r / al; d[o + 1] = g / al; d[o + 2] = b / al; }
      d[o + 3] = al / steps;
    }
    return d;
  },
  sharpen(d, w, h) { return unsharp(d, w, h, 0.6, 1, 0); },
  'unsharp-mask'(d, w, h, p) { return unsharp(d, w, h, (+p.amount || 0) / 100, +p.radius || 1, +p.threshold || 0); },
  noise(d, w, h, p) {
    const amt = (+p.amount || 0) * 2.55 * 0.5, rand = rng(12345);
    for (let i = 0; i < d.length; i += 4) {
      if (p.mono) { const n = (rand() * 2 - 1) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      else { d[i] += (rand() * 2 - 1) * amt; d[i + 1] += (rand() * 2 - 1) * amt; d[i + 2] += (rand() * 2 - 1) * amt; }
    }
    return d;
  },
  median(d, w, h, p) {
    const r = Math.max(1, +p.radius | 0), src = d.slice();
    const hist = new Uint32Array(256);
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        hist.fill(0);
        let n = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
          for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { hist[src[(yy * w + xx) * 4 + c]]++; n++; }
        let acc = 0, v = 0;
        while ((acc += hist[v]) < n / 2) v++;
        d[(y * w + x) * 4 + c] = v;
      }
    }
    return d;
  },
  pixelate(d, w, h, p) {
    const s = Math.max(2, +p.size | 0);
    for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const ex = Math.min(w, bx + s), ey = Math.min(h, by + s);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const o = (y * w + x) * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; a += d[o + 3]; n++; }
      r /= n; g /= n; b /= n; a /= n;
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const o = (y * w + x) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a; }
    }
    return d;
  },
  emboss(d, w, h, p) {
    const src = d.slice();
    const a = ((+p.angle || 0) * Math.PI) / 180, ht = +p.height || 1, amt = (+p.amount || 100) / 100;
    const ox = Math.round(Math.cos(a) * ht), oy = Math.round(-Math.sin(a) * ht);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x1 = Math.min(w - 1, Math.max(0, x - ox)), y1 = Math.min(h - 1, Math.max(0, y - oy));
      const x2 = Math.min(w - 1, Math.max(0, x + ox)), y2 = Math.min(h - 1, Math.max(0, y + oy));
      const o1 = (y1 * w + x1) * 4, o2 = (y2 * w + x2) * 4;
      const v = 128 + (lum(src[o2], src[o2 + 1], src[o2 + 2]) - lum(src[o1], src[o1 + 1], src[o1 + 2])) * amt;
      const o = (y * w + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = v;
    }
    return d;
  },
  'find-edges'(d, w, h) {
    const src = d.slice();
    const at = (x, y, c) => src[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const gx = -at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c) + at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c);
        const gy = -at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c) + at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c);
        d[o + c] = 255 - Math.min(255, Math.sqrt(gx * gx + gy * gy));
      }
    }
    return d;
  },
  vignette(d, w, h, p) {
    const amt = (+p.amount || 0) / 100, size = 0.3 + ((+p.size || 0) / 100) * 0.9;
    const cx = w / 2, cy = h / 2, maxR = Math.hypot(cx, cy);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - cx, y - cy) / maxR;
      const f = Math.min(1, Math.max(0, (r - size * 0.6) / (1.05 - size * 0.6)));
      const k = f * f * (3 - 2 * f) * amt;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) d[o + c] = k > 0 ? d[o + c] * (1 - k) : d[o + c] + (255 - d[o + c]) * -k;
    }
    return d;
  },
};
