// 2D layout: turns a DesignSpec + params into mm-space outlines for the body, the
// cap recess, the cap and the (scaled, rotated, centred) design.
//
// Coordinate system: mm, +Y up, design centre at the origin (the switch stem / pocket
// are also at the origin, so the switch always sits under the middle of the design).
//
// Outline style ('outline'):
//   cap    = design (+) margin                       (morphological dilation with a disc)
//   recess = cap (+) clearance
//   body   = cap (+) wall + clearance
//   The cap is additionally OR-ed with a minimum rounded-square envelope of side
//   switch.pocket (the 15.6 mm MX flange) + 2*switchTolerance so the recess (cap + clearance)
//   always clears the flange and upper housing, and the body always encloses the cavity
//   below the plate, even for very narrow designs.
//   base.size is the DESIGN's longest side (times design.fill %); the body grows around it:
//   body long side = size + 2*(margin + wall + clearance) (e.g. 35 mm heart -> 45.6 mm body).
//   When the design is narrower than the pocket envelope the cap is widened to it (warning).
//
// Preset styles ('circle' | 'square' | 'hexagon'):
//   body   = preset with longest side == base.size (here base.size IS the base)
//   recess = preset inset by wall
//   cap    = preset inset by wall + clearance
//   design long side = (cap long side - 2*margin) * fill/100, clipped to the cap by CSG later.
// The layout reports designSize / capSize / bodySize (mm, longest sides) for the UI.

import * as THREE from 'three';
import { rasterizeShapes, rasterizePolygonsEvenOdd, dilateMask, convexHull, squaredDistanceToValue, maskWithinDistance, maskBounds } from './raster.js';
import { traceBitmap, shapesBBox } from './trace.js';

const WORK_PX = 1000; // px across the base's long side for the outline raster

// Housing pocket cut into the cap's underside (see solids.js): corner radius and the minimum cap
// wall around it. The cap's minimum envelope is the pocket offset by wall + ENVELOPE_PAD so every
// traced/smoothed cap outline still holds the pocket with the full wall.
export const CAP_POCKET_CORNER = 1.5;
export const CAP_POCKET_WALL = 1.2;
const ENVELOPE_PAD = 0.3; // covers raster quantisation + contour smoothing losses

// Fit to switch (outline style, base.fitSwitch): a wide, short design (a word) is grown until its
// short side + 2*margin covers the switch envelope plus COVER_PAD, so the letters hide the switch
// instead of a square envelope bump showing behind them. Growth stops at MAX_GROWN_LONG.
const COVER_PAD = 0.6;
export const MAX_GROWN_LONG = 140;

// Multiple switches under one cap (switch.count): spaced along the cap's long axis at the quarter
// points, never closer than the standard MX key pitch (cap pockets and body cavities stay apart).
// 'auto' picks two when the cap is at least AUTO_TWO_LENGTH long and AUTO_TWO_ASPECT times longer
// than it is wide (a long word), otherwise one.
export const SWITCH_PITCH = 19.05;
export const AUTO_TWO_LENGTH = 48;
export const AUTO_TWO_ASPECT = 1.8;

/**
 * Switch centres (mm, design frame) for a cap whose bounding box is capW x capH (centred on the
 * origin). count: 'auto' | 1 | 2. Returns { positions: [{x,y}], axis: 'x'|'y', requested }.
 */
export function planSwitches(count, capW, capH, envelopeSide) {
  const axis = capW >= capH ? 'x' : 'y';
  const L = Math.max(capW, capH);
  const S = Math.max(1e-6, Math.min(capW, capH));
  let n;
  if (count === 'auto' || !Number.isFinite(Number(count))) n = L >= AUTO_TWO_LENGTH && L / S >= AUTO_TWO_ASPECT ? 2 : 1;
  else n = Math.max(1, Math.min(2, Math.round(Number(count))));
  if (n === 1) return { positions: [{ x: 0, y: 0 }], axis, requested: n };
  const dMin = SWITCH_PITCH / 2;
  const dMax = L / 2 - envelopeSide / 2;
  const d = Math.max(dMin, Math.min(L / 4, dMax));
  const positions = axis === 'x' ? [{ x: -d, y: 0 }, { x: d, y: 0 }] : [{ x: 0, y: -d }, { x: 0, y: d }];
  return { positions, axis, requested: n };
}

// Printed outlines (body / recess / cap walls) get stronger smoothing than the design relief:
// a 7-px moving average on the raw pixel loop (kills 1-px notches that RDP would keep as
// "extreme" points), RDP 0.6 px, two corner-preserving Chaikin passes, a light post-RDP and a
// merge of near-collinear runs under 2 deg, so walls are clean curves without sub-0.1 mm jogs
// (which print as vertical hairlines).
const OUTLINE_TRACE = { preSmooth: 3, simplifyTolerance: 0.6, smoothIterations: 2, cornerAngle: 50, postSimplify: 0.3, mergeAngle: 2, minArea: 4 };

