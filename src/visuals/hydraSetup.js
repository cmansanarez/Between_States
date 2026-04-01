/**
 * hydraSetup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Initializes the Hydra visual synthesizer and defines the generative patch
 * that responds to live audio FFT data.
 *
 * HOW HYDRA MAPS AUDIO VALUES
 * ────────────────────────────
 * Hydra evaluates parameters on every rendered frame. When a parameter is an
 * arrow function ( () => value ), Hydra calls it each tick, so passing
 * () => audioState.bass always reads the *current* bass value — no explicit
 * update loop required on our side.
 *
 * AUDIO → VISUAL MAPPING
 * ───────────────────────
 *   bass   → scale()           Global expansion / contraction of the form.
 *                               Kick/low-end makes the visual "breathe" outward.
 *
 *   mid    → modulateScale()   Warp intensity of the noise-based distortion layer.
 *                               Voice and melodic content create organic deformation.
 *
 *   mid    → modulateRotate()  Rotational instability.
 *                               Mid energy twists the visual around its center.
 *
 *   treble → osc frequency     High-frequency content speeds up oscillator banding.
 *                               Cymbals/air introduce rapid texture change.
 *
 *   treble → color offset      Chromatic shift (third osc() parameter).
 *                               Treble pushes hues apart — a glitch flicker effect.
 *
 *   treble → .color() red ch.  The red channel swells with treble — hot, electric.
 *
 *   bass   → noise scale       The coarseness of the noise modulator grows with bass.
 *                               Deep hits produce large, punchy distortion blocks.
 *
 * PATCH STRUCTURE
 * ────────────────
 *   osc()             — oscillating stripe layer, base of the visual
 *   .color()          — per-channel RGB response to treble / mid / bass
 *   .modulateScale()  — noise warp driven by bass (shape) and mid (intensity)
 *   .modulateRotate() — rotational twist driven by mid
 *   .scale()          — global zoom / breathing driven by bass
 *   .out()            — route to the default output buffer (o0)
 */

// Hydra is loaded via CDN script tag in index.html — no import needed.
/* global Hydra */

export class HydraSetup {
  /**
   * @param {string} canvasId  — id of the <canvas> element in index.html
   */
  constructor(canvasId) {
    this._canvas = document.getElementById(canvasId);
    this._hydra  = null;
  }

  /**
   * init()
   * ──────
   * Creates the Hydra instance bound to our full-screen canvas.
   *
   * Options:
   *   detectAudio: false  — we supply our own FFT via p5; disable Hydra's
   *                          built-in Web Audio detection to avoid conflicts.
   *   makeGlobal: true    — exposes osc(), noise(), voronoi(), src(), etc.
   *                          on window so they can be called without a prefix.
   *   enableStreamCapture: false — not needed for M1; disabling saves resources.
   */
  init() {
    this._hydra = new Hydra({
      canvas:              this._canvas,
      detectAudio:         false,
      makeGlobal:          true,
      enableStreamCapture: false,
    });
  }

  /**
   * setIdlePatch()
   * ──────────────
   * A calm, slow-moving ambient patch that plays on the canvas *before* the
   * user grants microphone access. Gives life to the canvas even behind the
   * overlay — visible as the overlay fades out.
   *
   * No audio parameters; all values are static or time-driven.
   */
  setIdlePatch() {
    osc(3, 0.04, 0.6)
      .color(0.5, 0.2, 0.8)
      .modulateScale(noise(1.5, 0.15), 0.25)
      .modulateRotate(osc(0.8, 0.02), 0.15)
      .scale(0.9)
      .out();
  }

  /**
   * setReactivePatch(audioState, stateStore)
   * ─────────────────────────────────────────
   * Replaces the idle patch with the state-aware audio-reactive patch.
   * Called once the microphone is live (after user tap).
   *
   * Audio influence on each parameter is multiplied by a per-state intensity
   * value, read live on every Hydra render tick via arrow functions:
   *
   *   idle        0.12  — barely reactive; system is listening but quiet
   *   emergence   0.40  — audio starts shaping the visual; forms gather
   *   distortion  1.00  — full reactivity; the designed experience
   *   collapse    1.75  — parameters pushed beyond designed range; glitch territory
   *
   * At collapse, values intentionally exceed their designed ceilings — Hydra
   * wraps/clips these in ways that produce fragmentation, which aligns with
   * the spec's "structure breaks down" intention.
   *
   * @param {object}     audioState  — live reference from AudioAnalyzer.state
   * @param {StateStore} stateStore  — live reference to current system state
   */
  setReactivePatch(audioState, stateStore) {
    const STATE_INTENSITY = {
      idle:       0.12,
      emergence:  0.40,
      distortion: 1.00,
      collapse:   1.75,
    };

    // Read intensity on every tick so state changes take effect immediately.
    const intensity = () => STATE_INTENSITY[stateStore.current];

    // ── Base oscillator ──────────────────────────────────────────────────────
    // osc(frequency, sync, colorOffset)
    //
    //   frequency:   base of 4, audio-driven addition scaled by state intensity.
    //   sync:        fixed slow scroll — not audio-driven, stays constant.
    //   colorOffset: treble splits RGB bands; intensity scales the effect.
    osc(
      () => 4 + audioState.mid    * 18  * intensity(),   // mid → stripe density
      0.05,                                               // fixed slow drift
      () =>     audioState.treble * 2.8 * intensity()    // treble → chromatic flicker
    )

    // ── Per-channel color response ────────────────────────────────────────────
    // Base channel values (0.7, 0.35, 0.9) are always present — the visual is
    // never dark. Audio-driven additions are scaled by intensity.
    // At collapse (intensity=1.75) values exceed 1.0 — Hydra wraps these into
    // blown-out, fragmented color, which suits the collapse aesthetic.
    .color(
      () => 0.7  + audioState.treble * 1.1  * intensity(),  // treble → red flicker
      () => 0.35 + audioState.mid    * 0.55 * intensity(),  // mid    → green warmth
      () => 0.9  - audioState.bass   * 0.5  * intensity()   // bass   → blue suppression
    )

    // ── Noise-based scale modulation ─────────────────────────────────────────
    // Base noise values keep the visual gently alive even at idle.
    // Audio-driven contributions are scaled by intensity.
    .modulateScale(
      noise(
        () => 1.5 + audioState.bass * 4.5  * intensity(),  // bass → noise grain scale
        () => 0.2 + audioState.mid  * 0.45                 // mid  → noise speed (always animates)
      ),
      () => 0.15 + audioState.mid * 0.9 * intensity()      // mid  → warp intensity
    )

    // ── Rotational modulation ─────────────────────────────────────────────────
    // Base osc frequency of 2 keeps a subtle spin always present.
    // Treble and mid contributions are scaled by intensity.
    .modulateRotate(
      osc(
        () => 2 + audioState.treble * 12 * intensity(),   // treble → spin frequency
        0.03
      ),
      () => audioState.mid * 0.55 * intensity()           // mid → rotation intensity
    )

    // ── Global scale (breathing) ──────────────────────────────────────────────
    // At idle the visual sits at ~80% scale.
    // Bass breathing is scaled by intensity — at collapse, a hard kick pushes
    // scale to ~1.675, causing the visual to spill beyond screen edges.
    .scale(
      () => 0.8 + audioState.bass * 0.5 * intensity()    // bass → expansion
    )

    // Route to the default Hydra output buffer.
    .out();
  }
}
