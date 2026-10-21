// Clicker Generator: boots the page. State (state.js) is the single source of
// truth; the session (session.js) turns it into geometry; the viewer
// (viewer.js) shows it on the bench; ui.js owns the rail. This file wires the
// four together plus the bench toolbar, the export dock and the shortcuts.

import '../shared/base.css';
import './clicker.css';
import { initTheme } from '../shared/theme.js';
import { state, subscribe, undo, redo, serialize, deserialize } from './state.js';
import { createSession } from './session.js';
import { Viewer } from './viewer.js';
import { buildReferenceSwitch } from './engine/index.js';
import { initRail, fmt } from './ui.js';

initTheme();

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ ?text= seeds the text source
// Done before anything subscribes, so landing with a word does not create an
// undo step back to the default text.
(function seedFromUrl() {
  try {
    const t = new URL(location.href).searchParams.get('text');
    if (t && t.trim()) {
      state.source.kind = 'text';
      state.source.text.text = t.slice(0, 20);
    }
  } catch {
    /* no URL API or malformed URL: keep the default */
  }
})();

// ------------------------------------------------------------------ bench: viewer, toolbar, busy pill
const benchEl = $('ck-viewer');
const viewer = new Viewer(benchEl);

const view = {
  exploded: false,
  showSwitch: false,
  cutOpen: false,
  grid: true,
  callouts: true,
};

const callIf = (name, ...args) => {
  if (typeof viewer[name] === 'function') viewer[name](...args);
};

callIf('setGrid', view.grid);
callIf('setCallouts', view.callouts);

// Reference switch: rebuilt from the params that shape it (one per switch position), only while shown.
let switchKey = '';
function syncReferenceSwitch(params, positions = session.getResult()?.assembly?.switchPositions) {
  if (!view.showSwitch) return;
  const key = JSON.stringify([params.switch, params.body, params.fit, params.cap, positions || null]);
  if (key === switchKey) return;
  switchKey = key;
  try {
    viewer.setReferenceSwitch(buildReferenceSwitch(params, positions));
  } catch (err) {
    console.error('[clicker] reference switch failed', err);
  }
}

for (const input of document.querySelectorAll('#ck-view-mode input')) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    view.exploded = input.value === 'exploded';
    viewer.setExploded(view.exploded);
    viewer.fit(); // the lifted cap needs a wider frame; the view direction is reset by design
  });
}

function wireToggle(id, key, apply) {
  const btn = $(id);
  btn.setAttribute('aria-pressed', view[key] ? 'true' : 'false');
  btn.addEventListener('click', () => {
    view[key] = !view[key];
    btn.setAttribute('aria-pressed', view[key] ? 'true' : 'false');
    apply(view[key]);
  });
}

wireToggle('ck-tool-switch', 'showSwitch', (on) => {
  if (on) {
    switchKey = '';
    syncReferenceSwitch(session.getResult()?.params || state.params);
  }
  viewer.setShowSwitch(on);
});
wireToggle('ck-tool-cut', 'cutOpen', (on) => viewer.setCutOpen(on));
wireToggle('ck-tool-grid', 'grid', (on) => callIf('setGrid', on));
wireToggle('ck-tool-callouts', 'callouts', (on) => callIf('setCallouts', on));

// Building… pill: shown after a short grace so sub-100 ms rebuilds don't flash it.
const busyEl = $('ck-busy');
let busyTimer = 0;
function setBusy(on) {
  clearTimeout(busyTimer);
  busyTimer = 0;
  if (on) busyTimer = setTimeout(() => (busyEl.hidden = false), 120);
  else busyEl.hidden = true;
}

// ------------------------------------------------------------------ dock: summary, warnings, exports, project files
const summaryEl = $('ck-summary');
const slipEl = $('ck-slip');
const benchEmpty = $('ck-bench-empty');
const btn3mf = $('ck-download-3mf');
const btnStl = $('ck-download-stl');
const btnSave = $('ck-save');
const btnLoad = $('ck-load');
const loadInput = $('ck-load-file');

