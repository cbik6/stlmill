// Face inlay: project a DesignSpec onto the sculpted surface and split off a flush, `depth`-thick
// skin as the 'face' part, restricted to the first FRONT-FACING surface.
//
//   column = character INTERSECT prism(design outline inset 0.05 mm, along the projection axis),
//            clipped to a depth band [nearest point, nearest + 40 % of the extent] along the axis
//            (detached pieces that start more than maxDepth behind the main piece are dropped later,
//            so eye-socket floors or the far side of a jaw never become face islands)
//   face   = column MINUS UNION over cone directions u of (character shifted by -depth*u)
//            u = the viewing axis and the axis tilted by +-asin(minFacing) about the two in-plane
//            axes. A surface patch survives only where stepping `depth` along EVERY u leaves the
//            material, i.e. where dot(normal, -axis) > minFacing: flanks and back-facing patches
//            drop out with a crisp cutoff instead of fading into ragged wedges. ('axis' method =
//            the viewing axis alone, kept as a comparison baseline.)
//   cap    = character MINUS face            (face is a subset of the character, so the boundary is shared)
//   then slivers / detached fragments are dropped and both pieces are simplified to 10 um.
//
// 'front': the viewer stands at -Y; design x -> world X, design y -> world Z; axis = +Y into the part.
// 'top'  : the viewer looks down -Z; design x -> X, design y -> Y; axis = -Z into the part.

import { manifoldApi, shapesToCrossSection, dispose } from './csg.js';

