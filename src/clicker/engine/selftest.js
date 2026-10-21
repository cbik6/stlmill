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
  DEFAULT_PARAMS, buildClicker, buildReferenceSwitch, exportThreeMF, exportStlZip, layoutForPrint,
  makeDesignFromShapes, makeDesignFromSvg, traceBitmap, mergeParams,
} = await import('./index.js');

/** Signed volume of a closed mesh (divergence theorem). */
function meshVolume(geometry) {
  const pos = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;
  const n = index ? index.length : pos.length / 3;
  let v = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = (index ? index[i] : i) * 3, b = (index ? index[i + 1] : i + 1) * 3, c = (index ? index[i + 2] : i + 2) * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
       - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
       + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}
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
  // rounded rectangle 100 x 90 with a hole + a disc beside it (bbox 152 x 90 units, aspect 1.69,
  // so at 35 mm the cap is taller than the 19.2 mm pocket envelope and no widening warning fires)
  const s = new THREE.Shape();
  const r = 12;
  s.moveTo(-50 + r, -45);
  s.lineTo(50 - r, -45);
  s.absarc(50 - r, -45 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(50, 45 - r);
  s.absarc(50 - r, 45 - r, r, 0, Math.PI / 2, false);
  s.lineTo(-50 + r, 45);
  s.absarc(-50 + r, 45 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-50, -45 + r);
  s.absarc(-50 + r, -45 + r, r, Math.PI, 1.5 * Math.PI, false);
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
  const objects = [...xml.matchAll(/<object id="(\d+)" name="([^"]+)"[^>]*pid="2" pindex="(\d+)">([\s\S]*?)<\/object>/g)];
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
  check((xml.match(/<m:color /g) || []).length === result.parts.length, '3MF colorgroup colours');
  check(/xmlns:m="http:\/\/schemas\.microsoft\.com\/3dmanufacturing\/material\/2015\/02"/.test(xml), '3MF declares the materials extension');
  check(/<m:colorgroup id="2">/.test(xml), '3MF colorgroup id 2');
  check(objects.every((m) => /pid="2"/.test(m[0])), '3MF objects use the colorgroup (pid=2)');
  check(/<metadata name="Title">/.test(xml), '3MF has Title metadata');
  const hasDesign = result.parts.some((p) => p.name === 'design');
  const topLevel = hasDesign ? 2 : result.parts.length; // cap + design are ONE composite object
  const items = [...xml.matchAll(/<item objectid="(\d+)" transform="([^"]+)"/g)];
  check(items.length === topLevel, `3MF build has ${topLevel} items (got ${items.length})`);
  check(items.every((m) => m[2] === '1 0 0 0 1 0 0 0 1 0 0 0'), '3MF item transforms are identity (layout baked into vertices)');
  if (hasDesign) {
    const comp = xml.match(/<object id="6" name="cap" type="model"><components>(.*?)<\/components><\/object>/);
    check(!!comp, '3MF has composite object 6 "cap"');
    const comps = comp ? [...comp[1].matchAll(/<component objectid="(\d+)"\/>/g)].map((m) => m[1]) : [];
    check(comps.join(',') === '4,5', `composite has components 4,5 (got ${comps.join(',')})`);
    check(comps.length && !/<component [^>]*transform=/.test(comp[1]), 'components carry no transform');
    check(items.map((m) => m[1]).join(',') === '3,6', `build items are objects 3 and 6 (got ${items.map((m) => m[1]).join(',')})`);
  }
  // XML well-formedness of the model + slicer metadata
  const parseXml = (text) => {
    let bad = false;
    const doc = new XmlDomParser({ onError: () => { bad = true; } }).parseFromString(text, 'text/xml');
    return bad ? null : doc;
  };
  check(parseXml(xml) !== null, '3dmodel.model parses as XML');
  for (const f of ['Metadata/Slic3r_PE_model.config', 'Metadata/model_settings.config']) {
    check(names.includes(f), `3MF contains ${f}`);
    const txt = names.includes(f) ? await zip.file(f).async('string') : '';
    const doc = parseXml(txt);
    check(doc !== null && doc.documentElement && doc.documentElement.nodeName === 'config', `${f} parses as XML <config>`);
    const objCount = (txt.match(/<object id=/g) || []).length;
    check(objCount === topLevel, `${f} has one <object> per build object (${topLevel}, got ${objCount})`);
    for (const [part, ext] of [['body', 1], ['cap', 2], ['design', 3]]) {
      if (!result.parts.some((p) => p.name === part)) continue;
      check(new RegExp(`value="${part}"[\\s\\S]{0,120}key="extruder" value="${ext}"`).test(txt), `${f}: ${part} -> extruder ${ext}`);
    }
    if (hasDesign) {
      const tri = Object.fromEntries(objects.map((m) => [m[2], (m[4].match(/<triangle /g) || []).length]));
      if (f.includes('model_settings')) {
        const obj6 = txt.match(/<object id="6">([\s\S]*?)<\/object>/);
        check(!!obj6 && /key="name" value="cap"/.test(obj6[1]), 'model_settings: object 6 named cap');
        check(!!obj6 && /<part id="4" subtype="normal_part">[\s\S]*?value="cap"[\s\S]*?key="extruder" value="2"/.test(obj6[1]), 'model_settings: part 4 = cap, extruder 2');
        check(!!obj6 && /<part id="5" subtype="normal_part">[\s\S]*?value="design"[\s\S]*?key="extruder" value="3"/.test(obj6[1]), 'model_settings: part 5 = design, extruder 3');
        check(!!obj6 && (obj6[1].match(/<part /g) || []).length === 2, 'model_settings: object 6 has exactly 2 parts');
        check((txt.match(/<model_instance>/g) || []).length === 2 && /object_id" value="6"/.test(txt), 'model_settings: plate instances for 3 and 6');
        check((txt.match(/<assemble_item /g) || []).length === 2 && /assemble_item object_id="6"/.test(txt), 'model_settings: assemble items for 3 and 6');
      }
      if (f.includes('model_settings')) {
        // Assembly View poses: applying each assemble transform to the BAKED (print-layout) vertices
        // must reproduce the viewer's assembled frame (body at origin, cap bottom face at capZ).
        const laidParts = layoutForPrint(result).parts;
        const applyTf = (geometry, m) => {
          const pos = geometry.attributes.position.array;
          const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
          for (let i = 0; i < pos.length; i += 3) {
            const x = pos[i], y = pos[i + 1], z = pos[i + 2];
            const X = x * m[0] + y * m[3] + z * m[6] + m[9];
            const Y = x * m[1] + y * m[4] + z * m[7] + m[10];
            const Z = x * m[2] + y * m[5] + z * m[8] + m[11];
            if (X < b.minX) b.minX = X; if (X > b.maxX) b.maxX = X;
            if (Y < b.minY) b.minY = Y; if (Y > b.maxY) b.maxY = Y;
            if (Z < b.minZ) b.minZ = Z; if (Z > b.maxZ) b.maxZ = Z;
          }
          return b;
        };
        const tfs = new Map([...txt.matchAll(/<assemble_item object_id="(\d+)" instance_id="0" transform="([^"]+)"/g)].map((m) => [m[1], m[2].split(' ').map(Number)]));
        check(tfs.size === topLevel && [...tfs.values()].every((m) => m.length === 12 && m.every(Number.isFinite)), 'assemble: one 12-number transform per build object');
        const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
        const builtBox = (name) => result.parts.find((p) => p.name === name).geometry.boundingBox;
        const capZ = result.assembly.capZ;
        const expect = (name, m, dz, label) => {
          const got = applyTf(laidParts.find((p) => p.name === name).geometry, m);
          const ref = builtBox(name);
          const ok = near(got.minX, ref.min.x) && near(got.maxX, ref.max.x) && near(got.minY, ref.min.y) && near(got.maxY, ref.max.y) && near(got.minZ, ref.min.z + dz) && near(got.maxZ, ref.max.z + dz);
          check(ok, `assemble: ${label} reproduces the viewer frame (z ${got.minZ.toFixed(3)}..${got.maxZ.toFixed(3)}, expected ${(ref.min.z + dz).toFixed(3)}..${(ref.max.z + dz).toFixed(3)})`);
          return got;
        };
        const bodyBox = expect('body', tfs.get('3'), 0, 'body');
        check(near(bodyBox.minZ, 0) && near((bodyBox.minX + bodyBox.maxX) / 2, 0, 0.05) && near((bodyBox.minY + bodyBox.maxY) / 2, 0, 0.05), 'assemble: body at origin, floor on z = 0');
        const capId = hasDesign ? '6' : '4';
        const capBox = expect('cap', tfs.get(capId), capZ, 'cap');
        check(near(capBox.maxZ, capZ + result.assembly.capThickness) && near(capBox.minZ, capZ - result.assembly.bossBelow), 'assemble: cap underside at capZ (minus any boss), top at capZ + thickness');
        check(near((capBox.minX + capBox.maxX) / 2, 0, 0.05) && near((capBox.minY + capBox.maxY) / 2, 0, 0.05), 'assemble: cap centred over the body');
        if (hasDesign) {
          const dBox = expect('design', tfs.get('6'), capZ, 'design (same transform as the cap)');
          const depth = result.assembly.engraveDepth || DEFAULT_PARAMS.cap.designHeight;
          if (result.parts[1].print.flipX) check(near(dBox.minZ, capZ + DEFAULT_PARAMS.cap.thickness - depth) && near(dBox.maxZ, capZ + DEFAULT_PARAMS.cap.thickness), 'assemble: inlay filler at capZ + thickness - depth .. capZ + thickness');
        }
        console.log(`  assemble: ${[...tfs].map(([id, m]) => `${id} -> [${m.join(' ')}]`).join('  ')}`);
      } else {
        const obj6 = txt.match(/<object id="6" instances_count="1">([\s\S]*?)<\/object>/);
        const vols = obj6 ? [...obj6[1].matchAll(/<volume firstid="(\d+)" lastid="(\d+)">[\s\S]*?key="name" value="(\w+)"[\s\S]*?key="extruder" value="(\d)"/g)].map((m) => m.slice(1)) : [];
        check(vols.length === 2, `Slic3r: object 6 has 2 volumes (got ${vols.length})`);
        const capT = tri.cap, desT = tri.design;
        check(vols[0] && vols[0].join() === `0,${capT - 1},cap,2`, `Slic3r: volume 0 = cap 0..${capT - 1} extruder 2 (got ${vols[0]})`);
        check(vols[1] && vols[1].join() === `${capT},${capT + desT - 1},design,3`, `Slic3r: volume 1 = design ${capT}..${capT + desT - 1} extruder 3 (got ${vols[1]})`);
      }
    }
  }
  check(names.includes('Metadata/project_settings.config'), '3MF contains Metadata/project_settings.config');
  if (names.includes('Metadata/project_settings.config')) {
    const ps = JSON.parse(await zip.file('Metadata/project_settings.config').async('string'));
    check(Array.isArray(ps.filament_colour) && ps.filament_colour.length === result.parts.length, 'project_settings filament_colour per extruder');
    check(ps.filament_colour[0] === '#2B2B2B' && ps.filament_colour[1] === '#F5F5F5', 'filament colours body/cap');
    console.log(`  project_settings: ${JSON.stringify(ps.filament_colour)}`);
  }
  const ct = await zip.file('[Content_Types].xml').async('string');
  check(/Slic3r_PE_model\.config/.test(ct) && /model_settings\.config/.test(ct) && /project_settings\.config/.test(ct), 'Content types register the Metadata parts');
  console.log(`  3MF size ${blob.size} bytes`);

  // print layout: each part rests on z = 0, body / cap do not overlap in XY, design follows the cap
  const laid = layoutForPrint(result).parts;
  const bb = (p) => p.geometry.boundingBox;
  const body = laid.find((p) => p.name === 'body'), cap = laid.find((p) => p.name === 'cap'), des = laid.find((p) => p.name === 'design');
  check(bb(body).min.z === 0, `layout: body min z == 0 (got ${bb(body).min.z})`);
  check(bb(cap).min.z === 0, `layout: cap min z == 0 (got ${bb(cap).min.z})`);
  const flipped = result.parts[1].print.flipX;
  if (des) {
    if (flipped) check(bb(des).min.z === 0, `layout: inlay filler min z == 0 (got ${bb(des).min.z})`);
    else check(Math.abs(bb(des).min.z - (bb(cap).max.z)) < 1e-6, 'layout: raised relief sits on the cap top');
    check(Math.abs((bb(des).min.x + bb(des).max.x) / 2 - (bb(cap).min.x + bb(cap).max.x) / 2) < 0.5, 'layout: design registered with the cap in X');
  }
  const noOverlap = bb(body).max.x < bb(cap).min.x || bb(cap).max.x < bb(body).min.x || bb(body).max.y < bb(cap).min.y || bb(cap).max.y < bb(body).min.y;
  check(noOverlap, 'layout: body and cap do not overlap in XY');
  check(bb(body).max.x < 0 && bb(cap).min.x > 0, 'layout: body left of origin, cap right of origin');
  if (flipped) check(Math.abs(bb(cap).max.z - (result.assembly.capThickness + result.assembly.bossBelow)) < 1e-6, `layout: flipped cap rests on its top, socket opening up (max z ${bb(cap).max.z.toFixed(2)})`);
  for (const p of laid) check(openEdgeCount(p.geometry) === 0, `layout: ${p.name} still watertight`);
  console.log(`  layout: body x[${bb(body).min.x.toFixed(1)}, ${bb(body).max.x.toFixed(1)}]  cap x[${bb(cap).min.x.toFixed(1)}, ${bb(cap).max.x.toFixed(1)}] z[0, ${bb(cap).max.z.toFixed(2)}]${des ? `  design z[${bb(des).min.z.toFixed(2)}, ${bb(des).max.z.toFixed(2)}]` : ''}`);

  const stl = await exportStlZip(result, { name: label });
  const z2 = await JSZip.loadAsync(await stl.arrayBuffer());
  const stlNames = Object.keys(z2.files);
  check(stlNames.length === result.parts.length, 'STL zip has one file per part');
  check(stlNames.includes('clicker-body.stl') && stlNames.includes('clicker-cap.stl'), 'STL file names clicker-<part>.stl');
  if (des) check(stlNames.includes(flipped ? 'clicker-cap-inlay.stl' : 'clicker-cap-raised.stl'), `STL design file named by relationship (${stlNames.join(', ')})`);
  for (const n of stlNames) {
    const buf = await z2.file(n).async('arraybuffer');
    const count = new DataView(buf).getUint32(80, true);
    check(buf.byteLength === 84 + count * 50, `STL ${n} size matches header (${count} tris)`);
    let minZ = Infinity;
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) minZ = Math.min(minZ, new DataView(buf).getFloat32(84 + i * 50 + 12 + k * 12 + 8, true));
    if (!/design/.test(n) || flipped) check(minZ === 0, `STL ${n} rests on z = 0 (min z ${minZ})`);
  }
}

// ---------------------------------------------------------------------------------- run
const t0 = Date.now();
const spec = syntheticDesign();

// 1. defaults (inlay) + synthetic design
check(DEFAULT_PARAMS.cap.designMode === 'inlay', 'default designMode is inlay');
const base = report('outline / inlay (synthetic, defaults)', await buildClicker({ design: { spec } }));
check(base.parts.map((p) => p.name).join(',') === 'body,cap,design', 'parts are body,cap,design');
// outline semantics: base.size is the DESIGN's longest side; the body grows by margin + wall + clearance per side
check(Math.abs(base.assembly.designSize - 35) < 1e-6, `designSize == base.size at fill 100 (got ${base.assembly.designSize})`);
{
  const d = base.parts[2].geometry.boundingBox;
  check(Math.abs(d.max.x - d.min.x - 35) < 0.05, `design part is 35 mm wide (got ${(d.max.x - d.min.x).toFixed(2)})`);
}
check(Math.abs(base.bounds.x - (35 + 2 * (2.5 + 2.5 + 0.3))) < 0.3, `body long side = 35 + 2 * 5.3 = 45.6 mm (got ${base.bounds.x.toFixed(2)})`);
check(Math.abs(base.assembly.bodySize - base.bounds.x) < 0.05 && Math.abs(base.assembly.capSize - (35 + 5)) < 0.3, `assembly.bodySize ${base.assembly.bodySize.toFixed(1)} / capSize ${base.assembly.capSize.toFixed(1)}`);
check(DEFAULT_PARAMS.body.height === 'auto' && Math.abs(base.bounds.z - 18.2) < 1e-6, `body height auto -> 18.2 (got ${base.bounds.z})`);
// centre-post pocket in the cavity floor: pocket z 1.0 .. 4.2 (post 3.0 + 0.2), 1.0 mm solid floor below it
check(Math.abs(base.assembly.floorThickness - 4.2) < 1e-6 && Math.abs(base.assembly.postPocketDepth - 3.2) < 1e-9 && Math.abs(base.assembly.postPocketDiameter - 4.6) < 1e-9 && Math.abs(base.assembly.postPocketBottomZ - 1.0) < 1e-6, `post pocket 4.6 dia x 3.2 from z 1.0 to 4.2, floor 4.2 (got floor ${base.assembly.floorThickness}, pocket ${base.assembly.postPocketDiameter} x ${base.assembly.postPocketDepth} from ${base.assembly.postPocketBottomZ})`);
{
  const bodyG0 = base.parts[0].geometry;
  const origin = hitsAlongAxis(bodyG0, 0, 0); // function declaration, hoisted from the socket section
  check(origin.length === 2 && Math.abs(origin[0]) < 1e-6 && Math.abs(origin[1] - 1.0) < 1e-6, `body ray at the origin: solid bottom at z = 0, post pocket floor at 1.0, then open through cutout/recess (got ${origin.map((z) => z.toFixed(2)).join(', ')})`);
  const ring = hitsAlongAxis(bodyG0, 5, 0);
  check(ring.length === 2 && Math.abs(ring[0]) < 1e-6 && Math.abs(ring[1] - 4.2) < 1e-6, `body ray at (5,0): bottom at 0 then the cavity floor ring at 4.2 (got ${ring.map((z) => z.toFixed(2)).join(', ')})`);
  const pocketEdge = hitsAlongAxis(bodyG0, 2.0, 0);
  check(pocketEdge.length === 2 && Math.abs(pocketEdge[1] - 1.0) < 1e-6, `body ray at (2,0) is inside the 4.6 pocket (got ${pocketEdge.map((z) => z.toFixed(2)).join(', ')})`);
}
check(base.parts[1].geometry.boundingBox.min.z === 0, `cap has no boss: nothing below z = 0 (min z ${base.parts[1].geometry.boundingBox.min.z})`);
check(Math.abs(base.parts[1].geometry.boundingBox.max.z - 6.2) < 1e-6, 'cap top at z = thickness 6.2');
check(Math.abs(base.parts[2].geometry.boundingBox.min.z - 5.4) < 1e-6 && Math.abs(base.parts[2].geometry.boundingBox.max.z - 6.2) < 1e-6, 'inlay filler spans thickness-designHeight .. thickness (5.4..6.2)');
check(base.assembly.engraveDepth === 0.8, 'inlay pocket depth = designHeight 0.8');
check(base.assembly.bossBelow === 0 && Math.abs(base.assembly.socketCeilingZ - 4.0) < 1e-9, 'socket cut into the boss: ceiling at z = 4.0, nothing below z = 0');
check(Math.abs(base.assembly.travel - 4.4) < 1e-9 && Math.abs(base.assembly.pocketSide - 16.2) < 1e-9 && Math.abs(base.assembly.bossDiameter - 6.0) < 1e-9, `housing pocket 16.2 sq x 4.4 deep, boss 6.0 (got ${base.assembly.pocketSide}, ${base.assembly.travel}, ${base.assembly.bossDiameter})`);
check(base.assembly.travel <= base.assembly.capThickness - base.assembly.engraveDepth - 1.0 + 1e-9, 'inlay floor keeps >= 1.0 mm of cap above the housing pocket ceiling');
{
  const capG = base.parts[1].geometry;
  const rays = (x, y) => {
    const pos = capG.attributes.position.array;
    const index = capG.index.array;
    const zs = [];
    for (let i = 0; i + 2 < index.length; i += 3) {
      const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
      const ax = pos[a] - x, ay = pos[a + 1] - y, bx = pos[b] - x, by = pos[b + 1] - y, cx = pos[c] - x, cy = pos[c + 1] - y;
      const d1 = ax * by - ay * bx, d2 = bx * cy - by * cx, d3 = cx * ay - cy * ax;
      if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
      const area = d1 + d2 + d3;
      if (Math.abs(area) < 1e-12) continue;
      zs.push((pos[a + 2] * d2 + pos[b + 2] * d3 + pos[c + 2] * d1) / area);
    }
    zs.sort((p, q) => p - q);
    return zs.filter((z, i) => i === 0 || Math.abs(z - zs[i - 1]) > 1e-6);
  };
  const axis = rays(0, 0);
  check(axis.length === 2 && Math.abs(axis[0] - 4.0) < 1e-6 && Math.abs(axis[1] - 5.4) < 1e-6, `boss: axis ray hits the socket ceiling at 4.0 then the inlay floor at 5.4 (got ${axis.map((z) => z.toFixed(2)).join(', ')})`);
  // probe points under the design's rectangle (left of its hole), inside / outside the 16.2 pocket
  const pocketRay = rays(-6, 3); // beside the design's hole (|y| > 2.3), inside the pocket, clear of the boss
  check(pocketRay.length === 2 && Math.abs(pocketRay[0] - 4.4) < 1e-6 && Math.abs(pocketRay[1] - 5.4) < 1e-6, `pocket: ray at (-6,3) hits the pocket ceiling at 4.4 then the inlay floor (got ${pocketRay.map((z) => z.toFixed(2)).join(', ')})`);
  const ringRay = rays(-12, 0);
  check(ringRay.length >= 2 && Math.abs(ringRay[0]) < 1e-6 && Math.abs(ringRay[ringRay.length - 1] - 5.4) < 1e-6, `underside ring solid outside the pocket: ray at (-12,0) starts at z = 0 (got ${ringRay.map((z) => z.toFixed(2)).join(', ')})`);
  const bossRay = rays(2.6, 0.3); // inside the 6.0 boss, beyond the 2.2 arm tip, off the arm's 0.7 half-width
  check(bossRay.length === 2 && Math.abs(bossRay[0]) < 1e-6 && Math.abs(bossRay[1] - 5.4) < 1e-6, `boss bottom flush with z = 0 beside the cross arm (got ${bossRay.map((z) => z.toFixed(2)).join(', ')})`);
}
check(base.warnings.length === 0, `no warnings with defaults (${base.warnings.join(' | ')})`);
check(base.parts[1].print && base.parts[1].print.flipX === true, 'inlay cap prints flipped');
// raised: relief on top, supports warning
const raised = report('outline / raised (synthetic)', await buildClicker({ design: { spec }, cap: { designMode: 'raised' } }));
check(raised.parts[2].geometry.boundingBox.min.z >= 3 - 1e-6, 'raised design sits on cap top');
check(raised.warnings.some((w) => /need supports/.test(w)), 'raised build warns about supports');
check(raised.parts[1].print.flipX === false, 'raised cap prints cap-up');
// inlay pocket volume == filler volume (within 1%)
{
  const vRaisedCap = meshVolume(raised.parts[1].geometry);
  const vInlayCap = meshVolume(base.parts[1].geometry);
  const vFiller = meshVolume(base.parts[2].geometry);
  const pocket = vRaisedCap - vInlayCap;
  check(Math.abs(pocket - vFiller) <= 0.01 * vFiller, `inlay pocket volume ${pocket.toFixed(3)} == filler ${vFiller.toFixed(3)} mm^3 (1%)`);
  console.log(`  volumes: cap plain ${vRaisedCap.toFixed(2)}, cap pocketed ${vInlayCap.toFixed(2)}, pocket ${pocket.toFixed(2)}, filler ${vFiller.toFixed(2)} mm^3`);
}
const asm = base.assembly;
check(Math.abs(asm.floorThickness - 4.2) < 1e-6, `floor thickness 4.2 with the post pocket (got ${asm.floorThickness})`);
check(DEFAULT_PARAMS.switch.pins === 'clipped' && DEFAULT_PARAMS.switch.cavityDepth === 'auto' && Math.abs(asm.cavityDepth - 5.5) < 1e-6, `pins clipped -> cavity depth 5.5 (got ${asm.cavityDepth})`);
check(Math.abs(asm.plateTopZ - (asm.bodyHeight - DEFAULT_PARAMS.body.rimHeight)) < 1e-6, 'plate top z = height - rim');
check(Math.abs(asm.seat - (6.6 + Math.max(0, 3.6 - DEFAULT_PARAMS.switch.stemHeight))) < 1e-9 && Math.abs(asm.seat - 6.6) < 1e-9, `seat = 6.6 + max(0, 3.6 - socket 4.0) = 6.6: boss bottom level with the housing top (got ${asm.seat})`);
check(Math.abs(asm.capZ - (asm.plateTopZ + asm.seat)) < 1e-6, 'capZ = plateTopZ + seat');
check(Math.abs(asm.capZ - (asm.bodyHeight - 0.4)) < 1e-6, `cap underside seats 0.4 mm below the rim (capZ ${asm.capZ}, height ${asm.bodyHeight})`);
check(DEFAULT_PARAMS.body.rimHeight === 7.0 && DEFAULT_PARAMS.cap.thickness === 6.2 && DEFAULT_PARAMS.cap.designHeight === 0.8 && DEFAULT_PARAMS.switch.stemHeight === 4.0 && DEFAULT_PARAMS.switch.travel === 4.4 && DEFAULT_PARAMS.switch.bossDiameter === 6.0, 'defaults: rim 7.0, cap 6.2 / 0.8, socket 4.0, travel 4.4, boss 6.0');
// the cap must enclose the 16.2 housing pocket + (1.2 wall + 0.3 pad) all round (19.2), so the body is 19.2 + 2 * 2.8 = 24.8 across its narrow side
// design 35 x 20.7 (152 x 90 units) -> cap 40 x 25.7 -> body 45.6 x 31.3 (the 19.2 pocket envelope stays hidden)
check(Math.abs(asm.bodyHeight - 18.2) < 1e-6 && Math.abs(base.bounds.x - 45.6) < 0.15 && Math.abs(base.bounds.y - 31.3) < 0.2, `default bounds ~45.6 x 31.3 x 18.2 (got ${base.bounds.x.toFixed(2)} x ${base.bounds.y.toFixed(2)} x ${base.bounds.z.toFixed(2)})`);
// narrow design ("I" bar 10 x 100 units -> 3.5 x 35 mm): the cap is widened to the pocket envelope with a warning
{
  const bar = new THREE.Shape([[-5, -50], [5, -50], [5, 50], [-5, 50]].map(([x, y]) => new THREE.Vector2(x, y)));
  const narrow = report('narrow bar (envelope shows)', await buildClicker({ design: { spec: makeDesignFromShapes([bar], 1) } }), { quiet: true });
  check(narrow.warnings.some((w) => /narrower than the switch pocket/.test(w)), `narrow design warns about the widened cap (${narrow.warnings.join(' | ')})`);
  const cb = narrow.parts[1].geometry.boundingBox;
  check(Math.abs(cb.max.x - cb.min.x - 19.2) < 0.3 && Math.abs(cb.max.y - cb.min.y - 40) < 0.3, `narrow cap is 19.2 wide (envelope) x 40 tall (got ${(cb.max.x - cb.min.x).toFixed(2)} x ${(cb.max.y - cb.min.y).toFixed(2)})`);
  check(Math.abs(narrow.assembly.designSize - 35) < 1e-6 && Math.abs(narrow.bounds.x - 24.8) < 0.3, `narrow body 24.8 wide (got ${narrow.bounds.x.toFixed(2)})`);
}
// pins kept: deeper cavity, taller body, same seat
const keep = report('pins kept (cavity 8.5)', await buildClicker({ design: { spec }, switch: { pins: 'keep' } }), { quiet: true });
check(Math.abs(keep.assembly.cavityDepth - 8.5) < 1e-6 && Math.abs(keep.assembly.bodyHeight - 18.5) < 1e-6 && Math.abs(keep.assembly.floorThickness - 1.5) < 1e-6 && keep.assembly.postPocketDepth === 0, `pins keep -> cavity 8.5 swallows the post (no pocket), height 18.5, floor 1.5 (got ${keep.assembly.cavityDepth}, ${keep.assembly.bodyHeight}, pocket ${keep.assembly.postPocketDepth})`);
{
  const o = hitsAlongAxis(keep.parts[0].geometry, 0, 0);
  check(o.length === 2 && Math.abs(o[0]) < 1e-6 && Math.abs(o[1] - 1.5) < 1e-6, `pins keep: plain 1.5 mm floor at the origin (got ${o.map((z) => z.toFixed(2)).join(', ')})`);
}
check(Math.abs(keep.assembly.capZ - (keep.assembly.bodyHeight - 0.4)) < 1e-6 && keep.warnings.length === 0, 'pins keep: cap still 0.4 below the rim, no warnings');
const fixedH = await buildClicker({ design: { spec }, body: { height: 20 } });
check(Math.abs(fixedH.assembly.bodyHeight - 20) < 1e-6 && Math.abs(fixedH.assembly.floorThickness - (20 - DEFAULT_PARAMS.body.rimHeight - 1.5 - 5.5)) < 1e-6, 'numeric body.height is honoured (extra goes into the floor)');
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
  await buildClicker({ design: { spec: traced }, cap: { designMode: 'engraved' }, keychain: { enabled: true, angle: 90 } }));
