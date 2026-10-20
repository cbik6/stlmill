// Public API of the Character Cap geometry engine (STLmill tool #3).
//
//   await initBooleans({ wasmUrl? })                 -> load manifold-3d once (see csg.js for Vite / Node)
//   loadMesh(data, { type })                          -> { geometry, name, parts }        (loaders.js)
//   normalizeCharacter(geometry, { width })           -> { geometry, bounds, scale }
//   await makeCap(geometry, params)                   -> { parts, bounds, warnings, assembly }
//   exportThreeMF(result, { name }) / exportStlZip(result, { name }) -> Blob   (export.js)
//   samples: buildSample(name) in ../samples/index.js
//
// Part = { name: 'cap' | 'face' | 'body', geometry: THREE.BufferGeometry (mm, Z up), color, print }
//   cap   : the sculpted character, bottom on z = 0, socket opening at the origin on the underside.
//   face  : the two-colour inlay filler; shares its frame with the cap (flush with the surface).
//   body  : the clicker engine's switch holder, resting on z = 0 in its own frame. The cap sits at
//           z = assembly.capZ in the body frame (same semantics as the clicker: cap bottom on the
//           MX upper housing, 6.6 mm above the plate).
// Print orientation = as modelled (character upright, socket down, face on the side/top). The face
// inlay on a vertical surface is an ordinary multi-colour region for the slicer.
//
// Coordinate conventions: mm, Z up. "front" is the surface facing -Y (the viewer stands at -Y
// looking toward +Y, X to the right), which is also the slicers' front view.

import * as THREE from 'three';
import { MX, buildBody, resolveHeights, socketPolygons } from '../../clicker/engine/solids.js';
import { mergeParams as mergeClickerParams } from '../../clicker/engine/index.js';
import { initBooleans, manifoldApi, toManifold, fromManifold, cylinder, loft, dispose } from './csg.js';
import { buildFace } from './face.js';
import { footprintLayout } from './body.js';
import { triangleCount, hitsAlongZ, extents } from './meshcheck.js';

export { initBooleans } from './csg.js';
export { loadMesh, parseBambuModel, typeFromFilename } from './loaders.js';
export { exportThreeMF, exportStlZip } from './export.js';
export { makeDesignFromText, makeDesignFromSvg, makeDesignFromImage, makeDesignFromShapes } from '../../clicker/engine/design.js';
export { MX };
export { THREE };

