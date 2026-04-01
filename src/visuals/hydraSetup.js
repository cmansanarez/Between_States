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

import Hydra from 'hydra-synth';

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
   * setReactivePatch(audioState)
   * ─────────────────────────────
   * Replaces the idle patch with the full audio-reactive patch.
   * Called once the microphone is live (after user tap).
   *
   * @param {object} audioState  — live reference from AudioAnalyzer.state
   *   audioState.bass    0–1
   *   audioState.mid     0–1
   *   audioState.treble  0–1
   *   audioState.level   0–1
   */
  setReactivePatch(audioState) {
    // ── Base oscillator ──────────────────────────────────────────────────────
    // osc(frequency, sync, colorOffset)
    //
    //   frequency:   starts at 4, rises to ~22 when mid is maxed.
    //                Mid content (voice, melody) adds visible stripe density.
    //
    //   sync:        fixed slow scroll — the stripes drift gently left.
    //
    //   colorOffset: treble pushes the hue offset, splitting RGB bands apart.
    //                High-frequency hits create chromatic aberration / flicker.
    osc(
      () => 4 + audioState.mid * 18,    // mid → oscillator frequency
      0.05,                              // fixed slow drift
      () => audioState.treble * 2.8     // treble → RGB color offset (flicker)
    )

    // ── Per-channel color response ────────────────────────────────────────────
    // .color(r, g, b)  — multiplies the output RGB channels.
    //
    //   red:   treble swells the red channel — hot, electric, glitchy.
    //   green: mid slightly brightens green — voice/texture warmth.
    //   blue:  bass suppresses blue — deep hits push toward warm/red.
    .color(
      () => 0.7 + audioState.treble * 1.1,   // treble → red flicker
      () => 0.35 + audioState.mid * 0.55,    // mid → green warmth
      () => 0.9 - audioState.bass * 0.5      // bass → blue suppression
    )

    // ── Noise-based scale modulation ─────────────────────────────────────────
    // .modulateScale(source, multiple)
    //
    // Uses a noise texture as the modulator. The noise warps the lookup
    // coordinates of the oscillator — producing organic, fluid distortion.
    //
    //   noise scale (1st param):   bass grows the noise grain coarser.
    //                               Deep hits = large, chunky distortion blocks.
    //   noise speed (2nd param):   mid accelerates the noise evolution.
    //
    //   multiple:   controls how strongly the noise displaces coordinates.
    //               Mid energy directly drives warp intensity.
    .modulateScale(
      noise(
        () => 1.5 + audioState.bass * 4.5,   // bass → noise grain scale
        () => 0.2 + audioState.mid * 0.45    // mid → noise animation speed
      ),
      () => 0.15 + audioState.mid * 0.9      // mid → warp intensity
    )

    // ── Rotational modulation ─────────────────────────────────────────────────
    // .modulateRotate(source, multiple)
    //
    // A fast oscillator drives a rotational warp. When treble is high the
    // oscillator frequency increases, creating rapid spinning disturbance.
    // The rotation amount itself scales with mid — the system resists stillness.
    .modulateRotate(
      osc(
        () => 2 + audioState.treble * 12,    // treble → spin frequency
        0.03
      ),
      () => audioState.mid * 0.55            // mid → rotation intensity
    )

    // ── Global scale (breathing) ──────────────────────────────────────────────
    // Bass energy expands the entire visual outward.
    // At silence the visual sits at 80% scale; a hard kick pushes it to ~130%.
    .scale(
      () => 0.8 + audioState.bass * 0.5     // bass → expansion / breathing
    )

    // Route to the default Hydra output buffer.
    .out();
  }
}
