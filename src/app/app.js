/**
 * app.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the startup sequence.
 *
 * Responsibilities:
 *   1. Listen for the user's first tap/click on the overlay.
 *   2. On tap: initialize the microphone (requires user gesture on mobile).
 *   3. Hand the live audioState reference to Hydra so the patch can react.
 *   4. Fade out the overlay.
 *   5. Surface any errors (mic denied, etc.) back to the overlay UI.
 */

export class App {
  /**
   * @param {AudioAnalyzer} audioAnalyzer  — audio capture + FFT module
   * @param {HydraSetup}    hydraSetup     — Hydra canvas + patch module
   * @param {StateStore}    stateStore     — live system state container
   * @param {MotionSensor}  motionSensor   — device motion + orientation module
   */
  constructor(audioAnalyzer, hydraSetup, stateStore, motionSensor) {
    this._audioAnalyzer = audioAnalyzer;
    this._hydraSetup    = hydraSetup;
    this._stateStore    = stateStore;
    this._motionSensor  = motionSensor;

    this._overlay  = document.getElementById('overlay');
    this._errorMsg = document.getElementById('error-msg');
  }

  /**
   * init()
   * ──────
   * Attaches the tap/click listener to the overlay.
   * Uses { once: true } so the handler auto-removes after the first trigger —
   * prevents double-init if the user somehow taps twice very fast.
   *
   * We listen for both 'click' (desktop / mouse) and 'touchend' (mobile).
   * 'touchstart' is intentionally avoided to prevent accidental triggers
   * from scroll gestures on mobile.
   */
  init() {
    let started = false;
    const startHandler = (e) => {
      if (started) return;
      started = true;
      // Prevent the ~300 ms synthesized click that follows touchend on iOS,
      // which would otherwise call _start() a second time.
      e.preventDefault();
      this._start();
    };
    this._overlay.addEventListener('click',    startHandler, { once: true });
    this._overlay.addEventListener('touchend', startHandler, { once: true });
  }

  /**
   * _start()
   * ────────
   * Async startup sequence. Called once, inside the user gesture callback.
   *
   * Must remain inside the gesture stack for Web Audio to initialize on iOS.
   * If called outside a gesture (e.g. from a setTimeout), the AudioContext
   * will be suspended and mic access will silently fail on Safari.
   */
  async _start() {
    try {
      // Initialize microphone and FFT.
      // This call triggers the browser's mic-permission dialog on first run.
      // On iOS/Safari the AudioContext is only allowed to start here because
      // we are synchronously inside the user-gesture event handler.
      // Request motion permission FIRST — iOS requires this within the
      // synchronous gesture stack, before any other awaited operation.
      // The mic init below triggers a separate permission dialog which
      // breaks the gesture context, so motion must be requested before it.
      // Non-fatal: if denied or unavailable, visuals still work via audio.
      try {
        await this._motionSensor.requestPermission();
      } catch (motionErr) {
        console.warn('[Between States] Motion permission unavailable:', motionErr.message ?? motionErr);
      }

      await this._audioAnalyzer.init();

      // Now start the motion listeners (permission already granted above).
      try {
        await this._motionSensor.init();
      } catch (motionErr) {
        console.warn('[Between States] Motion sensor unavailable:', motionErr.message ?? motionErr);
      }

      // Switch the Hydra patch from idle → reactive.
      // All three state objects are passed as live references so Hydra's
      // arrow functions always read the current frame's values.
      this._hydraSetup.setReactivePatch(
        this._audioAnalyzer.state,
        this._stateStore,
        this._motionSensor.state
      );

      // Fade out the overlay. The CSS transition handles the animation;
      // we just add the class. The overlay is pointer-events: none after fade.
      this._overlay.classList.add('hidden');

    } catch (err) {
      // Mic access was denied or the AudioContext failed.
      // Show the error inline so the user knows what happened.
      console.error('[Between States] Audio init failed:', err);

      const msg = err?.message?.toLowerCase().includes('denied')
        ? 'microphone access was denied — please allow access and refresh'
        : 'could not start audio — please try again';

      this._errorMsg.textContent = msg;
      this._errorMsg.style.display = 'block';

      // Re-attach the tap listener so the user can try again.
      let retrying = false;
      const retryHandler = (e) => {
        if (retrying) return;
        retrying = true;
        e.preventDefault();
        this._start();
      };
      this._overlay.addEventListener('click',    retryHandler, { once: true });
      this._overlay.addEventListener('touchend', retryHandler, { once: true });
    }
  }
}
