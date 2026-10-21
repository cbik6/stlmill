// The rail: wires the authored header card (character-cap/index.html), builds the
// five group cards (Underside, Socket, Face, Body, Finish) from a declarative
// schema, and binds everything to state.js. Same components as the Clicker's rail:
// every numeric control is a <label> + range + fixed-digit readout that never reflows.

import { state, subscribe, update, commit, setParam, undo, redo, reset, canUndo, canRedo } from './state.js';
import { SAMPLES } from './samples/index.js';
import { FACE_SAMPLES, MAX_UPLOAD_BYTES } from './session.js';

// ------------------------------------------------------------------ helpers
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, val);
        else el.style[p] = val;
      }
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Parse one authored inline SVG string into an element. */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

// Authored chevron for the group headers: 2 px stroke, round caps.
const CHEVRON =
  '<svg class="group-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6l5 5 5-5"/></svg>';

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const idFor = (path) => `cc-${path.replace(/\./g, '-')}`;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Trim a number for prose: 36 -> "36", 21.5 -> "21.5". */
export const fmt = (n, d = 1) => Number(n).toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');

const UNIT_WORDS = { mm: 'millimetres', '%': 'percent', '°': 'degrees', '': '' };

// ------------------------------------------------------------------ readouts
// Vertical tick on a single tile. Transform only, so nothing reflows.
function tick(el, delay = 0) {
  if (reducedMotion() || typeof el.animate !== 'function') return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate(
    [
      { transform: 'translateY(0)' },
      { transform: 'translateY(-5px)', offset: 0.45 },
      { transform: 'translateY(0)' },
    ],
    { duration: 120, delay, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  );
}

// A sync pass that comes from a bulk change (load, reset, undo, redo) cascades
// the changed tiles one at a time, 60 ms apart, across the whole rail.
const CASCADE_STEP = 60;
let cascadeSlot = 0;
export const beginCascade = () => {
  cascadeSlot = 0;
};

/** Fixed-width characters for a value: zero-padded integer part, fixed decimals, optional sign tile. */
export function fixedChars(value, { intDigits = 2, decimals = 0, signed = false } = {}) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  const abs = Math.abs(v).toFixed(decimals);
  const [i, d] = abs.split('.');
  let s = i.padStart(intDigits, '0') + (d ? '.' + d : '');
  if (signed) s = (v < 0 && Number(abs) !== 0 ? '−' : '+') + s;
  return s.split('');
}

/**
 * A readout of ink tiles: one per character, narrow for the decimal point.
 * set(value, { cascade }) updates the tiles; changed tiles tick (or cascade).
 */
export function createReadout({ intDigits = 2, decimals = 0, signed = false, unit = '' } = {}) {
  const chars = fixedChars(0, { intDigits, decimals, signed });
  const tiles = chars.map((c) => h('span', { class: c === '.' ? 'tile tile-narrow' : 'tile' }, c));
  const root = h('span', { class: 'ro', 'aria-hidden': 'true' }, tiles, unit ? h('span', { class: 'ro-unit' }, unit) : null);
  let timers = [];

  function set(value, { cascade = false } = {}) {
    timers.forEach(clearTimeout);
    timers = [];
    const next = fixedChars(value, { intDigits, decimals, signed });
    const visible = cascade && !reducedMotion() && root.offsetParent !== null;
    tiles.forEach((tile, i) => {
      const c = next[i] ?? '';
      if (tile.textContent === c) return;
      if (visible) {
        const delay = cascadeSlot++ * CASCADE_STEP;
        timers.push(
          setTimeout(() => {
            tile.textContent = c;
            tick(tile);
          }, delay),
        );
      } else {
        tile.textContent = c; // ordinary changes swap in place: only the cascade moves
      }
    });
  }

  return { root, set };
}

// ------------------------------------------------------------------ control schema
const SOCKET_LABELS = { tapered: 'Tapered', cross: 'Straight', round: 'Round' };

const COLOR_PRESETS = {
  'colors.cap': ['#f07a2a', '#f2efe9', '#2b2b2b', '#7a1f1f', '#2e5d34', '#cdb4db'],
  'colors.face': ['#2b2b2b', '#f2efe9', '#f07a2a', '#ffd166', '#1fa39a', '#e63946'],
  'colors.body': ['#2b2b2b', '#f2efe9', '#f07a2a', '#1fa39a', '#7a1f1f', '#2e5d34'],
};

