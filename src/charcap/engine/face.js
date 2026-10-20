// Face inlay: project a DesignSpec onto the sculpted surface and split off a flush, `depth`-thick
// skin as the 'face' part.
//
//   column = character INTERSECT prism(design, along the projection axis, spanning the character)
//   face   = column MINUS column shifted `depth` into the character along the projection axis
//            (= the points of the column within `depth` of a surface facing the viewer)
//   cap    = character MINUS face            (via Manifold.split so both share exact boundaries)
//
// 'front': the viewer stands at -Y; design x -> world X, design y -> world Z; shift is +Y.
// 'top'  : the viewer looks down -Z; design x -> X, design y -> Y; shift is -Z.

import { manifoldApi, shapesToCrossSection, dispose } from './csg.js';

const MIN_PIECE = 0.2; // mm^3: smaller face fragments are numerical slivers, not printable detail

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

/**
 * @param m        the character Manifold (not disposed)
 * @param face     params.face
 * @param ctx      { width (character long side, mm), height (mm), bounds (extents of the character) }
 * @returns { cap: Manifold, face: Manifold } or null (with a warning) when nothing was cut
 */
export function buildFace(m, face, ctx, warnings) {
  const { Manifold } = manifoldApi();
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

  // design -> mm, centred on its own bbox, then placed on the chosen plane
  let cs = shapesToCrossSection(shapes, 12);
  const cs2 = cs.scale([k, k]).translate(-cx * k, -cy * k);
  cs.delete();
  cs = cs2;
  if (cs.isEmpty()) {
    warnings.push('Face design has no fillable area.');
    cs.delete();
    return null;
  }

  const dir = face.direction === 'top' ? 'top' : 'front';
  if (face.direction && face.direction !== dir) warnings.push(`Unknown face direction "${face.direction}", using "front".`);
  const B = ctx.bounds;
  let prism;
  let shift;
  if (dir === 'front') {
    const Ly = B.y + 2;
    // extrude along +Z, rotate +90 deg about X: (x, y, z) -> (x, -z, y); design y becomes world Z
    prism = cs.extrude(Ly).rotate([90, 0, 0]).translate(ox, B.max.y + 1, ctx.height / 2 + oy);
    shift = [0, depth, 0];
  } else {
    const Lz = ctx.height + 2;
    prism = cs.extrude(Lz).translate(ox, oy, -1);
    shift = [0, 0, -depth];
  }
  cs.delete();

  const column = m.intersect(prism);
  prism.delete();
  if (column.isEmpty()) {
    warnings.push('Face design misses the character entirely (adjust its width or offset).');
    column.delete();
    return null;
  }
  const shifted = column.translate(shift);
  const skin = column.subtract(shifted);
  dispose(column, shifted);
  if (skin.isEmpty() || skin.volume() < 0.05) {
    warnings.push('Face inlay came out empty.');
    skin.delete();
    return null;
  }
  // Where the surface runs parallel to the projection axis (silhouettes, rib flanks) the shifted
  // copy almost coincides with the original and leaves hundreds of zero-volume slivers; drop every
  // piece under MIN_PIECE mm^3 so they stay part of the cap.
  const pieces = skin.decompose();
  skin.delete();
  const kept = pieces.filter((p) => p.volume() >= MIN_PIECE);
  for (const p of pieces) if (!kept.includes(p)) p.delete();
  if (!kept.length) {
    warnings.push('Face inlay came out empty.');
    return null;
  }
  const clean = kept.length === 1 ? kept[0] : Manifold.compose(kept);
  if (kept.length > 1) for (const p of kept) p.delete();
  const [faceM, capM] = m.split(clean);
  clean.delete();
  if (faceM.isEmpty()) {
    dispose(faceM, capM);
    warnings.push('Face inlay came out empty.');
    return null;
  }
  if (kept.length > 40) warnings.push(`Face inlay has ${kept.length} separate pieces; very small ones may not print.`);
  return { cap: capM, face: faceM, pieces: kept.length };
}
