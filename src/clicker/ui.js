// Builds the workflow sidebar (numbered collapsible steps), the floating
// viewport toolbar and the export dock from a declarative schema, and binds
// everything to state.js.

import {
  state,
  subscribe,
  update,
  commit,
  undo,
  redo,
  reset,
  canUndo,
  canRedo,
  getPath,
  patchFromPath,
} from './state.js';

// ------------------------------------------------------------------ samples
const SAMPLE_FILES = import.meta.glob('./samples/*.svg', { query: '?raw', import: 'default', eager: true });
const SAMPLE_ORDER = ['heart', 'paw', 'star', 'bolt', 'smiley'];
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

export const getSample = (id) => SAMPLES.find((s) => s.id === id) || SAMPLES[0];

// ------------------------------------------------------------------ labels
const FONTS = ['Arial', 'Impact', 'Georgia', 'Verdana', 'Courier New', 'Comic Sans MS', 'Trebuchet MS', 'Segoe UI'];

const STYLE_LABELS = { outline: 'Traced', circle: 'Round', square: 'Square', hexagon: 'Hex' };
const SOURCE_LABELS = { text: 'Type', svg: 'Vector', image: 'Picture', sample: 'Starter' };

const COLOR_PRESETS = {
  'colors.body': ['#2b2b2b', '#f5f5f5', '#3b2a22', '#7a1f1f', '#2e5d34', '#6b4e16'],
  'colors.cap': ['#f5f5f5', '#2b2b2b', '#ffd166', '#e9c46a', '#f4acb7', '#cdb4db'],
  'colors.design': ['#f07a2a', '#e63946', '#2a9d8f', '#8a5a44', '#ffbe0b', '#ffffff'],
};

const fmt = (n, d = 1) => Number(n).toFixed(d).replace(/\.0+$/, '');

