// Dialog boxes and the slider / number / list rows inside them.

import { el } from './util.js';

let open = 0;
export const dialogOpen = () => open > 0;

/**
 * Shows a dialog; resolves with the value of the button pressed (null for Cancel / Esc).
 * onButton(value) can return false to keep the dialog open (e.g. when a field is wrong).
 */
export function dialog({ title, body, buttons = [{ label: 'Cancel', value: null }, { label: 'OK', value: true, primary: true }], onButton, wide }) {
  return new Promise((resolve) => {
    const back = el('div', { class: 'modal-back' });
    const foot = el('div', { class: 'dialog-foot' });
    const box = el('div', { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title },
      el('div', { class: 'dialog-head' }, el('b', {}, title), el('button', { class: 'x', title: 'Close (Esc)', onclick: () => finish(null) }, '✕')),
      el('div', { class: 'dialog-body' }, body),
      foot);
    const finish = async (value) => {
      if (value !== null && onButton) {
        const ok = await onButton(value);
        if (ok === false) return;
      }
      back.remove();
      open--;
      document.removeEventListener('keydown', key, true);
      resolve(value);
    };
    for (const b of buttons) {
      foot.append(el('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => finish(b.value) }, b.label));
    }
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const p = buttons.find(b => b.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); finish(p.value); }
      } else e.stopPropagation();
    };
    document.addEventListener('keydown', key, true);
    back.append(box);
    document.body.append(back);
    open++;
    const first = box.querySelector('.dialog-body input:not([type=range]):not([type=checkbox]), .dialog-body select, .dialog-body input');
    setTimeout(() => (first || foot.querySelector('.primary'))?.focus(), 0);
  });
}

export function message(title, text) {
  return dialog({ title, body: el('p', { class: 'msg' }, text), buttons: [{ label: 'OK', value: true, primary: true }] });
}

export function confirmBox(title, text, yes = 'OK', no = 'Cancel') {
  return dialog({ title, body: el('p', { class: 'msg' }, text), buttons: [{ label: no, value: null }, { label: yes, value: true, primary: true }] });
}

const toSlider = (f, v) => (f.log ? Math.log(v / f.min) / Math.log(f.max / f.min) * 1000 : v);
const fromSlider = (f, s) => (f.log ? f.min * Math.pow(f.max / f.min, s / 1000) : s);
const roundTo = (v, step = 1) => Math.round(v / step) * step;

/** A slider with a number box next to it; onInput gets the new value as you drag */
export function sliderRow(f, value, onInput) {
  const step = f.step || 1;
  const range = el('input', { type: 'range', min: f.log ? 0 : f.min, max: f.log ? 1000 : f.max, step: f.log ? 1 : step, value: toSlider(f, value) });
  const num = el('input', { type: 'number', min: f.min, max: f.max, step, value: +(+value).toFixed(3) });
  range.addEventListener('input', () => {
    const v = roundTo(fromSlider(f, +range.value), step);
    num.value = +v.toFixed(3);
    onInput(v);
  });
  num.addEventListener('input', () => {
    if (num.value === '' || isNaN(+num.value)) return;
    const v = Math.min(f.max, Math.max(f.min, +num.value));
    range.value = toSlider(f, v);
    onInput(v);
  });
  const row = el('label', { class: 'row slider' }, el('span', {}, f.label), range, num, f.unit ? el('small', {}, f.unit) : null);
  row.set = (v) => { range.value = toSlider(f, v); num.value = +(+v).toFixed(3); };
  return row;
}

export function numberRow(label, value, { min, max, step = 1, unit } = {}, onInput) {
  const num = el('input', { type: 'number', min, max, step, value });
  num.addEventListener('input', () => { if (num.value !== '' && !isNaN(+num.value)) onInput?.(+num.value); });
  const row = el('label', { class: 'row' }, el('span', {}, label), num, unit ? el('small', {}, unit) : null);
  row.input = num;
  return row;
}

export function selectRow(label, options, value, onChange) {
  const s = el('select', {}, options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(value) }, t)));
  s.addEventListener('change', () => onChange(s.value));
  const row = el('label', { class: 'row' }, el('span', {}, label), s);
  row.input = s;
  return row;
}

export function checkRow(label, value, onChange) {
  const c = el('input', { type: 'checkbox', checked: !!value });
  c.addEventListener('change', () => onChange(c.checked));
  const row = el('label', { class: 'row check' }, c, el('span', {}, label));
  row.input = c;
  return row;
}

export function textRow(label, value, onInput) {
  const t = el('input', { type: 'text', value, spellcheck: false });
  t.addEventListener('input', () => onInput?.(t.value));
  const row = el('label', { class: 'row' }, el('span', {}, label), t);
  row.input = t;
  return row;
}
