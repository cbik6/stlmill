// Print layout + 3MF (multi-object, slicer-aware colours) and binary STL (zipped) exporters.
// Units: mm, Z up. Both exporters bake the print layout into the vertices (layoutForPrint);
// the viewer keeps using the build frames + assembly.capZ and never calls layoutForPrint.

import * as THREE from 'three';
import JSZip from 'jszip';

const THREEMF_MIME = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
const EXTRUDER_BY_PART = { body: 1, cap: 2, design: 3 };

function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

function normalizeColor(hex, fallback = '#808080') {
  let c = (hex || fallback).trim();
  if (!/^#?[0-9a-fA-F]{6}$/.test(c)) c = fallback;
  if (c[0] !== '#') c = '#' + c;
  return c.toUpperCase();
}

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

// ---------------------------------------------------------------------------------------------
// Print layout
// ---------------------------------------------------------------------------------------------

function bboxOf(positions) {
  const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
    if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

/** Copy of the positions (Float64) with an optional 180 deg flip about X (y -> -y, z -> -z). */
function flippedPositions(geometry, flipX) {
  const src = geometry.attributes.position.array;
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i];
    out[i + 1] = flipX ? -src[i + 1] : src[i + 1];
    out[i + 2] = flipX ? -src[i + 2] : src[i + 2];
  }
  return out;
}

/**
 * Lay the parts out on the print plate and bake the transforms into vertex copies.
 * Accepts a buildClicker result or its `parts` array. Uses each part's `print` placement
 * ({ x, y, flipX, follow }) written by buildClicker; parts without one are placed side by side.
 * Every part is translated so its own min z == 0, except a part that `follow`s another
 * (the design filler / relief), which gets exactly the transform of the part it follows so it
 * stays registered with the cap.
 * Returns { parts: [{ name, geometry, color }], warnings }.
 */
export function layoutForPrint(resultOrParts) {
  const parts = Array.isArray(resultOrParts) ? resultOrParts : resultOrParts.parts;
  const warnings = [];
  const transforms = new Map(); // name -> { flipX, dx, dy, dz }
  const out = [];
  let cursorX = 0;

  const place = (part) => {
    const print = part.print || {};
    const pos = flippedPositions(part.geometry, !!print.flipX);
    const b = bboxOf(pos);
    let dx, dy, dz;
    if (print.follow && transforms.has(print.follow)) {
      const tf = transforms.get(print.follow);
      if (!!print.flipX !== tf.flipX) {
        // follow implies the same orientation; re-flip to match
        const pos2 = flippedPositions(part.geometry, tf.flipX);
        pos.set(pos2);
      }
      ({ dx, dy, dz } = tf);
    } else if (part.print) {
      dx = print.x - (b.minX + b.maxX) / 2;
      dy = (print.y || 0) - (b.minY + b.maxY) / 2;
      dz = -b.minZ;
    } else {
      // generic fallback: side by side along +X with a 6 mm gap, resting on the plate
      dx = cursorX - b.minX;
      dy = -(b.minY + b.maxY) / 2;
      dz = -b.minZ;
      cursorX += b.maxX - b.minX + 6;
    }
    transforms.set(part.name, { flipX: !!print.flipX, dx, dy, dz });
    const baked = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      baked[i] = pos[i] + dx;
      baked[i + 1] = pos[i + 1] + dy;
      baked[i + 2] = pos[i + 2] + dz;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(baked, 3));
    if (part.geometry.index) g.setIndex(part.geometry.index.clone());
    if (print.flipX) {
      // a reflection of two axes is a proper rotation, so winding stays correct
    }
    g.computeVertexNormals();
    g.computeBoundingBox();
    return { name: part.name, geometry: g, color: part.color };
  };

  // place followed parts first (cap before design)
  const ordered = parts.slice().sort((a, b) => {
    const fa = a.print && a.print.follow ? 1 : 0;
    const fb = b.print && b.print.follow ? 1 : 0;
    return fa - fb;
  });
  const placed = new Map();
  for (const p of ordered) placed.set(p, place(p));
  for (const p of parts) out.push(placed.get(p));

  const hasRaised = parts.some((p) => p.name === 'design' && p.print && !p.print.flipX);
  if (hasRaised) warnings.push('Raised designs print cap-up and need supports under the cap; use Inlay for a flat, two-colour cap.');
  // Baked transform per part: p_print = F(p_built) + d, F = diag(1, -1, -1) when flipX else identity
  for (const p of out) p.bake = transforms.get(p.name);
  return { parts: out, warnings, transforms };
}