// ------------------------------------------------------------------ control schema
// Adding a parameter = adding one entry to a step's `controls` list.
// `heading` entries break a step into sub-groups.
export const STEPS = [
  {
    id: 'design',
    title: 'What goes on top',
    status: (s) => {
      const src = s.source;
      if (src.kind === 'text') return `${SOURCE_LABELS.text} · ${src.text.text?.trim() || '—'}`;
      if (src.kind === 'svg') return `${SOURCE_LABELS.svg} · ${src.svg.svgText ? src.svg.fileName || 'pasted' : 'nothing yet'}`;
      if (src.kind === 'image') return `${SOURCE_LABELS.image} · ${src.image.dataUrl ? src.image.fileName || 'loaded' : 'nothing yet'}`;
      return `${SOURCE_LABELS.sample} · ${getSample(src.sample.id)?.label || ''}`;
    },
    custom: 'source', // rendered by sourceStep()
  },
  {
    id: 'shape',
    title: 'Footprint & cap',
    status: (s) => `${STYLE_LABELS[s.params.base.style] || s.params.base.style} · ${fmt(s.params.base.size)} mm`,
    controls: [
      {
        type: 'segmented',
        path: 'base.style',
        label: 'Footprint',
        options: [
          ['outline', 'Traced'],
          ['circle', 'Round'],
          ['square', 'Square'],
          ['hexagon', 'Hex'],
        ],
        help: 'Shape of the cap and housing; Traced follows the silhouette of your design.',
      },
      { type: 'number', path: 'base.size', label: 'Width across', unit: 'mm', min: 20, max: 60, step: 0.5, help: 'Overall width of the clicker in millimetres.' },
      { type: 'number', path: 'design.fill', label: 'Design coverage', unit: '%', min: 40, max: 100, step: 1, help: 'How much of the cap width the design spans.' },
      {
        type: 'number',
        path: 'base.margin',
        label: 'Border around design',
        unit: 'mm',
        min: 1,
        max: 6,
        step: 0.1,
        help: 'Extra rim kept around the design when the footprint is Traced.',
        enabledWhen: (p) => p.base.style === 'outline',
      },
      {
        type: 'number',
        path: 'base.cornerRadius',
        label: 'Corner softness',
        unit: 'mm',
        min: 0,
        max: 15,
        step: 0.5,
        help: 'Rounding of the corners on a Square footprint.',
        enabledWhen: (p) => p.base.style === 'square',
      },
      { type: 'number', path: 'design.rotation', label: 'Spin', unit: '°', min: -180, max: 180, step: 1, help: 'Rotates the design on the cap, in degrees.' },
      { type: 'heading', label: 'Cap' },
      { type: 'number', path: 'cap.thickness', label: 'Cap plate', unit: 'mm', min: 2, max: 5, step: 0.1, help: 'Thickness of the plate your design sits on.' },
      { type: 'number', path: 'cap.designHeight', label: 'Relief depth', unit: 'mm', min: 0.4, max: 2, step: 0.1, help: 'How far the design stands proud of, or sinks into, the cap.' },
      {
        type: 'segmented',
        path: 'cap.designMode',
        label: 'Relief',
        options: [
          ['raised', 'Raised'],
          ['engraved', 'Recessed'],
        ],
        help: 'Raised prints the design as its own colour on top; Recessed sinks it into the cap.',
      },
    ],
  },
  {
    id: 'hardware',
    title: 'Switch & housing',
    status: (s) => `${fmt(s.params.body.height)} mm tall · ${fmt(s.params.switch.cutout, 2)} mm clip`,
    controls: [
      { type: 'heading', label: 'Housing' },
      { type: 'number', path: 'body.height', label: 'Housing height', unit: 'mm', min: 9, max: 20, step: 0.5, help: 'Height of the housing from the build plate to the top of its lip.' },
      { type: 'number', path: 'body.rimHeight', label: 'Lip height', unit: 'mm', min: 0, max: 5, step: 0.1, help: 'Height of the lip that wraps the cap and hides the gap when pressed.' },
      { type: 'number', path: 'body.wall', label: 'Wall thickness', unit: 'mm', min: 1.6, max: 4, step: 0.1, help: 'Thickness of the housing walls.' },
      { type: 'heading', label: 'Switch & fit' },
      { type: 'number', path: 'switch.cutout', label: 'Clip-in hole', unit: 'mm', min: 13.6, max: 14.4, step: 0.05, help: 'Width of the square hole an MX switch clips into (standard 14 mm).' },
      { type: 'number', path: 'switch.pocket', label: 'Housing pocket', unit: 'mm', min: 15.2, max: 16.2, step: 0.05, help: 'Width of the recess beneath the plate that the switch body sits in.' },
      { type: 'number', path: 'switch.plateThickness', label: 'Clip plate', unit: 'mm', min: 1.2, max: 2, step: 0.05, help: 'Thickness of the plate the switch clips onto (standard 1.5 mm).' },
      { type: 'number', path: 'fit.switchTolerance', label: 'Switch slack', unit: 'mm', min: 0, max: 0.4, step: 0.01, help: 'Extra room around the switch hole for printers that print tight.' },
      { type: 'number', path: 'fit.clearance', label: 'Cap play', unit: 'mm', min: 0.1, max: 0.6, step: 0.05, help: 'Gap between the cap and the inside of the lip so the cap travels freely.' },
    ],
  },
  {
    id: 'finish',
    title: 'Loop & colours',
    status: (s) => `${s.params.keychain.enabled ? 'Keyring loop' : 'No loop'} · 3 colours`,
    controls: [
      { type: 'heading', label: 'Keyring loop' },
      { type: 'toggle', path: 'keychain.enabled', label: 'Add a keyring loop', help: 'Adds a loop to the housing so the clicker can hang from a keyring.' },
      { type: 'number', path: 'keychain.outerRadius', label: 'Loop outer radius', unit: 'mm', min: 3, max: 8, step: 0.1, help: 'Outer radius of the loop.', enabledWhen: (p) => p.keychain.enabled },
      { type: 'number', path: 'keychain.innerRadius', label: 'Loop hole radius', unit: 'mm', min: 1, max: 4, step: 0.1, help: 'Hole radius; 2.2 mm suits a standard split ring.', enabledWhen: (p) => p.keychain.enabled },
      { type: 'number', path: 'keychain.angle', label: 'Loop position', unit: '°', min: 0, max: 360, step: 5, help: 'Where around the housing the loop attaches, in degrees.', enabledWhen: (p) => p.keychain.enabled },
      { type: 'heading', label: 'Colours' },
      { type: 'color', path: 'colors.body', label: 'Housing', help: 'Colour of the housing in the preview and the 3MF.' },
      { type: 'color', path: 'colors.cap', label: 'Cap', help: 'Colour of the cap.' },
      { type: 'color', path: 'colors.design', label: 'Design', help: 'Colour of the raised design.' },
    ],
  },
];

