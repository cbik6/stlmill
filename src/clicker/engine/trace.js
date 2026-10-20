// Binary mask -> THREE.Shape[] contour tracer.
//
// Pipeline: boundary (crack) following on the pixel grid with 4-connectivity
//   -> closed integer loops  (outer loops CCW / positive area, holes CW / negative area)
//   -> Ramer-Douglas-Peucker simplification
//   -> corner-preserving Chaikin smoothing
//   -> nesting classification: holes are attached to the smallest enclosing outer loop.
//
// Mask convention: see raster.js (y-up, mask[j*w+i] covers [i,i+1]x[j,j+1]).
// Output coordinates are in the same y-up pixel space (vertices on pixel corners).

import * as THREE from 'three';

/**
 * Extract raw closed loops from a binary mask.
 * Returns Array<Float64Array> where each loop is [x0,y0,x1,y1,...] (closed implicitly).
 */
export function traceLoops(mask, w, h) {
  // Emit directed boundary edges so that every filled pixel is traversed CCW (y-up):
  //   bottom (x,y)->(x+1,y), right (x+1,y)->(x+1,y+1), top (x+1,y+1)->(x,y+1), left (x,y+1)->(x,y)
  // Edges shared by two filled pixels cancel (never emitted).
  const W1 = w + 1;
  const ex0 = [];
  const ey0 = [];
  const ex1 = [];
  const ey1 = [];
  const head = new Int32Array(W1 * (h + 1)).fill(-1);
  const nextOut = [];

  const emit = (x0, y0, x1, y1) => {
    const idx = ex0.length;
    ex0.push(x0); ey0.push(y0); ex1.push(x1); ey1.push(y1);
    const key = y0 * W1 + x0;
    nextOut.push(head[key]);
    head[key] = idx;
  };

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      if (y === 0 || !mask[row - w + x]) emit(x, y, x + 1, y);           // bottom
      if (x === w - 1 || !mask[row + x + 1]) emit(x + 1, y, x + 1, y + 1); // right
      if (y === h - 1 || !mask[row + w + x]) emit(x + 1, y + 1, x, y + 1); // top
      if (x === 0 || !mask[row + x - 1]) emit(x, y + 1, x, y);           // left
    }
  }

  const nE = ex0.length;
  const used = new Uint8Array(nE);
  const loops = [];

  for (let start = 0; start < nE; start++) {
    if (used[start]) continue;
    const pts = [];
    let cur = start;
    let guard = 0;
    while (true) {
      used[cur] = 1;
      pts.push(ex0[cur], ey0[cur]);
      const vx = ex1[cur];
      const vy = ey1[cur];
      const dx = vx - ex0[cur];
      const dy = vy - ey0[cur];
      // candidates leaving the end vertex
      let best = -1;
      let bestCross = -Infinity;
      for (let e = head[vy * W1 + vx]; e !== -1; e = nextOut[e]) {
        if (used[e] && e !== start) continue;
        const cx = dx * (ey1[e] - ey0[e]) - dy * (ex1[e] - ex0[e]);
        // prefer the tightest left turn (hug the current pixel) -> 4-connected regions
        if (cx > bestCross) {
          bestCross = cx;
          best = e;
        }
      }
      if (best === -1 || best === start) break;
      cur = best;
      if (++guard > nE + 1) break; // safety, should never trigger
    }
    if (pts.length >= 6) loops.push(Float64Array.from(pts));
  }
  return loops;
}

/** Signed area of a flat [x,y,...] loop (positive = CCW in y-up). */
export function signedArea(loop) {
  const n = loop.length >> 1;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += loop[2 * i] * loop[2 * j + 1] - loop[2 * j] * loop[2 * i + 1];
  }
  return a / 2;
}

function perpDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** RDP on an open chain of indices [i0..i1] of `loop`; appends kept indices (excluding i1) to out. */
function rdpOpen(loop, idx, i0, i1, tol, out) {
  // iterative stack to avoid deep recursion
  const stack = [[i0, i1]];
  const keep = new Uint8Array(idx.length);
  keep[i0] = 1;
  keep[i1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = loop[2 * idx[a]], ay = loop[2 * idx[a] + 1];
    const bx = loop[2 * idx[b]], by = loop[2 * idx[b] + 1];
    let maxD = -1;
    let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(loop[2 * idx[i]], loop[2 * idx[i] + 1], ax, ay, bx, by);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tol) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  for (let i = i0; i < i1; i++) if (keep[i]) out.push(idx[i]);
}

/** Ramer-Douglas-Peucker for a closed loop. Returns a new flat loop. */
export function simplifyClosed(loop, tol) {
  const n = loop.length >> 1;
  if (n <= 4 || tol <= 0) return loop;
  // split at vertex 0 and the vertex farthest from it
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = (loop[2 * i] - loop[0]) ** 2 + (loop[2 * i + 1] - loop[1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const idxA = [];
  for (let i = 0; i <= far; i++) idxA.push(i);
  const idxB = [];
  for (let i = far; i <= n; i++) idxB.push(i % n);
  const kept = [];
  rdpOpen(loop, idxA, 0, idxA.length - 1, tol, kept);
  rdpOpen(loop, idxB, 0, idxB.length - 1, tol, kept);
  const out = new Float64Array(kept.length * 2);
  for (let k = 0; k < kept.length; k++) {
    out[2 * k] = loop[2 * kept[k]];
    out[2 * k + 1] = loop[2 * kept[k] + 1];
  }
  return out;
}

/**
 * One pass of Chaikin corner cutting on a closed loop, preserving vertices whose
 * turn angle exceeds `cornerAngleDeg` (sharp corners like the ones in glyph stems).
 */
export function chaikinClosed(loop, cornerAngleDeg = 50) {
  const n = loop.length >> 1;
  if (n < 3) return loop;
  const cosLimit = Math.cos((cornerAngleDeg * Math.PI) / 180);
  const out = [];
  for (let i = 0; i < n; i++) {
    const ip = (i + n - 1) % n;
    const inx = (i + 1) % n;
    const px = loop[2 * ip], py = loop[2 * ip + 1];
    const x = loop[2 * i], y = loop[2 * i + 1];
    const nx = loop[2 * inx], ny = loop[2 * inx + 1];
    const ax = x - px, ay = y - py;
    const bx = nx - x, by = ny - y;
    const la = Math.hypot(ax, ay) || 1;
    const lb = Math.hypot(bx, by) || 1;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < cosLimit) {
      // sharp corner: keep as is
      out.push(x, y);
    } else {
      out.push(x + (px - x) * 0.25, y + (py - y) * 0.25);
      out.push(x + (nx - x) * 0.25, y + (ny - y) * 0.25);
    }
  }
  return Float64Array.from(out);
}

/**
 * Drop vertices that are (near-)collinear with their neighbours or coincide with them.
 * Earcut removes exactly-collinear points when triangulating extrusion caps, which would
 * leave T-junctions against the side walls, so the loops must not contain any.
 */
export function removeCollinear(loop, areaEps = 1e-6, distEps = 1e-6) {
  // consecutive duplicates first (a duplicate makes a zero-area triple at its neighbour,
  // which would otherwise delete a real corner)
  let pts = [];
  for (let i = 0; i < loop.length; i += 2) {
    const n = pts.length;
    if (n >= 2 && Math.abs(pts[n - 2] - loop[i]) <= distEps && Math.abs(pts[n - 1] - loop[i + 1]) <= distEps) continue;
    pts.push(loop[i], loop[i + 1]);
  }
  while (pts.length >= 4 && Math.abs(pts[0] - pts[pts.length - 2]) <= distEps && Math.abs(pts[1] - pts[pts.length - 1]) <= distEps) pts.length -= 2;
  let changed = true;
  while (changed && pts.length >= 8) {
    changed = false;
    const n = pts.length >> 1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const ip = (i + n - 1) % n;
      const inx = (i + 1) % n;
      const px = pts[2 * ip], py = pts[2 * ip + 1];
      const x = pts[2 * i], y = pts[2 * i + 1];
      const nx = pts[2 * inx], ny = pts[2 * inx + 1];
      const area = Math.abs((x - px) * (ny - py) - (y - py) * (nx - px));
      const dup = Math.abs(x - nx) <= distEps && Math.abs(y - ny) <= distEps;
      if (dup || area <= areaEps) {
        changed = true;
        // skip this vertex; neighbours are re-examined on the next pass
        continue;
      }
      out.push(x, y);
    }
    pts = out;
  }
  return Float64Array.from(pts);
}

