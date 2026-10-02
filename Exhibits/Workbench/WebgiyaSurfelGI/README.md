# Webgiya Dynamic Multi-bounce Surfel GI

Open `index.html` over HTTP. It redirects to the checked-in production build in `site/`.

This exhibit preserves Jure Triglav's MIT-licensed [Webgiya](https://github.com/jure/webgiya) implementation at commit `0cd7f96859adc34e181f34a5d804e53fa94799cb`, uses the shared Slate ShaderBalls, and renders indirect illumination exclusively through Webgiya's persistent world-space surfel cache. It retains 1K direct shadows, a restrained GTAO visibility raster, multi-bounce transport, and the dynamic rigid BLAS/TLAS extension.

There is no screen-space GI estimator, screen-probe reconstruction, ReSTIR reservoir, temporal surface-history pass, Hi-Z ray traversal, or ray-hit surfel allocator in the active source or frame loop.

## Exact implementation boundary

`VerifyUpstream.sh` validates 117 copied upstream files against `UPSTREAM_SHA256SUMS`. The original `main.ts`, surfel integrator, BVH, hash grid, radial depth, allocation, aging, resolve, renderer, lighting, materials, and debug implementation remain byte-for-byte identical.

The adaptation is isolated to:

- `content.ts` — selects the ShaderBall light lab.
- `shaderBallScene.ts` — exact `SBM1` decoder, shared scene geometry, one marked rigid object, original-style directional shadows, and low-frequency hemisphere ambient light.
- `sceneBvhDynamic.ts` — a derived immutable static BLAS plus canonical local dynamic BLAS and compact TLAS, with transform-only per-frame refits.
- `mainVisibility.ts` — a derived surfel-only host that adds dynamic-acceleration selection and a Three.js GTAO visibility raster while retaining Webgiya's surfel frame sequence.
- `Source.html` and build files — packaging and explanatory UI.

The pinned `sceneBvh.ts` remains the exact merged-static fallback and is selected when **Dynamic BLAS / TLAS** is disabled.

## Surfel-only indirect lighting

Webgiya's existing screen-space missing-surfel finder creates persistent world-space surfels from visible surfaces. The cache is stored in the fixed-capacity pool, binned into the cascaded spatial hash grid, integrated by BVH rays, and resolved at full raster resolution using spatial, normal, variance, and MSM4 radial-visibility weighting.

No second GI estimator replaces or blends over this result. **GI → Indirect** displays the surfel resolve directly, and **GI → Combined** adds that same surfel result to rasterized direct illumination.

Desktop settings retain the upstream limits:

- 262,144 surfels;
- 32³ hash-grid cascades;
- 4×4 MSM4 radial-depth tiles;
- 32 target temporal samples; and
- four base integration rays by default.

## Multi-bounce GI

Multi-bounce transport is enabled by default. At each secondary BVH hit, Webgiya gathers the previous temporal surfel irradiance field, applies the hit albedo, and writes the result into the next double-buffered moments region. Repeating this recurrence carries second and later diffuse bounces through the persistent cache without a screen-space lighting pass.

The pinned integrator algorithm is unchanged. The host only exposes its existing direct-to-indirect and indirect-to-indirect scales as explicit controls.

## Dynamic rigid BLAS/TLAS

The green ShaderBall is a true rigid dynamic object using the same shared canonical indexed geometry as the other ShaderBalls. `sceneBvhDynamic.ts` excludes it from the immutable merged static BLAS, builds its local BLAS once, and places both roots beneath a compact TLAS.

Rigid animation updates only the moving object's transformed vertex/normal stream and world-space BLAS bounds. BLAS topology and triangle ordering are never rebuilt. Changed TLAS bounds and dynamic data ranges are uploaded before surfel ray integration, so indirect rays, direct-light visibility rays, and radial-depth learning observe the current rigid transform.

Only one 67,832-triangle ShaderBall moves by default. This keeps CPU refit and upload costs bounded for the GTX 1650 Super 4 GB target. Disabling **Dynamic BLAS / TLAS** reloads the exact pinned merged-static `sceneBvh.ts` path and holds all ShaderBalls at their base transforms.

## Lighting and visibility

The final image combines three inspectable systems:

