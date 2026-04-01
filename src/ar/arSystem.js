/**
 * arSystem.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps MindAR face tracking and exposes a live arState object read by the
 * state machine each frame.
 *
 * ARCHITECTURE
 * ────────────
 * MindAR renders into #ar-container (z-index 0) — its Three.js canvas shows
 * the camera feed as a background texture with no additional 3D objects.
 * The Hydra canvas (z-index 1) sits on top; app.js drives its CSS opacity
 * from audioState.level so the camera shows through at silence.
 *
 * FACE DETECTION
 * ──────────────
 * We add a single nose-tip anchor (landmark 1). MindAR sets anchor.group.visible
 * true/false each frame based on whether a face is in frame. We read this
 * flag and write it to arState.faceDetected every animation tick.
 *
 * CAMERA SWITCHING
 * ────────────────
 * MindAR defaults to the front camera ('user' facingMode). For back camera,
 * we swap the video element's srcObject post-start — MindAR's face detection
 * worker reads frames from the same video element regardless of stream source.
 * Switching stops the current instance, clears the container, and reinits.
 *
 * EXPOSED STATE
 * ─────────────
 *   arState.faceDetected  boolean  — true when a face is actively tracked
 *   arState.facingMode    string   — 'user' | 'environment'
 */

export class ARSystem {
  constructor() {
    this.arState = {
      faceDetected: false,
      facingMode:   'user',
    };

    this._mindar     = null;
    this._video      = null;
    this._loopActive = false;
  }

  /**
   * init(facingMode)
   * ─────────────────
   * Two-phase startup:
   *   1. Start a plain camera video stream immediately — camera is visible
   *      regardless of whether MindAR loads successfully.
   *   2. Attempt to load MindAR and layer face tracking on top. If MindAR
   *      fails (import error, three.js resolution, etc.) the camera feed
   *      stays visible and the experience continues without tracking.
   *
   * Must be called from inside a user-gesture handler (camera permission).
   *
   * @param {'user'|'environment'} facingMode — which camera to use
   */
  async init(facingMode = 'user') {
    this.arState.facingMode = facingMode;

    // ── Phase 1: plain camera feed ───────────────────────────────────────────
    // Always runs. Shows camera immediately, independent of MindAR.
    await this._startCameraFallback(facingMode);

    // ── Phase 2: MindAR face tracking ────────────────────────────────────────
    // Attempted on top of the camera feed. Non-fatal if it fails.
    try {
      await this._startMindAR(facingMode);
    } catch (err) {
      console.warn('[AR] Face tracking unavailable, camera-only mode:', err.message ?? err);
    }
  }

  /**
   * _startCameraFallback(facingMode)
   * ─────────────────────────────────
   * Creates a <video> element in #ar-container and starts the camera stream.
   * This is the guaranteed camera layer — visible even if MindAR fails.
   */
  async _startCameraFallback(facingMode) {
    const container = document.getElementById('ar-container');

    this._video = document.createElement('video');
    this._video.setAttribute('autoplay', '');
    this._video.setAttribute('playsinline', '');
    this._video.setAttribute('muted', '');
    this._video.style.cssText = `
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      object-fit: cover;
      transform: ${facingMode === 'user' ? 'scaleX(-1)' : 'none'};
    `;
    container.appendChild(this._video);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this._video.srcObject = stream;

    await new Promise(resolve =>
      this._video.addEventListener('loadedmetadata', resolve, { once: true })
    );

    console.log(`[AR] Camera feed started — facingMode: ${facingMode}`);
  }

  /**
   * _startMindAR(facingMode)
   * ─────────────────────────
   * Loads MindAR via dynamic import and starts face tracking.
   * MindAR will create its own video element and Three.js canvas inside
   * #ar-container on top of the fallback video.
   */
  async _startMindAR(facingMode) {
    const { MindARThree } = await import(
      'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-face-three.prod.js'
    );

    const container = document.getElementById('ar-container');

    this._mindar = new MindARThree({
      container,
      uiLoading:  'no',
      uiScanning: 'no',
      uiError:    'no',
    });

    const { renderer, scene, camera } = this._mindar;

    // Nose-tip anchor — group.visible reflects live face detection state.
    const anchor = this._mindar.addAnchor(1);

    await this._mindar.start();

    if (facingMode === 'environment') {
      await this._swapVideoFacing('environment');
    }

    this._loopActive = true;
    renderer.setAnimationLoop(() => {
      if (!this._loopActive) return;
      renderer.render(scene, camera);

      const detected = anchor.group.visible;
      if (detected !== this.arState.faceDetected) {
        console.log(`[AR] Face ${detected ? 'detected' : 'lost'}`);
      }
      this.arState.faceDetected = detected;
    });

    console.log('[AR] MindAR face tracking started');
  }

  /**
   * switchCamera()
   * ───────────────
   * Toggles between front ('user') and back ('environment') camera.
   * Stops the current MindAR instance, clears the container, and reinits.
   * Causes a brief reload as MindAR re-acquires the camera stream.
   */
  async switchCamera() {
    const next = this.arState.facingMode === 'user' ? 'environment' : 'user';
    await this.stop();
    document.getElementById('ar-container').innerHTML = '';
    await this.init(next);
  }

  /**
   * stop()
   * ───────
   * Halts the animation loop and shuts down MindAR cleanly.
   */
  async stop() {
    this._loopActive = false;

    if (this._mindar) {
      try {
        this._mindar.renderer.setAnimationLoop(null);
        await this._mindar.stop();
      } catch (_) { /* ignore cleanup errors */ }
      this._mindar = null;
    }

    if (this._video?.srcObject) {
      this._video.srcObject.getTracks().forEach(t => t.stop());
      this._video.srcObject = null;
      this._video = null;
    }

    this.arState.faceDetected = false;
  }

  /**
   * _swapVideoFacing(facingMode)
   * ─────────────────────────────
   * Replaces the camera stream on MindAR's video element.
   * MindAR's face detection reads frames from the video element each tick,
   * so swapping srcObject redirects detection to the new camera.
   *
   * @param {'user'|'environment'} facingMode
   */
  async _swapVideoFacing(facingMode) {
    try {
      const video = this._mindar.video;
      const old   = video.srcObject;
      if (old) old.getTracks().forEach(t => t.stop());

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      video.srcObject = stream;
      await new Promise(resolve =>
        video.addEventListener('loadedmetadata', resolve, { once: true })
      );
    } catch (err) {
      console.warn('[AR] Could not swap camera facing:', err.message);
    }
  }
}
