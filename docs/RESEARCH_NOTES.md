# Can-Scale Reactor Lab — research and model notes

**Review date:** 2026-10-10 (UTC)  
**Model version:** 0.4.0

This project is an interactive, browser-local teaching simulation. It is deliberately **not** a reactor design, safety case, licensing analysis, operating procedure, or prediction of the behaviour of a real nuclear system. Geometry and coefficients are scaled for an easy-to-read can-scale exhibit; they must not be used to size hardware or infer safe operating limits.

## What informed the implementation

- The Frontier editor branch requested for the UI was inspected at `SultanAladin/Frontier-`, branch `arena/10e50e56-frontier`. The shell follows its most recent Project Zero editor direction: rounded dark docks, outliner / viewport / inspector layout, pill controls, explicit status strips, and inspector cards. This app uses those presentation ideas rather than importing Frontier engine code.
- The browser renderer uses the current `three` package resolved from npm on the review date (`0.186.1`). The viewport uses `WebGLRenderer`, `OrbitControls`, physically-based materials, explicit lighting, and grouped modules so the canister can be inspected in cutaway or exploded view.
- The OpenMC project was checked as a current open-source reference for the distinction between a detailed neutron-transport tool and this deliberately reduced-order visual model. OpenMC is not embedded here and no claim is made that this app reproduces its results. Reference: [openmc-dev/openmc](https://github.com/openmc-dev/openmc).
- The current Frontier upstream branch was checked through the GitHub API during implementation. Reference: [SultanAladin/Frontier-](https://github.com/SultanAladin/Frontier-/tree/arena/10e50e56-frontier).

## Equations used

The simulator exposes its simplified equations in the Materials inspector and keeps the implementation in `src/simulation.js`.

1. **Point-kinetics proxy**

   `dn/dt = ((rho - beta) / Lambda) n + lambda C`  
   `dC/dt = (beta / Lambda) n - lambda C`

   `n` is normalized neutron density and `C` is a single delayed-precursor state. `beta`, `lambda`, and `Lambda` are illustrative coefficients chosen to keep the interactive run stable; this is not a multi-group or spatial kinetics solver.

2. **Thermal balance**

   `m c dT/dt = P - UA * flow * (Tcore - Tcoolant)`

   `P` is the normalized thermal source, and `UA`, thermal mass, flow, and capacity are material-specific exhibit coefficients. The implementation integrates this equation with a bounded explicit timestep.

3. **Shielding proxy**

   `dose = source * exp(-attenuation * thickness)`

   This is a comparison visual for relative stack behaviour. It does not model spectrum, buildup, geometry, streaming, activation, or a regulated dose assessment.

4. **Uncertainty and failures**

   Flow, temperature, vibration, and dose readbacks receive deterministic bounded noise. A seeded PRNG makes comparison runs repeatable. Coolant loss changes loop transport, a sensor fault widens readback noise, and a shield breach increases the displayed outside-dose proxy. Automatic SCRAM latches on the configured demonstration limits; `Render core inert` drives the normalized chain-reaction state toward zero.

## Validation performed

`npm test` runs seven checks in `src/simulation.test.js`, including:

- same-seed reproducibility;
- finite, bounded baseline traces across 16 seeds;
- sensor noise bounds and sensor-fault widening;
- material swaps by both ID and record;
- coolant-loss and vibration interlocks;
- core inerting / power decay;
- expected shielding attenuation ordering.

The test suite is a reliability check for this UI model, not evidence of nuclear safety. Real systems require independent physics validation, qualified instrumentation, defense-in-depth, licensed analysis, and regulatory review.
