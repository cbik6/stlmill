// Build session: turns UI state (source + params) into Character Cap engine results.
//
//   const session = createSession({ onStatus, onResult, onError, debounceMs });
//   session.setSource(state.source);       // (re)derives the character + face spec (both cached), then rebuilds
//   session.setParams(state.params);       // debounced rebuild
//   session.rebuild();                     // immediate rebuild (still single-flight)
//   session.registerUpload(token, { buffer, type, name });  // bytes for source.upload.token (memory only)
//   session.loadSample(id);                // Promise<BufferGeometry>, shares the character cache (thumbnails)
//   session.getResult();                   // last { parts, bounds, warnings, assembly, params, spec, character } | null
//   session.exportThreeMF(filename);       // Promise<Blob>, also triggers a browser download
//   session.exportStlZip(filename);        // Promise<Blob>, also triggers a browser download
//   session.dispose();
//
// Callbacks: onStatus('idle'|'init'|'deriving'|'building'|'error'), onResult(result), onError(error, { phase })
//   phase: 'init' (WASM failed to load) | 'character' (sample/upload could not be read or is not a closed
//          solid) | 'face' (design could not be derived) | 'build' (makeCap threw)
//
// Single-flight: never two engine builds at once. A change that arrives mid-build is coalesced into
// exactly one follow-up build with the latest params/spec. Errors never leave the session stuck:
// status returns to 'idle' and the previous result stays valid on the bench.

import { initBooleansForVite } from './engine/manifold-vite.js';
import { makeCap, loadMesh, makeDesignFromText, makeDesignFromSvg } from './engine/index.js';
import { toManifold } from './engine/csg.js';
import { triangleCount } from './engine/meshcheck.js';
import { exportThreeMF as engineExportThreeMF, exportStlZip as engineExportStlZip } from './engine/export.js';
import { SAMPLES, buildSample } from './samples/index.js';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_TRIANGLES = 500_000;
const SLOW_TRIANGLES = 100_000;
const TEXT_SIZE = 256;
const tick = () => new Promise((r) => setTimeout(r, 0));

