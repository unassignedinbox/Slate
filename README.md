# Slate — realtime, physically-motivated fracture for games

A WebGL/TypeScript testbed for **AAA-grade destruction of glass, wood, concrete, plastic and rock**
that does *not* use Voronoi / cell fracture.

```bash
npm install
npm run dev     # http://localhost:5173
```

Click the object to hit it exactly there. Space = shoot at the crosshair, R = reset.

---

## Why not Voronoi

Voronoi (Blender cell-fracture, Houdini RBD Material Fracture defaults, most Unity/UE plugins) scatters
seed points and takes the dual. It gives:

* isotropic, equiaxed, "potato" cells — the same look for a windshield, an oak beam and a boulder;
* no dependency on *where* or *how hard* you hit, only on where you scattered the points;
* no crack arrest, so the whole object always disintegrates;
* no anisotropy: wood grain, rock bedding and tempered-glass residual stress cannot be expressed.

Real fragmentation is a **crack propagation** problem, so that is what this solves.

## The model

### 1. Contact → stress field
Each impact is described by a point, a direction, a contact radius and an energy.
From that we evaluate an analytic near-field impact solution: axial compression under the contact,
**hoop tension** around it, **radial tension** further out, plus bending for plates.

### 2. Cracks open normal to the maximum principal tensile stress
* Near the hit, hoop tension dominates → planes containing the radius → **radial / star cracks**.
* Further out, radial tension dominates → planes normal to the radius → **concentric ring cracks**
  (the Wallner rings you see in real glass).
* A **Hertzian cone crack** is nucleated first for glass, rock and concrete: a ~60–70° cone under the
  contact that punches out as a plug/spall before anything else moves. (`coneCrack()`)

### 3. Griffith energy budget → cracks arrest by themselves
Every square metre of new crack surface costs `2·Gc` joules (Gc = critical strain-energy release rate:
glass 7, granite 95, concrete 140, pine-along-grain 320, ABS ~460 J/m²).
The solver keeps an energy-greedy front: it always advances the crack inside the most loaded fragment,
subtracts the surface cost, and splits the remaining energy between the children weighted by mass and
by `exp(-distance / λ)` from the impact.

When a fragment can no longer pay for a new surface the crack **arrests**. That single rule produces,
for free, the thing Voronoi cannot: *comminuted dust at the impact point and large intact slabs at
the edges*, with a Weibull-ish fragment size distribution, and a fragment count that scales with
impact energy and inversely with toughness.

### 4. Material character = anisotropy + toughness + stored energy
| Material | What makes it look right |
|---|---|
| **Annealed glass** | Hertzian cone → radial star → concentric Wallner rings; sub-critical hits only *craze* the pane (canvas crack decal) and it keeps standing until you hit it again; shards are thin, sharp, mirror-smooth with conchoidal ripple noise |
| **Tempered glass** | 46 kJ/m³ of frozen-in residual tension is added to the energy budget, and the stress state is isotropic → self-sustaining **dicing** into thousands of near-cubic pieces, almost independent of impact energy |
| **Pine plank** | `Gc` is ~11× higher for planes that cut fibres than for planes containing the grain → long splinters and hinge failures along X, cross-grain rupture only where bending peaks; fibre pull-out noise stretched along the grain |
| **Reinforced concrete** | crushing cone + radial shear cracks + aggregate-scale surface noise; surviving fragments stay tied by rebar constraints that yield, then snap |
| **Granite** | bedding planes are 55 % weaker → the block prefers to split along them; conchoidal spall cone under the hit; crystalline high-contrast fracture surfaces |
| **ABS plastic** | very high `Gc`: it cannot buy many surfaces, so it necks and tears into a few big curved flaps that stay hinged together |

### 5. Geometry: exact half-space clipping, not boolean meshes
`src/core/convex.ts` represents a body as a convex polyhedron and applies each crack as a plane clip.
Consequences:

