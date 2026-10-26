// The tool column, the options bar and the panels on the right (Color, Adjustments, Layers,
// History), the document tabs and the status bar.

import { $, el, on, emit, ctx2d, hexToRgb, rgbToHex } from './util.js';
import { app, saveOpts, setColors } from './state.js';
import { BLENDS } from './doc.js';
import { TOOLS, ICONS, toolById } from './tools.js';
import { FILTERS } from './filters.js';
import { runFilterUI } from './adjust.js';
import { addEmptyLayer, duplicateLayer, deleteLayer, moveLayer, mergeDown, setLayerProp } from './ops.js';
import { store } from './util.js';

export function setTool(id) {
  if (app.session && app.session.tool !== id) app.session.commit();
  app.tool = id;
  store.set('tool', id);
  emit('tool');
}

// ---------------------------------------------------------------- tool column

const COLUMN = [['move'], ['marquee', 'lasso', 'wand'], ['crop', 'eyedropper'], ['brush', 'pencil', 'eraser', 'clone'], ['bucket', 'gradient', 'blur', 'dodge'], ['text', 'shape'], ['hand', 'zoom']];

export function buildTools() {
  const box = $('tools');
  COLUMN.forEach((group, gi) => {
    if (gi) box.append(el('hr'));
    for (const id of group) {
      const t = toolById(id);
      const b = el('button', { class: 'tool', 'data-tool': id, title: `${t.name} (${t.key})`, onclick: () => setTool(id) });
      b.innerHTML = ICONS[id];
      box.append(b);
    }
  });
  const mini = el('div', { class: 'mini-colors' },
    el('button', { class: 'sw fg', id: 'm-fg', title: 'Foreground color', onclick: () => pickColor('fg') }),
    el('button', { class: 'sw bg', id: 'm-bg', title: 'Background color', onclick: () => pickColor('bg') }),
    el('button', { class: 'swap', title: 'Swap colors (X)', onclick: () => setColors(app.bg, app.fg) }, '⇄'));
  box.append(el('hr'), mini);
  const mark = () => box.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === app.tool));
  on('tool', mark);
  mark();
}

// ---------------------------------------------------------------- options bar

export function buildOptions() {
  const bar = $('options');
  const draw = () => {
    const t = toolById(app.tool);
    const s = app.session;
    const spec = s?.options ? s.options() : t.options ? t.options() : [];
    const o = app.opts[t.id] || {};
    bar.replaceChildren();
    const name = el('span', { class: 'tool-name' });
    name.innerHTML = ICONS[s?.tool === 'transform' ? 'move' : t.id];
    name.append(s?.tool === 'transform' ? 'Transform' : t.name);
    bar.append(name);
    const changed = (k, v) => { o[k] = v; saveOpts(); t.optionsChanged?.(); emit('render'); };
    for (const f of spec) {
      if (f.type === 'range') {
        const fld = { ...f };
        const num = el('input', { type: 'number', min: f.min, max: f.max, value: o[f.key] });
        const toS = (v) => (f.log ? (Math.log(v / f.min) / Math.log(f.max / f.min)) * 1000 : v);
        const fromS = (s) => Math.round(f.log ? f.min * Math.pow(f.max / f.min, s / 1000) : s);
        const range = el('input', { type: 'range', min: f.log ? 0 : f.min, max: f.log ? 1000 : f.max, value: toS(o[f.key]) });
        range.oninput = () => { num.value = fromS(+range.value); changed(f.key, +num.value); };
        num.oninput = () => { if (num.value === '') return; const v = Math.max(f.min, Math.min(f.max, +num.value)); range.value = toS(v); changed(f.key, v); };
        num.dataset.key = f.key;
        bar.append(el('label', { title: fld.label }, fld.label, range, num, f.unit ? el('small', {}, f.unit) : null));
      } else if (f.type === 'select') {
        const sel = el('select', { title: f.title || f.label }, f.options.map(([v, tx]) => el('option', { value: v, selected: String(v) === String(o[f.key]) }, tx)));
        sel.onchange = () => changed(f.key, typeof f.options[0][0] === 'number' ? +sel.value : sel.value);
        bar.append(f.label ? el('label', {}, f.label, sel) : sel);
      } else if (f.type === 'check') {
        const c = el('input', { type: 'checkbox', checked: !!o[f.key] });
        c.onchange = () => changed(f.key, c.checked);
        bar.append(el('label', {}, c, f.label));
      } else if (f.type === 'seg') {
        const seg = el('div', { class: 'seg' });
        for (const [v, tx, title] of f.options) {
          seg.append(el('button', { class: o[f.key] === v ? 'on' : '', title: title || tx, onclick: () => { changed(f.key, v); draw(); } }, tx));
        }
        bar.append(seg);
      } else if (f.type === 'button') {
        bar.append(el('button', { class: 'btn small' + (f.primary ? ' primary' : ''), disabled: !!f.disabled, onclick: f.action }, f.label));
      } else if (f.type === 'label') {
        bar.append(el('span', { class: 'note' }, f.text));
      } else if (f.type === 'number') {
        const num = el('input', { type: 'number', value: f.value, step: 'any' });
        num.onchange = () => { if (num.value !== '') f.set(+num.value); };
        bar.append(el('label', {}, f.label, num, f.unit ? el('small', {}, f.unit) : null));
      }
    }
    if (!s && t.hint) bar.append(el('span', { class: 'note' }, t.hint));
  };
  on('tool', draw);
  on('options', () => {
    // don't rebuild while someone is typing in the bar
    if (bar.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number') return;
    draw();
  });
  on('opt-value', (key) => {
    const num = bar.querySelector(`input[data-key="${key}"]`);
    if (num) { num.value = app.opts[app.tool][key]; num.dispatchEvent(new Event('input')); }
  });
  draw();
}

// ---------------------------------------------------------------- colors

const PALETTE = ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff', '#d25800', '#f07a24', '#7a2e00', '#e11d48', '#f97316', '#facc15', '#84cc16',
  '#16a34a', '#14b8a6', '#06b6d4', '#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#78350f', '#a16207', '#1e3a5f', '#334155'];

