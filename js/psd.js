// Photoshop files (.psd, and the large-document .psb) read and written here, without Photoshop.
//
// Writing: 8-bit RGB with real layers (name, visibility, opacity, blend mode, lock) plus the
// flattened picture, RLE compressed, which Photoshop, GIMP, Affinity and Photopea all open.
// Reading: RGB, grayscale, CMYK, indexed and bitmap-free 8/16-bit files, layers with RLE / ZIP
// compression and layer masks. Groups are flattened into a plain list of layers. Without layers
// (or when they can't be read) the flattened picture is used instead.

import { unzlibSync } from '../vendor/fflate.js';

// ------------------------------------------------------------------------- writing

class Writer {
  constructor(size = 1 << 20) { this.buf = new Uint8Array(size); this.pos = 0; }
  need(n) {
    if (this.pos + n <= this.buf.length) return;
    let s = this.buf.length * 2;
    while (s < this.pos + n) s *= 2;
    const b = new Uint8Array(s);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b;
  }
  u8(v) { this.need(1); this.buf[this.pos++] = v & 255; }
  u16(v) { this.need(2); this.buf[this.pos++] = (v >> 8) & 255; this.buf[this.pos++] = v & 255; }
  i16(v) { this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { this.need(4); for (let s = 24; s >= 0; s -= 8) this.buf[this.pos++] = (v >>> s) & 255; }
  i32(v) { this.u32(v >>> 0); }
  ascii(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  bytes(a) { this.need(a.length); this.buf.set(a, this.pos); this.pos += a.length; }
  pad(to) { while (this.pos % to) this.u8(0); }
  /** Writes a 4-byte length placeholder and returns a function that fills it in */
  lengthMark() {
    const at = this.pos;
    this.u32(0);
    return (extra = 0) => {
      const len = this.pos - at - 4 + extra;
      this.buf[at] = (len >>> 24) & 255; this.buf[at + 1] = (len >>> 16) & 255; this.buf[at + 2] = (len >>> 8) & 255; this.buf[at + 3] = len & 255;
    };
  }
  result() { return this.buf.slice(0, this.pos); }
}

/** PackBits, the run-length compression Photoshop uses, for one row */
function packRow(row, out) {
  const n = row.length;
  let i = 0;
  const start = out.length;
  while (i < n) {
    let run = 1;
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++;
    if (run >= 2) {
      out.push(257 - run, row[i]);
      i += run;
      continue;
    }
    let lit = 1;
    while (i + lit < n && lit < 128 && !(i + lit + 1 < n && row[i + lit] === row[i + lit + 1])) lit++;
    out.push(lit - 1);
    for (let k = 0; k < lit; k++) out.push(row[i + k]);
    i += lit;
  }
  return out.length - start;
}

/** One channel (w × h bytes) compressed: [row byte counts, data] */
function rleChannel(plane, w, h) {
  const counts = new Uint16Array(h);
  const data = [];
  for (let y = 0; y < h; y++) counts[y] = packRow(plane.subarray(y * w, y * w + w), data);
  return { counts, data: Uint8Array.from(data) };
}

function planes(rgba, w, h) {
  const n = w * h;
  const p = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let i = 0, j = 0; i < n; i++, j += 4) { p[0][i] = rgba[j]; p[1][i] = rgba[j + 1]; p[2][i] = rgba[j + 2]; p[3][i] = rgba[j + 3]; }
  return p;
}

function trimmed(rgba, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3]) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    y1 = y;
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(rgba, w, r) {
  const out = new Uint8Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(rgba.subarray(((r.y + y) * w + r.x) * 4, ((r.y + y) * w + r.x + r.w) * 4), y * r.w * 4);
  return out;
}

/**
 * layers: [{ name, rgba (Uint8ClampedArray w*h*4, full document size), visible, opacity 0-1, blendKey, locked }],
 * bottom first. composite: the flattened RGBA picture.
 */