const MIN_PIECE = 0.5; // mm^3: smaller face fragments are numerical slivers, not printable detail
const MIN_SPAN = 0.6; // mm: minimum extent of a face piece in the projection plane
const SIMPLIFY = 0.01; // mm: post-split simplification of face and cap
const OUTLINE_INSET = 0.05; // mm: design outline pulled in so the cut never coincides with sculpt edges
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function bboxOfShapes(shapes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    const pts = s.extractPoints(12);
    for (const poly of [pts.shape, ...pts.holes]) {
      for (const p of poly) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

function tidy(x) {
  if (typeof x.simplify !== 'function') return x;
  const y = x.simplify(SIMPLIFY);
  if (y.isEmpty() || y.status() !== 'NoError') {
    y.delete();
    return x;
  }
  x.delete();
  return y;
}

/**
 * @param m        the character Manifold (not disposed)
 * @param face     params.face  { spec, direction, depth, width, offset, method, minFacing, maxDepth, minPieceRatio }
 * @param ctx      { width (character long side, mm), height (mm), bounds (extents of the character) }
 * @returns { cap, face, stats: { method, pieces, dropped, band } } or null (with a warning)
 */
export function buildFace(m, face, ctx, warnings) {
  const { Manifold } = manifoldApi();
  const T = {};
  let t0 = now();
  const lap = (k) => { T[k] = Math.round(now() - t0); t0 = now(); };
  const shapes = face.spec.shapes;
  const bb = bboxOfShapes(shapes);
  const longUnits = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
  if (!(longUnits > 1e-9)) {
    warnings.push('Face design is empty.');
    return null;
  }
  const pct = Math.max(1, Math.min(200, face.width)) / 100;
  const target = pct * ctx.width;
  const k = target / longUnits;
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const depth = Math.max(0.2, face.depth);
  const ox = Number(face.offset && face.offset.x) || 0;
  const oy = Number(face.offset && face.offset.y) || 0;
  const method = face.method === 'axis' ? 'axis' : 'cone';
  const minFacing = Math.min(0.9, Math.max(0, Number(face.minFacing) || 0));
  const minRatio = Math.min(0.9, Math.max(0, Number(face.minPieceRatio) || 0));

  // design -> mm, centred on its own bbox, inset a hair, then placed on the chosen plane
  let cs = shapesToCrossSection(shapes, 12);
  const cs2 = cs.scale([k, k]).translate(-cx * k, -cy * k);
  cs.delete();
  const cs3 = cs2.offset(-OUTLINE_INSET, 'Round', 2, 8);
  cs2.delete();
  // traced outlines carry hundreds of near-collinear points; 20 um simplification halves the prism's
  // side faces (and every boolean against them) without visible change
  cs = typeof cs3.simplify === 'function' ? cs3.simplify(0.02) : cs3;
  if (cs !== cs3) cs3.delete();
  if (cs.isEmpty()) {
    warnings.push('Face design has no fillable area.');
    cs.delete();
    return null;
  }

  const dir = face.direction === 'top' ? 'top' : 'front';
  if (face.direction && face.direction !== dir) warnings.push(`Unknown face direction "${face.direction}", using "front".`);
  const B = ctx.bounds;
  const extentAlong = dir === 'front' ? B.y : ctx.height;
  const band = 0.4 * extentAlong;

  // the design prism and a 1 mm wider one (shifted copies of the character are clipped to it)
  const csWide = cs.offset(1.0, 'Round', 2, 8);
  let prism, wide;
  if (dir === 'front') {
    const Ly = B.y + 2;
    // extrude along +Z, rotate +90 deg about X: (x, y, z) -> (x, -z, y); design y becomes world Z
    const place = (c) => c.extrude(Ly).rotate([90, 0, 0]).translate(ox, B.max.y + 1, ctx.height / 2 + oy);
    prism = place(cs);
    wide = place(csWide);
  } else {
    const Lz = ctx.height + 2;
    const place = (c) => c.extrude(Lz).translate(ox, oy, -1);
    prism = place(cs);
    wide = place(csWide);
  }
  dispose(cs, csWide);

  let column = m.intersect(prism);
  column.numTri();
  prism.delete();
  lap('column');
  if (column.isEmpty()) {
    warnings.push('Face design misses the character entirely (adjust its width or offset).');
    dispose(column, wide);
    return null;
  }
  // depth band from the nearest point of the column along the axis
  {
    const cb = column.boundingBox();
    const clipped = dir === 'front'
      ? column.trimByPlane([0, -1, 0], -(cb.min[1] + band)) // keep y <= front + band
      : column.trimByPlane([0, 0, 1], cb.max[2] - band); // keep z >= top - band
    column.delete();
    column = clipped;
  }

  // cone of inward step directions: the axis plus tilts of asin(minFacing) in the two plane axes
  const axis = dir === 'front' ? [0, 1, 0] : [0, 0, -1];
  const dirs = [axis];
  if (method === 'cone' && minFacing > 0) {
    const sn = minFacing;
    const cn = Math.sqrt(1 - sn * sn);
    if (dir === 'front') dirs.push([sn, cn, 0], [-sn, cn, 0], [0, cn, sn], [0, cn, -sn]);
    else dirs.push([sn, 0, -cn], [-sn, 0, -cn], [0, sn, -cn], [0, -sn, -cn]);
  }
  // the character clipped to the column's box (+ depth margin): a small operand for the shifts
  wide.delete();
  const cb = column.boundingBox();
  const pad = depth + 0.1;
  const box = Manifold.cube([cb.max[0] - cb.min[0] + 2 * pad, cb.max[1] - cb.min[1] + 2 * pad, cb.max[2] - cb.min[2] + 2 * pad], true)
    .translate([(cb.min[0] + cb.max[0]) / 2, (cb.min[1] + cb.max[1]) / 2, (cb.min[2] + cb.max[2]) / 2]);
  const big = m.intersect(box);
  box.delete();
  // successive subtraction: after the first cut the skin is thin, so the tilted cuts stay cheap;
  // the tilted copies use a lightly simplified chunk (the cutoff angle needs no 2 um fidelity)
  let skin = column;
  const bigS = typeof big.simplify === 'function' ? big.simplify(0.02) : big;
  dirs.forEach((d, i) => {
    const src = i === 0 ? big : bigS;
    const sh = src.translate([d[0] * depth, d[1] * depth, d[2] * depth]);
    const next = skin.subtract(sh);
    dispose(sh, skin);
    skin = next;
  });
  if (bigS !== big) bigS.delete();
  big.delete();
  skin.numTri();
  lap('skin');
  if (skin.isEmpty() || skin.volume() < 0.05) {
    warnings.push('Face inlay came out empty.');
    skin.delete();
    return null;
  }

  // Drop slivers (volume / in-plane span) and detached fragments much smaller than the main piece.
  const pieces = skin.decompose();
  skin.delete();
  lap('decompose');
  const planeBox = (p) => {
    const b = p.boundingBox();
    const ex = b.max[0] - b.min[0];
    const ey = dir === 'front' ? b.max[2] - b.min[2] : b.max[1] - b.min[1];
    return { ex, ey, area: ex * ey };
  };
  const near = (p) => { const b = p.boundingBox(); return dir === 'front' ? b.min[1] : -b.max[2]; }; // depth along the axis, smaller = nearer
  const info = pieces.map((p) => ({ p, vol: p.volume(), near: near(p), ...planeBox(p) }));
  const main = info.reduce((a, b) => (b.area > a.area ? b : a), info[0]);
  // detached pieces that start more than `behind` deeper than the main piece's nearest point are
  // concavity floors (eye sockets, mouths) seen through the first skin, not part of the face
  const behind = face.maxDepth > 0 ? face.maxDepth : Math.max(3 * depth, 0.3 * target);
  const kept = info
    .filter((i) => i === main || (i.vol >= MIN_PIECE && i.ex >= MIN_SPAN && i.ey >= MIN_SPAN && i.area >= minRatio * main.area && i.near <= main.near + behind))
    .map((i) => i.p);
  const dropped = pieces.length - kept.length;
  for (const p of pieces) if (!kept.includes(p)) p.delete();
  if (!kept.length) {
    warnings.push('Face inlay came out empty.');
    return null;
  }
  const clean = kept.length === 1 ? kept[0] : Manifold.compose(kept);
  if (kept.length > 1) for (const p of kept) p.delete();
  // clean is a subset of m by construction, so it IS the face; only the cap needs a boolean
  let capM = m.subtract(clean);
  let faceM = clean;
  capM.numTri();
  lap('split');
  faceM = tidy(faceM);
  capM = tidy(capM);
  capM.numTri();
  lap('simplify');
  if (kept.length > 40) warnings.push(`Face inlay has ${kept.length} separate pieces; very small ones may not print.`);
  return { cap: capM, face: faceM, stats: { method, pieces: kept.length, dropped, band: Math.round(band * 100) / 100, timings: T } };
}
