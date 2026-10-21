// Public API of the clicker geometry engine.
//
//   buildClicker(params)            -> { parts, bounds, warnings, assembly }
//   buildReferenceSwitch(params?)   -> THREE.BufferGeometry (simplified MX switch, body frame)
//   exportThreeMF(parts, { name })  -> Blob
//   exportStlZip(parts, { name })   -> Blob
//   makeDesignFromText / makeDesignFromSvg / makeDesignFromImage -> Promise<DesignSpec>
//
// Part  = { name: 'body'|'cap'|'design', geometry: THREE.BufferGeometry (mm, Z up), color: '#rrggbb' }
//   body   : rests on z = 0 with a solid floor, centred on XY (keychain ring, when enabled, is unioned in).
//            The switch drops in from the top: flange on the plate, lower housing in a closed cavity below.
//   cap    : underside plane z = 0, top face z = cap.thickness. Like an MX keycap: a rounded-square
//            housing pocket (switch.pocket + 2*clearance, depth switch.travel) is cut up from the
//            underside, the stem boss (switch.bossDiameter) hangs from the pocket ceiling down to
//            z = 0 (bottom flush, nothing below the cap), and the socket is cut up into the boss
//            (ceiling at z = stemHeight). The UI should place it at z = assembly.capZ in the body
//            frame (boss bottom level with the housing top, inside the stem collar; the housing
//            rises into the pocket when pressed).
//   design : 'raised'  -> relief standing on the cap top (z = thickness .. thickness+designHeight)
//            'inlay'   -> filler exactly filling a pocket in the cap top (z = thickness-designHeight .. thickness)
//            'engraved'-> no design part (pocket only). Same frame as the cap in both cases.
//   Each part also carries `print = { x, y, flipX }`: the plate placement used by the exporters
//   (layoutForPrint). The viewer ignores it and keeps using assembly.capZ.
// bounds   = { x, y, z } mm extents of the body part.
// assembly = { plateTopZ, plateBottomZ, cavityBottomZ, floorThickness, cavityDepth, pocketHeight (= cavityDepth,
//              kept for older consumers), capZ, bodyHeight, engraveDepth, capBounds: {x,y,z}, triangles }
//
// All heavy steps yield to the event loop so a UI spinner can animate; nothing runs in a worker.

import * as THREE from 'three';
import { computeLayout } from './outline.js';
import { resolveHeights, buildBody, buildCapParts, buildReferenceSwitchGeometry, triangleCount } from './solids.js';

export { exportThreeMF, exportStlZip, layoutForPrint } from './export.js';
export { buildSocketCoupons, SOCKET_COUPONS, socketPolygons, LABEL, GLYPHS_5X7, labelPolygons, labelPixelSize, couponMaxSocketRadius } from './solids.js';
import { buildSocketCoupons as _buildSocketCoupons } from './solids.js';
import { exportThreeMF as _exportThreeMF } from './export.js';

/**
 * Press-fit test plate as a 3MF Blob: six pucks (A straight 4.1, B straight 4.3,
 * C tapered 4.6-4.1, D tapered 4.8-4.2, E round 5.0, F round 5.4), sockets facing up,
 * one named object each. See buildSocketCoupons for the geometry.
 */
export async function exportSocketCoupons({ name = 'clicker-socket-coupons', ...opts } = {}) {
  const { parts } = _buildSocketCoupons(opts);
  return _exportThreeMF(parts, { name });
}
export { makeDesignFromText, makeDesignFromSvg, makeDesignFromImage, makeDesignFromShapes } from './design.js';
export { traceBitmap } from './trace.js';
export { MX, resolveCapSocket } from './solids.js';
export { CAP_POCKET_WALL, CAP_POCKET_CORNER } from './outline.js';

