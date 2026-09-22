# SolidScape — Erosion Report & Plan

**Status:** design report · answers two questions: (1) is the brute-force tape performance cliff
fixable, (2) which erosion approach to build, how to get micro detail past the resolution wall,
and how to keep it realtime with a timeline.

---

## Part A — Yes, the tape cliff has a fix (and it was designed in from day one)

The current renderer re-interprets the **entire edit tape per pixel per raymarch step**. Cost is
`O(pixels × steps × edits)` — that's why it degrades past a few hundred dabs. This is Phase 1 of
`SDF-Research.md` *on purpose*: it validates the document model with minimum code, and the fix
never touches that document model.

The fix is the **sparse brick cache** (Phases 2–4 of the research doc):

| | Brute force (now) | Brick cache (Phase 2+) |
|---|---|---|
| Render cost | O(edits) per step | **O(1)** per step — one texture fetch into an 8³ brick |
| Edit cost | free (append to tape) | re-evaluate only the ~30–50 bricks the dab touches |
| Memory | none | ~73 MB at 0.5 mm-equivalent detail with adaptive LOD |

Mechanically: the field near the surface gets baked into a pool of small 8³ distance bricks
(8-bit, ±4-voxel band). The raymarcher steps through a coarse index and samples bricks — it never
sees the tape. When you place a dab, only the bricks inside the dab's bounding box (plus a halo)
are re-evaluated against the tape — and *that* evaluation is cut down further by Lipschitz pruning
(×629 speedup on ~6k-edit documents in the EG 2025 paper). Claybook shipped exactly this
architecture at 60 fps on a *Nintendo Switch* with a fully dynamic world SDF — render cost
independent of brush count is a proven property, not a hope.

Two cheap mitigations arrive even before Phase 2:

1. **Stroke coalescing** — 200 dabs along a drag become one capsule/spline edit. Typical strokes
   compress 10–50×. This alone moves the cliff from "hundreds of dabs" to "hundreds of strokes".
