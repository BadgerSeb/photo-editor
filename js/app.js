// Photo Editor: the menus, keyboard shortcuts, mouse handling on the canvas, opening and saving
// files, and the dialogs. The pieces it ties together live in the other modules.

import { $, el, on, emit, canvas, ctx2d, store, baseName, nextFrame } from './util.js';
import { app, status, setColors, paintable } from './state.js';
import { makeDoc, newLayer, BLENDS } from './doc.js';
import { initView, requestRender, toDoc, fit, zoomTo, zoomStep, setPointer, panBy, viewCanvas, recenter } from './view.js';
import { toolById, startTransform, TOOLS } from './tools.js';
import { buildTools, buildOptions, buildColors, buildAdjust, buildLayers, buildHistory, buildTabs, buildStatus, showPointer, setTool } from './panels.js';
import { FILTERS } from './filters.js';
import { runFilterUI } from './adjust.js';
import * as ops from './ops.js';
import { decodeFile, docFromDecoded, FORMATS, formatById, encode, pickSaveTarget, writeTarget, OPEN_ACCEPT } from './files.js';
import { dialog, dialogOpen, message, sliderRow, numberRow, selectRow, checkRow, textRow } from './dialogs.js';

// ---------------------------------------------------------------- documents

function addDoc(d) {
  app.docs.push(d);
  switchTo(d);
  fit(d, 1);
}

function switchTo(d) {
  if (app.session) app.session.commit();
  app.doc = d;
  document.title = d ? `${d.name} — Photo Editor` : 'Photo Editor';
  $('welcome').hidden = !!d;
  emit('doc');
  emit('layers');
  emit('history');
  emit('zoom');
  emit('tool');
  if (d) d.changed();
  requestRender();
}

async function closeDoc(d) {
  if (d.dirty) {
    switchTo(d);
    const r = await dialog({
      title: 'Close picture', body: el('p', { class: 'msg' }, `Save the changes to "${d.name}" before closing?`),
      buttons: [{ label: 'Cancel', value: null }, { label: "Don't save", value: 'discard' }, { label: 'Save…', value: 'save', primary: true }],
    });
    if (!r) return false;
    if (r === 'save' && !(await save(d))) return false;
  }
  if (app.session && app.doc === d) app.session.cancel();
  const i = app.docs.indexOf(d);
  app.docs.splice(i, 1);
  switchTo(app.docs[Math.min(i, app.docs.length - 1)] || null);
  return true;
}

on('history', () => { if (app.doc) document.title = `${app.doc.name}${app.doc.dirty ? ' •' : ''} — Photo Editor`; });
on('selection', requestRender);

// ---------------------------------------------------------------- opening

async function openFiles(files, asLayers = false) {
  files = [...files];
  for (const f of files) {
    status(`Opening ${f.name}…`);
    await nextFrame();
    try {
      const dec = await decodeFile(f);
      if (asLayers && app.doc) {
        for (const l of dec.layers) ops.pasteCanvas(l.canvas, null, null, l.name);
      } else addDoc(docFromDecoded(dec, f.name));
      status(`Opened ${f.name}${dec.psd ? ` (${dec.layers.length} layer${dec.layers.length === 1 ? '' : 's'})` : ''}.`, 'success');
    } catch (e) {
      console.warn(e);
      status(`"${f.name}" couldn't be opened: ${e.message}`, 'danger');
    }
  }
}

function chooseFiles(asLayers = false) {
  const input = $('file-input');
  input.accept = OPEN_ACCEPT;
  input.onchange = () => { const f = [...input.files]; input.value = ''; if (f.length) openFiles(f, asLayers); };
  input.click();
}

// ---------------------------------------------------------------- saving

/** Ctrl+S: back into the same .psd when there is one, otherwise ask */
async function save(d = app.doc) {
  if (!d) return false;
  if (d.handle) {
    try {
      status('Saving…');
      await nextFrame();
      await writeTarget({ handle: d.handle, name: d.handle.name }, await encode(d, 'psd'));
      d.savedIndex = d.hIndex;
      emit('history');
      status(`Saved ${d.handle.name}.`, 'success');
      return true;
    } catch (e) { status(`Couldn't save: ${e.message}`, 'danger'); return false; }
  }
  return saveAs(d, 'psd');
}

