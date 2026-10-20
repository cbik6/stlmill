// Design sources -> DesignSpec.
//
// DesignSpec = {
//   shapes: THREE.Shape[]   polyline shapes with holes, arbitrary units, +Y up
//   bbox: { minX, minY, maxX, maxY }
//   previewDataUrl?: string  PNG of the traced mask (black design on white)
//   warnings: string[]       (extra, optional for consumers)
// }
//
// Every source (text, SVG, image) goes through the same path:
//   render/rasterize -> binary mask (y-up) -> traceBitmap -> shapes.
// That makes overlapping SVG paths, strokes, anti-aliased text and noisy images all
// produce clean, non-overlapping contours with correct holes.

import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { traceBitmap, shapesBBox } from './trace.js';
import {
  rasterizeShapes,
  rasterizeTriangles,
  floodBackground,
  flipMaskY,
  majorityFilter,
} from './raster.js';

const WORK_RES = 1024; // px on the long side

function createCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('No canvas available in this environment');
}

function maskToDataUrl(mask, w, h) {
  try {
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w; // mask is y-up, canvas is y-down
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const v = mask[srcRow + x] ? 0 : 255;
        d[o] = v;
        d[o + 1] = v;
        d[o + 2] = v;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (typeof c.toDataURL === 'function') return c.toDataURL('image/png');
  } catch (_) {
    /* preview is optional */
  }
  return undefined;
}

function finishSpec(mask, w, h, warnings, traceOptions = {}) {
  const shapes = traceBitmap(mask, w, h, traceOptions);
  if (shapes.length === 0) warnings.push('Design is empty: nothing was traced from the source.');
  const bbox = shapesBBox(shapes);
  return { shapes, bbox, previewDataUrl: maskToDataUrl(mask, w, h), warnings };
}

/** Build a y-up mask from canvas RGBA by luminance threshold (dark pixels = design). */
function maskFromLuminance(rgba, w, h, threshold) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const lum = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
      m[row + x] = lum < threshold ? 1 : 0;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Render text with a CSS font to an offscreen canvas and trace it.
 * options: { fontFamily='Arial', weight='700', size (ignored for geometry; kept for API parity) }
 * Supports multi-line text with '\n'.
 */
export async function makeDesignFromText(text, { fontFamily = 'Arial', weight = '700', size } = {}) {
  const warnings = [];
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  if (lines.every((l) => l.trim() === '')) {
    return { shapes: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, warnings: ['Text is empty.'] };
  }
  const family = /[\s"']/.test(fontFamily) && !/^["']/.test(fontFamily) ? `"${fontFamily}"` : fontFamily;
  const fontAt = (px) => `${weight} ${px}px ${family}`;

  if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
    try {
      await document.fonts.load(fontAt(100), lines.join(''));
    } catch (_) {
      /* ignore - fall back to whatever the browser substitutes */
    }
  }

  // measure at a reference size
  const probe = createCanvas(16, 16).getContext('2d');
  probe.font = fontAt(100);
  probe.textBaseline = 'alphabetic';
  const lineGap = 1.15;
  let maxW = 0;
  let ascent = 0;
  let descent = 0;
  const metrics = lines.map((l) => probe.measureText(l || ' '));
  for (const m of metrics) {
    const w = Math.max(m.width, (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0));
    if (w > maxW) maxW = w;
    ascent = Math.max(ascent, m.actualBoundingBoxAscent ?? 80);
    descent = Math.max(descent, m.actualBoundingBoxDescent ?? 20);
  }
  const totalH = ascent + descent + (lines.length - 1) * 100 * lineGap;
  const scale = (WORK_RES - 32) / Math.max(maxW, totalH, 1);
  const px = Math.max(8, Math.min(4096, 100 * scale));
  const pad = 16;
  const w = Math.ceil(maxW * scale) + pad * 2;
  const h = Math.ceil(totalH * scale) + pad * 2;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.font = fontAt(px);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  let baseline = pad + ascent * scale;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], w / 2, baseline);
    baseline += px * lineGap;
  }
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const mask = maskFromLuminance(rgba, w, h, 128);
  // Check the font actually rendered something; a glyphless font gives an empty mask.
  return finishSpec(mask, w, h, warnings, { simplifyTolerance: 0.6, cornerAngle: 45 });
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

/**
 * Parse SVG markup with three's SVGLoader, rasterize fills (fill-rule aware via
 * SVGLoader.createShapes) and strokes (SVGLoader.pointsToStroke), then trace.
 */
