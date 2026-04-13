/**
 * threeSetup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Three.js renderer for the 3D object that tracks the detected face.
 *
 * LAYER POSITION
 * ──────────────
 * This renderer sits on #three-canvas at z-index 1 — above the camera feed
 * (z-index 0) and below the Hydra canvas (z-index 2). The canvas uses
 * alpha: true so both the camera and Hydra show through when no object
 * is rendered, and pointer-events: none so taps fall through to the document.
 *
 * COORDINATE SYSTEM
 * ─────────────────
 * An OrthographicCamera maps face coords directly to screen space:
 *   left/right = ±aspect,  top/bottom = ±1
 *
 * arState.faceX (0–1, 0=left)  → Three.js x = (faceX * 2 − 1) * aspect
 * arState.faceY (0–1, 0=top)   → Three.js y = −(faceY * 2 − 1)
 * arState.faceSize (0–1)       → uniform scale, tuned so a typical selfie
 *                                  face (faceSize ≈ 0.3) fills the face oval
 * arState.headTilt (−1 to 1)   → Z rotation, mirrors the head angle
 *
 * MODEL LOADING
 * ─────────────
 * Expects a GLB file served from /public (referenced as '/model.glb').
 * On load the model is normalised to a 1-unit bounding box so the scale
 * factor above is predictable regardless of the source asset's original size.
 *
 * The object is hidden when no face is detected and shown once one appears.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class ThreeSetup {
  /**
   * @param {string} canvasId  — id of the <canvas> element in index.html
   */
  constructor(canvasId) {
    this._canvas   = document.getElementById(canvasId);
    this._renderer = null;
    this._scene    = null;
    this._camera   = null;
    this._object   = null;  // the loaded GLB scene root
    this._raf      = null;
    this._arState  = null;
  }

  /**
   * init()
   * ──────
   * Creates the Three.js renderer and scene. Call once on page load before
   * any user gesture — no permissions required.
   */
  init() {
    this._renderer = new THREE.WebGLRenderer({
      canvas:    this._canvas,
      alpha:     true,   // transparent background — camera + Hydra show through
      antialias: true,
    });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.setClearColor(0x000000, 0); // fully transparent clear

    // OrthographicCamera: world-space x spans ±aspect, y spans ±1.
    // This lets us map normalised face coords to world coords with simple math.
    const aspect = window.innerWidth / window.innerHeight;
    this._camera = new THREE.OrthographicCamera(
      -aspect, aspect,  // left, right
       1,      -1,      // top, bottom
       0.1,    100      // near, far
    );
    this._camera.position.z = 5;

    this._scene = new THREE.Scene();

    // Soft ambient fill + directional key light so the model reads clearly
    // against both the camera feed and the Hydra glitch layer.
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this._scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 3);
    this._scene.add(key);

    window.addEventListener('resize', () => this._onResize());
  }

  /**
   * loadModel(path)
   * ───────────────
   * Loads a GLB asset from `path` (e.g. '/model.glb').
   * The model is normalised to a 1-unit bounding box on load so scaling
   * by arState.faceSize gives consistent, predictable results.
   *
   * The object is added to the scene but hidden until a face is detected.
   *
   * @param {string} path  — URL of the .glb file (place in /public)
   */
  loadModel(path) {
    const loader = new GLTFLoader();

    loader.load(
      path,
      (gltf) => {
        this._object = gltf.scene;

        // Compute bounding box of the whole model.
        const box    = new THREE.Box3().setFromObject(this._object);
        const size   = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        // Normalise: scale so the longest axis = 1 unit.
        const maxDim = Math.max(size.x, size.y, size.z);
        const norm   = 1 / maxDim;
        this._object.scale.setScalar(norm);

        // Re-centre at origin after normalisation.
        this._object.position.copy(center).multiplyScalar(-norm);

        this._object.visible = false; // hidden until face detected
        this._scene.add(this._object);

        console.log(`[Three] Model loaded: ${path}`);
      },
      undefined,
      (err) => console.error('[Three] Model load error:', err)
    );
  }

  /**
   * start(arState)
   * ───────────────
   * Begins the render loop and starts reading face data each frame.
   * Call after the user gesture (inside app.js _start()) so we have a
   * live arState reference.
   *
   * @param {object} arState  — live reference from ARSystem.arState
   */
  start(arState) {
    this._arState = arState;
    this._loop();
  }

  /**
   * stop()
   * ───────
   * Cancels the render loop (e.g. on camera switch).
   */
  stop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    this._update();
    this._renderer.render(this._scene, this._camera);
  }

  /**
   * _update()
   * ──────────
   * Runs every frame. Maps arState face values to the 3D object's
   * position, scale, and rotation in orthographic world space.
   */
  _update() {
    if (!this._object || !this._arState) return;

    const ar     = this._arState;
    const aspect = window.innerWidth / window.innerHeight;

    if (ar.faceDetected) {
      this._object.visible = true;

      // Map normalised face centre to orthographic world coords.
      // faceX 0→1 : left edge (−aspect) to right edge (+aspect)
      // faceY 0→1 : top (+1) to bottom (−1) — Three.js y-up, CSS y-down
      this._object.position.x = (ar.faceX * 2 - 1) * aspect;
      this._object.position.y = -(ar.faceY * 2 - 1);
      this._object.position.z = 0;

      // Scale: faceSize is face-width / video-width (0–1).
      // Tune this multiplier to fit the object to the face oval.
      this._object.scale.setScalar(ar.faceSize * 0.8);

      // Head tilt → Z rotation so the object leans with the head.
      // headTilt −1…1 maps to roughly ±23° (0.4 rad).
      this._object.rotation.z = -ar.headTilt * 0.4;

    } else {
      this._object.visible = false;
    }
  }

  _onResize() {
    const w      = window.innerWidth;
    const h      = window.innerHeight;
    const aspect = w / h;

    this._renderer.setSize(w, h);

    this._camera.left  = -aspect;
    this._camera.right =  aspect;
    this._camera.updateProjectionMatrix();
  }
}