async function saveAs(d = app.doc, preferred) {
  if (!d) return false;
  const last = store.get('save', { format: 'png', quality: 90 });
  const s = { format: preferred || last.format, quality: last.quality, name: d.name };
  const qRow = sliderRow({ label: 'Quality', min: 1, max: 100, unit: '%' }, s.quality, (v) => { s.quality = v; });
  const note = el('p', { class: 'msg muted' });
  const showFmt = () => {
    const f = formatById(s.format);
    qRow.hidden = !f.quality;
    note.textContent = f.layered ? `Keeps all ${d.layers.length} layer${d.layers.length === 1 ? '' : 's'} with their names, opacity and blend modes. Opens in Photoshop, GIMP, Affinity and Photopea.`
      : f.id === 'jpeg' || f.id === 'bmp' ? 'One flattened picture. Transparent parts become white.'
        : f.id === 'pdf' ? 'One page the size of the picture (96 pixels per inch), lossless.'
          : 'One flattened picture. Transparency is kept.';
  };
  const body = el('div', {},
    textRow('File name', s.name, (v) => { s.name = v; }),
    selectRow('Format', FORMATS.map(f => [f.id, f.name]), s.format, (v) => { s.format = v; showFmt(); }),
    qRow, note);
  showFmt();
  const ok = await dialog({ title: 'Save As', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: true, primary: true }] });
  if (!ok) return false;
  store.set('save', { format: s.format, quality: s.quality });
  const target = await pickSaveTarget(s.format, s.name || d.name);
  if (!target) return false;
  try {
    status('Saving…');
    await nextFrame();
    const blob = await encode(d, s.format, { quality: s.quality / 100 });
    await writeTarget(target, blob);
    if (s.format === 'psd' || d.layers.length === 1) d.savedIndex = d.hIndex;
    if (s.format === 'psd' && target.handle) d.handle = target.handle;
    d.name = baseName(target.name);
    emit('doc');
    emit('history');
    status(`Saved ${target.name} (${Math.max(1, Math.round(blob.size / 1024)).toLocaleString()} KB).`, 'success');
    return true;
  } catch (e) {
    status(`Couldn't save: ${e.message}`, 'danger');
    return false;
  }
}

// ---------------------------------------------------------------- dialogs

const PRESETS = [
  ['Full HD', 1920, 1080], ['4K UHD', 3840, 2160], ['HD 720p', 1280, 720], ['Square post', 1080, 1080],
  ['Letter @ 300 dpi', 2550, 3300], ['A4 @ 300 dpi', 2480, 3508], ['4 × 6 photo @ 300 dpi', 1800, 1200], ['Tabloid @ 150 dpi', 1650, 2550],
  ['Social share', 1200, 630], ['Web banner', 1500, 500], ['App icon', 512, 512], ['Small', 800, 600],
];

async function newDialog(fromClip) {
  const last = store.get('new', { w: 1920, h: 1080, bg: 'white' });
  const s = { name: 'Untitled-' + (app.docs.length + 1), w: fromClip?.width || last.w, h: fromClip?.height || last.h, bg: last.bg };
  const wRow = numberRow('Width', s.w, { min: 1, max: 30000, unit: 'px' }, (v) => { s.w = Math.round(v); mark(); });
  const hRow = numberRow('Height', s.h, { min: 1, max: 30000, unit: 'px' }, (v) => { s.h = Math.round(v); mark(); });
  const presets = el('div', { class: 'presets' }, PRESETS.map(([n, w, h]) => el('button', {
    class: 'btn', 'data-w': w, 'data-h': h,
    onclick: () => { s.w = w; s.h = h; wRow.input.value = w; hRow.input.value = h; mark(); },
  }, n, el('small', {}, `${w} × ${h}`))));
  const mark = () => presets.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.w === s.w && +b.dataset.h === s.h));
  mark();
  const body = el('div', {},
    textRow('Name', s.name, (v) => { s.name = v; }),
    el('h3', {}, 'Size'), presets, wRow, hRow,
    selectRow('Background', [['white', 'White'], ['black', 'Black'], ['transparent', 'Transparent'], ['bg', 'Background color'], ['fg', 'Foreground color']], s.bg, (v) => { s.bg = v; }));
  const ok = await dialog({
    title: 'New Image', body, wide: true, buttons: [{ label: 'Cancel', value: null }, { label: 'Create', value: true, primary: true }],
    onButton: () => {
      if (!(s.w >= 1 && s.h >= 1 && s.w <= 30000 && s.h <= 30000)) { status('Width and height must be between 1 and 30,000 pixels.', 'danger'); return false; }
      if (s.w * s.h > 268e6) { status('That is too big for the browser to handle. Keep it under about 16,000 × 16,000.', 'danger'); return false; }
    },
  });
  if (!ok) return;
  store.set('new', { w: s.w, h: s.h, bg: s.bg });
  const fill = { white: '#ffffff', black: '#000000', bg: app.bg, fg: app.fg }[s.bg];
  addDoc(makeDoc(s.w, s.h, s.name || 'Untitled', { fill }));
}

