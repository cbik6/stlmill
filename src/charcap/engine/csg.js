// Boolean backend for the Character Cap engine: manifold-3d (WASM).
//
// Decision (see bench-boolean.js, run on Clark's real prints, Node 24, 2026-10):
//                                   manifold-3d                 three-bvh-csg (CDT clipping)
//   pumpkin 13.9k tris
//     boss union + socket subtract   27 ms, 0 open edges         149 ms, 48 open edges
//     hollow + boss + socket         32 ms, 0                     149 ms, 188
//     face prism intersect           13 ms, 0                     149 ms, 216
//     face skin (shifted self-cut)   263 ms, 0                    3184 ms, 3141
//   ghost 24.9k tris
//     boss union + socket subtract   28 ms, 0                     127 ms, 167
//     hollow + boss + socket         40 ms, 0                     162 ms, 21
//     face prism intersect           16 ms, 0                     87 ms, 0
//     face skin (shifted self-cut)   151 ms, 0                    485 ms, 3215
// three-bvh-csg leaves T-junctions / open edges on every organic cut (its splitter only
// re-triangulates intersected triangles) and the clicker's repair.js cannot close thousands of
// them; manifold-3d is guaranteed-manifold by construction and 5-10x faster. The clicker engine
// keeps three-bvh-csg for its few flat extrusions; this tool uses manifold only.
//
// Loading the WASM:
//   Node (selftest):  `await initBooleans()` - Emscripten resolves manifold.wasm next to manifold.js
//                     through `new URL('manifold.wasm', import.meta.url)` and reads it with fs.
//   Vite (browser):   import the asset URL and hand it over, e.g.
//                       import wasmUrl from 'manifold-3d/manifold.wasm?url';
//                       await initBooleans({ wasmUrl });
//                     (`src/charcap/engine/manifold-vite.js` does exactly this; import it from UI
//                     code only, never from Node code - the `?url` suffix is Vite-only.)
//                     With an explicit wasmUrl no optimizeDeps / assetsInclude tweak is needed.
//
// Everything is lazy: `init` resolves once, then all helpers are synchronous.

import * as THREE from 'three';
import Module from 'manifold-3d';

let wasm = null; // ManifoldToplevel
let initPromise = null;

/** Initialise the WASM module once. Returns the manifold toplevel (Manifold, CrossSection, Mesh ...). */
export function initBooleans({ wasmUrl } = {}) {
  if (wasm) return Promise.resolve(wasm);
  if (!initPromise) {
    const opts = wasmUrl ? { locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path) } : {};
    initPromise = Module(opts).then((m) => {
      m.setup();
      wasm = m;
      return m;
    });
  }
  return initPromise;
}

export function manifoldApi() {
  if (!wasm) throw new Error('Booleans not initialised: await initBooleans() first');
  return wasm;
}

/**
 * THREE.BufferGeometry -> Manifold. Vertices are welded by Mesh.merge(); the result must be
 * watertight (status NoError) or an Error with the manifold status is thrown.
 * `selfUnion` resolves overlapping shells (several sculpted blobs exported as one object) into a
 * single solid so later ray tests and booleans see one consistent inside.
 */
export function toManifold(geometry, { selfUnion = true } = {}) {
  const { Manifold, Mesh } = manifoldApi();
  const pos = geometry.attributes.position.array;
  const idx = geometry.index ? geometry.index.array : null;
  const n = idx ? idx.length : pos.length / 3;
  const triVerts = new Uint32Array(n);
  for (let i = 0; i < n; i++) triVerts[i] = idx ? idx[i] : i;
  const mesh = new Mesh({ numProp: 3, vertProperties: pos instanceof Float32Array ? pos.slice() : Float32Array.from(pos), triVerts });
  mesh.merge();
  let m = new Manifold(mesh);
  const status = m.status();
  if (status !== 'NoError') {
    m.delete();
    throw new Error(`Mesh is not a closed solid (manifold status: ${status}). Repair it in your slicer (Bambu/Orca "Fix model", PrusaSlicer "Netfabb") and re-export.`);
  }
  if (selfUnion) {
    const shells = m.decompose();
    if (shells.length > 1) {
      const u = Manifold.union(shells);
      for (const s of shells) s.delete();
      m.delete();
      m = u;
    }
  }
  return m;
}

