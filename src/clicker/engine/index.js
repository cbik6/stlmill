// Public API of the clicker geometry engine.
//
//   buildClicker(params)            -> { parts, bounds, warnings, assembly }
//   buildReferenceSwitch(params?)   -> THREE.BufferGeometry (simplified MX switch, body frame)
//   exportThreeMF(parts, { name })  -> Blob
//   exportStlZip(parts, { name })   -> Blob
//   makeDesignFromText / makeDesignFromSvg / makeDesignFromImage -> Promise<DesignSpec>
//
// Part  = { name: 'body'|'cap'|'design', geometry: THREE.BufferGeometry (mm, Z up), color: '#rrggbb' }
//   body   : rests on z = 0, centred on XY (the keychain ring, when enabled, is unioned into it).
//   cap    : bottom face z = 0, top face z = cap.thickness, stem socket down to -stemHeight.
//            The UI should place it at z = assembly.capZ (seated on the switch) in the body frame.
//   design : only for cap.designMode === 'raised'; same frame as the cap (z = thickness .. thickness+designHeight).
// bounds   = { x, y, z } mm extents of the body part.
// assembly = { plateTopZ, pocketHeight, capZ, bodyHeight, engraveDepth, capBounds: {x,y,z} }
//
// All heavy steps yield to the event loop so a UI spinner can animate; nothing runs in a worker.

import * as THREE from 'three';
import { computeLayout } from './outline.js';
import { resolveHeights, buildBody, buildCapParts, buildReferenceSwitchGeometry, triangleCount } from './solids.js';

export { exportThreeMF, exportStlZip } from './export.js';
export { makeDesignFromText, makeDesignFromSvg, makeDesignFromImage, makeDesignFromShapes } from './design.js';
export { traceBitmap } from './trace.js';
export { MX } from './solids.js';

export const DEFAULT_PARAMS = {
  design: { spec: null, fill: 100 /* % of the available area the design fills */, rotation: 0 /* deg CCW */ },
  base: { style: 'outline' /* 'outline'|'circle'|'square'|'hexagon' */, size: 35 /* longest side, mm */, margin: 2.5 /* padding between design and cap edge */, cornerRadius: 4 },
  cap: { thickness: 3, designHeight: 1.0, designMode: 'raised' /* 'raised'|'engraved' */ },
  // rimHeight 7.0: the MX upper housing stands 6.6 mm above the plate, so the cap's underside
  // seats 0.4 mm below the rim and is guided by the body wall. height 16.5 leaves an 8 mm pocket
  // (16.5 - 7.0 rim - 1.5 plate) for the 5 mm lower housing plus pins.
  body: { height: 16.5, rimHeight: 7.0, wall: 2.5 },
  switch: { cutout: 14, pocket: 15.6, plateThickness: 1.5, stemCrossWidth: 4.1, stemCrossThickness: 1.3, stemOuterDiameter: 5.5, stemHeight: 3.6 },
  keychain: { enabled: false, outerRadius: 4.5, innerRadius: 2.2, angle: 90 /* deg around the base; 90 = top (+Y) */ },
  fit: { clearance: 0.3 /* cap-to-recess gap per side */, switchTolerance: 0.15 /* added per side to the pocket */ },
  colors: { body: '#2b2b2b', cap: '#f5f5f5', design: '#f07a2a' },
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Deep-merge user params over DEFAULT_PARAMS (design.spec is passed through by reference). */
export function mergeParams(params = {}) {
  const merge = (def, usr) => {
    const out = { ...def };
    if (!usr) return out;
    for (const k of Object.keys(usr)) {
      const v = usr[k];
      if (v === undefined) continue;
      out[k] = isPlainObject(def[k]) && isPlainObject(v) && k !== 'spec' ? merge(def[k], v) : v;
    }
    return out;
  };
  const merged = merge(DEFAULT_PARAMS, params);
  // numeric sanitation: anything NaN/non-numeric falls back to the default
  for (const group of ['base', 'cap', 'body', 'switch', 'keychain', 'fit', 'design']) {
    for (const k of Object.keys(DEFAULT_PARAMS[group])) {
      const d = DEFAULT_PARAMS[group][k];
      if (typeof d === 'number') {
        const v = Number(merged[group][k]);
        merged[group][k] = Number.isFinite(v) ? v : d;
      }
    }
  }
  return merged;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function extents(geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
}

/**
 * Build all printable parts. Deterministic; yields between heavy steps.
 */
export async function buildClicker(userParams = {}) {
  const params = mergeParams(userParams);
  const warnings = [];
  const spec = params.design.spec;
  if (spec && Array.isArray(spec.warnings)) warnings.push(...spec.warnings);

  const layout = computeLayout(spec, params, warnings);
  await tick();

  const heights = resolveHeights(params, warnings);
  const bodyGeom = buildBody(layout, params, heights, warnings);
  await tick();

  const { cap, design, engraveDepth } = buildCapParts(layout, params, warnings);
  await tick();

  const parts = [
    { name: 'body', geometry: bodyGeom, color: params.colors.body },
    { name: 'cap', geometry: cap, color: params.colors.cap },
  ];
  if (design) parts.push({ name: 'design', geometry: design, color: params.colors.design });

  const bounds = extents(bodyGeom);
  const capBounds = extents(cap);
  return {
    parts,
    bounds,
    warnings: [...new Set(warnings)],
    assembly: {
      plateTopZ: heights.plateTopZ,
      pocketHeight: heights.pocketHeight,
      capZ: heights.capZ,
      bodyHeight: heights.height,
      engraveDepth,
      capBounds,
      triangles: Object.fromEntries(parts.map((p) => [p.name, triangleCount(p.geometry)])),
    },
  };
}

/**
 * Simplified MX switch geometry positioned in the body frame (body resting on z = 0).
 * The plate top is at body.height - rimHeight; see solids.js for the per-section z offsets.
 * `params` defaults to DEFAULT_PARAMS; pass the same params used for buildClicker.
 */
export function buildReferenceSwitch(params = DEFAULT_PARAMS) {
  return buildReferenceSwitchGeometry(mergeParams(params));
}

export { THREE };
