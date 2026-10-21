// Character Cap: boots the page. State (state.js) is the single source of truth; the
// session (session.js) turns it into geometry; the Clicker's bench renderer (viewer.js)
// shows it; ui.js owns the rail. This file wires the four together plus the bench
// toolbar, the export dock, the character thumbnails and the shortcuts.

import '../shared/base.css';
import './charcap.css';
import * as THREE from 'three';
import { initTheme } from '../shared/theme.js';
import { state, subscribe, undo, redo, serialize, deserialize, hasUnsavableUpload } from './state.js';
import { createSession, sampleLabel } from './session.js';
import { Viewer } from '../clicker/viewer.js';
import { buildReferenceSwitch, MX } from '../clicker/engine/index.js';
import { SAMPLES } from './samples/index.js';
import { initRail, fmt } from './ui.js';

initTheme();

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ bench: viewer, toolbar, busy pill
const benchEl = $('cc-viewer');
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

/** The clicker engine's switch params for our socket group (the same mapping makeCap uses). */
function clickerParamsFor(p) {
  const s = p.socket;
  return {
    body: { height: p.body.height, rimHeight: p.body.rimHeight, wall: p.body.wall },
    fit: { clearance: p.fit.clearance, switchTolerance: p.fit.switchTolerance },
    switch: {
      socketMode: s.mode,
      stemCrossWidth: s.crossWidth + s.fit,
      stemCrossThickness: s.crossThickness + s.fit,
      socketOpening: s.opening + s.fit,
      roundDiameter: s.roundDiameter + s.fit,
    },
    keychain: { enabled: false },
  };
}

// Reference switch: with a body it sits in the body (the engine positions it); without one it
// is a bare switch standing on the plate, and the cap is lifted so the stem enters its socket.
let switchKey = '';
let bareCapZ = 0; // z of the cap bottom when it sits on a bare switch
function syncReferenceSwitch(result) {
  if (!view.showSwitch || !result) return false;
  const p = result.params;
  const key = JSON.stringify([p.socket, p.body, p.fit, p.withBody, result.assembly.socketDepth]);
  if (key === switchKey) return false;
  switchKey = key;
  try {
    const geo = buildReferenceSwitch(clickerParamsFor(p));
    if (!p.withBody) {
      geo.computeBoundingBox();
      const housingBottom = geo.boundingBox.min.z + MX.PIN_LENGTH; // pins hang below the plate
      const housingTop = geo.boundingBox.max.z - MX.STEM_HEIGHT;
      geo.translate(0, 0, -housingBottom);
      geo.computeBoundingBox();
      // The cap rests on the upper housing unless its socket is shallower than the stem.
      bareCapZ = housingTop - housingBottom + Math.max(0, MX.STEM_HEIGHT - result.assembly.socketDepth);
    }
    viewer.setReferenceSwitch(geo);
  } catch (err) {
    console.error('[character-cap] reference switch failed', err);
  }
  return true;
}

/**
 * Put a build on the bench. The engine's parts are already in the assembled frame: the cap (with
 * its face) stands on z = 0, the optional body rests on z = 0 under it with the cap at
 * assembly.capZ. The viewer lifts parts named 'cap' / 'design' to capZ, so the face is renamed.
 */
function showResult(result) {
  const p = result.params;
  const hasBody = !!p.withBody;
  const bare = view.showSwitch && !hasBody;
  const capZ = hasBody ? result.assembly.capZ : bare ? bareCapZ : 0;
  const parts = result.parts.map((part) => ({ ...part, name: part.name === 'face' ? 'design' : part.name }));
  const cap = result.bounds;
  const body = result.assembly.body?.bounds;
  const bounds = {
    x: Math.max(cap.x, body?.x || 0, bare ? MX.FLANGE : 0),
    y: Math.max(cap.y, body?.y || 0, bare ? MX.FLANGE : 0),
    z: capZ + cap.z,
  };
  viewer.setModel({ parts, bounds, assembly: { capZ, capBounds: cap } });
  // Cut open should show the socket inside the character, not only the body: make the cap clippable too.
  viewer.capGroup.traverse((o) => {
    if (o.isMesh && o.material && !viewer.clippedMaterials.includes(o.material)) {
      o.material.userData.clippable = true;
      viewer.clippedMaterials.push(o.material);
    }
  });
  viewer.setCutOpen(view.cutOpen);
  // Exploded lifts the cap off whatever it sits on; with nothing underneath there is nothing to lift from.
  viewer.setExploded(view.exploded && (hasBody || bare));
}