/** Manifold -> indexed, position-only THREE.BufferGeometry (normals + bounds computed). */
export function fromManifold(m) {
  const mesh = m.getMesh();
  const g = new THREE.BufferGeometry();
  const verts = mesh.vertProperties;
  if (mesh.numProp === 3) {
    g.setAttribute('position', new THREE.BufferAttribute(verts.slice(), 3));
  } else {
    const nV = verts.length / mesh.numProp;
    const p = new Float32Array(nV * 3);
    for (let i = 0; i < nV; i++) {
      p[3 * i] = verts[i * mesh.numProp];
      p[3 * i + 1] = verts[i * mesh.numProp + 1];
      p[3 * i + 2] = verts[i * mesh.numProp + 2];
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  }
  g.setIndex(new THREE.BufferAttribute(mesh.triVerts.slice(), 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/** {x,y}[] polygons -> manifold Polygons ([[x,y],...][]). */
export function toPolygons(polys) {
  return polys.map((poly) => poly.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y])));
}

/** THREE.Shape[] (polyline or curved) -> CrossSection (even-odd fill: holes and islands work). */
export function shapesToCrossSection(shapes, curveSegments = 12) {
  const { CrossSection } = manifoldApi();
  const polys = [];
  for (const s of shapes) {
    const pts = s.extractPoints(curveSegments);
    if (pts.shape.length >= 3) polys.push(pts.shape.map((p) => [p.x, p.y]));
    for (const h of pts.holes) if (h.length >= 3) polys.push(h.map((p) => [p.x, p.y]));
  }
  if (!polys.length) return new CrossSection([]);
  return new CrossSection(polys, 'EvenOdd');
}

/** Right prism of a CCW polygon ({x,y}[]) from z0 to z1. */
export function prism(polygon, z0, z1) {
  const { Manifold } = manifoldApi();
  return Manifold.extrude(toPolygons([polygon]), z1 - z0).translate(0, 0, z0);
}

/** Z-axis cylinder (radius r) from z0 to z1. */
export function cylinder(r, z0, z1, segments = 64) {
  const { Manifold } = manifoldApi();
  return Manifold.cylinder(z1 - z0, r, r, segments).translate(0, 0, z0);
}

/**
 * Loft between two CCW polygons with the same vertex count: `bottom` at z0, `top` at z1.
 * Built as a closed triangle shell, then converted (manifold validates it).
 */
export function loft(bottom, top, z0, z1) {
  if (bottom.length !== top.length) throw new Error('loft: polygons must have the same vertex count');
  const pos = [];
  const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const n = bottom.length;
  const B = bottom.map((p) => [p.x, p.y, z0]);
  const T = top.map((p) => [p.x, p.y, z1]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(B[i], B[j], T[j]);
    tri(B[i], T[j], T[i]);
  }
  const fan = (ring, up) => {
    const c2 = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [a, b, c] of c2) {
      const A = ring[a], Bb = ring[b], C = ring[c];
      const area = (Bb[0] - A[0]) * (C[1] - A[1]) - (Bb[1] - A[1]) * (C[0] - A[0]);
      if (area === 0) continue;
      if ((area > 0) === up) tri(A, Bb, C);
      else tri(A, C, Bb);
    }
  };
  fan(B, false);
  fan(T, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(pos), 3));
  return toManifold(g, { selfUnion: false });
}

/** Dispose a list of manifolds / cross-sections, ignoring nulls. */
export function dispose(...objs) {
  for (const o of objs) if (o && typeof o.delete === 'function') o.delete();
}
