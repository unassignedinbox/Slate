# SDF Sculpting & Terrain Generation — Research and Pipeline Design

Research conducted for **SolidScape** (`Experimental/SolidScape`). Goal: a real-time SDF
sculpting/terrain pipeline that is **fast**, supports **dynamic resolution**, and can hold
**intricate sub-millimetre detail** without the whole model collapsing into a fixed grid.

This document is in two halves:

- **Part I — Prior art.** What shipping SDF sculpting/terrain engines actually do, with numbers.
- **Part II — Proposed pipeline.** A concrete architecture for SolidScape, with data structures,
  GPU passes, memory budgets and a phased build order.

---

# Part I — Prior Art

## 1. The central tension

Every SDF authoring tool resolves the same fork:

| | **Analytic** (evaluate the CSG expression) | **Discretised** (sample into a voxel grid) |
|---|---|---|
| Resolution | Unbounded — it's a function | Fixed at bake time |
| Detail limit | Float precision | Voxel size |
| Render cost | Scales with **edit count** | Scales with **screen area** — O(1) in edit count |
| Edit cost | Free (append to list) | Must re-sample the touched region |
| Re-editable | Yes — every edit is still a live parameter | No — edits are baked into cells |
| Physics / collision | Expensive per query | Cheap lookup |

Neither side wins outright, and **no shipping tool picks one**. They all run a hybrid: the
analytic edit list is the *document*, the sparse voxel grid is the *cache*. This is the single
most important finding of this research and it dictates the whole design in Part II.

## 2. Media Molecule — *Dreams* (PS4)

The most aggressive analytic-first design ever shipped. ([SIGGRAPH 2015 notes][mm-siggraph],
[slides PDF][mm-pdf])

- Models are a **flat list, not a tree**, of CSG "edits" — right-leaning trees collapse to a list,
  making the problem embarrassingly parallel. **1 to 100,000 edits per model.**
- Operations deliberately restricted: add, subtract, colour, plus **soft blend** (soft-min/soft-max).
  Domain deformation and non-local effects like blur were **excluded** — "much to the chagrin of
  ZBrush-experienced artists" — precisely because they break locality and therefore break pruning.
- The "CS of doom" evaluator: **40+ chained compute shaders**, several exceeding **3000
  instructions**, producing a sparse SDF.
- Core algorithm is **hierarchical list refinement**: build the list of edits that could possibly
  overlap each voxel region, then iteratively split regions and shorten their lists. As cells get
  finer, lists get shorter. The final refinement pass works in **4×4×4 blocks to match GCN 64-thread
  wavefronts**.
- Surface extraction used a **dual grid** — inspect a 2×2×2 neighbourhood of SDF samples, emit a
  point only where there's a zero crossing.
- They shipped point-cloud splatting with LOD via **Russian roulette** (256 → 64 points per cluster,
  then drop an LOD), TAA-resolved stochastic transparency.

**Critically: they later went *back* to the brick engine.** Splatting left holes in models that they
couldn't solve. Cited in [this VoxelGameDev thread][mm-reddit] with reference to a post-release
developer video. This is a strong signal — *don't build your primary representation on splats.*

Alex Evans' own retrospective on what artists want, quoted [here][svo-octree]:
> *"turns out laying down thousands of dumb strokes is exactly what artists love doing in the flow
> state… took years to grok this"*

Design consequence: **optimise for tens of thousands of cheap strokes, not for a few clever ones.**

## 3. Second Order — *Claybook* (Sebastian Aaltonen)

The most useful set of hard numbers available. ([GDC 2018 slides][claybook-gdc])

| Parameter | Value |
|---|---|
| World SDF resolution | **1024 × 1024 × 512** |
| Format | **8-bit signed** |
| Total size | **586 MB** (5 mip levels) |
| Encoded distance range | **[−4, +4] voxels** |
| Effective precision | 256 values over 8 voxels → **1/32 voxel** |
| Brush volumes | **32³ – 128³** (32 kB – 2 MB), offline baked |
| Tile size | 8×8×8, sparse |
| Combination | smooth add/cut via **exponential min/max**, with a layering system |

Key properties:

- **"Runtime performance not dependent on brush count."** This is the payoff of discretising.
- Generation is a 4-stage sparse GPU pipeline: build brush grid → generate dispatch coords and mip
  masks → generate level 0 in 8×8×8 tiles → generate mips. Culling is `SDF > tile bounds + 4 voxels`,
  then a **1-voxel dilate** of the occupancy mask (3×3×3 in groupshared) so neighbours that
  *influence* a tile without *overlapping* it aren't missed.