let pickTarget = 'fg';
export function pickColor(which) {
  pickTarget = which;
  const p = $('c-picker');
  p.value = which === 'fg' ? app.fg : app.bg;
  p.click();
}

export function buildColors() {
  const pal = $('palette');
  for (const c of PALETTE) {
    pal.append(el('button', {
      style: { background: c }, title: `${c} — click for foreground, right-click for background`,
      onclick: (e) => (e.altKey ? setColors(null, c) : setColors(c, null)),
      oncontextmenu: (e) => { e.preventDefault(); setColors(null, c); },
    }));
  }
  $('c-fg').onclick = () => pickColor('fg');
  $('c-bg').onclick = () => pickColor('bg');
  $('c-picker').addEventListener('input', (e) => (pickTarget === 'fg' ? setColors(e.target.value, null) : setColors(null, e.target.value)));
  $('c-swap').onclick = () => setColors(app.bg, app.fg);
  $('c-reset').onclick = () => setColors('#000000', '#ffffff');
  const hex = $('c-hex');
  hex.addEventListener('change', () => {
    let v = hex.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + [...v.slice(1)].map(ch => ch + ch).join('');
    if (hexToRgb(v)) setColors(v.toLowerCase(), null); else hex.value = app.fg;
  });
  const show = () => {
    for (const id of ['c-fg', 'm-fg']) $(id).style.background = app.fg;
    for (const id of ['c-bg', 'm-bg']) $(id).style.background = app.bg;
    if (document.activeElement !== hex) hex.value = app.fg;
  };
  on('colors', show);
  show();
}

// ---------------------------------------------------------------- adjustments

export function buildAdjust() {
  const grid = $('adjust-grid');
  const short = { 'brightness-contrast': 'Brightness', 'hue-saturation': 'Hue/Sat', 'color-balance': 'Balance', desaturate: 'Grayscale' };
  for (const id of ['brightness-contrast', 'levels', 'curves', 'exposure', 'hue-saturation', 'color-balance', 'vibrance', 'desaturate', 'invert', 'threshold', 'posterize', 'sepia']) {
    const f = FILTERS[id];
    grid.append(el('button', { class: 'btn', title: f.name + (f.key ? ` (${f.key})` : ''), onclick: () => runFilterUI(id) }, short[id] || f.name));
  }
}

