// 3D solids: extrusions + CSG for body, cap, design relief and keychain ring.
// Z is up. All dimensions mm.
//
// Body:   rests on z = 0, top at z = body.height. Centred on XY (design centre at origin).
//         pocket (switch lower housing) from z = 0 up to pocketHeight = height - rimHeight - plateThickness
//         plate from pocketHeight to plateTopZ = height - rimHeight, with the `cutout` square through it
//         recess (cap outline + clearance) from plateTopZ up to the top.
// Cap:    bottom face at z = 0, top face at z = cap.thickness; the MX stem socket hangs below
//         to z = -stemHeight. The UI positions the cap (see `assembly.capZ` from buildClicker).
// Design: 'raised' -> separate geometry from z = thickness to thickness + designHeight (same
//         frame as the cap); 'engraved' -> subtracted from the cap top.
// Ring:   4 mm tall annulus centred on the body's vertical midpoint, unioned into the body.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';
import { pointsToShape, circlePoints } from './outline.js';
import { repairMesh } from './repair.js';

// Simplified Cherry MX reference dimensions (mm)
export const MX = {
  UPPER_HOUSING: 6.6, // plate top -> top of upper housing (where the cap's underside rests)
  LOWER_HOUSING: 5.0, // plate bottom -> bottom of lower housing (pins excluded)
  UPPER_TOP_SIDE: 11.5, // the upper housing tapers from 14 mm at the plate to about this
  HOUSING_SIDE_TOP: 14.0,
  HOUSING_SIDE_BOTTOM: 15.6,
};

const evaluator = new Evaluator();
evaluator.attributes = ['position'];
evaluator.useGroups = false;
// The legacy splitter leaves T-junctions along every seam (slicers flag them as open edges);
// the constrained-Delaunay splitter produces closed, lower-count meshes.
evaluator.useCDTClipping = true;

function brush(geometry) {
  const b = new Brush(geometry);
  b.updateMatrixWorld(true);
  return b;
}

/** Boolean of two geometries; returns a fresh BufferGeometry (position only). */
export function csg(aGeom, bGeom, op) {
  const result = evaluator.evaluate(brush(aGeom), brush(bGeom), op);
  const g = result.geometry;
  g.clearGroups();
  return g;
}

/** Extrude shape(s) along +Z from z0 to z0 + depth. */
export function extrude(shapes, depth, z0 = 0) {
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 24 });
  if (z0 !== 0) g.translate(0, 0, z0);
  return g;
}

/** Axis-aligned box centred on (cx, cy) spanning z0..z1. */
export function box(sx, sy, z0, z1, cx = 0, cy = 0) {
  const g = new THREE.BoxGeometry(sx, sy, z1 - z0);
  g.translate(cx, cy, (z0 + z1) / 2);
  return g;
}

export function triangleCount(geometry) {
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
}

/** Normals, bounds, NaN check and triangle budget. Returns the geometry. */
export function finalize(geometry, name, warnings) {
  const pos = geometry.attributes.position;
  if (!pos || pos.count === 0) {
    warnings.push(`Part "${name}" is empty.`);
    return geometry;
  }
  const arr = pos.array;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) {
      warnings.push(`Part "${name}" contained non-finite vertices; they were zeroed.`);
      for (let j = i; j < arr.length; j++) if (!Number.isFinite(arr[j])) arr[j] = 0;
      pos.needsUpdate = true;
      break;
    }
  }
  // weld + T-junction repair so slicers see a closed mesh
  const repaired = repairMesh(geometry);
  geometry = repaired.geometry;
  if (repaired.openAfter > 0) {
    warnings.push(`Part "${name}" has ${repaired.openAfter} open edges after repair; run your slicer's mesh fix if it complains.`);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const tris = triangleCount(geometry);
  if (tris > 200000) warnings.push(`Part "${name}" has ${tris} triangles; slicing may be slow.`);
  return geometry;
}

