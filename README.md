# ≋ Slate Ocean — Realistic Realtime Ocean Simulator

A physics-first, realtime ocean simulator in the browser: a **GPU FFT spectral wave field**
(JONSWAP/TMA oceanographic spectra, not looping noise), **adaptive active wave
cancellation**, **surf-zone shoaling and breaking** (Pipeline · Mavericks · beach break),
and **particle-based foam + spray** (up to 262k GPU particles over an advected foam field).

> Research basis (2024–2026 survey + foundations): see **[RESEARCH.md](RESEARCH.md)**.

## Quickstart

```bash
npm install
npm run dev      # open http://localhost:5173
```

Requirements: a current Chrome / Edge / Firefox / Safari with **WebGL2** and float render
targets (nearly all desktop GPUs; most mobile GPUs fall back gracefully where possible).

## What you get

| System | How it works |
|---|---|
| **Waves** | Inverse-FFT synthesis from JONSWAP × TMA × Donelan–Banner spectra + narrow swell trains, 3 cascades (1024/256/64 m), choppy horizontal displacements, Parseval-correct energy |
| **Cancellation** | Click to drop a canceller buoy: it senses the swell, fits amplitude + phase with a forgetting least-squares loop (like active noise control), and emits the anti-phase beam — measure the shadow in dB with probes A/B |
| **Surf** | Finite-depth dispersion, group-velocity shoaling, Miche depth-limited breaking, crest steepening + pitching lip over beach / sandbar / reef / point-break bathymetry |
| **Foam & spray** | Persistent foam field advected by measured surface velocity (Jacobian-fold + breaker + runup + wind-gated whitecaps) + stateful GPU spray/foam-fleck particles |
| **Measure** | Click-to-place probes read back true GPU height; live Hs / Tp / RMS graphs + k-plane spectrum viewer |

Seven one-click scenarios: **Beach Break · Pipeline · Mavericks · Open Ocean · Storm ·
Cancellation Lab · Glassy Cove** (keys `1–7`).

## Controls

- Drag orbit · wheel zoom · right-drag pan · `space` pause · `H` help
- Click water places the current tool (probe / canceller / point / plane wave — switch in
  *Sources & Cancellation*, or `P` / `C`)
- Every physical parameter (wind, fetch, γ, swell, bathymetry, loop gain, foam lifetimes…)
  is live in the right-hand panel

## Project layout

```
src/
  core/        butterfly.js (GPU-FFT tables) · gpu.js (RT helpers, fullscreen passes)
  ocean/       spectra.js · bathymetry.js · cascades.js · foam.js · spray.js
               water.js · sources.js · probes.js · shared.js · glsl_*.js
  ui.js        state, presets, panel, spectrum + probe graphs
  main.js      renderer, loop, resize
test/          fft · spectrum · materials · cancel (+ render smoke test for CI)
```

## Testing

```bash
npm test          # offline unit tests: FFT vs naive DFT, spectra, materials, cancel loop
npm run build     # production bundle
npm run test:render  # headless-Chromium smoke test (needs browser download)
```

## Notes

- The FFT ocean assumes deep, stationary water; nearshore physics is a local
  shoaling/breaking transform (§3 of RESEARCH.md) — honest approximation, documented limits.
- If the frame rate drops, lower FFT size / particle count / resolution in *View & Quality*.
