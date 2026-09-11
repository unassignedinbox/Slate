# SDF Terrain Lab — requirements research

Why an SDF + particle-erosion + node-graph terrain tool, what the literature says,
how this build answers each requirement, and what a AAA production path looks like.

## 1. Why SDF instead of a heightmap

A heightmap stores one elevation per (x, z). It **cannot** represent caves, arches,
overhangs, sea stacks with notches, or true cliff undercuts — the exact features the
brief demands ("real caves, overhangs, cliffs — real detail, not heightmap").
A signed-distance field stores distance-to-surface for all of 3D space, so any
topology is representable, and CSG (union / subtract / intersect) is trivially exact,
which is what makes a Gaea-style node graph natural: every node outputs a field.

Costs, honestly stated:

- **Memory**: a dense `144×54×144` float volume plus accumulators is ~30 MB. A
  heightmap of similar footprint is < 1 MB. Production answer: sparse brick/tile
  storage (e.g. OpenVDB-style) and tiled streaming — see §8.
- **Meshing**: heightmaps triangulate for free; SDFs need polygonization
  (marching cubes / surface nets / dual contouring). This tool uses **surface nets**:
  one vertex per boundary cell, smooth normals by face accumulation, no per-frame
  cost beyond a throttled rebuild.
- **Erosion math is 3D**: droplets must collide with and slide along an implicit
  surface rather than following heightfield gradients. The method below is designed
  for exactly that.

Verdict: SDF is the right call for hero terrain with caves/overhangs. For
far-field / open-world streaming, bake SDF → heightfield + mesh tiles per region.

## 2. Erosion literature this tool follows

### 2.1 Droplet hydraulic erosion (Hans Theobald Beyer's model family)

