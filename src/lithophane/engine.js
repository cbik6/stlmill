// Lithophane engine: a photo becomes a plate whose thickness follows the picture, so it shows
// the photo when lit from behind (thin = light, thick = dark).
//
// Algorithm carried over from Clark's earlier generator (cbik6/lithophane-generator): luminance
// grid -> midtone curve (gamma) -> thickness between min and max, optional bend from flat to a
// full cylinder, optional frame whose flat lip chamfers down into the picture. The mesh builder is
// new: one closed, welded, indexed shell (the old one was loose triangle soup).
//
// Frame of the part (mm, Z up), as it prints and as the viewer shows it: STANDING UPRIGHT.
//   x = across the picture (left of the photo at -x), z = up (top of the photo at z = height),
//   y = thickness: the flat/smooth back lies on y = 0 at the centre, the relief faces -y.
//   Curved plates bend about a vertical axis at (0, R): the relief is on the convex outside
//   (the side you look at), the light sits inside the curve.
//
//   resolveLayout(params, aspect)            -> { imgW, imgH, totalW, totalH, frameSide, frameTB, ... }
//   sampleSize(layout, params, maxPoints?)   -> { mmPerPx, imgCols, imgRows, frameCols, frameRows, gW, gH }
//   lumaFromImage(image, cols, rows)         -> Float32Array (0 dark .. 1 light), browser only
//   buildLithophane(luma, size, layout, params) -> { geometry, bounds, triangles }
//   exportStl(geometry, name)                -> ArrayBuffer (binary STL)

import * as THREE from 'three';

export const RESOLUTIONS = {
  draft: 0.4, // mm per sample: quick prints, small files
  standard: 0.25,
  fine: 0.15, // close to a 0.2 mm nozzle line; big files
};

export const DEFAULT_PARAMS = {
  height: 100, // mm, overall (frame included)
  minThickness: 0.8, // mm at the lightest pixels
  maxThickness: 3.0, // mm at the darkest pixels
  gamma: 1.0, // midtone curve: < 1 thinner midtones (brighter), > 1 thicker (darker)
  invert: false,
  curve: 0, // bend angle in degrees: 0 flat .. 360 closed cylinder
  frame: { enabled: true, side: 5, topBottom: 5, thickness: 5, chamfer: 45 },
  resolution: 'standard',
};

export const PREVIEW_MAX_POINTS = 360; // long side of the preview grid

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Clean, clamped copy of the params (min < max, frame thicker than the picture, sane angles). */
export function normalizeParams(p = {}) {
  const d = DEFAULT_PARAMS;
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
  const minT = clamp(num(p.minThickness, d.minThickness), 0.4, 5);
  const maxT = Math.max(clamp(num(p.maxThickness, d.maxThickness), 0.8, 8), minT + 0.2);
  const f = { ...d.frame, ...(p.frame || {}) };
  return {
    height: clamp(num(p.height, d.height), 20, 300),
    minThickness: minT,
    maxThickness: maxT,
    gamma: clamp(num(p.gamma, d.gamma), 0.2, 4),
    invert: !!p.invert,
    curve: clamp(num(p.curve, d.curve), 0, 360),
    frame: {
      enabled: !!f.enabled,
      side: clamp(num(f.side, d.frame.side), 1, 40),
      topBottom: clamp(num(f.topBottom, d.frame.topBottom), 1, 40),
      thickness: Math.max(clamp(num(f.thickness, d.frame.thickness), 1, 12), maxT),
      chamfer: clamp(num(f.chamfer, d.frame.chamfer), 10, 80),
    },
    resolution: RESOLUTIONS[p.resolution] ? p.resolution : d.resolution,
  };
}

export const isCylinder = (p) => p.curve >= 359.5;

/** Picture and overall size in mm for a photo of the given width/height aspect. */
export function resolveLayout(params, aspect) {
  const p = normalizeParams(params);
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const cyl = isCylinder(p);
  const frameTB = p.frame.enabled ? p.frame.topBottom : 0;
  const frameSide = p.frame.enabled && !cyl ? p.frame.side : 0; // a cylinder has no side edges
  const imgH = Math.max(5, p.height - 2 * frameTB);
  const imgW = imgH * a;
  const totalW = imgW + 2 * frameSide;
  return { params: p, aspect: a, cylinder: cyl, imgW, imgH, totalW, totalH: imgH + 2 * frameTB, frameSide, frameTB };
}

/** Grid size for a layout. maxPoints caps the long side (preview); omitted = full resolution. */
export function sampleSize(layout, maxPoints = Infinity) {
  let mm = RESOLUTIONS[layout.params.resolution];
  const longMm = Math.max(layout.totalW, layout.totalH);
  if (longMm / mm > maxPoints) mm = longMm / maxPoints;
  const imgCols = Math.max(3, Math.round(layout.imgW / mm)); // >= 3 so the back always has edge strips
  const imgRows = Math.max(2, Math.round(layout.imgH / mm));
  const frameCols = layout.frameSide > 0 ? Math.max(1, Math.round(layout.frameSide / mm)) : 0;
  const frameRows = layout.frameTB > 0 ? Math.max(1, Math.round(layout.frameTB / mm)) : 0;
  return { mmPerPx: mm, imgCols, imgRows, frameCols, frameRows, gW: imgCols + 2 * frameCols, gH: imgRows + 2 * frameRows };
}

