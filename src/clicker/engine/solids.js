// 3D solids: extrusions + CSG for body, cap, design relief and keychain ring.
// Z is up. All dimensions mm.
//
// Body:   rests on z = 0 with a SOLID floor, top at z = body.height. Centred on XY (design centre at origin).
//         The MX switch is inserted from the top: its 15.6 mm flange sits on the plate's top face,
//         the lower housing (~13.95 sq) passes through the 14.0 mm `cutout` and hangs below the plate.
//           floor        z = 0 .. cavityBottomZ            (>= FLOOR_MIN = 1.5 mm)
//           cavity       cavityBottomZ .. plateBottomZ     square `cavity` + 2*switchTolerance, closed
//           plate        plateBottomZ .. plateTopZ         with the nominal `cutout` square through it
//           recess       plateTopZ .. height               cap outline + clearance (clears the flange)
//         plateTopZ = height - rimHeight.
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
import { ShellBuilder, cleanPolygon, polygonContains, squarePolygon } from './shell.js';

// Simplified Cherry MX reference dimensions (mm), plate-mount
export const MX = {
  UPPER_HOUSING: 6.6, // plate top -> top of upper housing (where the cap's underside rests)
  FLANGE: 15.6, // square flange resting on the plate's top face
  FLANGE_THICKNESS: 0.8,
  UPPER_TOP_SIDE: 13.0, // the upper housing tapers from the flange to about this
  LOWER_HOUSING: 13.95, // square section passing through the 14.0 cutout
  LOWER_HOUSING_DEPTH: 5.0, // plate underside -> bottom of lower housing
  PIN_LENGTH: 3.3, // metal pins / PCB legs below the lower housing
  PIN_DIAMETER: 1.5,
  PINS: [[-3.81, 2.54], [2.54, 5.08]], // pin positions relative to the switch centre
  CLIP_SPRING: 0.5, // plate clips spring out this much per side just under the plate
};
export const FLOOR_MIN = 1.5; // minimum solid floor under the switch cavity

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

/**
 * Resolve body heights. Returns
 *   { height, rim, plate, cavityDepth, floor, plateTopZ, plateBottomZ, cavityBottomZ, capZ }
 * The body is raised (with a warning) when floor + cavity + plate + rim do not fit, and the
 * cavity is clamped so it never breaks through the FLOOR_MIN floor.
 */
export function resolveHeights(params, warnings) {
  const { body, cap } = params;
  const sw = params.switch;
  const rim = Math.max(0, body.rimHeight);
  const plate = Math.max(0.6, sw.plateThickness);
  let cavityDepth = Math.max(0, sw.cavityDepth);
  const needed = MX.LOWER_HOUSING_DEPTH + MX.PIN_LENGTH;
  if (cavityDepth < needed) {
    warnings.push(`Switch cavity is only ${cavityDepth.toFixed(1)} mm deep; the MX lower housing + pins need ${needed.toFixed(1)} mm, so the switch will not seat fully.`);
  }
  const minH = FLOOR_MIN + cavityDepth + plate + rim;
  let H = body.height;
  if (H < minH - 1e-9) {
    warnings.push(`Body height ${H} mm is too short for a ${FLOOR_MIN} mm floor + ${cavityDepth} mm cavity + ${plate} mm plate + ${rim} mm rim; raised to ${minH.toFixed(1)} mm.`);
    H = minH;
  }
  const plateTopZ = H - rim;
  const plateBottomZ = plateTopZ - plate;
  // defensive clamp: never cut through the floor
  if (plateBottomZ - cavityDepth < FLOOR_MIN - 1e-9) {
    cavityDepth = Math.max(0, plateBottomZ - FLOOR_MIN);
    warnings.push(`Switch cavity depth clamped to ${cavityDepth.toFixed(1)} mm to keep a ${FLOOR_MIN} mm floor.`);
  }
  const cavityBottomZ = plateBottomZ - cavityDepth;
  const capZ = plateTopZ + MX.UPPER_HOUSING; // z of the cap's bottom face when seated on a real MX switch
  if (capZ > H + 0.05) {
    warnings.push(`Cap sits ${(capZ - H).toFixed(1)} mm above the body rim (switch housing is taller than the recess). Set rimHeight to at least ${MX.UPPER_HOUSING} mm to seat the cap inside the rim.`);
  } else if (capZ + cap.thickness < H - 0.05) {
    warnings.push(`Cap top ends up ${(H - capZ - cap.thickness).toFixed(1)} mm below the body rim and cannot be pressed comfortably; reduce rimHeight below ${(MX.UPPER_HOUSING + cap.thickness).toFixed(1)} mm or thicken the cap.`);
  }
  return { height: H, rim, plate, cavityDepth, floor: cavityBottomZ, plateTopZ, plateBottomZ, cavityBottomZ, capZ };
}

