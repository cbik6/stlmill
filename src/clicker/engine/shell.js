// CSG-free closed-shell builder for "layer cake" solids.
//
// A part is described by horizontal planar faces (polygons with holes at a given z, facing
// up or down) and vertical wall strips (a polygon boundary swept between two z levels).
// Because every face and every wall reuses the *same* polyline vertices along a shared
// boundary, the assembled mesh is a single closed manifold shell without any boolean
// operation. This avoids the precision problems three-bvh-csg has when splitting the long
// sliver triangles of a many-vertex traced outline.
//
// Conventions: mm, Z up. Polygons are {x,y}[] without a repeated end point; orientation is
// normalised here (outer boundaries CCW). Faces are triangulated with THREE.ShapeUtils
// (earcut) and re-oriented per triangle so `up` faces +Z and `!up` faces -Z.

import * as THREE from 'three';
import { repairMesh } from './repair.js';

/** Signed area (positive = CCW). */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Clean a polygon so earcut will not drop any of its vertices: remove exact duplicates and
 * exactly-collinear points, and orient CCW. Returns a new array.
 */
export function cleanPolygon(pts) {
  // 1. drop consecutive duplicates (including a repeated closing vertex) BEFORE any collinearity
  //    test - otherwise the zero-area triple at the seam would delete a real corner.
  let out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push({ x: p.x, y: p.y });
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
  // 2. drop exactly-collinear vertices (earcut would drop them and leave T-junctions)
  let changed = true;
  while (changed && out.length >= 4) {
    changed = false;
    const next = [];
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const p = out[(i + n - 1) % n];
      const c = out[i];
      const q = out[(i + 1) % n];
      const area = (c.x - p.x) * (q.y - p.y) - (c.y - p.y) * (q.x - p.x);
      if (area === 0) {
        changed = true;
        continue;
      }
      next.push(c);
    }
    out = next;
  }
  if (polygonArea(out) < 0) out.reverse();
  return out;
}

export function pointInPolygon(p, pts) {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** True when every vertex of `inner` lies strictly inside `outer` (and at least `margin` away from it). */
export function polygonContains(outer, inner, margin = 0) {
  for (const p of inner) {
    if (!pointInPolygon(p, outer)) return false;
    if (margin > 0 && distanceToPolygon(p, outer) < margin) return false;
  }
  return true;
}

export function distanceToPolygon(p, pts) {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}

export class ShellBuilder {
  constructor() {
    this.pos = [];
  }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  }

  /**
   * Vertical strip along polygon `pts` (CCW) from z0 to z1.
   * inward=false -> normals point away from the polygon interior (outer boundary of material)
   * inward=true  -> normals point into the polygon (the polygon is a hole in the material)
   */
  wall(pts, z0, z1, inward = false) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      if (inward) {
        this.tri(p.x, p.y, z0, q.x, q.y, z1, q.x, q.y, z0);
        this.tri(p.x, p.y, z0, p.x, p.y, z1, q.x, q.y, z1);
      } else {
        this.tri(p.x, p.y, z0, q.x, q.y, z0, q.x, q.y, z1);
        this.tri(p.x, p.y, z0, q.x, q.y, z1, p.x, p.y, z1);
      }
    }
  }

  /**
   * Ruled surface between polygon `bottom` at z0 and polygon `top` at z1 (same vertex count,
   * vertices paired by index, both CCW). Same orientation rules as wall(). Used for tapered sockets.
   */
  loft(bottom, top, z0, z1, inward = false) {
    const n = bottom.length;
    if (top.length !== n) throw new Error('loft: polygons must have the same vertex count');
    for (let i = 0; i < n; i++) {
      const p = bottom[i], q = bottom[(i + 1) % n];
      const P = top[i], Q = top[(i + 1) % n];
      if (inward) {
        this.tri(p.x, p.y, z0, Q.x, Q.y, z1, q.x, q.y, z0);
        this.tri(p.x, p.y, z0, P.x, P.y, z1, Q.x, Q.y, z1);
      } else {
        this.tri(p.x, p.y, z0, q.x, q.y, z0, Q.x, Q.y, z1);
        this.tri(p.x, p.y, z0, Q.x, Q.y, z1, P.x, P.y, z1);
      }
    }
  }

  /** Planar polygon `outer` minus `holes` at height z, facing +Z (up) or -Z. */
  face(outer, holes, z, up = true) {
    const contour = outer.map((p) => new THREE.Vector2(p.x, p.y));
    const holeV = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)));
    const tris = THREE.ShapeUtils.triangulateShape(contour, holeV);
    const all = contour.concat(...holeV);
    for (const [a, b, c] of tris) {
      const A = all[a], B = all[b], C = all[c];
      const area = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
      if (area === 0) continue;
      const ccw = area > 0;
      if (ccw === up) this.tri(A.x, A.y, z, B.x, B.y, z, C.x, C.y, z);
      else this.tri(A.x, A.y, z, C.x, C.y, z, B.x, B.y, z);
    }
  }

  /** Weld into an indexed BufferGeometry (position only). */
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(this.pos), 3));
    return repairMesh(g).geometry;
  }
}

/** Axis-aligned square of side s centred on the origin, CCW. */
export function squarePolygon(s, cx = 0, cy = 0) {
  const h = s / 2;
  return [
    { x: cx - h, y: cy - h },
    { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h },
    { x: cx - h, y: cy + h },
  ];
}
