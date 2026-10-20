// Live 3D "clicker" preview for the STLmill landing page.
//
// A keyboard-switch fidget: dark rounded body, light keycap, and the user's text
// as raised relief on the cap. Rebuilds the relief as the text changes. This is a
// preview only - no switch cutouts, no CSG, no export. It reuses the engine's
// raster/trace pipeline (text -> alpha mask -> contours -> THREE.Shape[]).
//
// World is Z-up and in millimetres, matching the generator's viewer.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { flipMaskY, maskBounds } from '../clicker/engine/raster.js';
import { traceBitmap } from '../clicker/engine/trace.js';

const MAX_CHARS = 12;
const RELIEF_HEIGHT = 1.2; // mm
const TURN_SECONDS = 12; // idle rotation period
const FONT_FAMILY = '"Barlow Semi Condensed", "Arial Black", sans-serif';
const RASTER_W = 512;
const RASTER_H = 256;
const RASTER_PAD = 12; // px kept clear around the glyphs so nothing touches the edge

const DEFAULT_COLORS = { body: '#2B2B2B', cap: '#F5F5F5', design: '#F07A2A' };

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Rounded rectangle centred on the origin, corners as quadratic curves. */
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

/** Dimensions (mm) of body, cap and relief box for a given `size` (longest body side). */
function dims(size) {
  const bodyW = size;
  const bodyD = size * 0.78;
  const bodyH = size * 0.34;
  const bodyR = size * 0.18;
  const inset = 0.12;
  const capW = bodyW * (1 - 2 * inset);
  const capD = bodyD * (1 - 2 * inset);
  const capR = bodyR * (1 - 2 * inset);
  const capT = size * 0.09;
  return {
    bodyW, bodyD, bodyH, bodyR,
    capW, capD, capR, capT,
    boxW: capW * 0.76,
    boxD: capD * 0.6,
    topZ: bodyH + capT,
    totalH: bodyH + capT + RELIEF_HEIGHT,
  };
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose();
  mesh.removeFromParent();
}

// ---------------------------------------------------------------------------
// Text -> traced shapes (pixel space, y-up)
// ---------------------------------------------------------------------------

let rasterCanvas = null;
let rasterCtx = null;

function getRasterContext() {
  if (!rasterCtx) {
    rasterCanvas = document.createElement('canvas');
    rasterCanvas.width = RASTER_W;
    rasterCanvas.height = RASTER_H;
    rasterCtx = rasterCanvas.getContext('2d', { willReadFrequently: true });
  }
  return rasterCtx;
}

/**
 * Render `text` to the offscreen canvas, threshold alpha to a mask and trace it.
 * Returns { shapes, bounds } in y-up pixel space or null when nothing was drawn.
 */
