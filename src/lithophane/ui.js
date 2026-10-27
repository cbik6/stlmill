// Rail controls for the Lithophane page: the same card vocabulary as the Clicker (group cards with
// a status line, label + range + fixed-digit tile readout, segmented radios, toggles), copied from
// src/clicker/ui.js and bound to this page's settings through a setParam callback.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

const CHEVRON =
  '<svg class="group-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6l5 5 5-5"/></svg>';

export const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const idFor = (path) => `lp-${path.replace(/\./g, '-')}`;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Trim a number for prose: 35 -> "35", 21.5 -> "21.5". */
export const fmt = (n, d = 1) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : '—';

const UNIT_WORDS = { mm: 'millimetres', '%': 'percent', '°': 'degrees', '': '' };

// ------------------------------------------------------------------ readouts
function tick(el) {
  if (reducedMotion() || typeof el.animate !== 'function') return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)', offset: 0.45 }, { transform: 'translateY(0)' }], {
    duration: 120,
    easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
  });
}

function fixedChars(value, { intDigits = 2, decimals = 0 } = {}) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [i, d] = Math.abs(v).toFixed(decimals).split('.');
  return (i.padStart(intDigits, '0') + (d ? '.' + d : '')).split('');
}

function createReadout({ intDigits = 2, decimals = 0, unit = '' } = {}) {
  const chars = fixedChars(0, { intDigits, decimals });
  const tiles = chars.map((c) => h('span', { class: c === '.' ? 'tile tile-narrow' : 'tile' }, c));
  const root = h('span', { class: 'ro', 'aria-hidden': 'true' }, tiles, unit ? h('span', { class: 'ro-unit' }, unit) : null);
  return {
    root,
    set(value, { animate = false } = {}) {
      const next = fixedChars(value, { intDigits, decimals });
      tiles.forEach((tile, i) => {
        const c = next[i] ?? '';
        if (tile.textContent === c) return;
        tile.textContent = c;
        if (animate) tick(tile);
      });
    },
  };
}

// ------------------------------------------------------------------ controls
const decimalsOf = (step) => Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
const intDigitsOf = (min, max) => String(Math.floor(Math.max(Math.abs(min), Math.abs(max)))).length;

function rangeControl(def, api) {
  const id = idFor(def.path);
  const decimals = decimalsOf(def.step);
  const range = h('input', { type: 'range', id, min: def.min, max: def.max, step: def.step });
  const ro = createReadout({ intDigits: intDigitsOf(def.min, def.max), decimals, unit: def.unit });
  const root = h('div', { class: 'ctl ctl-range' }, h('label', { for: id }, def.label), range, ro.root);
  range.addEventListener('input', () => api.setParam(def.path, clamp(Number(range.value), def.min, def.max), { transient: true }));
  range.addEventListener('change', () => api.commit());
  return {
    root,
    sync(params) {
      const v = Number(get(params, def.path));
      if (range.value !== String(v)) range.value = String(v);
      ro.set(v, { animate: document.activeElement === range });
      range.setAttribute('aria-valuetext', `${fmt(v, decimals)} ${UNIT_WORDS[def.unit] ?? def.unit}`.trim());
      const enabled = def.when ? !!def.when(params) : true;
      range.disabled = !enabled;
      root.classList.toggle('is-disabled', !enabled);
    },
  };
}

function segmentedControl(def, api) {
  const name = idFor(def.path);
  const inputs = [];
  const seg = h(
    'fieldset',
    { class: 'seg' },
    h('legend', { class: 'visually-hidden' }, def.label),
    def.options.map(([value, label]) => {
      const input = h('input', { type: 'radio', name, value: String(value), id: `${name}-${value}` });
      input.addEventListener('change', () => {
        if (input.checked) api.setParam(def.path, def.numeric ? Number(value) : value);
      });
      inputs.push(input);
      return h('label', { class: 'seg-item' }, input, h('span', {}, label));
    }),
  );
  const root = h('div', { class: 'ctl ctl-stack' }, h('span', { class: 'ctl-label', 'aria-hidden': 'true' }, def.label), seg);
  return {
    root,
    sync(params) {
      const v = String(get(params, def.path));
      inputs.forEach((i) => (i.checked = i.value === v));
      const enabled = def.when ? !!def.when(params) : true;
      inputs.forEach((i) => (i.disabled = !enabled));
      root.classList.toggle('is-disabled', !enabled);
    },
  };
}