// ------------------------------------------------------------------ DOM helpers
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
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const idFor = (path) => `ck-${path.replace(/\./g, '-')}`;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const roundTo = (v, step) => Number(v.toFixed(Math.max(0, Math.ceil(-Math.log10(step)))));

function helpButton(text) {
  if (!text) return null;
  return h('span', { class: 'ck-help', title: text, role: 'img', 'aria-label': `Help: ${text}`, tabindex: 0 }, '?');
}

function switchRow({ id, label, input, help }) {
  return h(
    'div',
    { class: 'ck-ctl ck-ctl-toggle' },
    h('label', { class: 'ck-switch', for: id }, input, h('span', { class: 'ck-switch-track', 'aria-hidden': 'true' }), h('span', { class: 'ck-switch-label' }, label)),
    helpButton(help),
  );
}

// ------------------------------------------------------------------ control factories
function headingControl(def) {
  return { root: h('h3', { class: 'ck-subhead' }, def.label), sync() {} };
}

function numberControl(def) {
  const id = idFor(def.path);
  const number = h('input', { type: 'number', id, min: def.min, max: def.max, step: def.step, class: 'ck-num', inputmode: 'decimal' });
  const range = h('input', { type: 'range', min: def.min, max: def.max, step: def.step, class: 'ck-range', 'aria-label': `${def.label} slider`, tabindex: -1 });

  const apply = (raw, opts) => {
    const v = roundTo(clamp(Number(raw), def.min, def.max), def.step);
    if (Number.isNaN(v)) return;
    number.value = String(v);
    range.value = String(v);
    update({ params: patchFromPath(def.path, v) }, opts);
  };

  range.addEventListener('input', () => apply(range.value, { transient: true, reason: 'slider' }));
  range.addEventListener('change', () => commit());
  number.addEventListener('change', () => apply(number.value));
  number.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply(number.value);
  });

  const root = h(
    'div',
    { class: 'ck-ctl ck-ctl-number' },
    h('div', { class: 'ck-ctl-head' }, h('label', { for: id }, def.label), helpButton(def.help)),
    h('div', { class: 'ck-ctl-row' }, range, h('div', { class: 'ck-num-wrap' }, number, def.unit ? h('span', { class: 'ck-unit' }, def.unit) : null)),
  );

  return {
    root,
    sync(params) {
      const v = getPath(params, def.path);
      if (v === undefined) return;
      if (document.activeElement !== number) number.value = String(v);
      range.value = String(v);
      range.style.setProperty('--fill', `${((v - def.min) / (def.max - def.min)) * 100}%`);
      const enabled = def.enabledWhen ? !!def.enabledWhen(params) : true;
      number.disabled = range.disabled = !enabled;
      root.classList.toggle('is-disabled', !enabled);
    },
  };
}

function segmentedControl(def) {
  const name = idFor(def.path);
  const inputs = [];
  const seg = h(
    'div',
    { class: 'ck-seg', role: 'radiogroup', 'aria-label': def.label },
    def.options.map(([value, label]) => {
      const input = h('input', { type: 'radio', name, value, id: `${name}-${value}` });
      input.addEventListener('change', () => {
        if (input.checked) update({ params: patchFromPath(def.path, value) });
      });
      inputs.push(input);
      return h('label', { class: 'ck-seg-item', for: `${name}-${value}` }, input, h('span', {}, label));
    }),
  );
  const root = h(
    'div',
    { class: 'ck-ctl ck-ctl-seg' },
    h('div', { class: 'ck-ctl-head' }, h('span', { class: 'ck-label' }, def.label), helpButton(def.help)),
    seg,
  );
  return {
    root,
    sync(params) {
      const v = getPath(params, def.path);
      inputs.forEach((i) => (i.checked = i.value === v));
      const enabled = def.enabledWhen ? !!def.enabledWhen(params) : true;
      inputs.forEach((i) => (i.disabled = !enabled));
      root.classList.toggle('is-disabled', !enabled);
    },
  };
}

