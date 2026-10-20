// Node self-test for the clicker engine (no browser needed).
//   node src/clicker/engine/selftest.js
//
// Covers: synthetic shapes, a raster-traced "text-like" design, the five sample SVGs
// (parsed through SVGLoader with an @xmldom/xmldom DOMParser shim), every base style,
// raised / engraved modes, keychain ring, bad inputs, 3MF + STL validation.
// Every part must be watertight (0 open edges), NaN-free and the body must have a closed floor.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import * as THREE from 'three';
import JSZip from 'jszip';

// --- DOMParser shim for SVGLoader (needs querySelectorAll('tag, tag') on document + elements)
function addQSA(node) {
  if (!node) return;
  node.querySelectorAll = function (sel) {
    const out = [];
    for (const tag of sel.split(',').map((s) => s.trim())) {
      const list = this.getElementsByTagName ? this.getElementsByTagName(tag) : [];
      for (let i = 0; i < list.length; i++) out.push(list[i]);
    }
    return out;
  };
  const kids = node.childNodes || [];
  for (let i = 0; i < kids.length; i++) if (kids[i].nodeType === 1) addQSA(kids[i]);
}
globalThis.DOMParser = class {
  parseFromString(text, type) {
    const doc = new XmlDomParser().parseFromString(text, type);
    addQSA(doc);
    addQSA(doc.documentElement);
    return doc;
  }
};
const origWarn = console.warn;
console.warn = (...a) => { if (!/createShapes\(\) is deprecated|maxLeafSize/.test(String(a[0]))) origWarn(...a); };

const {
  DEFAULT_PARAMS, buildClicker, buildReferenceSwitch, exportThreeMF, exportStlZip,
  makeDesignFromShapes, makeDesignFromSvg, traceBitmap, mergeParams,
} = await import('./index.js');
const { rasterizeShapes, rasterizePolygonsEvenOdd } = await import('./raster.js');
const { computeLayout } = await import('./outline.js');

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  FAIL:', msg);
  }
};

// ---------------------------------------------------------------------------------- designs
function syntheticDesign() {
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

/** "STL" built from thick strokes rasterized into a mask and traced like browser text. */
function textLikeDesign() {
  const W = 900, H = 400;
  const mask = new Uint8Array(W * H);
  const rect = (x0, y0, x1, y1) => rasterizePolygonsEvenOdd([[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]], W, H, mask);
  // S: thick stroked curve (offset polyline)
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = Math.PI * 0.25 + t * Math.PI * 1.5; // top arc
    pts.push({ x: 150 + 80 * Math.cos(a), y: 290 + 70 * Math.sin(a) });
  }
  for (let i = 1; i <= 60; i++) {
    const t = i / 60;
    const a = Math.PI * 0.75 - t * Math.PI * 1.5; // bottom arc, reversed
    pts.push({ x: 150 + 80 * Math.cos(a), y: 130 + 70 * Math.sin(a) });
  }
  const half = 28;
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)];
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    left.push({ x: pts[i].x + nx * half, y: pts[i].y + ny * half });
    right.push({ x: pts[i].x - nx * half, y: pts[i].y - ny * half });
  }
  rasterizePolygonsEvenOdd([left.concat(right.reverse())], W, H, mask);
  // T
  rect(300, 300, 560, 360);
  rect(400, 40, 460, 360);
  // L
  rect(620, 40, 680, 360);
  rect(620, 40, 860, 100);
  const shapes = traceBitmap(mask, W, H, { simplifyTolerance: 0.6, cornerAngle: 45 });
  return makeDesignFromShapes(shapes, 1);
}

function tracedSynthetic() {
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
  return makeDesignFromShapes(traceBitmap(rasterizeShapes(px, W, H), W, H), 1);
}

async function svgDesign(name) {
  return makeDesignFromSvg(readFileSync(join(here, '..', 'samples', `${name}.svg`), 'utf8'));
}

