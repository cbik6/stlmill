// Node self-test for the clicker engine (no DOM/canvas needed).
//   node src/clicker/engine/selftest.js
// Builds the default clicker with a synthetic design (rounded rectangle with a hole + a
// separate disc), prints part names / triangle counts / bounds / warnings, exercises
// every base style, engraved mode and the keychain ring, then validates the 3MF.

import * as THREE from 'three';
import JSZip from 'jszip';
import {
  DEFAULT_PARAMS,
  buildClicker,
  buildReferenceSwitch,
  exportThreeMF,
  exportStlZip,
  makeDesignFromShapes,
  traceBitmap,
} from './index.js';
import { rasterizeShapes } from './raster.js';

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  FAIL:', msg);
  }
};

function syntheticDesign() {
  // rounded rectangle 100 x 60 with a 30 x 20 hole (like a letter "O"), plus a disc beside it
  const s = new THREE.Shape();
  const r = 12;
  s.moveTo(-50 + r, -30);
  s.lineTo(50 - r, -30);
  s.absarc(50 - r, -30 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(50, 30 - r);
  s.absarc(50 - r, 30 - r, r, 0, Math.PI / 2, false);
  s.lineTo(-50 + r, 30);
  s.absarc(-50 + r, 30 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-50, -30 + r);
  s.absarc(-50 + r, -30 + r, r, Math.PI, 1.5 * Math.PI, false);
  const hole = new THREE.Path();
  hole.moveTo(-15, -10);
  hole.lineTo(-15, 10);
  hole.lineTo(15, 10);
  hole.lineTo(15, -10);
  hole.closePath();
  s.holes.push(hole);
  const disc = new THREE.Shape();
  disc.absarc(80, 0, 22, 0, Math.PI * 2, false);
  return makeDesignFromShapes([s, disc], 24);
}

function tracedDesign() {
  // run the synthetic shapes through the raster->trace pipeline too
  const spec = syntheticDesign();
  const W = 512, H = 256;
  const k = 450 / 160;
  const px = spec.shapes.map((sh) => {
    const pts = sh.extractPoints(1);
    const f = (p) => new THREE.Vector2((p.x + 60) * k + 20, (p.y + 35) * k + 20);
    const out = new THREE.Shape(pts.shape.map(f));
    for (const h of pts.holes) out.holes.push(new THREE.Path(h.map(f)));
    return out;
  });
  const mask = rasterizeShapes(px, W, H);
  const shapes = traceBitmap(mask, W, H);
  return makeDesignFromShapes(shapes, 1);
}

/** Count edges not shared by exactly two triangles (after snapping vertices to 1e-4 mm). */
function openEdgeCount(geometry) {
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
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      edges.set(key, (edges.get(key) || 0) + (u < v ? 1 : -1));
    }
  }
  let open = 0;
  for (const v of edges.values()) if (v !== 0) open++;
  return open;
}

/**
 * Vertical ray-cast from below at (x, y): returns the lowest z of any triangle hit, or null.
 * Used to prove the body has a closed floor under the switch.
 */
function hitFromBelow(geometry, x, y) {
  const pos = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;
  const n = index ? index.length : pos.length / 3;
  let best = null;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = (index ? index[i] : i) * 3, b = (index ? index[i + 1] : i + 1) * 3, c = (index ? index[i + 2] : i + 2) * 3;
    const ax = pos[a] - x, ay = pos[a + 1] - y;
    const bx = pos[b] - x, by = pos[b + 1] - y;
    const cx = pos[c] - x, cy = pos[c + 1] - y;
    const d1 = ax * by - ay * bx, d2 = bx * cy - by * cx, d3 = cx * ay - cy * ax;
    const neg = d1 < 0 || d2 < 0 || d3 < 0, posi = d1 > 0 || d2 > 0 || d3 > 0;
    if (neg && posi) continue; // outside in XY
    const area = d1 + d2 + d3;
    if (Math.abs(area) < 1e-12) continue;
    const z = (pos[a + 2] * d2 + pos[b + 2] * d3 + pos[c + 2] * d1) / area;
    if (best === null || z < best) best = z;
  }
  return best;
}

function report(label, result) {
  console.log(`\n== ${label}`);
  for (const p of result.parts) {
    const tris = result.assembly.triangles[p.name];
    const e = p.geometry.boundingBox;
    console.log(
      `  ${p.name.padEnd(6)} ${String(tris).padStart(7)} tris  color ${p.color}  bbox x[${e.min.x.toFixed(2)}, ${e.max.x.toFixed(2)}] y[${e.min.y.toFixed(2)}, ${e.max.y.toFixed(2)}] z[${e.min.z.toFixed(2)}, ${e.max.z.toFixed(2)}]`,
    );
    check(tris > 0, `${p.name} has triangles`);
    check(tris < 200000, `${p.name} under 200k triangles`);
    const arr = p.geometry.attributes.position.array;
    let nan = false;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) nan = true;
    check(!nan, `${p.name} has no NaN`);
    const n = p.geometry.attributes.normal;
    check(n && n.count === p.geometry.attributes.position.count, `${p.name} has normals`);
    const open = openEdgeCount(p.geometry);
    check(open === 0, `${p.name} is watertight (${open} open edges)`);
  }
  console.log(`  bounds  x ${result.bounds.x.toFixed(2)}  y ${result.bounds.y.toFixed(2)}  z ${result.bounds.z.toFixed(2)}`);
  console.log(`  assembly`, JSON.stringify({ ...result.assembly, triangles: undefined, capBounds: undefined }));
  console.log(`  warnings (${result.warnings.length})`, result.warnings);
  return result;
}