export const DEFAULT_PARAMS = {
  design: { spec: null, fill: 100 /* % of the available area the design fills */, rotation: 0 /* deg CCW */ },
  // size: for 'outline' it is the DESIGN's longest side (the body grows around it: + margin + wall
  // + clearance per side, e.g. 35 mm heart -> 45.6 mm body); for the presets it is the base's
  // longest side and the design fills `design.fill` % of the cap's inner area.
  // fitSwitch (outline only): a short, wide design (a word) grows until its letters cover the switch
  // pocket, so the cap follows the letters instead of showing the pocket square behind them; size
  // then acts as a minimum. Long caps get two switches (switch.count 'auto').
  base: { style: 'outline' /* 'outline'|'circle'|'square'|'hexagon' */, size: 35 /* mm, see above */, margin: 2.5 /* padding between design and cap edge */, cornerRadius: 4, fitSwitch: true },
  // cap 6.2 thick, built like a real MX keycap: a 16.2 mm rounded-square housing pocket 4.4 deep
  // (switch travel) is cut up from the underside, a stem boss hangs from its ceiling down to the
  // underside plane, the 4.0 mm socket is cut up into the boss, the 0.8 mm inlay/engraving pocket
  // comes down from the top, and 1.0 mm of cap stays above the housing pocket (6.2 = 4.4 + 1.0 + 0.8).
  cap: { thickness: 6.2, designHeight: 0.8, designMode: 'inlay' /* 'inlay'|'raised'|'engraved' */ },
  // Seat = 6.6 + max(0, 3.6 - socket depth) = 6.6: the boss bottom (underside plane) is level with
  // the MX upper housing top (the 6.0 boss drops inside the stem collar of dustproof switches, so
  // the cap rides on the stem alone); pressing drives the housing 4.4 mm up into the pocket. rimHeight 7.0 = seat + 0.4 (cap underside 0.4 mm below the rim).
  // height 'auto' = floor + cavity + 1.5 plate + 7.0 rim, where the floor is 1.5 mm, or 4.2 mm when
  // the centre-post pocket (3.0 + 0.2 deep + 1.0 solid) is needed under a housing-only cavity:
  //   'clipped' pins: 4.2 + 5.5 + 1.5 + 7.0 = 18.2 mm; 'keep': 1.5 + 8.5 + 1.5 + 7.0 = 18.5 mm.
  // A number overrides (raised if too short).
  body: { height: 'auto', rimHeight: 7.0, wall: 2.5 },
  switch: {
    cutout: 14 /* nominal plate cutout, no tolerance (clips grip it) */,
    pocket: 15.6 /* switch FLANGE width above the plate; the cap recess must clear it */,
    cavity: 14.8 /* closed cavity under the plate for the lower housing + sprung clips (+2*switchTolerance) */,
    pins: 'clipped' /* 'clipped' (pins snipped flush, default) | 'keep' (deeper cavity for the pins) */,
    cavityDepth: 'auto' /* 'auto' = 5.5 ('clipped') / 8.5 ('keep') from the plate underside; a number overrides */,
    post: { diameter: 4.0, height: 3.0 } /* centre locating post under the lower housing (3-pin switches) */,
    postClearance: 0.3 /* radial clearance of the round post pocket cut into the cavity floor when the cavity is shallower than housing + post; the floor grows to keep 1.0 mm solid under it */,
    plateThickness: 1.5,
    // switches under the one cap: 'auto' = two for a long, narrow cap (>= 48 mm and 1.8:1, e.g. a
    // word), else one; 1 or 2 forces it. Two sit on the long axis at the quarter points, at least
    // 19.05 mm (MX pitch) apart; every cavity, pocket, boss and socket is the single-switch one.
    count: 'auto',
    // stem socket: exact copy of the measured "ghost" cap that fits the user's dustproof switches -
    // a STRAIGHT cross 4.4 wide with 1.4 arms, 4.0 deep, cut into a round 6.0 boss (0.8 mm wall at
    // the arm tips) that hangs 4.4 mm from the pocket ceiling, bottom flush with the underside
    socketMode: 'cross' /* 'tapered'|'cross'|'round' */,
    stemCrossWidth: 4.4 /* cross width (ceiling width for 'tapered') */,
    stemCrossThickness: 1.4 /* arm thickness */,
    socketOpening: 6.0 /* cross width at the underside opening ('tapered' only) */,
    roundDiameter: 5.0 /* hole diameter ('round' only, glue fit) */,
    stemHeight: 4.0 /* socket depth (ghost: 4.0); cut up into the boss (and slab if deeper) */,
    travel: 4.4 /* housing pocket depth in the cap underside = boss length (ghost: 4.4) */,
    bossDiameter: 6.0 /* stem boss hanging from the pocket ceiling (ghost: 6.0; 6.4 sat on the stem collar and killed the travel) */,
  },
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
  // numeric sanitation: anything NaN/non-numeric falls back to the default.
  // body.height and switch.cavityDepth accept 'auto' (derived) or a finite number.
  for (const group of ['base', 'cap', 'body', 'switch', 'keychain', 'fit', 'design']) {
    for (const k of Object.keys(DEFAULT_PARAMS[group])) {
      const d = DEFAULT_PARAMS[group][k];
      const v = merged[group][k];
      if (typeof d === 'number') {
        const n = Number(v);
        merged[group][k] = Number.isFinite(n) ? n : d;
      } else if (d === 'auto') {
        const n = typeof v === 'string' && v.trim().toLowerCase() === 'auto' ? NaN : Number(v);
        merged[group][k] = Number.isFinite(n) ? n : 'auto';
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

  // Print-plate placement (used by exportThreeMF / exportStlZip via layoutForPrint, not by the viewer):
  // body floor-down on the left, cap on the right. Pocketed caps (inlay / engraved) are flipped
  // 180 deg about X so the flat top lies on the plate (stem up, no supports); raised caps print
  // cap-up resting on the stem and need supports. The design part follows the cap's transform.
  const mode = params.cap.designMode;
  const flipCap = mode !== 'raised';
  const gap = 6;
  // assembleZ: z of the part's build-frame origin in the assembled (viewer) frame, used for the
  // slicer's Assembly View pose. Body frame == assembled frame; cap/design frames sit at capZ.
  parts[0].print = { x: -(bounds.x / 2 + gap), y: 0, flipX: false, assembleZ: 0 };
  parts[1].print = { x: capBounds.x / 2 + gap, y: 0, flipX: flipCap, assembleZ: heights.capZ };
  if (design) parts[2].print = { ...parts[1].print, follow: 'cap' };
  if (!flipCap && design) {
    warnings.push('Raised designs print cap-up and need supports under the cap; use Inlay for a flat, two-colour cap.');
  }
  return {
    parts,
    bounds,
    warnings: [...new Set(warnings)],
    assembly: {
      plateTopZ: heights.plateTopZ,
      plateBottomZ: heights.plateBottomZ,
      cavityBottomZ: heights.cavityBottomZ,
      floorThickness: heights.cavityBottomZ,
      cavityDepth: heights.cavityDepth,
      pocketHeight: heights.cavityDepth,
      capZ: heights.capZ,
      seat: heights.seat,
      bossBelow: heights.bossBelow,
      socketCeilingZ: heights.socketCeilingZ,
      travel: heights.travel,
      bossDiameter: heights.bossDiameter,
      pocketSide: heights.pocketSide,
      capThickness: heights.capThickness,
      postPocketDepth: heights.postPocketDepth,
      postPocketDiameter: heights.postPocketDiameter,
      postPocketBottomZ: heights.postPocketBottomZ,
      switchPositions: layout.switchPositions, // switch centres (mm, body frame), one per switch
      switchCount: layout.switchPositions.length,
      designGrownFrom: layout.grownFrom, // > 0: Fit to switch enlarged the design from this size (mm)
      designSize: layout.designSize, // longest side of the design, mm ("heart 35 mm")
      capSize: layout.capSize,
      bodySize: layout.bodySize, // longest side of the body, mm ("body 46 mm")
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
 * `positions` = assembly.switchPositions (one switch drawn per centre; default one at the origin).
 */
export function buildReferenceSwitch(params = DEFAULT_PARAMS, positions = null) {
  return buildReferenceSwitchGeometry(mergeParams(params), positions);
}

export { THREE };
