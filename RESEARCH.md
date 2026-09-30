# Realtime fracture for games — research notes and design rationale

Target: glass, wood, buildings, plastics and rock, breaking believably, at frame
rate, in a AAA context. Explicit constraint from the brief: **do not use the
usual cell-fracture / Voronoi shatter**.

This document is the research pass. The implementation that follows from it
lives in `src/` and runs in the browser (WebGL2 + TypeScript).

---

## 1. Why Voronoi / cell fracture is the wrong tool

Voronoi pre-fracture (Blender's Cell Fracture, Houdini's `voronoifracture`,
Unity shatter assets) scatters seed points inside a mesh and assigns every
point of the volume to its nearest seed. It is fast, robust and completely
disconnected from any physics. The consequences are visible in every frame:

| Artefact | Cause |
|---|---|
| Every fragment is **convex** | A Voronoi cell is an intersection of half-spaces, by construction. Real fragments are routinely non-convex: spall flakes, splinters, L-shaped wall chunks. |
| Cracks **cross** instead of terminating | Real crack tips arrest when they reach the unloaded wake of an existing crack, producing **T-junctions**. Voronoi cell boundaries meet at Y-vertices of three cells. This one detail is the strongest visual tell. |
| Fragment size is **uniform and isotropic** | Real fragmentation is graded: pulverised at the contact, coarse at distance (Grady–Kipp / Rosin–Rammler statistics). |
| Structural weaknesses are **ignored** | A femur breaks mid-shaft; a plank splits along the grain; a brick wall fails at the mortar. Seed points know none of this. The "Breaking Good" paper makes exactly this criticism and demonstrates the failure cases ([Sellán et al., SIGGRAPH 2022](https://dl.acm.org/doi/full/10.1145/3549540)). |
| Impact **direction and energy don't matter** | The same pattern appears whether you tapped it or shot it. |

Pre-fracture with artist patterns (Rainbow Six Siege style) fixes plausibility
by hand but costs authoring time and repeats visibly.

So: keep the *runtime budget* discipline of pre-fracture, throw away the
*geometry generator*, and replace it with something driven by stress.

## 2. What shipping games actually do

| Game / tech | Approach | Notes |
|---|---|---|
| Red Faction: Guerrilla (GeoMod 2) | Pre-chunked buildings + **realtime stress propagation** through a connectivity graph | Load is pushed through the structure; overloaded joints snap; disconnected islands go dynamic. Progressive collapse is the headline feature. |
| The Finals, Teardown | Same family: voxel/chunk graph + structural analysis | [GMTK's survey](https://gmtk.substack.com/p/how-games-do-destruction) notes The Finals' system is "basically identical to Red Faction". |
| Star Wars: The Force Unleashed (DMM) | **Corotational tetrahedral FEM**, deform-then-fracture | Parker & O'Brien. Beautiful for wood/metal bending before failure; expensive. |
| Rainbow Six Siege | Authored **cut patterns** boolean'd into walls at runtime | Cheap, art-directed, per-weapon patterns. |
| Red Faction 1 | Realtime **BSP booleans** (Naylor merge) | Arbitrary holes, but level design has to survive anything. |
| NVIDIA Blast / APEX | Pre-fracture (Voronoi/VACD) + bond graph + runtime damage | The industry default, and the thing this project deliberately avoids for geometry. |
| Bullet `FractureDemo` | Composite rigid body with breakable bonds + union-find islanding | Erwin Coumans' [overview of destruction techniques](https://www.gamedeveloper.com/programming/opinion-destruction) is still the best short survey. |
| Breaking Good (2022) | Precomputed **fracture modes** — a sparsified eigenproblem giving a shape's natural ways of breaking; impacts are projected onto the modal basis at runtime | Drop-in replacement for Voronoi prefracture at *zero* runtime cost. The key insight I borrow: do the expensive physics offline, keep a cheap runtime projection. |

Research-grade alternatives that are still too slow for a frame budget, but
which define what "correct" looks like: XFEM, cohesive-zone FEM, **peridynamics**
(handles branching naturally), phase-field fracture, boundary-element methods
with explicit Lagrangian crack fronts, and MPM for granular debris.

## 3. The physics I actually implement

### 3.1 Griffith energy balance — the master rule

A crack advances only if the elastic energy it releases pays for the surface it
creates:

```
G ≥ Gc          G = release rate [J/m²],  Gc = fracture energy [J/m²]
σ_c = √(E·Gc / π a)                       (critical stress for a flaw of size a)
```

Everything in this project is budgeted with this one equation. An impact
deposits energy `E`; a fraction becomes new surface; that fraction divided by
`Gc` is a hard budget of *square metres of crack*. It is why:

* glass (Gc ≈ 8 J/m²) shatters into dozens of pieces from a few joules,
* ABS plastic (Gc ≈ 5000 J/m²) barely cracks from the same energy — it buys
  600× less surface,
* tempered glass dices: thermal tempering stores ~2×10⁴ J/m³ of residual strain
  energy, hundreds of joules in a window pane, enough to pay for hundreds of
  metres of crack with no help from the impact at all.

### 3.2 Dynamic crack speed and micro-branching

* Limiting speed is the Rayleigh wave speed `c_R` (soda-lime glass ≈ 3100 m/s).
* Real cracks saturate around **0.5–0.6 c_R**; Doll measured ~1500 m/s in plate
  glass ([Sundaram & Tippur, JMPS 2018](https://www.eng.auburn.edu/~htippur/papers/Sundaram-Tippur-JMPS-2018.pdf)).
* Above **~0.4 c_R** a single tip can no longer radiate the incoming energy
  flux and undergoes the **micro-branching instability** — it sheds side
  branches ([Fineberg, Sharon et al.](https://www.osti.gov/pages/servlets/purl/1906135)).
* Branch half-angles are ~12–30°, and branching needs `G` well above `Gc`.

Implemented in `src/frac/crack2d.ts` as: speed from a Mott-style
`v = v_term (1 − Gc/G)`, branching as a *rate per metre* that switches on above
`0.4 c_R`.

### 3.3 Weibull flaw statistics

Brittle strength is set by the worst flaw in the stressed volume, so strength is
Weibull-distributed (glass m ≈ 5, rock m ≈ 9, tempered glass m ≈ 12) and bigger
pieces are weaker than small ones. This gives, for free: scatter between
repeated impacts, and the observed *size effect* where large blocks split first.

### 3.4 Glass, specifically

Forensic fractography is unusually well documented, which makes glass the
easiest material to get *right* and the most obviously wrong when it isn't
([SWGMAT glass fractures](https://www.asteetrace.org/static/images/pdf/02%20Glass%20Fractures.pdf)):

1. The pane bends. The **back face** goes into radial tension first, so
   **radial cracks** nucleate there and run outward. Their count scales roughly
   linearly with the energy dissipated in cracking.
2. The triangular **petals** between radials keep bending until they snap
   across — producing **concentric arcs that terminate on the radials**
   (never crossing them). Concentric cracks originate on the *impact* face.
3. A hard, blunt or high-velocity contact punches a **Hertzian cone**: a ring
   crack just outside the contact circle flaring into a cone through the
   thickness (~22° half angle in glass). Exit hole > entry hole.
4. Fracture surfaces show **mirror → mist → hackle** bands and **Wallner
   lines**; hackle scatters light, which is why broken glass edges glitter.
5. **Tempered glass** is a different animal: the impact only has to breach the
   compressive skin, after which the stored energy drives a self-sustaining
   branching front across the pane at ~1500 m/s and dices it into ~cm cubes.
   Annealed glass gives long "sword" shards; tempered gives dice.

### 3.5 Wood, rock, concrete

* **Wood** is orthotropic. Mode-I fracture energy along the grain (RL/TL) is
  ~250–550 J/m², while breaking *across* fibres costs roughly an order of
  magnitude more ([Frühmann et al.](https://www.researchgate.net/publication/248470254)).
  Make `Gc` a function of crack-plane orientation and long splinters fall out
  of the solver by themselves.
* **Rock/concrete**: contact comminution, a Hertzian/percussion cone, radial
  meridional splitting from hoop tension, and **back-face spall** where the
  compressive pulse reflects off the free surface as tension. Fragment sizes
  grade with distance from the impact.
* **Masonry** fails at the joints long before the units do: mortar tensile
  strength is ~0.3 MPa against ~2 MPa for brick, which is why the structural
  graph, not the block solver, decides how a wall comes down.

---

## 4. The design that came out of this

Three solvers, one shared energy budget, no Voronoi anywhere.

### A. Shell solver — live crack-tip propagation (`frac/crack2d.ts`)

For panes and panels. A population of crack **tips** is integrated through the
plate's stress field. Each tip has a position, direction, speed and energy
release rate. Per step it:

* reads the local stress (hoop stress for radial cracks, radial bending stress
  for concentric ones) from an analytic impact field,
* takes a Griffith decision: propagate, or arrest,
* steers toward the maximum-tension direction, wanders through a Weibull flaw
  field, and is **repelled by neighbouring cracks** (stress shielding) — which
  is what produces T-junctions rather than crossings,
* micro-branches above 0.4 c_R,
* rasterises itself into an occupancy grid.

Fragments are then extracted *incrementally* from that grid: flood fill →
connected components → directed-edge boundary walk → Douglas–Peucker → ear
clipping → extrusion through the thickness. A component becomes a rigid body
**only when it is completely surrounded by cracks**. Pieces still touching the
frame stay in the window, hanging, exactly like a real broken pane.

![crack patterns](docs/crack-patterns.png)

*Left: annealed float glass, 40 J — radial star, concentric arcs terminating on
radials, wedge shards reaching the frame. Middle: tempered glass, same impact —
the stored energy dices it into 500+ pieces. Right: 4 mm acrylic at 400 J —
50× the fracture energy, so a handful of wandering cracks and 12 pieces.
All three are the same solver with different material constants.*

### B. Solid solver — energy-cascaded crack surfaces (`frac/solid.ts`)

For rock, wood, concrete blocks, thick plastic. The body is a convex cell that
gets carved by crack **surfaces**, chosen one at a time:

1. Distribute the impact energy through the body (concentrated at the contact).
2. For the cell with the best drive/cost ratio, sample its weakest Weibull flaw,
   generate candidate crack planes (hoop-tension meridional, back-face spall,
   grain-aligned), and score each by
   `energy × resolved tension / (Gc(n) × area)`.
3. Split on the winner, charge the **actual** new surface area to the cell's
   energy, and hand what is left to the two children by volume.
4. Stop when nothing can pay.

Plus an explicit **Hertzian cone** cut for hard brittle contacts, approximated
by a fan of tangent planes so each piece stays convex for collision.

Because the cost term is orientation dependent, wood splinters along the grain
with no special-case code, and because the energy is graded from the contact,
fragment sizes grade too. Fragment count scales with energy the way it should:
granite gives 8 pieces at 120 J, 54 at 1.5 kJ, 150+ at 12 kJ.

![solid fracture](docs/solid-fracture.png)

*Granite boulder, spruce beam (long grain-parallel splinters), concrete block,
ABS panel (too tough to break at that energy). Bright faces are fresh fracture
surface. Volume is conserved to floating-point exactly.*

### C. Structural solver — bonded graph with load propagation (`sim/world.ts`)

For buildings. Blocks are nodes; mortar joints are bonds with a strength
proportional to contact area. Each tick: gravity load is pushed down the graph
top-down, joints over strength snap, union-find finds islands, and any island
without a path to the ground becomes a dynamic compound rigid body. Chunks that
land hard break into their constituent blocks. This is the Red Faction /
Finals model, and it is what makes a wall *collapse* rather than *explode*.

### D. How glass is rendered (the specific question in the brief)

Glass is the hard case because you have to show the crack *before* the pieces
leave, and because the fragments are thin, transparent and numerous.

1. **While it is cracking**, the pane is still one mesh. The crack network is
   drawn as thin bright ribbons generated from the tip polylines, and the pane
   fragment shader samples a **release mask** texture (one texel per grid cell)
   and `discard`s the cells that have already fallen out. So the hole grows in
   the intact pane with zero geometry churn.
2. **Released pieces** become extruded shards. Their side walls are tagged as
   *fresh fracture surface* in the vertex stream, and the shader gives those
   faces the mirror/mist/hackle treatment: near-opaque, strongly scattering,
   with a sharp specular glint. That band is most of why broken glass reads as
   broken glass rather than as chopped-up window.
3. Refraction is a cheap `refract()` of the sky env, reflection a Schlick
   fresnel with F0 = 0.043 (n = 1.52). Sorted back-to-front, depth-write off.
4. 500+ tempered shards would be 500 draw calls, so all glass debris is
   transformed on the CPU into one dynamic vertex buffer and drawn **in a
   single call**, with the per-fragment noise seed riding in the vertex stream.

---

## 5. Shipping this for real

What I would change moving from this demo to a production AAA pipeline:

* **Bake what you can.** Run the shell/solid solvers offline for a set of
  representative impacts per asset and store the fragment sets, exactly as
  "Breaking Good" stores fracture modes. At runtime, project the actual impact
  onto the nearest precomputed pattern and blend. Zero runtime solve, all of
  the plausibility. The solvers here are already deterministic given a seed, so
  the bake and the runtime agree.
* **Hybrid budget.** Solve live only for the object the player is looking at
  and within N metres; everything else uses the bake. Cap fragments per event
  and per frame; merge distant debris into a single "rubble" mesh after a few
  seconds.
* **Determinism for netcode.** Everything here is seeded integer PRNG + fixed
  timestep, so two machines produce identical fragments from identical inputs;
  send the impact, not the geometry.
* **GPU the hot loops.** The 2D tip integration and the grid rasterisation are
  embarrassingly parallel — natural WebGPU compute passes. The flood fill is a
  connected-components pass. Convex clipping is better left on the CPU/job
  system.
* **Collision proxies.** Use the convex cells directly for the physics engine
  (they are already convex), and a single compound for hanging groups.
* **Art control.** Paint a `Gc` multiplier and a "do not fracture here" mask
  onto assets — the same knob "Breaking Good" exposes as η. Rebar in concrete
  is just a high-`Gc` region plus a bond that survives the split.
* **Audio/VFX hookup.** The solvers already produce the right drive signals:
  total new surface area (→ crush/shatter layer), peak crack speed, fragment
  mass histogram (→ dust vs debris vs chunk sounds).

## 6. Known limitations

* The shell solver works on flat plates; curved glass needs the tip integration
  lifted onto a parameterised surface.
* Fragment shapes are extracted from a raster grid, so the smallest fragment is
  ~2 cells. Tempered dice are capped at ~5 cm for the realtime budget rather
  than the ~1 cm you would measure on a real windscreen.
* The solid solver's cells are convex; genuinely non-convex fragments come only
  from the shell solver and from compound islands.
* No plastic deformation before failure. Ductile materials are modelled with a
  large `Gc` and crack-tip blunting, not with a real elasto-plastic solve
  (that is where a corotational FEM à la DMM would earn its cost).
* Rigid-body contact is point-vs-plane plus bounding spheres — enough for
  debris, not a substitute for a real solver.

## 7. Sources

* Sellán, Luong, Fan, Jacobson — *Breaking Good: Fracture Modes for Realtime Destruction*, ACM TOG 2022 — https://dl.acm.org/doi/full/10.1145/3549540
* Coumans — *Opinion: Destruction* (survey of production techniques) — https://www.gamedeveloper.com/programming/opinion-destruction
* Brown — *How Games Do Destruction* — https://gmtk.substack.com/p/how-games-do-destruction
* *Real-time fracturing in video games*, Multimedia Tools & Applications 2022 — https://link.springer.com/article/10.1007/s11042-022-13049-x
* Sundaram & Tippur — *Dynamic fracture of soda-lime glass*, JMPS 2018 — https://www.eng.auburn.edu/~htippur/papers/Sundaram-Tippur-JMPS-2018.pdf
* *Instability in dynamic fracture* (micro-branching at ~0.4 c_R) — https://www.osti.gov/pages/servlets/purl/1906135
* SWGMAT — *Glass Fractures* (radial/concentric/Hertzian cone/hackle) — https://www.asteetrace.org/static/images/pdf/02%20Glass%20Fractures.pdf
* Bradt — *The Fractography and Crack Patterns of Broken Glass* — https://www.researchgate.net/publication/226276004
* Frühmann et al. — *Fracture characteristics of wood in mode I, RL vs TL* — https://www.researchgate.net/publication/248470254
* Stanzl-Tschegg et al. — *Fracture Properties of Wood and Wood Composites* — https://www.researchgate.net/publication/229812650
