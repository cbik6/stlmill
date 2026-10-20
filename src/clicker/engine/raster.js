// Pure-JS raster utilities shared by the design, outline and trace pipeline.
// No DOM / canvas dependency so everything here also runs under Node.
//
// Mask convention (used everywhere in the engine):
//   mask is a Uint8Array of length w*h, value 1 = "filled" (design), 0 = empty.
//   mask[j*w + i] covers the unit cell [i, i+1] x [j, j+1] in a *y-up* pixel space.
//   (Canvas ImageData is y-down, so canvas-derived masks flip rows when they are built.)

/**
 * Scanline-fill a set of polygons into `mask` using the even-odd rule.
 * polys: Array<Array<{x,y}>> in y-up pixel space. A polygon set is typically
 * [outer, ...holes] of a single THREE.Shape so even-odd carves the holes.
 * Pixels are filled when their centre (i+0.5, j+0.5) is inside.
 */
export function rasterizePolygonsEvenOdd(polys, w, h, mask) {
  const edges = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    const n = poly.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) continue;
      if (a.y === b.y) continue;
      if (a.y < b.y) edges.push([a.x, a.y, b.x, b.y]);
      else edges.push([b.x, b.y, a.x, a.y]);
      if (a.y < minY) minY = a.y;
      if (b.y < minY) minY = b.y;
      if (a.y > maxY) maxY = a.y;
      if (b.y > maxY) maxY = b.y;
    }
  }
  if (edges.length < 2) return mask;
  edges.sort((p, q) => p[1] - q[1]);

  const j0 = Math.max(0, Math.floor(minY));
  const j1 = Math.min(h - 1, Math.ceil(maxY));
  let next = 0;
  const active = [];
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const y = j + 0.5;
    while (next < edges.length && edges[next][1] <= y) {
      active.push(edges[next]);
      next++;
    }
    // drop finished edges, collect crossings
    xs.length = 0;
    for (let k = active.length - 1; k >= 0; k--) {
      const e = active[k];
      if (y >= e[3]) {
        active[k] = active[active.length - 1];
        active.pop();
        continue;
      }
      if (y >= e[1]) {
        const t = (y - e[1]) / (e[3] - e[1]);
        xs.push(e[0] + t * (e[2] - e[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = j * w;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let i0 = Math.ceil(xs[k] - 0.5);
      let i1 = Math.floor(xs[k + 1] - 0.5);
      if (i0 < 0) i0 = 0;
      if (i1 > w - 1) i1 = w - 1;
      for (let i = i0; i <= i1; i++) mask[row + i] = 1;
    }
  }
  return mask;
}

/**
 * Rasterize THREE.Shape[] (already in y-up pixel space) into a mask, OR-ing shapes together.
 * Each shape is filled with its holes carved (even-odd over [outer, ...holes]).
 */
export function rasterizeShapes(shapes, w, h, mask = new Uint8Array(w * h), curveSegments = 12) {
  for (const shape of shapes) {
    const pts = shape.extractPoints(curveSegments);
    rasterizePolygonsEvenOdd([pts.shape, ...pts.holes], w, h, mask);
  }
  return mask;
}

/**
 * Rasterize a triangle soup (flat [x0,y0,x1,y1,x2,y2,...] in y-up pixel space) into a mask.
 */
export function rasterizeTriangles(tris, w, h, mask = new Uint8Array(w * h)) {
  const poly = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  for (let i = 0; i + 5 < tris.length; i += 6) {
    poly[0].x = tris[i]; poly[0].y = tris[i + 1];
    poly[1].x = tris[i + 2]; poly[1].y = tris[i + 3];
    poly[2].x = tris[i + 4]; poly[2].y = tris[i + 5];
    rasterizePolygonsEvenOdd([poly], w, h, mask);
  }
  return mask;
}

// ---------------------------------------------------------------------------
// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher), used for
// morphological dilation / erosion with a true disc structuring element.
// ---------------------------------------------------------------------------
const INF = 1e20;

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared distance (in px) from each pixel to the nearest pixel whose mask value === `value`. */
export function squaredDistanceToValue(mask, w, h, value) {
  const g = new Float64Array(w * h);
  for (let p = 0; p < w * h; p++) g[p] = mask[p] === value ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = g[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[row + x] = d[x];
  }
  return g;
}

/** Morphological dilation by a disc of radius r (px). */
export function dilateMask(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const d = squaredDistanceToValue(mask, w, h, 1);
  const out = new Uint8Array(w * h);
  const r2 = r * r;
  for (let p = 0; p < w * h; p++) out[p] = d[p] <= r2 ? 1 : 0;
  return out;
}

/** Morphological erosion by a disc of radius r (px). */
export function erodeMask(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const d = squaredDistanceToValue(mask, w, h, 0);
  const out = new Uint8Array(w * h);
  const r2 = r * r;
  for (let p = 0; p < w * h; p++) out[p] = d[p] > r2 ? 1 : 0;
  return out;
}

/** Morphological closing (dilate then erode) - fills gaps narrower than ~2r. */
export function closeMask(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  return erodeMask(dilateMask(mask, w, h, r), w, h, r);
}

/** 3x3 majority filter, `iterations` times. Removes speckle noise and ragged edges. */
export function majorityFilter(mask, w, h, iterations = 1) {
  let src = mask;
  for (let it = 0; it < iterations; it++) {
    const dst = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(w - 1, x + 1);
        let sum = 0;
        let cnt = 0;
        for (let yy = y0; yy <= y1; yy++) {
          const row = yy * w;
          for (let xx = x0; xx <= x1; xx++) {
            sum += src[row + xx];
            cnt++;
          }
        }
        dst[y * w + x] = sum * 2 > cnt ? 1 : 0;
      }
    }
    src = dst;
  }
  return src === mask ? mask.slice() : src;
}

