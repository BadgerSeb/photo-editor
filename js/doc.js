// The open picture: its layers, selection, undo history and how the layers are blended together.
//
// History works copy-on-write: every saved state keeps references to the layer canvases as they
// were. A canvas that a state refers to is never drawn on again; editable() swaps in a copy first.
// So an undo step only costs memory for the layers that step actually changed.

import { canvas, ctx2d, cloneCanvas, emit } from './util.js';
import { maskCanvas } from './selection.js';

export const BLENDS = [
  { id: 'normal', name: 'Normal', op: 'source-over', psd: 'norm' },
  { id: 'darken', name: 'Darken', op: 'darken', psd: 'dark' },
  { id: 'multiply', name: 'Multiply', op: 'multiply', psd: 'mul ' },
  { id: 'color-burn', name: 'Color Burn', op: 'color-burn', psd: 'idiv' },
  { id: 'lighten', name: 'Lighten', op: 'lighten', psd: 'lite' },
  { id: 'screen', name: 'Screen', op: 'screen', psd: 'scrn' },
  { id: 'color-dodge', name: 'Color Dodge', op: 'color-dodge', psd: 'div ' },
  { id: 'linear-dodge', name: 'Linear Dodge (Add)', op: 'lighter', psd: 'lddg' },
  { id: 'overlay', name: 'Overlay', op: 'overlay', psd: 'over' },
  { id: 'soft-light', name: 'Soft Light', op: 'soft-light', psd: 'sLit' },
  { id: 'hard-light', name: 'Hard Light', op: 'hard-light', psd: 'hLit' },
  { id: 'difference', name: 'Difference', op: 'difference', psd: 'diff' },
  { id: 'exclusion', name: 'Exclusion', op: 'exclusion', psd: 'smud' },
  { id: 'hue', name: 'Hue', op: 'hue', psd: 'hue ' },
  { id: 'saturation', name: 'Saturation', op: 'saturation', psd: 'sat ' },
  { id: 'color', name: 'Color', op: 'color', psd: 'colr' },
  { id: 'luminosity', name: 'Luminosity', op: 'luminosity', psd: 'lum ' },
];
export const blendOf = (id) => BLENDS.find(b => b.id === id) || BLENDS[0];

const HISTORY_BYTES = 900 * 1024 * 1024;
const HISTORY_STEPS = 60;
const frozen = new WeakSet();
let nextId = 1;
let nextDoc = 1;

export function newLayer(w, h, name, src) {
  const c = canvas(w, h);
  if (src) ctx2d(c).drawImage(src, 0, 0);
  return { id: nextId++, name, canvas: c, visible: true, opacity: 1, blend: 'normal', locked: false };
}

export class Doc {
  constructor(width, height, name) {
    this.id = nextDoc++;
    this.width = width;
    this.height = height;
    this.name = name;
    this.layers = [];
    this.active = 0;
    this.sel = null;
    this.history = [];
    this.hIndex = -1;
    this.savedIndex = -1;
    this.view = { zoom: 1, ox: 0, oy: 0, fit: true };
    this.live = null;      // a brush stroke being painted: { layer, canvas, op, alpha }
    this.preview = null;   // a layer shown differently for a moment: { layer, canvas }
    this.handle = null;    // where Save writes the .psd again
    this.comp = canvas(width, height);
    this.compDirty = true;
    this.scratch = null;
  }

  get layer() { return this.layers[this.active]; }
  get dirty() { return this.hIndex !== this.savedIndex; }

  /** The layer's canvas, ready to draw on (copied first if the history still needs the old one) */
  editable(layer = this.layer) {
    if (frozen.has(layer.canvas)) layer.canvas = cloneCanvas(layer.canvas);
    this.changed();
    return ctx2d(layer.canvas);
  }

  changed() {
    this.compDirty = true;
    emit('render');
  }

  snapshot(label) {
    return {
      label, width: this.width, height: this.height, active: this.active, sel: this.sel,
      layers: this.layers.map(l => ({ ...l })),
    };
  }

  /** Saves the current state as a step in the history (after a change has been made) */
  commit(label) {
    this.history.splice(this.hIndex + 1);
    const s = this.snapshot(label);
    for (const l of s.layers) frozen.add(l.canvas);
    this.history.push(s);
    this.hIndex = this.history.length - 1;
    if (this.savedIndex > this.hIndex) this.savedIndex = -2;
    this.trimHistory();
    this.changed();
    emit('history');
    emit('layers');
  }