export function writePsd({ width, height, layers, composite }) {
  const w = new Writer(Math.max(1 << 20, width * height * 2));
  // header
  w.ascii('8BPS'); w.u16(1); w.bytes(new Uint8Array(6)); w.u16(3); w.u32(height); w.u32(width); w.u16(8); w.u16(3);
  // color mode data
  w.u32(0);
  // image resources: resolution 72 dpi
  const res = w.lengthMark();
  w.ascii('8BIM'); w.u16(0x03ed); w.u16(0); w.u32(16);
  w.u32(72 << 16); w.u16(1); w.u16(1); w.u32(72 << 16); w.u16(1); w.u16(1);
  res();

  // layer and mask information
  const lmi = w.lengthMark();
  const li = w.lengthMark();
  w.i16(layers.length);
  const encoded = layers.map(l => {
    const r = trimmed(l.rgba, width, height);
    if (!r) return { r: { x: 0, y: 0, w: 0, h: 0 }, ch: null };
    const p = planes(crop(l.rgba, width, r), r.w, r.h);
    // channel order in the file: transparency (-1), then red, green, blue
    return { r, ch: [[-1, p[3]], [0, p[0]], [1, p[1]], [2, p[2]]].map(([id, plane]) => ({ id, ...rleChannel(plane, r.w, r.h) })) };
  });
  layers.forEach((l, i) => {
    const { r, ch } = encoded[i];
    w.i32(r.y); w.i32(r.x); w.i32(r.y + r.h); w.i32(r.x + r.w);
    w.u16(4);
    for (const id of [-1, 0, 1, 2]) {
      w.i16(id);
      const c = ch && ch.find(c => c.id === id);
      w.u32(c ? 2 + c.counts.length * 2 + c.data.length : 2);
    }
    w.ascii('8BIM');
    w.ascii((l.blendKey || 'norm').padEnd(4, ' ').slice(0, 4));
    w.u8(Math.round((l.opacity ?? 1) * 255));
    w.u8(0); // clipping: base
    // flags: bit 0 transparency protected, bit 1 hidden, bit 3 set means bit 4 is meaningful
    w.u8((l.locked ? 1 : 0) | (l.visible === false ? 2 : 0) | 8);
    w.u8(0);
    const extra = w.lengthMark();
    w.u32(0); // no layer mask
    w.u32(0); // no blending ranges
    const name = String(l.name || 'Layer');
    // pascal name (Mac Roman, so non-ASCII becomes '?'; the full name goes in 'luni')
    const ascii = name.replace(/[^\x20-\x7e]/g, '?').slice(0, 255);
    w.u8(ascii.length); w.ascii(ascii);
    for (let k = (4 - ((ascii.length + 1) % 4)) % 4; k > 0; k--) w.u8(0);
    // unicode name
    w.ascii('8BIM'); w.ascii('luni');
    const lu = w.lengthMark();
    w.u32(name.length);
    for (let k = 0; k < name.length; k++) w.u16(name.charCodeAt(k));
    if (name.length % 2) w.u16(0);
    lu();
    if (l.locked) { w.ascii('8BIM'); w.ascii('lspf'); w.u32(4); w.u32(0x80000000); }
    extra();
  });
  // channel image data
  for (const { ch } of encoded) {
    if (!ch) { for (let k = 0; k < 4; k++) w.u16(0); continue; }
    for (const c of ch) {
      w.u16(1);
      for (const n of c.counts) w.u16(n);
      w.bytes(c.data);
    }
  }
  w.pad(2);
  li();
  w.u32(0); // global layer mask info
  lmi();

  // merged picture, flattened on white (as Photoshop does without an alpha channel)
  const flat = new Uint8Array(width * height * 4);
  for (let i = 0; i < flat.length; i += 4) {
    const a = composite[i + 3] / 255;
    flat[i] = composite[i] * a + 255 * (1 - a);
    flat[i + 1] = composite[i + 1] * a + 255 * (1 - a);
    flat[i + 2] = composite[i + 2] * a + 255 * (1 - a);
  }
  const p = planes(flat, width, height);
  const chans = [0, 1, 2].map(c => rleChannel(p[c], width, height));
  w.u16(1);
  for (const c of chans) for (const n of c.counts) w.u16(n);
  for (const c of chans) w.bytes(c.data);
  return w.result();
}