* fragments are **watertight and gap-free by construction** (measured volume error: `0.000 %`);
* they are convex, so each one becomes a `ConvexPolyhedron` collider directly — no hull fitting;
* interior (crack) faces are tagged, so they get their own material, UVs and displacement.

**Curved crack surfaces without breaking the fit:** crack faces are subdivided and displaced along the
*shared* crack normal by a noise field sampled in object space, with the displacement tapered to zero at
the face rim. Both sides of a crack sample the same field, so the relief is complementary and the pieces
still mate — you get conchoidal / fibrous / aggregate micro-relief instead of flat Voronoi facets.

### 6. Runtime cost
Measured in-sandbox (single thread, no worker), 180–220 fragments:

| material | solve |
|---|---|
| glass pane | 17–22 ms |
| tempered dicing | 10–18 ms |
| concrete wall | 13–14 ms |
| granite | 3–8 ms |
| wood / plastic | 0.4–1.5 ms |

For shipping, that is still too much for a 16 ms frame at scale, so the demo also implements the
production path: **pre-baking**. Toggle *pre-bake pattern* and the solver runs a small library of impact
patterns at load time; the hit then costs **0 ms** — it only instantiates. The recommended shipping mix is
bake a handful of patterns per asset (varying impact site + energy tier), pick the nearest at runtime, and
run the live solver only for hero/scripted destruction or on a worker thread.

### 6b. Physics: Jolt
Rigid bodies run on **Jolt Physics** (the WASM build of `jrouwe/JoltPhysics` — the engine behind
Horizon Forbidden West and Godot 4), wrapped in `src/physics/jolt.ts`:

* every fragment the solver emits is already convex, so it becomes a `ConvexHullShape` directly —
  no convex decomposition, no hull fitting, ~0.15 ms per shard to build;
* the projectile uses `EMotionQuality_LinearCast` (real CCD), so a 220 m/s bullet cannot tunnel
  through a 14 mm pane;
* `mEnhancedInternalEdgeRemoval` keeps thin shards from catching on each other's seams;
* **rebar / hinge links are real breakable constraints**: a `DistanceConstraint` per bar whose
  accumulated Lagrange multiplier is read every frame and cut when it exceeds the bar's yield load
  (9 kN concrete, 1.6 kN plastic, 0.9 kN wood) — so a slab hangs, sags, then drops;
* body IDs are copied into JS-owned `BodyID`s and every embind object we allocate is destroyed
  (no WASM leaks across resets);
* if the page is cross-origin isolated (COOP/COEP are set in `vite.config.ts`) it loads the
  **multithreaded** Jolt build automatically and uses `hardwareConcurrency - 1` worker threads;
  otherwise it falls back to the single-thread build silently. The HUD shows which one is live.

Measured in this sandbox (single-threaded WASM, Node): 180 convex glass shards + 29 breakable links,
**2.0 ms average per 1/60 s step**, all bodies asleep once the pile settles, zero escaped/NaN bodies,
clean teardown.

Other runtime measures in the demo: shared materials per shatter, convex colliders straight from the
solver, aggressive sleeping, a rigid-body cap with the smallest sleeping fragments retired to debris,
GPU point comminution dust, and cheap fake-refraction shards instead of hundreds of transmissive meshes.

### 7. Secondary fracture
Fragments carry their own `Piece`, so a shard that lands hard enough (or gets shot again) re-enters the
same solver with its remaining kinetic energy and breaks again — the toughness check makes it stop on its
own after a generation or two.

---

## Project Zero · WebGPU Terrain  (`terrain.html`)

A second, standalone demo: a **WebGPU** terrain generator in the shape of a real editor — layer stacks,
not a node graph. Everything runs on the GPU; nothing round-trips to the CPU except exports.

### Pipeline
1. **Terrain layer stack → one compute dispatch.** Ten operators (fBm, ridged, billow, domain-warped,
   cellular, terrace, curve, radial, tilt, detail) × six blend modes, each with an *altitude mask* so a
   layer only applies to a band of the result below it. Octaves are rotated per level and the fade is
   quintic, so there is no axis-aligned lattice corduroy.