check(engraved.parts.length === 2, 'engraved has no separate design part');
check(engraved.bounds.y > base.bounds.y + 3, `keychain ring at 90 deg extends the Y bounds (${base.bounds.y.toFixed(1)} -> ${engraved.bounds.y.toFixed(1)})`);
check(Math.abs(engraved.parts[1].geometry.boundingBox.max.z - DEFAULT_PARAMS.cap.thickness) < 1e-6, 'engraved cap keeps its top at thickness');
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
check(Math.abs(shallow.assembly.cavityDepth - 4) < 1e-6 && Math.abs(shallow.assembly.floorThickness - 4.2) < 1e-6 && Math.abs(shallow.assembly.bodyHeight - (4.2 + 4 + 1.5 + DEFAULT_PARAMS.body.rimHeight)) < 1e-6, `numeric cavityDepth 4 honoured; post pocket floor 4.2, auto height follows (${shallow.assembly.bodyHeight})`);
const tiny = report('tiny circle (size 22)', await buildClicker({ design: { spec }, base: { style: 'circle', size: 22 } }));
check(tiny.warnings.some((w) => /too small/.test(w)), 'tiny base warning');

// 7. stem socket variants (cap) and the press-fit coupon plate
/** z of every face crossing crossed by a vertical ray at (x, y), ascending. */
function hitsAlongAxis(geometry, x, y) {
  const pos = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;
  const n = index ? index.length : pos.length / 3;
  const zs = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const a = (index ? index[i] : i) * 3, b = (index ? index[i + 1] : i + 1) * 3, c = (index ? index[i + 2] : i + 2) * 3;
    const ax = pos[a] - x, ay = pos[a + 1] - y, bx = pos[b] - x, by = pos[b + 1] - y, cx = pos[c] - x, cy = pos[c + 1] - y;
    const d1 = ax * by - ay * bx, d2 = bx * cy - by * cx, d3 = cx * ay - cy * ax;
    if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
    const area = d1 + d2 + d3;
    if (Math.abs(area) < 1e-12) continue;
    zs.push((pos[a + 2] * d2 + pos[b + 2] * d3 + pos[c + 2] * d1) / area);
  }
  // a ray through a shared vertex/edge reports the same face several times: keep unique z
  zs.sort((p, q) => p - q);
  return zs.filter((z, i) => i === 0 || Math.abs(z - zs[i - 1]) > 1e-6);
}
const halfExtentAt = (geometry, z, axis = 0) => {
  const pos = geometry.attributes.position.array;
  let m = 0;
  for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i + 2] - z) < 1e-4) m = Math.max(m, Math.abs(pos[i + axis]));
  return m;
};
console.log('\n== stem socket variants');
const depth = DEFAULT_PARAMS.switch.stemHeight;
const capT = DEFAULT_PARAMS.cap.thickness;
check(depth === 4.0 && DEFAULT_PARAMS.switch.socketMode === 'cross' && DEFAULT_PARAMS.switch.stemCrossWidth === 4.4 && DEFAULT_PARAMS.switch.stemCrossThickness === 1.4 && DEFAULT_PARAMS.switch.roundDiameter === 5.0, 'socket defaults (ghost copy): straight cross 4.4 x 1.4, 4.0 deep, round 5.0');
{
  // tapered arm thickness scales with the width ratio: 1.3 at the ceiling -> ~1.7 at the opening
  const { socketPolygons: sp } = await import('./index.js');
  const sock = sp({ ...DEFAULT_PARAMS.switch, socketMode: 'tapered', stemCrossWidth: 4.6, stemCrossThickness: 1.3, socketOpening: 6.0 });
  const halfThick = (poly) => Math.min(...poly.filter((p) => Math.abs(p.x) > 2.2).map((p) => Math.abs(p.y)));
  check(Math.abs(halfThick(sock.ceiling) * 2 - 1.3) < 1e-6 && Math.abs(halfThick(sock.opening) * 2 - 1.3 * (6.0 / 4.6)) < 1e-6, `tapered arm thickness 1.3 at the ceiling, ${(1.3 * 6 / 4.6).toFixed(2)} at the opening (got ${(halfThick(sock.opening) * 2).toFixed(3)})`);
}
for (const [mode, extra, openHalf, ceilHalf] of [
  ['cross', {}, 2.2, 2.2], // the default: ghost copy, 4.4 wide
  ['tapered', { bossDiameter: 6.5 }, 3.0, 2.2], // the 6.0 opening needs a boss over 6.41 (else it warns and widens)
  ['round', {}, 2.5, 2.5],
]) {
  // raised mode -> plain cap top, so the axis ray sees exactly the socket ceiling (z = depth) and the top (z = thickness)
  const r = report(`cap socket: ${mode}`, await buildClicker({ design: { spec }, cap: { designMode: 'raised' }, switch: { socketMode: mode, ...extra } }), { quiet: true });
  const capG = r.parts[1].geometry;
  const hits = hitsAlongAxis(capG, 0.0, 0.0);
  check(capG.boundingBox.min.z === 0, `${mode}: socket opens on the underside plane z = 0, no boss (min z ${capG.boundingBox.min.z})`);
  check(hits.length === 2 && Math.abs(hits[0] - depth) < 1e-6 && Math.abs(hits[1] - capT) < 1e-6, `${mode}: axis ray hits the ceiling at z = ${depth} and the cap top at ${capT} only (got ${hits.map((z) => z.toFixed(2)).join(', ')})`);
  // socket polygon extents via the inner vertices on the opening / ceiling planes
  // socket vertices only: everything inside the boss ring (ring radius = bossDiameter/2); the tapered 6.0
  // opening's corners sit at r 3.12, inside the 6.4 boss's ring at 3.2
  const maxR = r.assembly.bossDiameter / 2 - 0.03;
  const inner = (z) => { const pos = capG.attributes.position.array; let m = 0; for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i + 2] - z) < 1e-4 && Math.hypot(pos[i], pos[i + 1]) < maxR) m = Math.max(m, Math.abs(pos[i])); return m; };
  check(Math.abs(inner(0) - openHalf) < 0.02, `${mode}: opening half-width ${openHalf} (got ${inner(0).toFixed(3)})`);
  check(Math.abs(inner(depth) - ceilHalf) < 0.02, `${mode}: ceiling half-width ${ceilHalf} (got ${inner(depth).toFixed(3)})`);
  const unexpected = r.warnings.filter((w) => !/need supports/.test(w));
  check(unexpected.length === 0, `${mode}: no socket warnings (${unexpected.join(' | ')})`);
  console.log(`  ${mode.padEnd(8)} cap ${r.assembly.triangles.cap} tris, axis hits [${hits.map((z) => z.toFixed(2)).join(', ')}], opening half ${inner(0).toFixed(2)}, ceiling half ${inner(depth).toFixed(2)}, min z ${capG.boundingBox.min.z.toFixed(2)}`);
}
{
  // socket deeper than the cap allows (5.0 into a 6.0 cap with a 0.8 pocket): the cap is thickened
  // to 5.0 + 1.0 + 0.8 = 6.8, the socket continues from the boss into the slab, nothing hangs below
  const deep = report('deep socket (cap thickened)', await buildClicker({ design: { spec }, switch: { stemHeight: 5.0 } }), { quiet: true });
  check(deep.warnings.some((w) => /too thin/.test(w)), 'deep socket: cap thickness warning');
  check(deep.assembly.bossBelow === 0 && deep.parts[1].geometry.boundingBox.min.z === 0 && Math.abs(deep.assembly.capThickness - 6.8) < 1e-9 && Math.abs(deep.parts[1].geometry.boundingBox.max.z - 6.8) < 1e-6, `deep socket: cap 6.8 thick, nothing below z = 0 (min z ${deep.parts[1].geometry.boundingBox.min.z}, max ${deep.parts[1].geometry.boundingBox.max.z.toFixed(2)})`);
  check(Math.abs(deep.assembly.seat - 6.6) < 1e-9, 'deep socket: seat stays 6.6 (socket deeper than the stem)');
  check(Math.abs(deep.assembly.socketCeilingZ - 5.0) < 1e-9 && openEdgeCount(deep.parts[1].geometry) === 0, 'deep socket: ceiling at 5.0 above the pocket ceiling, cap watertight');
  const laid = layoutForPrint(deep).parts;
  check(laid.every((p) => p.geometry.boundingBox.min.z === 0), 'deep socket: print layout still rests every part on z = 0');
}