async function validate3MF(result, label) {
  const blob = await exportThreeMF(result.parts, { name: label });
  check(blob.type === 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', '3MF mime type');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files);
  for (const req of ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']) check(names.includes(req), `3MF contains ${req}`);
  const xml = await zip.file('3D/3dmodel.model').async('string');
  const objects = [...xml.matchAll(/<object id="(\d+)" name="([^"]+)"[^>]*pid="1" pindex="(\d+)">([\s\S]*?)<\/object>/g)];
  check(objects.length === result.parts.length, `3MF has ${result.parts.length} objects (got ${objects.length})`);
  for (const m of objects) {
    const triCount = (m[4].match(/<triangle /g) || []).length;
    const vertCount = (m[4].match(/<vertex /g) || []).length;
    check(triCount > 0, `object ${m[2]} has triangles`);
    const maxIdx = Math.max(...[...m[4].matchAll(/v[123]="(\d+)"/g)].map((x) => Number(x[1])));
    check(maxIdx < vertCount, `object ${m[2]} triangle indices in range`);
    console.log(`  3MF object ${m[2]}: ${vertCount} vertices, ${triCount} triangles`);
  }
  const bases = (xml.match(/<base /g) || []).length;
  check(bases === result.parts.length, '3MF basematerials count');
  check(/<metadata name="Title">/.test(xml), '3MF has Title metadata');
  check((xml.match(/<item objectid=/g) || []).length === result.parts.length, '3MF build items');
  console.log(`  3MF size ${blob.size} bytes`);

  const stl = await exportStlZip(result.parts, { name: label });
  const z2 = await JSZip.loadAsync(await stl.arrayBuffer());
  const stlNames = Object.keys(z2.files);
  check(stlNames.length === result.parts.length, 'STL zip has one file per part');
  for (const n of stlNames) {
    const buf = await z2.file(n).async('arraybuffer');
    const count = new DataView(buf).getUint32(80, true);
    check(buf.byteLength === 84 + count * 50, `STL ${n} size matches header (${count} tris)`);
  }
}

const t0 = Date.now();
const spec = syntheticDesign();
console.log('synthetic design bbox', spec.bbox);

// 1. defaults + synthetic design, raised
const base = report('outline / raised (defaults)', await buildClicker({ design: { spec } }));
check(base.parts.map((p) => p.name).join(',') === 'body,cap,design', 'parts are body,cap,design');
check(Math.abs(base.bounds.x - 35) < 0.3, `body long side ~35 mm (got ${base.bounds.x.toFixed(2)})`);
check(Math.abs(base.bounds.z - DEFAULT_PARAMS.body.height) < 1e-6, 'body height');
check(base.parts[1].geometry.boundingBox.min.z < -3.5, 'cap stem hangs below z=0');
check(Math.abs(base.parts[1].geometry.boundingBox.max.z - 3) < 1e-6, 'cap top at z=thickness');
check(base.parts[2].geometry.boundingBox.min.z >= 3 - 1e-6, 'design sits on cap top');
check(base.warnings.length === 0, 'no warnings with defaults');
// closed floor: a ray from below at the centre (and around the cavity footprint) must hit z = 0
const bodyG = base.parts[0].geometry;
check(Math.abs(bodyG.boundingBox.min.z) < 1e-6, 'body rests on z = 0');
for (const [x, y] of [[0, 0], [3, 3], [-6, 2], [5, -6], [-7, -7]]) {
  const z = hitFromBelow(bodyG, x, y);
  check(z !== null && Math.abs(z) < 1e-6, `floor is closed at (${x}, ${y}) (lowest hit z = ${z})`);
}
const asm = base.assembly;
check(Math.abs(asm.floorThickness - 1.5) < 1e-6, `floor thickness 1.5 (got ${asm.floorThickness})`);
check(Math.abs(asm.cavityDepth - 8.5) < 1e-6, 'cavity depth 8.5');
check(Math.abs(asm.plateTopZ - (DEFAULT_PARAMS.body.height - DEFAULT_PARAMS.body.rimHeight)) < 1e-6, 'plate top z');
check(Math.abs(asm.capZ - (asm.plateTopZ + 6.6)) < 1e-6, 'capZ = plateTopZ + 6.6');
check(Math.abs(asm.capZ - (DEFAULT_PARAMS.body.height - 0.4)) < 1e-6, 'cap underside seats 0.4 mm below the rim');
// cavity present: the lowest hit just inside the cavity wall, looking up from inside, is the cavity ceiling
{
  const half = (DEFAULT_PARAMS.switch.cavity + 2 * DEFAULT_PARAMS.fit.switchTolerance) / 2;
  const hasCavityWall = (() => {
    const pos = bodyG.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      if (Math.abs(Math.abs(pos[i]) - half) < 1e-3 && Math.abs(pos[i + 2] - asm.cavityBottomZ) < 1e-3) return true;
    }
    return false;
  })();
  check(hasCavityWall, `cavity wall vertices at x = +-${half} on the cavity floor (z = ${asm.cavityBottomZ})`);
  // plate cutout is the nominal 14.0 (no tolerance)
  const pos = bodyG.attributes.position.array;
  let cutoutHit = false;
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(Math.abs(pos[i]) - 7.0) < 1e-3 && Math.abs(pos[i + 2] - asm.plateTopZ) < 1e-3) cutoutHit = true;
  }
  check(cutoutHit, 'plate cutout edges at x = +-7.0 on the plate top');
}
await validate3MF(base, 'selftest');

