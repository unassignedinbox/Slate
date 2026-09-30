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

Other runtime measures in the demo: shared materials per shatter, convex colliders straight from the
solver, aggressive sleeping, a rigid-body cap with the smallest sleeping fragments retired to debris,
GPU point comminution dust, and cheap fake-refraction shards instead of hundreds of transmissive meshes.

### 7. Secondary fracture
Fragments carry their own `Piece`, so a shard that lands hard enough (or gets shot again) re-enters the
same solver with its remaining kinetic energy and breaks again — the toughness check makes it stop on its
own after a generation or two.

## Layout
```
src/core/convex.ts       convex polyhedron, exact plane clipping, crack-surface meshing
src/core/math.ts         PRNG, value noise / fbm
src/fracture/materials.ts  Gc, density, anisotropy, residual stress, surface params
src/fracture/fracture.ts   stress field, crack-normal selection, Griffith energy solver
src/scene/targets.ts     pane / plank / wall / boulder / crate setups + rebar layout
src/scene/audio.ts       procedural modal impact audio
src/main.ts              three.js scene, cannon-es physics, projectiles, dust, UI
```

## Porting to a real engine
Nothing here is web-specific: the solver is pure arithmetic on planes and polygons (~400 lines) and maps
directly to C++/DOTS. In UE/Unity you would keep `fracture()` as a build-time tool for baked patterns and
as a runtime call for hero moments, feed the convex cells to Chaos/PhysX as convex colliders, and move the
crack-surface displacement into a material/nanite-displacement pass.
