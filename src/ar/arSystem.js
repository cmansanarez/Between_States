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
      faceX:        0.5,   // normalised 0–1, face centre horizontal
      faceY:        0.5,   // normalised 0–1, face centre vertical
      faceSize:     0,     // normalised 0–1, face width / video width
      mouthOpen:    0,     // normalised 0–1, lip separation / face height
      headTilt:     0,     // −1 to 1, eye-corner angle (neg=left, pos=right)
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
    if (this._debugInterval) {
      clearInterval(this._debugInterval);
      this._debugInterval = null;
    }

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

    console.log('[AR] ml5 version:', ml5.version);
    console.log('[AR] video readyState:', this._video.readyState,
      'size:', this._video.videoWidth, '×', this._video.videoHeight);

    // Ensure video is actually playing before handing it to ml5.
    // readyState 4 = HAVE_ENOUGH_DATA — frames are available.
    if (this._video.readyState < 2) {
      console.log('[AR] Waiting for video to be ready...');
      await new Promise(resolve =>
        this._video.addEventListener('canplay', resolve, { once: true })
      );
      console.log('[AR] Video ready — readyState:', this._video.readyState);
    }

    await this._video.play().catch(e =>
      console.warn('[AR] video.play() failed:', e.message)
    );

    // ml5 v1.x returns a Promise directly — use await rather than callback wrapping.
    console.log('[AR] Initialising ml5.faceMesh (await pattern)...');
    this._faceMesh = await ml5.faceMesh({ maxFaces: 1, flipHorizontal: true });
    console.log('[AR] ml5.faceMesh model ready:', this._faceMesh);

    // One-shot detect to confirm the model can see the video at all before
    // committing to detectStart. Logs raw face count + first keypoint if any.
    console.log('[AR] Running one-shot detect test...');
    try {
      const testFaces = await this._faceMesh.detect(this._video);
      console.log('[AR] One-shot detect result — faces:', testFaces.length);
      if (testFaces.length > 0) {
        console.log('[AR] First face box:', JSON.stringify(testFaces[0].box));
      }
    } catch (e) {
      console.warn('[AR] One-shot detect failed:', e.message);
    }

    // Log face count every 3 seconds so we can see if detection ever succeeds.
    this._debugInterval = setInterval(() => {
      console.log('[AR] face count this tick:', this._lastFaceCount ?? 'no callback yet');
    }, 3000);

    console.log('[AR] Calling detectStart...');
    this._faceMesh.detectStart(this._video, (faces) => {
      this._lastFaceCount = faces.length;
      this._onFaces(faces);
    });
    console.log('[AR] ml5 FaceMesh detectStart called');
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
      const face = faces[0];
      const kp   = face.keypoints;
      const box  = face.box;
      const vw   = this._video.videoWidth  || 1;
      const vh   = this._video.videoHeight || 1;

      // ── Bounding box → position + size ──────────────────────────────────
      this.arState.faceX    = Math.min((box.xMin + box.width  * 0.5) / vw, 1);
      this.arState.faceY    = Math.min((box.yMin + box.height * 0.5) / vh, 1);
      this.arState.faceSize = Math.min(box.width / vw, 1);

      // ── Mouth openness ───────────────────────────────────────────────────
      // Keypoint 13 = upper inner lip centre, 14 = lower inner lip centre.
      // Lip separation normalised by face bounding box height → 0–1.
      // Closed mouth ≈ 0, wide open ≈ 0.15–0.25 (clamped to 1).
      if (kp[13] && kp[14]) {
        const lipGap = Math.abs(kp[14].y - kp[13].y);
        this.arState.mouthOpen = Math.min(lipGap / (box.height * 0.15), 1);
      }

      // ── Head tilt ────────────────────────────────────────────────────────
      // Keypoint 33 = right eye outer corner, 263 = left eye outer corner.
      // dy / dx gives the slope of the eye line — normalised to −1 … 1.
      // 0 = level, positive = tilted right, negative = tilted left.
      if (kp[33] && kp[263]) {
        const dx    = kp[263].x - kp[33].x || 1;
        const dy    = kp[263].y - kp[33].y;
        const slope = dy / Math.abs(dx);
        this.arState.headTilt = Math.max(-1, Math.min(slope * 4, 1));
      }

    } else {
      this.arState.faceSize  = 0;
      this.arState.mouthOpen = 0;
      this.arState.headTilt  = 0;
    }
  }
}
