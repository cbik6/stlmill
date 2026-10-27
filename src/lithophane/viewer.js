// Bench viewport for the lithophane: the same charcoal plate, grid and light rig as the Clicker's
// bench, with the plate standing upright on it. Two looks:
//   lit      white PLA under room light (shows the relief)
//   backlit  the photo as it appears with a lamp behind it: each vertex glows by how thin the
//            plate is there (thin = bright, thick = dark), the frame stays dark.
//
//   const v = new LithoViewer(container);
//   v.setModel({ geometry, bounds, minThickness, maxThickness });
//   v.setBacklit(bool); v.setGrid(bool); v.fit(); v.dispose();

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const PLATE_MIN = 120; // mm; the plate grows with the model
const PLATE_THICKNESS = 1.5;
const PLATE_RADIUS = 6;
const PLATE_INSET = 4;
const GRID_STEP = 10;
const PLATE_COLOR = 0x232323;
const PRINT_COLOR = 0xf2efe9; // white PLA
const GLOW = new THREE.Color(1.0, 0.86, 0.66); // warm lamp light through PLA

function roundedRectShape(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function disposeObject(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  });
}

export class LithoViewer {
  constructor(container) {
    this.container = container;
    this.backlit = false;
    this.gridOn = true;
    this.mesh = null;
    this.bounds = { x: 100, y: 5, z: 100 };
    this.range = { min: 0.8, max: 3 };
    this._fitted = false;
    this._raf = 0;
    this._disposed = false;
    this._hidden = typeof document !== 'undefined' && document.hidden;
    this.plateSize = 0;

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.classList.add('ck-canvas');
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 4000);
    camera.up.set(0, 0, 1);
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 20;
    controls.maxDistance = 1500;
    controls.maxPolarAngle = Math.PI * 0.55;
    controls.addEventListener('change', () => this._invalidate());
    this.controls = controls;

