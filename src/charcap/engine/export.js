// Export wrappers around the clicker engine's exporters (export.js is owned by the clicker tool).
//
// 3MF: the clicker exporter groups parts named 'cap' + 'design' into ONE composite object (two
// components, extruders 2 and 3) and writes 'body' as its own object (extruder 1), with Bambu /
// Orca / PrusaSlicer per-part extruder metadata. We rename our 'face' part to 'design' for the
// call and keep every part's `print` placement from makeCap (upright, as modelled; the body beside
// the cap). STL: one binary STL per part, laid out the same way, named <name>-cap.stl,
// <name>-cap-face.stl and <name>-body.stl.

import JSZip from 'jszip';
import { exportThreeMF as clickerExportThreeMF, layoutForPrint, geometryToStl } from '../../clicker/engine/export.js';

/** Parts list in the clicker exporter's vocabulary (face -> design), cap first, body last. */
export function exportParts(result) {
  const parts = Array.isArray(result) ? result : result.parts;
  const renamed = parts.map((p) => (p.name === 'face' ? { ...p, name: 'design' } : p));
  const order = { body: 0, cap: 1, design: 2 };
  return renamed.sort((a, b) => (order[a.name] ?? 9) - (order[b.name] ?? 9));
}

/** 3MF Blob: cap (+ face inlay as a component) and optional body, print layout baked in. */
export async function exportThreeMF(result, { name = 'character-cap' } = {}) {
  const parts = exportParts(result);
  const assembly = Array.isArray(result) ? { capZ: 0 } : { capZ: result.assembly ? result.assembly.capZ : 0 };
  return clickerExportThreeMF({ parts, assembly }, { name });
}

/** Zip of binary STLs, one per part, in print orientation. */
export async function exportStlZip(result, { name = 'character-cap' } = {}) {
  const parts = exportParts(result);
  const laid = layoutForPrint(parts).parts;
  const zip = new JSZip();
  for (const p of laid) {
    const file = p.name === 'design' ? `${name}-cap-face.stl` : `${name}-${p.name}.stl`;
    zip.file(file, geometryToStl(p.geometry, `${name} ${p.name}`));
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return new Blob([bytes], { type: 'application/zip' });
}