/**
 * Assembly pose for a baked part: p_assembled = F(p_print - d) + (0, 0, assembleZ), i.e. undo the
 * print bake (F is its own inverse) and lift the part to its assembled height in the body frame.
 * Returned in the 3MF core `transform` layout (row-vector convention, 3x3 rotation rows then
 * translation): "m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz".
 */
export function assembleTransform(bake, assembleZ = 0) {
  if (!bake) return IDENTITY;
  const s = bake.flipX ? -1 : 1;
  const tx = -bake.dx;
  const ty = -s * bake.dy;
  const tz = -s * bake.dz + assembleZ;
  return `1 0 0 0 ${s} 0 0 0 ${s} ${fmt(tx)} ${fmt(ty)} ${fmt(tz)}`;
}

// ---------------------------------------------------------------------------------------------
// 3MF
// ---------------------------------------------------------------------------------------------

const fmt = (v) => {
  const r = Math.round(v * 10000) / 10000;
  return (Object.is(r, -0) ? 0 : r).toString();
};

/** Build the mesh XML for one geometry with vertices deduplicated at 1e-4 mm. */
function meshXml(geometry) {
  const verts = [];
  const map = new Map();
  const tris = [];
  const vid = (x, y, z) => {
    const key = `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length;
      verts.push(`<vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`);
      map.set(key, id);
    }
    return id;
  };
  forEachTriangle(geometry, (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const a = vid(ax, ay, az);
    const b = vid(bx, by, bz);
    const c = vid(cx, cy, cz);
    if (a === b || b === c || a === c) return; // degenerate after snapping
    tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  });
  return { xml: `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`, triangles: tris.length, vertices: verts.length };
}

const IDENTITY = '1 0 0 0 1 0 0 0 1 0 0 0';

/**
 * Describe the objects written to the 3MF: [{ id, name, color, extruder, triangles, vertices }].
 * Resource ids: 1 = basematerials, 2 = m:colorgroup, objects from 3.
 */
function describeObjects(parts) {
  return parts.map((p, i) => ({
    id: i + 3,
    index: i,
    name: p.name,
    color: normalizeColor(p.color),
    extruder: EXTRUDER_BY_PART[p.name] || 1,
    part: p,
  }));
}

/**
 * Group mesh objects into the top-level objects placed in the build:
 *   body            -> its own object (id 3)
 *   cap + design    -> ONE composite object (id 6, name "cap") with two components, so slicers
 *                      keep the inlay filler / relief registered inside the cap instead of
 *                      auto-arranging it as a separate object
 *   cap alone       -> plain mesh object (engraved / no design)
 * Returns [{ id, name, parts: [meshObject...] }].
 */
function groupBuildObjects(objs) {
  const cap = objs.find((o) => o.name === 'cap');
  const design = objs.find((o) => o.name === 'design');
  const groups = [];
  for (const o of objs) {
    if (o === design && cap) continue;
    if (o === cap && design) groups.push({ id: COMPOSITE_ID, name: 'cap', parts: [cap, design], composite: true });
    else groups.push({ id: o.id, name: o.name, parts: [o], composite: false });
  }
  return groups;
}
const COMPOSITE_ID = 6;

/**
 * Full 3dmodel.model XML as a string; also returns the mesh objects (with stats) and the
 * top-level build objects (exported for tests).
 */
export function buildThreeMFModel(parts, { name = 'clicker' } = {}) {
  const objs = describeObjects(parts);
  const bases = objs.map((o) => `<base name="${xmlEscape(o.name)}" displaycolor="${o.color}FF"/>`);
  const colors = objs.map((o) => `<m:color color="${o.color}FF"/>`);
  const objects = [];
  for (const o of objs) {
    const mesh = meshXml(o.part.geometry);
    o.triangles = mesh.triangles;
    o.vertices = mesh.vertices;
    objects.push(`<object id="${o.id}" name="${xmlEscape(o.name)}" type="model" pid="2" pindex="${o.index}">${mesh.xml}</object>`);
  }
  const groups = groupBuildObjects(objs);
  const items = [];
  for (const g of groups) {
    if (g.composite) {
      // components share the baked print frame, so no component transforms
      const comps = g.parts.map((p) => `<component objectid="${p.id}"/>`).join('');
      objects.push(`<object id="${g.id}" name="${xmlEscape(g.name)}" type="model"><components>${comps}</components></object>`);
    }
    items.push(`<item objectid="${g.id}" transform="${IDENTITY}" partnumber="${xmlEscape(g.name)}"/>`);
  }
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">` +
    `<metadata name="Title">${xmlEscape(name)}</metadata>` +
    `<metadata name="Application">Clicker Forge</metadata>` +
    `<metadata name="Designer">Clicker Forge</metadata>` +
    `<resources>` +
    `<basematerials id="1">${bases.join('')}</basematerials>` +
    `<m:colorgroup id="2">${colors.join('')}</m:colorgroup>` +
    `${objects.join('')}` +
    `</resources>` +
    `<build>${items.join('')}</build>` +
    `</model>`;
  const meshObjects = objs.map(({ part, ...rest }) => rest);
  const byId = new Map(meshObjects.map((o) => [o.id, o]));
  const buildObjects = groups.map((g) => ({ id: g.id, name: g.name, composite: g.composite, parts: g.parts.map((p) => byId.get(p.id)) }));
  return { xml, objects: meshObjects, buildObjects };
}

/** Backwards-compatible: model XML only. */
export function buildThreeMFModelXml(parts, opts) {
  return buildThreeMFModel(parts, opts).xml;
}

/**
 * PrusaSlicer per-object/volume metadata (extruder per volume). One <object> per build object;
 * a composite object's volumes span its components' triangles concatenated in component order
 * (triangle ids are per-object, 0-based).
 */
export function buildPrusaConfig(buildObjects) {
  const body = buildObjects
    .map((g) => {
      let first = 0;
      const volumes = g.parts
        .map((p) => {
          const last = first + Math.max(1, p.triangles) - 1;
          const v =
            `    <volume firstid="${first}" lastid="${last}">\n` +
            `      <metadata type="volume" key="name" value="${xmlEscape(p.name)}"/>\n` +
            `      <metadata type="volume" key="extruder" value="${p.extruder}"/>\n` +
            `    </volume>\n`;
          first = last + 1;
          return v;
        })
        .join('');
      return (
        `  <object id="${g.id}" instances_count="1">\n` +
        `    <metadata type="object" key="name" value="${xmlEscape(g.name)}"/>\n` +
        `    <metadata type="object" key="extruder" value="${g.parts[0].extruder}"/>\n` +
        volumes +
        `  </object>\n`
      );
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${body}</config>\n`;
}

/**
 * Bambu Studio / OrcaSlicer model settings: one <object> per build object with one <part> per
 * mesh. `assembleTransforms` (Map buildObjectId -> 12-number transform) gives the Assembly View
 * pose of each object relative to the baked print placement; defaults to identity.
 */
export function buildBambuModelSettings(buildObjects, assembleTransforms = new Map()) {
  const objects = buildObjects;
  const objs = objects
    .map(
      (g) =>
        `  <object id="${g.id}">\n` +
        `    <metadata key="name" value="${xmlEscape(g.name)}"/>\n` +
        `    <metadata key="extruder" value="${g.parts[0].extruder}"/>\n` +
        g.parts
          .map(
            (p) =>
              `    <part id="${p.id}" subtype="normal_part">\n` +
              `      <metadata key="name" value="${xmlEscape(p.name)}"/>\n` +
              `      <metadata key="extruder" value="${p.extruder}"/>\n` +
              `      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n` +
              `      <mesh_stat face_count="${p.triangles}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n` +
              `    </part>\n`,
          )
          .join('') +
        `  </object>\n`,
    )
    .join('');
  const instances = objects
    .map(
      (o) =>
        `    <model_instance>\n` +
        `      <metadata key="object_id" value="${o.id}"/>\n` +
        `      <metadata key="instance_id" value="0"/>\n` +
        `      <metadata key="identify_id" value="${o.id * 100}"/>\n` +
        `    </model_instance>\n`,
    )
    .join('');
  const assemble = objects
    .map((o) => `    <assemble_item object_id="${o.id}" instance_id="0" transform="${assembleTransforms.get(o.id) || IDENTITY}" offset="0 0 0"/>\n`)
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${objs}` +
    `  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n${instances}  </plate>\n` +
    `  <assemble>\n${assemble}  </assemble>\n</config>\n`
  );
}

/** Bambu Studio / OrcaSlicer project settings: filament colours by extruder index. */
export function buildBambuProjectSettings(objects) {
  const colours = [];
  for (const o of objects) colours[o.extruder - 1] = o.color;
  for (let i = 0; i < colours.length; i++) if (!colours[i]) colours[i] = '#808080';
  return JSON.stringify(
    {
      filament_colour: colours,
      filament_type: colours.map(() => 'PLA'),
      version: '01.00.00.00',
    },
    null,
    2,
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="model" ContentType="${THREEMF_MIME}"/>` +
  `<Override PartName="/Metadata/Slic3r_PE_model.config" ContentType="text/xml"/>` +
  `<Override PartName="/Metadata/model_settings.config" ContentType="text/xml"/>` +
  `<Override PartName="/Metadata/project_settings.config" ContentType="application/json"/>` +
  `</Types>`;

const RELS =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
  `</Relationships>`;

/**
 * 3MF Blob with the print layout baked in: one <object> per part, colours as basematerials +
 * Materials-extension colorgroup, plus PrusaSlicer and Bambu/Orca metadata (extruders 1/2/3).
 */
export async function exportThreeMF(resultOrParts, { name = 'clicker' } = {}) {
  const srcParts = Array.isArray(resultOrParts) ? resultOrParts : resultOrParts.parts;
  const assembly = Array.isArray(resultOrParts) ? null : resultOrParts.assembly;
  const { parts } = layoutForPrint(resultOrParts);
  const { xml, objects, buildObjects } = buildThreeMFModel(parts, { name });
  // Assembly View poses: undo the print bake and lift each object to its assembled height
  // (body at the origin; cap composite with its bottom face at assembly.capZ, centred on the body).
  const assembleTransforms = new Map();
  for (const g of buildObjects) {
    const lead = g.parts[0];
    const laid = parts.find((p) => p.name === lead.name);
    const src = srcParts.find((p) => p.name === lead.name);
    if (src && src.print && src.print.keepLayoutInAssembly) {
      assembleTransforms.set(g.id, IDENTITY); // e.g. test coupons: assembly == plate layout
      continue;
    }
    let z = src && src.print && typeof src.print.assembleZ === 'number' ? src.print.assembleZ : 0;
    if (!z && lead.name !== 'body' && assembly && typeof assembly.capZ === 'number') z = assembly.capZ;
    assembleTransforms.set(g.id, assembleTransform(laid && laid.bake, z));
  }
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('3D/3dmodel.model', xml);
  zip.file('Metadata/Slic3r_PE_model.config', buildPrusaConfig(buildObjects));
  zip.file('Metadata/model_settings.config', buildBambuModelSettings(buildObjects, assembleTransforms));
  zip.file('Metadata/project_settings.config', buildBambuProjectSettings(objects));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return new Blob([bytes], { type: THREEMF_MIME });
}

// ---------------------------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------------------------

/** Binary STL (80-byte header) of one geometry as an ArrayBuffer. */
export function geometryToStl(geometry, header = 'Clicker Forge binary STL') {
  const index = geometry.index;
  const triCount = index ? index.count / 3 : geometry.attributes.position.count / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const hdr = new Uint8Array(buffer, 0, 80);
  for (let i = 0; i < Math.min(80, header.length); i++) hdr[i] = header.charCodeAt(i) & 0x7f;
  view.setUint32(80, triCount, true);
  let off = 84;
  forEachTriangle(geometry, (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    view.setFloat32(off, nx, true); view.setFloat32(off + 4, ny, true); view.setFloat32(off + 8, nz, true);
    view.setFloat32(off + 12, ax, true); view.setFloat32(off + 16, ay, true); view.setFloat32(off + 20, az, true);
    view.setFloat32(off + 24, bx, true); view.setFloat32(off + 28, by, true); view.setFloat32(off + 32, bz, true);
    view.setFloat32(off + 36, cx, true); view.setFloat32(off + 40, cy, true); view.setFloat32(off + 44, cz, true);
    view.setUint16(off + 48, 0, true);
    off += 50;
  });
  return buffer;
}

/**
 * Zip Blob with one binary STL per part in print orientation. STL has no grouping, so the
 * design part is named after its relationship to the cap:
 *   clicker-body.stl, clicker-cap.stl, clicker-cap-inlay.stl (inlay filler) / clicker-cap-raised.stl (raised relief)
 */
export async function exportStlZip(resultOrParts, { name = 'clicker' } = {}) {
  const src = Array.isArray(resultOrParts) ? resultOrParts : resultOrParts.parts;
  const { parts } = layoutForPrint(resultOrParts);
  const zip = new JSZip();
  parts.forEach((p, i) => {
    const print = (src[i] && src[i].print) || {};
    const file = p.name === 'design' ? (print.flipX === false ? 'clicker-cap-raised.stl' : 'clicker-cap-inlay.stl') : `clicker-${p.name}.stl`;
    zip.file(file, geometryToStl(p.geometry, `${name} ${p.name}`));
  });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return new Blob([bytes], { type: 'application/zip' });
}
