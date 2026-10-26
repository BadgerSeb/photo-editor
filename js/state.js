// What the whole app shares: the open documents, the current tool, the two colors and the
// tool settings (remembered between visits).

import { store, emit } from './util.js';

export const DEFAULT_OPTS = {
  move: { autoSelect: false },
  marquee: { shape: 'rect', mode: 'new', feather: 0 },
  lasso: { kind: 'free', mode: 'new', feather: 0 },
  wand: { tolerance: 32, contiguous: true, allLayers: false, mode: 'new' },
  crop: {},
  brush: { size: 20, hardness: 80, opacity: 100 },
  pencil: { size: 1, opacity: 100 },
  eraser: { size: 30, hardness: 80, opacity: 100 },
  bucket: { tolerance: 32, contiguous: true, allLayers: false, opacity: 100 },
  gradient: { kind: 'linear', colors: 'fg-bg', opacity: 100, reverse: false },
  eyedropper: { sample: 1, allLayers: true },
  text: { font: 'Segoe UI', size: 48, bold: false, italic: false, align: 'left' },
  shape: { kind: 'rect', fill: 'fg', stroke: 'none', width: 4, radius: 0 },
  clone: { size: 40, hardness: 60, opacity: 100, aligned: true, allLayers: false },
  blur: { kind: 'blur', size: 40, strength: 50 },
  dodge: { kind: 'dodge', size: 50, exposure: 30, range: 'midtones' },
  hand: {},
  zoom: {},
};

function loadOpts() {
  const saved = store.get('opts', {});
  const out = {};
  for (const [k, v] of Object.entries(DEFAULT_OPTS)) out[k] = { ...v, ...(saved[k] || {}) };
  return out;
}

export const app = {
  docs: [],
  doc: null,
  tool: store.get('tool', 'brush'),
  fg: store.get('fg', '#000000'),
  bg: store.get('bg', '#ffffff'),
  opts: loadOpts(),
  clipboard: null,       // { canvas, x, y } copied pixels
  lastFilter: null,      // { name, params }
  lastSel: null,         // for Reselect
  session: null,         // a crop, transform or text edit waiting for Enter / Esc
};

export function saveOpts() { store.set('opts', app.opts); }

export function setColors(fg, bg) {
  if (fg) app.fg = fg;
  if (bg) app.bg = bg;
  store.set('fg', app.fg);
  store.set('bg', app.bg);
  emit('colors');
}

let msgTimer;
/** A short message in the status bar */
export function status(msg, kind = '') {
  emit('status', msg, kind);
  clearTimeout(msgTimer);
  if (msg) msgTimer = setTimeout(() => emit('status', '', ''), kind === 'danger' ? 8000 : 4000);
}

/** The active layer, if it can be painted on; otherwise says why not */
export function paintable() {
  const d = app.doc;
  if (!d) return null;
  const l = d.layer;
  if (!l) return null;
  if (l.locked) { status(`"${l.name}" is locked. Unlock it in the Layers panel to change it.`, 'danger'); return null; }
  if (!l.visible) { status(`"${l.name}" is hidden. Show it in the Layers panel to change it.`, 'danger'); return null; }
  return l;
}