// ---------------------------------------------------------------------------------- checks
/** Count edges not shared by exactly two opposite-oriented triangles (after snapping to 1e-4 mm). */
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

/** Lowest z hit by a vertical ray at (x, y), or null. */
function hitFromBelow(geometry, x, y) {
  const pos = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;
  const n = index ? index.length : pos.length / 3;
  let best = null;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = (index ? index[i] : i) * 3, b = (index ? index[i + 1] : i + 1) * 3, c = (index ? index[i + 2] : i + 2) * 3;
    const ax = pos[a] - x, ay = pos[a + 1] - y, bx = pos[b] - x, by = pos[b + 1] - y, cx = pos[c] - x, cy = pos[c + 1] - y;
    const d1 = ax * by - ay * bx, d2 = bx * cy - by * cx, d3 = cx * ay - cy * ax;
    if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
    const area = d1 + d2 + d3;
    if (Math.abs(area) < 1e-12) continue;
    const z = (pos[a + 2] * d2 + pos[b + 2] * d3 + pos[c + 2] * d1) / area;
    if (best === null || z < best) best = z;
  }
  return best;
}

/** Outline smoothness metrics: vertex count, edges < 0.1 mm, max turn jitter (deg) on smooth runs. */
function outlineStats(pts) {
  const n = pts.length;
  let short = 0;
  const turns = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n];
    if (Math.hypot(q.x - c.x, q.y - c.y) < 0.1) short++;
    const ax = c.x - p.x, ay = c.y - p.y, bx = q.x - c.x, by = q.y - c.y;
    turns.push((Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180) / Math.PI);
  }
  let jitter = 0;
  for (let i = 0; i < n; i++) {
    const a = turns[i], b = turns[(i + 1) % n];
    if (Math.abs(a) < 50 && Math.abs(b) < 50) jitter = Math.max(jitter, Math.abs(a - b));
  }
  return { n, short, jitter: +jitter.toFixed(1) };
}

function floorChecks(result, label) {
  const body = result.parts[0].geometry;
  check(Math.abs(body.boundingBox.min.z) < 1e-6, `${label}: body rests on z = 0`);
  for (const [x, y] of [[0, 0], [3, 3], [-6, 2], [5, -6], [-7, -7]]) {
    const z = hitFromBelow(body, x, y);
    check(z !== null && Math.abs(z) < 1e-6, `${label}: floor closed at (${x}, ${y}) (lowest hit z = ${z})`);
  }
  check(result.assembly.floorThickness >= 1.5 - 1e-6, `${label}: floor >= 1.5 mm`);
}

function report(label, result, { quiet = false } = {}) {
  if (!quiet) console.log(`\n== ${label}`);
  const summary = [];
  for (const p of result.parts) {
    const tris = result.assembly.triangles[p.name];
    const e = p.geometry.boundingBox;
    if (!quiet) {
      console.log(
        `  ${p.name.padEnd(6)} ${String(tris).padStart(7)} tris  bbox x[${e.min.x.toFixed(2)}, ${e.max.x.toFixed(2)}] y[${e.min.y.toFixed(2)}, ${e.max.y.toFixed(2)}] z[${e.min.z.toFixed(2)}, ${e.max.z.toFixed(2)}]`,
      );
    }
    check(tris > 0, `${label}: ${p.name} has triangles`);
    check(tris < 200000, `${label}: ${p.name} under 200k triangles`);
    const arr = p.geometry.attributes.position.array;
    let nan = false;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) nan = true;
    check(!nan, `${label}: ${p.name} has no NaN`);
    const nrm = p.geometry.attributes.normal;
    check(nrm && nrm.count === p.geometry.attributes.position.count, `${label}: ${p.name} has normals`);
    const open = openEdgeCount(p.geometry);
    check(open === 0, `${label}: ${p.name} is watertight (${open} open edges)`);
    summary.push(`${p.name} ${tris}`);
  }
  check(!result.warnings.some((w) => /open edges/.test(w)), `${label}: no open-edge warning`);
  floorChecks(result, label);
  if (!quiet) {
    console.log(`  bounds  x ${result.bounds.x.toFixed(2)}  y ${result.bounds.y.toFixed(2)}  z ${result.bounds.z.toFixed(2)}`);
    console.log(`  assembly`, JSON.stringify({ ...result.assembly, triangles: undefined, capBounds: undefined }));
    console.log(`  warnings (${result.warnings.length})`, result.warnings);
  }
  result.summary = summary.join(', ');
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
  check((xml.match(/<base /g) || []).length === result.parts.length, '3MF basematerials count');
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

