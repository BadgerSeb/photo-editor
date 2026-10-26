// Changes made from the menus and panels: image size, canvas size, rotating, layers, selections,
// clipboard. Each one ends with doc.commit(), which makes it one undo step.

import { canvas, ctx2d, cloneCanvas, emit } from './util.js';
import { app, paintable, status } from './state.js';
import { newLayer, blendOf } from './doc.js';
import { selAll, invert, feather, grow, maskCanvas, selBounds, selFromAlpha, alphaBounds } from './selection.js';
import { recenter } from './view.js';

const doc = () => app.doc;

/** Redraws every layer (and the selection) into a new canvas size */
function remap(nw, nh, draw, label, keepSel = true) {
  const d = doc();
  for (const l of d.layers) {
    const c = canvas(nw, nh);
    const g = ctx2d(c);
    g.imageSmoothingQuality = 'high';
    draw(g, l.canvas);
    l.canvas = c;
  }
  if (d.sel && keepSel) {
    const m = canvas(nw, nh);
    draw(ctx2d(m), maskCanvas(d.sel));
    d.sel = selFromAlpha(m);
  } else d.sel = null;
  d.width = nw;
  d.height = nh;
  d.sizeChanged();
  d.commit(label);
  recenter(d);
  emit('selection');
}

export function cropTo(r) {
  remap(r.w, r.h, (g, src) => g.drawImage(src, -r.x, -r.y), 'Crop');
}

export function cropToSelection() {
  const b = selBounds(doc().sel);
  if (!b) return status('Select an area first.', 'danger');
  remap(b.w, b.h, (g, src) => g.drawImage(src, -b.x, -b.y), 'Crop', false);
}

export function trim() {
  const d = doc();
  const b = alphaBounds(d.composite());
  if (!b) return status('The picture is empty.', 'danger');
  if (b.w === d.width && b.h === d.height) return status('There are no transparent edges to trim.');
  remap(b.w, b.h, (g, src) => g.drawImage(src, -b.x, -b.y), 'Trim');
}

/** Resamples in halving steps when shrinking a lot, which looks much better than one big step */
export function resample(src, w, h) {
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const half = canvas(Math.max(w, Math.round(cur.width / 2)), Math.max(h, Math.round(cur.height / 2)));
    const g = ctx2d(half);
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = canvas(w, h);
  const g = ctx2d(out);
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, w, h);
  return out;
}

export function resizeImage(w, h, smooth = true) {
  remap(w, h, (g, src) => {
    if (!smooth) { g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, w, h); }
    else g.drawImage(resample(src, w, h), 0, 0);
  }, 'Image Size');
}

/** anchor: 0-8, left to right, top to bottom */
export function canvasSize(w, h, anchor, fill) {
  const d = doc();
  const ax = anchor % 3, ay = Math.floor(anchor / 3);
  const dx = Math.round(((w - d.width) * ax) / 2), dy = Math.round(((h - d.height) * ay) / 2);
  const bottom = d.layers[0];
  remap(w, h, (g, src) => {
    if (fill && src === bottom.canvas) { g.fillStyle = fill; g.fillRect(0, 0, w, h); }
    g.drawImage(src, dx, dy);
  }, 'Canvas Size');
}

export function rotateCanvas(deg) {
  const d = doc();
  const a = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const r = (v) => Math.round(v * 1e6) / 1e6;
  const nw = Math.round(r(d.width * c + d.height * s)), nh = Math.round(r(d.width * s + d.height * c));
  const w = d.width, h = d.height;
  remap(nw, nh, (g, src) => {
    g.translate(nw / 2, nh / 2);
    g.rotate(a);
    g.drawImage(src, -w / 2, -h / 2);
  }, deg % 90 === 0 ? `Rotate ${Math.abs(deg)}°${deg === 180 || deg === -180 ? '' : deg > 0 ? ' Clockwise' : ' Counter Clockwise'}` : 'Rotate Canvas');
}

