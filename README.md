# Slate — SDF TerraForge

> **AAA Terrain Landscaping Lab for GTA 6+** — volumetric SDFs, particle-transported erosion, Gaea-style node graph. Not a heightmap toy.

Live editor: `https://5173-…e2b.app` (Vite dev) — `npm run dev` → `npm run build`

---

## Why this exists

Last session was a toy: single heightfield, one big particle, no settlement → infinite drill hole, no real caves. This is the flexible, node-based, SDF answer.

**Requirement research** (AAA open-world, Gaea reference, SDF vs heightmap, erosion literature):

- **Volumetric, not 2.5D.** Heightmaps can't do caves, overhangs, arches or cliffs with true undercut. We need an **SDF volume** (`80×40×80` here, `112×72×112` Frontier reference). Research: *“3D Real-Time Hydraulic Erosion using Multi-Layered Heightmaps”* (VMV 2024) and *Flexible Erosion* (2024) — particles work on voxels / SDFs / layered stacks via same `alter + transport` split.
- **Gaea is the benchmark.** `Erosion_2`, `Scree`, `Anastomosis`, `Debris`, `Crumble` are chained node ops. We mirror that: `Source → Boolean → Erosion` graph, topo-sorted.
- **Hydraulic = rain drops** flowing downhill, eroding on slope·velocity·(1-hardness), carrying capacity-limited sediment, depositing when slow/flat/overloaded. Thermal = talus/angle-of-repose collapse. Wind = windward abrasion + leeward deposition with shadowing. River = valley-following fluvial carve + sediment fan. All must **settle** — particles die/respawn when loaded or slow, or they just drill.
- **Water must follow current.** Frontier's water shader traces SDF banks and warps Gerstner waves by `river tangent`. We do the same: a ribbon mesh extruded along the river path, vertex-warped by flow-aligned waves, fragment-foamed at banks.
- **GTA 6+ fidelity**: thin strata banding, perlin/terrace, smooth blends (`k`), true interior caves (sphere-subtract, torus-arch), volumetric raycast / marching tetra mesh (watertight), soft shadows, ACES tonemap.

UI reference: `https://sultanaladin.github.io/Frontier-/solidarc/` (outliner/viewport/inspector) + `…/celestial/` (OLED `#050505` + cyan). We mirror that: OLED `#07080A`, panel `#13171A`, accent `#00E5CC`, mono labels.

---

## What you get

| Area | Detail |
|------|--------|
| **Volume** | `80×40×80` Float32 SDF, `MIN [-18,-3,-18]` → `MAX [18,20,18]`. Trilinear sampling, gradient normals. Memory ~1 MB. Marching **tetrahedra** (6 tets/cube, watertight caves) → ~130k–200k tris rebuilt throttled. |
| **Node graph** | Sources: Box, Sphere, Torus, Cylinder, Terrain Base (stratified slab), Fractal Noise. Booleans: Union, Subtract (real cave), Intersect, Smooth Blend (`k`), Transform, Terrace. Erosion: Hydraulic, Thermal, Wind, River. Output → mesh. Drag to move, dot-drag to wire (click wire to delete), Topo sort for execution order. |
| **Particles** | 200–2048 raindrops, radius `grainSize 0.05–0.45 mm` → 2–5 px on screen (not big blobs). Velocity, sediment, water, life. Gravity + slope + wind + river current. Erode `k_detach·v·(1-H)·(1-load/cap)·footprint`, deposit when `load>0.85‖ v<1 & flat ‖ slope<0.15`. On settle → deposit & respawn at top (no infinite hole). Color: clear blue → sandy → rock. |
| **Wind** | Uniform field `speed/dir`, per-voxel exposure = `dot(normal, windDir)` + occlusion march upwind (shadow). Abrades windward, deposits leeside wake. Separate CPU pass every 18 ticks (280 probes). |
| **Thermal** | Sparse pass every 12 ticks: where `|SDF|<1` and over-steep vs talus angle, move mass `high→low` (92% conserved, 8% fines). |
| **River + Water** | Valley traced by steepest-descent from north high, snapped to surface, smoothed. Ribbon mesh `±width/2` along tangent. Shader: 3 flow-aligned Gerstner modes `(amp·sin(dot(q,dir)·freq - ωt))`, warp noise, bank foam `smoothstep(field, reach)·bankMask`, Fresnel + sun specular, flow streaks `fract(v)`. Waves **move with** `riverSpeed` along `V`. |
| **UI** | SolidArc 3-panel: left Library/Outliner, center Viewport (OrbitControls, grid, sun shadow 2k, fog, ACES) + bottom Node Graph (SVG bezier wires), right Inspector (per-node sliders, pipeline order, global toggles). Header: brand, live dot, VOL/MEM/FPS, Reset/Randomize/Export/Run. View pills, sim bar, settlement/X-Ray toggles. Font: Instrument Sans + IBM Plex Mono. |
| **Export** | `SLAT` binary: `uint32 0x534C4154` + json len + json + raw Float32 SDF → Houdini/Unreal. |