/** Does the face source describe anything to cut? (The status lines and colour count read this.) */
export function faceHasContent(face) {
  if (!face) return false;
  if (face.kind === 'text') return !!String(face.text?.text ?? '').trim();
  if (face.kind === 'svg') return !!String(face.svg?.svgText ?? '').trim();
  return face.kind === 'sample';
}

// Adding a parameter = adding one entry to a group's `controls` list.
export const GROUPS = [
  {
    id: 'underside',
    title: 'Underside',
    status: (s, a) => {
      const p = s.params;
      const base = p.underside === 'hollow' ? `Hollow · ${fmt(p.wallThickness)} mm wall` : p.flatHeight > 0 ? `Flat · cut ${fmt(p.flatHeight)} mm` : 'Flat';
      return a?.foot ? `${base} · foot` : base;
    },
    controls: [
      {
        type: 'segmented',
        path: 'underside',
        label: 'Underside',
        options: [
          ['flat', 'Flat'],
          ['hollow', 'Hollow'],
        ],
      },
      // Flat: slice this much off the bottom so the character rests on a wider footprint.
      { type: 'range', path: 'flatHeight', label: 'Cut off', unit: 'mm', min: 0, max: 10, step: 0.5, when: (p) => p.underside === 'flat' },
      { type: 'range', path: 'wallThickness', label: 'Wall', unit: 'mm', min: 1.2, max: 3, step: 0.1, when: (p) => p.underside === 'hollow' },
      { type: 'range', path: 'hollowDepth', label: 'Hollow depth', unit: 'mm', min: 3, max: 12, step: 0.5, when: (p) => p.underside === 'hollow' },
      // The cap presses `travel` mm down over the switch housing; a character too narrow down there gets a foot plinth.
      { type: 'range', path: 'travel', label: 'Travel', unit: 'mm', min: 3.5, max: 5, step: 0.1 },
      {
        type: 'segmented',
        path: 'foot',
        label: 'Foot',
        options: [
          ['auto', 'Auto'],
          ['always', 'Always'],
          ['never', 'Never'],
        ],
        hint: 'Adds a flat base when the character is too narrow for the switch.',
      },
    ],
  },
  {
    id: 'socket',
    title: 'Socket',
    status: (s) => `${SOCKET_LABELS[s.params.socket.mode] || s.params.socket.mode} · ${fmt(s.params.socket.depth)} mm deep`,
    controls: [
      // Tapered enters loose and wedges near the ceiling; Straight is the stem's own size; Round is a glue fit.
      {
        type: 'segmented',
        path: 'socket.mode',
        label: 'Socket',
        options: [
          ['tapered', 'Tapered'],
          ['cross', 'Straight'],
          ['round', 'Round'],
        ],
      },
      { type: 'range', path: 'socket.opening', label: 'Opening', unit: 'mm', min: 4.2, max: 5.2, step: 0.1, when: (p) => p.socket.mode === 'tapered' },
      { type: 'range', path: 'socket.roundDiameter', label: 'Hole Ø', unit: 'mm', min: 4.6, max: 5.8, step: 0.1, when: (p) => p.socket.mode === 'round' },
      { type: 'range', path: 'socket.depth', label: 'Depth', unit: 'mm', min: 3, max: 5, step: 0.1 },
      { type: 'range', path: 'socket.bossDiameter', label: 'Boss Ø', unit: 'mm', min: 5.4, max: 8, step: 0.1, hint: 'Must fit inside the switch’s stem collar.' },
      { type: 'range', path: 'socket.bossWall', label: 'Boss wall', unit: 'mm', min: 0.6, max: 3, step: 0.1 },
      { type: 'range', path: 'socket.fit', label: 'Fit', unit: 'mm', min: -0.2, max: 0.2, step: 0.05, signed: true, hint: 'Minus grips tighter, plus goes on easier.' },
    ],
  },
  {
    id: 'face',
    title: 'Face',
    status: (s, a) => {
      if (!faceHasContent(s.source.face)) return 'No face';
      const base = `${s.params.face.direction === 'top' ? 'Top' : 'Front'} · ${fmt(s.params.face.width)} %`;
      const n = a?.face?.pieces;
      return Number.isFinite(n) ? `${base} · ${n} ${n === 1 ? 'piece' : 'pieces'}` : base;
    },
    controls: [
      { type: 'face-source' },
      {
        type: 'segmented',
        path: 'face.direction',
        label: 'Projected onto',
        options: [
          ['front', 'Front'],
          ['top', 'Top'],
        ],
      },
      { type: 'range', path: 'face.width', label: 'Width', unit: '%', min: 20, max: 90, step: 1 },
      { type: 'range', path: 'face.depth', label: 'Depth', unit: 'mm', min: 0.4, max: 1.5, step: 0.1 },
      { type: 'range', path: 'face.offset.x', label: 'Shift ←→', unit: 'mm', min: -10, max: 10, step: 0.5, signed: true },
      { type: 'range', path: 'face.offset.y', label: 'Shift ↑↓', unit: 'mm', min: -10, max: 10, step: 0.5, signed: true },
      {
        type: 'segmented',
        path: 'face.method',
        label: 'Inlay',
        options: [
          ['cone', 'Cone'],
          ['axis', 'Axis'],
        ],
        hint: 'Cone keeps the inlay to the skin that faces you; Axis projects straight through.',
      },
      // 0 = automatic in the engine: max(3 × depth, 30 % of the design's width). The tiles show the resolved mm.
      {
        type: 'range',
        path: 'face.maxDepth',
        label: 'Max depth',
        unit: 'mm',
        min: 1,
        max: 12,
        step: 0.5,
        auto: { value: 0, resolve: (p, a) => (Number.isFinite(a?.face?.behind) ? a.face.behind : Math.max(3 * p.face.depth, 0.3 * (p.face.width / 100) * p.width)) },
      },
    ],
  },
  {
    id: 'body',
    title: 'Body',
    status: (s) => {
      const p = s.params;
      if (!p.withBody) return 'Body off';
      return `${fmt(p.body.height)} mm · ${p.body.size > 0 ? `${fmt(p.body.size)} mm round` : 'fits the footprint'}`;
    },
    controls: [
      { type: 'toggle', path: 'withBody', label: 'Switch body under the cap' },
      { type: 'range', path: 'body.height', label: 'Height', unit: 'mm', min: 14, max: 30, step: 0.5, when: (p) => p.withBody },
      { type: 'range', path: 'body.rimHeight', label: 'Rim', unit: 'mm', min: 0, max: 16, step: 0.1, when: (p) => p.withBody },
      { type: 'range', path: 'body.wall', label: 'Wall', unit: 'mm', min: 1.6, max: 4, step: 0.1, when: (p) => p.withBody },
      { type: 'range', path: 'body.size', label: 'Size', unit: 'mm', min: 0, max: 60, step: 1, when: (p) => p.withBody, hint: 'At 0 the body follows the character’s footprint; above that it is a round of this diameter.' },
    ],
  },
  {
    id: 'finish',
    title: 'Finish',
    status: (s) => {
      const n = 1 + (faceHasContent(s.source.face) ? 1 : 0) + (s.params.withBody ? 1 : 0);
      return `${n} ${n === 1 ? 'colour' : 'colours'}`;
    },
    controls: [
      { type: 'color', path: 'colors.cap', label: 'Character' },
      { type: 'color', path: 'colors.face', label: 'Face', when: (p, s) => faceHasContent(s.source.face) },
      { type: 'color', path: 'colors.body', label: 'Body', when: (p) => p.withBody },
    ],
  },
];