// ------------------------------------------------------------------------- reading

const BLEND_KEYS = {
  norm: 'normal', dark: 'darken', 'mul ': 'multiply', idiv: 'color-burn', lite: 'lighten', scrn: 'screen', 'div ': 'color-dodge',
  lddg: 'linear-dodge', over: 'overlay', sLit: 'soft-light', hLit: 'hard-light', diff: 'difference', smud: 'exclusion',
  'hue ': 'hue', 'sat ': 'saturation', colr: 'color', 'lum ': 'luminosity',
  // modes the browser can't blend are shown as the nearest one
  lbrn: 'multiply', dkCl: 'darken', lgCl: 'lighten', vLit: 'hard-light', lLit: 'hard-light', pLit: 'hard-light', hMix: 'hard-light',
  diss: 'normal', pass: 'normal', fsub: 'difference', fdiv: 'color-dodge',
};

class Reader {
  constructor(bytes) { this.b = bytes; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.pos = 0; }
  u8() { return this.b[this.pos++]; }
  u16() { const v = this.v.getUint16(this.pos); this.pos += 2; return v; }
  i16() { const v = this.v.getInt16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.v.getUint32(this.pos); this.pos += 4; return v; }
  i32() { const v = this.v.getInt32(this.pos); this.pos += 4; return v; }
  u64() { const hi = this.u32(), lo = this.u32(); return hi * 4294967296 + lo; }
  ascii(n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.b[this.pos++]); return s; }
  bytes(n) { const a = this.b.subarray(this.pos, this.pos + n); this.pos += n; return a; }
}

function unpackBits(src, out, outPos, outLen) {
  let i = 0, o = outPos;
  const end = outPos + outLen;
  while (o < end && i < src.length) {
    let n = src[i++];
    if (n > 127) n -= 256;
    if (n >= 0) { for (let k = 0; k <= n && o < end; k++) out[o++] = src[i++]; }
    else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n && o < end; k++) out[o++] = v; }
  }
}

/** Decodes one channel's data (compression field already read) into w*h 8-bit values */
function decodePlane(comp, data, w, h, depth, big) {
  const bps = depth === 16 ? 2 : 1;
  const rowBytes = w * bps;
  let raw = new Uint8Array(rowBytes * h);
  if (comp === 0) raw.set(data.subarray(0, raw.length));
  else if (comp === 1) {
    const cb = big ? 4 : 2;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let p = h * cb;
    for (let y = 0; y < h; y++) {
      const n = big ? dv.getUint32(y * 4) : dv.getUint16(y * 2);
      unpackBits(data.subarray(p, p + n), raw, y * rowBytes, rowBytes);
      p += n;
    }
  } else if (comp === 2 || comp === 3) {
    raw = unzlibSync(data);
    if (comp === 3) {
      // ZIP with prediction: each value is stored as the difference from the one before it
      for (let y = 0; y < h; y++) {
        if (bps === 1) for (let x = 1; x < w; x++) raw[y * w + x] = (raw[y * w + x] + raw[y * w + x - 1]) & 255;
        else {
          const dv = new DataView(raw.buffer, raw.byteOffset);
          for (let x = 1; x < w; x++) { const o = (y * w + x) * 2; dv.setUint16(o, (dv.getUint16(o) + dv.getUint16(o - 2)) & 65535); }
        }
      }
    }
  } else throw new Error('This Photoshop file uses a compression this editor can\'t read.');
  if (bps === 1) return raw;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = raw[i * 2];
  return out;
}

