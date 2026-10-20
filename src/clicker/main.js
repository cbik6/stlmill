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

// Reference switch: rebuilt from the params that shape it, only while shown.
let switchKey = '';
function syncReferenceSwitch(params) {
  if (!view.showSwitch) return;
  const key = JSON.stringify([params.switch, params.body, params.fit, params.cap]);
  if (key === switchKey) return;
  switchKey = key;
  try {
    viewer.setReferenceSwitch(buildReferenceSwitch(params));
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
}

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

async function runExport(kind) {
  if (exporting) return;
  if (!session.getResult()) {
    setSlip(['Nothing to download yet: the first build has not finished.']);
    return;
  }
  const size = Math.round(Number(state.params.base.size) || 0);
  setExporting(true, kind === '3mf' ? 'Preparing 3MF' : 'Zipping STL');
  try {
    if (kind === '3mf') await session.exportThreeMF(`clicker-${size}mm.3mf`);
    else await session.exportStlZip(`clicker-${size}mm-stl.zip`);
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
    syncReferenceSwitch(result.params);
    setSummary(result);
    rail.setSpec(result.spec);
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