function toggleControl(def) {
  const id = idFor(def.path);
  const input = h('input', { type: 'checkbox', id, class: 'ck-switch-input' });
  input.addEventListener('change', () => update({ params: patchFromPath(def.path, input.checked) }));
  const root = switchRow({ id, label: def.label, input, help: def.help });
  return {
    root,
    sync(params) {
      input.checked = !!getPath(params, def.path);
      const enabled = def.enabledWhen ? !!def.enabledWhen(params) : true;
      input.disabled = !enabled;
      root.classList.toggle('is-disabled', !enabled);
    },
  };
}

function colorControl(def) {
  const id = idFor(def.path);
  const input = h('input', { type: 'color', id, class: 'ck-color' });
  const set = (v, opts) => update({ params: patchFromPath(def.path, v) }, opts);
  input.addEventListener('input', () => set(input.value, { transient: true, reason: 'color' }));
  input.addEventListener('change', () => {
    set(input.value, { transient: true });
    commit();
  });
  const swatches = (COLOR_PRESETS[def.path] || []).map((c) => {
    const b = h('button', { type: 'button', class: 'ck-swatch', style: { '--swatch': c }, 'aria-label': `${def.label} ${c}`, title: c, dataset: { color: c } });
    b.addEventListener('click', () => set(c));
    return b;
  });
  const root = h(
    'div',
    { class: 'ck-ctl ck-ctl-color' },
    h('div', { class: 'ck-ctl-head' }, h('label', { for: id }, def.label), helpButton(def.help)),
    h('div', { class: 'ck-ctl-row' }, h('span', { class: 'ck-color-wrap' }, input), h('div', { class: 'ck-swatches' }, swatches)),
  );
  return {
    root,
    sync(params) {
      const v = getPath(params, def.path);
      if (typeof v === 'string' && document.activeElement !== input) input.value = v;
      swatches.forEach((s) => s.classList.toggle('is-active', s.dataset.color.toLowerCase() === String(v).toLowerCase()));
    },
  };
}

const FACTORIES = { heading: headingControl, number: numberControl, segmented: segmentedControl, toggle: toggleControl, color: colorControl };

// ------------------------------------------------------------------ files
const readFileAsText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });

const readFileAsDataUrl = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });

