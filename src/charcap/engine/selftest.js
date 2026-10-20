// Node self-test for the Character Cap engine (no browser needed).
//   node src/charcap/engine/selftest.js
//
// Inputs: Clark's two real prints (Bambu object files in the scratchpad; skipped when absent)
// and the four built-in samples. Each goes through makeCap with flat / hollow undersides, with and
// without a smiley face (front and top), with and without the switch body. Every part must be
// watertight (0 open edges), NaN-free, rest on z = 0, have the socket ceiling at socketDepth at the
// origin, and export to a 3MF with the expected objects. Timings per step are printed.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

// --- DOMParser shim for SVGLoader / 3MFLoader (querySelector(All) with 'tag' or 'tag tag' selectors)
function addQS(node) {
  if (!node || node.querySelectorAll) return;
  node.querySelectorAll = function (sel) {
    const out = [];
    for (const part of sel.split(',').map((s) => s.trim())) {
      const tag = part.split(/\s+/).pop();
      const list = this.getElementsByTagName ? this.getElementsByTagName(tag) : [];
      for (let i = 0; i < list.length; i++) {
        addQS(list[i]);
        out.push(list[i]);
      }
    }
    return out;
  };
  node.querySelector = function (sel) {
    const r = this.querySelectorAll(sel);
    return r.length ? r[0] : null;
  };
}
globalThis.DOMParser = class {
  parseFromString(text, type) {
    const doc = new XmlDomParser().parseFromString(text, type);
    addQS(doc);
    addQS(doc.documentElement);
    return doc;
  }
};
const origWarn = console.warn;
console.warn = (...a) => { if (!/createShapes\(\) is deprecated|maxLeafSize/.test(String(a[0]))) origWarn(...a); };
const origError = console.error;
console.error = (...a) => { if (!/3MFLoader: Unsupported resource type/.test(String(a[0]))) origError(...a); };

const {
  DEFAULT_PARAMS, initBooleans, loadMesh, normalizeCharacter, makeCap, exportThreeMF, exportStlZip, makeDesignFromSvg, mergeParams,
} = await import('./index.js');
const { SAMPLES, buildSample } = await import('../samples/index.js');
const { openEdgeCount, meshVolume, hitFromBelow, hitsAlongZ, extents, triangleCount } = await import('./meshcheck.js');
const { geometryToStl } = await import('../../clicker/engine/export.js');

const here = dirname(fileURLToPath(import.meta.url));
const SCRATCH = 'C:/Users/clark/AppData/Local/Temp/claude/C--Users-clark-Claude-Projects-3D-Modeling-Apps/affad541-57e5-4c13-9eda-5f777e9441a1/scratchpad/pumpkin/x/3D/Objects/';
let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  FAIL:', msg);
  }
};
const ms = (v) => `${Math.round(v)} ms`;

