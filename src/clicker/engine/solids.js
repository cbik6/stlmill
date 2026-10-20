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
import { traceBitmap } from './trace.js';

// Simplified Cherry MX reference dimensions (mm), plate-mount
export const MX = {
  UPPER_HOUSING: 6.6, // plate top -> top of upper housing (where the cap's underside rests)
  STEM_HEIGHT: 3.6, // the MX cross stem above the upper housing (the cap socket depth is switch.stemHeight)
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
  // Seated cap: the stem boss (socket depth = stemHeight) rests on the upper housing top, so the
  // cap's underside slab sits at plateTop + 6.6 + stemHeight (0.4 mm stem play with a 4.0 socket).
  const seat = MX.UPPER_HOUSING + Math.max(0.5, sw.stemHeight);
  const capZ = plateTopZ + seat; // z of the cap's bottom face (cap frame origin) in the body frame
  if (capZ > H + 0.05) {
    warnings.push(`Cap sits ${(capZ - H).toFixed(1)} mm above the body rim (switch housing + stem boss are taller than the recess). Set rimHeight to at least ${seat.toFixed(1)} mm to seat the cap inside the rim.`);
  } else if (capZ + cap.thickness < H - 0.05) {
    warnings.push(`Cap top ends up ${(H - capZ - cap.thickness).toFixed(1)} mm below the body rim and cannot be pressed comfortably; reduce rimHeight below ${(seat + cap.thickness).toFixed(1)} mm or thicken the cap.`);
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

/** MX cross polygon (width x thickness, both arms) as 12 CCW points. */
export function crossPolygon(width, thickness) {
  const w = width / 2;
  const t = thickness / 2;
  return [
    [-w, -t], [-t, -t], [-t, -w], [t, -w], [t, -t], [w, -t],
    [w, t], [t, t], [t, w], [-t, w], [-t, t], [-w, t],
  ].map(([x, y]) => ({ x, y }));
}

/** MX cross (stemCrossWidth x stemCrossThickness) as a Shape, CCW. */
export function crossShape(params, width = params.switch.stemCrossWidth, thickness = params.switch.stemCrossThickness) {
  return new THREE.Shape(crossPolygon(width, thickness).map((p) => new THREE.Vector2(p.x, p.y)));
}

/**
 * Socket cross-sections for the cap stem (and the test coupons).
 *   'cross'   straight MX cross: stemCrossWidth x stemCrossThickness, full depth
 *   'tapered' cross lofted from socketOpening (at the opening) to stemCrossWidth (at the ceiling);
 *             the arm thickness scales by the same ratio so every face has a lead-in
 *   'round'   plain cylinder hole of roundDiameter (glue fit)
 * Returns { mode, opening, ceiling, extent } - opening/ceiling are CCW polygons with the same
 * vertex count (so a loft between them is clean); extent is the opening's largest dimension.
 */
export function socketPolygons(sw) {
  const mode = sw.socketMode === 'round' || sw.socketMode === 'cross' ? sw.socketMode : 'tapered';
  const width = Math.max(1, sw.stemCrossWidth);
  const thick = Math.max(0.4, sw.stemCrossThickness);
  if (mode === 'round') {
    const d = Math.max(1, sw.roundDiameter);
    const c = cleanPolygon(circlePoints(d / 2, 48));
    return { mode, opening: c, ceiling: c, extent: d };
  }
  const ceiling = cleanPolygon(crossPolygon(width, thick));
  if (mode === 'cross') return { mode, opening: ceiling, ceiling, extent: width };
  const open = Math.max(width, sw.socketOpening);
  const ratio = open / width;
  const opening = cleanPolygon(crossPolygon(open, Math.min(thick * ratio, open / 2)));
  return { mode, opening, ceiling, extent: open };
}

/**
 * Add a blind socket to a shell: the ring face of `outer` around the opening at zOpen, the
 * socket walls (loft) down/up to zCeil and the ceiling face at zCeil. Works in both directions
 * (zCeil > zOpen: socket going up from a bottom face, as in the cap; zCeil < zOpen: socket going
 * down from a top face, as in the coupons).
 */
export function addSocket(b, outer, zOpen, zCeil, socket, extraHoles = []) {
  const up = zCeil < zOpen; // socket opens on a top face
  b.face(outer, [socket.opening, ...extraHoles], zOpen, up);
  b.face(socket.ceiling, [], zCeil, up);
  if (up) b.loft(socket.ceiling, socket.opening, zCeil, zOpen, true);
  else b.loft(socket.opening, socket.ceiling, zOpen, zCeil, true);
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

  const s = Math.max(0.5, sw.stemHeight); // socket depth
  const P = cleanPolygon(layout.capPoints);
  const socket = socketPolygons(sw);
  // keep at least a 1 mm boss wall around the socket opening
  let bossD = sw.stemOuterDiameter;
  const minBoss = socket.extent + 2.0;
  if (bossD < minBoss) {
    bossD = minBoss;
    warnings.push(`Stem boss widened to ${bossD.toFixed(1)} mm to keep a 1 mm wall around the ${socket.mode} socket.`);
  }
  const S = cleanPolygon(circlePoints(bossD / 2, 48));
  const stemFits = polygonContains(P, S, 0.05) && polygonContains(S, socket.opening, 0.05);

  // design polygons (cleaned once; shared by faces and walls)
  const designPolys = layout.designShapes.map((sh) => {
    const pts = sh.extractPoints(1);
    return { outer: cleanPolygon(pts.shape), holes: pts.holes.map(cleanPolygon).filter((h) => h.length >= 3) };
  }).filter((d) => d.outer.length >= 3);
  const designInsideCap = designPolys.length > 0 && designPolys.every((d) => polygonContains(P, d.outer, 0.05));

  // 'engraved' and 'inlay' both pocket the design into the cap top; 'inlay' adds a filler part.
  const mode = cap.designMode === 'engraved' || cap.designMode === 'inlay' ? cap.designMode : 'raised';
  let engraveDepth = 0;
  const wantEngrave = layout.designShapes.length > 0 && cap.designHeight > 0 && mode !== 'raised';
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
    b.face(P, [S], 0, false); // cap underside around the stem boss
    b.wall(S, -s, 0, false); // boss outer wall
    addSocket(b, S, -s, 0, socket); // boss bottom ring, socket walls (lofted when tapered), ceiling at z = 0
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
    warnings.push('Cap outline is too small for the stem; fell back to boolean construction (straight socket at the opening size).');
    capGeom = extrude(layout.capShape, t, 0);
    const cylinder = extrude(pointsToShape(circlePoints(bossD / 2, 48)), s + 0.5, -s);
    capGeom = csg(capGeom, cylinder, ADDITION);
    capGeom = csg(capGeom, extrude(pointsToShape(socket.opening), s + 1, -s - 1), SUBTRACTION);
  }
  if (wantEngrave && engraveDepth > 0.05 && !engraveInShell) {
    // design crosses the cap edge (presets) -> boolean subtraction, repaired afterwards
    const cutter = extrude(layout.designShapes, engraveDepth + 1, t - engraveDepth);
    capGeom = csg(capGeom, cutter, SUBTRACTION);
  }

  let designGeom = null;
  const fillerDepth = mode === 'inlay' ? engraveDepth : cap.designHeight;
  if (layout.designShapes.length && fillerDepth > 0.05 && mode !== 'engraved') {
    {
      // raised: relief standing on the cap top; inlay: filler exactly filling the pocket (flush top)
      let relief = mode === 'inlay' ? extrude(layout.designShapes, fillerDepth, t - fillerDepth) : extrude(layout.designShapes, fillerDepth, t);
      if (!designInsideCap) {
        // design crosses the cap edge (presets): clip it to the cap outline. The clip prism
        // overlaps the relief by 1 mm top and bottom so no faces are coplanar.
        const z0 = (mode === 'inlay' ? t - fillerDepth : t) - 1;
        const clip = extrude(layout.capShape, fillerDepth + 2, z0);
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

/** The six socket variants on the press-fit test plate (all 4.0 mm deep). */
export const SOCKET_COUPONS = [
  { label: 'A straight 4.1', socketMode: 'cross', stemCrossWidth: 4.1, stemCrossThickness: 1.3 },
  { label: 'B straight 4.3', socketMode: 'cross', stemCrossWidth: 4.3, stemCrossThickness: 1.4 },
  { label: 'C tapered 4.6-4.1', socketMode: 'tapered', stemCrossWidth: 4.1, stemCrossThickness: 1.3, socketOpening: 4.6 },
  { label: 'D tapered 4.8-4.2', socketMode: 'tapered', stemCrossWidth: 4.2, stemCrossThickness: 1.3, socketOpening: 4.8 },
  { label: 'E round 5.0', socketMode: 'round', roundDiameter: 5.0 },
  { label: 'F round 5.4', socketMode: 'round', roundDiameter: 5.4 },
];

/**
 * Press-fit test plate: six 14 mm round pucks, 6 mm tall, in a row with 8 mm gaps, each with one
 * socket variant. Built directly in PRINT orientation: the socket opens on the TOP face (z = 6)
 * and its ceiling is 4 mm down (z = 2), so the plate prints without supports and the sockets are
 * pressed onto a real switch from above. One closed shell per puck; parts carry `print` so the
 * exporters keep this layout and the Assembly View shows the same row.
 * Returns { parts: [{ name, geometry, color, print }] }.
 */
// 5 x 7 bitmaps (top row first) for the coupon labels
export const GLYPHS_5X7 = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
};
export const LABEL = { maxPixel: 0.7, raster: 0.1, height: 0.6, clearance: 1.0 }; // glyph pixel cap (mm), raster cell (mm), emboss (mm), clearance (mm)

/**
 * Largest glyph pixel (mm) for a 5x7 letter placed on -X beside a socket of radius `socketR`
 * on a puck of `diameter`, keeping LABEL.clearance to the socket opening and inside the rim,
 * capped at LABEL.maxPixel and snapped down to the raster. The glyph is centred at
 * x = -(socketR + clearance + 2.5 * pixel); its outer corners lie at r = (socketR + clearance + 5p, 3.5p).
 */
export function labelPixelSize(diameter, socketR, { maxPixel = LABEL.maxPixel, clearance = LABEL.clearance, raster = LABEL.raster } = {}) {
  const a = socketR + clearance;
  const r = diameter / 2 - clearance;
  // (a + 5p)^2 + (3.5p)^2 <= r^2  ->  37.25 p^2 + 10 a p + (a^2 - r^2) <= 0
  const disc = 100 * a * a - 4 * 37.25 * (a * a - r * r);
  if (disc <= 0) return 0;
  let p = (-10 * a + Math.sqrt(disc)) / (2 * 37.25);
  p = Math.min(maxPixel, p);
  p = Math.floor(p / raster + 1e-9) * raster;
  return p > 0 ? +p.toFixed(6) : 0;
}

/**
 * Polygons (mm, +Y up, readable from +Z) of a 5x7 glyph centred at (cx, cy): the bitmap is
 * rasterized at LABEL.raster mm per cell (each glyph pixel = `pixel` mm) and traced with
 * traceBitmap, so counters (A: 1, B: 2) come out as real holes. Returns [{ outer, holes }].
 */
export function labelPolygons(letter, cx = 0, cy = 0, pixel = LABEL.maxPixel) {
  const rows = GLYPHS_5X7[letter];
  if (!rows || !(pixel > 0)) return [];
  const cell = Math.max(1, Math.round(pixel / LABEL.raster)); // raster cells per glyph pixel
  const w = 5 * cell + 2;
  const h = 7 * cell + 2;
  const mask = new Uint8Array(w * h);
  rows.forEach((row, r) => {
    for (let c = 0; c < 5; c++) {
      if (row[c] !== '1') continue;
      for (let j = 0; j < cell; j++) {
        const y = (6 - r) * cell + 1 + j; // bitmap top row -> highest y (mask is y-up)
        for (let i = 0; i < cell; i++) mask[y * w + (c * cell + 1 + i)] = 1;
      }
    }
  });
  const shapes = traceBitmap(mask, w, h, { simplifyTolerance: 0.3, smoothIterations: 0, minArea: 2 });
  const px = cell * LABEL.raster; // effective glyph pixel after raster snapping
  const toMm = (p) => ({ x: (p.x - 1) * LABEL.raster - (5 * px) / 2 + cx, y: (p.y - 1) * LABEL.raster - (7 * px) / 2 + cy });
  return shapes.map((s) => {
    const pts = s.extractPoints(1);
    return { outer: cleanPolygon(pts.shape.map(toMm)), holes: pts.holes.map((hh) => cleanPolygon(hh.map(toMm))) };
  });
}

/** Widest socket opening radius across the coupon variants (the label keeps clear of this on every puck). */
export function couponMaxSocketRadius() {
  return Math.max(...SOCKET_COUPONS.map((v) => socketPolygons({ stemCrossWidth: 4.1, stemCrossThickness: 1.3, socketOpening: 4.6, roundDiameter: 5.0, ...v }).extent)) / 2;
}

export function buildSocketCoupons({ diameter = 18, height = 6, depth = 4.0, gap = 8, color = '#f5f5f5' } = {}) {
  const parts = [];
  const pitch = diameter + gap;
  // label: largest glyph pixel (<= 0.7 mm) that stays 1 mm clear of the widest socket opening
  // (F: r 2.7) and 1 mm inside the rim; same position on every puck so the row reads consistently
  const maxSocketR = couponMaxSocketRadius();
  const pixel = labelPixelSize(diameter, maxSocketR);
  const labelX = -(maxSocketR + LABEL.clearance + (5 * pixel) / 2);
  SOCKET_COUPONS.forEach((variant, i) => {
    const sw = { stemCrossWidth: 4.1, stemCrossThickness: 1.3, socketOpening: 4.6, roundDiameter: 5.0, ...variant };
    const socket = socketPolygons(sw);
    const outer = cleanPolygon(circlePoints(diameter / 2, 64));
    const glyphs = pixel > 0 ? labelPolygons(variant.label[0], labelX, 0, pixel) : [];
    const b = new ShellBuilder();
    b.face(outer, [], 0, false); // bottom (on the plate)
    b.wall(outer, 0, height, false); // puck wall
    // top ring (with the letter outlines cut out), socket walls, ceiling facing up
    addSocket(b, outer, height, height - depth, socket, glyphs.map((g) => g.outer));
    const zTop = height + LABEL.height;
    for (const g of glyphs) {
      b.wall(g.outer, height, zTop, false); // letter side walls
      b.face(g.outer, g.holes, zTop, true); // letter top
      for (const hole of g.holes) {
        b.wall(hole, height, zTop, true); // counter walls
        b.face(hole, [], height, true); // counter floor (puck top inside the counter)
      }
    }
    const geometry = b.build();
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    parts.push({
      name: variant.label,
      geometry,
      color,
      print: { x: (i - (SOCKET_COUPONS.length - 1) / 2) * pitch, y: 0, flipX: false, keepLayoutInAssembly: true },
    });
  });
  return { parts };
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
  parts.push(box(sw.stemCrossWidth, sw.stemCrossThickness, housingTop - 0.01, housingTop + MX.STEM_HEIGHT));
  parts.push(box(sw.stemCrossThickness, sw.stemCrossWidth, housingTop - 0.01, housingTop + MX.STEM_HEIGHT));
  for (const p of parts) p.deleteAttribute('uv');
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}
