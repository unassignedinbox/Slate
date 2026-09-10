# SLATE — Erosion model

Research-informed GPU multi-agent weathering on a true SDF volume. The primary
reference is **Hartley, Mellado, Fiorio & Faraj, “Flexible terrain erosion,”
The Visual Computer (2024)** (DOI `10.1007/s00371-024-03444-w`), which splits
alteration / transport / deposition across independent particle agents and
explicitly supports SDF/voxel terrain. SLATE is an **adaptation for a
node-based browser tool**, not a reproduction of that paper's experiments.

## Representation — why this is not a heightmap

The terrain is a **bounded 3D signed-distance volume** (e.g. 160×104×160 voxels
at 1.0 m cells) stored as a ping-pong `RGBA32F` atlas of Z-slice tiles:

| channel | meaning |
|---|---|
| R | signed distance (metres, trilinearly sampled) |
| G | wetness (painted by wet agents, decays) |
| B | cumulative deposited volume (sediment bars, shading) |
| A | solid fraction in `[0,1]` — partial voxels anchor the interface |

Because occupancy is volumetric, **caves, arches, overhangs and cliffs are real
geometry**, and every erosion agent collides with the true surface via the SDF
gradient — on the underside of overhangs too.

`solidFraction = clamp(0.5 − d/cell)`, and partial voxels re-anchor
`d = (0.5 − a)·cell`. A relaxation pass each step keeps distances useful in
full/empty cells (Eikonal-style, one Gauss-Seidel sweep per step).

## Agents

| Agent | Birth / motion | Alteration | Settling |
|---|---|---|---|
| **Rain** (hydraulic node) | sky births, first surface contact, gravity + runoff | thresholded shear + impact energy | evaporates; deposits remaining load when slow |
| **River** | source marker births at the bed, downhill creep along the SDF gradient | current-driven bed/bank shear | Stokes-style settling; point bars form on the inside of bends |
| **Wind** | upwind boundary band, aerodynamic relaxation, saltation re-launch hops | speed/contact abrasion, size-dependent settling | deposits in the lee when slow or loaded |
| **Thermal** | column relaxation pass (not particles) | material slides when slope exceeds the friction angle | screes accumulate at cliff bases |

Mechanical basis (water agents):

```text
stress      = sqrt(speed / max(0.12, brushRadius/2))
critical    = 0.15 + 1.55·hardness + strata(y)·0.25
demand      = strength · max(stress − critical, 0) · affectedVolume · dt · sizeFactor
capacity    = (0.02 + 0.30·capacityCtl) · water · (0.15 + 0.35·speed)
deposition  = load · settlingCtl · dt · 0.9 / (0.10 + speed²·0.35)
```

All demands are clamped by capacity, remaining supply, and the agent's
**cumulative cut cap** — this is what prevents the classic runaway failure
where a particle grinds an ever-deepening hole.

## The step (all GPU, WebGL2, no CPU readback)

1. **Motion** — 4 substeps; gravity / wind relaxation / downhill creep;
   SDF collision with restitution; impact + wetness flags; respawn of dead,
   expired, drained or capped agents. Speed cap keeps contact sampling bounded.
2. **Event** — per agent: propose detachment and deposition demands;
   normalize quadratic brush weights over the local 9³ voxel neighbourhood,
   split by local solid fraction (erosion lands on solid, deposition in voids).
3. **Scatter** — instanced quads (9 Z-slices per agent) additively accumulate
   `erode / deposit / coarse-weight / wetness` into a 16F exchange atlas.
4. **Acceptance** — per voxel:
   `acceptedE = min(E, a)`; `acceptedD = min(D, (1−a) + acceptedE)`;
   `a′ = a + acceptedD − acceptedE`. Occupancy is never negative — the
   **acceptance clamp is the conservation guarantee**. Per-voxel acceptance
   ratios are written back for the agents.
5. **Cargo feedback** — agents gather the *accepted* fractions over the same
   brush; load += accepted detach (agent-specific coarse/fine product);
   load −= accepted deposit (coarse grains preferentially settle); statistical
   attrition grinds coarse chips toward fines, mass-preserving.
6. **Distance repair** — partial voxels anchor the interface, one relaxation
   sweep restores magnitudes.
7. **Thermal** (every 2nd step, if enabled) — per-column top-height reduce,
   then slope-limited redistribution at the friction angle.
8. **Flow map** — wet agents splat velocity into a persistent 512² RGBA16F
   current map with exponential decay. This map drives the water shader.

A **ledger identity** holds by construction within float precision:
`detached = carried + deposited (+ retired at caps)`.

## Water shader

* Global **sea/lake level** plane with 4 non-commensurate wave modes,
  phase-advected along the **simulated flow direction** at that point,
  Fresnel + sun glints, RGB exponential absorption over a refracted bed march,
  and world-space foam from shore proximity + current strength + crest noise.
* A **river film** on the terrain wherever flow accumulates above threshold:
  wetness darkening, animated ripple normals aligned to the current, streak
  foam at speed. The currents you see are the currents the particles made.

## Known limits

* One marker = a parcel; mm grains are not geometrically resolved (cell ≈ 1 m).
* No CFD/pressure solve — rivers emerge from agent physics + gradient descent,
  not a free-surface solve. Flow accumulation decays (τ ≈ 7 s) rather than
  conserving water mass.
* Distance repair is one sweep per step; deep bands converge over frames.
* Inter-sim pattern nodes are baked before the first simulation stage (their
  effect is in the field); downstream-of-sim CSG re-applies analytically.