// Face samples are the Clicker's own silhouettes (one language across tools).
const FACE_SAMPLE_FILES = import.meta.glob('../clicker/samples/*.svg', { query: '?raw', import: 'default', eager: true });
const FACE_SAMPLE_ORDER = ['smiley', 'heart', 'star', 'bolt', 'paw'];
const FACE_SAMPLE_LABELS = { smiley: 'Smiley', heart: 'Heart', star: 'Star', bolt: 'Bolt', paw: 'Paw' };
export const FACE_SAMPLES = Object.entries(FACE_SAMPLE_FILES)
  .map(([path, svgText]) => {
    const id = path.replace(/^.*\//, '').replace(/\.svg$/, '');
    return { id, label: FACE_SAMPLE_LABELS[id] || id, svgText };
  })
  .sort((a, b) => {
    const ia = FACE_SAMPLE_ORDER.indexOf(a.id);
    const ib = FACE_SAMPLE_ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

export const sampleLabel = (id) => SAMPLES.find((s) => s.id === id)?.label || id;

function characterKey(source) {
  if (!source) return 'none';
  if (source.kind === 'upload') return 'upload:' + (source.upload?.token || '');
  return 'sample:' + (source.sample?.id || 'pumpkin');
}

function faceKey(face) {
  if (!face || !face.kind) return 'none';
  return face.kind + ':' + JSON.stringify(face[face.kind] ?? null);
}

const EMPTY_SPEC = (warning) => ({ shapes: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, warnings: warning ? [warning] : [] });

async function deriveFace(face) {
  const kind = face?.kind;
  if (kind === 'text') {
    const t = face.text || {};
    if (!String(t.text ?? '').trim()) return EMPTY_SPEC();
    return makeDesignFromText(t.text ?? '', { fontFamily: t.fontFamily || 'Arial', weight: t.bold ? '800' : '400', size: TEXT_SIZE });
  }
  if (kind === 'svg') {
    const svgText = face.svg?.svgText || '';
    if (!svgText.trim()) return EMPTY_SPEC();
    return makeDesignFromSvg(svgText);
  }
  if (kind === 'sample') {
    const id = String(face.sample?.id || 'smiley');
    const s = FACE_SAMPLES.find((x) => x.id === id);
    if (!s) throw new Error(`Face sample "${id}" is not one of ours.`);
    return makeDesignFromSvg(s.svgText);
  }
  throw new Error(`Unknown face source "${kind}".`);
}

function triggerDownload(blob, filename) {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

function disposeResult(result) {
  if (!result) return;
  for (const p of result.parts || []) {
    try {
      p.geometry?.dispose?.();
    } catch (_) {
      /* already disposed */
    }
  }
}

export function createSession({ onStatus, onResult, onError, debounceMs = 250 } = {}) {
  let source = null;
  let params = null;
  let currentCharKey = 'none';
  let currentFaceKey = 'none';
  const characters = new Map(); // characterKey -> Promise<{ geometry, label, warnings }>
  const faces = new Map(); // faceKey -> DesignSpec
  const uploads = new Map(); // token -> { buffer, type, name }

  let ready = null; // Promise from initBooleansForVite()
  let result = null;
  let status = 'idle';
  let running = false;
  let pending = false;
  let timer = 0;
  let disposed = false;
  let buildCount = 0;

  const setStatus = (s) => {
    if (disposed || status === s) return;
    status = s;
    try {
      onStatus?.(s);
    } catch (err) {
      console.error('[session] onStatus failed', err);
    }
  };

  const fail = (error, phase) => {
    if (disposed) return;
    console.error(`[session] ${phase} failed`, error);
    setStatus('error');
    try {
      onError?.(error, { phase });
    } catch (err) {
      console.error('[session] onError failed', err);
    }
    setStatus('idle');
  };

  function init() {
    if (!ready) {
      ready = initBooleansForVite().catch((err) => {
        ready = null; // allow a retry on the next run
        throw err;
      });
    }
    return ready;
  }

  async function deriveCharacter(src) {
    if (src.kind === 'upload') {
      const u = uploads.get(src.upload?.token);
      const name = src.upload?.name || 'your file';
      if (!u) throw new Error(`“${name}” is not loaded in this tab. Drop the file on the Character card again.`);
      const loaded = await loadMesh(u.buffer, { type: u.type, name });
      const tris = triangleCount(loaded.geometry);
      if (tris > MAX_TRIANGLES) {
        throw new Error(`“${name}” has ${tris.toLocaleString()} triangles; the mill takes up to ${MAX_TRIANGLES.toLocaleString()}. Simplify it in your slicer or sculpting app and drop it again.`);
      }
      // Check for a closed solid now so the verdict lands on the Character card instead of mid-build.
      // manifold-3d 3.x throws its own terse "Not manifold" before csg.js can word it; say it plainly.
      let m;
      try {
        m = toManifold(loaded.geometry, { selfUnion: false });
      } catch (err) {
        const why = err?.message || String(err);
        if (/closed solid/i.test(why)) throw err;
        throw new Error(`“${name}” is not a closed solid (${why}). Repair it in your slicer (Bambu/Orca "Fix model", PrusaSlicer "Netfabb") or export it as one watertight shell, then drop it again.`);
      }
      m.delete();
      const warnings = [];
      if (loaded.parts.length > 1) warnings.push(`“${name}” has ${loaded.parts.length} parts; they were merged into one character.`);
      if (tris > SLOW_TRIANGLES) warnings.push(`“${name}” has ${tris.toLocaleString()} triangles, so each rebuild takes a few seconds.`);
      return { geometry: loaded.geometry, label: name, warnings };
    }
    const id = SAMPLES.some((s) => s.id === src.sample?.id) ? src.sample.id : 'pumpkin';
    const geometry = await buildSample(id);
    return { geometry, label: sampleLabel(id), warnings: [] };
  }

  function characterFor(src) {
    const key = characterKey(src);
    let p = characters.get(key);
    if (!p) {
      p = deriveCharacter(src);
      characters.set(key, p);
      p.catch(() => characters.delete(key)); // a failed load is not cached: the next drop retries
    }
    return p;
  }

  async function runOnce() {
    // ---- WASM (once)
    if (!ready) setStatus('init');
    try {
      await init();
    } catch (err) {
      fail(err, 'init');
      return;
    }
    if (disposed || !source) {
      setStatus('idle');
      return;
    }

    // ---- character (cached per sample id / upload token)
    setStatus('deriving');
    const src = source;
    const charKey = currentCharKey;
    let character;
    try {
      character = await characterFor(src);
    } catch (err) {
      fail(err, 'character');
      return;
    }
    if (disposed) return;
    if (charKey !== currentCharKey) return; // superseded while loading; the loop runs again

    // ---- face spec (cached per face source)
    const fKey = currentFaceKey;
    let spec = faces.get(fKey);
    if (spec === undefined) {
      try {
        spec = await deriveFace(src.face);
      } catch (err) {
        fail(err, 'face');
        return;
      }
      if (disposed) return;
      faces.set(fKey, spec);
      if (fKey !== currentFaceKey) return;
    }

    // Yield so the UI can paint the spinner before the heavy build starts.
    await tick();
    if (disposed) return;
    if (!params) {
      setStatus('idle');
      return;
    }

    // ---- build
    setStatus('building');
    const buildParams = { ...params, face: { ...(params.face || {}), spec } };
    let built;
    const t0 = performance.now();
    try {
      buildCount++;
      built = await makeCap(character.geometry, buildParams);
    } catch (err) {
      fail(err, 'build');
      return;
    }
    const buildMs = Math.round(performance.now() - t0);
    if (disposed) {
      disposeResult(built);
      return;
    }

    const warnings = [...new Set([...(character.warnings || []), ...(built.warnings || [])])];
    const previous = result;
    result = {
      ...built,
      warnings,
      params: buildParams,
      spec,
      character: { label: character.label, kind: src.kind, triangles: triangleCount(character.geometry) },
      buildMs,
    };
    setStatus('idle');
    try {
      onResult?.(result);
    } catch (err) {
      console.error('[session] onResult failed', err);
    }
    // The viewer has the new geometry now; free the superseded one on the next tick.
    if (previous && previous !== result) setTimeout(() => disposeResult(previous), 0);
  }

  async function run() {
    if (running) {
      pending = true; // latest wins; intermediate requests collapse into one follow-up
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        await runOnce();
      } while (pending && !disposed);
    } finally {
      running = false;
    }
  }

  function schedule(immediate) {
    if (disposed) return;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (immediate || debounceMs <= 0) {
      run();
    } else {
      timer = setTimeout(() => {
        timer = 0;
        run();
      }, debounceMs);
    }
  }

  async function doExport(fn, filename, fallbackExt) {
    if (!result) throw new Error('Nothing to export yet.');
    const name = String(filename || `character-cap${fallbackExt}`);
    const base = name.replace(/\.(3mf|zip)$/i, '') || 'character-cap';
    const blob = await fn({ parts: result.parts, assembly: result.assembly }, { name: base });
    triggerDownload(blob, name);
    return blob;
  }

  return {
    setSource(next) {
      if (disposed) return;
      source = next ? JSON.parse(JSON.stringify(next)) : null;
      currentCharKey = characterKey(source);
      currentFaceKey = faceKey(source?.face);
      schedule(false);
    },
    setParams(next) {
      if (disposed) return;
      params = next ? JSON.parse(JSON.stringify(next)) : null;
      if (params?.face) params.face.spec = null; // the spec is merged in at build time
      schedule(false);
    },
    rebuild() {
      if (disposed) return;
      schedule(true);
    },
    /** Keep an uploaded file's bytes for `token` (memory only; never serialised). */
    registerUpload(token, { buffer, type, name }) {
      if (disposed) return;
      uploads.set(token, { buffer, type, name });
      characters.delete('upload:' + token);
    },
    hasUpload: (token) => uploads.has(token),
    /** The built-in character geometry, from the same cache the builds use. */
    async loadSample(id) {
      await init();
      const c = await characterFor({ kind: 'sample', sample: { id } });
      return c.geometry;
    },
    ready: () => init(),
    getResult: () => result,
    getStatus: () => status,
    getBuildCount: () => buildCount,
    exportThreeMF(filename) {
      return doExport(engineExportThreeMF, filename, '.3mf');
    },
    exportStlZip(filename) {
      return doExport(engineExportStlZip, filename, '.zip');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = 0;
      pending = false;
      disposeResult(result);
      result = null;
      faces.clear();
      characters.clear();
      uploads.clear();
    },
  };
}