/** Browser: draw the image at cols x rows and return its luminance (0 dark .. 1 light), row 0 = top. */
export function lumaFromImage(image, cols, rows) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(cols, rows) : Object.assign(document.createElement('canvas'), { width: cols, height: rows });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; // transparent pixels read as light (thin)
  ctx.fillRect(0, 0, cols, rows);
  ctx.drawImage(image, 0, 0, cols, rows);
  const px = ctx.getImageData(0, 0, cols, rows).data;
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  return out;
}

/** Frame thickness at distance d (mm) from the outer edge: flat lip, then a chamfer down to maxT. */
function frameThickness(d, frameWidth, p) {
  const outerT = p.frame.thickness;
  const innerT = p.maxThickness;
  const tan = Math.tan((p.frame.chamfer * Math.PI) / 180);
  const chamferW = (outerT - innerT) / tan;
  const lipW = Math.max(0, frameWidth - chamferW);
  if (d <= lipW) return outerT;
  return Math.max(innerT, outerT - (d - lipW) * tan);
}

/** Thickness per grid point (row 0 = top), frame included. */
export function thicknessGrid(luma, size, layout) {
  const p = layout.params;
  const { imgCols, imgRows, frameCols, frameRows, gW, gH } = size;
  const t = new Float32Array(gW * gH);
  const pitchX = layout.totalW / Math.max(1, gW - (layout.cylinder ? 0 : 1));
  const pitchZ = layout.totalH / Math.max(1, gH - 1);
  const span = p.maxThickness - p.minThickness;
  for (let r = 0; r < gH; r++) {
    for (let c = 0; c < gW; c++) {
      const ir = r - frameRows;
      const ic = c - frameCols;
      const inX = ic >= 0 && ic < imgCols;
      const inY = ir >= 0 && ir < imgRows;
      let v;
      if (inX && inY) {
        let l = luma ? luma[ir * imgCols + ic] : 0.5;
        if (p.invert) l = 1 - l;
        const cv = Math.pow(clamp(l, 0, 1), p.gamma);
        v = p.minThickness + (1 - cv) * span;
      } else {
        const tx = inX ? 0 : frameThickness((c < frameCols ? c : gW - 1 - c) * pitchX, layout.frameSide, p);
        const tz = inY ? 0 : frameThickness((r < frameRows ? r : gH - 1 - r) * pitchZ, layout.frameTB, p);
        v = Math.max(tx, tz);
      }
      t[r * gW + c] = v;
    }
  }
  return t;
}

/**
 * Closed, welded mesh. Front (relief) surface: one vertex per grid point. Back surface: straight
 * vertical lines (flat, or ruled on the bend), so it only needs the top and bottom rows, plus
 * every row on the left/right edge columns where the side walls attach. Returns
 * { geometry (indexed, attributes position + thickness), bounds {x,y,z}, triangles }.
 */
