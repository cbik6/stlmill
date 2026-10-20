// Mesh input: STL / OBJ / 3MF (and bare Bambu `object_N.model` XML) -> one THREE.BufferGeometry.
//
//   loadMesh(data, { type, name }) -> { geometry, name, parts: [{ name, geometry, color }] }
//
//   data  ArrayBuffer | Uint8Array | string      (text is accepted for obj / model / ascii stl)
//   type  'stl' | 'obj' | '3mf' | 'model'        ('model' = a single Bambu/3MF object XML file)
//
// Multi-part inputs (OBJ groups, 3MF build items / components) are merged into one position-only
// geometry; `parts` keeps each source mesh with its material colour (hex) when the file had one.
// All geometry is returned as given (units assumed mm, Z up); use normalizeCharacter() to centre
// and scale. Nothing here needs a DOM except the 3MF path, which needs a global DOMParser with
// querySelector / querySelectorAll (the browser has it; the selftest shims one with @xmldom/xmldom).

import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import JSZip from 'jszip';
import { triangleCount } from './meshcheck.js';

const textDecoder = new TextDecoder();

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data).buffer;
  throw new Error('loadMesh: unsupported data type');
}
function toText(data) {
  return typeof data === 'string' ? data : textDecoder.decode(toArrayBuffer(data));
}

/** Position-only, non-indexed copy of a geometry with `matrix` baked in (normals/uvs dropped). */
function bakedPositions(geometry, matrix) {
  const g = new THREE.BufferGeometry();
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = src.attributes.position.clone();
  g.setAttribute('position', pos);
  if (matrix) g.applyMatrix4(matrix);
  return g;
}

function colorOfMaterial(material) {
  const m = Array.isArray(material) ? material[0] : material;
  if (m && m.color && typeof m.color.getHexString === 'function') return '#' + m.color.getHexString();
  return undefined;
}

/** Collect every Mesh in an Object3D tree as a part with its world transform baked in. */
function partsFromObject(root, fallbackName) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const g = bakedPositions(o.geometry, o.matrixWorld);
    if (triangleCount(g) === 0) return;
    parts.push({ name: o.name || `${fallbackName}-${parts.length + 1}`, geometry: g, color: colorOfMaterial(o.material) });
  });
  return parts;
}

/**
 * Minimal parser for one 3MF model XML file (the core <mesh><vertices>/<triangles> schema; this is
 * what Bambu Studio writes into 3D/Objects/object_N.model). Returns [{ name, geometry }] for every
 * <object> that carries a mesh. paint_color / material attributes are ignored.
 */
export function parseModelXmlObjects(xml, fallbackName = 'object') {
  const out = [];
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = objRe.exec(xml))) {
    const attrs = m[1];
    const body = m[2];
    const meshStart = body.indexOf('<mesh');
    if (meshStart < 0) continue;
    const nameM = /\bname="([^"]*)"/.exec(attrs);
    const idM = /\bid="([^"]*)"/.exec(attrs);
    const verts = [];
    const vRe = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g;
    let v;
    while ((v = vRe.exec(body))) verts.push(+v[1], +v[2], +v[3]);
    const tris = [];
    const tRe = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
    let t;
    while ((t = tRe.exec(body))) tris.push(+t[1], +t[2], +t[3]);
    if (!tris.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(verts), 3));
    g.setIndex(new THREE.Uint32BufferAttribute(Uint32Array.from(tris), 1));
    out.push({ name: nameM ? nameM[1] : `${fallbackName}${idM ? '-' + idM[1] : ''}`, geometry: g });
  }
  return out;
}

/** Bare Bambu object file -> { geometry, name, parts }. */
export function parseBambuModel(xml, name = 'object') {
  const parts = parseModelXmlObjects(xml, name).map((p) => ({ ...p, color: undefined }));
  return finish(parts, name);
}

function finish(parts, name) {
  if (!parts.length) throw new Error(`"${name}" contains no triangles.`);
  const geometry = parts.length === 1 ? parts[0].geometry : mergeGeometries(parts.map((p) => (p.geometry.index ? p.geometry.toNonIndexed() : p.geometry)), false);
  geometry.computeBoundingBox();
  return { geometry, name, parts };
}

async function load3mf(data, name) {
  let parts = [];
  try {
    const group = new ThreeMFLoader().parse(toArrayBuffer(data));
    parts = partsFromObject(group, name);
  } catch (e) {
    /* fall through to the raw scan */
  }
  if (!parts.length) {
    // Bambu / Orca project files reference 3D/Objects/*.model via the production extension, which
    // three's loader does not resolve. Scan every .model in the package for meshes instead.
    const zip = await JSZip.loadAsync(toArrayBuffer(data));
    const files = Object.keys(zip.files).filter((f) => /\.model$/i.test(f)).sort();
    for (const f of files) {
      const xml = await zip.file(f).async('string');
      for (const p of parseModelXmlObjects(xml, f.replace(/^.*\//, '').replace(/\.model$/i, ''))) parts.push({ ...p, color: undefined });
    }
  }
  return finish(parts, name);
}

/**
 * Parse a mesh file. `type` is required ('stl' | 'obj' | '3mf' | 'model'); `name` defaults to the type.
 */
export async function loadMesh(data, { type, name } = {}) {
  type = String(type || '').toLowerCase().replace(/^\./, '');
  name = name || type;
  switch (type) {
    case 'stl': {
      const g = new STLLoader().parse(toArrayBuffer(data));
      const part = { name, geometry: bakedPositions(g, null), color: undefined };
      return finish([part], name);
    }
    case 'obj': {
      const group = new OBJLoader().parse(toText(data));
      return finish(partsFromObject(group, name), name);
    }
    case '3mf':
      return load3mf(data, name);
    case 'model':
      return parseBambuModel(toText(data), name);
    default:
      throw new Error(`loadMesh: unsupported type "${type}" (use stl, obj, 3mf or model)`);
  }
}

/** Guess the loader type from a file name. */
export function typeFromFilename(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(filename || '');
  const ext = m ? m[1].toLowerCase() : '';
  return ['stl', 'obj', '3mf', 'model'].includes(ext) ? ext : null;
}
