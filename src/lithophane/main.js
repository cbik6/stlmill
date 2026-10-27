// Lithophane page: photo + settings -> preview on the bench -> named STL download.
// The preview is built from a capped grid (PREVIEW_MAX_POINTS on the long side) so sliders stay
// live; the download is rebuilt at the chosen resolution.

import '../shared/base.css';
import '../clicker/clicker.css';
import './lithophane.css';
import { initTheme } from '../shared/theme.js';
import {
  DEFAULT_PARAMS,
  RESOLUTIONS,
  PREVIEW_MAX_POINTS,
  normalizeParams,
  resolveLayout,
  sampleSize,
  lumaFromImage,
  buildLithophane,
  exportStl,
} from './engine.js';
import { LithoViewer } from './viewer.js';
import { buildGroups, fmt, get } from './ui.js';

initTheme();

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ state
let params = clone(DEFAULT_PARAMS);
const photo = { image: null, name: 'Sample photo', width: 0, height: 0, isSample: true, stem: 'sample' };

function setParam(path, value, { transient = false } = {}) {
  const keys = path.split('.');
  let o = params;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
  params = normalizeParams(params);
  schedule(transient ? 90 : 0);
}

// ------------------------------------------------------------------ sample photo (drawn here, original)
function drawSample() {
  const w = 800;
  const h = 600;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, '#3b4a63');
  sky.addColorStop(0.55, '#c9a27a');
  sky.addColorStop(1, '#f6e3c4');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // sun
  const sun = g.createRadialGradient(560, 300, 10, 560, 300, 120);
  sun.addColorStop(0, 'rgba(255,255,245,1)');
  sun.addColorStop(0.35, 'rgba(255,246,220,0.95)');
  sun.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = sun;
  g.fillRect(400, 160, 320, 300);
  // ridges, far (light) to near (dark)
  const ridge = (base, amp, seed, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      const y = base - amp * (0.55 * Math.sin(x / 97 + seed) + 0.3 * Math.sin(x / 41 + seed * 2.3) + 0.15 * Math.sin(x / 17 + seed * 5.1));
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  };
  ridge(390, 60, 1.2, '#9c8a86');
  ridge(440, 70, 2.7, '#6f6470');
  ridge(500, 55, 4.1, '#463f4c');
  ridge(560, 40, 0.4, '#25222b');
  // a pine on the near ridge
  g.fillStyle = '#15131a';
  const tree = (x, base, size) => {
    g.fillRect(x - size * 0.05, base - size * 0.2, size * 0.1, size * 0.25);
    for (let i = 0; i < 4; i++) {
      const y = base - size * 0.15 - i * size * 0.2;
      const half = size * (0.38 - i * 0.07);
      g.beginPath();
      g.moveTo(x - half, y);
      g.lineTo(x, y - size * 0.32);
      g.lineTo(x + half, y);
      g.closePath();
      g.fill();
    }
  };
  tree(150, 560, 190);
  tree(230, 575, 120);
  return c;
}

const sampleCanvas = drawSample();
function useSample() {
  photo.image = sampleCanvas;
  photo.width = sampleCanvas.width;
  photo.height = sampleCanvas.height;
  photo.name = 'Sample photo';
  photo.stem = 'sample';
  photo.isSample = true;
  $('lp-photo-img').src = sampleCanvas.toDataURL('image/png');
  syncPhoto();
  schedule(0);
}

// ------------------------------------------------------------------ header card: photo, invert
const fileErr = $('lp-file-error');
function showFileError(msg) {
  fileErr.textContent = msg || '';
  fileErr.hidden = !msg;
}

function syncPhoto() {
  $('lp-photo-name').textContent = photo.name;
  $('lp-photo-meta').textContent = photo.isSample
    ? 'Drop your own photo above. Dark areas print thick, light areas thin.'
    : `${photo.width} × ${photo.height} px · dark areas print thick, light areas thin.`;
  $('lp-sample').hidden = photo.isSample;
}

function loadFile(file) {
  if (!file) return;
  const ok = /image\/(jpe?g|png|webp)/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!ok) {
    showFileError('That file is not a JPG, PNG or WebP photo.');
    return;
  }
  showFileError('');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    photo.image = img;
    photo.width = img.naturalWidth;
    photo.height = img.naturalHeight;
    photo.name = file.name;
    photo.stem = file.name.replace(/\.[a-z0-9]+$/i, '');
    photo.isSample = false;
    $('lp-photo-img').src = url;
    syncPhoto();
    schedule(0);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showFileError('Could not read that picture. Try saving it as a JPG or PNG first.');
  };
  img.src = url;
}

const drop = $('lp-drop');
const fileInput = $('lp-file');
fileInput.addEventListener('change', () => {
  loadFile(fileInput.files?.[0]);
  fileInput.value = '';
});
for (const ev of ['dragenter', 'dragover']) {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  });
}
for (const ev of ['dragleave', 'drop']) {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
  });
}
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer?.files?.[0]));
$('lp-sample').addEventListener('click', useSample);
const invert = $('lp-invert');
invert.addEventListener('change', () => setParam('invert', invert.checked));