export async function makeDesignFromSvg(svgText) {
  const warnings = [];
  const loader = new SVGLoader();
  let data;
  try {
    data = loader.parse(svgText);
  } catch (e) {
    throw new Error('Could not parse SVG: ' + (e && e.message ? e.message : e));
  }
  const fills = []; // THREE.Shape[] in SVG (y-down) units
  const strokeTris = []; // flat triangles in SVG units
  for (const path of data.paths) {
    const style = path.userData && path.userData.style ? path.userData.style : {};
    const fill = style.fill;
    const hasFill = fill !== undefined && fill !== 'none' && fill !== 'transparent' && (style.fillOpacity ?? 1) > 0;
    const stroke = style.stroke;
    const hasStroke =
      stroke !== undefined && stroke !== 'none' && stroke !== 'transparent' &&
      (style.strokeWidth ?? 0) > 0 && (style.strokeOpacity ?? 1) > 0;
    if (hasFill) {
      try {
        fills.push(...SVGLoader.createShapes(path));
      } catch (_) {
        warnings.push('An SVG path could not be converted to a fill and was skipped.');
      }
    }
    if (hasStroke) {
      for (const sub of path.subPaths) {
        const pts = sub.getPoints();
        const g = SVGLoader.pointsToStroke(pts, style, 12, 0.001);
        if (g) {
          const pos = g.getAttribute('position').array;
          for (let i = 0; i < pos.length; i += 9) {
            strokeTris.push(pos[i], pos[i + 1], pos[i + 3], pos[i + 4], pos[i + 6], pos[i + 7]);
          }
        }
      }
    }
    if (!hasFill && !hasStroke) warnings.push('An SVG path with no fill and no stroke was ignored.');
  }
  if (fills.length === 0 && strokeTris.length === 0) {
    return { shapes: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, warnings: [...warnings, 'SVG contains no fillable paths.'] };
  }

  // bounds in SVG units
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const fillPts = fills.map((s) => s.extractPoints(12));
  for (const fp of fillPts) {
    for (const poly of [fp.shape, ...fp.holes]) {
      for (const p of poly) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
    }
  }
  for (let i = 0; i < strokeTris.length; i += 2) {
    const x = strokeTris[i], y = strokeTris[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const k = (WORK_RES - 8) / Math.max(spanX, spanY);
  const w = Math.ceil(spanX * k) + 8;
  const h = Math.ceil(spanY * k) + 8;
  // SVG y-down -> engine y-up pixel space
  const tx = (x) => (x - minX) * k + 4;
  const ty = (y) => (maxY - y) * k + 4;

  const mask = new Uint8Array(w * h);
  const toPx = (poly) => poly.map((p) => ({ x: tx(p.x), y: ty(p.y) }));
  for (const fp of fillPts) {
    const polys = [toPx(fp.shape), ...fp.holes.map(toPx)];
    // even-odd within a shape (outer + holes), OR across shapes
    rasterizeShapes([shapeFromPolys(polys)], w, h, mask, 1);
  }
  if (strokeTris.length) {
    const tris = new Float64Array(strokeTris.length);
    for (let i = 0; i < strokeTris.length; i += 2) {
      tris[i] = tx(strokeTris[i]);
      tris[i + 1] = ty(strokeTris[i + 1]);
    }
    rasterizeTriangles(tris, w, h, mask);
  }
  return finishSpec(mask, w, h, warnings, { simplifyTolerance: 0.6, cornerAngle: 45 });
}

function shapeFromPolys(polys) {
  const s = new THREE.Shape(polys[0].map((p) => new THREE.Vector2(p.x, p.y)));
  for (let i = 1; i < polys.length; i++) {
    s.holes.push(new THREE.Path(polys[i].map((p) => new THREE.Vector2(p.x, p.y))));
  }
  return s;
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

/**
 * Trace a raster image.
 *   threshold        luminance (or alpha) cut-off 0..255; darker (or more opaque) = design
 *   invert           swap design/background
 *   removeBackground flood-fill near-uniform colour from the corners and drop it (tolerance 40/255)
 *   smoothing        iterations of a 3x3 majority filter (0 = off)
 */
export async function makeDesignFromImage(
  imageSource,
  { threshold = 128, invert = false, removeBackground = true, smoothing = 1 } = {},
) {
  const warnings = [];
  const srcW = imageSource.naturalWidth || imageSource.videoWidth || imageSource.width;
  const srcH = imageSource.naturalHeight || imageSource.videoHeight || imageSource.height;
  if (!srcW || !srcH) throw new Error('Image has no size (is it loaded?)');
  const k = Math.min(1, WORK_RES / Math.max(srcW, srcH));
  const w = Math.max(2, Math.round(srcW * k));
  const h = Math.max(2, Math.round(srcH * k));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imageSource, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;

  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 250) {
      hasAlpha = true;
      break;
    }
  }

  // y-down working mask, flipped at the end
  let m = new Uint8Array(w * h);
  if (hasAlpha) {
    for (let p = 0; p < w * h; p++) m[p] = rgba[p * 4 + 3] >= threshold ? 1 : 0;
  } else {
    for (let p = 0; p < w * h; p++) {
      const o = p * 4;
      const lum = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
      m[p] = lum < threshold ? 1 : 0;
    }
  }
  if (invert) for (let p = 0; p < m.length; p++) m[p] ^= 1;
  if (removeBackground) {
    const bg = floodBackground(rgba, w, h, 40);
    let bgCount = 0;
    for (let p = 0; p < m.length; p++) {
      if (bg[p]) {
        m[p] = 0;
        bgCount++;
      }
    }
    if (bgCount > 0.98 * m.length) warnings.push('Background removal removed almost the whole image; try disabling it or adjusting the threshold.');
  }
  let mask = flipMaskY(m, w, h);
  if (smoothing > 0) mask = majorityFilter(mask, w, h, Math.min(5, Math.round(smoothing)));

  let filled = 0;
  for (let p = 0; p < mask.length; p++) filled += mask[p];
  if (filled === 0) warnings.push('Image produced an empty design; try "invert" or a different threshold.');
  else if (filled > 0.9 * mask.length) warnings.push('Design covers almost the entire image; you may want "invert".');

  return finishSpec(mask, w, h, warnings, { simplifyTolerance: 1.0, cornerAngle: 60, minArea: 6 });
}

/**
 * Convert any THREE.Shape[] (possibly with curves) into a DesignSpec without rasterizing.
 * Useful for synthetic shapes and tests.
 */
export function makeDesignFromShapes(shapes, curveSegments = 24) {
  const poly = shapes.map((s) => {
    const pts = s.extractPoints(curveSegments);
    const out = new THREE.Shape(pts.shape);
    for (const hole of pts.holes) out.holes.push(new THREE.Path(hole));
    return out;
  });
  return { shapes: poly, bbox: shapesBBox(poly), warnings: [] };
}
