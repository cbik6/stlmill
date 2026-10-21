// Mesh sanity helpers shared by the engine and the selftest (no DOM, no CSG).

/** Iterate triangles of an indexed or non-indexed geometry: cb(ax,ay,az,bx,by,bz,cx,cy,cz). */
export function forEachTriangle(geometry, cb) {
  const pos = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;
  const n = index ? index.length : pos.length / 3;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = (index ? index[i] : i) * 3;
    const b = (index ? index[i + 1] : i + 1) * 3;
    const c = (index ? index[i + 2] : i + 2) * 3;
    cb(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]);
  }
}

export function triangleCount(geometry) {
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
}

/**
 * Edges not shared by exactly two opposite-oriented triangles after snapping vertices to
 * 1e-4 mm (same test as the clicker selftest and the slicers' "open edges" count).
 */
export function openEdgeCount(geometry) {
  const pos = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;
  const n = index ? index.length : pos.length / 3;
  const ids = new Map();
  const vid = (i) => {
    const o = (index ? index[i] : i) * 3;
    const key = `${Math.round(pos[o] * 1e4)},${Math.round(pos[o + 1] * 1e4)},${Math.round(pos[o + 2] * 1e4)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };
  const edges = new Map();
  for (let i = 0; i + 2 < n; i += 3) {
    const a = vid(i), b = vid(i + 1), c = vid(i + 2);
    if (a === b || b === c || a === c) continue;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? u * 4294967296 + v : v * 4294967296 + u;
      edges.set(key, (edges.get(key) || 0) + (u < v ? 1 : -1));
    }
  }
  let open = 0;
  for (const v of edges.values()) if (v !== 0) open++;
  return open;
}

/** Signed volume of a closed mesh (divergence theorem), mm^3. */
export function meshVolume(geometry) {
  let v = 0;
  forEachTriangle(geometry, (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  });
  return v / 6;
}

/** All z values where a vertical ray through (x, y) crosses the surface, ascending. */
export function hitsAlongZ(geometry, x, y) {
  const out = [];
  forEachTriangle(geometry, (ax0, ay0, az, bx0, by0, bz, cx0, cy0, cz) => {
    const ax = ax0 - x, ay = ay0 - y, bx = bx0 - x, by = by0 - y, cx = cx0 - x, cy = cy0 - y;
    const d1 = ax * by - ay * bx, d2 = bx * cy - by * cx, d3 = cx * ay - cy * ax;
    if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) return;
    const area = d1 + d2 + d3;
    if (Math.abs(area) < 1e-12) return;
    out.push((az * d2 + bz * d3 + cz * d1) / area);
  });
  out.sort((a, b) => a - b);
  // a ray through a shared edge / vertex hits both triangles: keep one crossing
  const dedup = [];
  for (const z of out) if (!dedup.length || z - dedup[dedup.length - 1] > 1e-6) dedup.push(z);
  return dedup;
}

/** Lowest z hit by a vertical ray through (x, y), or null. */
export function hitFromBelow(geometry, x, y) {
  const hits = hitsAlongZ(geometry, x, y);
  return hits.length ? hits[0] : null;
}

export function extents(geometry) {
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  return {
    x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z,
    min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z },
  };
}
