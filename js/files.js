// Opening pictures (JPEG, PNG, WebP, GIF, BMP, AVIF, SVG, ICO, TIFF, PSD) and saving them
// (layered PSD, PNG, JPEG, WebP, BMP, PDF).

import { canvas, ctx2d, canvasBlob, download, baseName } from './util.js';
import { newLayer, blendOf, Doc } from './doc.js';
import { readPsd, writePsd } from './psd.js';
import { zlibSync } from '../vendor/fflate.js';

export const OPEN_ACCEPT = 'image/*,.psd,.psb,.tif,.tiff,.svg,.ico,.avif';

const ext = (name) => (/\.([^.]+)$/.exec(name || '')?.[1] || '').toLowerCase();

/** Reads a file into layers: { width, height, layers: [{ name, canvas, visible, opacity, blend, locked }] } */
export async function decodeFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sig = String.fromCharCode(...bytes.subarray(0, 4));
  if (sig === '8BPS') return fromPsd(readPsd(bytes), file.name);
  if (sig === 'II*\0' || sig === 'MM\0*' || ['tif', 'tiff'].includes(ext(file.name))) return fromTiff(bytes, file.name);
  let img;
  if (ext(file.name) === 'svg' || file.type === 'image/svg+xml') img = await svgImage(file);
  else {
    try { img = await createImageBitmap(file); }
    catch { img = await elementImage(file); }
  }
  const c = canvas(img.width, img.height);
  ctx2d(c).drawImage(img, 0, 0);
  img.close?.();
  return { width: c.width, height: c.height, layers: [{ name: baseName(file.name) || 'Layer', canvas: c }] };
}

function elementImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { resolve(im); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`"${file.name}" isn't a picture this editor can open.`)); };
    im.src = url;
  });
}

async function svgImage(file) {
  const im = await elementImage(file);
  // SVGs without a size come out as 300 × 150; give those a sensible size instead
  if (!im.naturalWidth || !im.naturalHeight) { im.width = 1000; im.height = 1000; }
  return im;
}

function fromPsd(psd, name) {
  const { width, height } = psd;
  const layers = psd.layers.map(l => {
    const c = canvas(width, height);
    if (l.rgba && l.width && l.height) {
      const tmp = canvas(l.width, l.height);
      ctx2d(tmp).putImageData(new ImageData(l.rgba, l.width, l.height), 0, 0);
      ctx2d(c).drawImage(tmp, l.left, l.top);
    }
    return { name: l.name, canvas: c, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked };
  });
  if (!layers.length && psd.composite) {
    const c = canvas(width, height);
    ctx2d(c).putImageData(new ImageData(psd.composite, width, height), 0, 0);
    layers.push({ name: 'Background', canvas: c });
  }
  return { width, height, layers, psd: true, name };
}

let utif;
function loadUtif() {
  utif ??= new Promise((resolve, reject) => {
    if (self.UTIF) return resolve(self.UTIF);
    const s = document.createElement('script');
    s.src = new URL('../vendor/UTIF.js', import.meta.url).href;
    s.onload = () => resolve(self.UTIF);
    s.onerror = () => reject(new Error("The TIFF reader couldn't be loaded."));
    document.head.appendChild(s);
  });
  return utif;
}

async function fromTiff(bytes, name) {
  const UTIF = await loadUtif();
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const pages = UTIF.decode(buf).filter(f => f.t256 && f.t257);
  if (!pages.length) throw new Error("This TIFF doesn't contain any pictures.");
  // every page of a multi-page TIFF becomes a layer
  const w = Math.max(...pages.map(p => p.t256[0] ?? p.t256)), h = Math.max(...pages.map(p => p.t257[0] ?? p.t257));
  const layers = pages.map((ifd, i) => {
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const tmp = canvas(ifd.width, ifd.height);
    ctx2d(tmp).putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, ifd.width * ifd.height * 4), ifd.width, ifd.height), 0, 0);
    const c = canvas(w, h);
    ctx2d(c).drawImage(tmp, 0, 0);
    return { name: pages.length > 1 ? `Page ${i + 1}` : baseName(name), canvas: c };
  });
  return { width: w, height: h, layers };
}

/** A new document from what decodeFile() read */
export function docFromDecoded(dec, name) {
  const d = new Doc(dec.width, dec.height, baseName(name));
  for (const l of dec.layers) {
    const nl = newLayer(dec.width, dec.height, l.name);
    nl.canvas = l.canvas;
    Object.assign(nl, { visible: l.visible ?? true, opacity: l.opacity ?? 1, blend: l.blend || 'normal', locked: l.locked ?? false });
    d.layers.push(nl);
  }
  d.active = d.layers.length - 1;
  d.commit('Open');
  d.savedIndex = d.hIndex;
  return d;
}

// ------------------------------------------------------------------------- saving