async function imageSizeDialog() {
  const d = app.doc;
  const s = { w: d.width, h: d.height, keep: true, smooth: true };
  const ratio = d.width / d.height;
  let pct;
  const wRow = numberRow('Width', s.w, { min: 1, max: 30000, unit: 'px' }, (v) => { s.w = Math.round(v); if (s.keep) { s.h = Math.max(1, Math.round(s.w / ratio)); hRow.input.value = s.h; } pct.input.value = Math.round((s.w / d.width) * 1000) / 10; });
  const hRow = numberRow('Height', s.h, { min: 1, max: 30000, unit: 'px' }, (v) => { s.h = Math.round(v); if (s.keep) { s.w = Math.max(1, Math.round(s.h * ratio)); wRow.input.value = s.w; } pct.input.value = Math.round((s.w / d.width) * 1000) / 10; });
  pct = numberRow('Scale', 100, { min: 1, max: 3000, step: 0.1, unit: '%' }, (v) => {
    s.w = Math.max(1, Math.round((d.width * v) / 100)); s.h = Math.max(1, Math.round((d.height * v) / 100));
    wRow.input.value = s.w; hRow.input.value = s.h;
  });
  const body = el('div', {},
    el('p', { class: 'msg muted' }, `Now ${d.width} × ${d.height} pixels.`), pct, wRow, hRow,
    checkRow('Keep proportions', true, (v) => { s.keep = v; }),
    selectRow('Resample', [['smooth', 'Smooth (photos)'], ['nearest', 'Nearest neighbor (hard edges, pixel art)']], 'smooth', (v) => { s.smooth = v === 'smooth'; }));
  if (!(await dialog({ title: 'Image Size', body }))) return;
  if (s.w === d.width && s.h === d.height) return;
  ops.resizeImage(s.w, s.h, s.smooth);
}

async function canvasSizeDialog() {
  const d = app.doc;
  const s = { w: d.width, h: d.height, anchor: 4, fill: 'transparent' };
  const anchor = el('div', { class: 'anchor' }, [...Array(9)].map((_, i) => el('button', { class: i === 4 ? 'on' : '', title: 'Keep the picture here', onclick: () => { s.anchor = i; anchor.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === i)); } })));
  const body = el('div', {},
    el('p', { class: 'msg muted' }, `Now ${d.width} × ${d.height} pixels. Making it smaller cuts the edges off.`),
    numberRow('Width', s.w, { min: 1, max: 30000, unit: 'px' }, (v) => { s.w = Math.round(v); }),
    numberRow('Height', s.h, { min: 1, max: 30000, unit: 'px' }, (v) => { s.h = Math.round(v); }),
    el('div', { class: 'row' }, el('span', {}, 'Anchor'), anchor),
    selectRow('New area', [['transparent', 'Transparent'], ['white', 'White'], ['black', 'Black'], ['bg', 'Background color'], ['fg', 'Foreground color']], s.fill, (v) => { s.fill = v; }));
  if (!(await dialog({ title: 'Canvas Size', body }))) return;
  if (s.w === d.width && s.h === d.height) return;
  ops.canvasSize(s.w, s.h, s.anchor, { transparent: null, white: '#ffffff', black: '#000000', bg: app.bg, fg: app.fg }[s.fill]);
}

async function rotateDialog() {
  const s = { angle: store.get('rotate', 15), cw: true };
  const body = el('div', {},
    numberRow('Angle', s.angle, { min: -360, max: 360, step: 0.1, unit: '°' }, (v) => { s.angle = v; }),
    selectRow('Direction', [['cw', 'Clockwise'], ['ccw', 'Counter clockwise']], 'cw', (v) => { s.cw = v === 'cw'; }),
    el('p', { class: 'msg muted' }, 'The canvas grows so nothing is cut off; the new corners are transparent.'));
  if (!(await dialog({ title: 'Rotate Canvas', body }))) return;
  store.set('rotate', s.angle);
  if (s.angle % 360) ops.rotateCanvas(s.cw ? s.angle : -s.angle);
}

async function numberDialog(title, label, value, opts, run) {
  let v = value;
  const body = el('div', {}, numberRow(label, v, opts, (x) => { v = x; }));
  if (await dialog({ title, body })) run(v);
}

async function fillDialog() {
  if (!paintable()) return;
  const s = { use: 'fg', opacity: 100, blend: 'normal' };
  const body = el('div', {},
    selectRow('Contents', [['fg', 'Foreground color'], ['bg', 'Background color'], ['black', 'Black'], ['white', 'White'], ['gray', '50% gray']], s.use, (v) => { s.use = v; }),
    selectRow('Mode', BLENDS.map(b => [b.id, b.name]), 'normal', (v) => { s.blend = v; }),
    sliderRow({ label: 'Opacity', min: 1, max: 100, unit: '%' }, 100, (v) => { s.opacity = v; }));
  if (!(await dialog({ title: 'Fill', body }))) return;
  ops.fill({ fg: app.fg, bg: app.bg, black: '#000000', white: '#ffffff', gray: '#808080' }[s.use], s.opacity / 100, s.blend);
}

