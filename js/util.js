// Small helpers shared by every part of the app.

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

export function ctx2d(c) {
  return c.getContext('2d');
}

export function cloneCanvas(src) {
  const c = canvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

/** Pixels of a canvas (or part of it), without the browser smoothing anything */
export function pixels(c, x = 0, y = 0, w = c.width, h = c.height) {
  return ctx2d(c).getImageData(x, y, w, h);
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

/** Settings kept between visits; storage can be missing or blocked, so every access is guarded */
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('photo-editor.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('photo-editor.' + key, JSON.stringify(value)); } catch { }
  },
};

/** A tiny event hub: parts of the UI redraw when the document changes */
const handlers = {};
export function on(name, fn) { (handlers[name] ||= []).push(fn); }
export function emit(name, ...args) { for (const fn of handlers[name] || []) fn(...args); }

export function baseName(name) {
  return String(name || 'Untitled').replace(/\.[^.]+$/, '');
}

export function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

export function canvasBlob(c, type = 'image/png', quality) {
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error("The picture couldn't be encoded."))), type, quality));
}

export const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