export const DEFAULT_PARAMS = {
  width: 36 /* longest XY side of the character after normalisation, mm */,
  underside: 'flat' /* 'flat' | 'hollow' */,
  flatHeight: 0 /* 'flat': cut the character at this z (mm from its own bottom) and rest it on the cut */,
  wallThickness: 2 /* 'hollow': wall left around the cavity */,
  hollowDepth: 6 /* 'hollow': cavity height from the bottom; a solid core stays around the socket */,
  // Stem socket, measured on Clark's printed caps (ghost: tapered cross 6.1->4.8 x 4 deep in a dia 6 boss;
  // pumpkin: round dia 5 glue hole). Same three modes and numbers as the clicker engine.
  socket: {
    mode: 'tapered' /* 'tapered' (cross lofted opening -> ceiling, press fit) | 'cross' (straight) | 'round' (glue) */,
    depth: 4.0 /* blind depth from the bottom, mm */,
    crossWidth: 4.1 /* cross width at the ceiling (MX stem 4.1) */,
    crossThickness: 1.3 /* arm thickness at the ceiling (MX stem 1.3) */,
    opening: 4.6 /* cross width at the opening ('tapered' only) */,
    roundDiameter: 5.0 /* 'round' only */,
    fit: 0 /* added to crossWidth / crossThickness / roundDiameter; negative = tighter */,
    bossWall: 1.5 /* minimum material around the socket; a boss of dia (socket + 2*bossWall) is unioned when needed */,
  },
  face: {
    spec: null /* DesignSpec from makeDesignFromSvg / Text / Image, or null */,
    direction: 'front' /* 'front' (-Y surface, projected along +Y) | 'top' (+Z surface, projected along -Z) */,
    depth: 0.8 /* inlay thickness along the projection axis, mm */,
    width: 50 /* design long side as % of the character width */,
    offset: { x: 0, y: 0 } /* mm shift in the projection plane (y = up on the front, +Y on the top) */,
  },
  withBody: false /* add the clicker engine's switch holder under the cap */,
  body: { height: 18.5, rimHeight: 7.0, wall: 2.5, size: 0 /* 0 = fit the character footprint; else a circle of this diameter */ },
  fit: { clearance: 0.3 /* cap-to-recess gap per side */, switchTolerance: 0.15 },
  colors: { cap: '#f07a2a', face: '#2b2b2b', body: '#2b2b2b' },
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Deep-merge user params over DEFAULT_PARAMS (face.spec passed by reference; NaN numbers -> defaults). */
export function mergeParams(params = {}) {
  const merge = (def, usr) => {
    const out = { ...def };
    if (!usr) return out;
    for (const k of Object.keys(usr)) {
      const v = usr[k];
      if (v === undefined) continue;
      out[k] = isPlainObject(def[k]) && isPlainObject(v) && k !== 'spec' ? merge(def[k], v) : v;
    }
    return out;
  };
  const merged = merge(DEFAULT_PARAMS, params);
  const sanitize = (obj, def) => {
    for (const k of Object.keys(def)) {
      if (typeof def[k] === 'number') {
        const v = Number(obj[k]);
        obj[k] = Number.isFinite(v) ? v : def[k];
      } else if (isPlainObject(def[k]) && k !== 'spec') sanitize(obj[k], def[k]);
    }
  };
  sanitize(merged, DEFAULT_PARAMS);
  return merged;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Centre the geometry on XY, put its lowest point on z = 0 and scale it uniformly so the longest
 * XY side equals `width` mm. Returns a new position-only geometry plus bounds and the scale used.
 */
export function normalizeCharacter(geometry, { width = DEFAULT_PARAMS.width } = {}) {
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const longest = Math.max(sx, sy);
  if (!(longest > 1e-9)) throw new Error('Character has no XY extent.');
  const scale = Math.max(0.1, width) / longest;
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  const src = geometry.attributes.position.array;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = (src[i] - cx) * scale;
    out[i + 1] = (src[i + 1] - cy) * scale;
    out[i + 2] = (src[i + 2] - b.min.z) * scale;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  if (geometry.index) g.setIndex(geometry.index.clone());
  g.computeBoundingBox();
  return { geometry: g, bounds: extents(g), scale };
}

// ---------------------------------------------------------------------------------------------
// socket + boss
// ---------------------------------------------------------------------------------------------

/** Clicker-style switch params for socketPolygons() from our socket group. */
function socketSwitchParams(s) {
  return {
    socketMode: s.mode,
    stemCrossWidth: s.crossWidth + s.fit,
    stemCrossThickness: s.crossThickness + s.fit,
    socketOpening: s.opening + s.fit,
    roundDiameter: s.roundDiameter + s.fit,
  };
}

/**
 * Blind socket cutter opening on z = 0 (extended 1 mm below) with its ceiling at z = depth.
 * Tapered mode continues the taper below z = 0 so the cutter is one clean loft.
 */
function socketCutter(socket, depth) {
  const sp = socketPolygons(socketSwitchParams(socket));
  const ext = 1.0;
  const t = -ext / depth; // extrapolate the opening polygon to z = -1
  const below = sp.opening.map((p, i) => {
    const q = sp.ceiling[i];
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  });
  return { cutter: loft(below, sp.ceiling, -ext, depth), extent: sp.extent, mode: sp.mode };
}

/**
 * Height the stem boss must reach so it fuses into solid material above the socket: probe
 * vertical columns at the origin and around the boss radius; for each, take the first solid
 * interval that reaches above the socket ceiling and remember where it starts.
 */
function bossTopFor(geometry, depth, bossR, height, warnings) {
  const cols = [[0.03, 0.02]];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.1;
    cols.push([Math.cos(a) * bossR * 0.7, Math.sin(a) * bossR * 0.7]);
  }
  let need = 0;
  let missing = 0;
  for (const [x, y] of cols) {
    const hits = hitsAlongZ(geometry, x, y);
    let found = false;
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const zin = hits[i], zout = hits[i + 1];
      if (zout >= depth + 0.5) {
        need = Math.max(need, zin);
        found = true;
        break;
      }
    }
    if (!found) missing++;
  }
  if (missing) warnings.push('The character has little or no material above the stem socket; the boss may be exposed. Check the underside before printing.');
  let top = Math.max(depth + 1.0, need + 1.0);
  if (top > height - 0.6) {
    top = Math.max(depth + 0.6, height - 0.6);
    warnings.push(`Character is only ${height.toFixed(1)} mm tall; the stem boss was shortened to ${top.toFixed(1)} mm.`);
  }
  return top;
}

// ---------------------------------------------------------------------------------------------
// undersides
// ---------------------------------------------------------------------------------------------