/** Puts channels (by id) together as RGBA for the file's color mode */
function toRGBA(ch, w, h, mode, palette) {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const a = ch[-1];
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (mode === 3) { out[j] = ch[0] ? ch[0][i] : 0; out[j + 1] = ch[1] ? ch[1][i] : 0; out[j + 2] = ch[2] ? ch[2][i] : 0; }
    else if (mode === 1 || mode === 8) { out[j] = out[j + 1] = out[j + 2] = ch[0] ? ch[0][i] : 0; }
    else if (mode === 4) {
      const k = ch[3] ? ch[3][i] : 255;
      out[j] = ((ch[0] ? ch[0][i] : 255) * k) / 255; out[j + 1] = ((ch[1] ? ch[1][i] : 255) * k) / 255; out[j + 2] = ((ch[2] ? ch[2][i] : 255) * k) / 255;
    } else if (mode === 2 && palette) {
      const v = ch[0] ? ch[0][i] : 0;
      out[j] = palette[v]; out[j + 1] = palette[256 + v]; out[j + 2] = palette[512 + v];
    }
    out[j + 3] = a ? a[i] : 255;
  }
  return out;
}

export function readPsd(bytes) {
  const r = new Reader(bytes);
  if (r.ascii(4) !== '8BPS') throw new Error("This isn't a Photoshop file.");
  const version = r.u16();
  if (version !== 1 && version !== 2) throw new Error('Unknown Photoshop file version.');
  const big = version === 2;
  r.pos += 6;
  const channels = r.u16(), height = r.u32(), width = r.u32(), depth = r.u16(), mode = r.u16();
  if (depth !== 8 && depth !== 16) throw new Error(`This Photoshop file is ${depth}-bit; only 8 and 16-bit files can be opened.`);
  if (![1, 2, 3, 4, 8].includes(mode)) throw new Error('This Photoshop file uses a color mode (such as Lab or Bitmap) that can\'t be opened.');
  const cmLen = r.u32();
  const palette = mode === 2 ? r.b.slice(r.pos, r.pos + 768) : null;
  r.pos += cmLen;
  const resLen = r.u32();
  r.pos += resLen; // image resources

  const len = (n8) => (big && n8 ? r.u64() : r.u32());
  const lmiLen = len(true);
  const lmiEnd = r.pos + lmiLen;
  const layers = [];
  let layerError = null;
  try {
    if (lmiLen > 0) {
      const liLen = len(true);
      if (liLen > 0) {
        const count = Math.abs(r.i16());
        const recs = [];
        for (let i = 0; i < count; i++) {
          const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
          const nch = r.u16();
          const chs = [];
          for (let c = 0; c < nch; c++) chs.push({ id: r.i16(), len: len(true) });
          r.pos += 4; // 8BIM
          const blend = r.ascii(4);
          const opacity = r.u8(), clipping = r.u8(), flags = r.u8();
          r.pos += 1;
          const extraLen = r.u32(), extraEnd = r.pos + extraLen;
          const maskLen = r.u32();
          let mask = null;
          if (maskLen >= 20) {
            const mt = r.i32(), ml = r.i32(), mb = r.i32(), mr = r.i32();
            const def = r.u8(), mflags = r.u8();
            mask = { top: mt, left: ml, bottom: mb, right: mr, def, disabled: !!(mflags & 2) };
            r.pos += maskLen - 18;
          } else r.pos += maskLen;
          const rangesLen = r.u32();
          r.pos += rangesLen; // blending ranges
          const nameLen = r.u8();
          let name = r.ascii(nameLen);
          r.pos += (4 - ((nameLen + 1) % 4)) % 4;
          let section = 0;
          while (r.pos + 12 <= extraEnd) {
            const sig = r.ascii(4);
            if (sig !== '8BIM' && sig !== '8B64') break;
            const key = r.ascii(4);
            const long = big && ['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD'].includes(key);
            const n = long ? r.u64() : r.u32();
            const at = r.pos;
            if (key === 'luni') {
              const cl = r.u32();
              let s = '';
              for (let k = 0; k < cl; k++) s += String.fromCharCode(r.u16());
              name = s.replace(/\0+$/, '');
            } else if (key === 'lsct' || key === 'lsdk') section = r.u32();
            r.pos = at + n;
          }
          r.pos = extraEnd;
          recs.push({ top, left, bottom, right, chs, blend, opacity, clipping, flags, name, mask, section });
        }
        for (const rec of recs) {
          const w = rec.right - rec.left, h = rec.bottom - rec.top;
          const planesById = {};
          for (const c of rec.chs) {
            const start = r.pos;
            const comp = r.u16();
            const isMask = c.id === -2;
            const mw = isMask && rec.mask ? rec.mask.right - rec.mask.left : w;
            const mh = isMask && rec.mask ? rec.mask.bottom - rec.mask.top : h;
            if (c.len > 2 && mw > 0 && mh > 0 && c.id >= -2) planesById[c.id] = decodePlane(comp, r.b.subarray(r.pos, start + c.len), mw, mh, depth, big);
            r.pos = start + c.len;
          }
          if (rec.section) continue; // group start or end marker
          let rgba = w > 0 && h > 0 ? toRGBA(planesById, w, h, mode, palette) : null;
          if (rgba && planesById[-2] && rec.mask && !rec.mask.disabled) applyMask(rgba, w, h, rec, planesById[-2]);
          layers.push({
            name: rec.name || 'Layer', left: rec.left, top: rec.top, width: Math.max(0, w), height: Math.max(0, h), rgba,
            visible: !(rec.flags & 2), opacity: rec.opacity / 255, blend: BLEND_KEYS[rec.blend] || 'normal', locked: !!(rec.flags & 1),
          });
        }
      }
    }
  } catch (e) {
    layerError = e;
    layers.length = 0;
  }
  r.pos = lmiEnd;

  // the flattened picture
  let composite = null;
  try {
    const comp = r.u16();
    const n = mode === 4 ? 4 : mode === 3 ? 3 : 1;
    const ch = {};
    const bps = depth === 16 ? 2 : 1;
    if (comp === 1) {
      const cb = big ? 4 : 2;
      const counts = [];
      for (let i = 0; i < channels * height; i++) counts.push(cb === 4 ? r.u32() : r.u16());
      for (let c = 0; c < channels; c++) {
        let total = 0;
        for (let y = 0; y < height; y++) total += counts[c * height + y];
        if (c < n) {
          const raw = new Uint8Array(width * height * bps);
          let p = r.pos;
          for (let y = 0; y < height; y++) {
            const k = counts[c * height + y];
            unpackBits(r.b.subarray(p, p + k), raw, y * width * bps, width * bps);
            p += k;
          }
          ch[c] = bps === 1 ? raw : Uint8Array.from({ length: width * height }, (_, i) => raw[i * 2]);
        }
        r.pos += total;
      }
    } else if (comp === 0) {
      for (let c = 0; c < n; c++) {
        const raw = r.bytes(width * height * bps);
        ch[c] = bps === 1 ? raw : Uint8Array.from({ length: width * height }, (_, i) => raw[i * 2]);
      }
    } else {
      // ZIP-compressed composite: rare; one block for all channels
      const raw = unzlibSync(r.b.subarray(r.pos));
      for (let c = 0; c < n; c++) ch[c] = raw.subarray(c * width * height * bps, (c + 1) * width * height * bps);
    }
    composite = toRGBA(ch, width, height, mode, palette);
  } catch {
    composite = null;
  }
  if (!layers.length && !composite) throw layerError || new Error("This Photoshop file couldn't be read.");
  return { width, height, layers, composite };
}

function applyMask(rgba, w, h, rec, plane) {
  const m = rec.mask;
  const mw = m.right - m.left;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x + rec.left - m.left, dy = y + rec.top - m.top;
    const v = dx >= 0 && dy >= 0 && dx < mw && dy < m.bottom - m.top ? plane[dy * mw + dx] : m.def;
    const o = (y * w + x) * 4 + 3;
    rgba[o] = (rgba[o] * v) / 255;
  }
}