export function pointsToShape(outer, holes = []) {
  const s = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
  return s;
}

/** Sample any shapes (curves allowed) into pure polyline shapes. */
export function polylineShapes(shapes, curveSegments = 24) {
  return shapes.map((s) => {
    const pts = s.extractPoints(curveSegments);
    return pointsToShape(pts.shape, pts.holes);
  });
}

/** Apply fn(Vector2) -> {x,y} to every vertex of polyline shapes, returning new shapes. */
export function transformShapes(shapes, fn) {
  return shapes.map((s) => {
    const pts = s.extractPoints(1);
    return pointsToShape(pts.shape.map(fn), pts.holes.map((h) => h.map(fn)));
  });
}

export function circlePoints(r, n = 96) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return pts;
}

export function roundedRectPoints(hw, hh, r, segs = 10) {
  r = Math.max(0, Math.min(r, hw, hh));
  const pts = [];
  const corners = [
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
    [hw - r, -hh + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    if (r <= 1e-6) {
      pts.push({ x: cx, y: cy });
      continue;
    }
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (i / segs) * (Math.PI / 2);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }
  return pts;
}

/** Regular hexagon, vertex at +Y, circumradius R (height = 2R, width = sqrt(3) R). */
export function hexagonPoints(R) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    pts.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
  }
  return pts;
}

/** Preset outline polygon with the given inset (mm) from the nominal size. */
function presetPoints(style, size, cornerRadius, inset) {
  switch (style) {
    case 'circle':
      return circlePoints(Math.max(0.5, size / 2 - inset), 128);
    case 'hexagon':
      return hexagonPoints(Math.max(0.5, size / 2 - inset / Math.cos(Math.PI / 6)));
    case 'square':
    default: {
      const h = Math.max(0.5, size / 2 - inset);
      return roundedRectPoints(h, h, Math.max(0, cornerRadius - inset), 12);
    }
  }
}

function bboxOfPoints(pts) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    if (p.x < b.minX) b.minX = p.x;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.y < b.minY) b.minY = p.y;
    if (p.y > b.maxY) b.maxY = p.y;
  }
  return b;
}

function allPoints(shapes) {
  const out = [];
  for (const s of shapes) {
    const pts = s.extractPoints(1);
    out.push(...pts.shape);
    for (const h of pts.holes) out.push(...h);
  }
  return out;
}