function dropZone({ accept, label, hint, onFile, id }) {
  const input = h('input', { type: 'file', accept, id, class: 'ck-file-input' });
  const zone = h(
    'label',
    { class: 'ck-dropzone', for: id },
    h('span', { class: 'ck-drop-label' }, label),
    h('span', { class: 'ck-drop-hint' }, hint),
    input,
  );
  const handle = (file) => {
    if (!file) return;
    Promise.resolve(onFile(file)).catch((err) => {
      console.error(err);
      alert(`Could not read ${file.name}: ${err.message || err}`);
    });
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
  return zone;
}

// ------------------------------------------------------------------ design step (source import)
const SOURCE_KINDS = [
  ['text', 'Type'],
  ['svg', 'Vector'],
  ['image', 'Picture'],
  ['sample', 'Starters'],
];

function sourceStep() {
  const kindInputs = [];
  const kindSeg = h(
    'div',
    { class: 'ck-seg ck-seg-kind', role: 'radiogroup', 'aria-label': 'Where the design comes from' },
    SOURCE_KINDS.map(([value, label]) => {
      const id = `ck-src-${value}`;
      const input = h('input', { type: 'radio', name: 'ck-source-kind', value, id });
      input.addEventListener('change', () => {
        if (input.checked) update({ source: { kind: value } }, { reason: 'source-kind' });
      });
      kindInputs.push(input);
      return h('label', { class: 'ck-seg-item', for: id }, input, h('span', {}, label));
    }),
  );

  // --- Type
  const textarea = h('textarea', { id: 'ck-text', class: 'ck-textarea ck-textarea-big', rows: 2, maxlength: 40, placeholder: 'A word, initials, a number…' });
  textarea.addEventListener('input', () => update({ source: { kind: 'text', text: { text: textarea.value } } }, { transient: true, reason: 'text' }));
  textarea.addEventListener('blur', () => commit());
  const fontSelect = h('select', { id: 'ck-font', class: 'ck-select' }, FONTS.map((f) => h('option', { value: f, style: { fontFamily: f } }, f)));
  fontSelect.addEventListener('change', () => update({ source: { text: { fontFamily: fontSelect.value } } }));
  const bold = h('input', { type: 'checkbox', id: 'ck-bold', class: 'ck-switch-input' });
  bold.addEventListener('change', () => update({ source: { text: { bold: bold.checked } } }));
  const textPane = h(
    'div',
    { class: 'ck-source-pane', dataset: { kind: 'text' } },
    h('label', { for: 'ck-text', class: 'ck-label' }, 'Your text'),
    textarea,
    h('div', { class: 'ck-ctl' }, h('div', { class: 'ck-ctl-head' }, h('label', { for: 'ck-font' }, 'Typeface')), fontSelect),
    switchRow({ id: 'ck-bold', label: 'Heavy weight', input: bold, help: 'Heavier strokes print more reliably at small sizes.' }),
    h('p', { class: 'ck-note' }, 'Short words read best. Thin typefaces may want more relief depth.'),
  );

  // --- Vector
  const svgTextarea = h('textarea', { id: 'ck-svg-text', class: 'ck-textarea ck-mono', rows: 5, placeholder: '…or paste <svg> markup here', spellcheck: false });
  const svgFileName = h('div', { class: 'ck-filename' }, 'Nothing loaded yet');
  svgTextarea.addEventListener('input', () => {
    update({ source: { kind: 'svg', svg: { svgText: svgTextarea.value, fileName: '' } } }, { transient: true, reason: 'svg-text' });
  });
  svgTextarea.addEventListener('blur', () => commit());
  const svgPane = h(
    'div',
    { class: 'ck-source-pane', dataset: { kind: 'svg' } },
    dropZone({
      id: 'ck-svg-file',
      accept: '.svg,image/svg+xml',
      label: 'Drop an SVG here, or browse',
      hint: 'Filled shapes are used · strokes are ignored',
      onFile: async (file) => {
        const svgText = await readFileAsText(file);
        update({ source: { kind: 'svg', svg: { svgText, fileName: file.name } } }, { reason: 'svg-file' });
      },
    }),
    svgFileName,
    h('label', { for: 'ck-svg-text', class: 'ck-label' }, 'Markup'),
    svgTextarea,
  );

  // --- Picture
  const imgPreview = h('img', { class: 'ck-preview-img', alt: 'Traced design preview', hidden: true });
  const imgFileName = h('div', { class: 'ck-filename' }, 'Nothing loaded yet');
  const thresholdNum = h('input', { type: 'number', id: 'ck-img-threshold', min: 0, max: 255, step: 1, class: 'ck-num' });
  const thresholdRange = h('input', { type: 'range', min: 0, max: 255, step: 1, class: 'ck-range', 'aria-label': 'Darkness cut-off slider', tabindex: -1 });
  const setThreshold = (raw, opts) => {
    const v = clamp(Math.round(Number(raw) || 0), 0, 255);
    thresholdNum.value = thresholdRange.value = String(v);
    update({ source: { image: { threshold: v } } }, opts);
  };
  thresholdRange.addEventListener('input', () => setThreshold(thresholdRange.value, { transient: true, reason: 'slider' }));
  thresholdRange.addEventListener('change', () => commit());
  thresholdNum.addEventListener('change', () => setThreshold(thresholdNum.value));
  const invert = h('input', { type: 'checkbox', id: 'ck-img-invert', class: 'ck-switch-input' });
  invert.addEventListener('change', () => update({ source: { image: { invert: invert.checked } } }));
  const removeBg = h('input', { type: 'checkbox', id: 'ck-img-removebg', class: 'ck-switch-input' });
  removeBg.addEventListener('change', () => update({ source: { image: { removeBackground: removeBg.checked } } }));

  const imagePane = h(
    'div',
    { class: 'ck-source-pane', dataset: { kind: 'image' } },
    dropZone({
      id: 'ck-image-file',
      accept: 'image/png,image/jpeg,image/webp',
      label: 'Drop a picture here, or browse',
      hint: 'PNG, JPG or WebP · dark areas become the design',
      onFile: async (file) => {
        const dataUrl = await readFileAsDataUrl(file);
        update({ source: { kind: 'image', image: { dataUrl, fileName: file.name } } }, { reason: 'image-file' });
      },
    }),
    imgFileName,
    h(
      'div',
      { class: 'ck-ctl ck-ctl-number' },
      h('div', { class: 'ck-ctl-head' }, h('label', { for: 'ck-img-threshold' }, 'Darkness cut-off'), helpButton('Pixels darker than this value (0–255) become part of the design.')),
      h('div', { class: 'ck-ctl-row' }, thresholdRange, h('div', { class: 'ck-num-wrap' }, thresholdNum)),
    ),
    switchRow({ id: 'ck-img-invert', label: 'Flip light and dark', input: invert, help: 'Swap which pixels count as design and which as background.' }),
    switchRow({ id: 'ck-img-removebg', label: 'Drop the background', input: removeBg, help: 'Removes the background colour so only the subject is traced.' }),
    h('div', { class: 'ck-preview' }, h('div', { class: 'ck-micro' }, 'Traced result'), imgPreview),
  );

  // --- Starters
  const sampleButtons = SAMPLES.map((s) => {
    const b = h('button', { type: 'button', class: 'ck-sample', 'aria-label': `Use the ${s.label} starter`, title: s.label, dataset: { id: s.id } });
    b.innerHTML = s.svgText;
    b.append(h('span', { class: 'ck-sample-label' }, s.label));
    b.addEventListener('click', () => update({ source: { kind: 'sample', sample: { id: s.id } } }, { reason: 'sample' }));
    return b;
  });
  const samplesPane = h(
    'div',
    { class: 'ck-source-pane', dataset: { kind: 'sample' } },
    h('div', { class: 'ck-samples' }, sampleButtons),
    h('p', { class: 'ck-note' }, 'Bold silhouettes print best. Try the Traced footprint with these.'),
  );

  const panes = [textPane, svgPane, imagePane, samplesPane];
  const root = h('div', { class: 'ck-source' }, kindSeg, ...panes);

  const api = {
    root,
    sync(s) {
      const src = s.source;
      kindInputs.forEach((i) => (i.checked = i.value === src.kind));
      panes.forEach((p) => (p.hidden = p.dataset.kind !== src.kind));

      const img = src.image;
      if (document.activeElement !== thresholdNum) thresholdNum.value = String(img.threshold);
      thresholdRange.value = String(img.threshold);
      thresholdRange.style.setProperty('--fill', `${(img.threshold / 255) * 100}%`);
      invert.checked = !!img.invert;
      removeBg.checked = !!img.removeBackground;
      imgFileName.textContent = img.dataUrl ? img.fileName || 'Picture loaded' : 'Nothing loaded yet';

      if (document.activeElement !== svgTextarea) svgTextarea.value = src.svg.svgText || '';
      svgFileName.textContent = src.svg.svgText ? src.svg.fileName || 'Pasted markup' : 'Nothing loaded yet';

      if (document.activeElement !== textarea) textarea.value = src.text.text ?? '';
      fontSelect.value = src.text.fontFamily;
      textarea.style.fontFamily = src.text.fontFamily;
      textarea.style.fontWeight = src.text.bold ? '700' : '400';
      bold.checked = !!src.text.bold;

      sampleButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.id === src.sample.id));
    },
    setPreview(dataUrl) {
      if (dataUrl) {
        imgPreview.src = dataUrl;
        imgPreview.hidden = false;
      } else {
        imgPreview.removeAttribute('src');
        imgPreview.hidden = true;
      }
    },
  };
  return api;
}