function nanFree(geometry) {
  const a = geometry.attributes.position.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

// ---------------------------------------------------------------------------------- inputs
const t0 = Date.now();
let tw = performance.now();
await initBooleans();
console.log(`manifold-3d ready in ${ms(performance.now() - tw)}`);

const smiley = await makeDesignFromSvg(readFileSync(join(here, '..', '..', 'clicker', 'samples', 'smiley.svg'), 'utf8'));
check(smiley.shapes.length >= 1, 'smiley SVG traced');

const inputs = [];
for (const [file, label] of [['object_159.model', 'pumpkin (real print)'], ['object_93.model', 'ghost (real print)']]) {
  const path = SCRATCH + file;
  if (!existsSync(path)) {
    console.log(`  (skipping ${label}: ${path} not found)`);
    continue;
  }
  tw = performance.now();
  const loaded = await loadMesh(readFileSync(path, 'utf8'), { type: 'model', name: label });
  const e = extents(loaded.geometry);
  console.log(`loaded ${label}: ${triangleCount(loaded.geometry)} tris, ${e.x.toFixed(1)} x ${e.y.toFixed(1)} x ${e.z.toFixed(1)} mm, ${loaded.parts.length} part(s), ${ms(performance.now() - tw)}`);
  check(openEdgeCount(loaded.geometry) === 0, `${label} input is closed`);
  inputs.push({ label, geometry: loaded.geometry, width: Math.max(e.x, e.y), faceDirection: 'front' });
}
for (const s of SAMPLES) {
  tw = performance.now();
  const g = await buildSample(s.id);
  const e = extents(g);
  console.log(`sample ${s.id}: ${triangleCount(g)} tris, ${e.x.toFixed(1)} x ${e.y.toFixed(1)} x ${e.z.toFixed(1)} mm, ${ms(performance.now() - tw)}`);
  check(openEdgeCount(g) === 0, `sample ${s.id} is closed`);
  check(Math.abs(Math.max(e.x, e.y) - s.width) < 1.5, `sample ${s.id} is about ${s.width} mm wide (got ${Math.max(e.x, e.y).toFixed(1)})`);
  check(Math.abs(e.min.z) < 1e-4, `sample ${s.id} rests on z = 0`);
  inputs.push({ label: `sample ${s.id}`, geometry: g, width: s.width, faceDirection: s.faceDirection });
}

// ---------------------------------------------------------------------------------- loaders
{
  const cube = await buildSample('heart');
  const stl = geometryToStl(cube);
  const back = await loadMesh(stl, { type: 'stl', name: 'heart' });
  check(triangleCount(back.geometry) === triangleCount(cube), `STL round trip keeps ${triangleCount(cube)} triangles`);
  const obj = 'o box\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0 0 1\nv 1 0 1\nv 1 1 1\nv 0 1 1\n' +
    'f 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n';
  const objBack = await loadMesh(obj, { type: 'obj', name: 'box' });
  check(triangleCount(objBack.geometry) === 12 && openEdgeCount(objBack.geometry) === 0, 'OBJ cube loads as 12 closed triangles');
  check(objBack.parts.length === 1 && objBack.parts[0].name === 'box', 'OBJ keeps the object name as a part');
}

// ---------------------------------------------------------------------------------- checks
async function validate3MF(result, label, expectBody, expectFace) {
  const blob = await exportThreeMF(result, { name: label });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files);
  check(names.includes('3D/3dmodel.model') && names.includes('Metadata/model_settings.config'), `${label}: 3MF has model + Bambu metadata`);
  const xml = await zip.file('3D/3dmodel.model').async('string');
  const meshObjects = [...xml.matchAll(/<object id="(\d+)" name="([^"]+)" type="model"[^>]*>(<mesh>)?/g)];
  const meshNames = meshObjects.filter((m) => m[3]).map((m) => m[2]);
  check(meshNames.includes('cap'), `${label}: 3MF has a cap object`);
  check(meshNames.includes('body') === expectBody, `${label}: 3MF body object ${expectBody ? 'present' : 'absent'}`);
  check(meshNames.includes('design') === expectFace, `${label}: 3MF face (design) object ${expectFace ? 'present' : 'absent'}`);
  check(/<components>/.test(xml) === expectFace, `${label}: composite cap object ${expectFace ? 'present' : 'absent'}`);
  const items = [...xml.matchAll(/<item objectid="(\d+)"/g)].length;
  check(items === 1 + (expectBody ? 1 : 0), `${label}: ${1 + (expectBody ? 1 : 0)} build item(s) (got ${items})`);
  const settings = await zip.file('Metadata/model_settings.config').async('string');
  if (expectFace) check(/key="extruder" value="3"/.test(settings), `${label}: face on extruder 3`);
  if (expectBody) check(/key="extruder" value="1"/.test(settings), `${label}: body on extruder 1`);
  // every exported vertex rests on the plate: min z of each mesh object == 0
  const zs = [...xml.matchAll(/ z="(-?[\d.]+)"/g)].map((m) => +m[1]);
  check(Math.min(...zs) >= -1e-4, `${label}: 3MF rests on z = 0 (min z ${Math.min(...zs)})`);
  // 3MF loads back through loadMesh (three's 3MFLoader or the raw scan)
  const back = await loadMesh(await blob.arrayBuffer(), { type: '3mf', name: label });
  const total = result.parts.reduce((n, p) => n + triangleCount(p.geometry), 0);
  // the 3MF writer snaps vertices to 1e-4 mm and drops triangles that degenerate (edge collapses),
  // so the count may shrink a little; what matters is that the file stays closed
  check(triangleCount(back.geometry) >= 0.95 * total && triangleCount(back.geometry) <= total, `${label}: 3MF round trip keeps ~${total} triangles (got ${triangleCount(back.geometry)})`);
  check(openEdgeCount(back.geometry) === 0, `${label}: 3MF round trip is watertight`);

  const stl = await exportStlZip(result, { name: 'cc' });
  const z2 = await JSZip.loadAsync(await stl.arrayBuffer());
  const stlNames = Object.keys(z2.files).sort();
  const expected = ['cc-cap.stl'].concat(expectFace ? ['cc-cap-face.stl'] : [], expectBody ? ['cc-body.stl'] : []).sort();
  check(stlNames.join() === expected.join(), `${label}: STL zip files ${stlNames.join(', ')}`);
}