function pointInLoop(x, y, loop) {
  const n = loop.length >> 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = loop[2 * i], yi = loop[2 * i + 1];
    const xj = loop[2 * j], yj = loop[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function loopToVec2(loop) {
  const n = loop.length >> 1;
  const pts = new Array(n);
  for (let i = 0; i < n; i++) pts[i] = new THREE.Vector2(loop[2 * i], loop[2 * i + 1]);
  return pts;
}

/**
 * Convert processed loops into THREE.Shape[] with holes attached by nesting.
 * `loops` must be flat arrays with CCW outer / CW hole orientation.
 */
export function loopsToShapes(loops) {
  const outers = [];
  const holes = [];
  for (const loop of loops) {
    const a = signedArea(loop);
    if (a > 0) outers.push({ loop, area: a });
    else if (a < 0) holes.push({ loop, area: -a });
  }
  const shapes = outers.map((o) => {
    const s = new THREE.Shape(loopToVec2(o.loop));
    s.userData = { area: o.area };
    return s;
  });
  for (const hole of holes) {
    const hx = hole.loop[0];
    const hy = hole.loop[1];
    let bestI = -1;
    let bestArea = Infinity;
    for (let i = 0; i < outers.length; i++) {
      const o = outers[i];
      if (o.area <= hole.area) continue;
      if (o.area < bestArea && pointInLoop(hx, hy, o.loop)) {
        bestArea = o.area;
        bestI = i;
      }
    }
    if (bestI >= 0) shapes[bestI].holes.push(new THREE.Path(loopToVec2(hole.loop)));
  }
  return shapes;
}

/**
 * Merge runs of near-collinear vertices: a vertex is dropped while the turn accumulated
 * since the last kept vertex stays below `angleDeg`. Chord deviation stays negligible
 * (< r*(1-cos(angle/2))) while tiny pixel jogs on smooth walls disappear.
 */
export function mergeNearCollinear(loop, angleDeg) {
  const n = loop.length >> 1;
  if (n < 4 || angleDeg <= 0) return loop;
  const limit = (angleDeg * Math.PI) / 180;
  const turnAt = (i) => {
    const ip = (i + n - 1) % n;
    const inx = (i + 1) % n;
    const ax = loop[2 * i] - loop[2 * ip], ay = loop[2 * i + 1] - loop[2 * ip + 1];
    const bx = loop[2 * inx] - loop[2 * i], by = loop[2 * inx + 1] - loop[2 * i + 1];
    return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  };
  // start at the sharpest vertex so the accumulation never straddles a corner
  let start = 0;
  let maxTurn = -1;
  for (let i = 0; i < n; i++) {
    const t = turnAt(i);
    if (t > maxTurn) {
      maxTurn = t;
      start = i;
    }
  }
  const out = [];
  let accum = 0;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const t = turnAt(i);
    if (k === 0 || accum + t >= limit) {
      out.push(loop[2 * i], loop[2 * i + 1]);
      accum = 0;
    } else {
      accum += t;
    }
  }
  return out.length >= 6 ? Float64Array.from(out) : loop;
}

/**
 * Moving-average low-pass on a closed loop (window = 2*halfWidth+1 vertices, `passes` times).
 * Applied to the raw 1-px crack loop it removes pixel notches that RDP would otherwise keep
 * (on a curved contour the notch tips are the farthest-from-chord points). Convex curves shrink
 * by ~halfWidth^2 / (6 r) px, negligible for printed outlines; sharp corners round over ~halfWidth px.
 */
export function boxSmoothClosed(loop, halfWidth, passes = 2) {
  const n = loop.length >> 1;
  if (halfWidth <= 0 || n < 2 * halfWidth + 3) return loop;
  let src = loop;
  const w = 2 * halfWidth + 1;
  for (let p = 0; p < passes; p++) {
    const out = new Float64Array(src.length);
    let sx = 0, sy = 0;
    for (let k = -halfWidth; k <= halfWidth; k++) {
      const j = (k + n) % n;
      sx += src[2 * j];
      sy += src[2 * j + 1];
    }
    for (let i = 0; i < n; i++) {
      out[2 * i] = sx / w;
      out[2 * i + 1] = sy / w;
      const drop = (i - halfWidth + n) % n;
      const add = (i + halfWidth + 1) % n;
      sx += src[2 * add] - src[2 * drop];
      sy += src[2 * add + 1] - src[2 * drop + 1];
    }
    src = out;
  }
  return src;
}

/**
 * Trace a binary mask into THREE.Shape[] (with holes), coordinates in y-up pixel space.
 *
 * options:
 *   preSmooth          moving-average half-width (px) applied to the raw loop before RDP; 0 = off (default)
 *   simplifyTolerance  RDP tolerance in px (default 0.75 - removes pixel staircases)
 *   smoothIterations   Chaikin passes (default 1)
 *   cornerAngle        turn angle (deg) above which a vertex is kept sharp (default 50)
 *   minArea            drop loops smaller than this many px^2 (default 3)
 *   postSimplify       RDP tolerance (px) applied after smoothing (default simplifyTolerance / 3)
 *   mergeAngle         merge near-collinear runs below this turn (deg); 0 = off (default)
 */
export function traceBitmap(mask, w, h, options = {}) {
  const {
    preSmooth = 0,
    simplifyTolerance = 0.75,
    smoothIterations = 1,
    cornerAngle = 50,
    minArea = 3,
    postSimplify = simplifyTolerance / 3,
    mergeAngle = 0,
  } = options;

  const raw = traceLoops(mask, w, h);
  const processed = [];
  for (let loop of raw) {
    if (Math.abs(signedArea(loop)) < minArea) continue;
    if (preSmooth > 0) loop = boxSmoothClosed(loop, preSmooth, 2);
    loop = simplifyClosed(loop, simplifyTolerance);
    for (let i = 0; i < smoothIterations; i++) loop = chaikinClosed(loop, cornerAngle);
    // Chaikin doubles the vertex count; a light second RDP pass removes the redundant
    // near-collinear points so extrusions have far fewer sliver triangles.
    if (smoothIterations > 0 && postSimplify > 0) loop = simplifyClosed(loop, postSimplify);
    if (mergeAngle > 0) loop = mergeNearCollinear(loop, mergeAngle);
    loop = removeCollinear(loop);
    if (loop.length >= 6 && Math.abs(signedArea(loop)) >= minArea) processed.push(loop);
  }
  return loopsToShapes(processed);
}

/** Axis-aligned bbox of THREE.Shape[] (outer contours only). */
export function shapesBBox(shapes, curveSegments = 12) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const s of shapes) {
    for (const p of s.getPoints(curveSegments)) {
      if (p.x < b.minX) b.minX = p.x;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.y > b.maxY) b.maxY = p.y;
    }
  }
  if (!isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return b;
}