// ------------------------------------------------------------------ control factories
const decimalsOf = (step) => Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
const intDigitsOf = (min, max) => String(Math.floor(Math.max(Math.abs(min), Math.abs(max)))).length;
const enabledFor = (def, s) => (def.when ? !!def.when(s.params, s) : true);

const isNum = (v) => Number.isFinite(Number(v)) && v !== '' && v !== null;

export function rangeControl(def, { onInput, onChange, read } = {}) {
  const id = def.id || idFor(def.path);
  const decimals = decimalsOf(def.step);
  const range = h('input', { type: 'range', id, min: def.min, max: def.max, step: def.step });
  const ro = createReadout({ intDigits: intDigitsOf(def.min, def.max), decimals, signed: !!def.signed, unit: def.unit });
  const label = h('label', { for: id }, def.label);

  // 'auto' rows: the engine derives the value when the param holds the sentinel (`def.auto.value`,
  // e.g. 0 or 'auto'). While automatic the label reads "Max depth · auto" and the tiles show the
  // resolved value dimmed (the disabled-tile style); dragging the slider pins a number, and a quiet
  // "Auto" text button in the label cell hands the value back to the engine.
  let isAuto = false;
  let resolved = def.min; // last resolved value
  let shown = resolved;
  let lastState = null;
  let lastAssembly = null;
  let autoNote = null;
  let autoBtn = null;
  if (def.auto) {
    autoNote = h('span', { class: 'ctl-auto-note' }, '· auto');
    label.append(' ', autoNote); // the space stays outside the nowrap span so a narrow cell breaks as "Max depth" / "· auto"
    autoBtn = h('button', { type: 'button', class: 'ctl-quiet', title: 'Let the engine choose this value' }, 'Auto');
    autoBtn.addEventListener('click', () => setParam(def.path, def.auto.value));
  }
  const labelCell = autoBtn ? h('div', { class: 'ctl-labelwrap' }, label, autoBtn) : label;
  const root = h(
    'div',
    { class: autoBtn ? 'ctl ctl-range ctl-auto' : 'ctl ctl-range' },
    labelCell,
    range,
    ro.root,
    def.hint ? h('span', { class: 'ctl-hint' }, def.hint) : null,
  );

  function show(v, { cascade = false } = {}) {
    shown = isNum(v) ? clamp(Number(v), def.min, def.max) : resolved;
    if (range.value !== String(shown)) range.value = String(shown);
    ro.set(shown, { cascade });
    range.setAttribute('aria-valuetext', `${fmt(shown, decimals)} ${UNIT_WORDS[def.unit] ?? def.unit}${isAuto ? ', automatic' : ''}`.trim());
  }

  function resolve() {
    if (!def.auto || !lastState) return;
    const r = def.auto.resolve(lastState.params, lastAssembly);
    if (isNum(r)) resolved = Number(r);
  }

  range.addEventListener('input', () => {
    const v = clamp(Number(range.value), def.min, def.max);
    if (onInput) onInput(v);
    else setParam(def.path, v, { transient: true, reason: 'slider' });
  });
  range.addEventListener('change', () => (onChange ? onChange() : commit()));

  return {
    root,
    sync(s, meta) {
      const v = read ? read(s) : get(s.params, def.path);
      if (v === undefined) return;
      lastState = s;
      isAuto = !!def.auto && (v === def.auto.value || !isNum(v));
      root.classList.toggle('is-auto', isAuto);
      if (autoNote) autoNote.hidden = !isAuto;
      if (autoBtn) autoBtn.hidden = isAuto;
      if (isAuto) resolve();
      show(isAuto ? resolved : v, { cascade: !!meta?.cascade });
      const enabled = enabledFor(def, s);
      range.disabled = !enabled;
      root.classList.toggle('is-disabled', !enabled);
    },
    setAssembly(assembly) {
      if (!def.auto) return;
      lastAssembly = assembly;
      resolve();
      if (isAuto) show(resolved);
    },
  };
}