export function buildLithophane(luma, size, layout) {
  const p = layout.params;
  const { gW, gH } = size;
  const cyl = layout.cylinder;
  const curved = !cyl && p.curve >= 1;
  const tGrid = thicknessGrid(luma, size, layout);

  // column placement: angle (curved/cylinder) or x (flat)
  const alpha = cyl ? Math.PI * 2 : (p.curve * Math.PI) / 180;
  const R = cyl || curved ? layout.totalW / alpha : 0;
  const sinC = new Float64Array(gW);
  const cosC = new Float64Array(gW);
  const xC = new Float64Array(gW);
  for (let c = 0; c < gW; c++) {
    if (cyl) {
      const th = (c / gW) * alpha; // gW distinct columns around the circle, no duplicate seam column
      sinC[c] = Math.sin(th);
      cosC[c] = Math.cos(th);
    } else if (curved) {
      const th = (c / (gW - 1) - 0.5) * alpha;
      sinC[c] = Math.sin(th);
      cosC[c] = Math.cos(th);
    } else {
      xC[c] = (c / (gW - 1) - 0.5) * layout.totalW;
    }
  }
  const rowZ = new Float64Array(gH);
  for (let r = 0; r < gH; r++) rowZ[r] = (1 - r / (gH - 1)) * layout.totalH;

  // vertex layout: front grid, then back bottom row, back top row, back left/right interior rows
  const N = gW * gH;
  const sideRows = cyl ? 0 : gH - 2;
  const vCount = N + 2 * gW + 2 * sideRows;
  const pos = new Float32Array(vCount * 3);
  const thick = new Float32Array(vCount);
  const put = (i, c, z, t) => {
    let x;
    let y;
    if (cyl || curved) {
      const rho = R + t;
      x = rho * sinC[c];
      y = R - rho * cosC[c];
    } else {
      x = xC[c];
      y = -t;
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
  };
  const F = (r, c) => r * gW + c;
  const B = (r, c) => {
    if (r === gH - 1) return N + c; // bottom row (z = 0)
    if (r === 0) return N + gW + c; // top row
    if (c === 0) return N + 2 * gW + (r - 1); // left edge interior rows
    if (c === gW - 1) return N + 2 * gW + sideRows + (r - 1); // right edge interior rows
    throw new Error(`no back vertex at row ${r}, col ${c}`);
  };
  for (let r = 0; r < gH; r++) {
    for (let c = 0; c < gW; c++) {
      const t = tGrid[r * gW + c];
      put(F(r, c), c, rowZ[r], t);
      thick[F(r, c)] = t;
    }
  }
  for (let c = 0; c < gW; c++) {
    put(B(gH - 1, c), c, rowZ[gH - 1], 0);
    thick[B(gH - 1, c)] = tGrid[(gH - 1) * gW + c];
    put(B(0, c), c, rowZ[0], 0);
    thick[B(0, c)] = tGrid[c];
  }
  if (!cyl) {
    for (let r = 1; r < gH - 1; r++) {
      put(B(r, 0), 0, rowZ[r], 0);
      thick[B(r, 0)] = tGrid[r * gW];
      put(B(r, gW - 1), gW - 1, rowZ[r], 0);
      thick[B(r, gW - 1)] = tGrid[r * gW + gW - 1];
    }
  }

  // triangles (counter-clockwise seen from outside)
  const idx = [];
  const tri = (a, b, c) => idx.push(a, b, c);
  const quad = (a, b, c, d) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  const colsSpan = cyl ? gW : gW - 1;
  const next = (c) => (c + 1) % gW;
  // front relief, seen from -y: row r is above row r+1, column c left of c+1
  for (let r = 0; r < gH - 1; r++) for (let c = 0; c < colsSpan; c++) quad(F(r + 1, c), F(r + 1, next(c)), F(r, next(c)), F(r, c));
  // bottom and top walls
  for (let c = 0; c < colsSpan; c++) {
    quad(F(gH - 1, c), B(gH - 1, c), B(gH - 1, next(c)), F(gH - 1, next(c)));
    quad(F(0, c), F(0, next(c)), B(0, next(c)), B(0, c));
  }
  if (cyl) {
    // back: vertical strips all the way round
    for (let c = 0; c < gW; c++) quad(B(gH - 1, c), B(0, c), B(0, next(c)), B(gH - 1, next(c)));
  } else {
    // side walls (left at column 0, right at column gW-1)
    for (let r = 0; r < gH - 1; r++) {
      quad(F(r, 0), B(r, 0), B(r + 1, 0), F(r + 1, 0));
      quad(F(r, gW - 1), F(r + 1, gW - 1), B(r + 1, gW - 1), B(r, gW - 1));
    }
    // back: strips between interior columns are plain quads; the first and last strips fan
    // onto the edge columns' row vertices (the back is a ruled surface, so each strip is planar)
    for (let c = 1; c < gW - 2; c++) quad(B(gH - 1, c), B(0, c), B(0, c + 1), B(gH - 1, c + 1));
    // left strip: column 0 (all rows) to column 1 (top + bottom only)
    const lb = B(gH - 1, 1);
    const lt = B(0, 1);
    for (let r = 0; r < gH - 1; r++) tri(B(r + 1, 0), B(r, 0), lb);
    tri(B(0, 0), lt, lb);
    // right strip: column gW-2 (top + bottom) to column gW-1 (all rows)
    const rb = B(gH - 1, gW - 2);
    const rt = B(0, gW - 2);
    for (let r = 0; r < gH - 1; r++) tri(B(r, gW - 1), B(r + 1, gW - 1), rb);
    tri(rt, B(0, gW - 1), rb);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('thickness', new THREE.BufferAttribute(thick, 1));
  geometry.setIndex(vCount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  return {
    geometry,
    bounds: { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z },
    triangles: idx.length / 3,
  };
}

/** Binary STL of an indexed geometry, recentred so it stands on z = 0 at the plate centre. */
export function exportStl(geometry, name = 'lithophane') {
  const pos = geometry.attributes.position.array;
  const index = geometry.index.array;
  const n = index.length / 3;
  const bb = geometry.boundingBox || (geometry.computeBoundingBox(), geometry.boundingBox);
  const ox = (bb.min.x + bb.max.x) / 2;
  const oy = (bb.min.y + bb.max.y) / 2;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const header = `STLmill lithophane: ${name}`.slice(0, 79);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = index[t * 3] * 3;
    const b = index[t * 3 + 1] * 3;
    const c = index[t * 3 + 2] * 3;
    const ax = pos[a] - ox, ay = pos[a + 1] - oy, az = pos[a + 2];
    const bx = pos[b] - ox, by = pos[b + 1] - oy, bz = pos[b + 2];
    const cx = pos[c] - ox, cy = pos[c + 1] - oy, cz = pos[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const v of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      dv.setFloat32(o, v, true);
      o += 4;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}
