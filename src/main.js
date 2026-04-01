/**
 * main.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point for Between States — Milestone 1.
 *
 * Boot sequence:
 *   1. HydraSetup.init()         — create Hydra renderer on the canvas
 *   2. HydraSetup.setIdlePatch() — start ambient visual before mic is live
 *   3. App.init()                — attach tap listener to the overlay
 *
 * After the user taps:
 *   4. AudioAnalyzer.init()            — start mic + FFT (inside gesture)
 *   5. HydraSetup.setReactivePatch()   — switch to audio-reactive patch
 *   6. Overlay fades out               — experience begins
 *
 * Hydra and p5 each run their own requestAnimationFrame loop independently:
 *   - p5 draw() updates audioState ~60 fps
 *   - Hydra reads audioState via () => functions on every render tick
 * No manual synchronization is needed between the two loops.
 */

import { AudioAnalyzer } from './audio/audioAnalyzer.js';
import { HydraSetup }    from './visuals/hydraSetup.js';
import { App }           from './app/app.js';

try {
  // ── 1. Initialize Hydra ────────────────────────────────────────────────────
  // Hydra does not require a user gesture — visuals can start immediately.
  // makeGlobal: true (set in HydraSetup) exposes osc(), noise(), etc. globally
  // so the patches below can call them without a namespace prefix.
  const hydraSetup = new HydraSetup('hydra-canvas');
  hydraSetup.init();

  // ── 2. Start the idle visual ───────────────────────────────────────────────
  // Plays behind the overlay while the user is prompted to tap.
  // The overlay is semi-transparent so this is faintly visible on load,
  // and fully visible as the overlay fades out after the user grants mic access.
  hydraSetup.setIdlePatch();

  // ── 3. Create the audio analyzer ──────────────────────────────────────────
  // Not started yet — init() is deferred until after the user gesture in App.
  const audioAnalyzer = new AudioAnalyzer();

  // ── 4. Wire up the app (overlay tap → mic → reactive patch) ───────────────
  const app = new App(audioAnalyzer, hydraSetup);
  app.init();

} catch (err) {
  // Surface any load-time crash in the overlay so it's visible on mobile
  // (where there's no easy way to open DevTools).
  console.error('[Between States] Boot error:', err);
  const errorEl = document.getElementById('error-msg');
  if (errorEl) {
    errorEl.textContent = `load error: ${err.message ?? err}`;
    errorEl.style.display = 'block';
  }
}