function shortcutsDialog() {
  const rows = [];
  for (const t of TOOLS) rows.push([t.name, t.key]);
  rows.push(['Hand (hold)', 'Space'], ['Brush size', '[ and ]'], ['Swap colors', 'X'], ['Default colors', 'D'], ['Nudge', 'Arrows (Shift: 10 px)'], ['Apply crop / transform', 'Enter'], ['Cancel', 'Esc']);
  for (const m of MENUS) for (const it of m.items) if (it && it.key) rows.push([it.label.replace('…', ''), it.key]);
  const body = el('div', { class: 'keys' }, rows.map(([a, b]) => el('div', {}, el('span', {}, a), el('kbd', {}, b))));
  dialog({ title: 'Keyboard Shortcuts', body, wide: true, buttons: [{ label: 'Close', value: true, primary: true }] });
}

function aboutDialog() {
  const body = el('div', { style: { textAlign: 'center' } },
    el('img', { src: 'assets/badger-logo.png', alt: '', style: { height: '90px' } }),
    el('p', { class: 'msg' }, 'Photo Editor — Badger Metal & Machine Fabrication\nLayers, selections, brushes, adjustments and filters, with Photoshop (.psd) files.'),
    el('p', { class: 'msg', style: { color: 'var(--success)' } }, 'Everything stays on this computer: your pictures are never uploaded anywhere.'),
    el('p', { class: 'msg muted' }, 'Install it from the browser\'s address bar to use it like a normal app, even offline.'));
  dialog({ title: 'About Photo Editor', body, buttons: [{ label: 'OK', value: true, primary: true }] });
}

// ---------------------------------------------------------------- clipboard

async function pasteFromMenu() {
  try {
    if (navigator.clipboard?.read) {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) return pasteBlob(await item.getType(type));
      }
    }
  } catch { /* fall back to what was copied in the app */ }
  pasteInternal();
}

function pasteInternal() {
  const c = app.clipboard;
  if (!c) return status('There is nothing to paste. Copy a picture first.', 'danger');
  if (!app.doc) return addDoc(makeDoc(c.canvas.width, c.canvas.height, 'Pasted', { image: c.canvas }));
  const same = c.docId === app.doc.id || (c.x + c.canvas.width <= app.doc.width && c.y + c.canvas.height <= app.doc.height);
  ops.pasteCanvas(c.canvas, same ? c.x : null, same ? c.y : null);
}

async function pasteBlob(blob) {
  const bmp = await createImageBitmap(blob);
  const c = canvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  // the system clipboard holds what was just copied here: paste it where it came from
  const mine = app.clipboard && app.clipboard.canvas.width === c.width && app.clipboard.canvas.height === c.height;
  if (mine) return pasteInternal();
  if (!app.doc) return addDoc(makeDoc(c.width, c.height, 'Pasted', { image: c, layerName: 'Pasted' }));
  ops.pasteCanvas(c);
}

// ---------------------------------------------------------------- menus

const has = () => !!app.doc;
const hasSel = () => !!app.doc?.sel;
const filterItems = (menu) => {
  const out = [];
  let group = null;
  for (const [id, f] of Object.entries(FILTERS)) {
    if (f.menu !== menu) continue;
    if (f.group && f.group !== group) { group = f.group; out.push({ heading: group }); }
    if (f.sep) out.push('-');
    out.push({ label: f.name + (f.fields || f.custom ? '…' : ''), key: f.key, run: () => runFilterUI(id), enabled: has });
  }
  return out;
};