The standard discrete model (Hans Theobald Beyer's thesis and its many descendants): a droplet
carries water volume `W` and sediment `S`, moves with inertia + gravity, and exchanges
mass through a **capacity** `C ∝ speed × water × slope`: erode when `S < C`, deposit
when `S > C`, evaporate over time. A widely used parameter summary
([1](https://medium.com/@ivo.thom.vanderveen/improved-terrain-generation-using-hydraulic-erosion-2adda8e3d99b))
lists the familiar knobs — inertia, capacity, deposition/erosion rates, evaporation,
gravity, lifetime, brush radius — which map 1:1 onto this tool's Rain/River
inspector parameters.

Shallow-water grid models (e.g. Mei–Decaudin–Hu 2007, "Fast Hydraulic Erosion
Simulation and Visualization on GPU",
[PDF](http://www-evasion.imag.fr/Publications/2007/MDH07/FastErosion_PG07.pdf))
instead solve flow/velocity fields and exchange sediment per cell with capacity
`C = Kc·sin(α)·|v|`. This tool uses the **droplet** variant (better for SDF
surfaces and for visible live particles), with Mei-style capacity structure.

### 2.2 Particle erosion directly on SDF/voxel terrain

Hartley, Mellado, Fiorio & Faraj, **"Flexible terrain erosion"**, *The Visual
Computer* 2024, DOI `10.1007/s00371-024-03444-w`
([record](https://ouci.dntb.gov.ua/en/works/4M0VrYd7/) ·
[PDF](https://www.lirmm.fr/~nfaraj/publications/flexible_erosion/2024_Flexible_Terrain_Erosion.pdf) ·
[abstract](https://www.researchgate.net/publication/379934758_Flexible_Terrain_Erosion_-_A_Fluid_Simulation-Independent_Approach_Compatible_with_Multiple_Representations))
present a particle method that works across heightfields, **voxels, material
layers and SDF/implicit terrains**, separating *alteration* (detach/deposit at
contact) from *transport* (ballistic/fluid motion with restitution and settling).
Key ideas adopted here:

- contact-driven alteration with a normalized compact brush (their §4.3–4.4
  discrete alteration), so stamps never create mass from nothing;
- per-particle size/density/restitution/capacity; settling and capture rather
  than endless bouncing;
- the same agent core drives hydraulic, river, wind and rockfall behavior with
  different force/alteration terms.

This tool is a **research-informed adaptation**, not a reproduction: capacity and
rate constants are artist-tuned for visible results in seconds-to-minutes, not
calibrated geology.

### 2.3 Rivers, sedimentation, deltas

Real-time tools commonly fake rivers as high-discharge droplet streams plus
analytic current guides. This tool does that honestly: River nodes spawn
high-water agents along an editable path with tangent-aligned initial velocity;
where slope vanishes (flats, lake entry) capacity collapses and the load drops —
forming point bars and deltas — and lake bodies force full deposition
(sedimentation). There is no shallow-water pressure solve; for hero rivers the
exported **flowmap** (RG = direction, B = flux) is the handoff to an engine water
shader.

### 2.4 Wind (aeolian) erosion

Wind transport = grains relaxed toward an air-velocity field (mean wind + gusts),
saltation/abrasion only above a threshold speed on contact, deposition when slow
or in lee shadows. Per-grain capacity mirrors the hydraulic form with slope
flattened out. This matches production practice for dunes (transport-limited,
not detachment-limited) at prototype fidelity. Dry agents correctly contribute
no wetness.

### 2.5 Thermal weathering / talus

Slope relaxation above an angle of repose (talus ~32–36°) plus ballistic
rockfall with impact cratering and scree shedding. Implemented as a stochastic
cellular pass (cheap, stable) plus true 3D rock agents for cliffs.

## 3. The "infinite hole" bug — settling design (required fix)

Prior art failure mode: particles that never settle keep eroding one spot
forever. This tool guarantees termination structurally:

1. **Capacity-limited exchange** — a particle can only hold `C`; excess is
   deposited immediately, so erosion per particle is bounded by its lifetime
   water budget.
2. **Five kill paths, four of which deposit everything**: slow-settle timer,
   evaporation below minimum water, maximum age, lake entry, and domain exit
   (exits audit as `exited`, never silently dropped).
3. **Availability clamping** — stamps only bite solid cells and only fill air
   cells; eroding air is a no-op, so mass accounting stays physical.
4. **Mass ledger** — `eroded / deposited / suspended / exited` in m³ with a live
   balance readout; the test suite asserts balance ≈ 1 and full termination.

Brush radius defaults to ~1 voxel (0.6–3.5 range) and particle dots render at
~3 px — the "big particles" complaint is addressed at both sim and view level.

## 4. Water that follows the current

Standard practice (Valve/Crytek-style flowmaps; distance-field-distorted UVs in
modern river shaders): advect procedural normals/foam along a flow vector rather
than scrolling a static texture. This tool:

- records per-voxel **flux + flux-weighted velocity** during erosion;
- builds **river ribbons** draped on the carved bed with per-vertex tangent flow,
  depth, and rapids factor (bed drop × discharge);
- builds **lake discs** with per-vertex depth (terrain raycast) and
  drift-plus-recorded-flux flow;
- shades with current-advected dual-scroll normals, depth absorption, fresnel sky,
  sun glint, shoreline + rapids foam.

Because ribbons rebuild from the live bed, water visibly tracks the channel the
river itself carved.

## 5. Node graph (Gaea-style) mapped onto SDF

| Gaea concept        | This tool                                                                 |
|---------------------|---------------------------------------------------------------------------|
| Primitives          | Box/Sphere/Ellipsoid/Capsule/Torus/Cylinder/Mesa/Ground                   |
| Generators          | Mountain, Hills, Plateau, Dunes, Canyon cutter, Cave worms                |
| Combine             | Union, Smooth union, Subtract (carving!), Intersect                       |
| Modify              | fBm/Ridged displace, Terrace, Domain warp, Transform, Material paint      |
| Erosion nodes       | Rain, River (+editable path), Wind, Thermal, Rockfall — all **live**      |
| Output              | Terrain Output (resolution, seed, auto-rebake)                            |

Field nodes compile to one closure baked into the volume; sim nodes stay live and
retune without rebaking. River paths edit in-viewport by raycasting the terrain.

## 6. UI requirements (SolidArc / Celestial mirror)

- Outliner (left) · viewport (center) · inspector (right), transport in the top
  bar, node graph docked under the viewport with Tab-add menu — matching the
  referenced studio layouts and their orbit/pan/dolly mouse language
  (LMB orbit, Shift/RMB pan, wheel dolly, F home).
- Debug shading modes (clay / wire / flux / wetness / sediment / material) are a
  deliberate AAA-tooling touch: erosion state must be *inspectable*, not just
  pretty.
- Diagnostics panel (renderer stats, sim step, ledger) with one-click copy for
  bug reports.

## 7. Performance budget (this build)

- Volume Standard `144×54×144` ≈ 1.1 M cells; bake ≈ 0.2–1 s (JS, one thread).
- Surface nets + colors ≈ 100–400 ms; throttled to ~3 Hz while simulating.
- 9,000 pooled agents × 2 substeps: brush-limited, comfortably 60 fps on desktop.
- Water rebuild (ribbons + lakes) ≈ ms-scale at ~0.6 Hz.
- Production hardening (§8) moves bake/mesh to workers and agents to GPU.

## 8. AAA production path (beyond this prototype)

1. **Sparse storage + streaming**: dense grid → bricked sparse volume (VDB-like),
   tile the world, stream/copy-on-write per tile.
2. **GPU sim**: port the agent core to compute (WebGPU/DX12) — the CPU model here
   (pools, capacity, settling, ledger) ports directly; keep the ledger as the
   correctness oracle.
3. **Meshing**: chunked dual contouring with crack sealing + LOD (this prototype's
   single-mesh surface nets is the placeholder).
4. **Materials**: upgrade 6 material ids → layered PBR (albedo/normal/roughness,
   wetness → roughness/darkening, flow → water mask) via virtual texturing.
5. **Water**: engine shader consuming exported flowmaps + depth; add discharge
   conservation at junctions for river networks.
6. **Determinism**: seed every emitter (done) + fixed-step sim (done) → recorded
   sessions replay bit-identically; add checkpointed undo for art direction.
7. **Collision/physics**: the SDF *is* the collision shape — export
   SDF tiles for character/vehicle queries.

## 9. Requirements checklist

- [x] True SDF (caves / overhangs / cliffs), not a heightmap
- [x] Node editor from basic primitives, Gaea-style
- [x] Live particle erosion visible in realtime (rain / runoff / rivers)
- [x] Rivers that carve channels + sedimentation (bars, deltas, lakes)
- [x] Wind erosion (abrasion + lee deposition, no wetness)
- [x] Thermal/talus + rockfall
- [x] Settling guarantee + mass ledger (no infinite holes)
- [x] Small particles (~3 px dots, load-tinted)
- [x] Water shader following river currents + foam
- [x] Professional SolidArc-grade UI (outliner/viewport/inspector/graph)
- [x] Single static folder, no build step, vendored three.js, tests
- [ ] GPU compute port, sparse streaming, engine integration (§8)
