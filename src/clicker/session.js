// Build session: turns UI state (source + params) into engine results.
//
//   const session = createSession({ onStatus, onResult, onError, debounceMs });
//   session.setSource(state.source);   // derives a DesignSpec (cached per source), then rebuilds
//   session.setParams(state.params);   // debounced rebuild
//   session.rebuild();                 // immediate rebuild (still single-flight)
//   session.getResult();               // last { parts, bounds, warnings, assembly, params, spec } | null
//   session.getSpec();                 // last derived DesignSpec | null
//   session.exportThreeMF(filename);   // Promise<Blob>, also triggers a browser download
//   session.exportStlZip(filename);    // Promise<Blob>, also triggers a browser download
//   session.dispose();
//
// Callbacks: onStatus('idle'|'deriving'|'building'|'error'), onResult(result), onError(error, { phase })
//
// Single-flight: never two engine builds at once. A change that arrives mid-build is
// coalesced into exactly one follow-up build with the latest params/spec. Errors never
// leave the session stuck: status returns to 'idle' and the previous result stays valid.

import {
  buildClicker,
  exportThreeMF as engineExportThreeMF,
  exportStlZip as engineExportStlZip,
  makeDesignFromText,
  makeDesignFromSvg,
  makeDesignFromImage,
} from './engine/index.js';

const TEXT_SIZE = 256;
const tick = () => new Promise((r) => setTimeout(r, 0));

function sourceKey(source) {
  if (!source || !source.kind) return 'none';
  const branch = source[source.kind];
  return source.kind + ':' + JSON.stringify(branch ?? null);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image.'));
    img.src = dataUrl;
  });
}

async function deriveSpec(source) {
  const kind = source?.kind;
  if (kind === 'text') {
    const t = source.text || {};
    return makeDesignFromText(t.text ?? '', {
      fontFamily: t.fontFamily || 'Arial',
      weight: t.bold ? '800' : '400',
      size: TEXT_SIZE,
    });
  }
  if (kind === 'svg') {
    const svgText = source.svg?.svgText || '';
    if (!svgText.trim()) return { shapes: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, warnings: ['No SVG loaded.'] };
    return makeDesignFromSvg(svgText);
  }
  if (kind === 'image') {
    const im = source.image || {};
    if (!im.dataUrl) return { shapes: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, warnings: ['No image loaded.'] };
    const img = await loadImage(im.dataUrl);
    return makeDesignFromImage(img, {
      threshold: im.threshold ?? 128,
      invert: !!im.invert,
      removeBackground: im.removeBackground !== false,
      smoothing: im.smoothing ?? 1,
    });
  }
  if (kind === 'sample') {
    const id = String(source.sample?.id || 'heart').replace(/[^\w-]/g, '');
    const url = new URL(`./samples/${id}.svg`, import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sample "${id}" could not be loaded (${res.status}).`);
    return makeDesignFromSvg(await res.text());
  }
  throw new Error(`Unknown design source "${kind}".`);
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
  let spec = null; // spec for the current sourceKey (may be null until derived)
  let currentKey = 'none';
  const specCache = new Map(); // sourceKey -> DesignSpec

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

  async function runOnce() {
    // ---- derive (only when the active source has no cached spec)
    let activeSpec = specCache.get(currentKey);
    if (activeSpec === undefined && source) {
      setStatus('deriving');
      const src = source;
      const key = currentKey;
      try {
        activeSpec = await deriveSpec(src);
      } catch (err) {
        fail(err, 'derive');
        return;
      }
      if (disposed) return;
      specCache.set(key, activeSpec);
      if (key !== currentKey) return; // superseded while deriving; the loop runs again
    }
    spec = activeSpec ?? null;

    // Yield so the UI can paint the spinner before the heavy build starts.
    await tick();
    if (disposed) return;
    if (!params) {
      setStatus('idle');
      return;
    }

    // ---- build
    setStatus('building');
    const buildParams = { ...params, design: { ...(params.design || {}), spec } };
    const usedSpec = spec;
    let built;
    try {
      buildCount++;
      built = await buildClicker(buildParams);
    } catch (err) {
      fail(err, 'build');
      return;
    }
    if (disposed) {
      disposeResult(built);
      return;
    }

    const warnings = [...new Set([...(usedSpec?.warnings || []), ...(built.warnings || [])])];
    const previous = result;
    result = { ...built, warnings, params: buildParams, spec: usedSpec };
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
    const name = String(filename || `clicker${fallbackExt}`);
    const base = name.replace(/\.(3mf|zip)$/i, '') || 'clicker';
    const blob = await fn(result.parts, { name: base });
    triggerDownload(blob, name);
    return blob;
  }

  return {
    setSource(next) {
      if (disposed) return;
      source = next ? JSON.parse(JSON.stringify(next)) : null;
      currentKey = sourceKey(source);
      const cached = specCache.get(currentKey);
      if (cached !== undefined) spec = cached;
      // Source changes come from discrete actions (typing aside), so they rebuild promptly;
      // typing still coalesces through the single-flight loop.
      schedule(false);
    },
    setParams(next) {
      if (disposed) return;
      params = next ? JSON.parse(JSON.stringify(next)) : null;
      if (params?.design) params.design.spec = null; // the spec is merged in at build time
      schedule(false);
    },
    rebuild() {
      if (disposed) return;
      schedule(true);
    },
    getResult: () => result,
    getSpec: () => spec,
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
      specCache.clear();
    },
  };
}
