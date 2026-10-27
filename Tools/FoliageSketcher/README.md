# Foliage Sketcher

A procedural plant and foliage generator with GPU filament physics, built as a WebGL2 prototype of the
Frontier C++/Vulkan feature. It grows ferns, vines, flowering plants and trees onto a procedurally cut
leaf sheet, scatters them into an overgrown plot, and solves every skeleton on the GPU so the foliage
reacts to objects pushed through it.

The WebGL implementation exists so the design can be seen running and tuned against real numbers before
it is ported. It follows the same law as the engine: `CLAUDE.md` naming and formatting, the Slate UI kit,
right-handed **+Z up** world space, and `.toml` descriptors.

---

## Running it

```bash
node Tools/FoliageSketcher/Build/SheetSequence.mjs     # ① bake the sheet (≈9 s, once)
node Tools/FoliageSketcher/Build/PreviewHost.mjs 8080  # ② serve the demo
```

Then open `http://localhost:8080/`.

`SheetArchives/` is generated output and is not committed — stage ① recreates it deterministically from
the plates in `Content/PlateArchives/`, which are committed.

**Controls** — LMB orbit · RMB/MMB pan · wheel dolly · drag the sphere to push the plants ·
`Space` gust · `R` reseed · `F` frame.

---

## Layout

| Path | Role |
|------|------|
| `Build/SheetSequence.mjs` | Offline 8-stage sheet bake: key → cut → classify → pack → derive → dilate → emit. |
| `Build/PortableNetworkCodec.mjs` | Dependency-free PNG encode/decode over Node `zlib`. |
| `Build/PreviewHost.mjs` | Static dev host for `Source/`, `Shaders/`, the sheets and the engine fonts. |
| `Content/PlateArchives/` | Source photoscan plates (committed). |
| `Content/SheetArchives/` | Baked sheet + `FoliageSheet.toml` (generated, ignored). |
| `Source/SpeciesCriteria.mjs` | Archetypes, tunable declarations, defaults. |
| `Source/GrowthSolver.mjs` | CPU growth: skeleton, bark tubes, leaf cards. |
| `Source/FilamentSolver.mjs` | GPU physics residency and the step schedule. |
| `Source/FoliageProjection.mjs` | Instanced draw of cards, tubes, ground, sky, colliders. |
| `Source/SheetIndex.mjs` | Loads the sheet and exposes cutouts by family. |
| `Source/DocketPanel.mjs` | The Slate docket UI. |
| `Source/SketcherHost.mjs` | Entry point; owns the frame loop. |
| `Shaders/` | GLSL for the two solver phases and the five raster phases. |

---

## The physics

One texel per joint, positions in `RGBA32F` lattices, Verlet integration followed by N Jacobi constraint
iterations, ping-ponged between two lattices. Nothing about a plant's motion touches the CPU: growth
uploads a rest pose once, and every subsequent frame is solver plus draw.

Per step: **integrate** (gravity, wind, flutter, contact damping) → **constrain** ×`Iterations`
(distance, bend, collider projection, trunk self-collision, anchor pull, ground).

Four properties were established by measuring the solver rather than by eye, and each is load-bearing:

**Corrections are averaged, not summed.** A trunk joint with six children receives six constraint
corrections in one pass. Applying them all diverges — measured 505 of 1,657 joints non-finite and a
plant 1.076 × 10¹¹ m tall. Dividing by the contributor count is what makes an order-free parallel solve
stable.

**The bend constraint is symmetric.** A child rotating toward its rest angle must push back on its
parent. Without the reaction half the constraint manufactures angular momentum, and the error compounds
with branch depth: on a weightless plant that should not move at all, drift measured 0.13 m at one
branch order and **9.72 m at three**. With the reaction term the same plant holds to 0.0012 m.

**Bend is compensated for the iteration count; distance is not.** Bend is a material property, so the
same vine must feel the same at 6 and at 36 projections — a raw coefficient turns rope into steel and
the surplus energy shows up as growing oscillation. Distance is a hard geometric constraint: a stem does
not stretch, so extra iterations must converge it rather than soften it.

**Anchor pull is a rate per second.** Bend only restores angles *relative to the parent*, so a plant
shoved over is perfectly self-consistent in its new leaning shape and never stands back up. A weak
spring toward the grown pose supplies the missing reason. Treating its coefficient as per-step made it
100 % per second at 60 Hz, which nailed every joint to its rest pose and killed the wind entirely.

Solver quality is exposed in the Physics tab (`Iterations`, `Substeps`, `Relaxation`, `Recovery`).
At 6 iterations a 12 m canopy settles 1.9 m below its rest pose because Jacobi has not converged; at
12 × 3 the residual is ~0.02 m, which is real gravity droop rather than solver error.

---

## The sheet

`SheetSequence.mjs` cuts 53 cutouts from six plates and packs them into one 2048² sheet with 10 px
gutters and 12 rings of colour dilation, so nothing bleeds under minification. Each cutout carries its
petiole `anchor`, its `tip`, its fill ratio and its mean tint, which is what lets the growth stage
attach a leaf by its stem instead of by its centre.

Classification is by shape first, then colour. A tendril is a thin sparse wisp that is mostly stem, so
its mean colour is barely green — testing colour first files every tendril as a bloom and empties the
family. Thresholds come from the plates' own measurements.

Surface channels are **R** roughness, **G** ambient occlusion, **B** translucency.

---

## Porting notes

The WebGL2-specific decisions are deliberately confined:

- **Clip space.** WebGL is z ∈ [−1, 1], Vulkan is z ∈ [0, 1]. Isolated to `Perspective()` in
  `OrbitProjection.mjs` — the single swap point.
- **Solver phases are fragment shaders** writing to lattices because WebGL2 has no compute. Both map
  directly to compute kernels with `SSBO`s; the per-joint records already have the layout of a
  `std430` struct.
- **Naming already conforms.** Module roles are drawn from the authorized suffix list, so the C++
  translation units keep their names.