- Mip generation: load a 4-voxel-wider L−1 neighbourhood, 2×2×2 average, the ±4 band becomes ±2.
- **Max step distance doubles per mip level** — this is what makes empty-space skipping work.
- Ran at **60 Hz on Xbox One** and shipped on **Nintendo Switch (0.25 TFLOP/s)**.

Aaltonen's [porting thread][claybook-thread] is a masterclass in where the time actually goes:
SDF generation shaders were the bottleneck, fixed by groupshared optimisation (+50% from higher
occupancy), base-2 exp instead of base-e in the smooth-min loop, early-out for fully-empty and
fully-interior tiles (2× and 30%).

His more recent position ([2026][seb-2026]) is worth heeding:

> *"Full SDF ray-tracing is faster and there's no resampling making the quality worse… Claybook
> rendered dynamic SDF shapes on top of the terrain as triangle meshes and that was iffy too (using
> a quick GPGPU surface net algo). I wouldn't do that again."*

And on physics:
> *"SDF is a faster and a more stable physics representation than triangles (SDF solves tunneling
> elegantly with negative inner distances, triangles are just a thin shell)."*

Design consequence: **raymarch the bricks directly; treat meshing as an export path, not the
render path.**

## 4. Adobe Substance 3D Modeler (ex-Oculus Medium)

The only mass-market SDF *sculpting* product. Adobe's own copy calls it a **"Sparse Distance Field
(SDF) engine"** ([Meta blog][modeler-meta], [Steam][modeler-steam]) — "sculpt without worrying about
polycount, topology, or subdivision levels… never needing to retopologize."

Relevant product-level lessons:

- Resolution is a **user-facing dial**, not an implementation detail. Artists explicitly choose
  output resolution, and mesh + UVs are generated **only at export**.
- Layers, groups, instances and arrays are first-class. The layer stack *is* the edit list.
- Brushes are 3D primitives (cube, sphere, capsule, cylinder, prism), so the same engine covers
  organic clay and hard-surface boolean work.
- Tools that *don't* fit the local-CSG model — Warp, Elastic, Smooth, Inflate — exist anyway. They
  are the expensive ones, and they're the reason a pure analytic edit list isn't sufficient.

## 5. Interval arithmetic and tape pruning

### Keeter, *Massively Parallel Rendering* (SIGGRAPH 2020)

[Project page][mpr], [source][mpr-src]. The canonical GPU technique for analytic SDFs:

- Model expression is flattened to a **tape** of `uint64` clauses.
- Evaluated in a **shallow hierarchy with a high branching factor** (deliberately not a deep octree —
  deep recursion gives heterogeneous per-branch workloads, which are GPU-hostile).
- **Interval arithmetic** does double duty: skip empty regions, *and* emit a reduced tape for each
  region. **"Expression complexity decreases by two orders of magnitude"** in one benchmark.
- Requires only **C⁰ continuity** — warps and blends that break Lipschitz continuity are fine.

Fidget's benchmark table (same model, three implementations) from the [Fidget README][fidget]:

| Size | libfive (CPU) | MPR (GPU) | Fidget VM | Fidget JIT |
|---|---|---|---|---|
| 1024³ | 66.8 ms | **22.6 ms** | 61.7 ms | 23.6 ms |
| 1536³ | 127 ms | **39.3 ms** | 112 ms | 45.4 ms |
| 2048³ | 211 ms | **60.6 ms** | 184 ms | 77.4 ms |

Note: **60 ms for a single 2048³ full evaluation.** Far outside a frame budget. This is the number
that proves you cannot re-evaluate a whole high-res volume per frame — incremental dirty-region
updates are mandatory, not an optimisation.

Keeter's own comment on the remaining bottleneck ([HN][mpr-hn]):
> *"load/store operations when evaluating the tapes are terrible for memory access, since they use
> global memory rather than registers… I found a 2-6x speedup in going from an interpreter to a
> fully-compiled shader."*

### Barbier et al., *Lipschitz Pruning* (Eurographics 2025) — the current state of the art

[Paper page][lipschitz], [Wiley][lipschitz-wiley], Best Paper Honourable Mention. This
supersedes MPR for our use case:

- Prunes using the **Lipschitz property of SDFs** rather than interval arithmetic — **no IA
  interpreter overhead**.
- **Handles smooth CSG operators**, "notoriously difficult to handle" and exactly what a clay
  sculpting tool is made of. Interval arithmetic prunes smooth-min poorly because the operator has
  global support.
- **Up to ×629 speedup** on a 6023-node scene versus naive sphere tracing.
- Explicitly outscales MPR: *"our method scales well and can render 3D scenes featuring thousands of
  nodes in real time, where other SDF rendering methods are limited to a few dozens to hundreds of
  nodes, going as high as a few thousands for 2D SDFs [Kee20]."*