2. **Rock hardness field.** Tilted strata + regional variation. Erosion divides by hardness, so hard
   bands survive as benches and cliff lips while soft bands undercut — the single biggest realism
   difference against "noise + a smoothing filter".
3. **Hydraulic erosion — virtual-pipe shallow water (Mei et al.).** Per iteration: outflow flux through
   four pipes → water depth + velocity field → sediment capacity `C = Kc·sin(tilt)·|v|·depthFade` →
   scour or deposit → **semi-Lagrangian sediment advection** → evaporation. That is a real drainage
   solve: dendritic channel networks, meanders, alluvial fans and deltas emerge, they are not painted on.
   Rainfall is spatially patchy (orographic), not uniform drizzle.
4. **Thermal erosion.** Talus-angle slumping with hardness-dependent angle of repose → scree cones
   under cliffs.
5. **Analysis bake.** Normals, **horizon-scan ambient occlusion** (N directions × stepped marches),
   curvature (concave vs convex), wetness, sediment and scour masks → two RGBA16F textures.
6. **Material layer stack.** Up to 10 layers composited by *rules*, multiplied together: altitude ×
   slope × concavity × flow/wetness × sediment × scoured-rock × openness × procedural breakup, each with
   its own falloff and blend sharpness, two-tone macro variation per layer, and wet-darkening +
   roughness drop where water runs.
7. **Shading.** Raymarched heightfield sun shadows with distance-widening penumbra, sky-dome ambient
   weighted by AO, ground bounce, GGX specular, aerial perspective, ACES tonemap, 4× MSAA.
   Water is rendered from the simulation's own water column: Beer–Lambert absorption by depth, Fresnel
   sky reflection, animated capillary ripples, whitewater where the sheet is thin.

### Editor
Project-Zero style dark shell: tool rail (shaded / height / slope / flow / AO / scour / sediment views,
water, wireframe, sun-drag, top-down), **layer stack docked right** with drag-reorder, visibility,
duplicate and reorder, **inspector docked right underneath** driven by a field schema, plus World,
Erosion, Lighting and Analysis groups. Four presets (Alpine Massif, Desert Mesas, Coastal Fjords,
Volcanic Badlands). Erosion runs live with an adaptive step budget and a progress bar.

### Export
**`.r16`** 16-bit raw heightmap (drops straight into Unreal landscape import, Gaea, World Machine),
8-bit PNG, and a viewport screenshot.

---

## Metal deformation (car crash test)

Switch **Scene → Car crash test**. The body is **one merged BufferGeometry** (hood + cabin + fenders,
a single draw call, ~14 k verts); the headlight lenses are separate brittle glass bodies.

### Bake: a real elasto-plastic sheet-metal solve
`src/deform/panel.ts` simulates an actual steel panel — not a sculpted blob:

* mass-grid shell with membrane, shear and **plastic bending hinge** constraints;
* two real yield mechanisms — membrane stretch past `εy = σy/E` permanently lengthens the sheet
  (the draw-in that feeds the crater), and curvature past `κy = 2σy/(E·t)` leaves a permanent hinge;
* the impactor is pressed in, **removed**, and the panel relaxed, so what we bake is the *settled*
  shape after elastic springback;
* the panel is welded at its seams, exactly like a real pressing.

Because the sheet can bend ~a million times more easily than it can stretch, the result is what a real
dent looks like, and none of it is authored:

| measured from the bake (0.8 mm mild steel, 41² grid) | |
|---|---|
| severity ladder (permanent set) | 6 / 15 / 24 / 33 / 41 / 50 mm |
| raised rim around the crater | 1.3 mm (blunt) – 2.4 mm (edge/crease) |
| in-plane material draw-in | 3–4 mm |
| far side of the body | 0.00 mm |