2. **Tape windowing** — primitives whose bounding sphere can't affect a pixel's ray are skipped
   by a per-tile prepass (a poor man's pruning, ~1 day of work).

So: sculpt freely; the ceiling you'll hit is temporary scaffolding, not the architecture.

---

## Part B — Erosion

### B.1 Why your two attempts didn't merge — and the known fix

What you built maps exactly onto the two families in the literature:

- **Particle/droplet erosion** (your favourite): spawn rain droplets, integrate them downhill,
  each erodes when under sediment capacity and deposits when over. Realistic gullies, fans,
  meanders. The pain you hit — "simulating the particles properly; size; how much they cut; when
  it turns into sedimentation" — is the classic tuning problem: each droplet only knows the
  *local* slope, so it has no idea whether it's part of a river or a trickle. It also can't pool:
  a lone particle reaching a pit just dies; lakes never form from particles alone.
- **Gaea-style algorithmic erosion** (stream power / thermal / flow-accumulation): grid-based,
  fast, stable, great macro structure (dendritic valleys, ridges) — but smooth, "simulated
  looking", and it doesn't give you the debris-flow micro character particles give.

The reason they fought each other: **both were trying to own the water.** The documented fix
(used in one form or another by Mei et al. 2007's shallow-water GPU erosion, Stava et al.'s
interactive erosion, and modern hybrid pipelines) is a strict division of labour:

> **The grid owns the water. The particles own the cutting.**

Concretely: run a cheap shallow-water simulation (the "virtual pipes" model) on a heightfield.
It produces two things particles cannot make — a **water depth map** (lakes and rivers pool and
find their level automatically, mass-conserving) and a **velocity/flux field**. Then droplets stop
guessing from local slope: they **advect along the grid's velocity field**, and their erosion
strength scales with the local *flux* (how much water is really flowing there) instead of their
own tiny volume. Suddenly:

- droplets in a drainage line all agree with each other → coherent river carving, not noise;
- sediment capacity is `capacity ∝ flux × speed × slope` → cut vs deposit resolves naturally:
  fast confined flow cuts, slowing/spreading flow drops sediment → deltas and fans at lake inlets
  *for free*, because the grid told the particle the water slowed down;
- lakes exist (grid), and rivers entering them deposit (particles) — the exact
  "rain → cut → carry → sedimentation → rivers and lakes" loop you described.

You already proved each half works. The merge is not a research risk; it's plumbing the velocity
texture from one sim into the other.

### B.2 The resolution wall — stop buying detail with grid cells

"Looks good at low res, can't get micro detail" is fundamental: erosion features live at *all*
wavelengths, and doubling grid res costs 4× memory and ~8× total work (more cells × more steps).
Nobody brute-forces this — Gaea, and the 2024 SIGGRAPH "Terrain Amplification using Multi Scale
Erosion" paper (Schott et al.), all go **multi-scale**:

1. **Macro pass (512²–1024², whole region):** hybrid sim above. Gets drainage topology, valleys,
   lakes right. This is the realtime, watchable part.
2. **Detail cascade (tiles at 2–4× finer, only where it matters):** re-run a short erosion burst
   on high-flow / high-slope tiles, using the macro flow field as boundary conditions. Detail
   appears where water actually worked, not uniformly.
3. **Micro layer (no sim at all):** the sim's by-products — flow accumulation, wear, deposition
   maps — drive *procedural* micro detail: flow-aligned striations, talus break-up, sediment
   smoothing, applied at shading/displacement time in the SDF evaluation. Below ~1 m wavelength,
   simulated and flow-driven-procedural are visually indistinguishable, and the procedural version
   is resolution-independent — which is exactly what an SDF wants.

This is also why erosion in SolidScape is a **bake node** (per the research doc): the sim runs on
its own grids, and its *output* (height delta + the map stack) becomes a baked layer the analytic
SDF pipeline composes. Sculpt dabs after the bake stay live on top of it.

### B.3 What we build, in order

**Start with the particle system — your preference is also the right first move**, because the
droplet kernel is ~20 lines of physics and gives satisfying results before any grid exists. But
structure it from day one to receive the grid's velocity field in stage E2.

#### E1 — GPU droplet erosion + timeline (the realtime toy that stays)
- **Capture:** `Erosion` node bakes its input field to a heightfield tile (raycast top-down from
  the tape — the CPU/GPU evaluators already exist). Region + resolution (512/1024/2048) are node
  params; resolution also gets a global default in Viewport Settings.
- **Sim:** ~64k–256k concurrent droplets, fully on GPU in WebGL2:
  - droplet state (pos, vel, volume, sediment) lives in ping-pong RGBA32F textures, advanced by a
    fragment shader (1 texel = 1 droplet);
  - erosion/deposition is **scatter by point-splatting**: each droplet is drawn as a point with
    additive blending into a height-delta texture (this replaces the compute-shader atomics we
    don't have in WebGL2 — it's the standard trick and it works);
  - dead droplets (evaporated/exited) respawn as fresh rain, weighted by a rainfall mask.
- **Timeline on the node:** the sim free-runs and you watch it carve in the viewport. Node UI:
  ▶ / ⏸, sim-speed multiplier (steps per frame), a **step counter scrubber**, and *Commit*.
  Scrubbing back = restore from a checkpoint ring (height + sediment snapshot every N steps,
  ~8 checkpoints ≈ 32 MB at 1024²). Commit freezes the delta into the node's baked layer;
  Reset returns to the pre-sim capture.
- **Outputs:** eroded height (as the node's field output) + `flowMap` (flow accumulation — the
  port already exists on the node) + deposition map, wired into Slope Mask / Material nodes.

#### E2 — Shallow-water grid + coupling (rivers and lakes done right)
- Virtual-pipes water sim on the same tile (4 flux components + depth, two ping-pong passes —
  gather-only, fragment-shader-friendly, ~2 ms at 1024² on a mid GPU).
- Droplets switch from slope-following to **advecting along grid velocity**, erosion strength
  scaled by grid flux; capacity model as in B.1.
- Water depth renders in the viewport (this is your realtime rain → pooling feedback), and a
  `lakeMask`/`waterLevel` output appears on the node.

#### E3 — Multi-scale detail
- Detail-cascade tiles on high-flow areas (2–4× finer, short bursts, macro flow as boundary).
- Flow-driven procedural micro detail evaluated in the SDF shading pass (striations, talus,
  sediment smoothing) — infinite resolution, zero sim cost.
- Optional stream-power pre-pass for continent-scale inputs (Gaea-style macro structure feeding
  the hybrid sim), which is cheap to add later because it shares the grid infrastructure.

### B.4 Performance budget & reference points

| Piece | Cost (mid GPU, 1024² tile) | Reference |
|---|---|---|
| Droplet update pass (256k droplets) | well under 1 ms | 1M droplets sim'd in ~10 s total on GTX-class compute (10Kaiser10); our per-frame slice is far smaller |
| Splat pass (256k points, additive) | < 1 ms | standard particle splatting |
| Shallow-water step (2 passes) | ~1–2 ms | 1024² erosion step ≈ 2 ms on a GTX 1050 (CMU 15-618 project); Mei et al. ran interactively on 2007 GPUs |
| Stream power (if added) | few ms/step, converges in seconds at 1024² | Schott 2023, interactive up to 4096² |
| Checkpoint ring (8 × 1024² RG32F) | 32 MB | — |

Rules that keep it realtime:
- **Fixed sim budget per frame** (e.g. 4 ms): sim speed control changes *steps per frame*, never
  step size — parameters stay stable, only wall-clock speed changes.
- Sim renders into the *heightfield*, not the SDF: while the timeline plays, the viewport shows
  the eroding heightfield tile composited in place of that region; only *Commit* re-bakes into
  the SDF document. No tape growth, no brick churn during playback.
- Everything ping-pongs in textures already resident on the GPU — zero CPU↔GPU traffic per step
  except the tiny uniform block.

### B.5 Decision summary

1. **Fixable — yes.** The dab cliff dies with the Phase 2 brick cache (+ stroke coalescing much
   sooner). Render cost becomes independent of edit count; Claybook proved the ceiling.
2. **Start with particle erosion (E1)** — your pick, and the right one: fastest to satisfying
   results, becomes the detail engine of the final hybrid rather than throwaway.
3. **Add the water grid (E2)** to fix exactly what frustrated you: droplets stop being tuned in
   the dark — the grid's flux/velocity tells them how big they act, when they cut, when they drop
   sediment; lakes/pooling come from the grid, deltas from the coupling.
4. **Micro detail is multi-scale, not more resolution (E3):** detail-cascade tiles + flow-driven
   procedural micro layer. Never brute-force the grid.
5. **Erosion is a bake node with a timeline:** free-running GPU sim, play/pause/speed/scrub over
   checkpoints, Commit → baked layer in the SDF document. Realtime to watch, deterministic to keep.

### References
- Mei, Decaudin, Hu — *Fast Hydraulic Erosion Simulation and Visualization on GPU* (virtual pipes).
- Schott et al. — *Large-scale Terrain Authoring through Interactive Erosion Simulation*, TOG 2023
  (interactive stream power, 4096² interactive; code: github.com/H-Schott/StreamPowerErosion).
- Schott et al. — *Terrain Amplification using Multi Scale Erosion*, TOG 2024 (multi-scale
  thermal/stream-power/deposition cascade — the micro-detail strategy).
- McDonald (weigert) — *Simple Particle-Based Hydraulic Erosion* (the ~20-line droplet kernel).
- 10Kaiser10 — Unity compute-shader droplet erosion (1M drops ≈ 10 s).
- Swenson & Patil, CMU 15-618 — grid erosion step ≈ 2 ms at 1024² on GTX 1050.
- Nilles et al., VMV 2024 — multi-layered heightmap 3D erosion (overhangs/arches — relevant later
  since our terrain is a true SDF, not a heightfield).
