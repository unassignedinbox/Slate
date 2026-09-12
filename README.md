# SLATE — SDF Terrain Atelier · GTX Erosion Lab

A professional, AAA-grade (GTA 6+ class) HTML terrain landscaping tool — Gaea / World Machine style but **true SDF** (not heightmap) for real caves, overhangs, arches and cliffs, with **visible particle erosion in real time**.

Live preview: `python3 -m http.server 5173 --bind 0.0.0.0` → open `index.html` (Three.js, no build step).

## Why SDF, not heightmap
- Heightmaps cannot represent vertical overhangs/caves (single Z per XY).  
- SDF `f(p)<0` = solid rock, `f(p)>0` = air, zero-set = surface — fully 3-D.  
- Volume 96×64×96 → 192×112×192 (≈28 MB) at 0.28–0.39 m voxels, BAND 0.32, marching cubes — World Machine Dragontail Peak “VDM” & Houdini SDF approach.

## Node graph (non-destructive, Gaea-inspired)
**Primitives** — Slab, Sphere, Box, Cylinder, Torus (bounded SDFs)  
**Operators** — Union / Subtract / Intersect, Smooth Blend, Domain Warp (fbm), Terrace, Strata  
**Erosion modifiers** — Hydraulic, Thermal, Wind, River (applied as particle modifiers after primitives so you see the carve)  
**Output** — Terrain Output (marching cubes mesh, cast/receive shadow)

Drag `OUT → IN`, double-click to inspect, right-click to delete.

## Erosion — fixed vs “previous toy”
Prev session: particles huge, pushing/pulling terrain (bulges), never settling → infinite hole.

**This build (GTX) fixes:**
1. **Size decoupling** — `footprint` 0.45–1.15 m (UI) controls kernel; sim radius clamped 0.075–0.18 m. Visual `PointSize` is exaggerated for visibility only.
2. **No push/pull** — only bounded `acceptedE = min(E, a·V)` / `acceptedD = min(D, (1-a)·V + acceptedE)` (Frontier `BAND 0.32` + `solidFraction` clamp). Erosion only **increases** SDF, deposition only **decreases** it, gated by `1-smoothstep(|d|/0.64)`.
3. **Settling** — lifetimes 20 s (rain/runoff/chemical) / 30 s (river) / 45 s (rockfall), water `exp(-dt·0.035)` evaporation, capacity `capacityNow = cap·(1+flow·0.6)-carried`, low-velocity/flat deposition (`up>0.45 && speed<2.2`), coarse→sand attrition, explicit retirement ledger. Audit shows `eroded = carried + deposited + retired` (voxel-occupancy, Frontier-style).
4. **Wind** — upwind boundary spawn, aerodynamic relax `mix(v, air, 1-exp(-h·2.5))`, size-dependent settling `clamp(d²·0.12,0.015,1.5)`, impact abrasion only.
5. **River** — analytic guide `center(z)=meander·(2.5·sin0.15z+sin0.36z+1)+offset`, tangent `normalize(deriv,0,1)`, lateral `clamp(center-x)*0.65`, `speed` + `width` + `meander` + `depth`. Current drags *all* wet carriers (coarse less). Water shader advects UV along tangent with foam.

## Water shader follows the river
`PlaneGeometry` + custom `ShaderMaterial`: `vRiverMask = 1-smoothstep(width, width+1.6, |x-center|)·(1-smoothstep(waterLevel+0.3…))`. Vertex wave by mask, fragment advects noise `uv+adv` along `-Z`, depth `deep/shallow` + foam `n1·n2`, edge fade. Toggle in inspector; level drives particle wetness.

## Controls
- **Run / Step / Space** — fixed `dt 0.04 s` (Hartley 2024), 1–2 substeps/frame, mesh throttle ~6 Hz.
- **Resolution** low/mid/high/ultra → rebuild chunked (`setTimeout` 22 k voxels/chunk) to keep UI live.
- **Source mode** rain/runoff/river/wind/rockfall/chemical — existing loaded particles retain cargo; clean slots respawn.
- **Audit** — carried (sand/fines/coarse/dissolved), detached/deposited/retired, ledger error.

## Research
- Hartley et al. “Flexible Terrain Erosion”, *The Visual Computer* 40, 2024 — particles absorb/deposit on SDF/voxel contact, independent, vector-field adjustable. Adapted (not reproduced) for GTX web.
- World Machine Dragontail Peak 3D VDM, Houdini SDF, Gaea node UX, SolidArc/Celestial dark UI reference (DM Sans · Instrument Serif · IBM Plex Mono, OLED #08080a, 1 px lines).

## Tech
Three.js 0.160, `OrbitControls`, `MeshStandardMaterial` with strata SDF shading, `Points` particles (additive, cargo-colored, `size` exaggerated), `Plane` water shader, `WebGLRenderer` ACES.

Save `.slate` (header + volume + deposits) via `Export` in header. Import not yet wired — drag `.slate` to inspect JSON.

> Previous `Frontier` repo `arena/01a07d57-frontier` was reference for rain runoff particle quirks; now mass-conserved (occupancy) and professionally styled for AAA.

