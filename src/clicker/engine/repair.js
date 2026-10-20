// Post-CSG mesh repair: weld vertices and fix T-junctions so each part is topologically
// watertight (every edge shared by exactly two triangles with opposite orientation).
//
// three-bvh-csg's splitter only re-triangulates triangles that intersect the other brush;
// with long sliver triangles on large planar faces (extruded outlines with hundreds of
// vertices) neighbouring triangles sometimes end up subdivided differently along a shared
// edge. The geometry is still closed, but slicers report the T-junctions as open edges.
// Here we insert the existing vertices that lie on an open edge into the triangles that
// own that edge, which makes both sides match without moving any vertex.

import * as THREE from 'three';

const SNAP = 1e4; // weld tolerance 1e-4 mm

function weld(geometry) {
  const pos = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;
  const n = index ? index.length : pos.length / 3;
  const map = new Map();
  const verts = [];
  const tris = [];
  const vid = (i) => {
    const o = (index ? index[i] : i) * 3;
    const x = pos[o], y = pos[o + 1], z = pos[o + 2];
    const key = `${Math.round(x * SNAP)},${Math.round(y * SNAP)},${Math.round(z * SNAP)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      verts.push(x, y, z);
      map.set(key, id);
    }
    return id;
  };
  for (let i = 0; i + 2 < n; i += 3) {
    const a = vid(i), b = vid(i + 1), c = vid(i + 2);
    if (a === b || b === c || a === c) continue;
    tris.push(a, b, c);
  }
  return { verts, tris };
}

function edgeKey(u, v) {
  return u < v ? u * 4294967296 + v : v * 4294967296 + u;
}

/** Directed-edge balance; returns Map(edgeKey -> count) for edges that do not cancel. */
function openEdges(tris) {
  const edges = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(u, v);
      edges.set(k, (edges.get(k) || 0) + (u < v ? 1 : -1));
    }
  }
  for (const [k, v] of edges) if (v === 0) edges.delete(k);
  return edges;
}

/** Points (vertex ids from `cands`) lying strictly inside segment ab, sorted by parameter. */
function pointsOnSegment(verts, a, b, cands, eps) {
  const ax = verts[3 * a], ay = verts[3 * a + 1], az = verts[3 * a + 2];
  const dx = verts[3 * b] - ax, dy = verts[3 * b + 1] - ay, dz = verts[3 * b + 2] - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-16) return [];
  const out = [];
  for (const v of cands) {
    if (v === a || v === b) continue;
    const px = verts[3 * v] - ax, py = verts[3 * v + 1] - ay, pz = verts[3 * v + 2] - az;
    const t = (px * dx + py * dy + pz * dz) / len2;
    if (t <= 1e-6 || t >= 1 - 1e-6) continue;
    const qx = px - t * dx, qy = py - t * dy, qz = pz - t * dz;
    if (qx * qx + qy * qy + qz * qz <= eps * eps) out.push({ v, t });
  }
  out.sort((p, q) => p.t - q.t);
  return out.map((p) => p.v);
}

/** Recursively split triangle (a,b,c) at the points lying on its edges. */
function splitTriangle(a, b, c, onAB, onBC, onCA, out) {
  if (onAB.length) {
    const p = onAB[0];
    // (a,p,c) gets onAB[1..] ? no: points after p lie on (p,b). (p,b,c) gets them.
    splitTriangle(a, p, c, [], [], onCA, out);
    splitTriangle(p, b, c, onAB.slice(1), onBC, [], out);
  } else if (onBC.length) {
    const p = onBC[0];
    splitTriangle(a, b, p, [], [], [], out);
    splitTriangle(a, p, c, [], onBC.slice(1), onCA, out);
  } else if (onCA.length) {
    const p = onCA[0];
    splitTriangle(a, b, p, [], [], onCA.slice(1), out);
    splitTriangle(p, b, c, [], [], [], out);
  } else {
    out.push(a, b, c);
  }
}

/**
 * Weld + T-junction repair. Returns { geometry, openBefore, openAfter }.
 * The returned geometry is indexed (position only); normals are not recomputed here.
 */
export function repairMesh(geometry, { eps = 2e-3, maxPasses = 3 } = {}) {
  let { verts, tris } = weld(geometry);
  let open = openEdges(tris);
  const openBefore = open.size;
  let pass = 0;
  while (open.size > 0 && pass < maxPasses) {
    pass++;
    // candidate T-vertices: endpoints of open edges
    const candSet = new Set();
    for (const k of open.keys()) {
      candSet.add(Math.floor(k / 4294967296));
      candSet.add(k % 4294967296);
    }
    const cands = Array.from(candSet);
    const out = [];
    let changed = false;
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      const onAB = open.has(edgeKey(a, b)) ? pointsOnSegment(verts, a, b, cands, eps) : [];
      const onBC = open.has(edgeKey(b, c)) ? pointsOnSegment(verts, b, c, cands, eps) : [];
      const onCA = open.has(edgeKey(c, a)) ? pointsOnSegment(verts, c, a, cands, eps) : [];
      if (onAB.length || onBC.length || onCA.length) {
        changed = true;
        splitTriangle(a, b, c, onAB, onBC, onCA, out);
      } else {
        out.push(a, b, c);
      }
    }
    tris = out;
    open = openEdges(tris);
    if (!changed) break;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(verts), 3));
  const vertexCount = verts.length / 3;
  g.setIndex(vertexCount > 65535 ? new THREE.Uint32BufferAttribute(Uint32Array.from(tris), 1) : new THREE.Uint16BufferAttribute(Uint16Array.from(tris), 1));
  return { geometry: g, openBefore, openAfter: open.size };
}