for (const input of document.querySelectorAll('#cc-view-mode input')) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    view.exploded = input.value === 'exploded';
    const r = session.getResult();
    if (r) showResult(r);
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

wireToggle('cc-tool-switch', 'showSwitch', (on) => {
  const r = session.getResult();
  if (on) {
    switchKey = '';
    syncReferenceSwitch(r);
  }
  viewer.setShowSwitch(on);
  if (r && !r.params.withBody) {
    showResult(r); // the cap climbs onto (or back off) the bare switch
    viewer.fit();
  }
});
wireToggle('cc-tool-cut', 'cutOpen', (on) => viewer.setCutOpen(on));
wireToggle('cc-tool-grid', 'grid', (on) => callIf('setGrid', on));
wireToggle('cc-tool-callouts', 'callouts', (on) => callIf('setCallouts', on));

// Busy pill: shown after a short grace so sub-100 ms rebuilds don't flash it.
const busyEl = $('cc-busy');
const busyText = $('cc-busy-text');
let busyTimer = 0;
function setBusy(on, label = 'Building…') {
  clearTimeout(busyTimer);
  busyTimer = 0;
  busyText.textContent = label;
  if (on) busyTimer = setTimeout(() => (busyEl.hidden = false), 120);
  else busyEl.hidden = true;
}

// ------------------------------------------------------------------ dock: summary, warnings, exports, project files
const summaryEl = $('cc-summary');
const slipEl = $('cc-slip');
const benchEmpty = $('cc-bench-empty');
const btn3mf = $('cc-download-3mf');
const btnStl = $('cc-download-stl');
const btnSave = $('cc-save');
const btnLoad = $('cc-load');
const loadInput = $('cc-load-file');

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

/** Assembled size of what gets printed (cap, or cap seated on its body). */
function printedDims(result) {
  const cap = result.bounds;
  const body = result.assembly.body?.bounds;
  if (!result.params.withBody || !body) return cap;
  return { x: Math.max(cap.x, body.x), y: Math.max(cap.y, body.y), z: result.assembly.capZ + cap.z };
}

function setSummary(result) {
  const b = printedDims(result);
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

const slug = (s) => String(s || '').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'character';

function fileBase() {
  const name = state.source.kind === 'upload' ? slug(state.source.upload.name) : state.source.sample.id;
  return `${name}-cap-${Math.round(Number(state.params.width) || 0)}mm`;
}

async function runExport(kind) {
  if (exporting) return;
  if (!session.getResult()) {
    setSlip(['Nothing to download yet: the first build has not finished.']);
    return;
  }
  setExporting(true, kind === '3mf' ? 'Preparing 3MF' : 'Zipping STL');
  try {
    if (kind === '3mf') await session.exportThreeMF(`${fileBase()}.3mf`);
    else await session.exportStlZip(`${fileBase()}-stl.zip`);
  } catch (err) {
    console.error('[character-cap] export failed', err);
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
  a.href = url;
  a.download = `${fileBase()}.character-cap.json`;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
  if (hasUnsavableUpload()) {
    setSlip([`The project file keeps your settings but not “${state.source.upload.name}” itself: drop that file on the Character card again after loading.`]);
  }
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
    setSlip([`Couldn't load “${file.name}”: ${err?.message || 'not a Character Cap project file.'}`]);
  }
});

// ------------------------------------------------------------------ the rail
const rail = initRail($('rail'), {
  onUpload(file, token, buffer, type) {
    session.registerUpload(token, { buffer, type, name: file.name });
  },
});