// ------------------------------------------------------------------ group cards
const CURVE_NAMES = { 0: 'Flat', 60: 'Gentle', 120: 'Arc', 180: 'Half', 270: 'Wrap', 360: 'Cylinder' };
const RES_LABELS = { draft: 'Draft', standard: 'Standard', fine: 'Fine' };
const frameOn = (p) => p.frame.enabled;

const GROUPS = [
  {
    id: 'size',
    title: 'Size',
    status: (p, info) => (info ? `${fmt(info.layout.totalW)} × ${fmt(info.layout.totalH)} mm · ${fmt(p.minThickness)}–${fmt(p.maxThickness)} thick` : ''),
    controls: [
      { type: 'range', path: 'height', label: 'Height', unit: 'mm', min: 30, max: 250, step: 1 },
      { type: 'range', path: 'minThickness', label: 'Thinnest (light)', unit: 'mm', min: 0.4, max: 3, step: 0.1 },
      { type: 'range', path: 'maxThickness', label: 'Thickest (dark)', unit: 'mm', min: 1, max: 6, step: 0.1 },
      // gamma < 1 thins the midtones (a brighter picture), > 1 thickens them (darker, more contrast)
      { type: 'range', path: 'gamma', label: 'Midtones', unit: '', min: 0.3, max: 3, step: 0.1 },
      { type: 'hint', text: () => 'Width follows the photo. Midtones under 1 brighten the picture, over 1 darken it.' },
    ],
  },
  {
    id: 'shape',
    title: 'Shape',
    status: (p) => (p.curve >= 359.5 ? 'Cylinder' : p.curve < 1 ? 'Flat' : `Curved ${Math.round(p.curve)}°`),
    controls: [
      {
        type: 'segmented',
        path: 'curve',
        label: 'Bend',
        numeric: true,
        options: Object.entries(CURVE_NAMES).map(([deg, name]) => [deg, name]),
      },
      { type: 'range', path: 'curve', label: 'Bend angle', unit: '°', min: 0, max: 360, step: 5 },
      { type: 'hint', text: (p) => (p.curve >= 359.5 ? 'A closed tube: stand it over a tea light or LED.' : p.curve < 1 ? 'A flat plate for a window or a frame.' : 'Curved plates stand on their own; the picture is on the outside.') },
    ],
  },
  {
    id: 'frame',
    title: 'Frame',
    status: (p) => (p.frame.enabled ? `On · ${fmt(p.frame.thickness)} mm thick` : 'Off'),
    controls: [
      { type: 'toggle', path: 'frame.enabled', label: 'Frame' },
      { type: 'range', path: 'frame.side', label: 'Side width', unit: 'mm', min: 1, max: 30, step: 0.5, when: (p) => frameOn(p) && p.curve < 359.5 },
      { type: 'range', path: 'frame.topBottom', label: 'Top & bottom', unit: 'mm', min: 1, max: 30, step: 0.5, when: frameOn },
      { type: 'range', path: 'frame.thickness', label: 'Frame thickness', unit: 'mm', min: 2, max: 10, step: 0.1, when: frameOn },
      { type: 'range', path: 'frame.chamfer', label: 'Chamfer', unit: '°', min: 10, max: 80, step: 1, when: frameOn },
      { type: 'hint', text: () => 'The frame stiffens the plate and gives it a flat edge to stand on.' },
    ],
  },
  {
    id: 'detail',
    title: 'Detail',
    status: (p, info) => (info ? `${RES_LABELS[p.resolution]} · about ${info.fullMB} MB` : RES_LABELS[p.resolution]),
    controls: [
      {
        type: 'segmented',
        path: 'resolution',
        label: 'Detail',
        options: Object.keys(RESOLUTIONS).map((k) => [k, RES_LABELS[k]]),
      },
      {
        type: 'hint',
        text: (p, info) =>
          `${RES_LABELS[p.resolution]}: a point every ${RESOLUTIONS[p.resolution]} mm${info ? `, about ${info.fullTris} triangles and ${info.fullMB} MB` : ''}. Fine needs a 0.2–0.4 mm nozzle and patience.`,
      },
    ],
  },
];

const groups = buildGroups($('lp-groups'), GROUPS, { setParam, commit: () => {} }, { storageKey: 'stlmill-lithophane-group', initial: 'size' });

$('lp-reset').addEventListener('click', () => {
  params = clone(DEFAULT_PARAMS);
  schedule(0);
});

// ------------------------------------------------------------------ bench
const viewer = new LithoViewer($('lp-viewer'));
for (const input of document.querySelectorAll('input[name="lp-look"]')) {
  input.addEventListener('change', () => input.checked && viewer.setBacklit(input.value === 'backlit'));
}
const gridBtn = $('lp-tool-grid');
gridBtn.addEventListener('click', () => {
  const on = gridBtn.getAttribute('aria-pressed') !== 'true';
  gridBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  viewer.setGrid(on);
});
$('lp-tool-fit').addEventListener('click', () => viewer.fit(false));

