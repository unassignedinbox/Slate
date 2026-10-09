# Slate

A heightmap landscape editor built around a layer stack.

Slate is a terrain tool for people who think in processes rather than brushes.
Every ridge, scree slope and river terrace in a Slate scene is the output of a
stack of operations you can read top to bottom: something generates rock,
something else sculpts it, and a chain of erosion passes wears it down. Colour
is not painted either — satmap layers tint the terrain from its own measured
attributes.

```
npm install
npm run dev
```

## Layout

```
┌──────────────┬────────────────────────────┬──────────────────┐
│ layer stack  │          viewport          │    inspector     │
│              │                            │                  │
│ height stack │   three.js shaded relief   │  cards for the   │
│  · generator │   or a 2D hillshade /      │  selected layer  │
│  · filter    │   terrain channel          │  or the project  │
│  · erosion   │                            │                  │
│ satmap       │                            │                  │
└──────────────┴────────────────────────────┴──────────────────┘
```

## Height layers

Three kinds of operation can sit in the height stack, in any order:

**Generators** create a field: Perlin, multifractal, ridged, billow, cellular,
mountain, plateau, dunes, volcano, dome, rift, warp, terraces, gradient,
constant. They blend into whatever is beneath them.

**Filters** reshape what is already there: smooth, sharpen/amplify, terrace
(the geological stack), cliff/escarpment, levels, curve, and the
erosion-deposit and hydraulic-correct helpers.

**Erosion** simulates a process. Each type has its own model and its own set of
sliders:

| type | what it does |
| --- | --- |
| Fluvial | stream-power incision, `E = K·Aᵐ·Sⁿ`, with lateral planation and settling — dendritic valleys and graded profiles |
| Pipe | virtual pipes: shallow-water flux between cells with suspended sediment and a capacity limit |
| Droplet | particle walkers that pick up and drop material, cheap and good for fine gullies |
| Thermal | talus: material moves when a slope passes its angle of repose |
| Mass wasting | slumps with runout and entrainment down the steepest descent path |
| Periglacial | freeze–thaw creep and solifluction, gated by the snow line |
| Glacial | quarrying, abrasion, cirque growth and U-valley shaping driven by ice flux |
| Aeolian | saltation, creep, ripple formation and slip-face avalanche |
| Coastal | wave abrasion, undercutting, beach and stack formation |
| Karst | chemical dissolution along a fracture lattice — sinkholes, towers, karst plains |

Erosion passes are mass-conserving except where material genuinely leaves the
map: sediment exported off the edge, dissolved rock carried away in solution,
and sediment pushed offshore. Anything that appears in "cut" but not "fill" is
one of those three.

## Masks

Any layer — height or satmap — can be masked by a terrain attribute, so the
same erosion can attack cliffs but not valleys. Masks include height band,
slope, aspect, mountain falloff (smooth falloff from the summits, so a layer
breaks into isolated peaks instead of blanketing the range), coastal falloff,
stratify (banding by position in the geological stack), rift lines, cliff
faces, rivers, protrusion, curvature, sedimentation, erosion, snow, wetness,
roughness, sea, radial and noise.

## Satmaps

A "satmap" here is not satellite imagery. Each satmap layer picks a **terrain
attribute** from a dropdown and paints a colour ramp across it:

- **Shape** — height, protrusion, stratification
- **Surface** — slope, aspect, curvature, roughness, occlusion
- **Hydrology** — flow accumulation, river channels, wetness
- **Simulation** — sedimentation, erosion
- **Climate** — snow cover, submerged
- **Procedural** — noise field, fine grain, cellular patches (generators you
  can paint with, unattached to the terrain)
- **Utility** — constant

Layers composite bottom-up with normal / multiply / overlay / soft-light /
screen blending, and each carries its own mask, black and white point, gamma,
detail mix, grain and slope falloff. Because the inputs are measured from your
terrain, the texture follows when the terrain changes.

## Presets

Sandstone canyons, sandstone cliffs, coastal cliffs, Himalayan range,
Icelandic basalt, Alps, snowy mountains, rugged outcrops, desert dunes and
rocky desert. Each one is a complete, hand-tuned stack — a starting point, not
a locked recipe.

## Performance

The pipeline runs in a worker. It keeps a checkpoint after every layer, caches
generated fields and caches the satmap composite, so nudging a slider near the
top of the stack only recomputes what follows it. `Math.pow` on the hot paths
is replaced with tabulated powers (`src/engine/fastmath.ts`), which is worth
several seconds per pass on its own.

Presets open at 256², where the whole stack resolves in about a second. The
inspector can take a scene to 512² or 1024² for a final render.

## Source map

```
src/engine
  rng.ts noise.ts field.ts fastmath.ts   primitives
  params.ts types.ts                    schemas and scene types
  generators.ts filters.ts channels.ts  operations
  masks.ts satmap.ts                    masking and colouring
  erosion/                              one file per process
  pipeline.ts presets.ts registry.ts    composition, presets, exports
  worker.ts useEngine.ts                off-thread compute and React bridge
src/ui                                  stack, stage, inspector, modals
src/styles/app.css                      the whole look
```