// ------------------------------------------------------------------ sidebar
export function initSidebar(container, { steps = STEPS } = {}) {
  const stepEls = [];
  const syncers = [];
  let sourceApi = null;

  const list = h('div', { class: 'ck-steps' });

  steps.forEach((step, i) => {
    const bodyId = `ck-step-body-${step.id}`;
    const statusEl = h('span', { class: 'ck-step-status' });
    const header = h(
      'button',
      { type: 'button', class: 'ck-step-head', 'aria-expanded': 'false', 'aria-controls': bodyId },
      h('span', { class: 'ck-step-num ck-micro' }, `Step ${i + 1}`),
      h('span', { class: 'ck-step-text' }, h('span', { class: 'ck-step-title' }, step.title), statusEl),
      h('span', { class: 'ck-step-chevron', 'aria-hidden': 'true' }),
    );
    const body = h('div', { class: 'ck-step-body', id: bodyId, role: 'region', 'aria-label': step.title });
    const inner = h('div', { class: 'ck-step-inner' });
    body.append(inner);

    if (step.custom === 'source') {
      sourceApi = sourceStep();
      inner.append(sourceApi.root);
      syncers.push((s) => sourceApi.sync(s));
    } else {
      for (const def of step.controls || []) {
        const ctl = FACTORIES[def.type](def);
        inner.append(ctl.root);
        syncers.push((s) => ctl.sync(s.params));
      }
    }
    syncers.push((s) => {
      statusEl.textContent = step.status ? step.status(s) : '';
    });

    const el = h('section', { class: 'ck-step', dataset: { step: step.id } }, header, body);
    header.addEventListener('click', () => open(i));
    stepEls.push({ el, header, body });
    list.append(el);
  });

  function open(i) {
    stepEls.forEach((s, j) => {
      const on = i === j;
      s.el.classList.toggle('is-open', on);
      s.header.setAttribute('aria-expanded', on ? 'true' : 'false');
      s.body.hidden = !on;
    });
    try {
      localStorage.setItem('ck.step', steps[i].id);
    } catch {}
  }

  const undoBtn = h('button', { type: 'button', class: 'ck-ghost-btn', onClick: () => undo(), title: 'Undo (Ctrl+Z)' }, 'Undo');
  const redoBtn = h('button', { type: 'button', class: 'ck-ghost-btn', onClick: () => redo(), title: 'Redo (Ctrl+Shift+Z)' }, 'Redo');
  const resetBtn = h('button', { type: 'button', class: 'ck-ghost-btn ck-ghost-danger', onClick: () => reset(), title: 'Start over with the default clicker' }, 'Start over');
  const footer = h('div', { class: 'ck-sidebar-foot' }, h('div', { class: 'ck-bar-group' }, undoBtn, redoBtn), resetBtn);

  container.append(list, footer);

  function sync() {
    for (const fn of syncers) fn(state);
    undoBtn.disabled = !canUndo();
    redoBtn.disabled = !canRedo();
  }
  subscribe(sync);
  sync();

  let initial = 0;
  try {
    const saved = localStorage.getItem('ck.step');
    const idx = steps.findIndex((t) => t.id === saved);
    if (idx >= 0) initial = idx;
  } catch {}
  open(initial);

  return {
    open,
    setPreview: (url) => sourceApi?.setPreview(url),
  };
}

