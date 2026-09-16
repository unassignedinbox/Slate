# Slate Ocean — Research Dossier (2024–2026 survey + foundations)

How to build the most realistic **realtime** ocean: a spectral FFT wave field driven by
oceanographic spectra, adaptive active wave cancellation, surf-zone shoaling/breaking,
and particle-based foam. This document records what the literature and the
state of the art (surveyed Sept 2026) say, and how each finding maps into this codebase.

---

## 1. Spectral wave synthesis (the core)

### 1.1 Tessendorf FFT ocean (foundation, still unbeaten for large water)
J. Tessendorf, *"Simulating Ocean Water"* (1999), remains the standard method for
realtime oceans: describe the sea surface as a sum of gerstner-like wave trains via a
**directional wave spectrum** in the frequency domain, evolve each mode in time with the
**linear dispersion relation** ω(k), and sum thousands of modes at once with an
**inverse FFT** on the GPU. Horizontal ("choppy") displacements come from the same
spectrum scaled by −i·k̂, which sharpens crests the way real Stokes waves do.

Every serious realtime implementation surveyed still follows this blueprint:

- **Robert Ryan, "Ocean Rendering, Part 1 – Simulation" (Oct 2025)** — a complete modern
  walkthrough: JONSWAP + TMA spectra, directional spreading, Gaussian random amplitudes,
  time evolution `h̃(k,t)`, GPU FFT. Our spectrum shader is structured after this reference.
  https://rtryan98.github.io/2025/10/04/ocean-rendering-part-1.html
- **Mozobo/Ocean-Simulation (Unity URP)** — JONSWAP + TMA with Hasselmann spreading,
  Cooley–Tukey IFFT in compute, multi-cascade tiling, async GPU readback for buoyancy.
  https://github.com/Mozobo/Ocean-Simulation/
- **Keith Lantz's ocean FFT series** — the clearest exposition of the out-of-place DIT
  formulation our butterfly tables use (each stage = fullscreen pass, bit-reversed input).
  https://www.keithlantz.net/2011/11/ocean-simulation-part-two-using-the-fast-fourier-transform/
- **Peter Braden, "Simulating Ocean Waves"** — compact Phillips-spectrum + FFT derivation.
  https://peterbraden.co.uk/article/simulation-ocean-waves/
- **jbouny/fft-ocean** — classic WebGL/three.js Tessendorf ocean on a projected grid.
  https://github.com/jbouny/fft-ocean
- **three.js Water Pro (2025)** — commercial WebGPU FFT ocean: "physically-based units",
  dynamic foam, caustics — confirms FFT + physical units as the 2025 web state of art.
  https://threejsroadmap.com/assets/threejs-water-pro
- **Dynamic Real Water (UE5, June 2025)** — compute-shader FFT, multi-LOD grid streaming,
  async buoyancy via GPU readback, analytical foam, semi-analytical caustics.
  https://80.lv/articles/gpu-accelerated-fft-water-system-for-unreal-engine-5

**Adopted:** 3-cascade GPU IFFT (1024/256/64 m tiles, 256², Stockham-style ping-pong DIT),
Phillips/JONSWAP-TMA/PM spectra, choppy displacements, Parseval-correct energy scaling
(validated in `test/fft.test.mjs` against naive DFTs).

### 1.2 Which spectrum? (JONSWAP + TMA, not just Phillips)
Graphics tutorials default to the **Phillips spectrum** (Tessendorf 1999) — simple but
unphysical (wrong tail slope, no fetch/age control, arbitrary amplitude). Oceanography
offers better, and the 2025 references above all moved on:

- **JONSWAP** (Hasselmann et al. 1973): fetch-limited wind seas,
  S(ω) = αg²ω⁻⁵·exp(−1.25(ωp/ω)⁴)·γʳ, with Hasselmann fetch laws for α and fp from
  (U₁₀, fetch). Peak-enhancement γ ≈ 1–7 (γ = 1 recovers Pierson–Moskowitz).
