# Slate

A node-based SDF terrain generator that runs entirely on the GPU in the browser.
Noise-driven landforms, physically-scaled erosion, caves and overhangs from a
true signed distance field, and Gaea-style satmap texturing — wired together in
a node graph and raymarched live in the viewport.

```
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + all four headless validators
```

Requires WebGL 2 with `EXT_color_buffer_float`.

---

## The resolution problem, and how Slate answers it

The reason to build a terrain tool on an SDF is caves and overhangs: a
heightfield cannot express them. The reason *not* to is that a voxel SDF at any
affordable resolution turns crisp erosion into mush. A 256³ volume over a 4 km
terrain is a 16 m voxel — every river, every scree slope, every cliff lip is
gone before you start.

Slate does not pick a side. It runs a **hybrid representation** and only ever
combines the two analytically:

| | representation | resolution | what lives here |
|---|---|---|---|
| **Surface** | 2D heightfield, R32F | 1024²–4096² | all erosion, all detail, all texturing |
| **Voids** | 3D SDF volume, R32F | 48³–256³ | caves, tunnels, undercuts, arches |

The final distance field is assembled **in the raymarcher**, per sample, never
baked:

```glsl
float dGround = p.y - height(p.xz) * heightScale;   // full-resolution, bilinear
float d       = smax(dGround, -dCave, caveBlend);   // caves subtracted analytically
```

`dGround` is sampled from the heightfield at its native resolution, so the
surface is exactly as sharp as the erosion made it. The low-resolution volume
only ever *removes* material. A 128³ cave volume and a 4096² heightfield coexist
without the former blurring the latter — which is the whole point.

Two rejected alternatives, for the record: a pure 3D voxel SDF (the blurring
problem above), and a narrow-band sparse SDF (right answer for a native app,
but the bookkeeping does not fit fragment-shader-only GPU compute).

### Resolution independence in the erosion

Blurring also creeps in through parameters. If "erosion strength" is expressed
in texels, the same graph produces a different landform at every resolution, and
raising resolution smears the result instead of refining it.

So every field in Slate is dimensionless `~[0,1]`, and every erosion node
converts to metres before doing physics:

```ts
cell = worldSize / resolution     // metres per texel
```

Talus angles are degrees. Incision is metres. Sediment capacity is a function of
slope and discharge, not of pixel deltas. Raise the resolution and you get
*finer tributaries on the same river system*, not a different planet.

Where a process genuinely cannot work below some sampling density, the node says
so rather than quietly producing a smear. Each declares a `minRes`; below it the
node emits a warning that surfaces on the card and in the build log.

| node | minimum | why |
|---|---|---|
| Hydraulic Erosion | 512 | virtual-pipe flow needs texels to route between |
| Rivers | 512 | channels narrower than ~2 texels alias into dashes |
| Wind Erosion | 512 | shelter tracing is a 12-step march upwind |
| Alluvial Deposition | 512 | fans key off flow accumulation |
| Thermal Erosion | 256 | talus is a local 8-neighbour operation |

---

## Erosion

Five processes, each a separate node, each with its own auxiliary outputs so the
texturing stage can key off what actually happened rather than guessing from the
final height.

**Hydraulic** — Mei et al. virtual pipes. Four passes per iteration: flux →
water height (MRT) → erode/deposit (MRT) → sediment advection. Accepts a
`hardness` field so sedimentary banding resists differentially
(`resist = mix(1, 0.18 + 1.9 * hard, influence)`) — this is what makes a terraced
cliff erode into steps instead of a smooth ramp.
*Outputs: Height, Flow, Wear, Deposits, Water.*

**Thermal** — 8-direction outflow with a mirrored-index gather, so mass is
conserved exactly. Material above the angle of repose slides;
`talus = tan(angle) * standFactor * jitter * cell`, diagonals weighted √2. This
is the node that makes cliffs read correctly: it produces the talus apron and
scree skirt at the base that tells the eye how tall the rock face is.
*Outputs: Height, Scree, Wear.*

**Wind** — 12-step upwind shelter trace, then downwind sand advection.
Windward faces abrade, lee faces accumulate.
*Outputs: Height, Sand, Exposure.*

