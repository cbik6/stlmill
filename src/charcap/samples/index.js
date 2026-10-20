// Built-in parametric characters, generated with manifold-3d (always watertight), mm, Z up,
// bottom on z = 0, centred on XY. Each is roughly the size of Clark's real prints; makeCap
// re-normalises to params.width anyway.
//
//   SAMPLES                      -> [{ id, label, width, faceDirection }]
//   await buildSample(id)        -> THREE.BufferGeometry

import { initBooleans, manifoldApi, fromManifold, dispose } from '../engine/csg.js';

export const SAMPLES = [
  { id: 'pumpkin', label: 'Pumpkin', width: 36, faceDirection: 'front' },
  { id: 'ghost', label: 'Ghost', width: 30, faceDirection: 'front' },
  { id: 'skull', label: 'Skull', width: 30, faceDirection: 'front' },
  { id: 'heart', label: 'Heart', width: 32, faceDirection: 'top' },
];

/** Rest on z = 0, centre XY. Returns a new manifold (input disposed). */
function settle(m) {
  const b = m.boundingBox();
  const out = m.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]);
  m.delete();
  return out;
}

function pumpkin() {
  const { Manifold } = manifoldApi();
  const R = 18;
  const squash = 0.72;
  const sphere = Manifold.sphere(R, 96);
  const body = sphere.warp((v) => {
    const [x, y, z] = v;
    const rho = Math.hypot(x, y);
    const theta = Math.atan2(y, x);
    const lobe = 1 + 0.075 * Math.cos(8 * theta) * Math.min(1, rho / R);
    v[0] = x * lobe;
    v[1] = y * lobe;
    // squash and dimple the top around the stem
    v[2] = z * squash - (z > 0 ? 2.2 * Math.exp(-(rho * rho) / 30) : 0);
  });
  sphere.delete();
  const top = body.boundingBox().max[2];
  const stem = Manifold.cylinder(7, 2.1, 2.8, 24).translate([0, 0, top - 3.2]);
  const bent = stem.warp((v) => { v[0] += 0.25 * (v[2] - (top - 3.2)); });
  stem.delete();
  const withStem = body.add(bent);
  dispose(body, bent);
  // flat resting ring like the real print: cut 1.4 mm off the bottom
  const cut = withStem.trimByPlane([0, 0, 1], -R * squash + 1.4);
  withStem.delete();
  return settle(cut);
}

function ghost() {
  const { Manifold } = manifoldApi();
  const profile = [[0, 0], [14, 0], [13.2, 1.6], [12.1, 3.6], [11.3, 6], [11, 9], [11, 17]];
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * (Math.PI / 2);
    profile.push([11 * Math.cos(a), 17 + 12.5 * Math.sin(a)]);
  }
  profile[profile.length - 1] = [0, 29.5];
  const rev = Manifold.revolve(profile, 96);
  // wavy skirt: lift the hem in 7 scallops, fading out by z = 7
  const wavy = rev.warp((v) => {
    const theta = Math.atan2(v[1], v[0]);
    const fade = Math.max(0, 1 - v[2] / 7);
    v[2] += 1.3 * (1 + Math.cos(7 * theta)) * 0.5 * fade * fade;
  });
  rev.delete();
  const flat = wavy.trimByPlane([0, 0, 1], 0.7); // scalloped hem, flat resting face
  wavy.delete();
  const slim = flat.scale([1, 0.68, 1]); // 29 x 19 like the real ghost, long side on X
  flat.delete();
  return settle(slim);
}

function skull() {
  const { Manifold } = manifoldApi();
  const cranium = Manifold.sphere(14, 72).scale([1, 0.92, 1]);
  const face = Manifold.sphere(9, 48).scale([1.1, 1, 1.25]).translate([0, -4.5, -7.5]);
  const head = cranium.add(face);
  dispose(cranium, face);
  const eyeL = Manifold.sphere(3.3, 32).scale([1, 0.9, 1.15]).translate([-5, -11.5, -1]);
  const eyeR = eyeL.translate([10, 0, 0]);
  const nose = Manifold.cube([2.4, 5, 3.6], true).translate([0, -13, -5.5]);
  const cut = head.subtract(eyeL).subtract(eyeR).subtract(nose);
  dispose(head, eyeL, eyeR, nose);
  const flat = cut.trimByPlane([0, 0, 1], -12.5);
  cut.delete();
  return settle(flat);
}

function heart() {
  const { Manifold } = manifoldApi();
  const pts = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    pts.push([16 * Math.pow(Math.sin(t), 3), 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const k = 32 / Math.max(maxX - minX, maxY - minY);
  const poly = pts.map(([x, y]) => [x * k, y * k]).reverse(); // the parametric curve runs clockwise; extrude wants CCW
  const h = 9;
  const slab = Manifold.extrude([poly], h, 12, 0, [0.3, 0.3]);
  const dome = slab.warp((v) => {
    const u = Math.min(1, Math.max(0, v[2] / h));
    v[2] = h * Math.sqrt(1 - (1 - u) * (1 - u));
  });
  slab.delete();
  return settle(dome);
}

const BUILDERS = { pumpkin, ghost, skull, heart };

export async function buildSample(id) {
  if (!BUILDERS[id]) throw new Error(`Unknown sample "${id}"`);
  await initBooleans();
  const raw = BUILDERS[id]();
  // scale to the nominal width (longest XY side) and settle
  const b = raw.boundingBox();
  const long = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
  const scaled = raw.scale(SAMPLES.find((s) => s.id === id).width / long);
  raw.delete();
  const m = settle(scaled);
  const g = fromManifold(m);
  m.delete();
  g.name = id;
  return g;
}