function flatUnderside(m, flatHeight, height, warnings) {
  const h = Math.max(0, Math.min(flatHeight, height - 2));
  if (h !== flatHeight) warnings.push(`flatHeight clamped to ${h.toFixed(1)} mm to keep 2 mm of character.`);
  if (h <= 1e-6) return m;
  const cut = m.trimByPlane([0, 0, 1], h).translate(0, 0, -h);
  m.delete();
  return cut;
}

/**
 * Hollow the lower `hollowDepth` mm leaving `wall` of material: a layer cake of inset cross-sections
 * (each layer is the intersection of the insets at its top and bottom so the wall is never thinner
 * than `wall` where the character narrows), open at the bottom, keeping a solid core of radius
 * `coreR` around the socket. Returns the hollowed manifold (input is disposed).
 */
function hollowUnderside(m, { wall, hollowDepth, coreR, height, warnings }) {
  const { Manifold, CrossSection } = manifoldApi();
  const w = Math.max(0.8, wall);
  let H = Math.max(1, hollowDepth);
  if (H > height - w) {
    H = Math.max(1, height - w);
    warnings.push(`hollowDepth clamped to ${H.toFixed(1)} mm to keep a ${w} mm ceiling.`);
  }
  const step = 1.0;
  const zs = [0.05];
  for (let z = step; z < H - 1e-6; z += step) zs.push(z);
  zs.push(H);
  const insets = zs.map((z) => {
    const s = m.slice(z);
    const o = s.offset(-w, 'Round', 2, 16);
    s.delete();
    return o;
  });
  const layers = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const both = CrossSection.intersection(insets[i], insets[i + 1]);
    if (!both.isEmpty()) {
      const z0 = i === 0 ? -1 : zs[i];
      layers.push(both.extrude(zs[i + 1] - z0).translate(0, 0, z0));
    }
    both.delete();
  }
  for (const s of insets) s.delete();
  if (!layers.length) {
    warnings.push('Character is too thin to hollow at this wall thickness; underside left solid.');
    return m;
  }
  let cavity = layers.length === 1 ? layers[0] : Manifold.union(layers);
  if (layers.length > 1) for (const l of layers) l.delete();
  const core = cylinder(coreR, -2, H + 1);
  const cavity2 = cavity.subtract(core);
  dispose(cavity, core);
  const out = m.subtract(cavity2);
  dispose(cavity2, m);
  return out;
}

// ---------------------------------------------------------------------------------------------
// makeCap
// ---------------------------------------------------------------------------------------------

/**
 * Turn a normalised character geometry into printable parts. `geometry` should come from
 * normalizeCharacter (or a sample); it is re-normalised to params.width anyway.
 */