const MENUS = [
  {
    name: 'File', items: [
      { label: 'New…', key: 'Alt+N', run: () => newDialog() },
      { label: 'Open…', key: 'Ctrl+O', run: () => chooseFiles() },
      { label: 'Place as Layer…', run: () => chooseFiles(true), enabled: has },
      '-',
      { label: 'Save', key: 'Ctrl+S', run: () => save(), enabled: has },
      { label: 'Save As…', key: 'Ctrl+Shift+S', run: () => saveAs(), enabled: has },
      '-',
      { label: 'Close', key: 'Alt+W', run: () => app.doc && closeDoc(app.doc), enabled: has },
      { label: 'Close All', run: async () => { for (const d of [...app.docs]) if (!(await closeDoc(d))) break; }, enabled: has },
    ],
  },
  {
    name: 'Edit', items: [
      { label: 'Undo', key: 'Ctrl+Z', run: () => app.doc.undo(), enabled: () => app.doc?.hIndex > 0 },
      { label: 'Redo', key: 'Ctrl+Shift+Z', run: () => app.doc.redo(), enabled: () => app.doc && app.doc.hIndex < app.doc.history.length - 1 },
      '-',
      { label: 'Cut', key: 'Ctrl+X', run: () => ops.copy(false, true), enabled: has },
      { label: 'Copy', key: 'Ctrl+C', run: () => ops.copy(), enabled: has },
      { label: 'Copy Merged', key: 'Ctrl+Shift+C', run: () => ops.copy(true), enabled: has },
      { label: 'Paste', key: 'Ctrl+V', run: () => pasteFromMenu() },
      { label: 'Clear', key: 'Delete', run: () => ops.clearSelection(), enabled: has },
      '-',
      { label: 'Fill…', key: 'Shift+F5', run: () => fillDialog(), enabled: has },
      { label: 'Free Transform', key: 'Ctrl+T', run: () => startTransform(), enabled: has },
      '-',
      { label: 'Keyboard Shortcuts…', run: shortcutsDialog },
    ],
  },
  {
    name: 'Image', items: [
      { label: 'Image Size…', key: 'Ctrl+Alt+I', run: imageSizeDialog, enabled: has },
      { label: 'Canvas Size…', key: 'Ctrl+Alt+C', run: canvasSizeDialog, enabled: has },
      '-',
      { label: 'Rotate 90° Clockwise', run: () => ops.rotateCanvas(90), enabled: has },
      { label: 'Rotate 90° Counter Clockwise', run: () => ops.rotateCanvas(-90), enabled: has },
      { label: 'Rotate 180°', run: () => ops.rotateCanvas(180), enabled: has },
      { label: 'Rotate Arbitrary…', run: rotateDialog, enabled: has },
      { label: 'Flip Canvas Horizontal', run: () => ops.flipCanvas(true), enabled: has },
      { label: 'Flip Canvas Vertical', run: () => ops.flipCanvas(false), enabled: has },
      '-',
      { label: 'Crop to Selection', run: ops.cropToSelection, enabled: hasSel },
      { label: 'Trim Transparent Edges', run: ops.trim, enabled: has },
    ],
  },
  {
    name: 'Layer', items: [
      { label: 'New Layer', key: 'Ctrl+Shift+N', run: ops.addEmptyLayer, enabled: has },
      { label: 'Duplicate Layer', run: ops.duplicateLayer, enabled: has },
      { label: 'Delete Layer', run: () => ops.deleteLayer(), enabled: () => app.doc?.layers.length > 1 },
      { label: 'Rename Layer…', run: () => document.querySelector('.layer.on .name')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), enabled: has },
      '-',
      { label: 'Layer via Copy', key: 'Ctrl+J', run: () => ops.layerVia(false), enabled: has },
      { label: 'Layer via Cut', key: 'Ctrl+Shift+J', run: () => ops.layerVia(true), enabled: hasSel },
      '-',
      { label: 'Bring to Front', key: 'Ctrl+Shift+]', run: () => ops.moveLayer(app.doc.active, app.doc.layers.length - 1, 'Bring to Front'), enabled: has },
      { label: 'Bring Forward', key: 'Ctrl+]', run: () => ops.moveLayer(app.doc.active, app.doc.active + 1, 'Bring Forward'), enabled: has },
      { label: 'Send Backward', key: 'Ctrl+[', run: () => ops.moveLayer(app.doc.active, app.doc.active - 1, 'Send Backward'), enabled: has },
      { label: 'Send to Back', key: 'Ctrl+Shift+[', run: () => ops.moveLayer(app.doc.active, 0, 'Send to Back'), enabled: has },
      '-',
      { label: 'Flip Layer Horizontal', run: () => ops.flipLayer(true), enabled: has },
      { label: 'Flip Layer Vertical', run: () => ops.flipLayer(false), enabled: has },
      '-',
      { label: 'Merge Down', key: 'Ctrl+E', run: ops.mergeDown, enabled: () => app.doc?.active > 0 },
      { label: 'Merge Visible', key: 'Ctrl+Shift+E', run: ops.mergeVisible, enabled: () => app.doc?.layers.length > 1 },
      { label: 'Flatten Image', run: ops.flatten, enabled: has },
    ],
  },
  {
    name: 'Select', items: [
      { label: 'All', key: 'Ctrl+A', run: ops.selectAll, enabled: has },
      { label: 'Deselect', key: 'Ctrl+D', run: ops.deselect, enabled: hasSel },
      { label: 'Reselect', key: 'Ctrl+Shift+D', run: ops.reselect, enabled: () => has() && !!app.lastSel },
      { label: 'Inverse', key: 'Ctrl+Shift+I', run: ops.inverse, enabled: has },
      '-',
      { label: 'Select Layer Pixels', run: ops.selectLayerPixels, enabled: has },
      '-',
      { label: 'Feather…', key: 'Shift+F6', run: () => numberDialog('Feather Selection', 'Radius', 5, { min: 0.5, max: 250, step: 0.5, unit: 'px' }, ops.featherSel), enabled: hasSel },
      { label: 'Expand…', run: () => numberDialog('Expand Selection', 'Expand by', 5, { min: 1, max: 100, unit: 'px' }, (v) => ops.growSel(Math.round(v))), enabled: hasSel },
      { label: 'Contract…', run: () => numberDialog('Contract Selection', 'Contract by', 5, { min: 1, max: 100, unit: 'px' }, (v) => ops.growSel(-Math.round(v))), enabled: hasSel },
    ],
  },
  { name: 'Adjust', items: filterItems('adjust') },
  {
    name: 'Filter', items: [
      { label: 'Repeat Last Filter', key: 'Ctrl+F', run: () => app.lastFilter && runFilterUI(app.lastFilter.name, { repeat: true }), enabled: () => has() && !!app.lastFilter },
      '-',
      ...filterItems('filter'),
    ],
  },
  {
    name: 'View', items: [
      { label: 'Zoom In', key: 'Ctrl+=', run: () => zoomStep(1), enabled: has },
      { label: 'Zoom Out', key: 'Ctrl+-', run: () => zoomStep(-1), enabled: has },
      { label: 'Fit on Screen', key: 'Ctrl+0', run: () => fit(), enabled: has },
      { label: 'Actual Pixels (100%)', key: 'Ctrl+1', run: () => zoomTo(1), enabled: has },
      '-',
      { label: 'Full Screen', key: 'F11', run: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}) },
    ],
  },
  {
    name: 'Help', items: [
      { label: 'Keyboard Shortcuts…', run: shortcutsDialog },
      { label: 'About Photo Editor…', run: aboutDialog },
    ],
  },
];