/**
 * Flood-fill from the image corners (and edge midpoints) over near-uniform colour.
 * rgba: Uint8ClampedArray (canvas ImageData order, y-down). Returns a Uint8Array (y-down!)
 * with 1 where the pixel belongs to the background. `tolerance` is max per-channel difference.
 */
export function floodBackground(rgba, w, h, tolerance = 40) {
  const bg = new Uint8Array(w * h);
  const seeds = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [w >> 1, 0], [w >> 1, h - 1], [0, h >> 1], [w - 1, h >> 1],
  ];
  const stack = new Int32Array(w * h);
  for (const [sx, sy] of seeds) {
    const s = sy * w + sx;
    if (bg[s]) continue;
    const r0 = rgba[s * 4];
    const g0 = rgba[s * 4 + 1];
    const b0 = rgba[s * 4 + 2];
    const a0 = rgba[s * 4 + 3];
    let top = 0;
    stack[top++] = s;
    bg[s] = 1;
    while (top > 0) {
      const p = stack[--top];
      const x = p % w;
      const y = (p - x) / w;
      const nb = [p - 1, p + 1, p - w, p + w];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (k === 0 && x === 0) continue;
        if (k === 1 && x === w - 1) continue;
        if (k === 2 && y === 0) continue;
        if (k === 3 && y === h - 1) continue;
        if (bg[q]) continue;
        const o = q * 4;
        if (
          Math.abs(rgba[o] - r0) <= tolerance &&
          Math.abs(rgba[o + 1] - g0) <= tolerance &&
          Math.abs(rgba[o + 2] - b0) <= tolerance &&
          Math.abs(rgba[o + 3] - a0) <= tolerance
        ) {
          bg[q] = 1;
          stack[top++] = q;
        }
      }
    }
  }
  return bg;
}

/** Flip a y-down mask (canvas order) into the engine's y-up convention (or back - it is symmetric). */
export function flipMaskY(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    out.set(mask.subarray(y * w, (y + 1) * w), (h - 1 - y) * w);
  }
  return out;
}

/** Bounding box of filled pixels: { minX, minY, maxX, maxY } (inclusive pixel indices) or null. */
export function maskBounds(mask, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** Andrew's monotone-chain convex hull of {x,y} points (CCW). */
export function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