function segmentedControl(def) {
  const name = idFor(def.path);
  const inputs = [];
  const seg = h(
    'fieldset',
    { class: 'seg' },
    h('legend', { class: 'visually-hidden' }, def.label),
    def.options.map(([value, label]) => {
      const input = h('input', { type: 'radio', name, value, id: `${name}-${value}` });
      input.addEventListener('change', () => {
        if (input.checked) setParam(def.path, value);
      });
      inputs.push(input);
      return h('label', { class: 'seg-item' }, input, h('span', {}, label));
    }),
  );
  const root = h(
    'div',
    { class: 'ctl ctl-stack' },
    h('span', { class: 'ctl-label', 'aria-hidden': 'true' }, def.label),
    seg,
    def.hint ? h('span', { class: 'ctl-hint' }, def.hint) : null,
  );
  return {
    root,
    sync(s) {
      const v = get(s.params, def.path);
      inputs.forEach((i) => (i.checked = i.value === v));
      const enabled = enabledFor(def, s);
      inputs.forEach((i) => (i.disabled = !enabled));
      root.classList.toggle('is-disabled', !enabled);
    },
  };
}

function toggleControl(def) {
  const id = idFor(def.path);
  const input = h('input', { type: 'checkbox', id });
  input.addEventListener('change', () => setParam(def.path, input.checked));
  const root = h(
    'div',
    { class: 'ctl ctl-toggle' },
    h('label', { for: id }, def.label),
    h('label', { class: 'toggle', for: id, 'aria-hidden': 'true' }, input, h('span', { class: 'toggle-track' })),
  );
  return {
    root,
    sync(s) {
      input.checked = !!get(s.params, def.path);
      const enabled = enabledFor(def, s);
      input.disabled = !enabled;
      root.classList.toggle('is-disabled', !enabled);
    },
  };
}