/** Resolve body heights, clamping and warning when the body is too short. */
export function resolveHeights(params, warnings) {
  const { body, cap } = params;
  const sw = params.switch;
  const rim = Math.max(0, body.rimHeight);
  const plate = Math.max(0.6, sw.plateThickness);
  const minH = plate + rim + 4;
  let H = body.height;
  if (H < minH) {
    warnings.push(`Body height ${H} mm is too short for a ${plate} mm plate + ${rim} mm rim; raised to ${minH.toFixed(1)} mm.`);
    H = minH;
  }
  const pocketHeight = H - rim - plate;
  const plateTopZ = H - rim;
  const capZ = plateTopZ + MX.UPPER_HOUSING; // z of the cap's bottom face when seated on a real MX switch
  if (capZ > H + 0.05) {
    warnings.push(`Cap sits ${(capZ - H).toFixed(1)} mm above the body rim (switch housing is taller than the recess). Set rimHeight to at least ${MX.UPPER_HOUSING} mm to seat the cap inside the rim.`);
  } else if (capZ + cap.thickness < H - 0.05) {
    warnings.push(`Cap top ends up ${(H - capZ - cap.thickness).toFixed(1)} mm below the body rim and cannot be pressed comfortably; reduce rimHeight below ${(MX.UPPER_HOUSING + cap.thickness).toFixed(1)} mm or thicken the cap.`);
  }
  if (pocketHeight < MX.LOWER_HOUSING) {
    warnings.push(`Switch pocket is only ${pocketHeight.toFixed(1)} mm deep; the MX lower housing is ${MX.LOWER_HOUSING} mm so the switch will protrude from the bottom.`);
  }
  return { height: H, rim, plate, pocketHeight, plateTopZ, capZ };
}

/** Body with pocket, plate cutout and cap recess (keychain ring unioned when enabled). */
export function buildBody(layout, params, heights, warnings) {
  const sw = params.switch;
  const tol = Math.max(0, params.fit.switchTolerance);
  const { height, pocketHeight, plateTopZ } = heights;

  let g = extrude(layout.bodyShape, height, 0);
  const pocketSide = sw.pocket + 2 * tol;
  g = csg(g, box(pocketSide, pocketSide, -1, pocketHeight), SUBTRACTION);
  g = csg(g, box(sw.cutout, sw.cutout, pocketHeight - 0.5, plateTopZ + 0.5), SUBTRACTION);
  g = csg(g, extrude(layout.recessShape, height - plateTopZ + 1, plateTopZ), SUBTRACTION);

  if (params.keychain && params.keychain.enabled) {
    const ring = buildRing(layout, params, heights, warnings);
    if (ring) g = csg(g, ring, ADDITION);
  }
  return finalize(g, 'body', warnings);
}

/** Distance from the origin to the body outline along direction `angleDeg` (90 = +Y). */
function outlineRadiusAt(points, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let best = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    // origin + t*d = p + u*e
    const t = (p.x * ey - p.y * ex) / den;
    const u = (p.x * dy - p.y * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t > best) best = t;
  }
  return best;
}

/** Keychain loop: annulus 4 mm tall at mid-height, overlapping the body wall by 1 mm. */
export function buildRing(layout, params, heights, warnings) {
  const kc = params.keychain;
  const outerR = Math.max(1, kc.outerRadius);
  const innerR = Math.max(0.5, Math.min(kc.innerRadius, outerR - 1.0));
  if (innerR !== kc.innerRadius) warnings.push('Keychain inner radius was reduced to keep a 1 mm loop wall.');
  const d = outlineRadiusAt(layout.bodyPoints, kc.angle);
  if (d <= 0) {
    warnings.push('Could not place the keychain ring on the base outline.');
    return null;
  }
  const overlap = 1.0;
  const a = (kc.angle * Math.PI) / 180;
  const cx = (d + outerR - overlap) * Math.cos(a);
  const cy = (d + outerR - overlap) * Math.sin(a);
  const shape = pointsToShape(circlePoints(outerR, 64).map((p) => ({ x: p.x + cx, y: p.y + cy })));
  const hole = circlePoints(innerR, 48).map((p) => ({ x: p.x + cx, y: p.y + cy })).reverse();
  shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
  const ringH = Math.min(4, heights.height);
  return extrude(shape, ringH, heights.height / 2 - ringH / 2);
}