// Engine messages that describe an empty design belong on the header card, not the slip.
const EMPTY_WARNINGS = new Set(['Text is empty.', 'No SVG loaded.', 'No image loaded.']);

function setSlip(messages) {
  const items = (messages || []).filter(Boolean);
  slipEl.replaceChildren(...items.map((m) => Object.assign(document.createElement('li'), { textContent: m })));
  slipEl.hidden = items.length === 0;
  syncObstacles();
}

// The viewer keeps its mm callout labels clear of whatever floats over the bench:
// the export dock (and its warning slip while shown). Rects are canvas-local; on
// phones the dock sits outside the bench, so nothing overlaps and the list is empty.
const dockEl = slipEl.closest('.dock');
function syncObstacles() {
  if (typeof viewer.setObstacles !== 'function') return;
  const c = benchEl.getBoundingClientRect();
  const rects = [];
  for (const el of [dockEl, slipEl]) {
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    const left = Math.max(r.left, c.left) - c.left;
    const top = Math.max(r.top, c.top) - c.top;
    const right = Math.min(r.right, c.right) - c.left;
    const bottom = Math.min(r.bottom, c.bottom) - c.top;
    if (right > left && bottom > top) rects.push({ left, top, right, bottom });
  }
  viewer.setObstacles(rects);
}
new ResizeObserver(() => syncObstacles()).observe(benchEl);
if (dockEl) new ResizeObserver(() => syncObstacles()).observe(dockEl);
syncObstacles();

function setSummary(result) {
  const b = result?.bounds;
  if (!b) return;
  const dims = `${fmt(b.x)} × ${fmt(b.y)} × ${fmt(b.z)} mm`;
  const n = result.parts?.length || 0;
  summaryEl.replaceChildren(
    Object.assign(document.createElement('strong'), { textContent: dims }),
    document.createTextNode(`${n} ${n === 1 ? 'part' : 'parts'} · fits Cherry MX`),
  );
}

let exporting = false;
function setExporting(on, label) {
  exporting = on;
  btn3mf.disabled = on;
  btnStl.disabled = on;
  btn3mf.firstChild.textContent = on ? `${label}… ` : 'Download 3MF ';
}

// ---- name slip: every download is named by the user before the file is written
const nameForm = $('ck-name-form');
const nameInput = $('ck-name');
const nameExt = $('ck-name-ext');
const nameErr = $('ck-name-err');
const nameCancel = $('ck-name-cancel');
let pendingKind = null;

/** File-safe stem: letters, digits, dash, underscore; spaces become dashes. */
function cleanStem(raw) {
  return String(raw || '')
    .trim()
    .replace(/\.(3mf|zip|stl)$/i, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** A sensible default built from what is on the cap and how big it is. */
function suggestedStem() {
  const s = state.source;
  let base = '';
  if (s.kind === 'text') base = s.text?.text || '';
  else if (s.kind === 'svg') base = (s.svg?.fileName || '').replace(/\.svg$/i, '');
  else if (s.kind === 'image') base = (s.image?.fileName || '').replace(/\.[a-z0-9]+$/i, '');
  else if (s.kind === 'sample') base = s.sample?.id || '';
  const size = Math.round(Number(state.params.base.size) || 0);
  const stem = cleanStem(base).toLowerCase();
  return `${stem ? `${stem}-` : ''}clicker-${size}mm`;
}

function extFor(kind) {
  return kind === '3mf' ? '.3mf' : '-stl.zip';
}

function openNamer(kind) {
  pendingKind = kind;
  nameExt.textContent = extFor(kind);
  nameErr.hidden = true;
  if (nameForm.hidden || !nameInput.value.trim()) nameInput.value = suggestedStem();
  nameForm.hidden = false;
  nameInput.focus();
  nameInput.select();
}

function closeNamer() {
  pendingKind = null;
  nameForm.hidden = true;
  nameErr.hidden = true;
}

nameCancel.addEventListener('click', () => {
  closeNamer();
  btn3mf.focus();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeNamer();
    btn3mf.focus();
  }
});
nameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const stem = cleanStem(nameInput.value);
  if (!stem) {
    nameErr.textContent = 'Give the file a name first (letters, numbers, dashes).';
    nameErr.hidden = false;
    nameInput.focus();
    return;
  }
  const kind = pendingKind;
  closeNamer();
  writeExport(kind, stem);
});

