// Single source of truth for the Character Cap UI.
//
//   state = { params, source }
//
// `params` mirrors the charcap engine's DEFAULT_PARAMS *minus* the computed face spec
// (`params.face.spec` is always null here; session.js derives the spec from `source.face`
// and injects it right before calling makeCap).
// `source` says where the character and its face come from so a project can be re-created.
// An uploaded mesh's bytes are NOT part of the state (they would bloat every undo snapshot
// and cannot be serialised); session.js keeps them in memory under `source.upload.token`.

import { DEFAULT_PARAMS } from './engine/index.js';

const MAX_HISTORY = 50;
export const PROJECT_VERSION = 1;

export const DEFAULT_SOURCE = {
  kind: 'sample', // 'sample' | 'upload'
  sample: { id: 'pumpkin' },
  upload: { name: '', type: '', token: '' },
  face: {
    kind: 'sample', // 'text' | 'svg' | 'sample'
    text: { text: 'BOO', fontFamily: 'Barlow Semi Condensed', bold: true },
    svg: { svgText: '', fileName: '' },
    sample: { id: 'smiley' },
  },
};

export const clone = (v) =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(target[k])) deepMerge(target[k], v);
    else target[k] = isPlainObject(v) ? clone(v) : v;
  }
  return target;
}

function stripSpec(params) {
  const p = clone(params);
  p.face = { ...(p.face || {}), spec: null };
  return p;
}

export function defaultParams() {
  return stripSpec(DEFAULT_PARAMS);
}

export const state = {
  params: defaultParams(),
  source: clone(DEFAULT_SOURCE),
};

// ---------------------------------------------------------------- history
const past = [];
const future = [];
let pendingBase = null; // snapshot taken before a run of transient (slider-drag) updates
const listeners = new Set();

function snapshot() {
  return clone(state);
}

function restore(snap) {
  state.params = clone(snap.params);
  state.source = clone(snap.source);
}

function pushPast(snap) {
  past.push(snap);
  if (past.length > MAX_HISTORY) past.shift();
}

function notify(meta) {
  for (const fn of listeners) {
    try {
      fn(state, meta);
    } catch (err) {
      console.error('[state] listener failed', err);
    }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Deep-merge `patch` into state.
 * opts.transient = true  -> change is live (e.g. slider drag) and is not yet an
 *                           undo step; call commit() (or a non-transient update)
 *                           to seal it into one history entry.
 */
export function update(patch, opts = {}) {
  const { transient = false, reason = 'update' } = opts;
  if (!pendingBase) pendingBase = snapshot();
  deepMerge(state, patch);
  if (!transient) {
    pushPast(pendingBase);
    pendingBase = null;
    future.length = 0;
  }
  notify({ transient, reason, patch });
}

export function commit() {
  if (!pendingBase) return;
  pushPast(pendingBase);
  pendingBase = null;
  future.length = 0;
  notify({ transient: false, reason: 'commit', patch: null });
}

export function replace(next, reason = 'replace') {
  commit();
  pushPast(snapshot());
  future.length = 0;
  restore(next);
  notify({ transient: false, reason, patch: null });
}

export function undo() {
  commit();
  if (!past.length) return false;
  future.push(snapshot());
  restore(past.pop());
  notify({ transient: false, reason: 'undo', patch: null });
  return true;
}

export function redo() {
  commit();
  if (!future.length) return false;
  pushPast(snapshot());
  restore(future.pop());
  notify({ transient: false, reason: 'redo', patch: null });
  return true;
}

export function reset() {
  replace({ params: defaultParams(), source: clone(DEFAULT_SOURCE) }, 'reset');
}

export const canUndo = () => past.length > 0 || pendingBase !== null;
export const canRedo = () => future.length > 0;

// ---------------------------------------------------------------- paths
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function patchFromPath(path, value) {
  const keys = path.split('.');
  const root = {};
  let cur = root;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else cur = cur[k] = {};
  });
  return root;
}

export function setParam(path, value, opts) {
  update({ params: patchFromPath(path, value) }, opts);
}

// ---------------------------------------------------------------- project files
// An uploaded mesh cannot travel in the project file (only its name does); the UI warns on save
// and the session asks for the file again on load.
export const hasUnsavableUpload = () => state.source.kind === 'upload' && !!state.source.upload.name;

export function serialize() {
  const source = clone(state.source);
  source.upload = { ...source.upload, token: '' }; // tokens are per-session
  return JSON.stringify(
    {
      app: 'stlmill-character-cap',
      version: PROJECT_VERSION,
      savedAt: new Date().toISOString(),
      params: stripSpec(state.params),
      source,
    },
    null,
    2,
  );
}

export function deserialize(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || typeof data !== 'object' || !data.params || data.app !== 'stlmill-character-cap') {
    throw new Error('Not a Character Cap project file.');
  }
  const params = deepMerge(defaultParams(), stripSpec(data.params));
  const source = deepMerge(clone(DEFAULT_SOURCE), data.source || {});
  if (!['sample', 'upload'].includes(source.kind)) source.kind = 'sample';
  if (!['text', 'svg', 'sample'].includes(source.face.kind)) source.face.kind = 'sample';
  replace({ params, source }, 'load');
}