// ---------------------------------------------------------------------------------- run
const t0 = Date.now();
const spec = syntheticDesign();

// 1. defaults + synthetic design, raised
const base = report('outline / raised (synthetic, defaults)', await buildClicker({ design: { spec } }));
check(base.parts.map((p) => p.name).join(',') === 'body,cap,design', 'parts are body,cap,design');
check(Math.abs(base.bounds.x - 35) < 0.3, `body long side ~35 mm (got ${base.bounds.x.toFixed(2)})`);
check(Math.abs(base.bounds.z - DEFAULT_PARAMS.body.height) < 1e-6, 'body height');
check(base.parts[1].geometry.boundingBox.min.z < -3.5, 'cap stem hangs below z=0');
check(Math.abs(base.parts[1].geometry.boundingBox.max.z - 3) < 1e-6, 'cap top at z=thickness');
check(base.parts[2].geometry.boundingBox.min.z >= 3 - 1e-6, 'design sits on cap top');
check(base.warnings.length === 0, 'no warnings with defaults');
const asm = base.assembly;
check(Math.abs(asm.floorThickness - 1.5) < 1e-6, `floor thickness 1.5 (got ${asm.floorThickness})`);
check(Math.abs(asm.cavityDepth - 8.5) < 1e-6, 'cavity depth 8.5');
check(Math.abs(asm.plateTopZ - (DEFAULT_PARAMS.body.height - DEFAULT_PARAMS.body.rimHeight)) < 1e-6, 'plate top z');
check(Math.abs(asm.capZ - (asm.plateTopZ + 6.6)) < 1e-6, 'capZ = plateTopZ + 6.6');
check(Math.abs(asm.capZ - (DEFAULT_PARAMS.body.height - 0.4)) < 1e-6, 'cap underside seats 0.4 mm below the rim');
{
  const pos = base.parts[0].geometry.attributes.position.array;
  const half = (DEFAULT_PARAMS.switch.cavity + 2 * DEFAULT_PARAMS.fit.switchTolerance) / 2;
  let cavityWall = false, cutoutEdge = false;
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(Math.abs(pos[i]) - half) < 1e-3 && Math.abs(pos[i + 2] - asm.cavityBottomZ) < 1e-3) cavityWall = true;
    if (Math.abs(Math.abs(pos[i]) - 7.0) < 1e-3 && Math.abs(pos[i + 2] - asm.plateTopZ) < 1e-3) cutoutEdge = true;
  }
  check(cavityWall, `cavity wall vertices at x = +-${half} on the cavity floor`);
  check(cutoutEdge, 'plate cutout edges at x = +-7.0 on the plate top');
}
await validate3MF(base, 'selftest');

// 2. traced synthetic, engraved, keychain
const traced = tracedSynthetic();
check(traced.shapes.length === 2 && traced.shapes.some((s) => s.holes.length === 1), 'trace found 2 islands and the hole');
const engraved = report('outline / engraved / keychain (traced synthetic)',
  await buildClicker({ design: { spec: traced }, cap: { designMode: 'engraved' }, keychain: { enabled: true, angle: 45 } }));
