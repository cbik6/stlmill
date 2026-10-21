// Three.js "bench" viewport for the clicker generator.
//
// Engine geometry is in millimetres with Z up; the camera is configured Z-up so no
// axis swapping is needed. The body rests on z = 0; cap + design are placed at
// z = assembly.capZ (seated on the switch) in the body frame.
//
//   const viewer = new Viewer(container);
//   viewer.setModel({ parts, bounds, assembly });   // or setModel(result, { capLift }) (legacy)
//   viewer.setReferenceSwitch(geometry | null);
//   viewer.setExploded(bool); viewer.setShowSwitch(bool); viewer.setCutOpen(bool);
//   viewer.setGrid(bool); viewer.setCallouts(bool);
//   viewer.fit(); viewer.dispose();
//
// Rendering is on demand: a frame is drawn when something changed (model, layout, resize,
// controls) and while OrbitControls is still damping; nothing renders while the tab is hidden.
//
// Dimension callouts are thin orange lines on the plate plus CSS2D labels
// (<div class="ck-callout" data-axis="width|height">35.0 mm</div>); the page styles `.ck-callout`.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const PLATE_SIZE = 120; // mm, square
const PLATE_THICKNESS = 1.5; // mm, top face at z = 0
const PLATE_RADIUS = 6; // mm corner radius
const PLATE_INSET = 4; // mm from the edge to the inset line
const GRID_STEP = 10; // mm
// Material colour a notch under the page's flat #2b2b2b bench so the *lit* plate renders at
// about that value and its edges melt into the CSS bench instead of reading as a lighter slab.
const PLATE_COLOR = 0x232323;
const GRID_OPACITY = 0.08;
const INSET_OPACITY = 0.16;
const CALLOUT_COLOR = 0xf07a2a;
const CALLOUT_GAP = 5; // mm between the body and a dimension line
const CALLOUT_TICK = 2.4; // mm end ticks
const CALLOUT_LABEL_OFFSET = 1.5; // mm from the line to the label anchor
// Where a label may sit along its dimension line (fraction of the line), nearest-to-centre first.
const LABEL_SLOTS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9, 0, 1];
const OBSTACLE_PAD = 4; // px kept clear around an obstacle rect
// The plate (and its grid) fade out in the top band of the canvas so the far edge never
// shows under the page's floating toolbar, whatever the orbit. Fractions of the canvas
// height measured from the bottom: fully opaque below FADE_START, gone above FADE_END.
const FADE_START = 0.78;
const FADE_END = 0.93;
const SHADOW_INTENSITY = 0.7; // key-light shadow strength with a full model
const SHADOW_INTENSITY_BARE = 0.35; // with a bare body (no cap/design) the shadow reads as a blob
const EXPLODE_CAP = 25; // mm
const EXPLODE_SWITCH = 10; // mm
// The engine's CSG output is non-indexed with flat per-face normals, so the thin facets on
// curved walls shade as stripes. The viewer displays its own copy with normals smoothed
// across edges below this crease angle (sharp edges stay sharp); the export mesh is untouched.
const CREASE_ANGLE = THREE.MathUtils.degToRad(50);

// Camera convention: offset from target = (sin az * cos el, cos az * cos el, sin el) * dist,
// so az = 0 is the +Y side and az = 180 deg the -Y side. The engine's cap text has its
// baseline toward -Y (+Y is "up" on the cap), so the readable 3/4 pose sits on the -Y side,
// swung toward +X. (The hub demo rotates its relief 180 deg and therefore uses az = -35.)
const READABLE_AZ = THREE.MathUtils.degToRad(145);
const READABLE_EL = THREE.MathUtils.degToRad(32);

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
    if (o.isCSS2DObject) o.element?.remove();
  });
}