// ---------------------------------------------------------------- layers

export function buildLayers() {
  const list = $('layer-list');
  const blend = $('l-blend');
  for (const b of BLENDS) blend.append(el('option', { value: b.id }, b.name));
  const opacity = $('l-opacity'), range = $('l-opacity-range'), lock = $('l-lock');

  blend.onchange = () => setLayerProp(app.doc.active, 'blend', blend.value, 'Blend Mode');
  const liveOpacity = (v) => { const d = app.doc; if (!d) return; d.layer.opacity = v / 100; d.changed(); };
  range.oninput = () => { opacity.value = range.value; liveOpacity(+range.value); };
  range.onchange = () => app.doc && app.doc.commit('Layer Opacity');
  opacity.oninput = () => { if (opacity.value === '') return; range.value = opacity.value; liveOpacity(Math.max(0, Math.min(100, +opacity.value))); };
  opacity.onchange = () => app.doc && app.doc.commit('Layer Opacity');
  lock.onchange = () => setLayerProp(app.doc.active, 'locked', lock.checked, lock.checked ? 'Lock Layer' : 'Unlock Layer');
  $('l-new').onclick = () => app.doc && addEmptyLayer();
  $('l-dup').onclick = () => app.doc && duplicateLayer();
  $('l-del').onclick = () => app.doc && deleteLayer();
  $('l-up').onclick = () => app.doc && moveLayer(app.doc.active, app.doc.active + 1);
  $('l-down').onclick = () => app.doc && moveLayer(app.doc.active, app.doc.active - 1);
  $('l-merge').onclick = () => app.doc && mergeDown();

  const thumbs = new Map();
  let dragFrom = -1;
  const drawThumb = (c, l) => {
    const d = app.doc;
    const s = Math.min(c.width / d.width, c.height / d.height);
    const g = ctx2d(c);
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(d.source(l), (c.width - d.width * s) / 2, (c.height - d.height * s) / 2, d.width * s, d.height * s);
  };
  const render = () => {
    const d = app.doc;
    list.replaceChildren();
    thumbs.clear();
    for (const id of ['l-blend', 'l-opacity', 'l-opacity-range', 'l-lock', 'l-new', 'l-dup', 'l-del', 'l-up', 'l-down', 'l-merge']) $(id).disabled = !d;
    if (!d) return;
    const l = d.layer;
    blend.value = l.blend;
    opacity.value = Math.round(l.opacity * 100);
    range.value = Math.round(l.opacity * 100);
    lock.checked = l.locked;
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const layer = d.layers[i];
      const thumb = el('canvas', { width: 88, height: 68 });
      drawThumb(thumb, layer);
      thumbs.set(layer.id, thumb);
      const name = el('span', { class: 'name', title: 'Double-click to rename' }, layer.name);
      const meta = [layer.blend !== 'normal' ? BLENDS.find(b => b.id === layer.blend).name : '', layer.opacity < 1 ? Math.round(layer.opacity * 100) + '%' : '', layer.locked ? '🔒' : ''].filter(Boolean).join(' · ');
      const row = el('div', { class: 'layer' + (i === d.active ? ' on' : ''), draggable: true, 'data-index': i },
        el('button', { class: 'eye' + (layer.visible ? '' : ' off'), title: layer.visible ? 'Hide layer' : 'Show layer', onclick: (e) => { e.stopPropagation(); setLayerProp(i, 'visible', !layer.visible, layer.visible ? 'Hide Layer' : 'Show Layer'); } }, layer.visible ? '👁' : '—'),
        thumb, name, meta ? el('span', { class: 'meta' }, meta) : null);
      row.onclick = () => { if (d.active !== i) { d.active = i; emit('layers'); } };
      name.ondblclick = (e) => {
        e.stopPropagation();
        const inp = el('input', { type: 'text', class: 'rename', value: layer.name });
        name.replaceWith(inp);
        inp.focus();
        inp.select();
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          if (ok && inp.value.trim() && inp.value.trim() !== layer.name) setLayerProp(i, 'name', inp.value.trim(), 'Rename Layer');
          else render();
        };
        inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); };
        inp.onblur = () => finish(true);
      };
      row.ondragstart = (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-layer', String(i)); };
      row.ondragover = (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const above = e.clientY < r.top + r.height / 2;
        list.querySelectorAll('.layer').forEach(x => x.classList.remove('drop-above', 'drop-below'));
        row.classList.add(above ? 'drop-above' : 'drop-below');
      };
      row.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = row.getBoundingClientRect();
        const above = e.clientY < r.top + r.height / 2;
        // the list shows the top layer first, so "above" means a higher index
        let to = above ? i + 1 : i;
        if (dragFrom < to) to--;
        const from = dragFrom;
        dragFrom = -1;
        moveLayer(from, to);
      };
      row.ondragend = () => { dragFrom = -1; list.querySelectorAll('.layer').forEach(x => x.classList.remove('drop-above', 'drop-below')); };
      list.append(row);
    }
  };
  on('layers', render);
  on('doc', render);
  // thumbnails follow painting, a few times a second at most
  let pending = false;
  on('render', () => {
    if (pending || !app.doc) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      const d = app.doc;
      if (!d) return;
      for (const l of d.layers) { const c = thumbs.get(l.id); if (c) drawThumb(c, l); }
    }, 350);
  });
  render();
}