/**
 * Body with closed switch cavity, plate cutout and cap recess (keychain ring unioned when enabled).
 * Built as a CSG-free layered shell (see shell.js): outer wall, rim top, recess wall, plate top,
 * cutout wall, plate underside, cavity wall, cavity floor, body bottom. All nested polygons share
 * their vertices between faces and walls, so the result is one closed manifold shell.
 */
export function buildBody(layout, params, heights, warnings) {
  const sw = params.switch;
  const tol = Math.max(0, params.fit.switchTolerance);
  const { height: H, plateTopZ, plateBottomZ, cavityBottomZ, cavityDepth } = heights;

  const O = cleanPolygon(layout.bodyPoints);
  const R = cleanPolygon(layout.recessPoints);
  const K = squarePolygon(sw.cutout);
  const cavitySide = Math.max(sw.cutout, sw.cavity) + 2 * tol;
  const hasCavity = cavityDepth > 0.05;
  const distinctCavity = hasCavity && cavitySide > sw.cutout + 0.05;
  const C = squarePolygon(cavitySide);

  let g;
  if (!polygonContains(O, R, 0.05)) {
    warnings.push('Recess outline is not inside the body outline; fell back to boolean construction.');
    g = buildBodyCSG(layout, params, heights);
  } else {
    const b = new ShellBuilder();
    b.face(O, [], 0, false); // body bottom (solid floor)
    b.wall(O, 0, H, false); // outer wall
    b.face(O, [R], H, true); // rim top
    b.wall(R, plateTopZ, H, true); // recess wall
    const inner = distinctCavity ? C : K;
    if (polygonContains(R, K, 0.05) && polygonContains(O, inner, 0.05)) {
      b.face(R, [K], plateTopZ, true); // plate top (recess floor)
      if (distinctCavity) {
        b.wall(K, plateBottomZ, plateTopZ, true); // cutout wall through the plate
        b.face(C, [K], plateBottomZ, false); // plate underside (cavity ceiling)
        b.wall(C, cavityBottomZ, plateBottomZ, true); // cavity wall
        b.face(C, [], cavityBottomZ, true); // cavity floor
      } else if (hasCavity) {
        b.wall(K, cavityBottomZ, plateTopZ, true);
        b.face(K, [], cavityBottomZ, true);
      } else {
        b.wall(K, plateBottomZ, plateTopZ, true);
        b.face(K, [], plateBottomZ, true);
      }
    } else {
      warnings.push('Base is too small for the switch cutout and cavity; the body was built without a switch opening.');
      b.face(R, [], plateTopZ, true);
    }
    g = b.build();
  }

  if (params.keychain && params.keychain.enabled) {
    const ring = buildRing(layout, params, heights, warnings);
    if (ring) g = csg(g, ring, ADDITION);
  }
  return finalize(g, 'body', warnings);
}