function toggleControl(def, api) {
  const id = idFor(def.path);
  const input = h('input', { type: 'checkbox', id });
  input.addEventListener('change', () => api.setParam(def.path, input.checked));
  const root = h(
    'div',
    { class: 'ctl ctl-toggle' },
    h('label', { for: id }, def.label),
    h('label', { class: 'toggle', for: id, 'aria-hidden': 'true' }, input, h('span', { class: 'toggle-track' })),
  );
  return {
    root,
    sync(params) {
      input.checked = !!get(params, def.path);
      const enabled = def.when ? !!def.when(params) : true;
      input.disabled = !enabled;
      root.classList.toggle('is-disabled', !enabled);
    },
  };
}

function hintControl(def) {
  const root = h('p', { class: 'hint ctl-note' });
  return {
    root,
    sync(params, info) {
      root.textContent = def.text(params, info);
    },
  };
}

const FACTORIES = { range: rangeControl, segmented: segmentedControl, toggle: toggleControl, hint: hintControl };

// ------------------------------------------------------------------ group cards
/**
 * Build the group cards from a schema into `container`. One card is open at a time; the open one
 * is remembered per browser. Returns { sync(params, info) }; `info` feeds the status lines.
 */
export function buildGroups(container, groupsDef, api, { storageKey, initial }) {
  const groups = [];
  const syncers = [];
  groupsDef.forEach((def) => {
    const bodyId = `lp-group-${def.id}`;
    const statusEl = h('span', { class: 'group-status' });
    const head = h(
      'button',
      { type: 'button', class: 'group-head', 'aria-expanded': 'false', 'aria-controls': bodyId },
      h('span', { class: 'group-title' }, def.title),
      statusEl,
      svg(CHEVRON),
    );
    const body = h('div', { class: 'group-body', id: bodyId, hidden: true });
    for (const c of def.controls) {
      const ctl = FACTORIES[c.type](c, api);
      body.append(ctl.root);
      syncers.push((p, info) => ctl.sync(p, info));
    }
    syncers.push((p, info) => (statusEl.textContent = def.status(p, info)));
    const card = h('div', { class: 'swatch swatch-white' }, h('span', { class: 'hole', 'aria-hidden': 'true' }), h('h3', {}, head), body);
    const el = h('section', { class: 'hanger group', dataset: { group: def.id } }, h('span', { class: 'peg', 'aria-hidden': 'true' }), card);
    head.addEventListener('click', () => open(def.id, head.getAttribute('aria-expanded') === 'true', true));
    groups.push({ id: def.id, el, head, body });
    container.append(el);
  });

  function open(id, collapse = false, reveal = false) {
    groups.forEach((g) => {
      const on = g.id === id && !collapse;
      g.el.classList.toggle('is-open', on);
      g.head.setAttribute('aria-expanded', on ? 'true' : 'false');
      g.body.hidden = !on;
      if (on && reveal && typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches) {
        g.head.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    });
    try {
      localStorage.setItem(storageKey, collapse ? '' : id);
    } catch {
      /* storage unavailable */
    }
  }

  let first = initial;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === '' || groups.some((g) => g.id === saved)) first = saved;
  } catch {
    /* storage unavailable */
  }
  if (first) open(first);

  return { sync: (p, info) => syncers.forEach((fn) => fn(p, info)), open };
}