- **TMA** (Bouws et al. 1985; popularized for graphics by Horvath): multiplies JONSWAP by
  the Kitaigorodskii/Bouws depth factor Φ(ωh) — essential once depth matters (surf!).
  Note: several graphics write-ups omit the ωh > 2 clamp; we use the correct piecewise form.
  https://link.springer.com/chapter/10.1007/978-3-540-72586-2_16
- **Pierson–Moskowitz** (1964): fully-developed limit; we use its shape (scaled to integrate
  exactly to Hs²/16) for independent **swell trains**.
- **Elfouhaily et al. (1997)**: unified long+short wave spectrum with its own spreading —
  the most complete analytical model; implicitly covered here by (JONSWAP + PM swell +
  procedural micro-normals). Survey of implementations:
  https://github.com/eiszapfen2000/tgda
- **Directional spreading**: we use **Donelan–Banner sech²** (Donelan, Hamilton & Hui 1985)
  because it is self-normalizing (no Γ functions needed in GLSL) and frequency-dependent;
  swell uses a narrow β ≈ 9 lobe. (Mitsuyasu/Hasselmann cos²ˢ is the classic alternative.)

**Adopted:** windsea = JONSWAP × TMA × Donelan–Banner; swell = PM × narrow sech²;
Phillips kept as a one-sided, auto-normalized comparison mode.

### 1.3 Hybrid FFT + wave particles (Nov 2025 — newest research)
Xue et al., *"Real-Time Interactive Hybrid Ocean: Spectrum-Consistent Wave Particle-FFT
Coupling"* (arXiv 2511.02852): a global FFT background plus local Lagrangian wave-particle
patches around interactive objects, injected under the *same* spectrum so near/far fields
match energetically. This resolves the "impossible triangle" (scale × interactivity ×
spectral consistency).
https://arxiv.org/abs/2511.02852

**Adopted (pragmatic subset):** global FFT field + local analytic wave sources
(emitters/cancellers) + GPU particle spray/foam coupled to the same peak parameters.
Full Lagrangian patch injection is listed as future work (§8).

---

## 2. Wave cancellation (destructive interference, done right)

Linear water waves **superpose**: heights add, so an anti-phase wave of equal amplitude
produces (near-)zero residual — the water-wave analog of active noise control. The physics
was pushed furthest in a 2024 result:

- **"Perfect active absorption of water waves in a channel by a dipole source" (2024)** —
  theory + numerics + experiment: an active dipole source cancels *both* reflection and
  transmission of an incident wave by destructive interference, creating a protected zone.
  https://blog.espci.fr/phil/files/2024/08/art_83.pdf

Key insight for a simulator: the incident FFT sea has **random phase**, so no open-loop
"theory phase" can cancel it — a real system must **sense → fit → emit** (feedforward
with a sensor, exactly like ANC headphones). Our canceller does this genuinely:

1. A sensor probe sits 0.75λ down-wave of the buoy.
2. Each sample subtracts our own *known* emission (exact formula the GPU renders).
3. A **forgetting least-squares fit** extracts (A, B) of the residual at the swell ω.
4. The buoy emits the anti-phase beam; gain ramps in after ~1.5 periods of sensing.

Measured live with probe pairs (up-wave A vs down-wave B) in dB. The loop math is
validated closed-loop in `test/cancel.test.mjs` (100% in the ideal case; the live sim
reaches it only for the fitted swell component, as in reality).

---

## 3. Surf: shoaling, steepening, breaking

A global FFT assumes **stationary deep water**, so nearshore transformation is applied as
a physically-motivated post-transform at sampling time (standard realtime practice):