/** Boolean fallback for degenerate outlines (recess not inside the body). Relies on repair.js. */
function buildBodyCSG(layout, params, heights) {
  const sw = params.switch;
  const tol = Math.max(0, params.fit.switchTolerance);
  const { height, plateTopZ, plateBottomZ, cavityBottomZ, cavityDepth } = heights;
  let g = extrude(layout.bodyShape, height, 0);
  if (cavityDepth > 0.05) {
    const cavitySide = Math.max(sw.cutout, sw.cavity) + 2 * tol;
    g = csg(g, box(cavitySide, cavitySide, cavityBottomZ, plateBottomZ), SUBTRACTION);
  }
  g = csg(g, box(sw.cutout, sw.cutout, plateBottomZ - 0.5, plateTopZ + 0.5), SUBTRACTION);
  g = csg(g, extrude(layout.recessShape, height - plateTopZ + 1, plateTopZ), SUBTRACTION);
  return g;
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

  const s = sw.stemHeight;
  const P = cleanPolygon(layout.capPoints);
  const S = cleanPolygon(circlePoints(sw.stemOuterDiameter / 2, 48));
  const X = cleanPolygon(crossShape(params).getPoints(1));
  const stemFits = polygonContains(P, S, 0.05) && polygonContains(S, X, 0.05);

  // design polygons (cleaned once; shared by faces and walls)
  const designPolys = layout.designShapes.map((sh) => {
    const pts = sh.extractPoints(1);
    return { outer: cleanPolygon(pts.shape), holes: pts.holes.map(cleanPolygon).filter((h) => h.length >= 3) };
  }).filter((d) => d.outer.length >= 3);
  const designInsideCap = designPolys.length > 0 && designPolys.every((d) => polygonContains(P, d.outer, 0.05));

  let engraveDepth = 0;
  const wantEngrave = layout.designShapes.length > 0 && cap.designHeight > 0 && cap.designMode === 'engraved';
  if (wantEngrave) {
    engraveDepth = Math.min(cap.designHeight, t - 0.8);
    if (engraveDepth < cap.designHeight) warnings.push(`Engraving depth clamped to ${engraveDepth.toFixed(2)} mm to keep 0.8 mm of cap under it.`);
  }
  const engraveInShell = wantEngrave && engraveDepth > 0.05 && designInsideCap;

  let capGeom;
  if (stemFits) {
    // CSG-free closed shell: cap slab + stem socket (+ engraving when the design is inside the cap)
    const b = new ShellBuilder();
    b.wall(P, 0, t, false); // cap side wall
    b.face(P, [S], 0, false); // cap underside around the stem
    b.face(X, [], 0, false); // socket ceiling (inside the cross)
    b.wall(S, -s, 0, false); // stem outer wall
    b.wall(X, -s, 0, true); // cross socket wall
    b.face(S, [X], -s, false); // stem bottom ring
    if (engraveInShell) {
      const zf = t - engraveDepth;
      b.face(P, designPolys.map((d) => d.outer), t, true); // top surface minus the design
      for (const d of designPolys) {
        b.face(d.outer, d.holes, zf, true); // engraving floor
        b.wall(d.outer, zf, t, true); // engraving side wall
        for (const h of d.holes) {
          b.face(h, [], t, true); // island (counter) top
          b.wall(h, zf, t, false); // island wall
        }
      }
    } else {
      b.face(P, [], t, true); // plain top
    }
    capGeom = b.build();
  } else {
    warnings.push('Cap outline is too small for the stem; fell back to boolean construction.');
    capGeom = extrude(layout.capShape, t, 0);
    const cylinder = extrude(pointsToShape(circlePoints(sw.stemOuterDiameter / 2, 48)), s + 0.5, -s);
    capGeom = csg(capGeom, cylinder, ADDITION);
    capGeom = csg(capGeom, extrude(crossShape(params), s + 1, -s - 1), SUBTRACTION);
  }
  if (wantEngrave && engraveDepth > 0.05 && !engraveInShell) {
    // design crosses the cap edge (presets) -> boolean subtraction, repaired afterwards
    const cutter = extrude(layout.designShapes, engraveDepth + 1, t - engraveDepth);
    capGeom = csg(capGeom, cutter, SUBTRACTION);
  }

  let designGeom = null;
  if (layout.designShapes.length && cap.designHeight > 0 && cap.designMode !== 'engraved') {
    {
      let relief = extrude(layout.designShapes, cap.designHeight, t);
      if (!designInsideCap) {
        // design crosses the cap edge (presets): clip it to the cap outline
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
 * Simplified plate-mount MX switch for the viewer, positioned for a body resting on z = 0
 * (plate top z = body.height - rimHeight, see resolveHeights). Relative to the plate top P:
 *   lower housing 13.95 sq:   P - plateThickness - 5.0  ..  P        (through the 14.0 cutout)
 *   pins 1.5 dia x 3.3:       hanging below the lower housing at the MX pin positions
 *   flange 15.6 sq x 0.8:     P .. P + 0.8                           (rests on the plate)
 *   upper housing frustum:    15.6 -> 13.0 sq, P + 0.8 .. P + 6.6
 *   stem cross 4.1 x 1.3:     P + 6.6 .. P + 6.6 + stemHeight        (cap underside at P + 6.6)
 */
export function buildReferenceSwitchGeometry(params) {
  const sw = params.switch;
  const heights = resolveHeights(params, []);
  const plateTop = heights.plateTopZ;
  const plateBottom = heights.plateBottomZ;
  const parts = [];
  const housingBottom = plateBottom - MX.LOWER_HOUSING_DEPTH;
  parts.push(box(MX.LOWER_HOUSING, MX.LOWER_HOUSING, housingBottom, plateTop + 0.01));
  for (const [px, py] of MX.PINS) {
    // pin bottom exactly at housingBottom - PIN_LENGTH; the extra 0.01 overlaps into the housing
    const pin = new THREE.CylinderGeometry(MX.PIN_DIAMETER / 2, MX.PIN_DIAMETER / 2, MX.PIN_LENGTH + 0.01, 12, 1);
    pin.rotateX(Math.PI / 2);
    pin.translate(px, py, housingBottom - MX.PIN_LENGTH / 2 + 0.005);
    parts.push(pin);
  }
  parts.push(box(MX.FLANGE, MX.FLANGE, plateTop, plateTop + MX.FLANGE_THICKNESS));
  const frustumH = MX.UPPER_HOUSING - MX.FLANGE_THICKNESS;
  const frustum = new THREE.CylinderGeometry(MX.UPPER_TOP_SIDE / Math.SQRT2, MX.FLANGE / Math.SQRT2, frustumH, 4, 1);
  frustum.rotateY(Math.PI / 4);
  frustum.rotateX(Math.PI / 2);
  frustum.translate(0, 0, plateTop + MX.FLANGE_THICKNESS + frustumH / 2 - 0.005);
  parts.push(frustum);
  const housingTop = plateTop + MX.UPPER_HOUSING;
  parts.push(box(sw.stemCrossWidth, sw.stemCrossThickness, housingTop - 0.01, housingTop + sw.stemHeight));
  parts.push(box(sw.stemCrossThickness, sw.stemCrossWidth, housingTop - 0.01, housingTop + sw.stemHeight));
  for (const p of parts) p.deleteAttribute('uv');
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}