// 2. traced (raster pipeline) design, engraved, keychain
const traced = tracedDesign();
console.log('\ntraced design: shapes', traced.shapes.length, 'holes', traced.shapes.map((s) => s.holes.length));
check(traced.shapes.length === 2, 'trace found 2 islands');
check(traced.shapes.some((s) => s.holes.length === 1), 'trace found the hole');
const engraved = report(
  'outline / engraved / keychain',
  await buildClicker({ design: { spec: traced }, cap: { designMode: 'engraved' }, keychain: { enabled: true, angle: 45 } }),
);
check(engraved.parts.length === 2, 'engraved has no separate design part');
check(engraved.bounds.y > base.bounds.y + 3, `keychain ring extends bounds (${base.bounds.y.toFixed(2)} -> ${engraved.bounds.y.toFixed(2)})`);
check(engraved.parts[1].geometry.boundingBox.max.z === 3, 'engraved cap keeps its top at thickness');

// 3. presets
for (const style of ['circle', 'square', 'hexagon']) {
  const r = report(`${style} / raised`, await buildClicker({ design: { spec }, base: { style } }));
  check(Math.abs(Math.max(r.bounds.x, r.bounds.y) - 35) < 0.05, `${style} long side 35`);
  check(r.parts.length === 3, `${style} has design part`);
}

// 4. no design at all
const plain = report('no design', await buildClicker({ design: { spec: null } }));
check(plain.parts.length === 2, 'no design -> body + cap');

// 5. too-short body -> warning, and reference switch
const short = report('short body', await buildClicker({ design: { spec }, body: { height: 6, rimHeight: 2 } }));
check(short.warnings.some((w) => /too short/.test(w)), 'short body warning');
check(short.assembly.floorThickness >= 1.5 - 1e-6, 'short body keeps a 1.5 mm floor');
check(hitFromBelow(short.parts[0].geometry, 0, 0) !== null, 'short body floor is closed');

// shallow cavity requested -> warning, floor intact
const shallow = report('shallow cavity', await buildClicker({ design: { spec }, switch: { cavityDepth: 4 } }));
check(shallow.warnings.some((w) => /cavity is only/.test(w)), 'shallow cavity warning');
check(Math.abs(shallow.assembly.floorThickness - (DEFAULT_PARAMS.body.height - 7 - 1.5 - 4)) < 1e-6, 'shallow cavity leaves a thicker floor');

const sw = buildReferenceSwitch();
sw.computeBoundingBox();
const plateTop = DEFAULT_PARAMS.body.height - DEFAULT_PARAMS.body.rimHeight;
console.log('\nreference switch tris', sw.index ? sw.index.count / 3 : sw.attributes.position.count / 3, 'z', sw.boundingBox.min.z.toFixed(2), '..', sw.boundingBox.max.z.toFixed(2));
check(Math.abs(sw.boundingBox.max.z - (plateTop + 6.6 + DEFAULT_PARAMS.switch.stemHeight)) < 1e-3, 'switch stem top z = plateTop + 6.6 + stemHeight');
check(Math.abs(sw.boundingBox.min.z - (plateTop - 1.5 - 5.0 - 3.3)) < 1e-3, 'switch pins bottom z = plateBottom - 8.3');
check(sw.boundingBox.min.z > base.assembly.cavityBottomZ - 1e-6, 'switch pins stay above the cavity floor');
check(Math.abs(sw.boundingBox.max.x - 7.8) < 1e-3, 'switch flange is 15.6 wide');

console.log(`\n${failures === 0 ? 'SELFTEST PASSED' : `SELFTEST FAILED (${failures})`} in ${Date.now() - t0} ms`);
process.exit(failures === 0 ? 0 : 1);
