// Switch-holder layout for a character cap: the clicker engine's buildBody() wants
// { bodyPoints, recessPoints, bodyShape, recessShape } in mm (CCW, centred on the switch).
//
// The recess must clear whatever part of the character sits inside the rim (the cap bottom seats
// 0.4 mm below the rim by default, so the lower rimHeight - 6.6 mm of the character, plus a margin)
// and the MX flange envelope. We take the convex hull of that lower slice, OR it with the envelope
// square, and offset by the clearance; the body is the recess offset by the wall. With `size` > 0 a
// plain circle of that diameter is used instead (warned when the footprint does not fit).

import { MX } from '../../clicker/engine/solids.js';
import { pointsToShape, circlePoints } from '../../clicker/engine/outline.js';
import { cleanPolygon, polygonContains } from '../../clicker/engine/shell.js';
import { convexHull } from '../../clicker/engine/raster.js';
import { manifoldApi } from './csg.js';
import { forEachTriangle } from './meshcheck.js';

/** XY points of the character at or below z = zCut (vertices below + edge crossings). */
function footprintPoints(geometry, zCut) {
  const pts = [];
  const push = (x, y) => pts.push({ x, y });
  forEachTriangle(geometry, (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const v = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]];
    for (let i = 0; i < 3; i++) {
      const p = v[i], q = v[(i + 1) % 3];
      if (p[2] <= zCut) push(p[0], p[1]);
      if ((p[2] <= zCut) !== (q[2] <= zCut)) {
        const t = (zCut - p[2]) / (q[2] - p[2]);
        push(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
      }
    }
  });
  return pts;
}

/** Largest polygon of a CrossSection as CCW {x,y}[]. */
function largestPolygon(cs) {
  const polys = cs.toPolygons();
  let best = null, bestA = -1;
  for (const poly of polys) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    a = Math.abs(a) / 2;
    if (a > bestA) { bestA = a; best = poly; }
  }
  return cleanPolygon((best || []).map(([x, y]) => ({ x, y })));
}

/**
 * @param capGeometry  finished cap geometry (bottom on z = 0, socket at the origin)
 * @param clickerParams merged clicker params (body.wall, body.rimHeight, fit.clearance, switch.pocket ...)
 * @param size         0 = follow the footprint, else body circle diameter
 */
export function footprintLayout(capGeometry, clickerParams, size, heights, warnings) {
  const { CrossSection } = manifoldApi();
  const wall = Math.max(0.8, clickerParams.body.wall);
  const clearance = Math.max(0, clickerParams.fit.clearance);
  const envelope = clickerParams.switch.pocket + 2 * clickerParams.fit.switchTolerance;
  const seat = Math.max(1.0, heights.height - heights.capZ + 1.0); // depth the cap bottom sits inside the rim + margin

  const pts = footprintPoints(capGeometry, seat);
  const hull = pts.length >= 3 ? convexHull(pts) : [];
  const polys = [];
  if (hull.length >= 3) polys.push(hull.map((p) => [p.x, p.y]));
  const env = CrossSection.square([envelope, envelope], true);
  const foot = polys.length ? CrossSection.union(new CrossSection(polys, 'Positive'), env) : env;
  const footHull = foot.hull();
  const recessCS = footHull.offset(clearance, 'Round', 2, 24);
  let recessPoints, bodyPoints;
  if (size > 0) {
    const d = Math.max(envelope + 2 * wall + 1, size);
    if (d !== size) warnings.push(`Body size raised to ${d.toFixed(1)} mm to clear the switch.`);
    bodyPoints = cleanPolygon(circlePoints(d / 2, 96));
    recessPoints = cleanPolygon(circlePoints(d / 2 - wall, 96));
    const need = largestPolygon(recessCS);
    if (!polygonContains(recessPoints, need, 0)) warnings.push(`Body circle of ${d.toFixed(1)} mm is narrower than the character's footprint; the cap will overhang the recess.`);
  } else {
    recessPoints = largestPolygon(recessCS);
    const bodyCS = recessCS.offset(wall, 'Round', 2, 24);
    bodyPoints = largestPolygon(bodyCS);
    bodyCS.delete();
  }
  for (const o of new Set([env, foot, footHull, recessCS])) o.delete();
  return {
    style: 'character',
    bodyPoints,
    recessPoints,
    capPoints: recessPoints,
    bodyShape: pointsToShape(bodyPoints),
    recessShape: pointsToShape(recessPoints),
    capShape: pointsToShape(recessPoints),
    designShapes: [],
  };
}

export { MX };