**Rivers** — the node that makes drainage legible. Depressions are filled first
(without it the network shatters into disconnected puddles and you never see a
river), then multi-flow-direction accumulation with a quarter-resolution pyramid
seed, then stream-power incision `dz = -K · A^m · S^n` clamped per step, then a
carve pass that cuts a channel profile rather than a V-notch.
*Outputs: Height, Rivers, Flow, Water.*

**Alluvial** — deposition where discharge is high and slope collapses:
`dep = rate · A^m · smoothstep(Scrit·1.8, Scrit·0.15, slope)`. Fans at canyon
mouths, floodplain fill, delta building at the coast.
*Outputs: Height, Deposits.*

Plus **Snowfall**, which is altitude × slope-hold × lee drift, and reads as snow
rather than as a white height threshold.

---

## Texturing

Satmaps, the Gaea way: a 1D gradient LUT indexed by a driver field, composited
in layers. 15 presets ship (alpine, slate, rocky, desert, tundra…). Each SatMap
node takes an input field, an optional mask, and remap/gamma/saturation
controls; Colour Blend stacks them. Because the erosion nodes expose Flow, Wear,
Deposits and Scree as separate outputs, a wet-rock layer can be driven by actual
stream discharge and a scree layer by actual talus accumulation.

---

## Architecture

```
src/
  core/
    gl/GPU.ts            the only file that touches raw WebGL
    shaders/lib.ts       GLSL chunks: HEADER, NOISE, FRACTAL, FIELD
    graph/types.ts       node registry, param schema, port types
    graph/Evaluator.ts   topo sort, hashing, LRU cache, ref-counted frees
    nodes/               41 node definitions across 7 categories
  render/
    raymarch.ts          the analytic SDF assembly + shading
    TerrainRenderer.ts   orbit camera, adaptive quality, present loop
  state/                 zustand store, undo/redo, default graph
  ui/                    viewport panel, node editor, inspector
```

**One GL context.** The `GPU` class is constructed on the visible canvas. Node
passes render into pooled FBO targets; the viewport presents from the same
context. No texture ever crosses a context boundary or round-trips through the
CPU.

**Pooled targets.** A 200-iteration erosion loop ping-pongs between two
recycled textures rather than allocating 400. Allocation is tracked per node, so
a node that throws mid-evaluate cannot strand pool entries.

**Incremental rebuilds.** Every node hashes to
`type | settings | params | bypass | upstream hashes`. Nodes with
`cost >= 8` are cached and LRU-trimmed to 420 MB; cheaper nodes are re-run
because re-running them costs less than holding a full-resolution target alive.
Editing one parameter re-runs that node and its descendants only — in practice
an unchanged rebuild of the default graph skips **99.1%** of its GPU work.

**Program cache keyed by source,** never by pass name: two passes sharing a
debug label but emitting different GLSL must not collide into one program.

---

## Testing without a GPU

There is no WebGL in CI, and a broken shader is otherwise invisible until the
viewport goes black. So `npm run check` runs four headless validators:

| command | what it proves |
|---|---|
| `validate:shaders` | Mocks the GPU and runs **every node across its enum permutations, connected and unconnected**, capturing every fragment source that would really be submitted. Each is parsed as GLSL ES 3.00, scope-checked for undeclared identifiers, and cross-referenced against the uniforms the pass actually binds — a declared-but-unbound uniform silently reads as 0 on the GPU, which is a black screen with no error. |
| `validate:graph` | Registry well-formedness (duplicate ports, enum defaults outside their options, numeric defaults outside min/max), the starting graph's type-correctness and acyclicity, and that the store refuses type-mismatched and cycle-closing connections. |
| `validate:build` | Runs the **real Evaluator** against a mock GPU: topological order, hashing, the LRU cache, reference-counted frees and payload assembly all execute as they do in the browser. Asserts the graph produces height + colour + volume, that an unchanged rebuild is near-free, that pinning retargets, that abort stops early, and that nothing is double-freed or leaked. |
| `validate:ui` | Mounts every panel, all 41 node cards and every inspector variant into jsdom, plus the empty-graph, unknown-node-type and dangling-edge cases. Fails on React warnings. |

These caught, among others: a colour output that was being swept by the
reference counter before it reached the renderer (terrain rendered untextured),
a generator declaring seven fractal uniforms it never bound, and two distinct
shaders sharing one cache key.