1. **Direct shadows** — a 1024² PCF-soft directional shadow map, including the animated directional light and full ShaderBall geometry.
2. **Webgiya surfel visibility** — triangle-BVH rays for secondary hits and light visibility, plus MSM4 radial-depth occlusion for surfel-to-surfel and surfel-to-pixel leak rejection.
3. **Visibility raster / AO** — half-resolution, twelve-sample Ground Truth Ambient Occlusion from camera depth and view-space normals. It is strongest on indirect and ambient illumination and intentionally quarter-strength on direct light to avoid double-darkening sunlight.

GTAO is a presentation visibility layer, not another GI estimator. All indirect radiance still comes from the surfel cache.

## Controls

The **Dynamic rigid geometry** folder exposes:

- **Dynamic BLAS / TLAS** — use the dynamic accelerator or reload the exact merged-static fallback.
- **Animate rigid BLAS** — animate the green shared-geometry ShaderBall or return it to its base transform.
- **Motion amplitude** — vertical excursion plus restrained lateral and rotational motion.
- **Motion speed** — transform animation speed without rebuilding BLAS topology.

The **Visibility raster / AO** folder exposes:

- **Ambient Occlusion** — enable or bypass GTAO in the final composite.
- **Output** — show normal lighting or the grayscale visibility raster.
- **AO Strength** — contribution to indirect and ambient lighting.
- **AO Radius** — camera-space contact radius.
- **AO Samples** — quality/performance control from 4 to 24 samples.

The **Integrator** folder exposes:

- **Base Samples** — surfel integration ray count.
- **Env GI Intensity** and **Env GI LOD** — environment contribution controls.
- **Multi-bounce GI** — recurrent indirect-to-indirect surfel transport.
- **First-bounce Strength** — direct illumination injected at secondary hits.
- **Multi-bounce Strength** — previous-frame surfel irradiance fed into later bounces.
- **GI Albedo Boost** — material response control for the integrator.

Existing useful views remain available:

- **GI → Output → Direct / Indirect / Combined**
- **Debug → Surfels / Irradiance / Variance / Cascades / Radial Occlusion**
- **Occlusion → Strength / Bleed reduction / Grazing bias / Variance bleed**

## Frame pipeline

Each frame follows the surfel-only path:

1. Update the rigid transform, refit only its dynamic BLAS data, and propagate TLAS bounds.
2. Raster normal, albedo, and depth for surfel spawning and resolving.
3. Prepare the fixed-capacity surfel pool.
4. Find visible regions missing surfels using Webgiya's original screen-space creation algorithm.
5. Age, recycle, and compact the existing cache.
6. Allocate requested surfels through the original pool stack.
7. Rebuild the cascaded surfel hash grid.
8. Trace and integrate per-surfel BVH rays.
9. Update guiding lobes, temporal irradiance moments, and MSM4 radial-depth tiles.
10. Resolve nearby persistent surfels per pixel.
11. Composite raster shadows, surfel indirect light, ambient visibility, and the final image.

No screen probes, temporal lighting reservoirs, or secondary screen-space reconstruction passes run before compositing.

## ShaderBall scene

- Four copies of `Exhibits/Assets/ShaderBall/ShaderBall.mesh` use the exact shared indexed geometry.
- Three ShaderBalls and the colour laboratory remain in the immutable static BLAS.
- The green ShaderBall uses one canonical local BLAS beneath the TLAS and animates rigidly.
- The directional light animates by default so the surfel cache's response remains visible.
- A restrained hemisphere light supplies ambient fill; GTAO and surfel radial visibility preserve contact depth.

ShaderBall SHA-256:

`67ab71ee998bb17dc1949c038c2eaeccd4cea8b06a2209dd812839c455e75f4f`

## Running and rebuilding

A browser with WebGPU and sufficient storage-buffer limits is required.

```bash
python3 -m http.server 8000
# Open /Exhibits/Workbench/WebgiyaSurfelGI/
```

```bash
cd Exhibits/Workbench/WebgiyaSurfelGI
npm ci
npm run build
```

## Attribution

Webgiya is Copyright © 2026 Jure Triglav and is used under the MIT license in `LICENSE`. The vendored, upstream-modified `three-mesh-bvh` carries its own MIT license under `src/external/three-mesh-bvh/LICENSE`. See `UPSTREAM_README.md` and `SOURCES.md`.
