# Webgiya Surfel GI · ShaderBall Dynamics

Open `index.html` over HTTP. It redirects to the checked-in production build in `site/`.

This exhibit preserves Jure Triglav's MIT-licensed [Webgiya](https://github.com/jure/webgiya) at commit `0cd7f96859adc34e181f34a5d804e53fa94799cb`, then adds an explicitly separated GTX-oriented rigid-dynamics path. Choose either mode from the scene selector:

- **ShaderBall Rigid Dynamics · GTX** — eight moving full-resolution ShaderBalls, static-world BVH plus analytic dynamic proxies, swept-surface surfel invalidation, and two base samples.
- **ShaderBall Light Lab · Exact Static** — the original exact Webgiya integrator over a static four-ShaderBall BVH with four base samples.

## Exact implementation boundary

`VerifyUpstream.sh` validates 117 copied upstream files against `UPSTREAM_SHA256SUMS`. The original `main.ts`, `surfelIntegratePass.ts`, BVH, hash-grid, radial-depth, allocation, aging, resolve, renderer, lighting, materials, and debug implementation remain byte-for-byte identical.

Scene and extension files are deliberately separate:

- `content.ts` — selects the two Slate presets.
- `shaderBallScene.ts` — exact static comparison scene.
- `mainDynamic.ts` — host orchestration for selecting the exact or extended path.
- `dynamicShaderBallScene.ts` — moving ShaderBall scene and trajectories.
- `dynamicRigidState.ts` — eight compact current/previous sphere proxies.
- `dynamicRigidInvalidatePass.ts` — invalidates surfels inside each proxy's swept volume before normal upstream aging/recycling.
- `surfelIntegrateDynamicPass.ts` — a derived integrator that merges analytic rigid-proxy hits with the unchanged static triangle-BVH query.

The extension does not silently relabel sphere proxies as exact ShaderBall triangle intersections. Rasterization and directional shadow maps use the complete 67,832-triangle geometry; indirect BVH visibility uses conservative bounding spheres so rigid motion remains practical on a GTX 1650 Super.

## Upstream Webgiya pipeline preserved

Each frame still runs Webgiya's sequence:

1. Raster G-buffer.
2. Prepare the fixed-capacity surfel pool.
3. Find screen-space regions missing surfels.
4. Allocate and seed surfels.
5. Age, recycle, and compact the pool.
6. Build the eight-cascade spatial hash grid.
7. Trace per-surfel rays through the scene query.
8. Update sample-guiding lobes, temporal irradiance moments, and each surfel's MSM4 radial-depth tile.
9. Gather nearby surfels per pixel with spatial, normal, variance, and radial-visibility weighting.
10. Composite direct and indirect lighting.

In dynamic mode, the scene query checks the static BVH and eight analytic rigid proxies. Surfel invalidation runs immediately before upstream aging, removing history along each proxy's previous-to-current swept volume. Newly spawned surface surfels can therefore follow moving receivers without leaving long-lived irradiance ghosts.

## GTX 1650 Super budget

The dynamic mode avoids putting eight 67,832-triangle ShaderBalls into the flattened BVH. Their ray representation is only eight 48-byte records, while raster geometry is shared. The dominant allocations remain Webgiya's original 262,144-surfel pool and hash grid. Expected 1080p GPU usage remains roughly 550–850 MiB depending on browser/backend allocations; two base samples are the default.

## ShaderBall asset

The public and built copies match `Exhibits/Assets/ShaderBall/ShaderBall.mesh` exactly:

`SHA-256 67ab71ee998bb17dc1949c038c2eaeccd4cea8b06a2209dd812839c455e75f4f`

## Limits

- Dynamic ShaderBalls are rigid and uniformly scaled.
- Compute visibility uses conservative spheres, not per-triangle TLAS/BLAS instancing.
- Skinned or morphing rigs still require deforming BLAS refit or a dedicated animated proxy system.
- The exact static mode remains available for fidelity comparisons.

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