export async function makeCap(geometry, userParams = {}) {
  await initBooleans();
  const params = mergeParams(userParams);
  const warnings = [];
  const timings = {};
  const lap = (label, t0) => { timings[label] = Math.round((now() - t0) * 10) / 10; };

  // 1. normalise + to manifold
  let t = now();
  const norm = normalizeCharacter(geometry, { width: params.width });
  const height = norm.bounds.z;
  let m = toManifold(norm.geometry);
  lap('toManifold', t);
  await tick();

  // 2. flat trim (before the face so the inlay follows the final outer surface)
  const t2 = now();
  const s = params.socket;
  const sp = socketPolygons(socketSwitchParams(s));
  const bossR = sp.extent / 2 + Math.max(0.5, s.bossWall);
  const depth = Math.max(1, Math.min(s.depth, height - 1.5));
  if (depth !== s.depth) warnings.push(`Socket depth clamped to ${depth.toFixed(1)} mm (character height ${height.toFixed(1)} mm).`);
  const hollow = params.underside === 'hollow';
  if (!hollow) {
    if (params.underside !== 'flat') warnings.push(`Unknown underside "${params.underside}", using "flat".`);
    m = flatUnderside(m, params.flatHeight, height, warnings);
  }
  const outer = fromManifold(m); // outer surface before any cavity: bounds + boss probing
  const outerBounds = extents(outer);
  const capHeight = outerBounds.z;

  // 3. face inlay: split the exterior skin off while the character is still solid, so cavity
  //    walls and the socket never get a "face" layer
  let faceM = null;
  let capM = m;
  const f = params.face;
  if (f.spec && Array.isArray(f.spec.shapes) && f.spec.shapes.length) {
    t = now();
    if (Array.isArray(f.spec.warnings)) warnings.push(...f.spec.warnings);
    const res = buildFace(m, f, { width: params.width, height: capHeight, bounds: outerBounds }, warnings);
    if (res) {
      m.delete();
      capM = res.cap;
      faceM = res.face;
    }
    lap('face', t);
    await tick();
  }

  // 4. underside cavity (cap only; the cavity stays `wallThickness` inside the outer surface so it
  //    never reaches the 0.8 mm face)
  if (hollow) {
    if (faceM && params.wallThickness < f.depth + 0.4) warnings.push(`Wall thickness ${params.wallThickness} mm is close to the face depth ${f.depth} mm; the cavity may touch the inlay.`);
    capM = hollowUnderside(capM, { wall: params.wallThickness, hollowDepth: params.hollowDepth, coreR: bossR, height: capHeight, warnings });
  }
  timings.underside = Math.round((now() - t2 - (timings.face || 0)) * 10) / 10;
  await tick();

  // 5. boss + socket (cap only)
  t = now();
  const probe = hollow ? fromManifold(capM) : outer;
  const bossTop = bossTopFor(probe, depth, bossR, capHeight, warnings);
  const volBefore = capM.volume();
  const boss = cylinder(bossR, 0, bossTop);
  const withBoss = capM.add(boss);
  const bossAdded = withBoss.volume() - volBefore > 0.5;
  dispose(boss, capM);
  const { cutter, mode: socketMode } = socketCutter({ ...s, depth }, depth);
  capM = withBoss.subtract(cutter);
  dispose(cutter, withBoss);
  lap('socket', t);
  await tick();

  // 6. to geometry. simplify() merges the sliver triangles the layered cavity / coplanar unions
  //    leave behind (vertices within 2 um), so exporters do not have to drop degenerate faces.
  t = now();
  const tidy = (x) => {
    if (!x || typeof x.simplify !== 'function') return x;
    const y = x.simplify(0.002);
    if (y.isEmpty() || y.status() !== 'NoError') {
      y.delete();
      return x;
    }
    x.delete();
    return y;
  };
  capM = tidy(capM);
  faceM = tidy(faceM);
  const capGeom = fromManifold(capM);
  const faceGeom = faceM ? fromManifold(faceM) : null;
  dispose(capM, faceM);
  lap('toGeometry', t);
  const bounds = extents(capGeom);

  const parts = [{ name: 'cap', geometry: capGeom, color: params.colors.cap }];
  if (faceGeom) parts.push({ name: 'face', geometry: faceGeom, color: params.colors.face });

  // 7. switch body (clicker engine)
  let bodyGeom = null;
  let heights = null;
  if (params.withBody) {
    t = now();
    const clickerParams = mergeClickerParams({
      body: { height: params.body.height, rimHeight: params.body.rimHeight, wall: params.body.wall },
      fit: { clearance: params.fit.clearance, switchTolerance: params.fit.switchTolerance },
      switch: socketSwitchParams(s),
      keychain: { enabled: false },
    });
    const hw = [];
    heights = resolveHeights(clickerParams, hw);
    // the clicker's cap-seating warnings describe its own flat cap; our cap bottom is the socket opening
    warnings.push(...hw.filter((w) => !/^Cap (sits|top)/.test(w)));
    heights = { ...heights, capZ: heights.plateTopZ + MX.UPPER_HOUSING };
    const layout = footprintLayout(capGeom, clickerParams, params.body.size, heights, warnings);
    bodyGeom = buildBody(layout, clickerParams, heights, warnings);
    parts.push({ name: 'body', geometry: bodyGeom, color: params.colors.body });
    lap('body', t);
    await tick();
  }

  // print placement (used by the exporters via the clicker's layoutForPrint): upright, as modelled
  const gap = 6;
  const capX = bodyGeom ? bounds.x / 2 + gap : 0;
  const capZ = heights ? heights.capZ : 0;
  parts[0].print = { x: capX, y: 0, flipX: false, assembleZ: capZ };
  if (faceGeom) parts[1].print = { ...parts[0].print, follow: 'cap' };
  if (bodyGeom) {
    const bb = extents(bodyGeom);
    parts[parts.length - 1].print = { x: -(bb.x / 2 + gap), y: 0, flipX: false, assembleZ: 0 };
  }

  return {
    parts,
    bounds,
    warnings: [...new Set(warnings)],
    assembly: {
      capZ,
      socketDepth: depth,
      socketMode,
      bossDiameter: bossR * 2,
      bossTop,
      bossAdded,
      height: capHeight,
      scale: norm.scale,
      body: heights ? { plateTopZ: heights.plateTopZ, bodyHeight: heights.height, bounds: extents(bodyGeom) } : null,
      timings,
      triangles: Object.fromEntries(parts.map((p) => [p.name, triangleCount(p.geometry)])),
    },
  };
}