function colorControl(def) {
  const id = idFor(def.path);
  const input = h('input', { type: 'color', id });
  input.addEventListener('input', () => setParam(def.path, input.value, { transient: true, reason: 'color' }));
  input.addEventListener('change', () => {
    setParam(def.path, input.value, { transient: true, reason: 'color' });
    commit();
  });
  const chips = (COLOR_PRESETS[def.path] || []).map((c) => {
    const b = h('button', {
      type: 'button',
      class: 'chip',
      style: { '--chip': c },
      'aria-label': `${def.label} ${c}`,
      'aria-pressed': 'false',
      title: c,
      dataset: { color: c },
    });
    b.addEventListener('click', () => setParam(def.path, c));
    return b;
  });
  const root = h('div', { class: 'ctl ctl-color' }, h('label', { for: id }, def.label), input, h('div', { class: 'chips' }, chips));
  return {
    root,
    sync(s) {
      const v = String(get(s.params, def.path) || '#000000').toLowerCase();
      if (document.activeElement !== input && input.value !== v) input.value = v;
      chips.forEach((c) => c.setAttribute('aria-pressed', c.dataset.color === v ? 'true' : 'false'));
      const enabled = enabledFor(def, s);
      input.disabled = !enabled;
      chips.forEach((c) => (c.disabled = !enabled));
      root.classList.toggle('is-disabled', !enabled);
    },
  };
}

// ------------------------------------------------------------------ files
const readFileAsText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error || new Error('Could not read the file.'));
    r.readAsText(file);
  });

const readFileAsArrayBuffer = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('Could not read the file.'));
    r.readAsArrayBuffer(file);
  });

const extOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();

/** Wire a drop zone (a <label> wrapping a file input) to a handler that may throw a user-facing Error. */
function wireDropZone(zone, input, errorEl, onFile) {
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  };
  const handle = (file) => {
    if (!file) return;
    showError('');
    Promise.resolve()
      .then(() => onFile(file))
      .catch((err) => showError(err?.message || String(err)));
  };
  input.addEventListener('change', () => {
    handle(input.files?.[0]);
    input.value = '';
  });
  for (const ev of ['dragenter', 'dragover']) {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('is-over');
    });
  }
  for (const ev of ['dragleave', 'drop']) {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
    });
  }
  zone.addEventListener('drop', (e) => handle(e.dataTransfer?.files?.[0]));
  return { showError };
}

// ------------------------------------------------------------------ the face editor (inside the Face card)
// Text / SVG / Samples, the same editors as the Clicker's header card, bound to state.source.face.
const FONTS = ['Barlow Semi Condensed', 'Arial', 'Impact', 'Georgia', 'Verdana', 'Courier New', 'Trebuchet MS'];