let openMenu = null;
function buildMenus() {
  const bar = $('menubar');
  const menu = $('menu');
  const show = (m, btn) => {
    openMenu = m;
    bar.querySelectorAll('button').forEach(b => b.classList.toggle('open', b === btn));
    menu.replaceChildren();
    for (const it of m.items) {
      if (it === '-') menu.append(el('hr'));
      else if (it.heading) menu.append(el('div', { class: 'heading' }, it.heading));
      else {
        const enabled = !it.enabled || it.enabled();
        menu.append(el('button', { disabled: !enabled, onclick: () => { hide(); it.run(); } }, el('span', {}, it.label), it.key ? el('kbd', {}, it.key) : null));
      }
    }
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 4) + 'px';
    menu.style.top = r.bottom + 'px';
  };
  const hide = () => { openMenu = null; menu.hidden = true; bar.querySelectorAll('button').forEach(b => b.classList.remove('open')); };
  for (const m of MENUS) {
    const btn = el('button', { 'data-menu': m.name }, m.name);
    btn.onclick = (e) => { e.stopPropagation(); if (openMenu === m) hide(); else show(m, btn); };
    btn.onmouseenter = () => { if (openMenu && openMenu !== m) show(m, btn); };
    bar.append(btn);
  }
  document.addEventListener('pointerdown', (e) => { if (openMenu && !menu.contains(e.target) && !bar.contains(e.target)) hide(); });
  document.addEventListener('keydown', (e) => { if (openMenu && e.key === 'Escape') { hide(); e.stopPropagation(); } }, true);
}

// ---------------------------------------------------------------- keyboard

function keyName(e) {
  let k = e.key;
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (e.code === 'BracketLeft') k = '[';
  else if (e.code === 'BracketRight') k = ']';
  else if (e.code === 'Equal' || e.code === 'NumpadAdd') k = '=';
  else if (e.code === 'Minus' || e.code === 'NumpadSubtract') k = '-';
  else if (k === 'Backspace') k = 'Delete';
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + k;
}

const EXTRA_KEYS = {
  'Ctrl+Y': () => app.doc?.redo(),
  'Ctrl+Alt+Z': () => app.doc?.undo(),
  'Ctrl+Shift+=': () => zoomStep(1),
  'Ctrl+N': () => newDialog(),
  'Alt+Ctrl+N': () => newDialog(),
};

const lastOfKey = store.get('lastOfKey', {});
on('tool', () => {
  const t = toolById(app.tool);
  if (lastOfKey[t.key] !== t.id) { lastOfKey[t.key] = t.id; store.set('lastOfKey', lastOfKey); }
});

