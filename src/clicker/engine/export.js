// 3MF (multi-object, per-object colour) and binary STL (zipped) exporters.
// Both return a Blob. Units: mm, Z up, as produced by buildClicker.

import JSZip from 'jszip';

const THREEMF_MIME = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';

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
  return { xml: `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`, triangles: tris.length };
}

/** Full 3dmodel.model XML as a string (exported for tests). */
export function buildThreeMFModelXml(parts, { name = 'clicker' } = {}) {
  const bases = parts.map((p) => `<base name="${xmlEscape(p.name)}" displaycolor="${normalizeColor(p.color)}FF"/>`);
  const objects = [];
  const items = [];
  parts.forEach((p, i) => {
    const id = i + 2;
    const mesh = meshXml(p.geometry);
    objects.push(`<object id="${id}" name="${xmlEscape(p.name)}" type="model" pid="1" pindex="${i}">${mesh.xml}</object>`);
    items.push(`<item objectid="${id}" partnumber="${xmlEscape(p.name)}"/>`);
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">${xmlEscape(name)}</metadata>` +
    `<metadata name="Application">Clicker Forge</metadata>` +
    `<metadata name="Designer">Clicker Forge</metadata>` +
    `<resources><basematerials id="1">${bases.join('')}</basematerials>${objects.join('')}</resources>` +
    `<build>${items.join('')}</build>` +
    `</model>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="model" ContentType="${THREEMF_MIME}"/>` +
  `</Types>`;

const RELS =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
  `</Relationships>`;

/** 3MF Blob: one <object> per part, each with its own basematerial colour. */
export async function exportThreeMF(parts, { name = 'clicker' } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('3D/3dmodel.model', buildThreeMFModelXml(parts, { name }));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return new Blob([bytes], { type: THREEMF_MIME });
}

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

/** Zip Blob with one binary STL per part (<name>-<part>.stl). */
export async function exportStlZip(parts, { name = 'clicker' } = {}) {
  const zip = new JSZip();
  const safe = String(name).replace(/[^\w.-]+/g, '_') || 'clicker';
  for (const p of parts) zip.file(`${safe}-${p.name}.stl`, geometryToStl(p.geometry, `${safe} ${p.name}`));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return new Blob([bytes], { type: 'application/zip' });
}