The solve is quasi-static position-based (an explicit integrator needs ~20 kHz for 3 MN/m springs
against 3 g nodes — my first attempt exploded into NaNs within one frame). It runs in a **web worker**
(`bake.worker.ts`) so the frame loop never hitches, and is cached per steel gauge. Two archetypes are
baked: `blunt` (bumper / another car's corner) and `edge` (pole, headlight corner — narrow crease).

### Runtime: VAT + lattice
`src/deform/dent.ts` packs the fields into one half-float **vertex animation texture** — G×G tile per
severity frame, stacked: **41 × 492 px, 158 KB for all 12 tiles**. RGB = the (u,v,w) displacement of
that node.

A dent at runtime is just a **lattice**: position, orthonormal frame (tangent/bitangent/normal),
extent, severity. The vertex shader transforms each vertex into every active lattice, samples the VAT
bilinearly *and* linearly between severity frames, fades with depth into the body, and accumulates
(up to 12 dents). That gives you:

* **zero CPU cost per frame** — a dent is 12 uniforms; nothing is re-uploaded, the mesh stays static
  and instanceable;
* **no cracks at seams** — displacement is a pure function of object-space position, so duplicated
  UV/material-seam vertices move identically;
* **accumulation is physical** — hitting the same panel again raises that lattice's severity, which
  walks up the baked plastic *history* (each frame was pressed into the same panel), it is not a
  scaled copy of one dent;
* **normals are re-derived in-shader** by finite-differencing the same field, so the crumple lights
  correctly, and the shadow pass gets the same patch via `customDepthMaterial`;
* a CPU query (`displacementAt`) is available when gameplay/physics needs the deformed surface.

### Steel + glass in the same impact
Shooting a headlight instantiates a **pre-baked** shatter pattern (3 variants baked at load) — the
runtime solve cost is **0 ms** — and dents the surrounding sheet metal. That is exactly the
"cars bump, headlights break" case: bake the fracture for each breakable part offline, keep the live
solver for hero destruction.

*"Ram it"* fires a 20 kg / 9 m/s block (≈ a slow parking-lot bump) instead of a bullet.

### What the little grains are
They are comminution dust: GPU points spawned proportional to `impact energy × material.dustPerJoule`,
plus the stand-in for fragments below the rigid-body budget (sub-millimetre pieces that are not worth a
collider). Purely visual + a budget device — they carry no physics.

## Layout
```
src/core/convex.ts       convex polyhedron, exact plane clipping, crack-surface meshing
src/core/math.ts         PRNG, value noise / fbm
src/fracture/materials.ts  Gc, density, anisotropy, residual stress, surface params
src/fracture/fracture.ts   stress field, crack-normal selection, Griffith energy solver
src/scene/targets.ts     pane / plank / wall / boulder / crate setups + rebar layout
src/scene/audio.ts       procedural modal impact audio
src/terrain/shaders/*    WGSL: noise, generation, erosion, analysis, terrain/water/sky shading
src/terrain/engine.ts    WebGPU device, buffers, compute + render pipelines
src/terrain/layers.ts    layer-stack data model, encoding, presets, inspector schema
src/terrain/ui.ts        editor shell: stacks, drag-reorder, schema-driven inspector
src/terrain/main.ts      camera, frame loop, exports
src/deform/panel.ts      offline elasto-plastic sheet-metal solver (the bake)
src/deform/bake.worker.ts  runs the bake off the main thread
src/deform/dent.ts       VAT packing, shader patch, runtime dent lattices
src/scene/car.ts         single-geometry car body, lenses with pre-baked fracture
src/physics/jolt.ts      Jolt Physics (WASM) backend: convex hulls, breakable links, CCD
src/main.ts              three.js scene, projectiles, dust, UI
```

## Porting to a real engine
Nothing here is web-specific: the solver is pure arithmetic on planes and polygons (~400 lines) and maps
directly to C++/DOTS. The physics side is already native Jolt, so a C++ port is a straight
1:1 translation of `src/physics/jolt.ts` against the real Jolt API — same `ConvexHullShapeSettings`,
same `DistanceConstraint` yield test, same `LinearCast` bullets. Keep `fracture()` as a build-time tool
for baked patterns plus a runtime call for hero moments, and move the crack-surface displacement into a
material/displacement pass.
