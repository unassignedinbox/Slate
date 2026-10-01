# Upstream algorithm-parity map

The requested reference is W298/SurfelGI at `8361942f7d799632b32d37356b8057814456a8a2`.  This table makes the port boundary explicit instead of hiding a smaller technique behind the same name.

| Upstream unit | Experimental equivalent | Preserved behaviour |
|---|---|---|
| `SurfelPreparePass.cs.slang` | `Shaders/SurfelPrepare.comp.glsl` | valid → dirty list transfer; frame counters reset |
| `SurfelUpdatePass.cs.slang: collectCellInfo` | `Shaders/SurfelCollectCells.comp.glsl` | lifetime, sleeping / last-seen flag, adaptive 4–64 ray allocation, 125-cell coverage count |
| `SurfelUpdatePass.cs.slang: accumulateCellInfo` | `Shaders/SurfelPrefixCells.comp.glsl` | per-cell append-range allocation and reservation reset |
| `SurfelUpdatePass.cs.slang: updateCellToSurfelBuffer` | `Shaders/SurfelScatterCells.comp.glsl` | cell → surfel list population |
| `SurfelRayTrace.rt.slang` | `Shaders/SurfelTraceCwbvh.comp.glsl` | cosine rays, six-step diffuse path, direct-light visibility, surfel-radiance termination, reference counters, miss-bounce telemetry |
| `SurfelIntegratePass.cs.slang` | `Shaders/SurfelIntegrate.comp.glsl` | `1 / (16πpdf)` estimate, 7×7 octahedral depth moments, irradiance sharing, MSME |
| `SurfelGenerationPass.cs.slang` + `SurfelEvaluationPass.cs.slang` | `Shaders/SurfelGenerateEvaluate.comp.glsl` | weighted gather, blending delay, last-seen write, coverage-driven spawn / removal, free list |
| Falcor resource allocation / execute order | `SurfelGI.{h,cpp}` + `VulkanIntegration.md` | reference sizes, resource accounting, pass sequence, memory barriers |

## Intentional portability substitutions

These are backend substitutions, not reduced budgets or a different GI technique:

1. **DXR `TraceRay()` → CWBVH compute traversal.** The trace pass includes Slate's `TraversalCWBVH.slang`, operates on the existing CWBVH node/leaf SSBOs, and uses `TraverseClosest` / `TraverseOccluded`.  No RTX capability is requested.
2. **Falcor packed hit buffer → Slate R2 surface resolve.** The generate/evaluate pass reads Slate's world-position, normal, packed-visibility, and depth outputs.  Spawned surfels retain Slate's packed visibility token in `GeometryBuffer`.
3. **Falcor analytic lights → Slate emissive luminaires.** Slate's current resident scene provides emissive triangle luminaires, so the portable trace pass samples those rather than Falcor analytic-light objects.  Both paths sample one visible direct-light candidate per hit.
4. **Diffuse lobe only.** The upstream ray pass explicitly sets the active lobes to `Diffuse` before sampling the next ray.  The portable trace pass uses the resident material header's linear base colour as that diffuse lobe.  Textured/OpenPBR slab evaluation is deliberately left at the same integration boundary as the existing Slate path tracer; it is not silently replaced with a different GI cache.

## Not an optimisation profile

The substitutions above do not reduce `150,000` surfels, `9,600,000` ray-result records, `250³` cells, the 125-cell list capacity, the 7×7 moment atlas, 4–64 adaptive rays, or the six-step path bound.  A future GTX-focused profile may change those values only under a separately named optimisation change.