const busyEl = $('lp-busy');
const busyText = $('lp-busy-text');
let busyTimer = 0;
function setBusy(on, text = 'Building…') {
  clearTimeout(busyTimer);
  busyText.textContent = text;
  if (on) busyTimer = setTimeout(() => (busyEl.hidden = false), 120);
  else busyEl.hidden = true;
}

const slipEl = $('lp-slip');
function setSlip(messages) {
  const items = (messages || []).filter(Boolean);
  slipEl.replaceChildren(...items.map((m) => Object.assign(document.createElement('li'), { textContent: m })));
  slipEl.hidden = items.length === 0;
}

// ------------------------------------------------------------------ build loop
let timer = 0;
let lastInfo = null;
function schedule(delay) {
  clearTimeout(timer);
  timer = setTimeout(rebuild, delay);
}

function fullEstimate(layout) {
  const s = sampleSize(layout);
  const tris = 2 * (s.gW - 1) * (s.gH - 1) + 4 * (s.gW + s.gH);
  return {
    tris,
    fullTris: tris >= 1e6 ? `${(tris / 1e6).toFixed(1)} million` : `${Math.round(tris / 1000)} thousand`,
    fullMB: Math.max(1, Math.round((84 + tris * 50) / 1e6)),
  };
}

function rebuild() {
  if (!photo.image) return;
  setBusy(true);
  try {
    const layout = resolveLayout(params, photo.width / photo.height);
    const size = sampleSize(layout, PREVIEW_MAX_POINTS);
    const luma = lumaFromImage(photo.image, size.imgCols, size.imgRows);
    const result = buildLithophane(luma, size, layout);
    const p = layout.params;
    viewer.setModel({ geometry: result.geometry, bounds: result.bounds, minThickness: p.minThickness, maxThickness: p.maxThickness });
    result.geometry.dispose();
    const est = fullEstimate(layout);
    lastInfo = { layout, ...est, bounds: result.bounds };
    const b = result.bounds;
    $('lp-summary').replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: `${fmt(b.x)} × ${fmt(b.y)} × ${fmt(b.z)} mm` }),
      document.createTextNode(`1 part · STL about ${est.fullMB} MB`),
    );
    const warn = [];
    if (est.tris > 3e6) warn.push(`This is a big file (${est.fullTris} triangles). Pick a lower Detail or a smaller height if your slicer struggles.`);
    if (p.minThickness < 0.6) warn.push('Under 0.6 mm the thinnest areas may print with holes; 0.8 mm is safer.');
    setSlip(warn);
  } catch (err) {
    console.error('[lithophane] build failed', err);
    setSlip([`Could not build the preview: ${err?.message || err}`]);
  } finally {
    setBusy(false);
  }
  invert.checked = !!params.invert;
  groups.sync(params, lastInfo);
}

// ------------------------------------------------------------------ download (named first)
const nameForm = $('lp-name-form');
const nameInput = $('lp-name');
const nameErr = $('lp-name-err');
const dlBtn = $('lp-download');

function cleanStem(raw) {
  return String(raw || '')
    .trim()
    .replace(/\.stl$/i, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function suggestedStem() {
  const shape = params.curve >= 359.5 ? 'cylinder' : params.curve < 1 ? 'flat' : `curved${Math.round(params.curve)}`;
  const base = cleanStem(photo.stem).toLowerCase();
  return `${base ? `${base}-` : ''}lithophane-${shape}-${Math.round(params.height)}mm`;
}

function closeNamer() {
  nameForm.hidden = true;
  nameErr.hidden = true;
}

dlBtn.addEventListener('click', () => {
  if (!photo.image) return;
  nameErr.hidden = true;
  if (nameForm.hidden || !nameInput.value.trim()) nameInput.value = suggestedStem();
  nameForm.hidden = false;
  nameInput.focus();
  nameInput.select();
});
$('lp-name-cancel').addEventListener('click', () => {
  closeNamer();
  dlBtn.focus();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeNamer();
    dlBtn.focus();
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
  closeNamer();
  writeStl(stem);
});

function writeStl(stem) {
  dlBtn.disabled = true;
  dlBtn.firstChild.textContent = 'Building STL… ';
  setBusy(true, 'Building the full-detail STL…');
  // let the busy pill paint before the heavy build
  setTimeout(() => {
    try {
      const layout = resolveLayout(params, photo.width / photo.height);
      const size = sampleSize(layout);
      const luma = lumaFromImage(photo.image, size.imgCols, size.imgRows);
      const { geometry } = buildLithophane(luma, size, layout);
      const buf = exportStl(geometry, stem);
      geometry.dispose();
      const url = URL.createObjectURL(new Blob([buf], { type: 'model/stl' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `${stem}.stl` });
      document.body.append(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 2000);
    } catch (err) {
      console.error('[lithophane] export failed', err);
      setSlip([`Couldn't make the STL: ${err?.message || err}`]);
    } finally {
      setBusy(false);
      dlBtn.disabled = false;
      dlBtn.firstChild.textContent = 'Download STL ';
    }
  }, 30);
}

// ------------------------------------------------------------------ go
groups.sync(params, null);
useSample();