---

## Node recipes for real caves / cliffs

- **Cave**: `Terrain Base` → `Subtract` ← `Sphere (r 3.1 at -5,2,-7)` → `Hydraulic` … = volumetric undercut, not displaced height.
- **Arch**: `Box (6×4×6)` minus `Torus (R 3.5,r 0.65)` → `Smooth Blend k 1.1` with `Terrain Base` → natural arch.
- **Cliff**: `Box` `Union`ed onto slab + `Fractal Noise 0.8` → hydraulic cuts rills down the face.
- **GTA canyon**: `Terrain (38×32)` minus stretched `Box (3.2×10×16)` trench → river carves deeper.

All are **live** — change a slider, volume rebuilds (~1.2 s), then erosion ticks mutate it.

---

## Erosion model vs Frontier

Frontier `arena/01a07d57-frontier` used WebGL2 GPGPU atlas (`1792×504`, MRT, float-blend), `motion/event/apply/cargo/distance` passes, `band 0.32`, `VOXEL_VOLUME`. Ours is CPU-particle + voxel `sculptAt` for portability, but **same invariants**: partial-volume solid fraction `solid = clamp(0.5 - d/(2·BAND))`, exchange weights `band·k·solid`, capacity-limited transport, settlement. Research `docs/erosion-model.md` in Frontier describes deviations; we follow that.

Fixes vs toy:
- `grainSize` → `PointsMaterial size 0.13–0.34` (was large quads)
- `capacity` + `loadRatio` → `erodeAmt·(1-load)` (was unconditional carve)
- `shouldDeposit` on flat/slow/overload + final `respawn` → particles **settle** instead of drilling forever
- Thermal + wind as separate passes (was only rain)

---

## Run

```bash
npm install
npm run dev   # http://localhost:5173  (allowedHosts: true for e2b preview)
npm run build # dist/
```

Controls: drag nodes, dot-drag wires, select node → Inspector, **Space** run/pause, **R** rebuild, **P** particles, **W** water, **G** toggle Library/Scene, scroll dolly, drag orbit, wire/X-Ray toggles.

---

## Tech

- `three@0.160` + `OrbitControls`, `vite@5`, no WebGPU → `WebGLRenderer` + `Points` + `ShaderMaterial` water. Marching tetrahedra JS (no `triTable` holes), `valueNoise→fractalNoise` CPU.
- Gaea inspiration: <https://quadspinner.com/Gaea/Simulations> — Erosion_2, Debris physics.
- Erosion papers: *Arenite (SIGGRAPH 2025)*, *Flexible Terrain Erosion (2024)* — particle `alter+transport` unified.

---

## Roadmap → GTA 6+ production

GPU compute (WebGPU) for `1024×72×112` volumes, layered materials (bedrock/sand/loam), debris instancing, spline brush rivers (Frontier `splines.js` flow-path), fracture cell Voronoi, Houdini Engine export, tiled streaming.

*Built for `unassignedinbox/Slate` branch `arena/01a08de9-slate`.*