function report(label, result, params, expectFace) {
  const a = result.assembly;
  const tm = a.timings;
  console.log(`\n${label}`);
  console.log(`  parts: ${result.parts.map((p) => `${p.name} ${a.triangles[p.name]} tris`).join(', ')} | socket ${a.socketMode} ${a.socketDepth} mm, boss dia ${a.bossDiameter.toFixed(1)} to z ${a.bossTop.toFixed(1)}${a.bossAdded ? ' (added)' : ''}`);
  console.log(`  timings: ${Object.entries(tm).map(([k, v]) => `${k} ${v}`).join(', ')} ms`);
  if (result.warnings.length) console.log(`  warnings: ${result.warnings.join(' | ')}`);
  const cap = result.parts.find((p) => p.name === 'cap');
  const face = result.parts.find((p) => p.name === 'face');
  const body = result.parts.find((p) => p.name === 'body');
  for (const p of result.parts) {
    check(openEdgeCount(p.geometry) === 0, `${label}: ${p.name} watertight (open edges ${openEdgeCount(p.geometry)})`);
    check(nanFree(p.geometry), `${label}: ${p.name} NaN-free`);
    check(triangleCount(p.geometry) > 0, `${label}: ${p.name} not empty`);
  }
  const b = extents(cap.geometry);
  check(Math.abs(b.min.z) < 1e-3, `${label}: cap rests on z = 0 (min z ${b.min.z})`);
  // cap + face together are the normalised character (a flatHeight cut may narrow it)
  const u = { ...b };
  if (face) {
    const fb = extents(face.geometry);
    u.min = { x: Math.min(b.min.x, fb.min.x), y: Math.min(b.min.y, fb.min.y), z: Math.min(b.min.z, fb.min.z) };
    u.max = { x: Math.max(b.max.x, fb.max.x), y: Math.max(b.max.y, fb.max.y), z: Math.max(b.max.z, fb.max.z) };
    u.x = u.max.x - u.min.x; u.y = u.max.y - u.min.y; u.z = u.max.z - u.min.z;
  }
  if (params.flatHeight > 0) check(Math.max(u.x, u.y) <= params.width + 0.05, `${label}: cut cap no wider than ${params.width}`);
  else check(Math.abs(Math.max(u.x, u.y) - params.width) < 0.05, `${label}: cap(+face) long side == ${params.width} (got ${Math.max(u.x, u.y).toFixed(2)})`);
  check(Math.abs(u.z - a.height) < 1e-3, `${label}: cap(+face) height == assembly.height`);
  check(Math.abs((b.min.x + b.max.x) / 2) < 0.6 && Math.abs((b.min.y + b.max.y) / 2) < 0.6, `${label}: cap centred on XY`);
  check(b.z > 5 && b.z < 60, `${label}: cap height sane (${b.z.toFixed(1)})`);
  const depth = a.socketDepth;
  const hit = hitFromBelow(cap.geometry, 0.05, 0.03);
  check(hit !== null && Math.abs(hit - depth) < 1e-3, `${label}: socket ceiling at z = ${depth} above the origin (ray hit ${hit})`);
  if (face) {
    const fb = extents(face.geometry);
    check(fb.min.z >= -1e-3 && fb.max.z <= a.height + 1e-3 && Math.abs(fb.min.x) <= params.width / 2 + 1e-3 && Math.abs(fb.max.x) <= params.width / 2 + 1e-3, `${label}: face inside the character bounds`);
    const d = params.face.direction === 'top' ? fb.z : fb.y;
    check(d > params.face.depth - 1e-3, `${label}: face spans at least the inlay depth along the projection axis (${d.toFixed(2)})`);
    check(meshVolume(face.geometry) > 0.5, `${label}: face has volume (${meshVolume(face.geometry).toFixed(2)} mm^3)`);
  }
  check(!!face === !!expectFace, `${label}: face part ${expectFace ? 'present' : 'absent'}`);
  check(!!body === !!params.withBody, `${label}: body part ${params.withBody ? 'present' : 'absent'}`);
  if (body) {
    const bb = extents(body.geometry);
    check(Math.abs(bb.min.z) < 1e-4 && Math.abs(bb.z - DEFAULT_PARAMS.body.height) < 1e-4, `${label}: body rests on z = 0 with height ${DEFAULT_PARAMS.body.height}`);
    check(a.capZ > 0 && Math.abs(a.capZ - (DEFAULT_PARAMS.body.height - DEFAULT_PARAMS.body.rimHeight + 6.6)) < 1e-6, `${label}: capZ = plate top + 6.6 (${a.capZ})`);
    check(bb.x >= 15.6 + 2 * 2.5 - 0.01, `${label}: body wide enough for the switch (${bb.x.toFixed(1)})`);
  }
  return result;
}

