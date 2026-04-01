/**
 * arSystem.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Camera feed + ml5.js FaceMesh face tracking.
 *
 * ARCHITECTURE
 * ────────────
 * A plain <video> element in #ar-container (z-index 0) shows the camera feed.
 * The Hydra canvas (z-index 1) sits on top; app.js drives its CSS opacity from
 * audioState.level so the camera shows through at silence.
 *
 * ml5.faceMesh() reads frames from the same <video> element each tick and
 * fires a callback with detected faces. No separate canvas or renderer needed.
 *
 * FACE DATA
 * ─────────
 * ml5 returns a `faces` array — empty when no face is present. From the
 * bounding box we derive normalised (0–1) position and size values that
 * Hydra and the state machine can read each frame.
 *
 * CAMERA SWITCHING
 * ────────────────
 * Stops the current stream, swaps facingMode, restarts the video + ml5.
 * ml5.faceMesh.detectStop() / detectStart() cleanly handles the handoff.
 *
 * EXPOSED STATE
 * ─────────────
 *   arState.faceDetected  boolean  — true when ≥1 face is in frame
 *   arState.faceX         0–1      — normalised horizontal face centre (0=left)
 *   arState.faceY         0–1      — normalised vertical face centre (0=top)
 *   arState.faceSize      0–1      — face bounding box width / video width
 *   arState.facingMode    string   — 'user' | 'environment'
 */

export class ARSystem {
  constructor() {
    this.arState = {
      faceDetected: false,
      faceX:        0.5,
      faceY:        0.5,
      faceSize:     0,
      facingMode:   'user',
    };

    this._video    = null;
    this._faceMesh = null;
  }

  /**
   * init(facingMode)
   * ─────────────────
   * Starts the camera feed then layers ml5 FaceMesh on top.
   * Must be called from inside a user-gesture handler (camera permission).
   *
   * @param {'user'|'environment'} facingMode
   */
  async init(facingMode = 'user') {
    this.arState.facingMode = facingMode;
    await this._startCamera(facingMode);
    await this._startFaceMesh();
  }

  /**
   * switchCamera()
   * ───────────────
   * Toggles front ↔ back camera. Stops tracking, swaps stream, restarts.
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
   * Stops face detection and shuts down the camera stream.
   */
  async stop() {
    if (this._faceMesh) {
      try { this._faceMesh.detectStop(); } catch (_) {}
      this._faceMesh = null;
    }

    if (this._video?.srcObject) {
      this._video.srcObject.getTracks().forEach(t => t.stop());
      this._video.srcObject = null;
      this._video = null;
    }

    this.arState.faceDetected = false;
    this.arState.faceSize     = 0;
  }

  /**
   * _startCamera(facingMode)
   * ─────────────────────────
   * Creates a <video> element in #ar-container and starts the camera stream.
   * Front camera is mirrored via CSS scaleX(-1) to match natural selfie view.
   */
  async _startCamera(facingMode) {
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

    console.log(`[AR] Camera started — facingMode: ${facingMode}`);
  }

  /**
   * _startFaceMesh()
   * ─────────────────
   * Initialises ml5.faceMesh and starts continuous detection on the video.
   * ml5 is loaded as a window global via <script> tag in index.html.
   *
   * maxFaces: 1 — we only need one face; higher values hurt mobile performance.
   * flipHorizontal: false — we mirror via CSS, not in the model.
   */
  async _startFaceMesh() {
    if (!window.ml5) {
      throw new Error('ml5 not loaded — check CDN script tag in index.html');
    }

    this._faceMesh = await new Promise((resolve) => {
      const fm = ml5.faceMesh(
        { maxFaces: 1, flipHorizontal: false },
        () => resolve(fm)   // callback fires when model is ready
      );
    });

    this._faceMesh.detectStart(this._video, (faces) => this._onFaces(faces));
    console.log('[AR] ml5 FaceMesh started');
  }

  /**
   * _onFaces(faces)
   * ────────────────
   * ml5 detection callback — fires every frame with the latest results.
   * Updates arState from the first detected face's bounding box.
   *
   * Coordinates from ml5 are in video pixel space. We normalise by video
   * dimensions so values are always 0–1 regardless of camera resolution.
   *
   * faceX / faceY: centre of bounding box, normalised 0–1.
   * faceSize:      box width / video width — 1.0 means face fills the frame.
   */
  _onFaces(faces) {
    const detected = faces.length > 0;

    if (detected !== this.arState.faceDetected) {
      console.log(`[AR] Face ${detected ? 'detected' : 'lost'}`);
    }

    this.arState.faceDetected = detected;

    if (detected) {
      const box  = faces[0].box;
      const vw   = this._video.videoWidth  || 1;
      const vh   = this._video.videoHeight || 1;

      this.arState.faceX    = Math.min((box.xMin + box.width  * 0.5) / vw, 1);
      this.arState.faceY    = Math.min((box.yMin + box.height * 0.5) / vh, 1);
      this.arState.faceSize = Math.min(box.width / vw, 1);
    } else {
      this.arState.faceSize = 0;
    }
  }
}