- Implementation: **4-level grid hierarchy at 4³, 16³, 64³, 256³**, one compute dispatch per level,
  one thread per cell, each thread writing its pruned tree given its parent's. Measured on a
  **laptop RTX 4060**.
- Memory: **2 bits/node** for first-traversal local state, **19 bits/node** for the second traversal.
- **Far-field culling** replaces whole subtrees with constant lower-bound distances.
- Pruning is fast enough to re-run **on every scene modification** — which is precisely the sculpting
  case.

This is the algorithm SolidScape should implement for its analytic layer.

## 6. Sparse volume structures

**VDB / OpenVDB** ([Museth TOG 2013][vdb]) — B+tree-like, shallow, wide. A narrow-band level set is
a truncated SDF where active voxels sandwich the surface. Two properties matter here:

- **Hierarchical CSG**: *"rather than perform CSG voxel-by-voxel, we can often process whole branches
  of the VDB tree in a single operation. Thus, the computational complexity scales only with the
  number of intersecting LeafNodes, which is typically small."* Near-real-time booleans on very
  high-res level sets.
- **Accelerated ray marching**: the tree doubles as a multi-level bounding hierarchy. Narrow-band-only
  structures can only leap the band width; tiled grids only one tile; VDB can leap much further.

Scale reference: a *How To Train Your Dragon* model at 7897 × 1504 × 5774 → 228 M active voxels in
**1 GB**, versus **¼ TB** dense.