// ------------------------------------------------------------------ viewport toolbar (glass, top-centre)
export function initViewerToolbar(container, { onExploded, onShowSwitch, onCutOpen, onFit }) {
  const assembled = h('input', { type: 'radio', name: 'ck-view-mode', id: 'ck-view-assembled', value: 'assembled', checked: true });
  const exploded = h('input', { type: 'radio', name: 'ck-view-mode', id: 'ck-view-exploded', value: 'exploded' });
  const modeSeg = h(
    'div',
    { class: 'ck-seg ck-seg-glass', role: 'radiogroup', 'aria-label': 'View mode' },
    h('label', { class: 'ck-seg-item', for: 'ck-view-assembled' }, assembled, h('span', {}, 'Assembled')),
    h('label', { class: 'ck-seg-item', for: 'ck-view-exploded' }, exploded, h('span', {}, 'Exploded')),
  );
  [assembled, exploded].forEach((r) => r.addEventListener('change', () => onExploded(exploded.checked)));

  const mkToggle = (label, title, cb) => {
    const b = h('button', { type: 'button', class: 'ck-tool-btn', 'aria-pressed': 'false', title }, label);
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      cb(on);
    });
    return b;
  };
  const sw = mkToggle('Show switch', 'Ghost in a reference MX-style switch (not exported)', onShowSwitch);
  const cut = mkToggle('Cut open', 'Slice the housing and switch down the middle to peek inside', onCutOpen);
  const fit = h('button', { type: 'button', class: 'ck-tool-btn ck-tool-icon', title: 'Re-centre the view', 'aria-label': 'Re-centre the view', onClick: () => onFit() });
  fit.innerHTML =
    '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/><circle cx="10" cy="10" r="2.5"/></svg>';

  const bar = h('div', { class: 'ck-glass ck-toolbar', role: 'toolbar', 'aria-label': 'Viewer options' }, modeSeg, h('span', { class: 'ck-tool-sep', 'aria-hidden': 'true' }), sw, cut, fit);
  const hint = h('div', { class: 'ck-hint' }, 'Orbit by dragging · right-drag slides · wheel zooms');
  const spinner = h('div', { class: 'ck-glass ck-spinner', role: 'status', hidden: true }, h('span', { class: 'ck-spinner-ring', 'aria-hidden': 'true' }), 'Shaping…');
  container.append(bar, hint, spinner);
  return {
    setBusy(on) {
      spinner.hidden = !on;
    },
  };
}

