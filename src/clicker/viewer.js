// Three.js viewport for the clicker generator.
// Engine geometry is in millimetres with Z up; the camera is configured Z-up so
// no axis swapping is needed.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const PLATE_SIZE = 256; // mm
const GRID_STEP = 10; // mm
const EXPLODE_CAP = 25; // mm
const EXPLODE_SWITCH = 10; // mm

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

export class Viewer {
  /**
   * @param {HTMLElement} container element that will host the canvas
   */
  constructor(container) {
    this.container = container;
    this.exploded = false;
    this.showSwitch = false;
    this.cutOpen = false;
    this.capLift = 0;
    this.bounds = { x: 35, y: 35, z: 15 };
    this._fitted = false;
    this._disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    renderer.domElement.classList.add('ck-canvas');
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
    camera.up.set(0, 0, 1);
    camera.position.set(60, -70, 55);
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 10;
    controls.maxDistance = 600;
    controls.maxPolarAngle = Math.PI * 0.52; // don't go far under the build plate
    controls.target.set(0, 0, 8);
    this.controls = controls;

    // --- lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 1.1);
    this.hemi.position.set(0, 0, 1);
    this.scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(70, -90, 130);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    const sc = sun.shadow.camera;
    sc.near = 20;
    sc.far = 400;
    sc.left = sc.bottom = -60;
    sc.right = sc.top = 60;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-80, 60, 40);
    this.scene.add(fill);

    // --- build plate: shadow catcher + grid
    const plateGeo = new THREE.PlaneGeometry(PLATE_SIZE, PLATE_SIZE);
    const plateMat = new THREE.ShadowMaterial({ opacity: 0.22 });
    this.plate = new THREE.Mesh(plateGeo, plateMat);
    this.plate.receiveShadow = true;
    this.plate.position.z = -0.01;
    this.scene.add(this.plate);

    this.grid = this._makeGrid();
    this.scene.add(this.grid);

    // --- model containers
    this.modelGroup = new THREE.Group();
    this.bodyGroup = new THREE.Group(); // body + ring
    this.capGroup = new THREE.Group(); // cap + design
    this.modelGroup.add(this.bodyGroup, this.capGroup);
    this.scene.add(this.modelGroup);
    this.switchMesh = null;

    // --- clipping plane (keeps x <= 0)
    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.clippedMaterials = [];

    // --- resize + theme
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._resize();

    this._themeObserver = new MutationObserver(() => this._applyTheme());
    this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    this._applyTheme();

    this._onVisibility = () => {
      if (document.hidden) this._stop();
      else this._start();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
    this._start();
  }

  // ------------------------------------------------------------ public API

  /**
   * Replace the displayed model.
   * @param {{parts:Array<{name:string, geometry:THREE.BufferGeometry, color:string}>, bounds:{x:number,y:number,z:number}}} result
   * @param {{capLift:number}} layout  cap/design translation along Z (body.height - rimHeight)
   */
  setModel(result, layout) {
    this._clearGroup(this.bodyGroup);
    this._clearGroup(this.capGroup);
    this.clippedMaterials = this.clippedMaterials.filter((m) => m.userData?.isSwitch);

    this.capLift = layout?.capLift ?? 0;
    if (result?.bounds) this.bounds = { ...result.bounds };

    for (const part of result?.parts || []) {
      if (!part?.geometry) continue;
      const geo = part.geometry;
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color || '#999999'),
        roughness: 0.55,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = part.name;
      if (part.name === 'cap' || part.name === 'design') {
        this.capGroup.add(mesh);
        mesh.renderOrder = 1;
      } else {
        this.bodyGroup.add(mesh);
        mat.userData.clippable = true;
        this.clippedMaterials.push(mat);
      }
    }

