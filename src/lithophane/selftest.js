// Lithophane engine selftest: `node src/lithophane/selftest.js` must print SELFTEST PASSED.
// Builds every shape (flat, bent, cylinder; with and without frame) from a synthetic photo and
// checks that each mesh is one closed, consistently oriented shell with the right size and
// thickness, and that the STL writer produces the expected byte count.

import {
  DEFAULT_PARAMS,
  resolveLayout,
  sampleSize,
  buildLithophane,
  exportStl,
  thicknessGrid,
  normalizeParams,
} from './engine.js';

const t0 = Date.now();
let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${msg}`);
  }
};

/** Synthetic 4:3 "photo": a horizontal gradient (dark left, light right) with a dark disc. */
function photo(cols, rows) {
  const l = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = c / (cols - 1) - 0.5;
      const dy = r / (rows - 1) - 0.5;
      l[r * cols + c] = Math.hypot(dx, dy) < 0.2 ? 0 : c / (cols - 1);
    }
  }
  return l;
}

/** Every directed edge must be matched by its reverse exactly once (closed, oriented, manifold). */
function edgeCheck(geometry) {
  const idx = geometry.index.array;
  const edges = new Map();
  const key = (a, b) => a * 4294967296 + b;
  for (let i = 0; i < idx.length; i += 3) {
    for (const [a, b] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]) {
      const k = key(a, b);
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let open = 0;
  let dup = 0;
  for (const [k, n] of edges) {
    if (n > 1) dup++;
    const a = Math.floor(k / 4294967296);
    const b = k % 4294967296;
    if (!edges.has(key(b, a))) open++;
  }
  return { open, dup };
}

function signedVolume(geometry) {
  const p = geometry.attributes.position.array;
  const idx = geometry.index.array;
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

const CASES = [
  { label: 'flat, framed (default)', params: {} },
  { label: 'flat, no frame', params: { frame: { enabled: false } } },
  { label: 'bent 120 deg, framed', params: { curve: 120 } },
  { label: 'bent 270 deg, no frame', params: { curve: 270, frame: { enabled: false } } },
  { label: 'cylinder, framed top/bottom', params: { curve: 360 } },
  { label: 'cylinder, no frame', params: { curve: 360, frame: { enabled: false } } },
  { label: 'inverted, steep curve, gamma 2', params: { invert: true, gamma: 2, curve: 60 } },
];

for (const { label, params } of CASES) {
  const layout = resolveLayout(params, 4 / 3);
  const size = sampleSize(layout, 200);
  const luma = photo(size.imgCols, size.imgRows);
  const { geometry, bounds, triangles } = buildLithophane(luma, size, layout);
  const p = layout.params;
  const { open, dup } = edgeCheck(geometry);
  const vol = signedVolume(geometry);
  console.log(`== ${label}: ${size.gW}x${size.gH} grid, ${triangles} tris, ${bounds.x.toFixed(1)} x ${bounds.y.toFixed(1)} x ${bounds.z.toFixed(1)} mm, volume ${(vol / 1000).toFixed(2)} cm3`);
  check(open === 0 && dup === 0, `${label}: closed oriented shell (open ${open}, duplicate ${dup})`);
  check(vol > 0, `${label}: outward-facing (signed volume ${vol.toFixed(1)})`);
  check(Math.abs(bounds.z - p.height) < 1e-3, `${label}: height ${bounds.z.toFixed(3)} = ${p.height}`);
  const bb = geometry.boundingBox;
  check(Math.abs(bb.min.z) < 1e-6, `${label}: stands on z = 0`);
  if (!layout.cylinder && p.curve < 1) {
    check(Math.abs(bounds.x - layout.totalW) < 1e-3, `${label}: width ${bounds.x.toFixed(3)} = ${layout.totalW.toFixed(3)}`);
    const maxT = p.frame.enabled ? p.frame.thickness : p.maxThickness;
    check(Math.abs(bounds.y - maxT) < 1e-3, `${label}: thickness ${bounds.y.toFixed(3)} = ${maxT}`);
  }
  // thickness range of the picture part
  const tg = thicknessGrid(luma, size, layout);
  let lo = Infinity, hi = -Infinity;
  for (let r = size.frameRows; r < size.frameRows + size.imgRows; r++) {
    for (let c = size.frameCols; c < size.frameCols + size.imgCols; c++) {
      lo = Math.min(lo, tg[r * size.gW + c]);
      hi = Math.max(hi, tg[r * size.gW + c]);
    }
  }
  check(Math.abs(lo - p.minThickness) < 0.05 && Math.abs(hi - p.maxThickness) < 1e-6, `${label}: picture thickness ${lo.toFixed(2)}..${hi.toFixed(2)} spans ${p.minThickness}..${p.maxThickness}`);
  const stl = exportStl(geometry, 'test');
  check(stl.byteLength === 84 + triangles * 50, `${label}: STL is ${stl.byteLength} bytes for ${triangles} triangles`);
}

// dark pixels are thick, light pixels thin (and invert swaps them)
{
  const layout = resolveLayout({ frame: { enabled: false } }, 1);
  const size = sampleSize(layout, 50);
  const luma = new Float32Array(size.imgCols * size.imgRows).fill(1);
  luma[0] = 0;
  const tg = thicknessGrid(luma, size, layout);
  check(Math.abs(tg[0] - DEFAULT_PARAMS.maxThickness) < 1e-6 && Math.abs(tg[1] - DEFAULT_PARAMS.minThickness) < 1e-6, 'dark pixel -> max thickness, light pixel -> min thickness');
  const inv = thicknessGrid(luma, size, resolveLayout({ frame: { enabled: false }, invert: true }, 1));
  check(Math.abs(inv[0] - DEFAULT_PARAMS.minThickness) < 1e-6, 'invert swaps them');
}

// sanitising: max is kept above min, the frame is never thinner than the picture
{
  const p = normalizeParams({ minThickness: 3, maxThickness: 1, frame: { thickness: 1 } });
  check(p.maxThickness > p.minThickness && p.frame.thickness >= p.maxThickness, `normalizeParams keeps min < max <= frame (got ${p.minThickness} / ${p.maxThickness} / ${p.frame.thickness})`);
}

// full-resolution size of the default 100 mm plate stays printable-file sized
{
  const layout = resolveLayout({}, 4 / 3);
  const size = sampleSize(layout);
  const tris = 2 * (size.gW - 1) * (size.gH - 1);
  console.log(`default full resolution: ${size.gW}x${size.gH} grid, ~${(tris / 1e6).toFixed(2)} M front triangles, ~${((tris * 50) / 1e6).toFixed(0)} MB STL`);
  check(tris < 1.5e6, 'default full-resolution plate stays under 1.5 M triangles');
}

console.log(`\n${failures === 0 ? 'SELFTEST PASSED' : `SELFTEST FAILED (${failures})`} in ${Date.now() - t0} ms`);
process.exit(failures === 0 ? 0 : 1);