function faceSourceControl() {
  const kinds = [
    ['text', 'Text'],
    ['svg', 'SVG'],
    ['sample', 'Samples'],
  ];
  const kindInputs = [];
  const seg = h(
    'fieldset',
    { class: 'seg' },
    h('legend', { class: 'visually-hidden' }, 'Where the face comes from'),
    kinds.map(([value, label]) => {
      const input = h('input', { type: 'radio', name: 'cc-face-kind', value, id: `cc-face-kind-${value}` });
      input.addEventListener('change', () => {
        if (input.checked) update({ source: { face: { kind: value } } }, { reason: 'face-kind' });
      });
      kindInputs.push(input);
      return h('label', { class: 'seg-item' }, input, h('span', {}, label));
    }),
  );

  // --- Text
  const text = h('input', {
    class: 'field-input',
    id: 'cc-face-text',
    type: 'text',
    maxlength: '20',
    placeholder: 'Your text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'aria-label': 'Text on the face',
  });
  const font = h(
    'select',
    { id: 'cc-face-font', 'aria-label': 'Typeface' },
    FONTS.map((f) => h('option', { value: f, style: { fontFamily: /\s/.test(f) ? `"${f}"` : f } }, f)),
  );
  const bold = h('input', { type: 'checkbox', id: 'cc-face-bold' });
  text.addEventListener('input', () => update({ source: { face: { kind: 'text', text: { text: text.value } } } }, { transient: true, reason: 'text' }));
  text.addEventListener('change', () => commit());
  font.addEventListener('change', () => update({ source: { face: { text: { fontFamily: font.value } } } }, { reason: 'font' }));
  bold.addEventListener('change', () => update({ source: { face: { text: { bold: bold.checked } } } }, { reason: 'bold' }));
  const textPane = h(
    'div',
    { class: 'source-pane', dataset: { kind: 'text' } },
    text,
    h('div', { class: 'head-row' }, font, h('label', { class: 'toggle', for: 'cc-face-bold' }, bold, h('span', { class: 'toggle-track', 'aria-hidden': 'true' }), 'Bold')),
  );

  // --- SVG
  const svgInput = h('input', { type: 'file', id: 'cc-face-svg-file', accept: '.svg,image/svg+xml' });
  const svgZone = h(
    'label',
    { class: 'dropzone', id: 'cc-face-svg-zone', for: 'cc-face-svg-file' },
    h('span', { class: 'drop-label' }, 'Drop an SVG here, or ', h('u', {}, 'browse')),
    h('span', { class: 'drop-hint' }, 'Filled shapes become the face'),
    svgInput,
  );
  const svgName = h('span', { class: 'file-name', hidden: true });
  const svgError = h('span', { class: 'hint hint-error', role: 'alert', hidden: true });
  const svgText = h('textarea', { id: 'cc-face-svg-text', rows: '3', spellcheck: 'false', placeholder: '<svg …>', 'aria-label': 'SVG markup' });
  wireDropZone(svgZone, svgInput, svgError, async (file) => {
    const ext = extOf(file.name);
    if (ext !== 'svg' && file.type !== 'image/svg+xml') throw new Error(`“${file.name}” is not an .svg file.`);
    const markup = await readFileAsText(file);
    if (!/<svg[\s>]/i.test(markup)) throw new Error(`“${file.name}” has no <svg> element inside.`);
    update({ source: { face: { kind: 'svg', svg: { svgText: markup, fileName: file.name } } } }, { reason: 'svg-file' });
  });
  svgText.addEventListener('input', () =>
    update({ source: { face: { kind: 'svg', svg: { svgText: svgText.value, fileName: '' } } } }, { transient: true, reason: 'svg-text' }),
  );
  svgText.addEventListener('change', () => commit());
  const svgPane = h(
    'div',
    { class: 'source-pane', dataset: { kind: 'svg' }, hidden: true },
    svgZone,
    svgName,
    svgError,
    h('div', { style: { marginTop: '10px' } }, h('label', { class: 'ctl-label', for: 'cc-face-svg-text' }, 'Or paste SVG markup'), svgText),
  );

  // --- Samples
  const sampleButtons = FACE_SAMPLES.map((s) => {
    const b = h('button', { type: 'button', class: 'sample', 'aria-label': s.label, 'aria-pressed': 'false', title: s.label, dataset: { id: s.id } });
    b.innerHTML = s.svgText;
    b.querySelector('svg')?.setAttribute('aria-hidden', 'true');
    b.addEventListener('click', () => update({ source: { face: { kind: 'sample', sample: { id: s.id } } } }, { reason: 'face-sample' }));
    return b;
  });
  const samplePane = h(
    'div',
    { class: 'source-pane', dataset: { kind: 'sample' }, hidden: true },
    h('div', { class: 'samples', role: 'group', 'aria-label': 'Face samples' }, sampleButtons),
  );

  const emptyHint = h('span', { class: 'hint hint-empty', hidden: true });
  const panes = [textPane, svgPane, samplePane];
  const root = h('div', { class: 'ctl ctl-stack face-editor' }, h('span', { class: 'ctl-label', 'aria-hidden': 'true' }, 'Design'), seg, ...panes, emptyHint);
  const fieldFont = (fam) => (/[\s"']/.test(fam) ? `"${fam}", ${getComputedStyle(document.documentElement).getPropertyValue('--font-display')}` : fam);

  return {
    root,
    sync(s) {
      const f = s.source.face;
      kindInputs.forEach((i) => (i.checked = i.value === f.kind));
      panes.forEach((p) => (p.hidden = p.dataset.kind !== f.kind));

      if (document.activeElement !== text) text.value = f.text.text ?? '';
      font.value = f.text.fontFamily;
      if (font.value !== f.text.fontFamily) font.selectedIndex = 1; // unknown family in a loaded project: show Arial
      text.style.fontFamily = fieldFont(f.text.fontFamily);
      text.style.fontWeight = f.text.bold ? '800' : '400';
      bold.checked = !!f.text.bold;

      if (document.activeElement !== svgText) svgText.value = f.svg.svgText || '';
      svgName.textContent = f.svg.fileName ? `Loaded ${f.svg.fileName}` : '';
      svgName.hidden = !f.svg.fileName;

      sampleButtons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === f.sample.id ? 'true' : 'false'));

      const hint = faceHasContent(f)
        ? ''
        : { text: 'No face yet. Type up to 20 characters above.', svg: 'No face yet. Drop an SVG, or paste its markup.' }[f.kind] || '';
      emptyHint.textContent = hint;
      emptyHint.hidden = !hint;
    },
  };
}