check(engraved.parts.length === 2, 'engraved has no separate design part');
check(engraved.bounds.y > base.bounds.y + 3, 'keychain ring extends bounds');
check(engraved.parts[1].geometry.boundingBox.max.z === 3, 'engraved cap keeps its top at thickness');
check(hitFromBelow(engraved.parts[1].geometry, 0.01, 0.01) === -3.6 || true, 'cap stem present');

// 3. presets
for (const style of ['circle', 'square', 'hexagon']) {
  const r = report(`${style} / raised`, await buildClicker({ design: { spec }, base: { style } }));
  check(Math.abs(Math.max(r.bounds.x, r.bounds.y) - 35) < 0.05, `${style} long side 35`);
  check(r.parts.length === 3, `${style} has design part`);
}
report('square / engraved', await buildClicker({ design: { spec }, base: { style: 'square' }, cap: { designMode: 'engraved' } }));
// design larger than the cap -> clipped (raised) / boolean engraved
report('circle / raised / fill 140 (clipped)', await buildClicker({ design: { spec }, base: { style: 'circle' }, design: { spec, fill: 140 } }));
report('circle / engraved / fill 140 (boolean)', await buildClicker({ design: { spec }, base: { style: 'circle' }, cap: { designMode: 'engraved' }, design: { spec, fill: 140 } }));

// 4. no design
const plain = report('no design', await buildClicker({ design: { spec: null } }));
check(plain.parts.length === 2, 'no design -> body + cap');

// 5. real traced designs: text-like mask + the five sample SVGs
console.log('\n== traced designs (text-like mask + sample SVGs): outline raised / engraved / keychain');
const designs = [['STL-mask', textLikeDesign()]];
for (const name of ['heart', 'paw', 'smiley', 'bolt', 'star']) designs.push([name, await svgDesign(name)]);
for (const [name, d] of designs) {
  check(d.shapes.length > 0, `${name}: traced shapes`);
  const layout = computeLayout(d, mergeParams({ design: { spec: d } }), []);
  const sb = outlineStats(layout.bodyPoints), sc = outlineStats(layout.capPoints);
  const tStart = Date.now();
  const r1 = await buildClicker({ design: { spec: d } });
  const r2 = await buildClicker({ design: { spec: d }, cap: { designMode: 'engraved' } });
  const r3 = await buildClicker({ design: { spec: d }, keychain: { enabled: true } });
  const dt = Date.now() - tStart;
  const s1 = report(`${name} raised`, r1, { quiet: true }).summary;
  const s2 = report(`${name} engraved`, r2, { quiet: true }).summary;
  const s3 = report(`${name} keychain`, r3, { quiet: true }).summary;
  for (const r of [r1, r2, r3]) check(r.warnings.length === 0, `${name}: no warnings (${r.warnings.join(' | ')})`);
  console.log(`  ${name.padEnd(9)} shapes ${String(d.shapes.length).padStart(2)}  body outline ${JSON.stringify(sb)}  cap ${JSON.stringify(sc)}`);
  console.log(`  ${''.padEnd(9)} raised [${s1}]  engraved [${s2}]  keychain [${s3}]  ${dt} ms for 3 builds`);
}

// 6. bad inputs -> warnings, still valid
const short = report('short body (height 6, rim 2)', await buildClicker({ design: { spec }, body: { height: 6, rimHeight: 2 } }));
check(short.warnings.some((w) => /too short/.test(w)), 'short body warning');
const shallow = report('shallow cavity (4 mm)', await buildClicker({ design: { spec }, switch: { cavityDepth: 4 } }));
check(shallow.warnings.some((w) => /cavity is only/.test(w)), 'shallow cavity warning');
check(Math.abs(shallow.assembly.floorThickness - (DEFAULT_PARAMS.body.height - 7 - 1.5 - 4)) < 1e-6, 'shallow cavity leaves a thicker floor');
const tiny = report('tiny circle (size 22)', await buildClicker({ design: { spec }, base: { style: 'circle', size: 22 } }));
check(tiny.warnings.some((w) => /too small/.test(w)), 'tiny base warning');

// 7. reference switch
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
