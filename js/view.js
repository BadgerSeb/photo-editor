// The canvas in the middle: draws the picture at the current zoom, the checkerboard behind
// transparent parts, the selection's marching ants and whatever the current tool shows.

import { $, canvas, ctx2d, on, emit, clamp } from './util.js';
import { app } from './state.js';
import { outline } from './selection.js';

const ZOOMS = [0.01, 0.02, 0.03, 0.05, 0.0667, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64];

let view, g, vp;
let queued = false;
let ants = 0;
let overlay = null;
let pointer = null; // last pointer position on screen, for the brush outline

export function initView() {
  vp = $('viewport');
  view = $('view');
  g = ctx2d(view);
  new ResizeObserver(() => { resize(); if (app.doc?.view.fit) fit(app.doc); requestRender(); }).observe(vp);
  on('render', requestRender);
  on('size', () => requestRender());
  setInterval(() => {
    if (app.doc?.sel && document.visibilityState === 'visible') { ants = (ants + 1) % 8; requestRender(); }
  }, 140);
  resize();
}

function resize() {
  const r = vp.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  view.width = Math.max(1, Math.round(r.width * dpr));
  view.height = Math.max(1, Math.round(r.height * dpr));
  view.style.width = r.width + 'px';
  view.style.height = r.height + 'px';
}

export function viewSize() {
  const r = vp.getBoundingClientRect();
  return { w: r.width, h: r.height, left: r.left, top: r.top };
}

export function requestRender() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
}

/** Tools draw their own guides (crop box, lasso line…) through this; called in screen pixels */
export function setOverlay(fn) { overlay = fn; requestRender(); }
export function setPointer(p) { pointer = p; if (brushRadius()) requestRender(); }

let checker;
function checkerPattern() {
  if (checker) return checker;
  const c = canvas(16, 16);
  const cg = ctx2d(c);
  cg.fillStyle = '#ffffff'; cg.fillRect(0, 0, 16, 16);
  cg.fillStyle = '#cccccc'; cg.fillRect(0, 0, 8, 8); cg.fillRect(8, 8, 8, 8);
  checker = g.createPattern(c, 'repeat');
  return checker;
}

export function render() {
  const dpr = window.devicePixelRatio || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#131416';
  g.fillRect(0, 0, view.width, view.height);
  const d = app.doc;
  if (!d) return;
  const { zoom, ox, oy } = d.view;
  const w = d.width * zoom, h = d.height * zoom;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.6)';
  g.shadowBlur = 12;
  g.fillStyle = '#fff';
  g.fillRect(ox, oy, w, h);
  g.restore();
  g.save();
  g.translate(ox, oy);
  g.fillStyle = checkerPattern();
  g.fillRect(0, 0, w, h);
  g.restore();
  const comp = d.composite();
  g.imageSmoothingEnabled = zoom < 2;
  g.imageSmoothingQuality = 'high';
  g.drawImage(comp, ox, oy, w, h);
  if (zoom >= 12) pixelGrid(d, zoom, ox, oy);

  if (d.sel && !app.hideEdges) {
    g.save();
    g.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * ox, dpr * oy);
    const path = outline(d.sel);
    g.lineWidth = 1 / zoom;
    g.strokeStyle = '#fff';
    g.setLineDash([]);
    g.stroke(path);
    g.strokeStyle = '#000';
    g.setLineDash([4 / zoom, 4 / zoom]);
    g.lineDashOffset = -ants / zoom;
    g.stroke(path);
    g.restore();
  }
  if (overlay) {
    g.save();
    overlay(g, d.view);
    g.restore();
  }
  const r = brushRadius();
  if (r && pointer && !app.session) {
    g.save();
    g.beginPath();
    g.arc(pointer.x, pointer.y, Math.max(1, r * zoom), 0, Math.PI * 2);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,.8)';
    g.stroke();
    g.beginPath();
    g.arc(pointer.x, pointer.y, Math.max(1, r * zoom) + 1, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,255,255,.8)';
    g.stroke();
    g.restore();
  }
}