function runExport(kind) {
  if (exporting) return;
  if (!session.getResult()) {
    setSlip(['Nothing to download yet: the first build has not finished.']);
    return;
  }
  openNamer(kind);
}

async function writeExport(kind, stem) {
  if (exporting) return;
  setExporting(true, kind === '3mf' ? 'Preparing 3MF' : 'Zipping STL');
  try {
    if (kind === '3mf') await session.exportThreeMF(`${stem}.3mf`);
    else await session.exportStlZip(`${stem}-stl.zip`);
  } catch (err) {
    console.error('[clicker] export failed', err);
    setSlip([`Couldn't make the ${kind === '3mf' ? '3MF' : 'STL zip'}: ${err?.message || err}`]);
  } finally {
    setExporting(false);
  }
}

btn3mf.addEventListener('click', () => runExport('3mf'));
btnStl.addEventListener('click', () => runExport('stl'));

btnSave.addEventListener('click', () => {
  const blob = new Blob([serialize()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const name = state.source.kind === 'text' && state.source.text.text ? state.source.text.text : 'clicker';
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'clicker'}.clicker.json`;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
});

btnLoad.addEventListener('click', () => loadInput.click());
loadInput.addEventListener('change', async () => {
  const file = loadInput.files?.[0];
  loadInput.value = '';
  if (!file) return;
  try {
    deserialize(await file.text());
    setSlip([]);
  } catch (err) {
    setSlip([`Couldn't load “${file.name}”: ${err?.message || 'not a clicker project file.'}`]);
  }
});

// ------------------------------------------------------------------ the rail
const rail = initRail($('rail'));

// ------------------------------------------------------------------ session: state → geometry → bench
const session = createSession({
  onStatus(s) {
    setBusy(s === 'deriving' || s === 'building');
  },
  onResult(result) {
    viewer.setModel({ parts: result.parts, bounds: result.bounds, assembly: result.assembly });
    syncReferenceSwitch(result.params, result.assembly?.switchPositions);
    setSummary(result);
    rail.setSpec(result.spec);
    rail.setAssembly(result.assembly);
    const warnings = (result.warnings || []).filter((w) => !EMPTY_WARNINGS.has(w));
    setSlip(warnings);
    const empty = !result.spec || !result.spec.shapes?.length;
    benchEmpty.textContent = empty ? 'The cap is blank. Put something on it from the Clicker card.' : '';
    benchEmpty.hidden = !empty;
  },
  onError(err, { phase }) {
    setSlip([`${phase === 'derive' ? "Couldn't read the design" : "Couldn't build the clicker"}: ${err?.message || err}`]);
  },
});

let lastSource = '';
let lastParams = '';
function pushState(s) {
  const src = JSON.stringify(s.source);
  const prm = JSON.stringify(s.params);
  if (src !== lastSource) {
    lastSource = src;
    session.setSource(s.source);
  }
  if (prm !== lastParams) {
    lastParams = prm;
    session.setParams(s.params);
  }
}

subscribe((s) => pushState(s));
pushState(state);
session.rebuild();

// ------------------------------------------------------------------ shortcuts
const isTyping = (el) => el && (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'file'].includes(el.type) || el.tagName === 'TEXTAREA' || el.isContentEditable);

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (isTyping(document.activeElement)) return; // native text undo wins inside a field
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((k === 'z' && e.shiftKey) || k === 'y') {
    e.preventDefault();
    redo();
  }
});

// ------------------------------------------------------------------ teardown
window.addEventListener('pagehide', () => {
  session.dispose();
  viewer.dispose();
});