    this._updateShadowFrustum();
    this._applyLayout();
    this._applyClipping();
    if (!this._fitted) {
      this.fit();
      this._fitted = true;
    }
  }

  /** Reference MX switch geometry (engine positions it for the assembled body). */
  setReferenceSwitch(geometry) {
    if (this.switchMesh) {
      this.scene.remove(this.switchMesh);
      disposeObject(this.switchMesh);
      this.clippedMaterials = this.clippedMaterials.filter((m) => !m.userData?.isSwitch);
      this.switchMesh = null;
    }
    if (!geometry) return;
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x30343a,
      roughness: 0.6,
      metalness: 0.1,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    mat.userData.isSwitch = true;
    mat.userData.clippable = true;
    this.clippedMaterials.push(mat);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = 'reference-switch';
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    this.switchMesh = mesh;
    this.scene.add(mesh);
    this._applyLayout();
    this._applyClipping();
  }

  setExploded(on) {
    this.exploded = !!on;
    this._applyLayout();
  }

  setShowSwitch(on) {
    this.showSwitch = !!on;
    this._applyLayout();
  }

  setCutOpen(on) {
    this.cutOpen = !!on;
    this._applyClipping();
  }

  /** Frame the current model. */
  fit() {
    const b = this.bounds;
    const radius = Math.max(b.x, b.y, (b.z + (this.exploded ? EXPLODE_CAP : 0)) * 1.2, 20) * 0.5;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2) * 1.35;
    const dir = new THREE.Vector3(0.85, -1, 0.75).normalize();
    const target = new THREE.Vector3(0, 0, Math.max(b.z, 10) * 0.45);
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.1, dist / 200);
    this.camera.far = dist * 20 + PLATE_SIZE;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  dispose() {
    this._disposed = true;
    this._stop();
    this._ro.disconnect();
    this._themeObserver.disconnect();
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.controls.dispose();
    this._clearGroup(this.bodyGroup);
    this._clearGroup(this.capGroup);
    this.setReferenceSwitch(null);
    disposeObject(this.plate);
    disposeObject(this.grid);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------ internals

  _clearGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeObject(child);
    }
  }

  _applyLayout() {
    const lift = this.capLift + (this.exploded ? EXPLODE_CAP : 0);
    this.capGroup.position.set(0, 0, lift);
    if (this.switchMesh) {
      this.switchMesh.visible = this.showSwitch;
      this.switchMesh.position.set(0, 0, this.exploded ? EXPLODE_SWITCH : 0);
    }
  }

  _applyClipping() {
    const planes = this.cutOpen ? [this.clipPlane] : [];
    for (const m of this.clippedMaterials) {
      m.clippingPlanes = planes;
      m.side = this.cutOpen ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    }
  }

  _updateShadowFrustum() {
    const r = Math.max(this.bounds.x, this.bounds.y, 30) * 0.9 + EXPLODE_CAP;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.updateProjectionMatrix();
  }

  _makeGrid() {
    const half = PLATE_SIZE / 2;
    const pts = [];
    // 10 mm lines centred on the origin, clipped to the 256 mm plate
    for (let v = -Math.floor(half / GRID_STEP) * GRID_STEP; v <= half; v += GRID_STEP) {
      if (v === 0) continue;
      pts.push(-half, v, 0, half, v, 0);
      pts.push(v, -half, 0, v, half, 0);
    }
    const axisPts = [-half, 0, 0, half, 0, 0, 0, -half, 0, 0, half, 0];
    const border = [
      -half, -half, 0, half, -half, 0,
      half, -half, 0, half, half, 0,
      half, half, 0, -half, half, 0,
      -half, half, 0, -half, -half, 0,
    ];
    const group = new THREE.Group();
    const mk = (arr, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const m = new THREE.LineBasicMaterial({ transparent: true, opacity, depthWrite: false });
      const lines = new THREE.LineSegments(g, m);
      lines.renderOrder = -1;
      return lines;
    };
    group.add(mk(pts, 0.35), mk(axisPts, 0.6), mk(border, 0.7));
    group.position.z = -0.02;
    return group;
  }

  _applyTheme() {
    const border = new THREE.Color(cssVar('--border', '#c9ced6'));
    const muted = new THREE.Color(cssVar('--muted', '#6b7280'));
    this.grid.children.forEach((l, i) => l.material.color.copy(i === 0 ? border : muted));
    const dark = document.documentElement.dataset.theme === 'dark';
    this.plate.material.opacity = dark ? 0.45 : 0.22;
    this.hemi.groundColor.set(dark ? 0x1a1d24 : 0x5a606c);
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._render();
  }

  _start() {
    if (this._raf || this._disposed) return;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.controls.update();
      this._render();
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _render() {
    this.renderer.render(this.scene, this.camera);
  }
}
