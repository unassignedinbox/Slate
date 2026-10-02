# Baked Global Distance Field GI — Phase 1

Open `SDFGlobalIllumination.html` over HTTP in a WebGPU-capable browser.

This is a new exhibit. It does not reuse the surfel, LPV, EEVEE probe, or screen-space GI implementations. Indirect visibility comes from software sphere tracing through a deterministic baked global signed-distance field.

## Phase 1 pipeline

1. `BakeGlobalSDF.mjs` composes twelve static box/sphere object distance functions into one world-space signed-distance field covering `[-9, -0.7, -9]` to `[9, 8, 9]` metres.
2. The checked-in `GlobalSDF.bin` stores a `96×48×96` binary16 base field and six lower exact-resampled mip levels. It also stores a base-resolution RGBA8 material field containing linear albedo and an emissive mask.
3. The browser uploads those baked volumes as one mipmapped `r16float` 3D texture and one `rgba8unorm` 3D texture.
4. A compute pass identifies the narrow SDF surface band, derives its normal from the global field, and writes direct/emissive outgoing radiance into a `96×48×96 RGBA16F` global surface-radiance cache.
5. A conventional raster G-buffer supplies only the current receiver position, normal, and albedo. It is not searched for lighting hits.
6. At half resolution, one to eight cosine-distributed rays per receiver sphere-trace the global SDF. Their sequence is keyed to coarse world-space cells so camera motion cannot reshuffle a pixel-space noise pattern. Distance-adaptive mip selection accelerates empty-space traversal; candidate hits return to mip zero before acceptance.
7. Accepted world-space hits sample the global surface-radiance cache. Rays leaving the baked world sample a low-intensity environment.
8. The full-resolution composite multiplies that incoming indirect radiance by receiver albedo and combines it with the raster direct term.

The tracing directions are deterministic and world-locked by default. A bounded incoming-radiance estimator suppresses isolated emissive fireflies without temporal history. This avoids hiding noise behind a screen-space temporal filter while the core global-field behaviour is being evaluated.

The camera G-buffer supplies the visible receiver position, exactly as a deferred renderer must, but it is never searched for ray hits. Every secondary hit, miss, and occlusion decision comes from the baked global distance field; the surface-radiance cache supplies lighting only after a GDF hit has been validated.

## Relationship to Lumen

The architectural correspondence is deliberate but bounded:

- software ray traversal uses a global distance field rather than screen-visible depth;
- geometry is represented in a shared world-space field;
- hit lighting is separated into a surface-radiance cache rather than encoded in the distance value; and
- coarse distance levels accelerate traversal before a full-resolution hit test.

This is not presented as a reproduction of Unreal Engine Lumen. Lumen builds camera-centred global-distance-field clipmaps from per-mesh distance fields, maintains a card-based surface cache, performs sophisticated update scheduling, combines multiple tracing representations, and applies extensive temporal/spatial reconstruction. Phase 1 uses one static baked world volume and a dense voxel surface cache so each stage remains directly inspectable.

## Deliberately deferred: SDF shadows

No source-to-surface SDF shadow ray is issued in Phase 1. Both the visible direct term and radiance-cache sun injection are intentionally unshadowed. The global SDF currently affects **indirect receiver-to-hit visibility only**.

This boundary is explicit in the UI through **Direct (no shadows)**. The next phase can add SDF shadows as a separate query without changing or disguising the GI tracer.

## Controls

- **Output** — combined lighting, SDF indirect only, unshadowed direct only, or normalized sphere-trace cost.
- **GI rays** — one to eight half-resolution, world-locked cosine rays per receiver.
- **GI intensity** — scales only the SDF-derived indirect contribution.
- **Trace distance** — maximum world-space sphere-trace reach.
- **Sun strength** — updates raster direct light and the global surface-radiance cache.
- **Animate radiance injection** — rotates the unshadowed sun direction to prove that geometry is baked while cached lighting remains dynamic.
- **Reset camera** — restores the default orbit. Drag to orbit and use the wheel to dolly.

## Bake reproducibility

```bash
cd Exhibits/Workbench/SDFGlobalIllumination
node BakeGlobalSDF.mjs
```

The bake is deterministic and has no package dependencies. Current artifact:

- byte length: `2,780,764`
- SHA-256: `04a2fff5c7f39d6161ecc9a0aedaf95bb3be5ce0e76803d97fea159d3995d42c`

`GlobalSDF.meta.json` records the format, bounds, mip dimensions, encoding, and hash.

## Current limitations

- Static primitives only; dynamic objects are not merged into the baked field.
- One global bounded volume rather than camera-centred clipmaps.
- Diffuse one-bounce transport plus environment misses; no glossy reflection path.
- Dense radiance voxels instead of Lumen cards.
- No temporal denoiser or screen-space hit fallback.
- No source visibility or SDF shadows until the next phase.
- Thin geometry below roughly one base voxel (`≈0.19 m`) is not represented reliably.

These limits are intentional for the first GI-only milestone and the GTX 1650 Super 4 GB target.