const FACTORIES = { range: rangeControl, segmented: segmentedControl, toggle: toggleControl, color: colorControl, 'face-source': faceSourceControl };

// ------------------------------------------------------------------ header card (authored in HTML)
export const uploadToken = (file) => `${file.name}:${file.size}:${file.lastModified}`;

/**
 * @param rail the <aside>
 * @param hooks.onUpload(file, token, buffer, type) called after a mesh file passed the quick checks
 */
function wireHeader(rail, hooks) {
  const q = (sel) => rail.querySelector(sel);
  const kindInputs = [...rail.querySelectorAll('#cc-source-kind input')];
  const panes = [...rail.querySelectorAll('.head-card .source-pane')];

  kindInputs.forEach((input) =>
    input.addEventListener('change', () => {
      if (input.checked) update({ source: { kind: input.value } }, { reason: 'source-kind' });
    }),
  );

  // --- Built-in characters: tiles with a thumbnail canvas each (main.js paints them)
  const charactersEl = q('#cc-characters');
  const tiles = SAMPLES.map((s) => {
    const b = h(
      'button',
      { type: 'button', class: 'character', 'aria-pressed': 'false', title: s.label, dataset: { id: s.id } },
      h('span', { class: 'character-art', 'aria-hidden': 'true' }, h('canvas', { width: 96, height: 96, dataset: { tone: 'ink' } }), h('canvas', { width: 96, height: 96, dataset: { tone: 'lit' } })),
      h('span', { class: 'character-name' }, s.label),
    );
    b.addEventListener('click', () => {
      // A character comes with the side its face reads best from; one undo step for both.
      update({ source: { kind: 'sample', sample: { id: s.id } }, params: { face: { direction: s.faceDirection } } }, { reason: 'character' });
    });
    return b;
  });
  charactersEl.replaceChildren(...tiles);

  // --- Upload
  const uploadName = q('#cc-upload-name');
  const uploadError = q('#cc-upload-error');
  const zone = wireDropZone(q('#cc-upload-zone'), q('#cc-upload-file'), uploadError, async (file) => {
    const ext = extOf(file.name);
    if (!['stl', '3mf', 'obj'].includes(ext)) {
      if (ext === 'svg' || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
        throw new Error(`“${file.name}” is a picture. A character is a solid: drop an .stl, .3mf or .obj here, and put pictures on the Face card.`);
      }
      throw new Error(`“${file.name}” is not an .stl, .3mf or .obj file.`);
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(`“${file.name}” is over 15 MB. Export it with fewer triangles and drop it again.`);
    const buffer = await readFileAsArrayBuffer(file);
    const token = uploadToken(file);
    hooks.onUpload?.(file, token, buffer, ext);
    update({ source: { kind: 'upload', upload: { name: file.name, type: ext, token } } }, { reason: 'upload' });
  });

  // --- Width (shared by both panes)
  const width = rangeControl({ path: 'width', label: 'Width', unit: 'mm', min: 20, max: 60, step: 0.5, id: 'cc-width' });
  q('#cc-width-slot').replaceWith(width.root);

  // The file line says what happened to the file: "Loaded x" once it built, "Refused x" when the
  // engine turned it down (never both at once).
  let refusedName = '';
  function syncUploadName() {
    const name = state.source.upload.name;
    uploadName.textContent = name ? `${name === refusedName ? 'Refused' : 'Loaded'} ${name}` : '';
    uploadName.hidden = !name;
  }

  return {
    sync(s, meta) {
      const src = s.source;
      kindInputs.forEach((i) => (i.checked = i.value === src.kind));
      panes.forEach((p) => (p.hidden = p.dataset.kind !== src.kind));
      tiles.forEach((b) => b.setAttribute('aria-pressed', src.kind === 'sample' && b.dataset.id === src.sample.id ? 'true' : 'false'));
      syncUploadName();
      width.sync(s, meta);
    },
    /** Show (or clear) the engine's verdict on the uploaded mesh, plainly, on the card. */
    setUploadError(msg) {
      zone.showError(msg || '');
      refusedName = msg ? state.source.upload.name : '';
      syncUploadName();
    },
    tiles,
  };
}

// ------------------------------------------------------------------ group cards
const STORAGE_KEY = 'stlmill-character-cap-group';

function buildGroups(container) {
  const groups = [];
  const syncers = [];
  const statuses = [];
  const controls = [];
  let lastAssembly = null; // from the last build: feeds "· foot", "· 1 piece" and the auto rows

  GROUPS.forEach((def) => {
    const bodyId = `cc-group-${def.id}`;
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
      const ctl = FACTORIES[c.type](c);
      body.append(ctl.root);
      controls.push(ctl);
      syncers.push((s, meta) => ctl.sync(s, meta));
    }
    const status = () => {
      statusEl.textContent = def.status(state, lastAssembly);
    };
    statuses.push(status);
    syncers.push(status);

    const card = h('div', { class: 'swatch swatch-white' }, h('span', { class: 'hole', 'aria-hidden': 'true' }), h('h3', {}, head), body);
    const el = h('section', { class: 'hanger group', dataset: { group: def.id } }, h('span', { class: 'peg', 'aria-hidden': 'true' }), card);
    head.addEventListener('click', () => open(def.id, head.getAttribute('aria-expanded') === 'true', { reveal: true }));
    groups.push({ id: def.id, el, head, body });
    container.append(el);
  });

  function open(id, collapse = false, { reveal = false } = {}) {
    groups.forEach((g) => {
      const on = g.id === id && !collapse;
      g.el.classList.toggle('is-open', on);
      g.head.setAttribute('aria-expanded', on ? 'true' : 'false');
      g.body.hidden = !on;
      // Under the sticky bench on a phone the opened card must not unfold out of sight;
      // scroll-margin-top (charcap.css) keeps the header clear of the bench.
      if (on && reveal && typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches) {
        g.head.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    });
    try {
      localStorage.setItem(STORAGE_KEY, collapse ? '' : id);
    } catch {
      /* storage unavailable */
    }
  }

  let initial = 'face';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === '' || groups.some((g) => g.id === saved)) initial = saved;
  } catch {
    /* storage unavailable */
  }
  if (initial) open(initial);

  return {
    open,
    sync: (s, meta) => syncers.forEach((fn) => fn(s, meta)),
    setAssembly(assembly) {
      lastAssembly = assembly || null;
      controls.forEach((c) => c.setAssembly?.(lastAssembly));
      statuses.forEach((fn) => fn());
    },
  };
}

