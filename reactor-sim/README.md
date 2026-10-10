# Coke-can reactor simulator

A source-driven, coke-can-sized reactor model (a standard 355 mL can, 66.0 mm × 122.2 mm) with swappable
materials, noisy flow instrumentation, vibration, radiation dose, safety protocols that SCRAM the core
and destroy it on any accident, a power output calculation, and a 3D model in the Frontier- editor layout.

> **Size assumption.** The envelope is the manufacturer's 355 mL can (66.04 × 122.2 mm, two sources agree).
> The model uses 66.0 mm diameter so it is never larger than the can. This assumption has not yet been
> confirmed with the requester.

## Run

```bash
npm install
npm run dev        # editor UI on port 5173
npm test           # 36 physics and reliability tests (node:test, no extra dependencies)
npm run campaign   # regenerates docs/campaign.json and docs/CAMPAIGN.md (about 5 s)
```

## Layout

| Path | Contents |
|---|---|
| `src/physics/constants.js`, `nuclear-data.js` | Physical constants, U-235/U-238 data, element cross sections, μ/ρ at 1 MeV |
| `src/physics/materials.js` | Material libraries by role (fuel, cladding, moderator, reflector, shield, coolant, structure, absorber, thermoelectric) |
| `src/physics/geometry.js` | Coke-can layered geometry, pin lattice, control-rod guide positions |
| `src/physics/neutronics.js` | Macroscopic cross sections, four-factor k∞, one-group grid diffusion for k_eff, rod and poison worth |
| `src/physics/kinetics.js` | Six-group point kinetics (implicit), source term, Way-Wigner decay heat |
| `src/physics/thermal.js` | Fuel, bulk-coolant and wall thermal network; film coefficient; thermoelectric efficiency |
| `src/physics/vibration.js` | Cantilever mount model, Miles response to a PSD profile, Basquin fatigue (Miner damage) |
| `src/physics/radiation.js` | Cf-252 source strength, neutron and gamma transport along the radial and axial paths, H*(10) |
| `src/physics/safety.js` | Sensors with bias and noise, 2-out-of-3 voting, trip and accident labels |
| `src/physics/rng.js` | Seeded RNG and bounded AR(1) process (pump pulsation) |
| `src/physics/reactor.js` | Coupled simulator: flow, reactivity, kinetics, decay heat, thermal, TE, vibration, dose, sensors, accidents |
| `src/physics/scenarios.js` | Named scenarios with expected behaviour (used by the tests) |
| `src/physics/campaign.js`, `scripts/run-campaign.mjs` | Material sweeps, scenario matrix, mount sweep, seed repeatability |
| `src/sim/useSimulation.js` | Simulation loop for the UI (fixed 0.25 s step, 1 s history) |
| `src/ui/` | Editor layout and components (Frontier-based stylesheet, inspector controls, 3D viewport) |
| `tests/physics.test.mjs` | Analytic, closed-form, validity, scenario and reliability tests |
| `docs/CAMPAIGN.md`, `docs/campaign.json` | Results of the last campaign run |

## Physics

- **Reactivity.** Rods, Doppler (fuel temperature) and coolant-density feedback. k∞ comes from the four-factor
  formula (η, ε, p with I_eff = 45 b for U-238, thermal utilisation with a flux-depression disadvantage
  factor). k_eff comes from a one-group grid diffusion solve (40 × 60 cells, banded Cholesky) with the
  radial/axial reflector and shield.
- **Kinetics.** Six delayed-neutron groups, backward-Euler, with the external source term
  q = E_f·S/(ν·Λ). For a subcritical core this reproduces the closed form P = E_f·k·S/(ν(1−k)); the test
  suite checks it to 5 %. Generation time Λ comes from the fundamental-mode flux.
- **Decay heat.** Way-Wigner, P/P₀ = 0.066 (t^−0.2 − (t+T)^−0.2), applied after a SCRAM with the operating
  time T. Operating decay-heat inventory uses the same expression at a 10 s shutdown. This is a
  simplification: ANS-5.1 is more accurate.
- **Thermal.** A three-node network (fuel, bulk coolant, can wall). Film coefficient: laminar fully developed
  Nu = 4.36 (Re < 2300), Dittus–Boelter for turbulent flow, and a Skupinski-type correlation for liquid metals
  (Pr < 0.1). The steady state reproduces the analytic series resistances (see tests).
- **Thermoelectric.** Efficiency from ZT of the leg material, bounded by the Carnot limit (tested).
- **Vibration.** Single-degree-of-freedom cantilever (f_n = √(3EI/mL³)/2π), Miles relative response to the
  acceleration PSD, root bending stress σ = 3Ed·z/(2L²), Basquin fatigue. Profiles: seismic, truck, aircraft.
- **Radiation.** Fast-neutron removal and gamma attenuation with linear buildup along the radial and axial
  paths. Cf-252 at 2.314 × 10⁶ n/s per µg; the unshielded neutron H*(10) at 1 m matches the published
  25.5 µSv/h per µg within 10 % (tested).
