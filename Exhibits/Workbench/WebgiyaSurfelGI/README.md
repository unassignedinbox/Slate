# Webgiya Surfel GI · ShaderBalls · No Shadow Maps

Open `index.html` over HTTP. It redirects to the checked-in production build in `site/`.

This exhibit is a scene-level adaptation of Jure Triglav's MIT-licensed [Webgiya](https://github.com/jure/webgiya) at commit `0cd7f96859adc34e181f34a5d804e53fa94799cb`. The surfel GI implementation is not a lookalike or rewrite: the upstream compute pipeline and its constants are copied unchanged.

## Exact implementation boundary

A directory comparison against the pinned upstream commit reports only:

- `src/content.ts` — the preset list selects the ShaderBall light lab.
- `src/shaderBallScene.ts` — new scene adapter and exact `SBM1` ShaderBall decoder.

Every upstream GI, BVH, hash-grid, radial-depth, allocation, aging, integration, resolve, G-buffer, renderer, lighting, material, and debug source file is byte-for-byte unchanged. `VerifyUpstream.sh` validates 117 copied source files against `UPSTREAM_SHA256SUMS`. `Source.html`, package metadata, and Vite output configuration are packaging/UI changes outside the GI algorithm.

## Upstream Webgiya pipeline preserved

Each frame runs Webgiya's original sequence:

1. Raster G-buffer.
2. Prepare the fixed-capacity surfel pool.
3. Find screen-space regions missing surfels.
4. Allocate and seed surfels.
5. Age, recycle, and compact the pool.
6. Build the eight-cascade spatial hash grid.
7. Trace per-surfel rays through the CPU-built/GPU-uploaded scene BVH.
8. Update sample-guiding lobes, temporal irradiance moments, and each surfel's MSM4 radial-depth tile.
9. Gather nearby surfels per pixel with spatial, normal, variance, and radial-visibility weighting.
10. Composite direct and indirect lighting.

Desktop settings retain upstream's `262144`-surfel pool, 32³ hash-grid cascades, 4×4 radial-depth tiles, 32 target samples, and four base integration samples.

## Slate scene adaptation

- Four copies of `Exhibits/Assets/ShaderBall/ShaderBall.mesh` use the exact shared indexed geometry. The public and built copies have the same SHA-256: `67ab71ee998bb17dc1949c038c2eaeccd4cea8b06a2209dd812839c455e75f4f`.
- The ShaderBalls and surrounding colour lab are static so the exact upstream BVH remains valid.
- Raster shadow maps are deliberately disabled for every mesh and for the directional light. There is no hidden shadow-map pass in this scene.
- Webgiya's original animated directional-light path is enabled by default. The orbiting light is passed into the unchanged surfel integrator each frame; secondary-hit sun visibility is evaluated with the triangle BVH, so direct-bounce and multi-bounce irradiance remain ray traced.
- The original inspector exposes direct/indirect/combined output, surfels, irradiance, variance, cascades, hash-grid cells, radial occlusion, sample count, transport strength, and light animation controls. Select **GI → Output → Indirect** to inspect only the surfel result.

## Requirements and running

A browser with WebGPU and sufficient storage-buffer limits is required. From the repository root:

```bash
python3 -m http.server 8000
# Open /Exhibits/Workbench/WebgiyaSurfelGI/
```

To rebuild the checked-in static application:

```bash
cd Exhibits/Workbench/WebgiyaSurfelGI
npm ci
npm run build
```

## Attribution

Webgiya is Copyright © 2026 Jure Triglav and is used under the MIT license in `LICENSE`. The vendored, upstream-modified `three-mesh-bvh` carries its own MIT license under `src/external/three-mesh-bvh/LICENSE`. See `UPSTREAM_README.md` and `SOURCES.md`.