function buildKeyboard() {
  const map = new Map();
  for (const m of MENUS) for (const it of m.items) if (it && it.key) map.set(it.key, it);
  document.addEventListener('keydown', (e) => {
    if (dialogOpen()) return;
    const t = e.target;
    const typing = t.tagName === 'INPUT' && !['range', 'checkbox'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
    if (t.id === 'text-input') {
      if (e.key === 'Escape') { e.preventDefault(); app.session?.cancel(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); app.session?.commit(); }
      return;
    }
    if (typing) return;
    const k = keyName(e);
    if (k === 'Escape' && app.session) { e.preventDefault(); app.session.cancel(); return; }
    if (k === 'Enter' && app.session) { e.preventDefault(); app.session.commit(); return; }
    if (k === 'Ctrl+V' || k === 'Ctrl+C' || k === 'Ctrl+X') {
      // copy and cut go through the menu code; paste waits for the browser's paste event,
      // which carries pictures copied in other programs
      if (k !== 'Ctrl+V' && app.doc) { e.preventDefault(); map.get(k).run(); }
      return;
    }
    const it = map.get(k);
    if (it) {
      e.preventDefault();
      if (!it.enabled || it.enabled()) it.run();
      return;
    }
    if (EXTRA_KEYS[k]) { e.preventDefault(); EXTRA_KEYS[k](); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ' ' || k === 'Shift+ ') {
      e.preventDefault();
      if (!app.spaceHand) { app.spaceHand = true; updateCursor(); }
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && app.doc && app.tool === 'move' && !app.session) {
      e.preventDefault();
      const n = e.shiftKey ? 10 : 1;
      toolById('move').arrow({ ArrowLeft: -n, ArrowRight: n }[e.key] || 0, { ArrowUp: -n, ArrowDown: n }[e.key] || 0);
      return;
    }
    const plain = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (plain === 'X') return setColors(app.bg, app.fg);
    if (plain === 'D') return setColors('#000000', '#ffffff');
    if (plain === '[' || plain === ']' || e.code === 'BracketLeft' || e.code === 'BracketRight') {
      const o = app.opts[app.tool];
      if (o && 'size' in o) {
        const up = e.code === 'BracketRight';
        const step = o.size < 10 ? 1 : o.size < 50 ? 5 : o.size < 200 ? 10 : 50;
        o.size = Math.max(1, Math.min(app.tool === 'text' ? 1000 : 1000, o.size + (up ? step : -step)));
        emit('opt-value', 'size');
        requestRender();
      }
      return;
    }
    // tool letters, as in Photoshop: the letter picks the tool of that group used last,
    // Shift+letter switches to the next tool sharing the letter
    const tools = TOOLS.filter(x => x.key === plain);
    if (tools.length) {
      e.preventDefault();
      const cur = tools.findIndex(x => x.id === app.tool);
      const last = tools.find(x => x.id === lastOfKey[plain]) || tools.find(x => x.id === { G: 'gradient', B: 'brush' }[plain]) || tools[0];
      setTool(e.shiftKey && cur >= 0 ? tools[(cur + 1) % tools.length].id : cur >= 0 ? app.tool : last.id);
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' && app.spaceHand) { app.spaceHand = false; updateCursor(); }
  });
  window.addEventListener('blur', () => { app.spaceHand = false; });
}

// ---------------------------------------------------------------- the canvas

let active = null; // what gets the pointer while a button is held: { target, pan }

function updateCursor(p) {
  const v = viewCanvas();
  if (app.spaceHand || active?.pan) { v.style.cursor = active?.pan ? 'grabbing' : 'grab'; return; }
  const t = toolById(app.tool);
  const s = app.session;
  const c = (s?.cursorAt && p && s.cursorAt(p)) || (t.cursorAt && p && t.cursorAt(p)) || t.cursor;
  v.style.cursor = c;
}

function buildCanvas() {
  const v = viewCanvas();
  v.addEventListener('pointerdown', (e) => {
    if (!app.doc) return;
    if (e.button === 2) return;
    e.preventDefault();
    try { v.setPointerCapture(e.pointerId); } catch { }
    document.activeElement?.blur?.();
    const p = toDoc(e.offsetX, e.offsetY);
    if (e.button === 1 || app.spaceHand || app.tool === 'hand') {
      active = { pan: true, last: { x: e.clientX, y: e.clientY } };
      updateCursor();
      return;
    }
    const s = app.session;
    const target = s?.down ? s : toolById(app.tool);
    active = { target };
    target.down?.(p, e);
  });
  v.addEventListener('pointermove', (e) => {
    if (!app.doc) return;
    const p = toDoc(e.offsetX, e.offsetY);
    setPointer({ x: e.offsetX, y: e.offsetY });
    showPointer(p);
    if (active?.pan) {
      panBy(e.clientX - active.last.x, e.clientY - active.last.y);
      active.last = { x: e.clientX, y: e.clientY };
      return;
    }
    if (active) {
      // painting smoothly needs the in-between points the browser collected
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ce of events.length ? events : [e]) active.target.move?.(toDoc(ce.offsetX, ce.offsetY), ce);
      return;
    }
    toolById(app.tool).hover?.(p, e);
    updateCursor(p);
  });
  const up = (e) => {
    if (!active) return;
    const a = active;
    active = null;
    if (!a.pan) a.target.up?.(toDoc(e.offsetX, e.offsetY), e);
    updateCursor(toDoc(e.offsetX, e.offsetY));
  };
  v.addEventListener('pointerup', up);
  v.addEventListener('pointercancel', up);
  v.addEventListener('pointerleave', () => { setPointer(null); showPointer(null); });
  v.addEventListener('contextmenu', (e) => e.preventDefault());
  v.addEventListener('dblclick', (e) => { if (app.tool === 'hand') fit(); else if (app.tool === 'zoom') zoomTo(1, e.offsetX, e.offsetY); });
  $('viewport').addEventListener('wheel', (e) => {
    if (!app.doc) return;
    e.preventDefault();
    if (e.shiftKey && !e.ctrlKey) { panBy(-e.deltaY, 0); return; }
    if (e.altKey) { panBy(-e.deltaX, -e.deltaY); return; }
    const r = viewCanvas().getBoundingClientRect();
    const k = Math.exp(-Math.max(-300, Math.min(300, e.deltaY * (e.deltaMode === 1 ? 33 : 1))) * (e.ctrlKey ? 0.01 : 0.002));
    zoomTo(app.doc.view.zoom * k, e.clientX - r.left, e.clientY - r.top);
    app.session?.reposition?.();
  }, { passive: false });
  on('zoom', () => app.session?.reposition?.());
  on('tool', () => updateCursor());
}

// ---------------------------------------------------------------- dropping and pasting files

function buildDrop() {
  const hint = $('drop-hint'), text = $('drop-text');
  let depth = 0;
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const overCanvas = (e) => app.doc && $('viewport').contains(e.target);
  window.addEventListener('dragenter', (e) => { if (!isFiles(e)) return; depth++; hint.hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!isFiles(e)) return; if (--depth <= 0) { depth = 0; hint.hidden = true; } });
  window.addEventListener('dragover', (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    text.textContent = overCanvas(e) ? 'Drop to add as new layers' : 'Drop to open';
  });
  window.addEventListener('drop', (e) => {
    if (!isFiles(e) && !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    depth = 0;
    hint.hidden = true;
    const files = [...e.dataTransfer.files];
    if (files.length) openFiles(files, !!overCanvas(e));
  });
  document.addEventListener('paste', async (e) => {
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    e.preventDefault();
    if (files.length) {
      try { await pasteBlob(files[0]); } catch (err) { status(`Couldn't paste: ${err.message}`, 'danger'); }
    } else pasteInternal();
  });
}

// ---------------------------------------------------------------- install, offline, updates

function setUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const ready = (worker) => {
      // a new version has been downloaded: switch now if nothing is open, otherwise offer it
      if (!app.docs.some(d => d.dirty)) worker.postMessage('activate');
      else {
        $('update').hidden = false;
        $('update-now').onclick = () => worker.postMessage('activate');
      }
    };
    if (reg.waiting && navigator.serviceWorker.controller) ready(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ready(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || app.docs.some(d => d.dirty)) return;
    reloading = true;
    location.reload();
  });
}

/** Pictures opened with the installed app ("Open with", double-click) */
function setFileHandling() {
  if (!('launchQueue' in window)) return;
  launchQueue.setConsumer(async (params) => {
    const files = await Promise.all((params.files || []).map(h => h.getFile()));
    if (files.length) openFiles(files);
  });
}

// ---------------------------------------------------------------- start

buildMenus();
buildTools();
buildOptions();
buildColors();
buildAdjust();
buildLayers();
buildHistory();
buildTabs(switchTo, closeDoc);
buildStatus();
initView();
buildCanvas();
buildKeyboard();
buildDrop();
$('w-open').onclick = () => chooseFiles();
$('w-new').onclick = () => newDialog();
window.addEventListener('beforeunload', (e) => {
  if (app.docs.some(d => d.dirty)) { e.preventDefault(); e.returnValue = ''; }
});
switchTo(null);
setUpdates();
setFileHandling();

// for the automated tests
window.photoEditor = { app, ops, openFiles, addDoc, makeDoc, newLayer, encode, setTool, runFilterUI, saveAs, save, switchTo, closeDoc, recenter };