// ------------------------------------------------------------------ foot pins
function wireFoot(rail) {
  const undoBtn = rail.querySelector('#cc-undo');
  const redoBtn = rail.querySelector('#cc-redo');
  const resetBtn = rail.querySelector('#cc-reset');
  undoBtn.addEventListener('click', () => undo());
  redoBtn.addEventListener('click', () => redo());
  resetBtn.addEventListener('click', () => reset());
  return {
    sync() {
      undoBtn.disabled = !canUndo();
      redoBtn.disabled = !canRedo();
    },
  };
}

// ------------------------------------------------------------------ the rail
const CASCADE_REASONS = new Set(['load', 'reset', 'undo', 'redo', 'replace']);

/**
 * Wire the whole left column. Returns { setUploadError(msg), setAssembly(assembly), openGroup(id), tiles }.
 */
export function initRail(rail, hooks = {}) {
  const header = wireHeader(rail, hooks);
  const groups = buildGroups(rail.querySelector('#cc-groups'));
  const foot = wireFoot(rail);

  function sync(s, meta) {
    const m = { ...(meta || {}), cascade: !!meta && !meta.transient && CASCADE_REASONS.has(meta.reason) };
    beginCascade();
    header.sync(s, m);
    groups.sync(s, m);
    foot.sync();
  }
  subscribe(sync);
  sync(state, null);

  return {
    setUploadError: (msg) => header.setUploadError(msg),
    // The last build's assembly (foot, face pieces, resolved auto values) feeds status lines and auto rows.
    setAssembly: (assembly) => groups.setAssembly(assembly),
    openGroup: (id) => groups.open(id),
    tiles: header.tiles,
  };
}
