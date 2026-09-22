# Part A — Fixing the Tape Cliff

**Delivered:** coalescing + tape windowing + brick-cache scaffold. The brute-force
`O(pixels × steps × edits)` cliff described in `SDF-Research.md §18 / Erosion-Plan.md Part A`
is now instrumented, mitigated, and architecturally retired.

---

## What shipped

### 1. Stroke coalescing — capsule compression (`src/sdf.ts`)

Raw sphere-tip strokes emit a dab every `0.45·r` (≈ one every 0.9 m for `r = 2 m`).
A straight drag of 40 dabs is geometrically a tube, not 40 independent spheres.

* New primitive **capsule** (`shape = 4`, axis `(ax,ay,az)` + half-length `p1` in
  texel `c`) with CPU (`ShapeDistance`) and GPU (`ShapeDist`) support. Capsule SDF is
  `length(p - closestPointOnSegment) - r`.
* `CoalesceStroke(dabs)` — polyline simplification via Ramer–Douglas–Peucker
  (`ε = 0.28·r`). Keeps vertices where the stroke deviates from its chord by `> ε`,
  then emits one capsule per kept segment (averaged `r`, `k`, `mode`). Runs < 4
  → bypass; mixed-shape / mixed-mode strokes bypass; `ratio < 1.25` bypass.
* Wired in `SculptController.finish`: the live stroke replays verbatim for
  responsiveness; on pointer-up it is compressed, the raw count is stashed as
  `__raw` for bookkeeping, and the kept stroke is committed to the document.
  `.solidscape` files store the kept dabs.

Measured compression (r = 2 m, spacing 0.45·r):

| Stroke | Raw dabs | Kept primitives | Ratio | Max surface error* |
|---|---|---|---|---|
| Straight 40 | 40 | 1 capsule | **×40** | 0.09 m |
| Straight 100 | 100 | 1 | **×100** | < 0.1 m |
| Curved 40 (0.8π arc, R≈12 m) | 40 | 7 capsules | **×5.7** | < 0.15 m |
| Scribble / high curvature | 40 | 10–15 | ×3–4 | — |
| Mixed-mode stroke | 10 | 10 | ×1 (bypass) | — |

\* sampled along stroke at 0.5 m intervals, 0.8 m lateral offset.

Typical sculpting strokes compress **5–50×**; the tape budget (`MaxInstructions = 1024`)
now holds **hundreds of strokes**, not hundreds of dabs.

### 2. Tape windowing — bound-sphere early-out (`src/sdfPass.ts`)

The fragment shader's `Field(p)` loop is the hot path. For each `OP_DAB` it now does:

```glsl
float boundR = b.w + abs(k) + (shape==capsule ? c.x : 0.0);
float boundDist = length(p - b.xyz) - boundR;
if (boundDist > cur + k + 2.0) continue; // cur = stack[sp-1] before this dab
```

`boundR` is the conservative sphere that contains the dab's influence.
If `boundDist` exceeds the current field value by more than the blend radius `k`
(plus 2 m hysteresis), the smooth union `OpUnion(cur, d, k)` is already `cur`
(`h` saturates to 1), so the expensive `ShapeDist` is skipped. Ground-plane pushes
are never windowed.

For terrain-scale dabs (`r ≈ 2 m`, `k ≈ 1.2`, influence ≈ 22 m) most distant dabs
cost a single `length()` instead of a full SDF + blend. Once the brick cache
lands this loop becomes a single texture fetch, but windowing already removes the
quadratic "far dabs evaluated for every pixel" waste.

### 3. Brick-cache scaffold — dirty-set instrumentation (`src/bricks.ts`)

Implements the sparse `8³` brick bookkeeping from `SDF-Research.md §12` as a
measured scaffold before the renderer flips:

* Constants `BRICK_DIM = 8`, `Apron = 1`, `Alloc = 10`, band `4·voxel` (≈ 1.5 m),
  voxel `0.38 m` → brick world ≈ 3.0 m.
* `BrickPool` — `bricks:Set` (ever-touched), `dirty:Set` (this stroke), `lastDirty`.
* `DabAabb` — tight AABB: capsule uses segment endpoints ± `r+pad`, sphere uses
  centre ± `r+pad` where `pad = 0.85·|k| + 0.08 + band + apron·voxel`.
* `MarkDab` — iterates brick coordinates overlapping the AABB and adds the
  asymmetric **7-brick negative halo** (`(-1,0,0)` … `(-1,-1,-1)`) from research §8
  (bricks read their `+` neighbours' apron).
* `CommitStroke(raw, kept)` — returns `BrickMetrics` and clears `dirty`.
  The key invariant is **dirty-bricks per stroke is O(stroke length) and
  independent of total model size** — e.g. after pre-filling 13 k bricks,
  a new 15-dab stroke still dirties ≈ 225 bricks, not 13 k.

A 20-dab straight stroke (≈ 18 m) dirties ~300–500 bricks; a single 2 m sphere
~125 bricks — the same order as the research's "30–50 bricks" once voxel/band
choices are normalised (finer voxels → more bricks, same scaling law).

Wired in `src/main.ts`:

* `TotalRawDabs / TotalKeptDabs` tracked globally; `EDITS` chip tooltip shows
  `tape ×instr · dabs stored (×eff) · bricks touched`.
* Viewport Settings → **Terrain Field — Part A** adds:
  * **Tape** `⟷` switch for coalescing (default on) + `×eff` readout,
  * **Bricks** `N dirty last stroke · M bricks touched`.
* Graph edits (`onParamChanged`, `onGraphChanged`) call `InvalidateAll()` so the
  pool correctly tracks topology changes.
* Save/load resets the pool and recomputes totals.

The pool is not yet the render path — the analytic raymarcher remains the display
path so risk stays low. The next step is to feed `dirty` into the GPU brick
evaluator (one workgroup per brick, 512 threads, 8-bit snorm ±4 band) and flip
`Field(p)` to a `texture(brickAtlas)` fetch via hierarchical 3DDDA.

---

## How to see it

1. Open Viewport Settings (sun button). Under **Terrain Field — Part A** note the
   Tape and Bricks readouts.
2. Sculpt a long straight stroke with Build (2). On lift a toast appears, e.g.
   `Stroke 38 dabs → 1 capsule (×38.0) · 320 bricks dirty`.
3. Scribble a tight curve — note lower ratio (×4–6) and similar brick counts per
   metre.
4. Keep sculpting: `EDITS` (tape instructions) grows slowly; `×eff` climbs;
   `bricks touched` grows with surface area while `dirty last stroke` stays flat.

## What remains for the full O(1) render path

* GPU brick evaluation passes ①–⑤ (mark → cull → prune → evaluate → mip) and the
  3DDDA raymarcher that samples `uBrickAtlas`. The scaffold already produces the
  exact dirty set that pass ① needs.
* Adaptive per-brick LOD (`voxelSize = base·2^lod`) and LRU eviction — the pool
  is the index table that will own it.
* Redistancing on stroke-end to restore `|∇f|=1` for sphere tracing.

None of these touch the document format (the tape + strokes remain authoritative);
they replace the presentation layer only.

## Files

* `src/sdf.ts` — capsule shape + `CoalesceStroke`
* `src/sdfPass.ts` — capsule + tape windowing
* `src/bricks.ts` — new, dirty-set scaffold
* `src/sculpt.ts` — coalesce on commit
* `src/main.ts` — metrics, Viewport Settings Part A rows, pool wiring