- **Noise.** Pump pulsation is an AR(1) process clamped to ±5 %. Each flow sensor carries a fixed bias
  (±1 %) and random noise (0.5 % 1σ). Sensors vote 2-out-of-3. The physical state, not the sensed one,
  decides accidents.

## Safety protocols

Trips (SCRAM): overpower, low flow (3 s hold), temperature within a margin of a limit, dose above the surface
limit, mount damage alarm, manual SCRAM. Accidents: prompt criticality, fuel melt, cladding breach, coolant
over-temperature or freeze, loss of cooling (flow < 2 % for 30 s), mount fatigue or yield, dose exceedance,
scram failure. Any accident destroys and poisons the core (Gd₂O₃ slurry, k_kill ≈ 0.006) when auto core-kill is on.
A SCRAM switches off an external neutron generator; a Cf-252 source cannot be switched off.

## Validity and what the model rejects

The thermal four-factor model applies only to a moderated core. In this compact can, coolant is only a few
per cent of the core volume, so a coolant with little moderation (D₂O, helium, sodium, LBE, FLIBE) gives a
resonance escape p ≈ 0, which is outside the model. Such configurations are **rejected with the reason** and
never run. Likewise a shield that makes the rods-out state supercritical (B4C shield, k ≈ 1.01) is rejected:
the source-driven steady state is undefined.

Water coolant is valid. Graphite, ZrH and BeO moderators are valid, and they reduce k_eff.

## Results

Full tables are in `docs/CAMPAIGN.md`. Summary:

- **Default design:** k_eff 0.860, k∞ 1.185, P_NL 0.726, Λ = 0.1 ms, steady 1.9 nW from the 10 pg start-up
  source, surface dose 0.37 µSv/h, mass 3.85 kg.
- **Coolant:** only H₂O is valid in this geometry (see Validity).
- **Moderator:** adding graphite, ZrH or BeO lowers k_eff to 0.71–0.75 (they halve the coolant volume).
- **Shields at a fixed source:** per unit thickness, tungsten transmits the least for both neutrons and
  photons. Per unit mass, borated polyethylene (1.42 kg) is far better than tungsten (3.85 kg). The
  removal cross sections come from approximate literature values and have not been checked against transport calculations.
- **Mount:** SS316L at 6 mm fails within the first step under the truck profile. Ti-6Al-4V at 8 mm lasts
  about 2 s, and IN718 at 8 mm about 69 s. Ti-6Al-4V at 12 mm survives 600 s.
- **Accidents tested:** SCRAM on low flow; loss of cooling after a blockage with pump trip; overpower and
  dose exceedance from a source surge; coolant over-temperature with and without SCRAM protection; manual
  SCRAM and core kill; mount fatigue; prompt-critical guard (B4C case).
- **Not reached in this design:** fuel melt and cladding breach. Water always reaches its coolant limit first,
  so these branches are kept as defence-in-depth checks, not claimed as exercised.
- **Reliability:** 36 tests pass on each of three repeated runs; five seeds give identical physics for the
  nominal case, and the flow-measurement error stays inside the configured envelope.

## Limitations

- Not a licensed or safety-certified design. For education and design comparison only.
- Thermal four-factor k∞ and one-group diffusion. No two-group or Monte Carlo transport.
- Decay heat during operation uses a simplified Way-Wigner form (see Physics).
- Single-DOF mount; no multi-mode or random fatigue beyond Miles and Basquin.
- Thermal network is lumped; no axial coolant temperature profile.
- Shielding uses removal and attenuation approximations, not ray-traced transport.
- Vibration display is exaggerated (slider) so small motion is visible; the physics is not scaled.

## References used

- OSTI 1184089, Neutron Sources for Standard-Based Testing: Cf-252 source strength and dose rates.
- NIST XCOM mass attenuation coefficients (Z = 1–82), at 0.5, 1 and 2 MeV.
- Wikipedia, "Decay heat": Way-Wigner expression (valid roughly 10 s to 100 days).
- Miles equation for random vibration, as summarised in caeflow.com (2026) and the eng-tips thread (2006).
- Duderstadt & Hamilton, *Nuclear Reactor Analysis*; Lamarsh, *Introduction to Nuclear Engineering*: LWR
  lattice k∞ ≈ 1.3, p ≈ 0.9, thermal disadvantage factor ≈ 1.2–1.3 (used to calibrate I_eff and the disadvantage coefficient).
- Wikipedia, "Thermoelectric materials", and the OSTI thermoelectric review: ZT values for Bi₂Te₃ (≈0.8–1.0),
  p-type PbTe (>2) and n-type SiGe (≈1.1 at high temperature).
- Crown Cork and aluminum-can.com: 355 mL can dimensions.
- ScienceDirect S0306454909003338 and a 2009–2010 fast-neutron removal paper: removal cross sections (approximate).
- nuclear-power.com and energy.gov: 1204 °C PCT and 17 % cladding oxidation criteria used as limits.
- Frontier- repository (SultanAladin/Frontier-, branch `arena/10e50e56-frontier`), `Experimental/ProjectZeroEditor`:
  stylesheet and inspector patterns (`src/ui/editor-base.css`). The DM Sans font (SIL OFL 1.1) is in `public/fonts/`.