    // light rig: hemisphere + key from the front-right + weak fill (no shadows: the plate is thin
    // and upright, a shadow would only darken the bench behind it)
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x2a2c30, 1.1);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 2.2);
    this.key.position.set(120, -220, 200);
    this.scene.add(this.key);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.5);
    this.fill.position.set(-160, -120, 60);
    this.scene.add(this.fill);
    // the lamp behind the plate in backlit mode: lights the bench behind it a little
    this.lamp = new THREE.PointLight(0xffd9a8, 0, 0, 1.4);
    this.scene.add(this.lamp);

    this.benchGroup = new THREE.Group();
    this.scene.add(this.benchGroup);
    this._buildBench(PLATE_MIN);

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._resize();
    this._onVisibility = () => {
      this._hidden = document.hidden;
      if (this._hidden) this._cancelFrame();
      else this._invalidate();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
    this._invalidate();
  }

  /** Show a built plate. geometry carries `position` + `thickness` (see engine.js). */
  setModel({ geometry, bounds, minThickness, maxThickness }) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposeObject(this.mesh);
      this.mesh = null;
    }
    if (!geometry) {
      this._invalidate();
      return;
    }
    const geo = geometry.clone();
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    // centre on the plate (x/y), standing on z = 0
    geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, 0);
    this.range = { min: minThickness, max: maxThickness };
    this._paint(geo);
    this.mesh = new THREE.Mesh(geo, this._material());
    this.mesh.name = 'lithophane';
    this.scene.add(this.mesh);

    const prev = this.bounds;
    this.bounds = { ...bounds };
    const need = Math.max(PLATE_MIN, Math.ceil((Math.max(bounds.x, bounds.y) + 30) / 20) * 20);
    if (need !== this.plateSize) this._buildBench(need);
    this.lamp.position.set(0, Math.max(30, bounds.y + 25), bounds.z * 0.55);

    const jump = Math.abs(Math.max(bounds.x, bounds.z) - Math.max(prev.x, prev.z)) / Math.max(prev.x, prev.z, 1);
    if (!this._fitted || jump > 0.3) {
      this.fit(this._fitted);
      this._fitted = true;
    }
    this._applyLook();
    this._invalidate();
  }

  setBacklit(on) {
    this.backlit = !!on;
    if (this.mesh) {
      this.mesh.material.dispose();
      this.mesh.material = this._material();
    }
    this._applyLook();
    this._invalidate();
  }

  setGrid(on) {
    this.gridOn = !!on;
    if (this.gridLines) this.gridLines.visible = this.gridOn;
    this._invalidate();
  }

  /** Frame the plate from the front, a little above and to the right. keepDirection keeps the orbit. */
  fit(keepDirection = false) {
    const b = this.bounds;
    const target = new THREE.Vector3(0, 0, b.z * 0.48);
    const radius = Math.sqrt((b.x / 2) ** 2 + (b.y / 2) ** 2 + (b.z / 2) ** 2) + 4;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (this.camera.aspect || 1));
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 0.95;
    let dir;
    if (keepDirection) {
      dir = this.camera.position.clone().sub(this.controls.target);
      if (dir.lengthSq() < 1e-6) dir = null;
    }
    if (!dir) dir = new THREE.Vector3(0.38, -1, 0.3); // front, a touch right and above
    dir.normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.5, dist / 200);
    this.camera.far = dist * 20 + this.plateSize * 2;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this._invalidate();
  }

  dispose() {
    this._disposed = true;
    this._cancelFrame();
    this._ro.disconnect();
    document.removeEventListener('visibilitychange', this._onVisibility);
    disposeObject(this.scene);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------ internals

  /** Vertex colours for the backlit look: brightness falls off with thickness. */
  _paint(geo) {
    const t = geo.attributes.thickness;
    if (!t) return;
    const n = t.count;
    const col = new Float32Array(n * 3);
    const { min, max } = this.range;
    const span = Math.max(0.01, max - min);
    for (let i = 0; i < n; i++) {
      const v = t.array[i];
      // light through PLA falls off roughly exponentially; normalise so min -> 1, max -> ~0.08
      const k = Math.max(0, (v - min) / span);
      const br = v > max + 0.05 ? 0.04 : Math.exp(-2.5 * k);
      col[i * 3] = GLOW.r * br;
      col[i * 3 + 1] = GLOW.g * br;
      col[i * 3 + 2] = GLOW.b * br;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  _material() {
    if (this.backlit) return new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    return new THREE.MeshStandardMaterial({ color: PRINT_COLOR, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  }

  _applyLook() {
    // backlit: room lights down, the lamp behind the plate on
    this.hemi.intensity = this.backlit ? 0.18 : 1.1;
    this.key.intensity = this.backlit ? 0.15 : 2.2;
    this.fill.intensity = this.backlit ? 0.05 : 0.5;
    this.lamp.intensity = this.backlit ? 2.5 : 0;
  }

  _buildBench(size) {
    while (this.benchGroup.children.length) {
      const c = this.benchGroup.children[0];
      this.benchGroup.remove(c);
      disposeObject(c);
    }
    this.plateSize = size;
    const geo = new THREE.ExtrudeGeometry(roundedRectShape(size, size, PLATE_RADIUS), { depth: PLATE_THICKNESS, bevelEnabled: false, curveSegments: 8 });
    geo.translate(0, 0, -PLATE_THICKNESS);
    geo.computeVertexNormals();
    const plate = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: PLATE_COLOR, roughness: 0.9, metalness: 0 }));
    plate.name = 'build-plate';
    this.benchGroup.add(plate);

    const inner = size / 2 - PLATE_INSET;
    const z = 0.02;
    const pts = [];
    for (let v = -Math.floor(inner / GRID_STEP) * GRID_STEP; v <= inner; v += GRID_STEP) pts.push(-inner, v, z, inner, v, z, v, -inner, z, v, inner, z);
    const edge = roundedRectShape(size - 2 * PLATE_INSET, size - 2 * PLATE_INSET, Math.max(1, PLATE_RADIUS - PLATE_INSET * 0.5)).getPoints(6);
    const edgePts = [];
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i];
      const b = edge[(i + 1) % edge.length];
      edgePts.push(a.x, a.y, z, b.x, b.y, z);
    }
    const lines = (arr, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false }));
    };
    this.gridLines = new THREE.Group();
    this.gridLines.add(lines(pts, 0.08), lines(edgePts, 0.16));
    this.gridLines.visible = this.gridOn;
    this.benchGroup.add(this.gridLines);
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._invalidate();
  }

  _invalidate() {
    if (this._raf || this._disposed || this._hidden) return;
    this._raf = requestAnimationFrame(() => this._tick());
  }

  _cancelFrame() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _tick() {
    this._raf = 0;
    if (this._disposed || this._hidden) return;
    const moving = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (moving) this._invalidate();
  }
}