**NanoVDB** ([NVIDIA][nanovdb]) — flattened, pointer-less, read-only GPU form. Perfect for
*shipping* a finished sculpt, wrong for the live editing structure (it's read-only by design).

**GVDB** ([HPG 2016][gvdb]) — the read-write GPU answer. Contributions directly applicable:
indexed **memory pooling** for dynamic topology, brick data in **texture atlases** with a separate
index table, **apron voxels** (atlas allocated larger than the brick so boundary threads do the same
work as interior threads, auto-populated by a neighbour-lookup kernel), and **hierarchical
short-stack 3DDDA** traversal that skips laterally among siblings and jumps tree levels without
revisiting the root.

**Sparse Voxel DAG** ([Kämpe et al. 2013][svdag]) — 128K³ (19 billion voxels) in **945 MB** by
deduplicating identical subtrees. Binary occupancy only, no per-voxel distance, and the dedup pass
is a batch operation. **Not suitable for live sculpting**, but an excellent *archival/export* format.

## 7. Meshing — and why it's the wrong default

Summary of the tradeoffs, drawn from the [algorithm comparison][meshing-notes] and the
[Godot voxel references thread][godot-refs]:

| Algorithm | Sharp features | LOD | Cost | Notes |
|---|---|---|---|---|
| Marching Cubes | No (bevels) | Poor | Low | 256-entry table, watertight, vertices only on edges |
| Surface Nets | No | Natural via octree | **Lowest** | One vertex per cell, dual grid, fewest triangles |
| Dual Contouring | **Yes** (QEF) | Good | High | Needs Hermite data; QEF solve per cell |
| Transvoxel | No | **Excellent** | Low | Dedicated transition cells, crack-free, no skirts |

The crack problem is the real cost. Manifold Dual Contouring ([Schaefer et al.][mdc]) needs an
octree-based topology-preserving vertex clustering pass just to *guarantee manifoldness* under
adaptive simplification. No Man's Sky sidestepped it by polygonising a short distance into
neighbouring blocks at a slightly different isolevel — which then z-fights.

Two independent voices say the same thing. Aaltonen: *"a quick GPGPU surface net algo… that was iffy
too. I wouldn't do that again."* Diego Floor, having implemented both: the DC seam artefacts are
*"the main known defect, and the reason MC stays one keypress away."*

**Conclusion: raymarch bricks for the viewport. Mesh only on export, where you can afford
Manifold DC or Transvoxel and a few seconds.**

## 8. The incremental sculpting loop

[Diego Floor's build log][diego] is the clearest public description of the per-stroke loop, and
several details are non-obvious enough to be worth copying verbatim:

**Storage.** 8³ bricks in an open-addressed hash table keyed by brick coordinate. Missing brick =
no surface, so empty space is free and the world is unbounded.

**Seam ownership.** *"Storing shared corners twice lets the copies drift apart and crack the mesh, so
ownership is half-open: a brick owns `[b·8, b·8+8)` and reads the corner one past its high edge from
the neighbour. One owner per sample, watertight across bricks."*

**Narrow band + sign grid.** Keep a brick only if it holds a sample with `|f| < 6 voxels` (≈1.5 bricks
thick). Memory then tracks **surface area, not volume**. But an absent brick becomes ambiguous — empty
air (`+big`) or solid interior (`−big`)? Fixed with a **1 byte per brick sign grid, flood-filled from
the outside border**. A band ≥1 brick thick is a wall the flood can't cross.

**The dirty halo is asymmetric — this is the subtle one.** Because a brick reads its boundary layer
from its `+` neighbours, editing brick `D` invalidates every brick that *reads* `D`, which is the
**seven bricks on `D`'s `−` side**, not the full 26-brick shell.

> *"A stroke re-extracts ~30–50 bricks whether the model has 200 bricks or 200,000."*

**Brush engine.** Raw mouse events make bad strokes — fast strokes go lumpy, slow ones pile up. Emit a
dab every fixed fraction of the brush radius, **carrying a remainder** so spacing is frame-rate
independent. Each dab carries position, outward normal, tangent, pressure.

**Smoothing is different in kind from build/carve.** Build/carve are accumulative — hold and they keep
going. Smoothing must *converge and stop*. Move each sample toward its neighbour average by

```
α = 1 − exp(−rate · strength · travel / radius)
```

The exponential asymptotes instead of overshooting.

### The trap: hard CSG destroys the distance metric

This one deserves its own heading because it silently breaks everything downstream.

> *"this is a level set, not a true signed distance field. A real SDF obeys `|∇f| = 1`… Hard CSG
> (`f = min(f, brush)`) keeps the zero crossing correct but wrecks that distance metric away from it.
> The sign and the surface stay honest; the gradient length doesn't. Anything that assumes true
> distance (sphere tracing, classically) has to be replaced."*

**Sphere tracing tunnels through thin features** once you've done a few boolean cuts. Robust
replacement for picking: clip the ray to the active brick AABB, march **fixed 0.4-voxel steps**
watching for a sign change, then **bisect** to refine. Slower in theory, never tunnels.

For the *render* path the fix is different: periodically **redistance** (fast sweeping / eikonal
solve) so `|∇f| = 1` is restored and sphere tracing is safe again.

## 9. Global fields and clipmaps

Unreal's Global Distance Field ([docs][ue-mdf]) is the reference for the *terrain-scale* half of
SolidScape: per-object distance fields composited into a small number of **camera-centred clipmap
volume textures**, where *"only newly visible areas or those affected by scene modification need to
be updated."* Also note their **8-bit distance field option** — half the memory, artefacts only on
large or thin meshes. This matches Claybook's 8-bit choice.

---

# Part II — Proposed Pipeline for SolidScape

## 10. Architecture

Three layers, each authoritative for a different thing.

```
┌─ LAYER 1 ── DOCUMENT (CPU) ─────────────────────────────────────┐
│  Node graph  →  compiled flat edit list / tape                  │
│  Resolution-independent · undo-redo · re-editable · serialised  │
└────────────────────────┬────────────────────────────────────────┘
                         │  compile + hierarchical Lipschitz prune
┌────────────────────────▼─ LAYER 2 ── FIELD CACHE (GPU) ─────────┐
│  Sparse brick pool · narrow band · adaptive per-brick LOD       │
│  Rebuilt ONLY for dirty bricks · 8-bit or fp16 · mipped         │
└────────────────────────┬────────────────────────────────────────┘
                         │  hierarchical 3DDDA raymarch
┌────────────────────────▼─ LAYER 3 ── PRESENTATION ──────────────┐
│  Viewport raymarch · physics queries · export meshing           │
└─────────────────────────────────────────────────────────────────┘
```

**Why the edit list must stay authoritative:** it is what makes "intricate, even smaller detail"
possible. The brick cache always has *some* finite voxel size, but it is only a cache — zoom in and
you re-evaluate the same edit list at a finer voxel size. Detail is bounded by float precision, not
by any grid. This is the Dreams/Modeler answer, and it's the only one that actually delivers the
requirement.

**Why the brick cache must exist:** it makes render and physics cost **independent of edit count**
(Claybook's key property). Without it, the 50,000th stroke is slower to render than the first, and
the tool becomes unusable exactly when the artwork gets good.

## 11. Layer 1 — Node graph → edit tape

SolidScape already has the node graph. The compiler lowers it to:

```c
struct EditRecord            //  48 bytes, std430
{
    uint  shapeCategory;     // sphere | box | capsule | cylinder | prism | noise | custom
    uint  blendCategory;     // add | subtract | intersect | colour | smooth variants
    float smoothRadius;      // [m]  0 = hard boolean
    float lipschitzBound;    // [-]  per-node K, needed by the pruner
    vec4  shapeParams;       // radius / extents / rounding
    vec4  transformRow0;     //  affine inverse, 3 rows
    vec4  transformRow1;
    vec4  transformRow2;
    vec4  colourEmissive;
    vec3  aabbMin, aabbMax;  // [m]  conservative, inflated by smoothRadius
};
```

Follow Dreams and keep the graph **right-leaning so it flattens to a list**. Tree-shaped
subgraphs are allowed in the UI but compiled to a list with explicit push/pop, since a flat list is
embarrassingly parallel.

**Track the Lipschitz bound `K` and an exactness flag per node.** This is what Layer 2's pruner
consumes, and what tells the renderer whether it may sphere-trace (`K ≤ 1`, exact) or must
fixed-step (inexact). Warp and noise nodes inflate `K`; the renderer must know.

### Hierarchical Lipschitz pruning

Per Barbier et al., four dispatches over a `4³ → 16³ → 64³ → 256³` hierarchy. One thread per cell;
each thread computes its pruned tape from its parent's pruned tape. Budget **2 bits/node** local
state and **19 bits/node** global state in a scratch buffer.

Prefer this over MPR's interval arithmetic for two reasons specific to sculpting: **it prunes smooth
operators**, which IA handles badly and which are the majority of clay strokes; and it avoids the IA
interpreter overhead entirely. Add MPR-style interval evaluation later only as a fallback for node
types with no analytic `K`.

Add **far-field culling**: subtrees far from a cell collapse to a constant lower bound.

## 12. Layer 2 — The sparse brick cache

### Brick geometry

| Property | Value | Rationale |
|---|---|---|
| Interior | **8³ voxels** | Matches Dreams' 4³ wavefront tiling ×2; 512 threads is a clean dispatch |
| Apron | 1 voxel each side → **10³ allocated** | GVDB: boundary threads do the same work as interior; enables trilinear filtering without neighbour lookups |
| Format | **8-bit snorm**, band ±4 voxels | Claybook, proven at 1/32-voxel precision |
| Storage | 1000 B/brick | vs. 2000 B at fp16 |
| Ownership | half-open `[b·8, b·8+8)` | One owner per sample — no drift, no cracks |

Use **fp16 only for the finest LOD of the active sculpt layer**, where the artist is actually
looking. Everything else stays 8-bit.

### Adaptive resolution — the dynamic-resolution requirement

Each brick carries an **LOD exponent**: its voxel size is `baseVoxel · 2^lod`. Bricks are allocated
from one pool regardless of level, so "resolution" is per-region, not global.

Refinement criterion, evaluated per brick per frame:

```
refine(brick) =  projectedScreenTexelSize(brick) > targetTexels
              OR localCurvature(brick)          > curvatureThreshold
              OR withinBrushInfluence(brick)
```

The third clause is what makes sculpting feel right: **the brush always drags maximum resolution
along with it**, regardless of camera distance.

Coarsening runs on a hysteresis timer (~0.5 s) so brushing back and forth doesn't thrash the pool.

### Why adaptivity is mandatory, quantitatively

Take a 1 m object at a 2048³ effective resolution — voxel ≈ 0.5 mm, surface area ≈ 5 m².

```
brick edge  = 8 × 0.5 mm       = 4 mm
surface bricks ≈ 5 m² / (4 mm)² ≈ 312,500
× ~1.5 for band thickness       ≈ 470,000 bricks
× 1000 B (8-bit)                ≈ 470 MB
× 2000 B (fp16)                 ≈ 940 MB
```

A **uniform** 2048³ narrow band is already ~0.5 GB at 8-bit. That is why Claybook chose
1024×1024×512 at 8-bit (586 MB) and why uniform grids dead-end.

With adaptive LOD and, say, 10% of surface area at the finest level and the rest two levels coarser:

```
0.10 × 470,000                          =  47,000 bricks
0.90 × 470,000 / 16   (2 levels coarser) =  26,400 bricks
total ≈ 73,400 bricks × 1000 B          ≈  73 MB
```

**~6× less memory for identical apparent detail where the artist is looking.** And because the edit
list is authoritative, refining any region later is just a re-evaluation — no data was lost.

### Pool management

Index table + brick atlas, per GVDB and Kraus et al. Free-list allocator with an LRU eviction
victim list. Target pool: **512 MB default, user-configurable** (Modeler exposes resolution to the
user; so should we).

Evicting a brick is **free and safe** — it's a cache of a function we still hold. This is a large
robustness advantage over a voxel-authoritative design, where eviction means data loss.

### Narrow band and sign grid

Keep bricks with any `|f| < 6 voxels`. Maintain **1 byte per brick** of sign state, flood-filled from
the domain border, so absent bricks resolve to `±big` correctly and carving into solid interior works.

Rebuild the flood on stroke-end, not per-dab.

## 13. GPU pass structure

Per edit (dab), all on GPU, all indirect-dispatched:

```
① MARK      dirty bricks from dab AABB ⊕ smoothRadius ⊕ apron
            + expand by the 7-brick −octant halo (asymmetric, per §8)
② CULL      per dirty brick: gather edits whose inflated AABB overlaps
            → compacted per-brick edit list. Dilate occupancy by 1 brick
              (Claybook) so influencing-but-not-overlapping edits survive.
③ PRUNE     4-level Lipschitz hierarchy → per-cell pruned tape
④ EVALUATE  one workgroup per brick, 512 threads, 10³ with apron
            → 8-bit snorm into the atlas
⑤ MIP       sparse 2×2×2 downsample; ±4 band → ±2; max step doubles per level
⑥ REDIST    (stroke-end only) fast-sweeping eikonal to restore |∇f| = 1
```

Passes ①–⑤ are the per-dab hot loop and must fit in ~4 ms. Pass ⑥ runs once on mouse-up.

**Every pass is bounded by the brush footprint, not the model size.** That is the invariant that
makes the tool hold 60 fps on a 200-brick marble and a 200,000-brick dragon alike.

### Async compute

Claybook ran SDF generation on async compute. Do the same: graphics queue renders frame *N* from
the brick atlas while the compute queue builds the dab for frame *N+1*. Double-buffer the atlas
index table; the brick payload can be written in place because dirty bricks are, by construction,
not the ones being read for the current frame — enforce with a per-brick generation counter.

## 14. Layer 3 — Rendering

**Primary: hierarchical 3DDDA raymarch of the brick atlas** (GVDB short-stack). Skip laterally among
siblings, hop tree levels, never revisit the root. Sample the atlas only on brick entry.

Aaltonen, on exactly this choice: *"we found out that ray-marching the 3D texture was much cheaper
than raster. It was fast enough to run on Nintendo Switch. And you get nice penumbra-widening shadows
(sharp at contact, soft at distance)."* ([source][seb-raymarch])

**Step safety.** Because hard CSG breaks `|∇f| = 1`, the marcher must consult the per-brick
`lipschitzBound`:

- `K ≤ 1` and exact → sphere-trace, full step.
- `K > 1` → step by `f / K`.
- Inexact (post-warp, post-noise, pre-redistance) → fixed **0.4-voxel** steps + bisection on sign
  change.

Carry `K` per brick, refreshed during evaluation. This single mechanism removes the entire class of
tunnelling bugs.

**Shadows and AO.** Same marcher, coarser mip. SDFs give penumbra-widening soft shadows nearly free
via the classic min-over-ratio trick, and cone-traced AO by stepping the mip chain.

**Picking.** Never sphere-trace for picking. Clip to the active brick AABB, fixed 0.4-voxel march,
bisect. Correct even on a concavity carved the previous frame.

**Physics.** Query the brick cache directly. Per Aaltonen: SDF beats triangles — negative interior
distances solve tunnelling, whereas a triangle mesh is a thin shell. Do **not** mesh for physics.

**Meshing is export-only.** Dual Contouring with stored Hermite normals for hard-surface output,
Transvoxel if LOD-stitched chunks are needed. Seconds of budget available, so use the algorithms
that are too slow for realtime.

## 15. Brush engine

```
pointer → pick (fixed-step + bisect)
        → emit dabs spaced at 0.25 × radius, remainder carried across frames
        → each dab: position, outward normal, tangent, pressure, travel
        → append EditRecord(s) to the live stroke
        → mark dirty bricks; run passes ①–⑤
on pointer-up
        → coalesce the stroke into one history entry
        → rebuild narrow band + sign flood
        → redistance (pass ⑥)
```

**Falloff**: smoothstep / linear / sharp, full strength at centre → 0 at rim.

**Accumulative ops** (build, carve): `f ±= strength · falloff · travel`.

**Convergent ops** (smooth, flatten): Laplacian step with
`α = 1 − exp(−rate · strength · travel / radius)`.

**Stroke coalescing** is what keeps the edit list from exploding. A 200-dab stroke of the same brush
along a path compiles to **one polyline/spline edit**, not 200 spheres. This is the difference
between a 100k-edit document and a 10M-edit document. Dreams' 100k-edit ceiling assumes this.

**Freeze/bake escape hatch.** Warp, elastic and non-local ops break locality and therefore pruning.
Follow Modeler: allow them, but **bake the layer to bricks** at that point and start a fresh edit
list on top. The document becomes `[baked brick layer] + [new edit list]`. This bounds worst-case
cost and is the only sane way to support the tools artists will demand.

## 16. Terrain scale

Terrain is the same machinery with a camera-centred **clipmap** on top, per Unreal's Global DF:
4–5 clipmap levels, each a fixed brick budget, each doubling in world extent. Only newly-visible
regions and edited regions recomposite.

SolidScape's existing terrain nodes (Simplex, MultiFractal, Erosion, Slope Mask) become **procedural
edit sources**: instead of enumerating dabs, they are evaluated analytically inside pass ④. An
erosion node, being iterative and non-local, is a **bake node** by definition — it consumes a brick
layer and produces a brick layer, and everything downstream of it treats it as a baked source.

## 17. Build order

| Phase | Deliverable | Validates |
|---|---|---|
| **0** | UI shell | ✅ done |
| **1** | Analytic raymarcher. Compile graph → tape, brute-force sphere-trace in a fragment shader. No bricks. | Graph→tape compiler, SDF maths, camera. Will die at ~100 edits — *that's the point*, it proves why Phase 3 exists. |
| **2** | Brick pool + narrow band + 3DDDA marcher. Static scene, CPU-side evaluation. | Pool allocation, apron, half-open ownership, traversal. |
| **3** | GPU evaluation passes ①–⑤. Dirty-brick incremental rebuild. | The core loop. Instrument: dirty bricks/stroke must stay ~30–50 **independent of model size**. If it scales with model size, the halo logic is wrong. |
| **4** | Lipschitz pruning hierarchy. | Edit-count scaling. Benchmark against the Barbier figures — we should see 1–2 orders of magnitude. |
| **5** | Brush engine, stroke coalescing, undo/redo. | Ergonomics. This is where it starts feeling like a tool. |
| **6** | Adaptive LOD + refinement criterion. | The dynamic-resolution requirement, and the 6× memory win. |
| **7** | Redistancing, physics queries, export meshing. | Production completeness. |

### Instrumentation to build in from Phase 3

These are the numbers that tell you whether the architecture is holding:

- **Dirty bricks per dab** — must be flat in model size. Target 30–50.
- **Edit-to-visible latency** — target < 16 ms.
- **Pruned tape length vs. full tape length** — expect 1–2 orders of magnitude reduction.
- **Brick pool occupancy and eviction rate** — thrashing means the hysteresis is too tight.
- **Fraction of marcher steps taken as fixed-step vs. sphere-trace** — rising fixed-step fraction
  means the field is degrading and redistancing isn't keeping up.

## 18. Key risks

| Risk | Mitigation |
|---|---|
| **Sphere tracing tunnels after boolean cuts** | Per-brick Lipschitz bound drives step mode; redistance on stroke-end. Never sphere-trace for picking. |
| Dirty set grows with model size | Asymmetric 7-brick −octant halo, not 26. Assert flatness in Phase 3. |
| Edit list explodes | Stroke coalescing to splines; bake non-local ops. |
| Brick pool thrashing | LRU + 0.5 s coarsening hysteresis + user-configurable budget. |
| Cracks at brick/LOD seams | Half-open ownership; apron; don't mesh for the viewport at all. |
| Smooth operators defeat the pruner | Lipschitz pruning over interval arithmetic — chosen specifically for this. |
| Warp/noise break locality | Bake-to-brick escape hatch, as Modeler does. |

## 19. Summary of the design decisions

1. **Hybrid, not either/or.** Analytic edit list is the document; sparse bricks are the cache.
   Every shipping tool does this.
2. **Detail is unbounded** because the edit list is resolution-independent. Bricks are a view of it.
3. **Render cost is independent of edit count** because the marcher only sees bricks.
4. **Edit cost is independent of model size** because only dirty bricks rebuild.
5. **Lipschitz pruning, not interval arithmetic** — it handles the smooth operators that sculpting
   is made of, and it's the 2025 state of the art.
6. **Raymarch, don't mesh.** Meshing is an export path. Two independent practitioners regret having
   meshed for the viewport.
7. **8-bit ±4-voxel bricks**, fp16 only at the finest active level. Claybook proved 1/32-voxel
   precision is enough.
8. **Track the Lipschitz bound per brick** and switch step mode accordingly. This is the single
   mechanism that kills the tunnelling bug class.

---

## References

[mm-siggraph]: https://cheneyshen.com/siggraph-15-learning-from-failure-a-survey-of-promising-unconventional-and-mostly-abandoned-renderers-for-dreams-ps4-a-geometrically-dense-painterly-ugc-game/
[mm-pdf]: http://media.lolrus.mediamolecule.com/AlexEvans_SIGGRAPH-2015-sml.pdf
[mm-reddit]: https://www.reddit.com/r/VoxelGameDev/comments/1hocjsx/trying_to_make_a_dreamslike_modelling_app_in/
[svo-octree]: https://www.reddit.com/r/VoxelGameDev/comments/ontjdf/how_is_sdf_stored_in_a_octree/
[claybook-gdc]: https://ubm-twvideo01.s3.amazonaws.com/o1/vault/gdc2018/presentations/Aaltonen_Sebastian_GPU_Based_Clay.pdf
[claybook-thread]: https://threadreaderapp.com/thread/1076765876148490240.html
[seb-2026]: https://x.com/SebAaltonen/status/2008849693623640122
[seb-raymarch]: https://x.com/SebAaltonen/status/1973742450218086873
[modeler-meta]: https://www.meta.com/blog/adobe-substance-3d-modeler-sculpting-rift-s-link/
[modeler-steam]: https://store.steampowered.com/app/1745780/Substance_3D_Modeler_2025/
[mpr]: https://www.mattkeeter.com/research/mpr/
[mpr-src]: https://github.com/mkeeter/mpr
[mpr-hn]: https://news.ycombinator.com/item?id=26873691
[fidget]: https://github.com/mkeeter/fidget
[lipschitz]: https://wbrbr.org/publications/LipschitzPruning/
[lipschitz-wiley]: https://onlinelibrary.wiley.com/doi/10.1111/cgf.70057
[vdb]: https://www.museth.org/Ken/Publications_files/Museth_TOG13.pdf
[nanovdb]: https://developer.nvidia.com/blog/accelerating-openvdb-on-gpus-with-nanovdb/
[gvdb]: https://diglib.eg.org/server/api/core/bitstreams/8bbf3ba6-a4df-45c4-9703-856002f04b1d/content
[svdag]: https://www.cse.chalmers.se/~uffe/HighResolutionSparseVoxelDAGs.pdf
[mdc]: https://people.engr.tamu.edu/schaefer/research/dualsimp_tvcg.pdf
[meshing-notes]: https://github.com/MrBean1512/Procedural_Smooth_Voxels
[godot-refs]: https://github.com/Zylann/godot_voxel/issues/24
[diego]: https://diegofloor.substack.com/p/building-a-voxel-sculpting-editor
[ue-mdf]: https://docs.unrealengine.com/5.3/en-US/mesh-distance-fields-in-unreal-engine/

**Production systems**
- Media Molecule, *Dreams* — [SIGGRAPH 2015 notes][mm-siggraph] · [slides][mm-pdf] · [post-release discussion][mm-reddit]
- Second Order, *Claybook* — [GDC 2018][claybook-gdc] · [optimisation thread][claybook-thread] · [2026 retrospective][seb-2026] · [on raymarching vs raster][seb-raymarch]
- Adobe *Substance 3D Modeler* — [Meta blog][modeler-meta] · [Steam][modeler-steam]
- Unreal Engine — [Mesh & Global Distance Fields][ue-mdf]

**Evaluation & pruning**
- Keeter 2020, *Massively Parallel Rendering of Complex Closed-Form Implicit Surfaces* — [page][mpr] · [source][mpr-src] · [author notes][mpr-hn]
- Keeter, *Fidget* (CPU JIT, benchmark table) — [repo][fidget]
- Barbier, Sanchez, Paris, Michel, Lambert, Boubekeur, Paulin, Thonat 2025, *Lipschitz Pruning: Hierarchical Simplification of Primitive-Based SDFs*, CGF 44(2) — [page][lipschitz] · [Wiley][lipschitz-wiley]

**Sparse structures**
- Museth 2013, *VDB: High-Resolution Sparse Volumes with Dynamic Topology*, TOG — [PDF][vdb]
- NVIDIA, *NanoVDB* — [blog][nanovdb]
- Hoetzlein 2016, *GVDB: Raytracing Sparse Voxel Database Structures*, HPG — [PDF][gvdb]
- Kämpe, Sintorn, Assarsson 2013, *High Resolution Sparse Voxel DAGs*, TOG — [PDF][svdag]

**Meshing**
- Schaefer, Ju, Warren, *Manifold Dual Contouring* — [PDF][mdc]
- Algorithm comparison notes — [Procedural Smooth Voxels][meshing-notes] · [godot_voxel references][godot-refs]

**Sculpting loop**
- Floor 2026, *Building a Voxel Sculpting Editor* — [build log][diego]