// ------------------------------------------------------------------ export dock (bottom-right) + warnings
const ICONS = {
  save: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v10M6 9l4 4 4-4"/><path d="M4 15v2h12v-2"/></svg>',
  load: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

export function initExportDock(container, warningsEl, handlers) {
  const btn3mf = h('button', { type: 'button', class: 'btn btn-primary ck-dock-primary', onClick: () => handlers.download3mf() }, 'Download 3MF');
  const btnStl = h('button', { type: 'button', class: 'ck-tool-btn', onClick: () => handlers.downloadStl(), title: 'Download every part as STL files in a zip' }, 'STL zip');
  const btnSave = h('button', { type: 'button', class: 'ck-tool-btn ck-tool-icon', 'aria-label': 'Save project file', title: 'Save project (JSON)', onClick: () => handlers.saveProject() });
  btnSave.innerHTML = ICONS.save;
  const loadInput = h('input', { type: 'file', accept: '.json,application/json', id: 'ck-load-project', class: 'ck-file-input' });
  loadInput.addEventListener('change', () => {
    const f = loadInput.files?.[0];
    if (f) handlers.loadProject(f);
    loadInput.value = '';
  });
  const btnLoad = h('button', { type: 'button', class: 'ck-tool-btn ck-tool-icon', 'aria-label': 'Open project file', title: 'Open a saved project', onClick: () => loadInput.click() });
  btnLoad.innerHTML = ICONS.load;

  const dock = h('div', { class: 'ck-glass ck-dock', role: 'group', 'aria-label': 'Export' }, btn3mf, btnStl, h('span', { class: 'ck-tool-sep', 'aria-hidden': 'true' }), btnSave, btnLoad, loadInput);
  const status = h('div', { class: 'ck-dock-status', role: 'status', 'aria-live': 'polite' });
  container.append(dock, status);

  return {
    setBusy(on) {
      [btn3mf, btnStl].forEach((b) => (b.disabled = !!on));
    },
    setStatus(text) {
      status.textContent = text || '';
      status.hidden = !text;
    },
    setWarnings(list) {
      const items = (list || []).filter(Boolean);
      warningsEl.hidden = items.length === 0;
      warningsEl.replaceChildren(...items.map((w) => h('div', { class: 'ck-warning' }, h('span', { class: 'ck-warning-dot', 'aria-hidden': 'true' }), String(w))));
    },
  };
}
