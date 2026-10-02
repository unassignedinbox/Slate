# Baked Global Distance Field GI — ShaderBall Phase

Open `SDFGlobalIllumination.html` over HTTP in a WebGPU-capable browser.

This is a separate exhibit. It does not reuse the surfel, LPV, EEVEE probe, or screen-space GI implementations. Indirect visibility comes from software sphere tracing through a deterministic baked global signed-distance field. The raster scene now uses four instances of the repository's exact 67,832-triangle ShaderBall mesh, and those same instances are composed into the global SDF.

## Mesh-SDF bake

`BakeShaderBallSDF.mjs` converts `Exhibits/Assets/ShaderBall/ShaderBall.mesh` from Z-up to Y-up and produces one canonical `96³` mesh distance field:

1. Every indexed triangle is conservatively voxelized into a narrow shell.
2. Each seed retains the continuous closest point on the actual triangle—not merely the integer voxel coordinate.
3. A 3D 27-neighbour Jump Flood Algorithm propagates those sub-voxel seeds with steps `64, 32, 16, 8, 4, 2, 1`.
4. A second step-one JFA+ correction pass reduces jump-flood discontinuities.
5. A boundary flood fill classifies the exterior and gives disconnected closed ShaderBall parts a stable sign.
6. Each voxel performs a final exact triangle closest-point refinement using its propagated triangle and neighbouring JFA candidates.
7. The signed result is stored as binary16 in `ShaderBallSDF.bin` and sampled trilinearly during global composition.

The combination of sub-voxel seeds, JFA+, exact triangle refinement, trilinear composition, and runtime central-difference normals avoids the blocky silhouette and faceted gradients produced by a simple occupancy distance transform.

## Global-field pipeline

1. `BakeGlobalSDF.mjs` unions the analytic room with four transformed samples of the canonical ShaderBall mesh SDF.
2. `GlobalSDF.bin` stores a `160×80×160` binary16 base field and seven lower analytically recomposed distance levels. At roughly `0.11 m` per base voxel, the global field preserves the canonical ShaderBall silhouette while remaining practical for the 4 GB target.
3. The artifact also stores a base-resolution RGBA8 material field containing linear albedo and an emissive mask.
4. The browser uploads the baked data as a mipmapped `r16float` 3D texture and an `rgba8unorm` 3D material texture.
5. A compute pass identifies the narrow SDF surface band, derives normals from the global field, and writes outgoing radiance into a `160×80×160 RGBA16F` global surface-radiance cache. With light animation disabled, this cache updates only when its source parameters change.
6. A conventional raster G-buffer supplies only the current receiver position, normal, and albedo. The exact same ShaderBall mesh and transforms are used for rasterization and SDF composition.
7. At half resolution, one to eight cosine-distributed rays per receiver sphere-trace the global SDF. Directions are keyed to coarse world-space cells so camera motion cannot reshuffle a pixel-space noise pattern. Distance-adaptive mip selection accelerates empty-space traversal; candidate hits return to mip zero before acceptance.
8. Accepted world-space hits sample the global surface-radiance cache. Rays leaving the baked world sample a low-intensity environment.
9. The composite multiplies incoming indirect radiance by receiver albedo and combines it with the raster direct term.

A bounded incoming-radiance estimator suppresses isolated emissive fireflies without temporal history. There is no screen-space temporal denoiser.

The camera G-buffer supplies visible receivers, exactly as a deferred renderer must, but it is never searched for ray hits. Every secondary hit, miss, and occlusion decision comes from `GlobalSDF.bin`; the surface-radiance cache supplies lighting only after a GDF hit has been validated.

## Relationship to Lumen

The architectural correspondence is deliberate but bounded:

- a reusable per-mesh distance field is composed into a global world field;
- software rays traverse distance data rather than screen-visible depth;
- hit lighting lives in a separate surface-radiance cache; and
- coarse global-distance levels accelerate traversal before mip-zero validation.

This is not presented as a reproduction of Unreal Engine Lumen. Lumen builds camera-centred global-distance-field clipmaps, maintains a card-based surface cache, combines several tracing representations, schedules partial updates, and applies extensive reconstruction. This exhibit uses a static bounded global field and a dense voxel radiance cache so every stage remains inspectable.

## Deliberately deferred: SDF shadows

No source-to-surface SDF shadow ray is issued yet. Both visible direct lighting and radiance-cache sun injection are intentionally unshadowed. The global SDF currently affects **indirect receiver-to-hit visibility only**.

The next phase can add SDF shadows as a separate query without changing or disguising the GI tracer.

## Controls

- **Lighting / Global GI / Direct / Trace cost** — dashboard views of combined lighting, SDF indirect, unshadowed direct, or normalized sphere-trace cost.
- **GI rays** — one to eight half-resolution, world-locked cosine rays per receiver.
- **GI intensity** — scales only the SDF-derived indirect contribution.
- **Trace distance** — maximum world-space sphere-trace reach.
- **Sun strength** — updates raster direct light and the global surface-radiance cache.
- **Animate injection** — rotates unshadowed source radiance; disabled by default for a stable inspection image.
- **Reset camera** — restores the default orbit. Drag to orbit and use the wheel to dolly.

## Bake reproducibility

```bash
cd Exhibits/Workbench/SDFGlobalIllumination
node BakeShaderBallSDF.mjs
node BakeGlobalSDF.mjs
```

Both bakes are deterministic and dependency-free. Current artifacts:

- `ShaderBallSDF.bin`: `1,769,536` bytes, SHA-256 `a573d5b0bd24a409e8cd212075555bb2d35afa07644dd3879b32e4e460e6db9b`
- `GlobalSDF.bin`: `12,873,302` bytes, SHA-256 `a1efae8aba3414ec7fdfa0c1e57f383ddd5b000dbc22b7cef3660d90a4762a74`

The matching metadata JSON files record source triangle count, method, bounds, resolutions, composition, and hashes.

## Current limitations

- ShaderBall transforms are static in this baked phase.
- One bounded global volume rather than camera-centred clipmaps.
- Diffuse one-bounce transport plus environment misses; no glossy reflection path.
- Dense radiance voxels instead of Lumen cards.
- No temporal denoiser or screen-space hit fallback.
- No source visibility or SDF shadows until the next phase.
- Features substantially thinner than one global base voxel (`≈0.11 m`) can still disappear after global composition even though the canonical mesh SDF is much finer.

These limits are intentional for the GI-only milestone and GTX 1650 Super 4 GB target.