/** Rounded rectangle centred on the origin. */
function roundedRectShape(w, d, r) {
  const hw = w / 2;
  const hd = d / 2;
  const rr = Math.min(r, hw, hd);
  const s = new THREE.Shape();
  s.moveTo(-hw + rr, -hd);
  s.lineTo(hw - rr, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + rr);
  s.lineTo(hw, hd - rr);
  s.quadraticCurveTo(hw, hd, hw - rr, hd);
  s.lineTo(-hw + rr, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - rr);
  s.lineTo(-hw, -hd + rr);
  s.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  return s;
}

function lineSegments(points, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(g, material);
}

/** Display copy of an engine part geometry with crease-aware smooth normals. */
function displayGeometry(geo) {
  try {
    return toCreasedNormals(geo, CREASE_ANGLE);
  } catch (_) {
    const copy = geo.clone();
    if (!copy.attributes.normal) copy.computeVertexNormals();
    return copy;
  }
}

/** Normalise a DOMRect / {x,y,width,height} / {left,top,right,bottom} to padded edges. */
function toEdges(r, pad) {
  if (!r) return null;
  const left = Number.isFinite(r.left) ? r.left : r.x;
  const top = Number.isFinite(r.top) ? r.top : r.y;
  const right = Number.isFinite(r.right) ? r.right : left + (r.width || 0);
  const bottom = Number.isFinite(r.bottom) ? r.bottom : top + (r.height || 0);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return { left: left - pad, top: top - pad, right: right + pad, bottom: bottom + pad };
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function offsetFor(az, el) {
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
}

export class Viewer {
  /**
   * @param {HTMLElement} container element that will host the canvas (and the label layer)
   */
  constructor(container) {
    this.container = container;
    this.exploded = false;
    this.showSwitch = false;
    this.cutOpen = false;
    this.capLift = 0;
    this.bounds = { x: 35, y: 35, z: 16.5 };
    this.capBounds = { x: 0, y: 0, z: 0 };
    this.hasModel = false;
    this._fitted = false;
    this._fitExtent = 0;
    this._disposed = false;
    this._dirty = true;
    this._raf = 0;
    this._hidden = typeof document !== 'undefined' && document.hidden;
    this._obstacles = []; // padded canvas-local rects the callout labels must avoid
    this._labels = []; // { obj, from, to, offset } per callout label
    this._fade = { value: new THREE.Vector3(1, FADE_START, FADE_END) }; // x = drawing-buffer height

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    // --- renderer (transparent clear colour; the page's bench ground shows through)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is deprecated in r186; soften via shadow.radius
    renderer.localClippingEnabled = true;
    renderer.domElement.classList.add('ck-canvas');
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    // --- CSS2D label layer for the callouts
    const labelRenderer = new CSS2DRenderer();
    const labelEl = labelRenderer.domElement;
    labelEl.classList.add('ck-labels');
    labelEl.style.position = 'absolute';
    labelEl.style.top = '0';
    labelEl.style.left = '0';
    labelEl.style.pointerEvents = 'none';
    labelEl.style.overflow = 'hidden';
    container.appendChild(labelEl);
    this.labelRenderer = labelRenderer;

    this.scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 2000);
    camera.up.set(0, 0, 1);
    camera.position.copy(offsetFor(READABLE_AZ, READABLE_EL).multiplyScalar(110)).add(new THREE.Vector3(0, 0, 8));
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 10;
    controls.maxDistance = 600;
    controls.maxPolarAngle = Math.PI * 0.52; // don't go far under the build plate
    controls.target.set(0, 0, 8);
    controls.addEventListener('change', () => this._invalidate());
    this.controls = controls;

    // --- lights: hemisphere + key with soft shadows + weak fill
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x2a2c30, 1.15);
    this.hemi.position.set(0, 0, 1);
    this.scene.add(this.hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    // High and to the camera's right of the readable pose: the shadow falls behind-left of
    // the body where the 3/4 camera sees it on the plate; the cap top stays brightest.
    // (camera right is +X here, i.e. a smaller azimuth.)
    key.position.copy(offsetFor(READABLE_AZ - THREE.MathUtils.degToRad(40), THREE.MathUtils.degToRad(58)).multiplyScalar(160));
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.06; // ~1 shadow texel at the default frustum; kills acne on the body walls
    key.shadow.radius = 5;
    key.shadow.intensity = SHADOW_INTENSITY;
    const sc = key.shadow.camera;
    sc.near = 40;
    sc.far = 400;
    sc.left = sc.bottom = -60;
    sc.right = sc.top = 60;
    this.scene.add(key);
    this.scene.add(key.target);
    this.key = key;

    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.copy(offsetFor(READABLE_AZ - THREE.MathUtils.degToRad(120), THREE.MathUtils.degToRad(25)).multiplyScalar(160));
    this.scene.add(fill);

    // --- build plate: recessed charcoal slab, top at z = 0, with grid and inset edge
    this.plate = this._makePlate();
    this.scene.add(this.plate);
    this.grid = this._makeGrid();
    this.scene.add(this.grid);

    // --- model containers
    this.modelGroup = new THREE.Group();
    this.bodyGroup = new THREE.Group(); // body (+ ring, unioned by the engine)
    this.capGroup = new THREE.Group(); // cap + design
    this.modelGroup.add(this.bodyGroup, this.capGroup);
    this.scene.add(this.modelGroup);
    this.switchMesh = null;

    // --- dimension callouts
    this.callouts = new THREE.Group();
    this.callouts.name = 'callouts';
    this.scene.add(this.callouts);
    this._calloutMaterial = new THREE.LineBasicMaterial({ color: CALLOUT_COLOR, transparent: true, opacity: 0.95, depthWrite: false });
    this._updateCallouts();

    // --- clipping plane (keeps x <= 0); the plate is never clipped
    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.clippedMaterials = [];

    // --- resize + visibility
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

  // ------------------------------------------------------------ public API

  /**
   * Replace the displayed model.
   * @param {{parts:Array<{name:string, geometry:THREE.BufferGeometry, color:string}>, bounds:{x:number,y:number,z:number}, assembly?:{capZ:number, capBounds?:{x:number,y:number,z:number}}}} result
   * @param {{capLift?:number}} [layout] legacy: cap/design translation along Z when no assembly is given
   */
  setModel(result, layout) {
    this._clearGroup(this.bodyGroup);
    this._clearGroup(this.capGroup);
    this.clippedMaterials = this.clippedMaterials.filter((m) => m.userData?.isSwitch);

    const assembly = result?.assembly;
    this.capLift = Number.isFinite(assembly?.capZ) ? assembly.capZ : layout?.capLift ?? 0;
    if (result?.bounds) this.bounds = { ...result.bounds };
    if (assembly?.capBounds) this.capBounds = { ...assembly.capBounds };

    let count = 0;
    let dressed = false; // has a cap or design on top of the body
    for (const part of result?.parts || []) {
      if (!part?.geometry) continue;
      const geo = displayGeometry(part.geometry); // the viewer owns (and disposes) this copy
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color || '#999999'),
        roughness: 0.55,
        metalness: 0.05,
        // A flush inlay shares its boundary surface with the cap; pull it a hair toward
        // the camera so the two don't z-fight along the edge.
        ...(part.name === 'design' ? { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 } : {}),
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = part.name;
      if (part.name === 'cap' || part.name === 'design') {
        this.capGroup.add(mesh);
        mesh.renderOrder = 1;
        dressed = true;
      } else {
        this.bodyGroup.add(mesh);
        mat.userData.clippable = true;
        this.clippedMaterials.push(mat);
      }
      count++;
    }
    this.hasModel = count > 0;
    this.key.shadow.intensity = dressed ? SHADOW_INTENSITY : SHADOW_INTENSITY_BARE;

    this._updateShadowFrustum();
    this._applyLayout();
    this._applyClipping();
    this._updateCallouts();

    const extent = Math.max(this.bounds.x, this.bounds.y, this.bounds.z);
    if (!this._fitted) {
      this.fit();
      this._fitted = true;
    } else if (this._fitExtent && Math.abs(extent - this._fitExtent) / this._fitExtent > 0.3) {
      this._frame(true); // size jumped: keep the user's view direction, refit the distance
    }
    this._invalidate();
  }

  /** Reference MX switch geometry (engine positions it for the assembled body). */
  setReferenceSwitch(geometry) {
    if (this.switchMesh) {
      this.scene.remove(this.switchMesh);
      disposeObject(this.switchMesh);
      this.clippedMaterials = this.clippedMaterials.filter((m) => !m.userData?.isSwitch);
      this.switchMesh = null;
    }
    if (geometry) {
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
    }
    this._applyLayout();
    this._applyClipping();
    this._invalidate();
  }

  setExploded(on) {
    this.exploded = !!on;
    this._applyLayout();
    this._invalidate();
  }

  setShowSwitch(on) {
    this.showSwitch = !!on;
    this._applyLayout();
    this._invalidate();
  }

  setCutOpen(on) {
    this.cutOpen = !!on;
    this._applyClipping();
    this._invalidate();
  }

  setGrid(on) {
    this.grid.visible = !!on;
    this._invalidate();
  }

  setCallouts(on) {
    this._calloutsOn = !!on;
    this.callouts.visible = this._calloutsOn && this.hasModel;
    this._invalidate();
  }

  /**
   * Page overlays the callout labels must stay clear of (export dock, warning slip, ...).
   * @param {Array<DOMRect|{x,y,width,height}|{left,top,right,bottom}>} rects canvas-local pixels
   */
  setObstacles(rects) {
    this._obstacles = (Array.isArray(rects) ? rects : []).map((r) => toEdges(r, OBSTACLE_PAD)).filter(Boolean);
    this._invalidate();
  }

  /** Frame the current model from the readable 3/4 pose. */
  fit() {
    this._frame(false);
    this._invalidate();
  }

  dispose() {
    this._disposed = true;
    this._cancelFrame();
    this._ro.disconnect();
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.controls.dispose();
    this._clearGroup(this.bodyGroup);
    this._clearGroup(this.capGroup);
    this.setReferenceSwitch(null);
    this._clearGroup(this.callouts);
    this._calloutMaterial.dispose();
    disposeObject(this.plate);
    disposeObject(this.grid);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
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
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.updateProjectionMatrix();
  }

  /** Total assembled height (body, or cap top when it stands above the rim), plus explode lift. */
  _topZ() {
    const capTop = this.capLift + (this.capBounds?.z || 0);
    return Math.max(this.bounds.z, capTop, 10) + (this.exploded ? EXPLODE_CAP : 0);
  }

  /**
   * Place the camera so the model (and its callouts) fit the viewport.
   * @param {boolean} keepDirection true keeps the current orbit direction, false uses the readable pose
   */
  _frame(keepDirection) {
    const b = this.bounds;
    const topZ = this._topZ();
    const margin = CALLOUT_GAP + CALLOUT_TICK;
    const hx = b.x / 2 + margin;
    const hy = b.y / 2 + margin;
    const hz = topZ / 2;
    const radius = Math.sqrt(hx * hx + hy * hy + hz * hz);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (this.camera.aspect || 1));
    const fov = Math.min(vFov, hFov);
    // The bounding sphere is conservative for a flat box seen from 32 deg up; 0.9 keeps the
    // callout labels inside the frame while the model fills a good share of it.
    const dist = (radius / Math.sin(fov / 2)) * 0.9;

    const target = new THREE.Vector3(0, 0, topZ * 0.42);
    let dir;
    if (keepDirection) {
      dir = this.camera.position.clone().sub(this.controls.target);
      if (dir.lengthSq() < 1e-6) dir = offsetFor(READABLE_AZ, READABLE_EL);
      dir.normalize();
    } else {
      dir = offsetFor(READABLE_AZ, READABLE_EL);
    }
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.1, dist / 200);
    this.camera.far = dist * 20 + PLATE_SIZE;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this._fitExtent = Math.max(b.x, b.y, b.z);
  }

  _makePlate() {
    const shape = roundedRectShape(PLATE_SIZE, PLATE_SIZE, PLATE_RADIUS);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: PLATE_THICKNESS, bevelEnabled: false, curveSegments: 8 });
    geo.translate(0, 0, -PLATE_THICKNESS); // top face at z = 0
    geo.computeVertexNormals();
    const mat = this._fadeMaterial(new THREE.MeshStandardMaterial({ color: PLATE_COLOR, roughness: 0.9, metalness: 0.0 }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'build-plate';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  _makeGrid() {
    const inner = PLATE_SIZE / 2 - PLATE_INSET; // grid lives inside the inset edge
    const z = 0.02;
    const pts = [];
    for (let v = -Math.floor(inner / GRID_STEP) * GRID_STEP; v <= inner; v += GRID_STEP) {
      pts.push(-inner, v, z, inner, v, z);
      pts.push(v, -inner, z, v, inner, z);
    }
    const gridMat = this._fadeMaterial(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: GRID_OPACITY, depthWrite: false }));
    const grid = lineSegments(pts, gridMat);
    grid.renderOrder = -1;

    // Inset edge: a rounded loop a few mm inside the plate rim.
    const edgePts = roundedRectShape(PLATE_SIZE - 2 * PLATE_INSET, PLATE_SIZE - 2 * PLATE_INSET, Math.max(1, PLATE_RADIUS - PLATE_INSET * 0.5)).getPoints(6);
    const edge = [];
    for (let i = 0; i < edgePts.length; i++) {
      const a = edgePts[i];
      const b = edgePts[(i + 1) % edgePts.length];
      edge.push(a.x, a.y, z, b.x, b.y, z);
    }
    const edgeMat = this._fadeMaterial(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: INSET_OPACITY, depthWrite: false }));
    const inset = lineSegments(edge, edgeMat);
    inset.renderOrder = -1;

    const group = new THREE.Group();
    group.name = 'grid';
    group.add(grid, inset);
    return group;
  }

  /** Screen-space fade of a plate material in the top band of the canvas (see FADE_START). */
  _fadeMaterial(mat) {
    const fade = this._fade;
    mat.transparent = true;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uPlateFade = fade;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uPlateFade;')
        .replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\n\tgl_FragColor.a *= 1.0 - smoothstep(uPlateFade.y, uPlateFade.z, gl_FragCoord.y / uPlateFade.x);',
        );
    };
    mat.customProgramCacheKey = () => 'ck-plate-fade';
    return mat;
  }

  _makeLabel(text, axis) {
    const el = document.createElement('div');
    el.className = 'ck-callout';
    el.dataset.axis = axis;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.name = `callout-${axis}`;
    return obj;
  }

  /** Rebuild the dimension callouts from the current bounds. */
  _updateCallouts() {
    this._clearGroup(this.callouts);
    this._labels = [];
    if (this._calloutsOn === undefined) this._calloutsOn = true;
    this.callouts.visible = this._calloutsOn && this.hasModel;
    if (!this.hasModel) return;

    const b = this.bounds;
    const hx = b.x / 2;
    const hy = b.y / 2;
    const z0 = 0.08;
    const t = CALLOUT_TICK / 2;
    const yLine = -hy - CALLOUT_GAP; // in front of the body (the readable camera is on the -Y side)
    const xLine = hx + CALLOUT_GAP; // beside the body, on the camera's right
    const h = b.z;
    const pts = [
      // width line + end ticks
      -hx, yLine, z0, hx, yLine, z0,
      -hx, yLine - t, z0, -hx, yLine + t, z0,
      hx, yLine - t, z0, hx, yLine + t, z0,
      // height line + end ticks (standing at the front-right corner)
      xLine, -hy, 0, xLine, -hy, h,
      xLine - t, -hy, 0, xLine + t, -hy, 0,
      xLine - t, -hy, h, xLine + t, -hy, h,
    ];
    const lines = lineSegments(pts, this._calloutMaterial);
    lines.renderOrder = 3;
    this.callouts.add(lines);

    const width = this._makeLabel(`${b.x.toFixed(1)} mm`, 'width');
    width.center.set(0.5, 0); // hang below the line
    this.callouts.add(width);

    const height = this._makeLabel(`${h.toFixed(1)} mm`, 'height');
    height.center.set(0, 0.5); // sit to the right of the line
    this.callouts.add(height);

    // Each label slides along its line (from -> to) to dodge page overlays; see _placeLabels.
    this._labels = [
      { obj: width, from: new THREE.Vector3(-hx, yLine, z0), to: new THREE.Vector3(hx, yLine, z0), offset: new THREE.Vector3(0, -CALLOUT_LABEL_OFFSET, 0) },
      { obj: height, from: new THREE.Vector3(xLine, -hy, 0), to: new THREE.Vector3(xLine, -hy, h), offset: new THREE.Vector3(CALLOUT_LABEL_OFFSET, 0, 0) },
    ];
    for (const l of this._labels) l.obj.position.copy(l.from).lerp(l.to, 0.5).add(l.offset);
  }

  /**
   * Slide each callout label along its dimension line to the clear slot nearest the middle:
   * inside the canvas, off every obstacle rect and off the labels already placed. Hidden when
   * no slot is clear. Runs after a label pass so the elements have a measurable size.
   */
  _placeLabels() {
    if (!this.callouts.visible || !this._labels.length) return false;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const canvas = { left: 0, top: 0, right: w, bottom: h };
    const taken = [...this._obstacles];
    const p = new THREE.Vector3();
    let changed = false;
    for (const l of this._labels) {
      const el = l.obj.element;
      const lw = el.offsetWidth;
      const lh = el.offsetHeight;
      if (!lw || !lh) continue; // not laid out yet (display:none); the next pass will place it
      let spot = null;
      for (const t of LABEL_SLOTS) {
        p.copy(l.from).lerp(l.to, t).add(l.offset);
        const s = p.clone().project(this.camera);
        if (s.z < -1 || s.z > 1) continue;
        const px = ((s.x + 1) / 2) * w;
        const py = ((1 - s.y) / 2) * h;
        const rect = { left: px - l.obj.center.x * lw, top: py - l.obj.center.y * lh };
        rect.right = rect.left + lw;
        rect.bottom = rect.top + lh;
        if (rect.left < canvas.left || rect.top < canvas.top || rect.right > canvas.right || rect.bottom > canvas.bottom) continue;
        if (taken.some((o) => intersects(rect, o))) continue;
        spot = p.clone();
        taken.push(rect);
        break;
      }
      const visible = spot !== null;
      if (visible && !l.obj.position.equals(spot)) {
        l.obj.position.copy(spot);
        changed = true;
      }
      // Hide with `visibility` (not CSS2D's display:none) so a hidden label keeps its layout
      // size and can be measured, and re-shown, on later passes.
      const vis = visible ? '' : 'hidden';
      if (el.style.visibility !== vis) {
        el.style.visibility = vis;
        changed = true;
      }
    }
    return changed;
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this._fade.value.x = Math.max(1, this.renderer.getDrawingBufferSize(new THREE.Vector2()).y);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._invalidate();
  }

  // --- render on demand
  _invalidate() {
    this._dirty = true;
    this._requestFrame();
  }

  _requestFrame() {
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
    this._dirty = false;
    const moving = this.controls.update(); // true while damping; fires 'change' -> _invalidate
    this._render();
    if (moving || this._dirty) this._requestFrame();
  }

  _render() {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera); // mounts the label elements so they can be measured
    if (this._placeLabels()) this.labelRenderer.render(this.scene, this.camera);
  }
}