// ---------------------------------------------------------------- history

export function buildHistory() {
  const list = $('history-list');
  const render = () => {
    list.replaceChildren();
    const d = app.doc;
    if (!d) return;
    d.history.forEach((s, i) => {
      list.append(el('div', { class: i === d.hIndex ? 'on' : i > d.hIndex ? 'future' : '', onclick: () => d.restore(i), title: i > d.hIndex ? 'Undone: click to redo up to here' : '' }, s.label));
    });
    requestAnimationFrame(() => list.querySelector('.on')?.scrollIntoView({ block: 'nearest' }));
  };
  on('history', render);
  on('doc', render);
  render();
}

// ---------------------------------------------------------------- tabs

export function buildTabs(switchTo, close) {
  const tabs = $('tabs');
  const render = () => {
    tabs.replaceChildren();
    for (const d of app.docs) {
      tabs.append(el('div', { class: 'tab' + (d === app.doc ? ' on' : ''), title: `${d.name} — ${d.width} × ${d.height} px`, onclick: () => switchTo(d), onauxclick: (e) => { if (e.button === 1) close(d); } },
        el('span', {}, d.name + (d.dirty ? ' •' : '')),
        el('button', { class: 'x', title: 'Close', onclick: (e) => { e.stopPropagation(); close(d); } }, '✕')));
    }
  };
  on('doc', render);
  on('history', render);
  render();
}

// ---------------------------------------------------------------- status bar

export function buildStatus() {
  const msg = $('st-msg');
  on('status', (text, kind) => { msg.textContent = text; msg.className = 'msg ' + (kind || ''); });
  const zoomSize = () => {
    const d = app.doc;
    $('st-zoom').textContent = d ? `${+(d.view.zoom * 100).toFixed(d.view.zoom < 0.1 ? 1 : 0)}%` : '';
    $('st-size').textContent = d ? `${d.width} × ${d.height} px` : '';
  };
  on('zoom', zoomSize);
  on('doc', zoomSize);
  on('size', zoomSize);
  zoomSize();
}

export function showPointer(p) {
  const d = app.doc;
  const pos = $('st-pos'), col = $('st-color');
  if (!d || !p || p.x < 0 || p.y < 0 || p.x >= d.width || p.y >= d.height) { pos.textContent = ''; col.replaceChildren(); return; }
  const x = Math.floor(p.x), y = Math.floor(p.y);
  pos.textContent = `X ${x}  Y ${y}`;
  const px = ctx2d(d.composite()).getImageData(x, y, 1, 1).data;
  const hex = rgbToHex(px[0], px[1], px[2]);
  col.replaceChildren(el('i', { style: { background: px[3] ? hex : 'transparent' } }), el('b', {}, px[3] ? `${hex}  ${px[0]},${px[1]},${px[2]}${px[3] < 255 ? `  α${px[3]}` : ''}` : 'transparent'));
}

export { TOOLS };
