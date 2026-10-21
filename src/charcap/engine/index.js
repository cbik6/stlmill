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
//   cap   : the sculpted character, bottom on z = 0. Its underside has a rounded-square pocket for the
//           MX upper housing (`travel` deep) with the stem boss standing in it; the socket opens at
//           the origin on z = 0, so the cap's underside rests on the housing top and can travel down.
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
import { roundedRectPoints } from '../../clicker/engine/outline.js';
import { initBooleans, manifoldApi, toManifold, fromManifold, cylinder, prism, loft, dispose } from './csg.js';
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
  // Travel: the cap's underside rests on the MX upper housing (fixed), so a keycap-style pocket for
  // the housing is cut into the underside and only the stem boss stands in it. Pressing the cap
  // moves it down `travel` mm over the housing.
  travel: 4.2 /* housing pocket depth from the underside, mm (MX travel 4.0 + 0.2) */,
  housing: { pocket: 15.6 /* MX flange / upper housing side; + 2*fit.clearance = pocket side (16.2) */, cornerRadius: 1.5, minWall: 1.2 /* minimum material around the pocket */, footMax: 22 /* largest foot plinth diameter */ },
  foot: 'auto' /* 'auto': union a foot plinth (dia >= pocket + 2*minWall, height travel + 1) when the lower `travel` band is too narrow | 'always' | 'never' (warn only) */,
  // Stem socket, measured on Clark's printed caps (ghost: tapered cross 6.1->4.8 x 4 deep in a dia 6 boss;
  // pumpkin: round dia 5 glue hole). Same three modes and numbers as the clicker engine.
  socket: {
    mode: 'tapered' /* 'tapered' (cross lofted opening -> ceiling, press fit) | 'cross' (straight) | 'round' (glue) */,
    depth: 3.6 /* blind depth from the underside, mm; the MX stem tip then sits 0.6 below the pocket ceiling */,
    crossWidth: 4.1 /* cross width at the ceiling (MX stem 4.1) */,
    crossThickness: 1.3 /* arm thickness at the ceiling (MX stem 1.3) */,
    opening: 4.6 /* cross width at the opening ('tapered' only) */,
    roundDiameter: 5.0 /* 'round' only */,
    fit: 0 /* added to crossWidth / crossThickness / roundDiameter; negative = tighter */,
    bossDiameter: 6.4 /* stem boss standing in the housing pocket (ghost print: dia 6) */,
    bossWall: 0.9 /* minimum material around the socket opening: boss dia = max(bossDiameter, opening + 2*bossWall) */,
  },
  face: {
    spec: null /* DesignSpec from makeDesignFromSvg / Text / Image, or null */,
    direction: 'front' /* 'front' (-Y surface, projected along +Y) | 'top' (+Z surface, projected along -Z) */,
    depth: 0.8 /* inlay thickness along the projection axis, mm */,
    width: 50 /* design long side as % of the character width */,
    offset: { x: 0, y: 0 } /* mm shift in the projection plane (y = up on the front, +Y on the top) */,
    method: 'cone' /* 'cone': only patches facing the viewer (crisp cutoff) | 'axis': plain projection-axis skin (baseline) */,
    minFacing: 0.3 /* 'cone': keep surface where dot(normal, -axis) > minFacing */,
    maxDepth: 0 /* mm band behind the nearest point along the axis that may carry the face; 0 = 40 % of the extent */,
    minPieceRatio: 0.1 /* drop detached face pieces whose in-plane bbox area is below this fraction of the largest */,
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
function bossTopFor(geometry, clear, bossR, height, warnings) {
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
      const last = i + 3 >= hits.length;
      // a shelf thinner than 1.5 mm (e.g. a foot plinth top over a glue hole) is not enough to fuse into
      if (zout >= clear + 0.5 && (zout - zin >= 1.5 || last)) {
        need = Math.max(need, zin);
        found = true;
        break;
      }
    }
    if (!found) missing++;
  }
  if (missing) warnings.push('The character has little or no material above the stem socket; the boss may be exposed. Check the underside before printing.');
  let top = Math.max(clear + 1.0, need + 1.0);
  if (top > height - 0.6) {
    top = Math.max(clear + 0.6, height - 0.6);
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
function hollowUnderside(m, { wall, hollowDepth, coreR, keepPolygons = [], height, warnings }) {
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
  // keep the stem core and the wall band around the housing pocket solid (otherwise the cavity
  // eats the pocket wall and any foot plinth, leaving only the outer shell)
  let keep = cylinder(coreR, -2, H + 1);
  for (const poly of keepPolygons) {
    if (!poly || poly.length < 3) continue;
    const band = prism(poly, -2, H + 1);
    const k = keep.add(band);
    dispose(keep, band);
    keep = k;
  }
  const cavity2 = cavity.subtract(keep);
  dispose(cavity, keep);
  const before = m.volume();
  const out = m.subtract(cavity2);
  dispose(cavity2, m);
  if (before - out.volume() < 30) warnings.push('Hollow cavity is negligible (under 30 mm^3): the solid foot / pocket walls leave almost nothing to hollow at this hollowDepth, so the underside stays essentially solid.');
  return out;
}

// ---------------------------------------------------------------------------------------------
// housing pocket (travel)
// ---------------------------------------------------------------------------------------------

/** Pocket outline grown by housing.minWall: the material band the hollow cavity must leave around the pocket. */
function pocketWallPolygon(pocket, params) {
  const w = Math.max(0.4, params.housing.minWall);
  const side = pocket.side + 2 * w;
  return roundedRectPoints(side / 2, side / 2, Math.min(params.housing.cornerRadius + w, side / 2), 8);
}

/** Rounded-square pocket polygon for the MX upper housing (+ clearance per side). */
function pocketPolygon(params) {
  const side = params.housing.pocket + 2 * Math.max(0, params.fit.clearance);
  return { points: roundedRectPoints(side / 2, side / 2, Math.min(params.housing.cornerRadius, side / 2), 8), side };
}

/** Outer contours only (holes filled) of a cross-section, as a new CrossSection. */
function outerContours(cs) {
  const { CrossSection } = manifoldApi();
  const polys = cs.toPolygons().filter((poly) => {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a > 0;
  });
  return new CrossSection(polys, 'Positive');
}

/**
 * Can the character hold `minWall` of material around the housing pocket? Its OUTER outline at
 * three heights within the pocket, inset by minWall, must contain the pocket (internal cavities
 * such as a hollow skirt are fine: the housing simply sits inside them).
 * Returns { ok, footprint } where footprint = long side of the outline at z = travel.
 */
function checkPocketWalls(m, pocketCS, travel, minWall) {
  const { CrossSection } = manifoldApi();
  let ok = true;
  let footprint = 0;
  for (const z of [Math.min(0.4, travel / 2), travel / 2, travel - 0.05]) {
    const sl = m.slice(z);
    const outer = outerContours(sl);
    const b = outer.bounds();
    footprint = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
    const inset = outer.offset(-minWall, 'Round', 2, 8);
    const left = CrossSection.difference(pocketCS, inset);
    if (left.area() > 0.5) ok = false; // mm^2; grazing / slightly uneven outlines leave tiny slivers
    dispose(sl, outer, inset, left);
  }
  return { ok, footprint };
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
  const minBoss = sp.extent + 2 * Math.max(0.5, s.bossWall);
  let bossD = Math.max(1, s.bossDiameter);
  if (bossD < minBoss - 1e-9) {
    bossD = minBoss;
    warnings.push(`Stem boss widened to ${bossD.toFixed(1)} mm to keep a ${s.bossWall} mm wall around the ${sp.mode} socket.`);
  }
  const bossR = bossD / 2;
  let travel = Math.max(0, params.travel);
  if (travel > height - 2.5) {
    travel = Math.max(0, height - 2.5);
    warnings.push(`Travel pocket reduced to ${travel.toFixed(1)} mm: the character is only ${height.toFixed(1)} mm tall.`);
  }
  const depth = Math.max(1, Math.min(s.depth, height - 1.5));
  if (depth !== s.depth) warnings.push(`Socket depth clamped to ${depth.toFixed(1)} mm (character height ${height.toFixed(1)} mm).`);
  const hollow = params.underside === 'hollow';
  if (!hollow) {
    if (params.underside !== 'flat') warnings.push(`Unknown underside "${params.underside}", using "flat".`);
    m = flatUnderside(m, params.flatHeight, height, warnings);
  }
  // A character whose lower `travel` band is narrower than pocket + 2*minWall gets a foot plinth
  // (unioned now, before the face split, so the face never overlaps it).
  const pocket = pocketPolygon(params);
  let foot = null;
  let footPts = null;
  if (travel > 0.05) {
    const { CrossSection, Manifold } = manifoldApi();
    const minWall = Math.max(0.4, params.housing.minWall);
    const pocketCS = new CrossSection([pocket.points.map((q) => [q.x, q.y])], 'Positive');
    const walls = checkPocketWalls(m, pocketCS, travel, minWall);
    pocketCS.delete();
    const needD = pocket.side + 2 * minWall;
    const mode = ['auto', 'always', 'never'].includes(params.foot) ? params.foot : 'auto';
    if (mode === 'always' || (mode === 'auto' && !walls.ok)) {
      const D = Math.min(Math.max(needD, params.housing.footMax), Math.max(needD, walls.footprint));
      const h = travel + 1.0;
      // rounded square concentric with the pocket (corners offset by the same margin), 0.5 mm draft
      const margin = (D - pocket.side) / 2;
      footPts = roundedRectPoints(D / 2, D / 2, Math.min(params.housing.cornerRadius + margin, D / 2), 10);
      const plinth = Manifold.extrude(footPts.map((q) => [q.x, q.y]), h, 1, 0, [(D - 1) / D, (D - 1) / D]);
      const withFoot = m.add(plinth);
      dispose(plinth, m);
      m = withFoot;
      foot = { diameter: Math.round(D * 100) / 100, height: h };
      if (mode === 'auto') warnings.push(`Added a ${D.toFixed(1)} mm foot under the character so the switch housing pocket (${pocket.side} mm + ${minWall} mm walls) fits.`);
    } else if (!walls.ok) {
      warnings.push(`Character is too small for the switch housing pocket (needs about ${needD.toFixed(1)} mm across its lower ${travel} mm); the walls around the pocket are thinner than ${minWall} mm or missing. Set foot to 'auto' to add a plinth.`);
    }
  }
  const outer = fromManifold(m); // outer surface before any cavity: bounds + boss probing
  const outerBounds = extents(outer);
  const capHeight = outerBounds.z;

  // 3. face inlay: split the exterior skin off while the character is still solid, so cavity
  //    walls and the socket never get a "face" layer
  let faceM = null;
  let faceStats = null;
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
      faceStats = res.stats;
    }
    lap('face', t);
    await tick();
  }

  // 4. underside cavity (cap only; the cavity stays `wallThickness` inside the outer surface so it
  //    never reaches the 0.8 mm face)
  if (hollow) {
    if (faceM && params.wallThickness < f.depth + 0.4) warnings.push(`Wall thickness ${params.wallThickness} mm is close to the face depth ${f.depth} mm; the cavity may touch the inlay.`);
    if (params.hollowDepth < travel) warnings.push(`hollowDepth ${params.hollowDepth} mm is less than the travel ${travel} mm; the housing pocket is cut to ${travel} mm anyway.`);
    // keep the pocket wall band and the foot plinth (its job is to carry the pocket wall) solid
    const keepPolygons = travel > 0.05 ? [pocketWallPolygon(pocket, params)] : [];
    if (footPts) keepPolygons.push(footPts);
    capM = hollowUnderside(capM, { wall: params.wallThickness, hollowDepth: params.hollowDepth, coreR: bossR, keepPolygons, height: capHeight, warnings });
  }
  // housing pocket (both modes): the fixed MX upper housing must fit under the cap while it travels
  if (travel > 0.05) {
    const cutter = prism(pocket.points, -1, travel);
    const cut = capM.subtract(cutter);
    dispose(cutter, capM);
    capM = cut;
  }
  timings.underside = Math.round((now() - t2 - (timings.face || 0)) * 10) / 10;
  await tick();

  // 5. boss + socket (cap only)
  t = now();
  const probe = travel > 0.05 || hollow ? fromManifold(capM) : outer;
  const bossTop = bossTopFor(probe, Math.max(depth, travel), bossR, capHeight, warnings);
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
      travel,
      pocketSide: pocket.side,
      foot,
      bossDiameter: bossR * 2,
      bossTop,
      bossAdded,
      height: capHeight,
      scale: norm.scale,
      body: heights ? { plateTopZ: heights.plateTopZ, bodyHeight: heights.height, bounds: extents(bodyGeom) } : null,
      timings,
      triangles: Object.fromEntries(parts.map((p) => [p.name, triangleCount(p.geometry)])),
      face: faceStats,
    },
  };
}
