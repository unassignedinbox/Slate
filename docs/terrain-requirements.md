# Strata terrain requirements

## Purpose

Strata is a node-based terrain authoring surface for AAA production rather than a heightmap toy. The current browser deliverable is a visual, interactive prototype: a WebGL2 ray-marched SDF preview, typed particle motion, a live water material, and the authoring graph. The production path should keep the same UX while moving field and particle state to GPU ping-pong resources.

## Why an SDF

A signed-distance volume stores the inside/outside boundary in XYZ. Negative distance is solid; positive distance is empty. Unlike a height field, a volume can retain:

- cave ceilings and cave floors at different positions in X/Z;
- undercuts and cliff overhangs;
- vertical walls, tunnels, arches and finite rock chunks;
- Boolean union/subtract/intersection operations on primitive nodes;
- collision queries for a particle at any point in space.

The representation is bounded and tiled for production. A useful runtime field has at least distance, wetness, loose/deposited material and solid fraction channels. A narrow-band or sparse brick hierarchy is needed for a world-sized game; the editor preview can use a smaller dense tile and stream neighboring bricks.

## Erosion model

The graph separates three operations so that no particle can permanently dig an unbounded hole:

1. **Alteration:** sample the SDF and its normal at contact. Detach a bounded amount from the contact kernel based on impact/shear, hardness, particle radius and material response.
2. **Transport:** carry typed cargo on the particle. Water/river particles receive an artist-guided velocity field; rain and rockfall use gravity and SDF collision response; wind uses an aerodynamic relaxation field.
3. **Deposition:** compare carried load to capacity. Deposit particulate material when speed, slope, water depth, or capacity falls. Mark a particle settled/retired and reconcile the material ledger back into the volume.

Each particle needs stable birth metadata: type, radius/diameter, restitution, density, capacity, material composition and seed. Switching emitters must not relabel existing particles or teleport their cargo. A particle that has reached a settled state must stop applying erosion until it is explicitly respawned.

A research-informed SDF contact kernel can be expressed as a compact volumetric request around a contact center `c`:

```text
request(q) = detach * max(0, 1 - |q - c| / radius)^2
```

The request is then limited by available solid/loose material and distributed with an atomic or reduction-safe accumulation pass. For a hydraulic agent, a practical capacity term is proportional to water amount, local slope and speed; for wind it is proportional to dry contact speed and grain response; for rockfall it is proportional to mass and normal impact energy. These are authoring controls, not claims of geological calibration.

## River and water

The river node has two related but independent outputs:

- a flow-aligned water surface shader with waves, foam, reflection, depth absorption and sediment tint;
- a current vector used by river particles and wet cargo.

The current should follow a spline or graph field and use the SDF normal for collision projection. A guided river is a good interactive authoring approximation, but it is not a pressure-projected free-surface solve. Production can add a shallow-water or SPH mode when a scene needs discharge conservation, waterfalls or branching flow. The shader must not be the only simulation: the same path/velocity data should be available to transport and gameplay export.

## Wind, chemical and rockfall modes

Wind births grains at an upwind boundary, gives them a height band and horizontal direction, and applies size-dependent settling and abrasion on dry contacts. Rockfall uses a mass/impact response and breaks detached coarse material into sand/fines over time. Chemical weathering is a reaction/saturation path that yields dissolved load rather than ordinary sand deposition. These modes share SDF collision and accounting but should not be implemented as renamed rain.

## GPU / engine requirements

For an AAA implementation:

- WebGL2 prototype: fragment passes, float render targets where available, instanced/point particle preview, no per-step CPU readback.
- Engine: compute or async GPU passes, sparse brick SDF, ping-pong distance/material fields, indirect particle dispatch, and tile-local reductions.
- Deterministic seeds and fixed simulation ticks for reproducible artist bakes.
- Material IDs, hardness, porosity, sediment fractions and strata channels separate from the distance field.
- LOD: coarse preview while navigating, high-resolution focused bricks while sculpting, offline bake for hero shots.
- Diagnostics: removed/carried/deposited mass, occupied voxels, active/settled particle counts, max contact request, GPU time, dropped/overflowed particles, and boundary flux.
- Save/load must include graph descriptors, seed, field bounds, baked volume, material layers, water routes and simulation tick; a screenshot or mesh export is not a resumable simulation checkpoint.
- Safety limits: maximum contact kernel, maximum volume delta per tick, deposition/erosion conservation checks, boundary conditions and stable timestep/substeps.

## UI / node editor requirements

The node graph is the source of truth for the modifier stack. A typical graph is:

```text
Primitive Union → CSG Terrain → Cave / Overhang Subtract → Particle Solver → Water Surface
                                             └──────── Wind Field ───────────────┘
                                                        └→ Sediment Ledger
```

Every node needs a compact status, editable parameters, input/output sockets and a clear preview state. The inspector should keep the outliner, graph and viewport visible together. Run/pause, emitter selection, exact numeric values, water visibility and transport should be separate controls. Pausing the particle solver must not freeze water shading or camera navigation.

## Research basis and limitations

The supplied [Frontier reference](https://github.com/eosclient0001-rgb/Frontier/tree/arena/01a07d57-frontier) uses a bounded WebGL2 SDF, independent particle agents, typed cargo, an analytic guided river, wind/rock/chemical profiles and a water shader. Its documentation is a useful engineering reference for this prototype. The particle/SDF design is also aligned with Hartley, Mellado, Fiorio and Faraj, [*Flexible terrain erosion*](https://www.lirmm.fr/~nfaraj/publications/flexible_erosion/2024_Flexible_Terrain_Erosion.pdf), The Visual Computer (2024), which describes independent particles and alteration/transport for height fields, voxels and implicit terrain. Classic GPU hydraulic erosion work uses water, outflow/velocity and sediment layers with capacity-driven erosion/deposition; the [interactive GPU model notes](https://huw-man.github.io/Interactive-Erosion-Simulator-on-GPU/) are a useful optional shallow-water backend, not a reason to collapse this editor to a heightmap.

This browser build is not a validated geological solver, CFD implementation, SPH solver or production-ready GPU volume backend. Its purpose is to establish the authoring language, topology-first workflow, visible particle states, and water/erosion controls before the same graph is connected to a sparse SDF simulation in the engine.