// ---------------------------------------------------------------------------------- run
let volFlat = new Map();
for (const input of inputs) {
  const base = { width: input.width };
  const faceP = { spec: smiley, direction: input.faceDirection, width: 45, depth: 0.8 };

  // A. flat, no face, no body
  let r = report(`${input.label} / flat`, await makeCap(input.geometry, base), mergeParams(base), false);
  volFlat.set(input.label, meshVolume(r.parts[0].geometry));
  await validate3MF(r, `${input.label} flat`, false, false);

  // B. hollow + face (front/top) + body
  let p = { ...base, underside: 'hollow', face: faceP, withBody: true };
  r = report(`${input.label} / hollow + face ${input.faceDirection} + body`, await makeCap(input.geometry, p), mergeParams(p), true);
  check(meshVolume(r.parts[0].geometry) + meshVolume(r.parts[1].geometry) < volFlat.get(input.label) - 50, `${input.label}: hollowing removed material (${(volFlat.get(input.label) - meshVolume(r.parts[0].geometry) - meshVolume(r.parts[1].geometry)).toFixed(0)} mm^3)`);
  await validate3MF(r, `${input.label} hollow+face+body`, true, true);

  // C. flat + face (the other direction), no body; face + cap volumes add up to the plain cap
  const other = input.faceDirection === 'front' ? 'top' : 'front';
  p = { ...base, face: { ...faceP, direction: other } };
  r = report(`${input.label} / flat + face ${other}`, await makeCap(input.geometry, p), mergeParams(p), true);
  {
    const sum = meshVolume(r.parts[0].geometry) + meshVolume(r.parts[1].geometry);
    const ref = volFlat.get(input.label);
    check(Math.abs(sum - ref) < 0.005 * ref + 0.5, `${input.label}: cap + face volume == plain cap (${sum.toFixed(1)} vs ${ref.toFixed(1)})`);
  }

  // D. hollow, no face, body
  p = { ...base, underside: 'hollow', withBody: true };
  r = report(`${input.label} / hollow + body`, await makeCap(input.geometry, p), mergeParams(p), false);
  await validate3MF(r, `${input.label} hollow+body`, true, false);
}

// socket modes + flatHeight on one sample
{
  const g = inputs.find((i) => i.label === 'sample ghost').geometry;
  for (const mode of ['tapered', 'cross', 'round']) {
    const p = { width: 30, socket: { mode } };
    const r = report(`socket ${mode}`, await makeCap(g, p), mergeParams(p), false);
    const cap = r.parts[0].geometry;
    const depth = r.assembly.socketDepth;
    if (mode === 'round') {
      check(Math.abs(hitFromBelow(cap, 2.4, 0) - depth) < 1e-3, 'round: inside dia 5 hole up to the ceiling');
      check(Math.abs(hitFromBelow(cap, 2.7, 0)) < 1e-3, 'round: boss face at z = 0 just outside the hole');
    } else if (mode === 'cross') {
      check(Math.abs(hitFromBelow(cap, 2.0, 0) - depth) < 1e-3, 'cross: straight arm 4.1 wide reaches the ceiling');
      check(Math.abs(hitFromBelow(cap, 2.15, 0)) < 1e-3, 'cross: boss face just outside the arm');
    } else {
      const h = hitFromBelow(cap, 2.2, 0); // inside the 4.6 opening, outside the 4.1 ceiling
      check(h > 0.05 && h < depth - 0.05, `tapered: ray at x=2.2 hits the lofted wall between 0 and depth (${h && h.toFixed(2)})`);
      check(Math.abs(hitFromBelow(cap, 2.0, 0) - depth) < 1e-3, 'tapered: ceiling 4.1 wide');
      check(Math.abs(hitFromBelow(cap, 2.4, 0)) < 1e-3, 'tapered: boss face just outside the opening');
    }
  }
  const p = { width: 30, flatHeight: 2 };
  const r = report('flatHeight 2', await makeCap(g, p), mergeParams(p), false);
  check(Math.abs(extents(r.parts[0].geometry).z - (extents(g).z - 2)) < 0.05, 'flatHeight: character is 2 mm shorter and rests on the cut');
  // bad inputs
  const r2 = await makeCap(g, { width: 'abc', socket: { depth: 99 }, face: { spec: { shapes: [], warnings: [] } } });
  check(r2.warnings.some((w) => /Socket depth clamped/.test(w)), 'absurd socket depth is clamped with a warning');
  check(Math.abs(Math.max(extents(r2.parts[0].geometry).x, extents(r2.parts[0].geometry).y) - DEFAULT_PARAMS.width) < 0.05, 'non-numeric width falls back to the default');
  const normalized = normalizeCharacter(g, { width: 20 });
  check(Math.abs(Math.max(normalized.bounds.x, normalized.bounds.y) - 20) < 1e-3 && Math.abs(normalized.bounds.min.z) < 1e-6, 'normalizeCharacter scales to width and rests on z = 0');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