  trimHistory() {
    const cost = () => {
      const seen = new Set();
      let bytes = 0;
      for (const s of this.history) for (const l of s.layers) if (!seen.has(l.canvas)) { seen.add(l.canvas); bytes += l.canvas.width * l.canvas.height * 4; }
      return bytes;
    };
    while (this.history.length > 2 && (this.history.length > HISTORY_STEPS || cost() > HISTORY_BYTES)) {
      this.history.shift();
      this.hIndex--;
      this.savedIndex = this.savedIndex >= 1 ? this.savedIndex - 1 : -2;
    }
  }

  restore(i) {
    if (i < 0 || i >= this.history.length) return;
    const s = this.history[i];
    this.hIndex = i;
    this.width = s.width;
    this.height = s.height;
    this.layers = s.layers.map(l => ({ ...l }));
    this.active = Math.min(s.active, this.layers.length - 1);
    this.sel = s.sel;
    this.live = this.preview = null;
    this.sizeChanged();
    emit('history');
    emit('layers');
    emit('selection');
  }

  undo() { if (this.hIndex > 0) this.restore(this.hIndex - 1); }
  redo() { if (this.hIndex < this.history.length - 1) this.restore(this.hIndex + 1); }

  sizeChanged() {
    if (this.comp.width !== this.width || this.comp.height !== this.height) {
      this.comp = canvas(this.width, this.height);
      this.scratch = null;
    }
    this.changed();
    emit('size');
  }

  /** All visible layers blended together, as one canvas */
  composite() {
    if (!this.compDirty) return this.comp;
    const g = ctx2d(this.comp);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.width, this.height);
    for (const l of this.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      g.globalAlpha = l.opacity;
      g.globalCompositeOperation = blendOf(l.blend).op;
      g.drawImage(this.source(l), 0, 0);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    this.compDirty = false;
    return this.comp;
  }

  /** What a layer looks like right now, with a stroke in progress or a preview applied */
  source(l) {
    if (this.preview && this.preview.layer === l) return this.preview.canvas;
    if (this.live && this.live.layer === l) {
      this.scratch ||= [canvas(this.width, this.height), canvas(this.width, this.height)];
      const [a, b] = this.scratch;
      const ga = ctx2d(a);
      ga.globalCompositeOperation = 'copy';
      ga.drawImage(l.canvas, 0, 0);
      this.applyStroke(ga, this.maskedStroke(b));
      return a;
    }
    return l.canvas;
  }

  /** The stroke in progress, cut to the selection */
  maskedStroke(into) {
    if (!this.sel) return this.live.canvas;
    const g = ctx2d(into);
    g.globalCompositeOperation = 'copy';
    g.drawImage(this.live.canvas, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(maskCanvas(this.sel), 0, 0);
    g.globalCompositeOperation = 'source-over';
    return into;
  }

  applyStroke(g, stroke) {
    g.globalCompositeOperation = this.live.op;
    g.globalAlpha = this.live.alpha;
    g.drawImage(stroke, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /** Applies the stroke in progress to its layer for good */
  finishLive() {
    if (!this.live) return;
    const g = this.editable(this.live.layer);
    this.applyStroke(g, this.maskedStroke(canvas(this.width, this.height)));
    this.live = null;
    this.changed();
  }
  addLayer(layer, at = this.active + 1) {
    this.layers.splice(at, 0, layer);
    this.active = at;
    this.changed();
  }

  layerName(base) {
    let n = 1;
    const names = new Set(this.layers.map(l => l.name));
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }
}

/** A new document with one layer, either filled or holding a picture */
export function makeDoc(width, height, name, { fill, image, layerName } = {}) {
  const d = new Doc(width, height, name);
  const l = newLayer(width, height, layerName || (image ? 'Background' : 'Background'));
  const g = ctx2d(l.canvas);
  if (fill) { g.fillStyle = fill; g.fillRect(0, 0, width, height); }
  if (image) g.drawImage(image, 0, 0);
  d.layers.push(l);
  d.commit(image ? 'Open' : 'New');
  d.savedIndex = d.hIndex;
  return d;
}