function pixelGrid(d, zoom, ox, oy) {
  const vs = viewSize();
  const x0 = Math.max(0, Math.floor(-ox / zoom)), x1 = Math.min(d.width, Math.ceil((vs.w - ox) / zoom));
  const y0 = Math.max(0, Math.floor(-oy / zoom)), y1 = Math.min(d.height, Math.ceil((vs.h - oy) / zoom));
  g.save();
  g.beginPath();
  for (let x = x0; x <= x1; x++) { g.moveTo(Math.round(ox + x * zoom) + 0.5, oy + y0 * zoom); g.lineTo(Math.round(ox + x * zoom) + 0.5, oy + y1 * zoom); }
  for (let y = y0; y <= y1; y++) { g.moveTo(ox + x0 * zoom, Math.round(oy + y * zoom) + 0.5); g.lineTo(ox + x1 * zoom, Math.round(oy + y * zoom) + 0.5); }
  g.strokeStyle = 'rgba(128,128,128,.35)';
  g.lineWidth = 1;
  g.stroke();
  g.restore();
}

function brushRadius() {
  const t = app.tool;
  if (!['brush', 'pencil', 'eraser', 'clone', 'blur', 'dodge'].includes(t)) return 0;
  return app.opts[t].size / 2;
}

/** Screen position (relative to the canvas) → document pixels */
export function toDoc(sx, sy, d = app.doc) {
  return { x: (sx - d.view.ox) / d.view.zoom, y: (sy - d.view.oy) / d.view.zoom };
}
export function toScreen(x, y, d = app.doc) {
  return { x: x * d.view.zoom + d.view.ox, y: y * d.view.zoom + d.view.oy };
}

export function fit(d = app.doc, maxZoom = Infinity) {
  if (!d) return;
  const vs = viewSize();
  const z = Math.min((vs.w - 48) / d.width, (vs.h - 48) / d.height, maxZoom);
  d.view.zoom = clamp(z, 0.01, 64);
  d.view.ox = Math.round((vs.w - d.width * d.view.zoom) / 2);
  d.view.oy = Math.round((vs.h - d.height * d.view.zoom) / 2);
  d.view.fit = true;
  emit('zoom');
  requestRender();
}

export function zoomTo(z, sx, sy, d = app.doc) {
  if (!d) return;
  const vs = viewSize();
  if (sx == null) { sx = vs.w / 2; sy = vs.h / 2; }
  z = clamp(z, 0.01, 64);
  const p = toDoc(sx, sy, d);
  d.view.zoom = z;
  d.view.ox = sx - p.x * z;
  d.view.oy = sy - p.y * z;
  d.view.fit = false;
  keepVisible(d);
  emit('zoom');
  requestRender();
}

export function zoomStep(dir, sx, sy) {
  const d = app.doc;
  if (!d) return;
  const z = d.view.zoom;
  const next = dir > 0 ? ZOOMS.find(v => v > z * 1.001) : [...ZOOMS].reverse().find(v => v < z / 1.001);
  zoomTo(next ?? z, sx, sy);
}

export function panBy(dx, dy, d = app.doc) {
  if (!d) return;
  d.view.ox += dx;
  d.view.oy += dy;
  d.view.fit = false;
  keepVisible(d);
  requestRender();
}

/** Never lets the picture be pushed entirely out of sight */
function keepVisible(d) {
  const vs = viewSize();
  const w = d.width * d.view.zoom, h = d.height * d.view.zoom, m = 60;
  d.view.ox = clamp(d.view.ox, m - w, vs.w - m);
  d.view.oy = clamp(d.view.oy, m - h, vs.h - m);
}

/** Puts the picture in the middle at its current zoom (after the size changed) */
export function recenter(d = app.doc) {
  if (!d) return;
  if (d.view.fit) return fit(d);
  const vs = viewSize();
  d.view.ox = Math.round((vs.w - d.width * d.view.zoom) / 2);
  d.view.oy = Math.round((vs.h - d.height * d.view.zoom) / 2);
  requestRender();
}

export function viewCanvas() { return view; }
