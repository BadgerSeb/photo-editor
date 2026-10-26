// Runs filters away from the page, so the window doesn't freeze on big pictures.
import { runFilter } from './filters.js';

self.onmessage = (e) => {
  const { id, name, params, w, h, data, mask } = e.data;
  try {
    const out = runFilter(name, new Uint8ClampedArray(data), w, h, params, mask ? new Uint8Array(mask) : null);
    self.postMessage({ id, data: out.buffer }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