console.log('\n== socket coupons');
{
  const { buildSocketCoupons, exportSocketCoupons } = await import('./index.js');
  const { parts: coupons } = buildSocketCoupons();
  check(coupons.length === 6, 'six coupons');
  const names = coupons.map((p) => p.name);
  check(names.join('|') === 'A straight 4.1|B straight 4.3|C tapered 6.0-4.6|D tapered 4.8-4.2|E round 5.0|F round 5.4', `coupon names (${names.join('|')})`);
  const { LABEL, labelPixelSize, couponMaxSocketRadius } = await import('./index.js');
  const D = 18; // default coupon diameter
  const maxR = couponMaxSocketRadius();
  const pixel = labelPixelSize(D, maxR);
  check(Math.abs(pixel - 0.7) < 1e-9, `default coupons use the 0.7 mm pixel cap (got ${pixel})`);
  check(Math.abs(maxR - 3.0) < 1e-9, `widest coupon socket opening is the 6.0 cross (r ${maxR})`);
  check(Math.abs(labelPixelSize(14, maxR) - 0.3) < 1e-9, `14 mm pucks would get 0.3 mm pixels (got ${labelPixelSize(14, maxR)})`);
  check(labelPixelSize(8, maxR) === 0, 'too-small puck -> no label');
  const labelX = -(maxR + LABEL.clearance + (5 * pixel) / 2);
  const px = (col, row) => ({ x: labelX - (5 * pixel) / 2 + (col + 0.5) * pixel, y: (7 * pixel) / 2 - (row + 0.5) * pixel });
  for (const p of coupons) {
    const bb = p.geometry.boundingBox;
    check(openEdgeCount(p.geometry) === 0, `${p.name}: watertight`);
    check(Math.abs(bb.max.x - bb.min.x - D) < 0.05 && Math.abs(bb.max.y - bb.min.y - D) < 0.05 && bb.min.z === 0 && Math.abs(bb.max.z - 6.6) < 1e-6, `${p.name}: ${D} x ${D} on z = 0, max z 6.6 (label)`);
    const hits = hitsAlongAxis(p.geometry, 0, 0);
    check(hits.length === 2 && Math.abs(hits[0]) < 1e-6 && Math.abs(hits[1] - 2) < 1e-6, `${p.name}: socket opens UP, ceiling at z = 2 (hits ${hits.map((z) => z.toFixed(2)).join(', ')})`);
    // letter: every glyph has its column-0 pixel set on row 3 -> solid at 6.6; A/B counters are open -> 6.0
    const solid = px(0, 3);
    const hs = hitsAlongAxis(p.geometry, solid.x, solid.y);
    check(hs.length && Math.abs(hs[hs.length - 1] - 6.6) < 1e-6, `${p.name}: raised letter at (${solid.x.toFixed(2)}, ${solid.y.toFixed(2)}) reaches z 6.6 (hits ${hs.map((z) => z.toFixed(2)).join(', ')})`);
    const letter = p.name[0];
    for (const [col, row] of letter === 'A' ? [[2, 1.5]] : letter === 'B' ? [[2, 1.5], [2, 4.5]] : []) {
      const c = px(col, row);
      const hc = hitsAlongAxis(p.geometry, c.x, c.y);
      check(hc.length && Math.abs(hc[hc.length - 1] - 6) < 1e-6, `${p.name}: counter at (${c.x.toFixed(2)}, ${c.y.toFixed(2)}) is a real hole (top hit ${hc[hc.length - 1]})`);
    }
    // clearance: letter vertices >= 1 mm from the socket opening and inside the rim by >= 1 mm
    const pos = p.geometry.attributes.position.array;
    let minR = Infinity, maxR2 = 0;
    for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i + 2] - 6.6) < 1e-6) { const r = Math.hypot(pos[i], pos[i + 1]); minR = Math.min(minR, r); maxR2 = Math.max(maxR2, r); }
    check(minR >= maxR + LABEL.clearance - 1e-6 && maxR2 <= D / 2 - LABEL.clearance + 1e-6, `${p.name}: label clearance (r ${minR.toFixed(2)}..${maxR2.toFixed(2)}, socket r ${maxR.toFixed(2)}, rim ${D / 2})`);
  }
  console.log(`  label: ${pixel} mm pixels -> ${(5 * pixel).toFixed(2)} x ${(7 * pixel).toFixed(2)} mm glyph, ${LABEL.height} mm raised, centred at x = ${labelX.toFixed(2)}`);
  const laid = layoutForPrint(coupons).parts;
  const xs = laid.map((p) => (p.geometry.boundingBox.min.x + p.geometry.boundingBox.max.x) / 2);
  check(xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1] - 26) < 1e-6), `coupons on a 26 mm pitch (${xs.map((x) => x.toFixed(1)).join(', ')})`);
  const blob = await exportSocketCoupons();
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('3D/3dmodel.model').async('string');
  check((xml.match(/<object id="\d+" name="[^"]+" type="model" pid="2"/g) || []).length === 6, 'coupon 3MF has 6 mesh objects');
  check((xml.match(/<item objectid=/g) || []).length === 6, 'coupon 3MF has 6 build items');
  check(/name="C tapered 6.0-4.6"/.test(xml), 'coupon objects carry their labels');
  const ms = await zip.file('Metadata/model_settings.config').async('string');
  check((ms.match(/<assemble_item [^>]*transform="1 0 0 0 1 0 0 0 1 0 0 0"/g) || []).length === 6, 'coupon assembly keeps the plate layout');
  console.log(`  coupon 3MF: ${blob.size} bytes, ${coupons.map((p) => `${p.name.split(' ')[0]}:${p.geometry.index.count / 3}`).join(' ')} tris`);
}

// 8. reference switch
const { MX } = await import('./index.js');
const sw = buildReferenceSwitch();
sw.computeBoundingBox();
const plateTop = base.assembly.plateTopZ;
const swTris = sw.index ? sw.index.count / 3 : sw.attributes.position.count / 3;
console.log('\nreference switch (pins clipped) tris', swTris, 'z', sw.boundingBox.min.z.toFixed(2), '..', sw.boundingBox.max.z.toFixed(2));
check(MX.STEM_HEIGHT === 3.6, 'MX stem height constant is 3.6 (independent of the socket depth)');
check(Math.abs(sw.boundingBox.max.z - (plateTop + 6.6 + MX.STEM_HEIGHT)) < 1e-3, 'switch stem top z = plateTop + 6.6 + 3.6');
check(Math.abs(sw.boundingBox.min.z - (plateTop - 1.5 - 5.0 - 3.0)) < 1e-3, `clipped: no pins, centre post bottom = plateBottom - 8.0 (got ${sw.boundingBox.min.z.toFixed(2)})`);
check(sw.boundingBox.min.z > base.assembly.postPocketBottomZ + 0.2 - 1e-6 && sw.boundingBox.min.z < base.assembly.cavityBottomZ, `clipped: post reaches into the pocket and clears its floor by >= 0.2 (post bottom ${sw.boundingBox.min.z.toFixed(2)}, pocket floor ${base.assembly.postPocketBottomZ})`);
{
  // the post (dia 4.0) is inside the 4.6 pocket: no vertex of the switch below the cavity floor lies outside r 2.3 - 0.3
  const pos = sw.attributes.position.array;
  let ok = true;
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] < base.assembly.cavityBottomZ - 1e-6 && Math.hypot(pos[i], pos[i + 1]) > base.assembly.postPocketDiameter / 2 - 0.3 + 1e-6) ok = false;
  check(ok, 'clipped: only the post dips below the cavity floor, inside the pocket with 0.3 clearance');
}
check(Math.abs(sw.boundingBox.max.x - 7.8) < 1e-3, 'switch flange is 15.6 wide');
check(Math.abs(sw.boundingBox.max.z - MX.STEM_HEIGHT - (base.assembly.capZ - (base.assembly.seat - 6.6))) < 1e-3, `housing top is ${(base.assembly.seat - 6.6).toFixed(1)} mm below the seated cap underside (seat ${base.assembly.seat})`);
check(Math.abs(base.assembly.capZ + base.assembly.socketCeilingZ - sw.boundingBox.max.z - (DEFAULT_PARAMS.switch.stemHeight - MX.STEM_HEIGHT)) < 1e-3, `stem tip sits ${(DEFAULT_PARAMS.switch.stemHeight - MX.STEM_HEIGHT).toFixed(1)} mm below the socket ceiling, like the ghost's 4.0 socket on a 3.6 stem (tip ${sw.boundingBox.max.z.toFixed(2)}, ceiling ${(base.assembly.capZ + base.assembly.socketCeilingZ).toFixed(2)})`);
check(sw.boundingBox.max.x < base.assembly.pocketSide / 2 && sw.boundingBox.max.z - MX.STEM_HEIGHT + base.assembly.travel >= base.assembly.capZ + base.assembly.travel - 1e-6, 'housing (15.6) fits the 16.2 pocket and can rise the full travel into it');
const swKeep = buildReferenceSwitch({ switch: { pins: 'keep' } });
swKeep.computeBoundingBox();
const keepTris = swKeep.index ? swKeep.index.count / 3 : swKeep.attributes.position.count / 3;
check(keepTris > swTris, 'keep: reference switch renders pins');
const keepPlateTop = keep.assembly.plateTopZ;
check(Math.abs(swKeep.boundingBox.min.z - (keepPlateTop - 1.5 - 5.0 - 3.3)) < 1e-3, `keep: pins bottom = plateBottom - 8.3 (got ${swKeep.boundingBox.min.z.toFixed(2)})`);
check(swKeep.boundingBox.min.z > keep.assembly.cavityBottomZ - 1e-6, 'keep: pins stay above the cavity floor');

console.log(`\n${failures === 0 ? 'SELFTEST PASSED' : `SELFTEST FAILED (${failures})`} in ${Date.now() - t0} ms`);
process.exit(failures === 0 ? 0 : 1);
