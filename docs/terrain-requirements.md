# Terrain Foundry — AAA landscape tool requirements

This note is the design contract behind the browser prototype. It intentionally separates the **artist-facing real-time preview** from a production terrain runtime that can move the same passes to WebGPU, C++/HLSL, or an engine plugin.

## Product requirements

- **Volumetric first:** use a signed-distance / sparse voxel representation for formations that a height field cannot express: caves, tunnels, arches, undercuts and cliff overhangs. Keep the world hybrid: large open regions can remain heightmap/clipmap terrain; SDF chunks are activated around volumetric edits and hero formations.
- **Node graph authoring:** primitives, boolean SDF operations, material layers, erosion passes, river flow and surface extraction must be individually addressable, reorderable and deterministic by seed. Each node should expose its inputs, output type, resolution and estimated cost.
- **One-way material accounting:** agents can detach available solid, carry a payload and deposit it where capacity falls or water settles. An agent must not push/pull the field along its normal. Detached, carried and deposited amounts should be auditable per material class.
- **Interactive particles:** use small independent agents for rain/runoff/river/wind preview. The production version should use GPU compute or fragment/compute passes, SDF collision projection, velocity limits, explicit evaporation and a bounded local brush. Particle-particle impulses are out of scope for erosion preview; they create unstable terrain without a fluid solve.
- **Hydraulic flow:** water must follow the surface gradient/current, carry sediment and deposit on lower velocity or after evaporation. River water and its visible shader must use the same centerline/current field, so the streaks do not slide independently of the channel.
- **Wind:** dry particles enter from the upwind boundary, relax toward the selected wind field, sort by grain size and abrade exposed surfaces; wind must not accidentally paint hydraulic wetness.
- **Realtime readability:** show the actual agents, surface changes, water flow and sediment ledger while running. Use a fast preview resolution while authoring and a higher resolution/LOD build for export.
- **AAA handoff:** target deterministic seeds, tiled/chunked storage, async generation, LOD transitions, surface extraction, PBR material masks, flow/erosion maps and export hooks for glTF/engine terrain formats.

## Preview implementation in this repo

`index.html` is dependency-free and runs with WebGL2. The viewport raymarches a signed field with subtractive cave capsules and overhang shelves. Hydraulic and wind particles are simulated in JavaScript for portability, but their signed material delta is uploaded as an `R32F` texture and sampled by the terrain shader every frame. Positive delta is detached material; negative delta is deposition. This makes the interaction visible without recreating the previous failure mode where particles inflated or pushed the surface.

The node graph presents the intended production pass boundaries:

```text
Base formations → Hydraulic erosion → River flow → SDF output
                              ↘ Sediment ledger
Wind erosion ──────────────────↗
```

## Research basis

- **Volumetric SDF + marching cubes:** signed distance fields are a good fit for boolean caves/overhangs; surface extraction can be marching cubes, surface nets or dual contouring. For a production browser path, WebGPU compute is the natural place for spatial partitioning and surface extraction; use a WebGL2 fallback with cached meshes or a lower preview volume.
- **Hydraulic erosion:** the useful minimum model is water input, downhill/current transport, terrain detachment, sediment capacity, deposition and evaporation. A particle approach is detailed and controllable but more expensive; independent agents are parallelizable.
- **Large-world performance:** use hybrid heightmap + sparse SDF chunks, asynchronous generation and LOD. The preview should never claim that a browser canvas is a complete GTA-scale runtime; it is an authoring surface and a contract for the native implementation.

## Sources consulted

1. [Landscape Generation with Dynamic LOD and Streaming for Browser Open Worlds](https://app.cinevva.com/guides/landscape-generation-browser) — hybrid heightmap/SDF terrain, sparse volumetric chunks, WebGPU surface extraction, streaming and frame-budget considerations.
2. [GPU-Parallel WebGPU Marching Cubes](https://www.willusher.io/graphics/2024/04/22/webgpu-marching-cubes/) — active-cell, prefix-scan and vertex extraction stages for GPU isosurface generation.
3. [Hydraulic Erosion in Game Development](https://courses.tolstenko.net/artificialintelligence/01-pcg/HydraulicErosion/) — particle lifecycle: downhill movement, capacity, erosion, transport, deposition and evaporation.
4. [Flexible Terrain Erosion, Hartley et al.](https://www.lirmm.fr/~nfaraj/publications/flexible_erosion/2024_Flexible_Terrain_Erosion.pdf) — separates alteration, transport and deposition and discusses SDF/voxel terrain editing.
5. [Gaea hydraulic erosion node documentation](https://www.wysilab.com/OnLineDocumentation/Nodes/Simulation/Nodes_Simulation_HydraulicErosion.html) — artist-facing controls such as rain amount, viscosity, erosive power, impact, evaporation and deposition masks.
6. [Frontier reference branch](https://github.com/eosclient0001-rgb/Frontier/tree/arena/01a07d57-frontier) — UI language and a prior WebGL2 terrain studio reference; the prototype here keeps its professional dark outliner/inspector direction while simplifying the renderer for a clean dependency-free demo.

## Production acceptance criteria

- No detached material is silently destroyed; every accepted detach ends in a payload, deposit or explicit out-of-bounds retirement.
- A 1–2 pixel particle should carve a local signed-volume change, not create a tunnel wider than its brush radius.
- Caves and overhangs survive surface extraction and LOD transitions.
- A river's current vector, water shader direction and sediment advection share one flow field.
- A deterministic seed + graph JSON reproduces the preview and export inputs.
- GPU work is asynchronous and profiled by node; UI remains responsive while higher-resolution tiles build.
- Export includes the final surface plus erosion, flow, wetness, sediment and material masks—not only a flattened mesh.
