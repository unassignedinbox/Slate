# Material ↔ ReSTIR plan — M8 status and remaining work

Date: 2026-09-17
Baseline: R4b shading / content interchange
M8 reference: `1872def` on `arena/01a0aa50-slate` (102/102 gate)

## M8 result

M8 closed the Tier-B question with full-scene validation. The recommended decision is **keep Tier A + fold**:
real scene content is single-slab, and the existing `slab_limit` fold path is deterministic and reviewable. There is
no reason to pay for a multi-slab kernel until a real asset requires it.

The material data contract already has the OpenPBR slab values and sixteen bindless texture slots. The remaining
work is not another record-format rewrite; it is to make the channels visible in selection, resolution, shading, and
Project-Zero proof content.

## Remaining after M8

### M9 — ReSTIR re-enable and validation

1. Re-enable temporal reprojection and the à-trous denoiser after the new lobes have been validated on raw
   accumulation. Keep both switches independently configurable.
2. Run an A/B convergence proof: raw accumulation and temporal-plus-denoised accumulation must converge to the same
   image within the documented tolerance; reject history on depth, normal, visibility/material id, and motion-vector
   disagreement.
3. Add an outdoor, sky-backed clear-glass proof. The existing Cornell / area-light proof remains the deterministic
   reference; it must not be replaced by the prettier scene.
4. Re-run the material grid through direct lighting, the shadow walk, and the one-bounce GI path. Record the simple,
   single, complex, and special material costs on the F3 diagnostics surface.

### Material-channel completion

The implementation in this change makes the twenty semantic channels explicit and carries them through the resident
material record without dropping authored values:

1. base colour
2. metallic
3. roughness
4. reflectance / IOR
5. surface orientation
6. ambient occlusion
7. emission
8. opacity / cutout
9. anisotropy
10. anisotropy direction
11. clear coat
12. clear-coat roughness
13. clear-coat orientation
14. sheen colour
15. sheen roughness
16. subsurface colour
17. subsurface thickness / radius
18. transmission
19. IOR / refraction
20. displacement (retained as an acknowledged future height/bump channel; no tessellation stage yet)

The existing texture-channel enum remains the storage ABI (16 slots); the semantic enum is the authoring/reporting
ABI. Selection is derived per material, not per texel, and is packed into spare `MaterialRecord.Flags` bits. This
prevents unused channels from being silently discarded while keeping the 64-byte header stable.

### Known, intentionally deferred gaps

- true geometric displacement (no tessellation stage; height-to-bump may be added later);
- nested dielectrics and volumetric interiors;
- spectral dispersion hero sampling (the Abbe/dispersion values are retained);
- glints (`slate_glint_*` is retained but remains gated off);
- Tier-B multi-slab evaluation (revisit only when a real asset has multi-slab demand);
- full Sultan paint-layer authoring.

## Project-Zero material grid

`--scene materialgrid` now generates an export-once glTF exhibit. Every sphere/card is assigned its own material
index and its own descriptor; no material is shared between cells. The grid includes authored archetypes such as
plastic, bone, clear coat, glossy glass, clear glass, gold/silver/copper/iron/brushed metals, rubber, ceramic,
velvet, wax/skin subsurface, thin-film, haziness, emissive, unlit, and alpha-cutout. The grid is loaded through the
same codec, `MaterialIndex`, bindless texture path, visibility raster, and ReSTIR kernel as any other Project-Zero
scene.

The grid is a proof exhibit, not a substitute for Sponza or Cornell. Its acceptance checks are:

- unique descriptor and material id per cell;
- every channel-bearing archetype survives decode and `Finalise(1)`;
- transmission, subsurface, coat, anisotropy, sheen, emission, opacity, and IOR are visible in the census;
- no folds for the authored one-slab grid;
- the existing Cornell reference remains unchanged.

## Order

1. Land the semantic channel/selection ABI and resolver wiring.
2. Land the Project-Zero material grid and export-once entry point.
3. Re-enable M9 history/denoise and run the A/B + outdoor glass gate.
4. Revisit deferred gaps only when an acceptance scene requires them.