export function flipCanvas(horizontal) {
  const d = doc();
  const w = d.width, h = d.height;
  remap(w, h, (g, src) => {
    if (horizontal) { g.translate(w, 0); g.scale(-1, 1); } else { g.translate(0, h); g.scale(1, -1); }
    g.drawImage(src, 0, 0);
  }, horizontal ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical');
}

export function flipLayer(horizontal) {
  const l = paintable();
  if (!l) return;
  const d = doc();
  const src = cloneCanvas(l.canvas);
  const g = d.editable(l);
  g.save();
  g.clearRect(0, 0, d.width, d.height);
  if (horizontal) { g.translate(d.width, 0); g.scale(-1, 1); } else { g.translate(0, d.height); g.scale(1, -1); }
  g.drawImage(src, 0, 0);
  g.restore();
  d.commit(horizontal ? 'Flip Layer Horizontal' : 'Flip Layer Vertical');
}

// ---------------------------------------------------------------- layers

export function addEmptyLayer() {
  const d = doc();
  d.addLayer(newLayer(d.width, d.height, d.layerName('Layer')));
  d.commit('New Layer');
}

export function duplicateLayer() {
  const d = doc();
  const l = d.layer;
  const c = newLayer(d.width, d.height, `${l.name} copy`, l.canvas);
  Object.assign(c, { opacity: l.opacity, blend: l.blend, visible: l.visible });
  d.addLayer(c);
  d.commit('Duplicate Layer');
}

/** Ctrl+J: the selected pixels on a new layer (or the whole layer without a selection) */
export function layerVia(cut) {
  const d = doc();
  if (!d.sel) { if (!cut) duplicateLayer(); return; }
  const src = d.layer;
  if (cut && !paintable()) return;
  const l = newLayer(d.width, d.height, d.layerName('Layer'), src.canvas);
  const g = ctx2d(l.canvas);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(maskCanvas(d.sel), 0, 0);
  if (cut) {
    const gs = d.editable(src);
    gs.globalCompositeOperation = 'destination-out';
    gs.drawImage(maskCanvas(d.sel), 0, 0);
    gs.globalCompositeOperation = 'source-over';
  }
  d.addLayer(l);
  d.commit(cut ? 'Layer via Cut' : 'Layer via Copy');
}

export function deleteLayer(i = doc().active) {
  const d = doc();
  if (d.layers.length <= 1) return status("A picture needs at least one layer. Add another layer before deleting this one.", 'danger');
  d.layers.splice(i, 1);
  d.active = Math.min(d.layers.length - 1, Math.max(0, i - (i > 0 ? 1 : 0)));
  d.changed();
  d.commit('Delete Layer');
}

export function moveLayer(from, to, label = 'Move Layer') {
  const d = doc();
  to = Math.max(0, Math.min(d.layers.length - 1, to));
  if (from === to) return;
  const [l] = d.layers.splice(from, 1);
  d.layers.splice(to, 0, l);
  d.active = to;
  d.changed();
  d.commit(label);
}

/** Draws `l` onto `g` as it appears (opacity, blend mode) */
function drawLayer(g, d, l) {
  g.globalAlpha = l.opacity;
  g.globalCompositeOperation = blendOf(l.blend).op;
  g.drawImage(d.source(l), 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

export function mergeDown() {
  const d = doc();
  const i = d.active;
  if (i === 0) return status('There is no layer below to merge into.', 'danger');
  const top = d.layers[i], below = d.layers[i - 1];
  if (!top.visible || !below.visible) return status('Both layers need to be visible to merge them.', 'danger');
  // the lower layer's own opacity and blend mode get baked in, so the result looks the same
  const c = canvas(d.width, d.height);
  const g = ctx2d(c);
  g.globalAlpha = below.opacity;
  g.drawImage(below.canvas, 0, 0);
  g.globalAlpha = 1;
  drawLayer(g, d, top);
  below.canvas = c;
  below.opacity = 1;
  d.layers.splice(i, 1);
  d.active = i - 1;
  d.changed();
  d.commit('Merge Down');
}

export function mergeVisible() {
  const d = doc();
  const vis = d.layers.filter(l => l.visible);
  if (vis.length < 2) return status('Merge Visible needs at least two visible layers.', 'danger');
  const c = canvas(d.width, d.height);
  ctx2d(c).drawImage(d.composite(), 0, 0);
  const target = vis[0];
  target.canvas = c;
  target.opacity = 1;
  target.blend = 'normal';
  d.layers = d.layers.filter(l => !l.visible || l === target);
  d.active = d.layers.indexOf(target);
  d.changed();
  d.commit('Merge Visible');
}

export function flatten() {
  const d = doc();
  const l = newLayer(d.width, d.height, 'Background');
  const g = ctx2d(l.canvas);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, d.width, d.height);
  g.drawImage(d.composite(), 0, 0);
  d.layers = [l];
  d.active = 0;
  d.changed();
  d.commit('Flatten Image');
}

export function setLayerProp(i, key, value, label) {
  const d = doc();
  const l = d.layers[i];
  if (!l || l[key] === value) return;
  l[key] = value;
  d.changed();
  if (label) d.commit(label);
}

// ---------------------------------------------------------------- selection

function setSel(sel, label) {
  const d = doc();
  if (d.sel) app.lastSel = d.sel;
  d.sel = sel;
  d.commit(label);
  emit('selection');
}

export function selectAll() { const d = doc(); setSel(selAll(d.width, d.height), 'Select All'); }
export function deselect() { if (doc().sel) setSel(null, 'Deselect'); }
export function reselect() {
  const d = doc(), s = app.lastSel;
  if (s && s.w === d.width && s.h === d.height) setSel(s, 'Reselect');
}
export function inverse() { const d = doc(); setSel(invert(d.sel, d.width, d.height), 'Inverse'); }
export function featherSel(r) { const d = doc(); if (d.sel) setSel(feather(d.sel, r), 'Feather'); }
export function growSel(n) { const d = doc(); if (d.sel) setSel(grow(d.sel, n), n > 0 ? 'Expand' : 'Contract'); }
export function selectLayerPixels() { const d = doc(); setSel(selFromAlpha(d.layer.canvas), 'Select Layer Pixels'); }

// ---------------------------------------------------------------- editing

export function clearSelection() {
  const d = doc();
  const l = paintable();
  if (!l) return;
  const g = d.editable(l);
  if (d.sel) {
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(maskCanvas(d.sel), 0, 0);
    g.globalCompositeOperation = 'source-over';
  } else g.clearRect(0, 0, d.width, d.height);
  d.commit('Clear');
}

export function fill(color, opacity = 1, blend = 'normal') {
  const d = doc();
  const l = paintable();
  if (!l) return;
  const c = canvas(d.width, d.height);
  const gc = ctx2d(c);
  gc.fillStyle = color;
  gc.fillRect(0, 0, d.width, d.height);
  if (d.sel) { gc.globalCompositeOperation = 'destination-in'; gc.drawImage(maskCanvas(d.sel), 0, 0); }
  const g = d.editable(l);
  g.globalAlpha = opacity;
  g.globalCompositeOperation = blendOf(blend).op;
  g.drawImage(c, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  d.commit('Fill');
}

/** The selected pixels of the layer (or of all layers, `merged`) cut to their bounds */
export function selectedPixels(merged) {
  const d = doc();
  const src = merged ? d.composite() : d.layer.canvas;
  const b = d.sel ? selBounds(d.sel) : { x: 0, y: 0, w: d.width, h: d.height };
  if (!b) return null;
  const c = canvas(b.w, b.h);
  const g = ctx2d(c);
  g.drawImage(src, -b.x, -b.y);
  if (d.sel) { g.globalCompositeOperation = 'destination-in'; g.drawImage(maskCanvas(d.sel), -b.x, -b.y); }
  return { canvas: c, x: b.x, y: b.y };
}

export async function copy(merged = false, cut = false) {
  const d = doc();
  if (!d) return;
  const px = selectedPixels(merged);
  if (!px) return;
  app.clipboard = { ...px, docId: d.id };
  try {
    const blob = await new Promise(r => px.canvas.toBlob(r, 'image/png'));
    if (navigator.clipboard?.write && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch { /* the app's own clipboard still works */ }
  if (cut) clearSelection();
  status(cut ? 'Cut.' : merged ? 'Copied (all visible layers).' : 'Copied.');
}

/** Puts a picture on a new layer: where it was copied from, or in the middle */
export function pasteCanvas(src, x, y, name = 'Pasted') {
  const d = doc();
  const l = newLayer(d.width, d.height, d.layerName(name));
  if (x == null) { x = Math.round((d.width - src.width) / 2); y = Math.round((d.height - src.height) / 2); }
  ctx2d(l.canvas).drawImage(src, x, y);
  d.addLayer(l);
  if (d.sel) { app.lastSel = d.sel; d.sel = null; emit('selection'); }
  d.commit('Paste');
  if (src.width > d.width || src.height > d.height) status('The pasted picture is bigger than the canvas. Use Image › Canvas Size or Free Transform (Ctrl+T) to fit it.');
}