/** MX cross (stemCrossWidth x stemCrossThickness, both arms) as a 12-point Shape, CCW. */
export function crossShape(params) {
  const sw = params.switch;
  const w = sw.stemCrossWidth / 2;
  const t = sw.stemCrossThickness / 2;
  return new THREE.Shape(
    [
      [-w, -t], [-t, -t], [-t, -w], [t, -w], [t, -t], [w, -t],
      [w, t], [t, t], [t, w], [-t, w], [-t, t], [-w, t],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
  );
}

/** Circle with the MX cross hole, as a Shape (kept for consumers that want a single extrusion). */
export function stemShape(params) {
  const sw = params.switch;
  const s = pointsToShape(circlePoints(sw.stemOuterDiameter / 2, 48));
  const hole = new THREE.Path(crossShape(params).getPoints(1).reverse());
  s.holes.push(hole);
  return s;
}

/**
 * Cap (with stem socket) and optional raised design.
 * Returns { cap: BufferGeometry, design: BufferGeometry|null, engraveDepth }.
 */
export function buildCapParts(layout, params, warnings) {
  const { cap } = params;
  const sw = params.switch;
  const t = Math.max(1.2, cap.thickness);
  if (t !== cap.thickness) warnings.push(`Cap thickness raised to ${t} mm (minimum).`);

  let capGeom = extrude(layout.capShape, t, 0);
  // Stem: a solid cylinder overlapping 0.5 mm into the cap is unioned first, then the MX
  // cross is subtracted as a prism ending at z = 0. (Unioning a pre-holed stem shape makes
  // three-bvh-csg drop the socket ceiling fragments on large traced cap faces; this order
  // keeps every face clean and the result is a single closed shell.)
  const cylinder = extrude(pointsToShape(circlePoints(sw.stemOuterDiameter / 2, 48)), sw.stemHeight + 0.5, -sw.stemHeight);
  capGeom = csg(capGeom, cylinder, ADDITION);
  const crossPrism = extrude(crossShape(params), sw.stemHeight + 1, -sw.stemHeight - 1);
  capGeom = csg(capGeom, crossPrism, SUBTRACTION);

  let designGeom = null;
  let engraveDepth = 0;
  if (layout.designShapes.length && cap.designHeight > 0) {
    if (cap.designMode === 'engraved') {
      engraveDepth = Math.min(cap.designHeight, t - 0.8);
      if (engraveDepth < cap.designHeight) warnings.push(`Engraving depth clamped to ${engraveDepth.toFixed(2)} mm to keep 0.8 mm of cap under it.`);
      if (engraveDepth > 0.05) {
        const cutter = extrude(layout.designShapes, engraveDepth + 1, t - engraveDepth);
        capGeom = csg(capGeom, cutter, SUBTRACTION);
      }
    } else {
      let relief = extrude(layout.designShapes, cap.designHeight, t);
      if (layout.style !== 'outline') {
        // presets: clip the design to the cap outline
        const clip = extrude(layout.capShape, cap.designHeight + 2, t - 1);
        relief = csg(relief, clip, INTERSECTION);
      }
      if (triangleCount(relief) === 0) {
        warnings.push('Design lies entirely outside the cap and was dropped.');
      } else {
        designGeom = finalize(relief, 'design', warnings);
      }
    }
  }
  return { cap: finalize(capGeom, 'cap', warnings), design: designGeom, engraveDepth };
}

/**
 * Simplified MX switch for the viewer, positioned for a body resting on z = 0:
 *   plate top z = body.height - rimHeight  (resolved heights, see resolveHeights)
 *   lower housing 15.6 sq: from plateTop - plateThickness - 5.0 to plateTop - plateThickness
 *   through-plate section 14 sq: to plateTop + 0.8
 *   upper housing frustum 14 -> 11.5 sq: to plateTop + 6.6
 *   stem cross 4.1 x 1.3: to plateTop + 6.6 + stemHeight
 */
export function buildReferenceSwitchGeometry(params) {
  const sw = params.switch;
  const heights = resolveHeights(params, []);
  const plateTop = heights.plateTopZ;
  const plateBottom = plateTop - heights.plate;
  const parts = [];
  parts.push(box(MX.HOUSING_SIDE_BOTTOM, MX.HOUSING_SIDE_BOTTOM, plateBottom - MX.LOWER_HOUSING, plateBottom));
  parts.push(box(MX.HOUSING_SIDE_TOP - 0.1, MX.HOUSING_SIDE_TOP - 0.1, plateBottom - 0.01, plateTop + 0.8));
  const frustumH = MX.UPPER_HOUSING - 0.8;
  const frustum = new THREE.CylinderGeometry(MX.UPPER_TOP_SIDE / Math.SQRT2, (MX.HOUSING_SIDE_TOP - 0.1) / Math.SQRT2, frustumH, 4, 1);
  frustum.rotateY(Math.PI / 4);
  frustum.rotateX(Math.PI / 2);
  frustum.translate(0, 0, plateTop + 0.8 + frustumH / 2);
  parts.push(frustum);
  const housingTop = plateTop + MX.UPPER_HOUSING;
  parts.push(box(sw.stemCrossWidth, sw.stemCrossThickness, housingTop - 0.01, housingTop + sw.stemHeight));
  parts.push(box(sw.stemCrossThickness, sw.stemCrossWidth, housingTop - 0.01, housingTop + sw.stemHeight));
  for (const p of parts) p.deleteAttribute('uv');
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}
