# Slate — Terrain Forge

A browser prototype for an AAA-oriented, node-based SDF terrain authoring workflow. The UI is intentionally dense and technical: outliner, realtime viewport, node graph, inspector, and solver telemetry are all visible at once.

## Run

This is a static HTML prototype. From the repository root:

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Open `http://localhost:4173`.

## What is implemented in the preview

- SDF-oriented terrain scene with smooth signed-distance style material language, caves, overhangs, a basalt ridge, and a river catchment.
- Live terrain viewport with animated river currents and three small particle populations: water, rain impact, and aeolian grains.
- Particle/terrain exchange with a bounded erodible layer, sediment capacity, deposition, evaporation, abrasion, and finite particle lifetimes. A particle cannot erode indefinitely: it must carry sediment, lose capacity, or settle before it is respawned.
- River flow follows a curved catchment path and updates a small height-delta field. Rain particles fall to the surface and transition into water particles; wind grains saltate across the ridge and deposit on the lee side.
- SDF subtract brush, local rain source, and river source tools in the viewport.
- Node graph for `SDF Terrain → Hydraulic Erosion → Sediment Solver → SDF Commit`, with rain, river, and wind inputs.
- Live controls for rain rate, erosion rate, sediment capacity, deposition threshold, evaporation, wind speed, and particle radius.
- GTX preview profile (`512³`) alongside adaptive-octree, caves/overhangs, material conservation, and settle-on-contact controls.

This is a visual and interaction prototype, not a substitute for a production WebGPU compute pipeline. The `sampleSDF` function and the bounded exchange model are present so the browser demo has the same conceptual contract as the eventual GPU implementation.

## AAA production requirements / recommended next step

### 1. Volumetric representation

Use a sparse, brick-addressed SDF volume rather than a single dense texture. Keep a coarse clipmap for the whole landscape and high-resolution resident bricks around the camera, active emitters, and edit falloff. Store at least:

- signed distance / occupancy;
- material ID and hardness;
- water depth and velocity;
- suspended sediment and deposited sediment;
- dirty/version flags for meshing and replication.

Use dual contouring or a GPU marching-cubes path to extract render meshes from dirty bricks. Keep the SDF as the source of truth and rebuild collision/render LODs asynchronously. This is what makes caves and overhangs possible; a height-only buffer cannot represent them.

### 2. Hydraulic solver

The default production path should be a hybrid, not one giant SPH simulation:

1. shallow-water / pipe flow on a coarse surface-adjacent grid for stable catchment-scale water;
2. Lagrangian droplets for rain impact, splash, local cuts, and artist-authored river sources;
3. material exchange at the SDF contact point, using local gradient, particle velocity, hardness, water amount, and sediment capacity;
4. evaporation and explicit settling when capacity falls below carried sediment;
5. thermal slippage / talus-angle pass after erosion so banks collapse naturally instead of being pushed and pulled by particles.

Every contact must have a bounded material budget and a fixed timestep/substep policy. That is the important fix for the earlier “particle drills a hole forever” artifact: erode only available erodible material, carry that mass with the particle, deposit it when velocity/capacity drops, and clamp the removal per cell per step.

### 3. Wind erosion

Represent wind as a surface velocity field with terrain shadowing. Split transport into saltation, creep, suspension, abrasion, and deposition. Use the velocity field and impact angle to determine whether a grain rebounds, creeps, abrades bedrock, or settles on the lee side. This should remain a separate node family so wind can be mixed with hydraulic results without baking either process into the base SDF.

### 4. Realtime budgets

For a GTX-friendly editor target, keep the interactive preview separate from final bake:

- 512³ profile: active sparse bricks near the edit/particle region, low-cost preview mesh, 128–512k visible particles;
- compute work in WebGPU compute shaders with ping-pong buffers and indirect dispatch;
- dirty-brick meshing and collision updates amortized over frames;
- temporal accumulation for water/current display instead of increasing simulation resolution;
- deterministic seed, fixed timestep, checkpoint/snapshot history, and a background high-resolution bake;
- telemetry for solver ms, active bricks, dirty triangles, water volume, and sediment mass conservation.

The UI in this repository exposes those controls and telemetry so they can map cleanly to a future WebGPU backend.

## Research basis

- Faraj et al., *Flexible erosion simulation for terrains defined by signed distance functions* (2024): SDF contact formulation, hydraulic/rain/river and wind particle cases, and a modular 3D terrain model. [PDF](https://www.lirmm.fr/~nfaraj/publications/flexible_erosion/2024_Flexible_Terrain_Erosion.pdf)
- Št’ava et al., *Interactive Terrain Modeling Using Hydraulic Erosion* (2008): couples force and dissolution erosion, pipe-model transport, multilayer material exchange, bank slippage, and GPU interaction. [Paper](https://www.cs.purdue.edu/cgvlab/www/resources/papers/Stava-2008-Interactive_Terrain_Modeling_Using_Hydraulic_Erosion.pdf)
- Mei, Decaudin & Hu, *Fast Hydraulic Erosion Simulation and Visualization on GPU* (2007): water increment, flow, erosion/deposition, sediment transport, and evaporation on the GPU. [DOI](https://doi.org/10.1109/PG.2007.15)
- Rosset et al., *Windblown sand around obstacles — simulation and validation of deposition patterns* (2024): wind flow, saltation, and obstacle-aware deposition. [Project page](http://www-sop.inria.fr/reves/Basilic/2024/RDBC24/)
- Holwerda, *WebGPU SDF Editor* (2026): sparse spatial partitioning, SDF hierarchy, interactive marching-cubes extraction, and a practical WebGPU editor architecture. [Article](https://reindernijhoff.net/2026/01/webgpu-sdf-editor-real-time-signed-distance-field-modeling/)
