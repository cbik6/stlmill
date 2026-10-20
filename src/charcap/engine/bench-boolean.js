// Boolean backend benchmark: manifold-3d vs three-bvh-csg on Clark's real sculpted meshes.
//   node src/charcap/engine/bench-boolean.js [path/to/object.model ...]
// Not part of the engine; kept as evidence for the backend decision documented in csg.js.

import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, INTERSECTION, ADDITION } from 'three-bvh-csg';
import Module from 'manifold-3d';
import { parseBambuModel } from './loaders.js';
import { openEdgeCount } from './meshcheck.js';

const SCRATCH = 'C:/Users/clark/AppData/Local/Temp/claude/C--Users-clark-Claude-Projects-3D-Modeling-Apps/affad541-57e5-4c13-9eda-5f777e9441a1/scratchpad/pumpkin/x/3D/Objects/';
const args = process.argv.slice(2);
// The reference prints belong to someone else: they are read from the scratchpad only, never copied
// into the repo, and skipped when absent.
const files = (args.length ? args : [SCRATCH + 'object_159.model', SCRATCH + 'object_93.model']).filter((f) => {
  if (existsSync(f)) return true;
  console.log(`(skipping ${f}: not found)`);
  return false;
});
if (!files.length) console.log('No reference meshes available; pass a Bambu object .model path as an argument.');

const wasm = await Module();
wasm.setup();
const { Manifold, Mesh } = wasm;

function geomToManifold(g) {
  const pos = g.attributes.position.array;
  const idx = g.index ? g.index.array : null;
  const n = idx ? idx.length : pos.length / 3;
  const triVerts = new Uint32Array(n);
  for (let i = 0; i < n; i++) triVerts[i] = idx ? idx[i] : i;
  const mesh = new Mesh({ numProp: 3, vertProperties: Float32Array.from(pos), triVerts });
  mesh.merge();
  return new Manifold(mesh);
}
function manifoldToGeom(m) {
  const mesh = m.getMesh();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.vertProperties.slice(), 3));
  g.setIndex(new THREE.BufferAttribute(mesh.triVerts.slice(), 1));
  return g;
}
const W = 2.0, T = 0.65;
const crossPts = [[-W, -T], [-T, -T], [-T, -W], [T, -W], [T, -T], [W, -T], [W, T], [T, T], [T, W], [-T, W], [-T, T], [-W, T]];

const evaluator = new Evaluator();
evaluator.attributes = ['position'];
evaluator.useGroups = false;
evaluator.useCDTClipping = true;
function csg(a, b, op) {
  const A = new Brush(a); A.updateMatrixWorld(true);
  const B = new Brush(b); B.updateMatrixWorld(true);
  const r = evaluator.evaluate(A, B, op).geometry;
  r.clearGroups();
  return r;
}
function strip(g) { g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g; }
function crossGeom(z0, z1) {
  const s = new THREE.Shape(crossPts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false });
  g.translate(0, 0, z0);
  return strip(g);
}
function cylGeom(r, z0, z1, n = 64) {
  const g = new THREE.CylinderGeometry(r, r, z1 - z0, n, 1);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  return strip(g);
}
const time = (fn) => { const t = performance.now(); const r = fn(); return [r, performance.now() - t]; };
const ms = (t) => `${t.toFixed(0)} ms`;

for (const f of files) {
  const { geometry, name } = parseBambuModel(readFileSync(f, 'utf8'), f.split('/').pop());
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  geometry.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  geometry.computeBoundingBox();
  const h = geometry.boundingBox.max.z;
  const tris = geometry.index.count / 3;
  console.log(`\n=== ${name}: ${tris} tris, open edges in: ${openEdgeCount(geometry)}, size ${(bb.max.x - bb.min.x).toFixed(1)} x ${(bb.max.y - bb.min.y).toFixed(1)} x ${h.toFixed(1)} mm`);

  // --- manifold-3d
  {
    const [m, tIn] = time(() => { const mm = geomToManifold(geometry); mm.status(); return mm; });
    console.log(`  [manifold] ofMesh+status ${ms(tIn)}, status=${m.status()}, genus=${m.genus()}, volume=${m.volume().toFixed(0)} mm^3`);
    const socket = Manifold.extrude(crossPts, 5).translate(0, 0, -1);
    const boss = Manifold.cylinder(6, 3.5, 3.5, 64).translate(0, 0, -1);
    const hollow = Manifold.cylinder(7, 12, 12, 64).translate(0, 0, -1); // crude hollowing stand-in
    const prism = Manifold.cube([14, 80, 14], true).translate(0, 0, h * 0.55);
    const [r1, t1] = time(() => { const r = m.add(boss).subtract(socket); r.numTri(); return r; });
    console.log(`  [manifold] boss union + socket subtract: ${ms(t1)} -> ${r1.numTri()} tris, status=${r1.status()}`);
    const [r2, t2] = time(() => { const r = m.subtract(hollow).add(boss).subtract(socket); r.numTri(); return r; });
    console.log(`  [manifold] hollow subtract + boss + socket: ${ms(t2)} -> ${r2.numTri()} tris`);
    const [r3, t3] = time(() => { const r = m.intersect(prism); r.numTri(); return r; });
    console.log(`  [manifold] face prism intersect: ${ms(t3)} -> ${r3.numTri()} tris`);
    const [r4, t4] = time(() => { const r = m.subtract(m.translate(0, 0.8, 0)).intersect(prism); r.numTri(); return r; });
    console.log(`  [manifold] face skin (self-shifted subtract + intersect): ${ms(t4)} -> ${r4.numTri()} tris`);
    const [g1, tOut] = time(() => manifoldToGeom(r1));
    console.log(`  [manifold] getMesh ${ms(tOut)}; open edges: boss/socket ${openEdgeCount(g1)}, hollow ${openEdgeCount(manifoldToGeom(r2))}, prism ${openEdgeCount(manifoldToGeom(r3))}, skin ${openEdgeCount(manifoldToGeom(r4))}`);
  }
  // --- three-bvh-csg
  {
    const geo = geometry.toNonIndexed();
    const socket = crossGeom(-1, 4);
    const boss = cylGeom(3.5, -1, 5);
    const hollow = cylGeom(7, -1, 11);
    const prism = strip(new THREE.BoxGeometry(14, 80, 14)); prism.translate(0, 0, h * 0.55);
    const run = (label, fn) => {
      try {
        const [r, t] = time(fn);
        console.log(`  [bvh-csg]  ${label}: ${ms(t)} -> ${r.attributes.position.count / 3} tris, open edges ${openEdgeCount(r)}`);
      } catch (e) {
        console.log(`  [bvh-csg]  ${label}: FAILED (${e.message})`);
      }
    };
    run('boss union + socket subtract', () => csg(csg(geo, boss, ADDITION), socket, SUBTRACTION));
    run('hollow subtract + boss + socket', () => csg(csg(csg(geo, hollow, SUBTRACTION), boss, ADDITION), socket, SUBTRACTION));
    run('face prism intersect', () => csg(geo, prism, INTERSECTION));
    run('face skin (self-shifted subtract + intersect)', () => { const s = geo.clone(); s.translate(0, 0.8, 0); return csg(csg(geo, s, SUBTRACTION), prism, INTERSECTION); });
  }
}
