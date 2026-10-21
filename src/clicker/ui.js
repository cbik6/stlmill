// The rail: wires the authored header card (clicker/index.html), builds the
// three group cards (Footprint, Switch & fit, Finish) from a declarative
// schema, and binds everything to state.js. Every numeric control is a
// <label> + range + fixed-digit readout; the readout never reflows.

import { state, subscribe, update, commit, setParam, undo, redo, reset, canUndo, canRedo } from './state.js';

// ------------------------------------------------------------------ samples
const SAMPLE_FILES = import.meta.glob('./samples/*.svg', { query: '?raw', import: 'default', eager: true });
const SAMPLE_ORDER = ['heart', 'star', 'bolt', 'paw', 'smiley'];
const SAMPLE_LABELS = { heart: 'Heart', paw: 'Paw', star: 'Star', bolt: 'Bolt', smiley: 'Smiley' };

export const SAMPLES = Object.entries(SAMPLE_FILES)
  .map(([path, svgText]) => {
    const id = path.replace(/^.*\//, '').replace(/\.svg$/, '');
    return { id, label: SAMPLE_LABELS[id] || id, svgText };
  })
  .sort((a, b) => {
    const ia = SAMPLE_ORDER.indexOf(a.id);
    const ib = SAMPLE_ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

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
const idFor = (path) => `ck-${path.replace(/\./g, '-')}`;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Trim a number for prose: 35 -> "35", 21.5 -> "21.5". */
export const fmt = (n, d = 1) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : '\u2014';
const fixed1 = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(1) : '\u2014');

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
const STYLE_LABELS = { outline: 'Outline', circle: 'Circle', square: 'Square', hexagon: 'Hexagon' };

const COLOR_PRESETS = {
  'colors.body': ['#2b2b2b', '#f2efe9', '#f07a2a', '#1fa39a', '#7a1f1f', '#2e5d34'],
  'colors.cap': ['#f5f5f5', '#2b2b2b', '#f07a2a', '#ffd166', '#1fa39a', '#cdb4db'],
  'colors.design': ['#f07a2a', '#1c1b19', '#f2efe9', '#e63946', '#1fa39a', '#ffbe0b'],
};

// Adding a parameter = adding one entry to a group's `controls` list.
export const GROUPS = [
  {
    id: 'footprint',
    title: 'Footprint',
    status: (s) => `${STYLE_LABELS[s.params.base.style] || s.params.base.style} · ${fmt(s.params.base.size)} mm`,
    controls: [
      {
        type: 'segmented',
        path: 'base.style',
        label: 'Style',
        options: [
          ['outline', 'Outline'],
          ['circle', 'Circle'],
          ['square', 'Square'],
          ['hexagon', 'Hex'],
        ],
      },
      { type: 'range', path: 'base.size', label: 'Size', unit: 'mm', min: 20, max: 60, step: 0.5 },
      { type: 'range', path: 'design.fill', label: 'Fill', unit: '%', min: 40, max: 100, step: 1 },
      { type: 'range', path: 'base.margin', label: 'Margin', unit: 'mm', min: 1, max: 6, step: 0.1, when: (p) => p.base.style === 'outline' },
      { type: 'range', path: 'base.cornerRadius', label: 'Corner radius', unit: 'mm', min: 0, max: 10, step: 0.5, when: (p) => p.base.style === 'square' },
      { type: 'range', path: 'design.rotation', label: 'Rotation', unit: '°', min: -180, max: 180, step: 1, signed: true },
    ],
  },
  {
    id: 'fit',
    title: 'Switch & fit',
    status: (s) => `MX · ${fixed1(s.params.switch.cutout)} / ${fixed1(s.params.switch.cavity)}`,
    controls: [
      // 'auto' lets the engine derive the height from the cavity; the resolved value comes back in assembly.bodyHeight.
      { type: 'range', path: 'body.height', label: 'Body height', unit: 'mm', min: 14, max: 30, step: 0.5, auto: 'bodyHeight', fallback: 18.5 },
      { type: 'range', path: 'body.rimHeight', label: 'Rim height', unit: 'mm', min: 0, max: 16, step: 0.1 },
      { type: 'range', path: 'body.wall', label: 'Wall', unit: 'mm', min: 1.6, max: 4, step: 0.1 },
      // The switch drops in from the top: it clips into the plate cutout, its flange rests on
      // the plate, and the lower housing + pins sit in a closed cavity beneath. The floor stays solid.
      { type: 'range', path: 'switch.cutout', label: 'Plate cutout', unit: 'mm', min: 13.8, max: 14.4, step: 0.1 },
      // Most people snap the switch pins off, so the cavity fits the housing alone by default;
      // keeping the pins deepens it by ~3 mm.
      {
        type: 'segmented',
        path: 'switch.pins',
        label: 'Switch pins',
        options: [
          ['clipped', 'Clipped'],
          ['keep', 'Keep'],
        ],
      },
      { type: 'range', path: 'switch.cavity', label: 'Cavity width', unit: 'mm', min: 14, max: 15.6, step: 0.1 },
      { type: 'range', path: 'switch.cavityDepth', label: 'Cavity depth', unit: 'mm', min: 5, max: 12, step: 0.1, auto: 'cavityDepth', fallback: 5.5 },
      { type: 'range', path: 'switch.pocket', label: 'Flange width', unit: 'mm', min: 15, max: 17, step: 0.1 },
      { type: 'range', path: 'switch.plateThickness', label: 'Plate', unit: 'mm', min: 1.2, max: 2, step: 0.1 },
      { type: 'range', path: 'fit.switchTolerance', label: 'Switch tolerance', unit: 'mm', min: 0, max: 0.4, step: 0.05 },
      // Stem socket in the cap. Tapered (borrowed from a well-fitting printed cap) enters loose
      // and wedges near the ceiling; Round is a glue fit with no grip on the cross.
      {
        type: 'segmented',
        path: 'switch.socketMode',
        label: 'Socket',
        options: [
          ['tapered', 'Tapered'],
          ['cross', 'Straight'],
          ['round', 'Round'],
        ],
      },
      { type: 'range', path: 'switch.socketOpening', label: 'Socket opening', unit: 'mm', min: 4.2, max: 7, step: 0.1, when: (p) => p.switch.socketMode === 'tapered' },
      { type: 'range', path: 'switch.roundDiameter', label: 'Hole Ø', unit: 'mm', min: 4.6, max: 5.8, step: 0.1, when: (p) => p.switch.socketMode === 'round' },
      { type: 'range', path: 'switch.stemHeight', label: 'Socket depth', unit: 'mm', min: 3, max: 5, step: 0.1 },
      // The stem boss stands inside the cap's housing pocket; it must fit inside the switch's
      // stem collar (dustproof/BOX switches). Travel is how far the housing rises into the pocket.
      { type: 'range', path: 'switch.bossDiameter', label: 'Boss Ø', unit: 'mm', min: 5.4, max: 8, step: 0.1 },
      { type: 'range', path: 'switch.travel', label: 'Travel', unit: 'mm', min: 3.5, max: 5, step: 0.1 },
      { type: 'range', path: 'fit.clearance', label: 'Cap clearance', unit: 'mm', min: 0.1, max: 0.6, step: 0.05 },
      { type: 'range', path: 'cap.thickness', label: 'Cap thickness', unit: 'mm', min: 2, max: 8, step: 0.1 },
      { type: 'range', path: 'cap.designHeight', label: 'Design height', unit: 'mm', min: 0.4, max: 2, step: 0.1 },
      {
        type: 'segmented',
        path: 'cap.designMode',
        label: 'Design',
        options: [
          // Inlay: the design is pocketed into the cap top and filled flush with the
          // second colour, so the cap prints face-down with no supports.
          ['inlay', 'Inlay'],
          ['raised', 'Raised'],
          ['engraved', 'Engraved'],
        ],
      },
    ],
  },
  {
    id: 'finish',
    title: 'Finish',
    status: (s) => `3 colours · loop ${s.params.keychain.enabled ? 'on' : 'off'}`,
    controls: [
      { type: 'color', path: 'colors.body', label: 'Body' },
      { type: 'color', path: 'colors.cap', label: 'Cap' },
      { type: 'color', path: 'colors.design', label: 'Design' },
      { type: 'toggle', path: 'keychain.enabled', label: 'Keychain loop' },
      { type: 'range', path: 'keychain.outerRadius', label: 'Loop outer', unit: 'mm', min: 3.5, max: 6, step: 0.1, when: (p) => p.keychain.enabled },
      { type: 'range', path: 'keychain.innerRadius', label: 'Loop hole', unit: 'mm', min: 1.5, max: 3, step: 0.1, when: (p) => p.keychain.enabled },
      { type: 'range', path: 'keychain.angle', label: 'Loop angle', unit: '°', min: 0, max: 360, step: 5, when: (p) => p.keychain.enabled },
    ],
  },
];

// ------------------------------------------------------------------ control factories
const decimalsOf = (step) => Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
const intDigitsOf = (min, max) => String(Math.floor(Math.max(Math.abs(min), Math.abs(max)))).length;

const isNum = (v) => Number.isFinite(Number(v)) && v !== '' && v !== null;

function rangeControl(def) {
  const id = idFor(def.path);
  const decimals = decimalsOf(def.step);
  const range = h('input', { type: 'range', id, min: def.min, max: def.max, step: def.step });
  const ro = createReadout({ intDigits: intDigitsOf(def.min, def.max), decimals, signed: !!def.signed, unit: def.unit });
  const label = h('label', { for: id }, def.label);

  // 'auto' rows: the engine derives the value. While automatic the label reads "… · auto" and
  // the tiles are dimmed (the disabled-tile style) but still show the resolved number; once a
  // number is set, a quiet "Auto" text button in the label cell returns the param to 'auto'.
  let isAuto = false;
  let resolved = def.fallback ?? def.min; // last value the engine resolved
  let shown = resolved;
  let autoSuffix = null;
  let autoBtn = null;
  if (def.auto) {
    autoSuffix = h('span', { class: 'auto-suffix' }, ' \u00b7\u00a0auto'); // nbsp: "· auto" wraps as one unit
    label.append(autoSuffix);
    autoBtn = h('button', { type: 'button', class: 'dock-quiet auto-reset', hidden: true, title: 'Let the engine choose this value again' }, 'Auto');
    autoBtn.addEventListener('click', () => setParam(def.path, 'auto'));
  }
  const labelCell = autoBtn ? h('div', { class: 'ctl-labelwrap' }, label, autoBtn) : label;
  const root = h('div', { class: autoBtn ? 'ctl ctl-range ctl-auto' : 'ctl ctl-range' }, labelCell, range, ro.root);

  function show(v, { cascade = false } = {}) {
    shown = isNum(v) ? Number(v) : resolved;
    if (range.value !== String(shown)) range.value = String(shown);
    ro.set(shown, { cascade });
    range.setAttribute('aria-valuetext', `${fmt(shown, decimals)} ${UNIT_WORDS[def.unit] ?? def.unit}${isAuto ? ', automatic' : ''}`.trim());
  }

  range.addEventListener('input', () => {
    const v = clamp(Number(range.value), def.min, def.max);
    setParam(def.path, v, { transient: true, reason: 'slider' });
  });
  range.addEventListener('change', () => commit());

  return {
    root,
    sync(params, meta) {
      const v = get(params, def.path);
      if (v === undefined) return;
      isAuto = !!def.auto && v === 'auto';
      root.classList.toggle('is-auto', isAuto);
      if (autoSuffix) autoSuffix.hidden = !isAuto;
      if (autoBtn) autoBtn.hidden = isAuto;
      show(isAuto ? resolved : v, { cascade: !!meta?.cascade });
      const enabled = def.when ? !!def.when(params) : true;
      range.disabled = !enabled;
      root.classList.toggle('is-disabled', !enabled);
    },
    setAssembly(assembly) {
      if (!def.auto || !assembly) return;
      const r = assembly[def.auto];
      if (!isNum(r)) return;
      resolved = Number(r);
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
  const root = h('div', { class: 'ctl ctl-stack' }, h('span', { class: 'ctl-label', 'aria-hidden': 'true' }, def.label), seg);
  return {
    root,
    sync(params) {
      const v = get(params, def.path);
      inputs.forEach((i) => (i.checked = i.value === v));
      const enabled = def.when ? !!def.when(params) : true;
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
    sync(params) {
      input.checked = !!get(params, def.path);
      const enabled = def.when ? !!def.when(params) : true;
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
    sync(params) {
      const v = String(get(params, def.path) || '#000000').toLowerCase();
      if (document.activeElement !== input && input.value !== v) input.value = v;
      chips.forEach((c) => c.setAttribute('aria-pressed', c.dataset.color === v ? 'true' : 'false'));
    },
  };
}

const FACTORIES = { range: rangeControl, segmented: segmentedControl, toggle: toggleControl, color: colorControl };

// ------------------------------------------------------------------ files
const readFileAsText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error || new Error('Could not read the file.'));
    r.readAsText(file);
  });

const readFileAsDataUrl = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error || new Error('Could not read the file.'));
    r.readAsDataURL(file);
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

// ------------------------------------------------------------------ header card (authored in HTML)
function wireHeader(rail) {
  const q = (sel) => rail.querySelector(sel);
  const kindInputs = [...rail.querySelectorAll('#ck-source-kind input')];
  const panes = [...rail.querySelectorAll('.source-pane')];

  kindInputs.forEach((input) =>
    input.addEventListener('change', () => {
      if (input.checked) update({ source: { kind: input.value } }, { reason: 'source-kind' });
    }),
  );

  // --- Text
  const text = q('#ck-text');
  const font = q('#ck-font');
  const bold = q('#ck-bold');
  text.addEventListener('input', () => update({ source: { kind: 'text', text: { text: text.value } } }, { transient: true, reason: 'text' }));
  text.addEventListener('change', () => commit());
  font.addEventListener('change', () => update({ source: { text: { fontFamily: font.value } } }, { reason: 'font' }));
  bold.addEventListener('change', () => update({ source: { text: { bold: bold.checked } } }, { reason: 'bold' }));

  // --- SVG
  const svgName = q('#ck-svg-name');
  const svgText = q('#ck-svg-text');
  wireDropZone(q('#ck-svg-zone'), q('#ck-svg-file'), q('#ck-svg-error'), async (file) => {
    const ext = extOf(file.name);
    if (ext !== 'svg' && file.type !== 'image/svg+xml') {
      if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
        throw new Error(`That is a ${ext.toUpperCase()} picture. Switch to Image to use it, or drop an .svg here.`);
      }
      throw new Error(`“${file.name}” is not an .svg file.`);
    }
    const markup = await readFileAsText(file);
    if (!/<svg[\s>]/i.test(markup)) throw new Error(`“${file.name}” has no <svg> element inside.`);
    update({ source: { kind: 'svg', svg: { svgText: markup, fileName: file.name } } }, { reason: 'svg-file' });
  });
  svgText.addEventListener('input', () =>
    update({ source: { kind: 'svg', svg: { svgText: svgText.value, fileName: '' } } }, { transient: true, reason: 'svg-text' }),
  );
  svgText.addEventListener('change', () => commit());

  // --- Image
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const threshold = q('#ck-threshold');
  const thresholdRo = createReadout({ intDigits: 3 });
  q('#ck-threshold-ro').replaceWith(thresholdRo.root);
  const invert = q('#ck-invert');
  const removeBg = q('#ck-removebg');
  const trace = q('#ck-trace');
  const traceImg = q('#ck-trace-img');
  const imageName = q('#ck-image-name');
  wireDropZone(q('#ck-image-zone'), q('#ck-image-file'), q('#ck-image-error'), async (file) => {
    const ext = extOf(file.name);
    if (ext === 'svg' || file.type === 'image/svg+xml') throw new Error('That is an SVG. Switch to SVG to use it as vector shapes.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(`“${file.name}” is not a PNG, JPG or WebP.`);
    if (file.size > MAX_IMAGE_BYTES) throw new Error('That picture is over 12 MB. Try a smaller export.');
    const dataUrl = await readFileAsDataUrl(file);
    update({ source: { kind: 'image', image: { dataUrl, fileName: file.name } } }, { reason: 'image-file' });
  });
  threshold.addEventListener('input', () => {
    const v = clamp(Math.round(Number(threshold.value) || 0), 0, 255);
    update({ source: { image: { threshold: v } } }, { transient: true, reason: 'slider' });
  });
  threshold.addEventListener('change', () => commit());
  invert.addEventListener('change', () => update({ source: { image: { invert: invert.checked } } }, { reason: 'invert' }));
  removeBg.addEventListener('change', () => update({ source: { image: { removeBackground: removeBg.checked } } }, { reason: 'remove-bg' }));

  // --- Samples
  const samplesEl = q('#ck-samples');
  const sampleButtons = SAMPLES.map((s) => {
    const b = h('button', { type: 'button', class: 'sample', 'aria-label': s.label, 'aria-pressed': 'false', title: s.label, dataset: { id: s.id } });
    b.innerHTML = s.svgText;
    b.querySelector('svg')?.setAttribute('aria-hidden', 'true');
    b.addEventListener('click', () => update({ source: { kind: 'sample', sample: { id: s.id } } }, { reason: 'sample' }));
    return b;
  });
  samplesEl.replaceChildren(...sampleButtons);

  const emptyHint = q('#ck-empty-hint');
  const fieldFont = (fam) => (/[\s"']/.test(fam) ? `"${fam}", ${getComputedStyle(document.documentElement).getPropertyValue('--font-display')}` : fam);

  return {
    sync(s, meta) {
      const src = s.source;
      kindInputs.forEach((i) => (i.checked = i.value === src.kind));
      panes.forEach((p) => (p.hidden = p.dataset.kind !== src.kind));

      if (document.activeElement !== text) text.value = src.text.text ?? '';
      font.value = src.text.fontFamily;
      if (font.value !== src.text.fontFamily) font.selectedIndex = 1; // unknown family in a loaded project: show Arial
      text.style.fontFamily = fieldFont(src.text.fontFamily);
      text.style.fontWeight = src.text.bold ? '800' : '400';
      bold.checked = !!src.text.bold;

      if (document.activeElement !== svgText) svgText.value = src.svg.svgText || '';
      svgName.textContent = src.svg.fileName ? `Loaded ${src.svg.fileName}` : '';
      svgName.hidden = !src.svg.fileName;

      const img = src.image;
      if (threshold.value !== String(img.threshold)) threshold.value = String(img.threshold);
      thresholdRo.set(img.threshold, { cascade: !!meta?.cascade });
      threshold.setAttribute('aria-valuetext', `${img.threshold} of 255`);
      invert.checked = !!img.invert;
      removeBg.checked = img.removeBackground !== false;
      imageName.textContent = img.fileName || 'Picture';

      sampleButtons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === src.sample.id ? 'true' : 'false'));
    },
    // Called with the derived design spec after each build.
    setSpec(spec) {
      const src = state.source;
      const hasShapes = !!(spec && Array.isArray(spec.shapes) && spec.shapes.length);
      if (src.kind === 'image' && spec?.previewDataUrl) {
        traceImg.src = spec.previewDataUrl;
        trace.hidden = false;
      } else {
        trace.hidden = true;
      }
      if (hasShapes || !spec) {
        emptyHint.hidden = true;
        return;
      }
      const hint = {
        text: 'Nothing on the cap yet. Type up to 20 characters above.',
        svg: 'Nothing on the cap yet. Drop an SVG, or paste its markup.',
        image: 'Nothing on the cap yet. Drop a picture above; if it traced to nothing, move the cut-off.',
        sample: 'Pick a sample above.',
      }[src.kind];
      emptyHint.textContent = hint || 'Nothing on the cap yet.';
      emptyHint.hidden = false;
    },
  };
}

// ------------------------------------------------------------------ group cards
const STORAGE_KEY = 'stlmill-clicker-group';

function buildGroups(container) {
  const groups = [];
  const syncers = [];
  const controls = [];

  GROUPS.forEach((def) => {
    const bodyId = `ck-group-${def.id}`;
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
      controls.push(ctl);
      body.append(ctl.root);
      syncers.push((s, meta) => ctl.sync(s.params, meta));
    }
    syncers.push((s) => {
      statusEl.textContent = def.status(s);
    });

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
      // scroll-margin-top (clicker.css) keeps the header clear of the bench.
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

  let initial = 'footprint';
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
    setAssembly: (assembly) => controls.forEach((c) => c.setAssembly?.(assembly)),
  };
}

// ------------------------------------------------------------------ foot pins
function wireFoot(rail) {
  const undoBtn = rail.querySelector('#ck-undo');
  const redoBtn = rail.querySelector('#ck-redo');
  const resetBtn = rail.querySelector('#ck-reset');
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
 * Wire the whole left column. Returns { setSpec(spec), openGroup(id) }.
 */
export function initRail(rail) {
  const header = wireHeader(rail);
  const groups = buildGroups(rail.querySelector('#ck-groups'));
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
    setSpec: (spec) => header.setSpec(spec),
    // Resolved 'auto' values (assembly.bodyHeight, assembly.cavityDepth) feed the auto rows.
    setAssembly: (assembly) => groups.setAssembly(assembly),
    openGroup: (id) => groups.open(id),
  };
}