- **Finite-depth dispersion** ω² = gk·tanh(kh) everywhere (spectrum + shoaling).
- **Shoaling gain** from group-velocity ratio √(cg₀/cg) (Green's-law family), capped 2.6×.
- **Depth-limited breaking (Miche 1944 / McCowan solitary limit)**: crest capped at
  ≈ 0.62·D + margin; breaker mask from H/D vs the 0.78 criterion; crest vertices pulled
  uphill and the lip thrown shoreward for the pitching look.
- **TMA spectrum** already attenuates high frequencies over the reference depth (§1.2).
- Classical reference for explicit overturning sheets + spray coupling (full particle
  sheets are beyond our budget, we use lip-throw + foam/spray injection instead):
  Thürey et al., *"Real-time Breaking Waves for Shallow Water Simulations"* (PG 2007).
  https://matthias-research.github.io/pages/publications/breakingWaves.pdf

Presets implement a beach + sandbar (spilling), a reef shelf (Pipeline-style plunging),
and a deep big-wave reef (Mavericks-style).

---

## 4. Foam, whitecaps, spray (particles, not painted noise)

Requirements were explicit: foam must be a **realistic particle simulation**. Survey:

- **Dupuy & Bruneton, "Real-time Animation and Rendering of Ocean Whitecaps" (2012)** —
  whitecap coverage from a **wave-deformation (Jacobian) criterion** that pre-filters
  linearly, so coverage stays correct from centimeters to kilometers via mipmapping.
  Demo + paper: https://github.com/jdupuy/whitecaps ·
  https://inria.hal.science/hal-00967078v1/document
- **Modern engine practice (2025–26)**: persistent foam **stored in a texture and advected
  by the surface velocity field** with decay — whitecaps must *drift*, not pulse in place
  (the static-Jacobian look is the classic giveaway). E.g. OloEngine's 2026 water work:
  foam advected with the FFT displacement delta, crest spray from the same fold detector.
  https://github.com/drsnuggles8/OloEngineBase/pull/1053
- **Whitecap coverage vs wind**: Monahan & Muircheartaigh W ≈ 3.84e−6·U³·⁴¹ gates open-ocean
  caps (negligible below ~7 m/s, extensive in storms).
- **Spray**: ballistic particles with drag, spawned at folding crests/lips; surface-hugging
  foam flecks for persistence. Offline reference for the foam/bubble/spray split and
  density-dependent lifetimes: FumeFX Ocean Sim docs.
  https://docs.afterworks.com/FumeFX6max/ocean%20sim.htm

**Adopted:**
1. Persistent foam field (512²) — advected by *measured* surface velocity (frame-differenced
   cascade-0 displacement), exponential decay (τ ≈ 3 s), fed by Jacobian fold + H/D breaker
   mask + shoreline runup bands + wind-gated whitecap patches. Sampled with fbm breakup.
2. Up to **262k stateful GPU particles** (spray: gravity + drag + surface kill; foam flecks:
   advected surface drift, 6 s life), spawned by the same detectors. Rendered as soft
   sprites with fog and tone mapping.

---

## 5. Rendering the surface

- Geometry: radial log grid following the camera (dense near, horizon far) — same spirit as
  Bruneton's projected grid, simpler and watertight.
- Normals from finite differences of the *displaced* field + wind-scrolled micro-normals.
- PBR-ish water: Schlick Fresnel, procedural sky reflection, depth-graded body color
  (Beer–Lambert feel), sun specular + glitter, backlit subsurface scattering through
  crests, foam blend, exp² fog, ACES.
- Seabed with wet/dry sand, reef rock, animated caustics (Hosking-style interference),
  exposed in troughs over the reef by a surface-above-seabed alpha gate.

---

## 6. Implementation map

| Method | File |
|---|---|
| JONSWAP/TMA/PM/Phillips, Donelan–Banner, fetch laws, cascade bands, Hs prediction | `src/ocean/spectra.js` |
| Bit-reversed DIT butterfly tables | `src/core/butterfly.js` |
| Spectrum evolution, FFT stages, combine, foam, spray shaders | `src/ocean/glsl_sim.js` |
| Water/seabed/sky shaders | `src/ocean/glsl_render.js` |
| Bathymetry + shoaling (GLSL/JS mirrors) | `src/ocean/glsl_common.js`, `src/ocean/bathymetry.js` |
| Cascade manager (3× IFFT) | `src/ocean/cascades.js` |
| Advected foam field | `src/ocean/foam.js` |
| GPU spray/foam particles | `src/ocean/spray.js` |
| Analytic sources + buoys | `src/ocean/sources.js` |
| GPU-height probes + adaptive canceller | `src/ocean/probes.js` |

## 7. Validation & numerical notes

- `npm test` (offline): FFT vs naive DFT to ~1e-8; Parseval; **end-to-end spectrum→height
  energy ratio ≈ 1.36** (single-realization fluctuation around 1.0 — correct order);
  IFFT-of-Hermitian is real to 1e-17; fetch laws reproduce Tp ≈ 7.9 s / Hs ≈ 2.4 m for a
  fully-developed 10 m/s sea; spreading normalized; PM integrates to Hs²/16; cascade
  crossovers complementary; bathymetry/shoaling/analytic-source checks; all 16 materials'
  uniforms bound; canceller loop converges exactly in closed loop.
- **Energy scaling (derived, not tuned):** with H(k,t) = H0(k)e^(−iωt) + H0*(−k)e^(+iωt),
  x-mean variance = (1/N⁴)ΣE|H|² = (2c²/N⁴)ΣΨ ⇒ c = N²·dk/√2. The shader uses exactly this.
- **Sign-convention subtlety:** Tessendorf's paper pairs e^(+iωt) with a *forward*-sign
  summation; because our butterfly is a true inverse FFT (e^(+ikx)), we use e^(−iωt) so
  downwind spectral energy travels downwind. Verified algebraically (§1 derivation) and
  consistent with the one-sided spectra.
- `npm run test:render` (needs network for the headless browser): loads the built app in
  headless Chromium (SwiftShader), fails on any console/page error, screenshots scenarios.

## 8. Limitations & future work

- FFT assumes deep, stationary water; surf-zone transform is a local approximation (no
  refraction of directions, no true overturning mesh — cf. Thürey sheets).
- Swell–windsea nonlinear interaction and wave–current coupling are not modeled.
- Full Lagrangian wave-particle patch injection per Xue et al. (2025) is future work.
- No underwater rendering (camera constrained above the surface); no acoustic output.

## 9. References

**Spectra & wave physics**
- Tessendorf, J. "Simulating Ocean Water." SIGGRAPH course notes, 1999.
- Hasselmann, K. et al. "Measurements of wind-wave growth and swell decay (JONSWAP)." 1973.
- Pierson, W. J. & Moskowitz, L. "A proposed spectral form for fully developed wind seas." 1964.
- Bouws, E. et al. "Similarity of the wind wave spectrum in finite depth water (TMA)." 1985.
- Donelan, M. A., Hamilton, J. & Hui, W. H. "Directional spectra of wind-generated waves." 1985.
- Hasselmann, D. E. et al. "Directional wave spectra observed during JONSWAP 1973." 1980.
- Mitsuyasu, H. et al. "Observations of the directional spectrum of ocean waves." 1975.
- Elfouhaily, T. et al. "A unified directional spectrum for long and short wind-driven waves." 1997.
- Phillips, O. M. "On the generation of waves by turbulent wind." 1957.
- Miche, R. "Mouvements ondulatoires de la mer en profondeur constante ou décroissante." 1944.
- Monahan, E. C. & Muircheartaigh, I. "Optimal power-law description of whitecap coverage." 1980.

**Realtime methods**
- Bruneton, E., Neyret, F. & Holzschuch, N. "Real-time Realistic Ocean Lighting." 2010.
- Dupuy, J. & Bruneton, E. "Real-time Animation and Rendering of Ocean Whitecaps." 2012.
- Thürey, N. et al. "Real-time Breaking Waves for Shallow Water Simulations." PG 2007.
- Finch, M. "Effective Water Simulation from Physical Models." GPU Gems, 2004.
- Horvath, C. "Empirical Directional Wave Spectra for Computer Graphics." PhD thesis, 2015.
- Ryan, R. "Ocean Rendering, Part 1 – Simulation." 2025. https://rtryan98.github.io/2025/10/04/ocean-rendering-part-1.html
- Xue, S. et al. "Real-Time Interactive Hybrid Ocean." arXiv:2511.02852, 2025. https://arxiv.org/abs/2511.02852

**Active cancellation**
- "Perfect active absorption of water waves in a channel by a dipole source." 2024. https://blog.espci.fr/phil/files/2024/08/art_83.pdf