export function pointInPolygon(p, pts) {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Minimum distance from the origin to the polygon boundary. */
export function minDistanceToPolygon(pts) {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(a.x * dx + a.y * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Compute the 2D layout.
 * Returns {
 *   style, bodyShape, recessShape, capShape   THREE.Shape (mm, polyline, no holes)
 *   designShapes                              THREE.Shape[] (mm, with holes) - [] when no design
 *   designLong, capLong, baseLong             mm
 *   bodyPoints, capPoints                     outer polygons as {x,y}[] (for ring placement etc.)
 * }
 */
export function computeLayout(spec, params, warnings = []) {
  const { base, design, body, fit } = params;
  const sw = params.switch;
  let style = base.style;
  const size = Math.max(5, base.size);
  const margin = Math.max(0, base.margin);
  const wall = Math.max(0.8, body.wall);
  const clearance = Math.max(0, fit.clearance);
  const fill = Math.max(1, Math.min(200, design.fill)) / 100;

  // --- design in its own units -> rotated, centred polylines ---------------------------------
  let designUnit = spec && spec.shapes && spec.shapes.length ? polylineShapes(spec.shapes, 24) : [];
  if (designUnit.length === 0 && style === 'outline') {
    style = 'circle';
    if (spec) warnings.push('Design is empty; using a circular base instead of an outline.');
  }
  let designLongUnits = 0;
  let designWUnits = 0;
  let designHUnits = 0;
  if (designUnit.length) {
    const b0 = bboxOfPoints(allPoints(designUnit));
    const cx = (b0.minX + b0.maxX) / 2;
    const cy = (b0.minY + b0.maxY) / 2;
    const rot = ((design.rotation || 0) * Math.PI) / 180;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    designUnit = transformShapes(designUnit, (p) => {
      const x = p.x - cx;
      const y = p.y - cy;
      return { x: x * c - y * s, y: x * s + y * c };
    });
    const b1 = bboxOfPoints(allPoints(designUnit));
    designUnit = transformShapes(designUnit, (p) => ({
      x: p.x - (b1.minX + b1.maxX) / 2,
      y: p.y - (b1.minY + b1.maxY) / 2,
    }));
    designWUnits = b1.maxX - b1.minX;
    designHUnits = b1.maxY - b1.minY;
    designLongUnits = Math.max(designWUnits, designHUnits);
  }

  // The cap must enclose the switch flange envelope AND its own housing pocket (flange + clearance)
  // with CAP_POCKET_WALL of material around it: envelope = pocket offset by wall + pad (a true
  // offset of the rounded square, so the clearance is uniform along the sides and corners).
  const pocketOffset = CAP_POCKET_WALL + ENVELOPE_PAD;
  const envelopeSide = Math.max(sw.pocket + 2 * fit.switchTolerance, sw.pocket + 2 * clearance + 2 * pocketOffset);
  const envelopeCorner = Math.max(Math.min(2.5, base.cornerRadius), CAP_POCKET_CORNER + pocketOffset);
  const envelopeHalfDiag = (envelopeSide / 2 - envelopeCorner) * Math.SQRT2 + envelopeCorner;

  let designLong;
  let capLong;
  let bodyShape;
  let recessShape;
  let capShape;
  let designShapes = [];
  let switchPositions = [{ x: 0, y: 0 }];
  let switchAxis = 'x';
  let grownFrom = 0; // > 0 when Fit to switch enlarged the design (the size it was asked to be)
  const switchCount = sw.count ?? 'auto';
  const envelopeAt = (c, inset = 0) =>
    roundedRectPoints(envelopeSide / 2 - inset, envelopeSide / 2 - inset, envelopeCorner, 8).map((p) => ({ x: p.x + c.x, y: p.y + c.y }));

  if (style === 'outline') {
    // base.size is the DESIGN's longest side (scaled by fill); cap, recess and body grow around it
    const pad = margin + wall + clearance;
    designLong = Math.max(2, size) * fill;
    // Fit to switch: grow a short, wide design until its short side + margin covers the envelope
    if (base.fitSwitch !== false && designLongUnits > 0) {
      const shortUnits = Math.min(designWUnits, designHUnits);
      const needShort = envelopeSide + COVER_PAD - 2 * margin;
      if (shortUnits > 1e-9 && needShort > 0) {
        const needLong = (needShort * designLongUnits) / shortUnits;
        // too thin to cover within MAX_GROWN_LONG (a long sentence, a bar): keep the asked size and
        // let the envelope widen the cap as before, rather than growing it and still showing the square
        if (needLong > designLong + 0.05 && needLong <= MAX_GROWN_LONG) {
          grownFrom = designLong;
          designLong = needLong;
        } else if (needLong > MAX_GROWN_LONG) {
          warnings.push(`The design is too thin to cover the switch even at ${MAX_GROWN_LONG} mm long, so the cap is widened around the switch instead. Shorter text fits better.`);
        }
      }
    }
    const sUnit = designLongUnits > 0 ? designLong / designLongUnits : 1;
    designShapes = transformShapes(designUnit, (p) => ({ x: p.x * sUnit, y: p.y * sUnit }));

    // switch positions from the cap's bounding box (design + margin on every side)
    const plan = planSwitches(switchCount, designWUnits * sUnit + 2 * margin, designHUnits * sUnit + 2 * margin, envelopeSide);
    switchPositions = plan.positions;
    switchAxis = plan.axis;
    const reach = Math.max(...switchPositions.map((c) => Math.max(Math.abs(c.x), Math.abs(c.y))));

    // --- raster space -------------------------------------------------------------------
    const envBody = envelopeSide + 2 * (wall + clearance);
    const extent = Math.max(envBody + 2 * reach, designLong + 2 * pad);
    const k = WORK_PX / extent; // px per mm
    const W = Math.ceil(extent * k) + 64;
    const H = W;
    const toPx = (p) => ({ x: p.x * k + W / 2, y: p.y * k + H / 2 });
    const toMm = (p) => ({ x: (p.x - W / 2) / k, y: (p.y - H / 2) / k });

    const designMask = rasterizeShapes(transformShapes(designShapes, toPx), W, H);
    let capMask = dilateMask(designMask, W, H, margin * k);
    // Warn when the design (+ margin) is narrower than the pocket envelope in either axis: the
    // envelope then sticks out beyond the design outline. (Filling internal concavities near the
    // centre - letter gaps, a heart's notch - is expected and silent: the switch sits there.)
    const capBB = maskBounds(capMask, W, H);
    if (capBB) {
      const capW = (capBB.maxX - capBB.minX + 1) / k;
      const capH = (capBB.maxY - capBB.minY + 1) / k;
      if (capW < envelopeSide - 0.1 || capH < envelopeSide - 0.1) {
        warnings.push(`The design is narrower than the switch pocket, so the cap is widened to ${envelopeSide.toFixed(1)} mm around it (the pocket envelope shows beyond the design outline).`);
      }
    }
    for (const c of switchPositions) rasterizePolygonsEvenOdd([envelopeAt(c).map(toPx)], W, H, capMask);

    let capTraced = traceBitmap(capMask, W, H, OUTLINE_TRACE);
    if (capTraced.length > 1) {
      warnings.push('Design has separated parts; the base was filled to their convex hull so it prints as one piece.');
      const hull = convexHull(allPoints(capTraced));
      rasterizePolygonsEvenOdd([hull], W, H, capMask);
      capTraced = traceBitmap(capMask, W, H, OUTLINE_TRACE);
    }
    // recess and body are both dilations of the cap: one distance field, two thresholds
    const capDist = squaredDistanceToValue(capMask, W, H, 1);
    const recessMask = maskWithinDistance(capDist, clearance * k);
    const bodyMask = maskWithinDistance(capDist, (wall + clearance) * k);
    const recessTraced = traceBitmap(recessMask, W, H, OUTLINE_TRACE);
    const bodyTraced = traceBitmap(bodyMask, W, H, OUTLINE_TRACE);

    const pickOuter = (traced) => {
      let best = null;
      for (const s of traced) if (!best || (s.userData.area || 0) > (best.userData.area || 0)) best = s;
      return best.getPoints(1).map(toMm);
    };
    const capPts = pickOuter(capTraced);
    const recessPts = pickOuter(recessTraced);
    const bodyPts = pickOuter(bodyTraced);
    capShape = pointsToShape(capPts);
    recessShape = pointsToShape(recessPts);
    bodyShape = pointsToShape(bodyPts);
    const cb = bboxOfPoints(capPts);
    capLong = Math.max(cb.maxX - cb.minX, cb.maxY - cb.minY);
  } else {
    if (!['circle', 'square', 'hexagon'].includes(style)) {
      warnings.push(`Unknown base style "${style}", using "circle".`);
      style = 'circle';
    }
    const bodyPts = presetPoints(style, size, base.cornerRadius, 0);
    const recessPts = presetPoints(style, size, base.cornerRadius, wall);
    const capPts = presetPoints(style, size, base.cornerRadius, wall + clearance);
    bodyShape = pointsToShape(bodyPts);
    recessShape = pointsToShape(recessPts);
    capShape = pointsToShape(capPts);
    capLong = size - 2 * (wall + clearance);
    const avail = capLong - 2 * margin;
    if (avail < 2) warnings.push(`Base size ${size} mm leaves no room for the design inside the cap; design was clamped to 2 mm.`);
    designLong = Math.max(2, avail) * fill;
    const sUnit = designLongUnits > 0 ? designLong / designLongUnits : 1;
    designShapes = transformShapes(designUnit, (p) => ({ x: p.x * sUnit, y: p.y * sUnit }));
    // presets keep their shape, so a second switch is only used when both envelopes fit inside
    const cb = bboxOfPoints(capPts);
    const plan = planSwitches(switchCount, cb.maxX - cb.minX, cb.maxY - cb.minY, envelopeSide);
    switchAxis = plan.axis;
    if (plan.positions.length > 1) {
      const fits = plan.positions.every((c) => envelopeAt(c, 0.15).every((p) => pointInPolygon(p, capPts)));
      if (fits) switchPositions = plan.positions;
      else if (switchCount !== 'auto') warnings.push(`This base is too small for two switches; it needs about ${(SWITCH_PITCH + envelopeSide + 2 * (wall + clearance)).toFixed(0)} mm along one side. Using one switch.`);
    }
  }

  const capPoints = capShape.getPoints(1);
  const bodyPoints = bodyShape.getPoints(1);
  // The recess (cap + clearance) must contain the switch envelope square so the upper
  // housing clears the body: test the envelope's (slightly shrunk) rounded corners.
  if (!switchPositions.every((c) => envelopeAt(c, 0.15).every((p) => pointInPolygon(p, capPoints)))) {
    const needCircle = 2 * (envelopeHalfDiag + wall + clearance);
    warnings.push(
      `Cap is too small to clear the switch (pocket ${envelopeSide.toFixed(1)} mm): increase the base size (a circle needs at least ${needCircle.toFixed(1)} mm) or use a smaller wall.`,
    );
  }
  const bb = bboxOfPoints(bodyPoints);

  return {
    style,
    bodyShape,
    recessShape,
    capShape,
    designShapes,
    designLong: designShapes.length ? designLong : 0,
    capLong,
    baseLong: Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY),
    designSize: designShapes.length ? designLong : 0,
    capSize: capLong,
    bodySize: Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY),
    bodyPoints,
    recessPoints: recessShape.getPoints(1),
    capPoints,
    switchPositions, // switch centres (mm, design frame); body cavities and cap pockets sit here
    switchAxis,
    grownFrom: designShapes.length ? grownFrom : 0,
  };
}

export { shapesBBox };