function traceText(text) {
  if (!text) return null;
  const ctx = getRasterContext();
  if (!ctx) return null;
  const w = RASTER_W;
  const h = RASTER_H;

  // Probe at 100px, then pick the largest size that fits the padded canvas.
  ctx.font = `800 100px ${FONT_FAMILY}`;
  const probe = ctx.measureText(text);
  const probeW = Math.max(probe.width, 1);
  const probeA = probe.actualBoundingBoxAscent ?? 75;
  const probeD = probe.actualBoundingBoxDescent ?? 20;
  const probeH = Math.max(probeA + probeD, 1);
  const px = Math.max(
    8,
    Math.floor(Math.min(((w - 2 * RASTER_PAD) / probeW) * 100, ((h - 2 * RASTER_PAD) / probeH) * 100))
  );

  ctx.clearRect(0, 0, w, h);
  ctx.font = `800 ${px}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  const m = ctx.measureText(text);
  const asc = m.actualBoundingBoxAscent ?? px * 0.75;
  const desc = m.actualBoundingBoxDescent ?? px * 0.2;
  // Centre the ink box vertically.
  const baseline = h / 2 + (asc - desc) / 2;
  ctx.fillText(text, w / 2, baseline);

  const rgba = ctx.getImageData(0, 0, w, h).data;
  const down = new Uint8Array(w * h);
  for (let p = 0, a = 3; p < w * h; p++, a += 4) down[p] = rgba[a] >= 128 ? 1 : 0;
  const mask = flipMaskY(down, w, h); // canvas is y-down; the engine wants y-up

  const bounds = maskBounds(mask, w, h);
  if (!bounds) return null;
  const shapes = traceBitmap(mask, w, h, { simplifyTolerance: 0.8, smoothIterations: 1 });
  if (!shapes.length) return null;
  return { shapes, bounds };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Mount a live clicker preview into `container`.
 * @returns {{ setText(text: string): void, setSize(mm: number): void, setColors(colors: object): void, dispose(): void }}
 */
export function createDemoClicker(
  container,
  { text = 'STL', size = 35, colors = DEFAULT_COLORS } = {}
) {
  let currentText = normalizeText(text);
  let currentSize = clampSize(size);
  const currentColors = { ...DEFAULT_COLORS, ...(colors || {}) };

  let disposed = false;
  let running = false;
  let visible = true;
  let raf = 0;
  let fontsReady = false;
  let pendingTextBuild = true; // first build happens once fonts are ready
  let traced = null; // { shapes, bounds } cache so setSize does not re-rasterize

  // --- renderer / canvas
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in r0.186; soften via shadow.radius
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  // --- scene / camera
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 1000);
  camera.up.set(0, 0, 1);

  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.8;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI * 0.5; // never look up from under the shadow plane
  controls.autoRotate = true;
  controls.autoRotateSpeed = 60 / TURN_SECONDS; // OrbitControls: speed 2 = 30 s per turn
  // OrbitControls sets touch-action: none; let vertical page scroll through on touch
  // devices (horizontal drags still rotate the model).
  canvas.style.touchAction = 'pan-y';

  // --- lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 1.4);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 5;
  scene.add(sun);
  scene.add(sun.target);

  // --- materials (updated in place by setColors)
  const bodyMat = new THREE.MeshStandardMaterial({ color: currentColors.body, roughness: 0.6, metalness: 0 });
  const capMat = new THREE.MeshStandardMaterial({ color: currentColors.cap, roughness: 0.6, metalness: 0 });
  const reliefMat = new THREE.MeshStandardMaterial({ color: currentColors.design, roughness: 0.5, metalness: 0 });
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.32 });

  // --- meshes
  const model = new THREE.Group();
  scene.add(model);
  let bodyMesh = null;
  let capMesh = null;
  let reliefMesh = null;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
  ground.receiveShadow = true;
  ground.position.z = -0.05;
  scene.add(ground);

  function buildSolids() {
    const d = dims(currentSize);
    disposeMesh(bodyMesh);
    disposeMesh(capMesh);

    const bodyGeo = new THREE.ExtrudeGeometry(roundedRectShape(d.bodyW, d.bodyD, d.bodyR), {
      depth: d.bodyH,
      bevelEnabled: false,
      curveSegments: 10,
    });
    bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    model.add(bodyMesh);

    const capGeo = new THREE.ExtrudeGeometry(roundedRectShape(d.capW, d.capD, d.capR), {
      depth: d.capT,
      bevelEnabled: false,
      curveSegments: 10,
    });
    capMesh = new THREE.Mesh(capGeo, capMat);
    capMesh.position.z = d.bodyH;
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    model.add(capMesh);

    ground.scale.set(d.bodyW * 6, d.bodyW * 6, 1);

    // Light + shadow frustum scale with the model.
    const s = currentSize;
    // High and to the right, barely in front: the shadow spills out to the left of the
    // body where the 3/4 camera can see it, while the cap top stays the brightest face.
    sun.position.set(s * 1.6, -s * 0.25, s * 2.2);
    const sc = sun.shadow.camera;
    sc.left = -s * 1.1;
    sc.right = s * 1.1;
    sc.top = s * 1.1;
    sc.bottom = -s * 1.1;
    sc.near = s * 0.5;
    sc.far = s * 6;
    sc.updateProjectionMatrix();
  }

  function buildRelief() {
    disposeMesh(reliefMesh);
    reliefMesh = null;
    if (!traced) return;
    const d = dims(currentSize);
    const { shapes, bounds } = traced;
    const bw = bounds.maxX - bounds.minX + 1; // shape vertices sit on pixel corners
    const bh = bounds.maxY - bounds.minY + 1;
    const cx = (bounds.minX + bounds.maxX + 1) / 2;
    const cy = (bounds.minY + bounds.maxY + 1) / 2;
    const s = Math.min(d.boxW / bw, d.boxD / bh);

    let geo;
    try {
      geo = new THREE.ExtrudeGeometry(shapes, {
        depth: RELIEF_HEIGHT / s,
        bevelEnabled: false,
        curveSegments: 1,
      });
    } catch {
      return; // degenerate contour - skip relief rather than throw mid-typing
    }
    geo.translate(-cx, -cy, 0);
    // The opening 3/4 camera sits on the +Y side; turn the text so its baseline faces it.
    geo.rotateZ(Math.PI);
    geo.scale(s, s, s);
    geo.translate(0, 0, d.topZ);
    reliefMesh = new THREE.Mesh(geo, reliefMat);
    reliefMesh.castShadow = true;
    reliefMesh.receiveShadow = false;
    model.add(reliefMesh);
  }

  function rebuildText() {
    traced = traceText(currentText);
    buildRelief();
  }

  // --- camera fitting
  const offset = new THREE.Vector3();
  let cameraInitialised = false;

  function fitCamera() {
    const d = dims(currentSize);
    const hx = d.bodyW / 2;
    const hy = d.bodyD / 2;
    const hz = d.totalH / 2;
    const radius = Math.sqrt(hx * hx + hy * hy + hz * hz);
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const fov = Math.min(vFov, hFov);
    const dist = (radius / Math.sin(fov / 2)) * 1.02;

    controls.target.set(0, 0, hz * 0.9);
    if (!cameraInitialised) {
      // Pleasing 3/4 view: from front-right (-Y is the front), ~32 deg above the plate.
      const az = THREE.MathUtils.degToRad(35);
      const el = THREE.MathUtils.degToRad(32);
      offset.set(Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el));
      cameraInitialised = true;
    } else {
      // Keep whatever angle the user (or the idle spin) has reached; only refit distance.
      offset.copy(camera.position).sub(controls.target).normalize();
    }
    camera.position.copy(offset.multiplyScalar(dist)).add(controls.target);
    camera.lookAt(controls.target);
    controls.update();
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w < 2 || h < 2) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera();
    if (!running) renderer.render(scene, camera);
  }

  // --- render loop (dt from the rAF timestamp; clamped so a resumed tab does not jump)
  let lastTime = 0;

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
    lastTime = now;
    controls.update(dt);
    renderer.render(scene, camera);
  }

  function start() {
    if (running || disposed) return;
    if (!visible || document.hidden) return;
    running = true;
    lastTime = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  // --- interaction: pause idle spin while hovered
  const onEnter = () => { controls.autoRotate = false; };
  const onLeave = () => { controls.autoRotate = true; };
  canvas.addEventListener('pointerenter', onEnter);
  canvas.addEventListener('pointerleave', onLeave);

  // --- visibility
  const onVisibility = () => { if (document.hidden) stop(); else start(); };
  document.addEventListener('visibilitychange', onVisibility);

  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) start();
        else stop();
      }, { threshold: 0 })
    : null;
  io?.observe(container);

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(container);

  // --- fonts: build once ready, rebuild once if the font set changes afterwards
  const onFontsLoaded = () => {
    document.fonts?.removeEventListener('loadingdone', onFontsLoaded);
    if (disposed) return;
    rebuildText();
  };
  const ready = document.fonts?.ready ?? Promise.resolve();
  ready.then(() => {
    if (disposed) return;
    fontsReady = true;
    if (pendingTextBuild) {
      pendingTextBuild = false;
      rebuildText();
      if (!running) renderer.render(scene, camera);
    }
    document.fonts?.addEventListener('loadingdone', onFontsLoaded);
  });

  // --- initial build
  buildSolids();
  resize();
  start();

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------
  function setText(next) {
    if (disposed) return;
    const t = normalizeText(next);
    if (t === currentText && !pendingTextBuild) return;
    currentText = t;
    if (!fontsReady) {
      pendingTextBuild = true;
      return;
    }
    rebuildText();
    if (!running) renderer.render(scene, camera);
  }

  function setSize(mm) {
    if (disposed) return;
    const s = clampSize(mm);
    if (s === currentSize) return;
    currentSize = s;
    buildSolids();
    buildRelief();
    fitCamera();
    if (!running) renderer.render(scene, camera);
  }

  function setColors(next) {
    if (disposed || !next) return;
    Object.assign(currentColors, next);
    if (next.body) bodyMat.color.set(next.body);
    if (next.cap) capMat.color.set(next.cap);
    if (next.design) reliefMat.color.set(next.design);
    if (!running) renderer.render(scene, camera);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    canvas.removeEventListener('pointerenter', onEnter);
    canvas.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    document.fonts?.removeEventListener('loadingdone', onFontsLoaded);
    io?.disconnect();
    ro?.disconnect();
    controls.dispose();
    disposeMesh(bodyMesh);
    disposeMesh(capMesh);
    disposeMesh(reliefMesh);
    ground.geometry.dispose();
    bodyMat.dispose();
    capMat.dispose();
    reliefMat.dispose();
    shadowMat.dispose();
    renderer.dispose();
    canvas.remove();
  }

  return { setText, setSize, setColors, dispose };
}

function normalizeText(text) {
  return String(text ?? '').trim().slice(0, MAX_CHARS);
}

function clampSize(mm) {
  const n = Number(mm);
  if (!isFinite(n)) return 35;
  return Math.min(120, Math.max(10, n));
}