// ------------------------------------------------------------------ session: state → geometry → bench
let firstResult = true;
const session = createSession({
  onStatus(s) {
    if (s === 'init') setBusy(true, 'Starting the mill…');
    else setBusy(s === 'deriving' || s === 'building');
  },
  onResult(result) {
    syncReferenceSwitch(result);
    showResult(result);
    setSummary(result);
    rail.setAssembly(result.assembly);
    setSlip(result.warnings);
    if (result.character.kind === 'upload') rail.setUploadError(''); // this file built: it is no longer refused
    benchEmpty.hidden = true;
    if (firstResult) {
      firstResult = false;
      paintThumbnails();
    }
  },
  onError(err, { phase }) {
    const msg = err?.message || String(err);
    if (phase === 'init') {
      benchEmpty.textContent = 'The mill could not start: this browser blocks WebAssembly. Try a current Chrome, Edge, Firefox or Safari.';
      benchEmpty.hidden = false;
      return;
    }
    if (phase === 'character' && state.source.kind === 'upload') {
      rail.setUploadError(msg);
      setSlip(session.getResult() ? [`“${state.source.upload.name}” was refused; still showing the last good character. The Character card says why.`] : [msg]);
      return;
    }
    const lead = { character: "Couldn't read the character", face: "Couldn't read the face", build: "Couldn't build the cap" }[phase] || "Couldn't build the cap";
    setSlip([`${lead}: ${msg}`]);
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

// ------------------------------------------------------------------ character thumbnails
// Each built-in character is rendered once, from the bench's readable pose, into the small
// canvases on its tile: one in ink for the resting tile, one lit for the pressed (ink) tile.
// Runs after the first cap is on the bench so it never delays the object.
const THUMB = 96;
const THUMB_AZ = THREE.MathUtils.degToRad(145);
const THUMB_EL = THREE.MathUtils.degToRad(28);

async function paintThumbnails() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (err) {
    console.warn('[character-cap] no thumbnails: WebGL renderer unavailable', err);
    return; // the tiles keep their names
  }
  renderer.setPixelRatio(1);
  renderer.setSize(THUMB, THUMB, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 500);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a1a, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(-40, -60, 90);
  scene.add(key);
  const tones = [
    ['ink', new THREE.MeshStandardMaterial({ color: 0x2b2521, roughness: 0.6, metalness: 0.05 })],
    ['lit', new THREE.MeshStandardMaterial({ color: 0xffb37a, roughness: 0.55, metalness: 0.05 })],
  ];
  const t0 = performance.now();
  try {
    for (const s of SAMPLES) {
      const tile = rail.tiles.find((t) => t.dataset.id === s.id);
      if (!tile) continue;
      let geo;
      try {
        geo = (await session.loadSample(s.id)).clone();
      } catch (err) {
        console.warn(`[character-cap] thumbnail for ${s.id} skipped`, err);
        continue;
      }
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      const size = new THREE.Vector3();
      b.getSize(size);
      const centre = new THREE.Vector3();
      b.getCenter(centre);
      const radius = size.length() / 2;
      const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.95;
      camera.position.set(Math.sin(THUMB_AZ) * Math.cos(THUMB_EL), Math.cos(THUMB_AZ) * Math.cos(THUMB_EL), Math.sin(THUMB_EL)).multiplyScalar(dist).add(centre);
      camera.lookAt(centre);
      camera.updateProjectionMatrix();
      for (const [tone, mat] of tones) {
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        renderer.render(scene, camera);
        scene.remove(mesh);
        const canvas = tile.querySelector(`canvas[data-tone="${tone}"]`);
        if (canvas) {
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, THUMB, THUMB);
          ctx.drawImage(renderer.domElement, 0, 0, THUMB, THUMB);
        }
      }
      geo.dispose();
      tile.classList.add('has-art');
    }
    console.info(`[character-cap] thumbnails painted in ${Math.round(performance.now() - t0)} ms`);
  } finally {
    for (const [, mat] of tones) mat.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
}

// ------------------------------------------------------------------ shortcuts
const isTyping = (el) =>
  el && ((el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'file'].includes(el.type)) || el.tagName === 'TEXTAREA' || el.isContentEditable);

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

// Expose the build timing for the page's own checks (no UI).
window.__charcap = { session, viewer, sampleLabel };

// ------------------------------------------------------------------ teardown
window.addEventListener('pagehide', () => {
  session.dispose();
  viewer.dispose();
});