export const FORMATS = [
  { id: 'psd', name: 'Photoshop (.psd) — keeps layers', ext: 'psd', mime: 'image/vnd.adobe.photoshop', layered: true },
  { id: 'png', name: 'PNG — lossless, keeps transparency', ext: 'png', mime: 'image/png' },
  { id: 'jpeg', name: 'JPEG — photos, smallest files', ext: 'jpg', mime: 'image/jpeg', quality: true },
  { id: 'webp', name: 'WebP — small files for the web', ext: 'webp', mime: 'image/webp', quality: true },
  { id: 'bmp', name: 'BMP — Windows bitmap', ext: 'bmp', mime: 'image/bmp' },
  { id: 'pdf', name: 'PDF — one page', ext: 'pdf', mime: 'application/pdf' },
];
export const formatById = (id) => FORMATS.find(f => f.id === id) || FORMATS[0];

function flattened(d, background) {
  const c = canvas(d.width, d.height);
  const g = ctx2d(c);
  if (background) { g.fillStyle = background; g.fillRect(0, 0, d.width, d.height); }
  g.drawImage(d.composite(), 0, 0);
  return c;
}

export async function encode(d, fmtId, { quality = 0.9 } = {}) {
  const f = formatById(fmtId);
  if (f.id === 'psd') {
    const comp = ctx2d(d.composite()).getImageData(0, 0, d.width, d.height).data;
    const bytes = writePsd({
      width: d.width, height: d.height, composite: comp,
      layers: d.layers.map(l => ({
        name: l.name, rgba: ctx2d(l.canvas).getImageData(0, 0, d.width, d.height).data,
        visible: l.visible, opacity: l.opacity, blendKey: blendOf(l.blend).psd, locked: l.locked,
      })),
    });
    return new Blob([bytes], { type: f.mime });
  }
  if (f.id === 'png') return canvasBlob(flattened(d), 'image/png');
  if (f.id === 'jpeg') return canvasBlob(flattened(d, '#ffffff'), 'image/jpeg', quality);
  if (f.id === 'webp') {
    const b = await canvasBlob(flattened(d), 'image/webp', quality);
    if (b.type !== 'image/webp') throw new Error("This browser can't write WebP files.");
    return b;
  }
  if (f.id === 'bmp') return new Blob([bmp(flattened(d, '#ffffff'))], { type: f.mime });
  if (f.id === 'pdf') return new Blob([pdf(flattened(d))], { type: f.mime });
  throw new Error('Unknown format');
}

/** 24-bit BMP, bottom-up rows */
function bmp(c) {
  const { width: w, height: h } = c;
  const px = ctx2d(c).getImageData(0, 0, w, h).data;
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const b = new Uint8Array(size);
  const v = new DataView(b.buffer);
  b[0] = 0x42; b[1] = 0x4d;
  v.setUint32(2, size, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
  v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true);
  v.setInt32(38, 3780, true); v.setInt32(42, 3780, true); // 96 dpi
  for (let y = 0; y < h; y++) {
    const o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      b[o + x * 3] = px[i + 2]; b[o + x * 3 + 1] = px[i + 1]; b[o + x * 3 + 2] = px[i];
    }
  }
  return b;
}

/** A one-page PDF holding the picture losslessly (at 96 pixels per inch), with its transparency */
function pdf(c) {
  const { width: w, height: h } = c;
  const px = ctx2d(c).getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
  let transparent = false;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    rgb[i * 3] = px[j]; rgb[i * 3 + 1] = px[j + 1]; rgb[i * 3 + 2] = px[j + 2];
    alpha[i] = px[j + 3];
    if (px[j + 3] !== 255) transparent = true;
  }
  const pw = (w * 72) / 96, ph = (h * 72) / 96;
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let pos = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n, dict, stream) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n${dict}`);
    if (stream) { push(`\nstream\n`); push(stream); push(`\nendstream`); }
    push(`\nendobj\n`);
  };
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const img = zlibSync(rgb, { level: 6 });
  const content = enc.encode(`q ${pw.toFixed(3)} 0 0 ${ph.toFixed(3)} 0 0 cm /Im0 Do Q`);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(3)} ${ph.toFixed(3)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  obj(4, `<< /Length ${content.length} >>`, content);
  obj(5, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${transparent ? ' /SMask 7 0 R' : ''} /Length ${img.length} >>`, img);
  const info = `<< /Producer (Photo Editor - Badger Metal & Machine Fabrication) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`;
  obj(6, info);
  let count = 7;
  if (transparent) {
    const a = zlibSync(alpha, { level: 6 });
    obj(7, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${a.length} >>`, a);
    count = 8;
  }
  const xref = pos;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) x += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Asks where to save (when the browser can) before doing the work, then writes the file */
export async function pickSaveTarget(fmtId, suggested) {
  const f = formatById(fmtId);
  const name = `${baseName(suggested)}.${f.ext}`;
  if (!window.showSaveFilePicker) return { name };
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: name, id: 'photo-editor-save',
      types: [{ description: f.name.split(' —')[0], accept: { [f.mime]: ['.' + f.ext, ...(f.id === 'jpeg' ? ['.jpeg'] : [])] } }],
    });
    return { name: handle.name, handle };
  } catch (e) {
    if (e.name === 'AbortError') return null;
    return { name };
  }
}

export async function writeTarget(target, blob) {
  if (target.handle) {
    const w = await target.handle.createWritable();
    await w.write(blob);
    await w.close();
  } else download(blob, target.name);
}
