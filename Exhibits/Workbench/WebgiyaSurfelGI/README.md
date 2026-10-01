# Webgiya Surfel GI · Shadows + Visibility Raster

Open `index.html` over HTTP. It redirects to the checked-in production build in `site/`.

This exhibit preserves Jure Triglav's MIT-licensed [Webgiya](https://github.com/jure/webgiya) at commit `0cd7f96859adc34e181f34a5d804e53fa94799cb`, uses the shared Slate ShaderBalls, restores the upstream direct-shadow presentation, and adds a separately controlled camera-space ambient-visibility raster.

## Exact implementation boundary

`VerifyUpstream.sh` validates 117 copied upstream files against `UPSTREAM_SHA256SUMS`. The original `main.ts`, surfel integrator, BVH, hash grid, radial depth, allocation, aging, resolve, renderer, lighting, materials, and debug implementation remain byte-for-byte identical.

The adaptation is isolated to:

- `content.ts` — selects the ShaderBall light lab.
- `shaderBallScene.ts` — exact `SBM1` decoder, scene geometry, original-style directional shadows, and low-frequency hemisphere ambient light.
- `mainVisibility.ts` — a derived host that retains the upstream frame sequence and adds a Three.js GTAO visibility raster during final composition.
- `Source.html` and build files — packaging and explanatory UI.

## Lighting and visibility layers

The final image now combines three different, inspectable visibility systems:

1. **Original direct shadows** — Three.js' 4096² PCF-soft directional shadow map, including the animated directional source and full ShaderBall geometry.
2. **Webgiya surfel visibility** — triangle-BVH rays for secondary hits and light visibility, plus MSM4 radial-depth occlusion for surfel-to-surfel and surfel-to-pixel leak rejection.
3. **Visibility raster / AO** — a half-resolution, twelve-sample Ground Truth Ambient Occlusion raster generated from camera depth and view-space normals. It is strongest on indirect/ambient illumination and intentionally only quarter-strength on direct light to avoid double-darkening sunlight.

Upstream Webgiya does not contain a separate conventional SSAO/GTAO pass; its native occlusion is the radial surfel system. The added GTAO layer supplies the small-scale contact visibility that can fall below the surfel radius.

## Controls

The inspector retains all upstream controls and adds **Visibility raster / AO**:

- **Ambient Occlusion** — enable or bypass the GTAO contribution.
- **Output** — show normal lighting or the grayscale visibility raster directly.
- **AO Strength** — contribution to indirect/ambient lighting.
- **AO Radius** — camera-space contact radius.
- **AO Samples** — quality/performance control from 4 to 24 samples.

Existing useful views remain available:

- **GI → Output → Direct / Indirect / Combined**
- **Debug → Surfels / Irradiance / Variance / Cascades / Radial Occlusion**
- **Occlusion → Strength / Bleed reduction / Grazing bias / Variance bleed**

## Upstream pipeline preserved

Each frame still runs Webgiya's original sequence:

1. Raster G-buffer.
2. Prepare the fixed-capacity surfel pool.
3. Find screen-space regions missing surfels.
4. Allocate and seed surfels.
5. Age, recycle, and compact the pool.
6. Build the eight-cascade spatial hash grid.
7. Trace per-surfel rays through the CPU-built/GPU-uploaded scene BVH.
8. Update sample-guiding lobes, temporal irradiance moments, and each surfel's MSM4 radial-depth tile.
9. Gather nearby surfels per pixel with spatial, normal, variance, and radial-visibility weighting.
10. Composite direct shadows, indirect light, ambient visibility, and the final image.

Desktop settings retain upstream's `262144`-surfel pool, 32³ hash-grid cascades, 4×4 radial-depth tiles, 32 target samples, and four base integration samples. GTAO runs at half resolution for GTX-class performance.

## ShaderBall scene

- Four copies of `Exhibits/Assets/ShaderBall/ShaderBall.mesh` use the exact shared indexed geometry.
- The ShaderBalls and colour laboratory remain static so the exact upstream triangle BVH remains valid.
- The original animated directional-light path is enabled by default.
- A restrained hemisphere light supplies ambient fill; GTAO and surfel radial visibility prevent it from flattening contacts.

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
