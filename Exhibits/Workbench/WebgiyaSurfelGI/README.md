# Webgiya Hi-Z Screen-Probe + Multi-bounce Surfel GI

Open `index.html` over HTTP. It redirects to the checked-in production build in `site/`.

This exhibit preserves Jure Triglav's MIT-licensed [Webgiya](https://github.com/jure/webgiya) at commit `0cd7f96859adc34e181f34a5d804e53fa94799cb`, uses the shared Slate ShaderBalls, retains its persistent multi-bounce surfels, and adds an optional camera-visible screen-probe estimator alongside 1K direct shadows and a GTAO visibility raster.

## Exact implementation boundary

`VerifyUpstream.sh` validates 117 copied upstream files against `UPSTREAM_SHA256SUMS`. The original `main.ts`, surfel integrator, BVH, hash grid, radial depth, allocation, aging, resolve, renderer, lighting, materials, and debug implementation remain byte-for-byte identical.

The adaptation is isolated to:

- `content.ts` — selects the ShaderBall light lab.
- `shaderBallScene.ts` — exact `SBM1` decoder, scene geometry, original-style directional shadows, and low-frequency hemisphere ambient light.
- `hiZDepthPyramid.ts` — conservative min/max depth hierarchy packed into non-aliasing even/odd storage atlases.
- `screenProbePass.ts` — an optional 8×8-tile screen-probe tracer with Hi-Z-first traversal, BVH fallback, diagnostics, and bilateral reconstruction.
- `mainVisibility.ts` — a derived host that retains the upstream frame sequence and composes screen probes plus a Three.js GTAO visibility raster.
- `Source.html` and build files — packaging and explanatory UI.

## Lighting and visibility layers

The final image now combines three different, inspectable visibility systems:

1. **Direct shadows** — Three.js' 1024² PCF-soft directional shadow map, including the animated directional source and full ShaderBall geometry.
2. **Webgiya surfel visibility** — triangle-BVH rays for secondary hits and light visibility, plus MSM4 radial-depth occlusion for surfel-to-surfel and surfel-to-pixel leak rejection.
3. **Visibility raster / AO** — a half-resolution, twelve-sample Ground Truth Ambient Occlusion raster generated from camera depth and view-space normals. It is strongest on indirect/ambient illumination and intentionally only quarter-strength on direct light to avoid double-darkening sunlight.

Upstream Webgiya does not contain a separate conventional SSAO/GTAO pass; its native occlusion is the radial surfel system. The added GTAO layer supplies the small-scale contact visibility that can fall below the surfel radius.

## Multi-bounce GI

Multi-bounce transport is enabled by default. Webgiya's existing surfel feedback path gathers the previous temporal irradiance field at each secondary BVH hit, multiplies it by the hit albedo, and writes the result into the next double-buffered irradiance field. Repeating this recurrence over frames progressively carries second and later diffuse bounces without adding another ray-tracing pass. The pinned integrator algorithm remains unchanged; the derived host now gives this path an explicit enable switch and strength control.

## Phase 1 screen probes

Screen probes do not replace the surfels. One representative receiver is selected per 8×8 G-buffer tile and traces four deterministic cosine-weighted directions by default. A resolved secondary hit performs a directional-light visibility query and gathers the freshly integrated world-space surfel field, including its MSM4 radial visibility, for later-bounce radiance. A miss samples the HDR environment.

A full-resolution bilateral reconstruction rejects probes across depth and normal discontinuities. Its confidence blends between probe radiance and the original full-resolution surfel resolve instead of adding both estimators, avoiding duplicate indirect energy. Disabling **Screen-probe GI** stops both probe compute passes and restores the previous surfel-only composite.

## Phase 2 Hi-Z traversal

Every frame builds conservative minimum/maximum depth levels from the primary G-buffer. Even and odd hierarchy levels occupy separate `RG32F` atlases, so each reduction reads and writes different WebGPU resources without optional read-write storage-texture features.

Each probe direction now tries hierarchical screen traversal first. A depth candidate is accepted only after full-resolution world-position, ray-distance, surface-normal, and facing validation. Rays leaving the viewport, ambiguous candidates, and step-budget exhaustion fall back to the exact triangle BVH. A ray that reaches the camera far range without crossing visible depth uses the environment. The existing BVH still handles directional-light visibility after either kind of secondary hit.

Disable **Hi-Z first** to compare against the Phase 1 all-BVH path. This phase does not add temporal reservoirs, motion vectors, DDGI clipmaps, or dynamic BLAS/TLAS geometry.

## Controls

The inspector adds **Screen probes**:

- **Screen-probe GI** — enable the extension or return to the exact surfel-only baseline.
- **Hi-Z first** — enable hierarchical depth traversal; disabling it sends every secondary direction to the BVH.
- **Output** — show final lighting, reconstructed GI, bilateral confidence, trace sources, or normalized Hi-Z step count. In **Trace source**, green is Hi-Z, red is BVH fallback, and blue is an environment miss.
- **Probe confidence blend** — cap how strongly a valid probe replaces the surfel fallback.
- **Directions per probe** — quality/performance control from one to eight secondary directions; each hit can also issue a directional-light visibility ray.

The **Visibility raster / AO** controls are:

- **Ambient Occlusion** — enable or bypass the GTAO contribution.
- **Output** — show normal lighting or the grayscale visibility raster directly.
- **AO Strength** — contribution to indirect/ambient lighting.
- **AO Radius** — camera-space contact radius.
- **AO Samples** — quality/performance control from 4 to 24 samples.

The **Integrator** folder also exposes:

- **Multi-bounce GI** — enables recurrent indirect-to-indirect surfel transport; enabled by default.
- **First-bounce Strength** — scales direct illumination injected at secondary hits.
- **Multi-bounce Strength** — scales previous-frame surfel irradiance fed into later diffuse bounces; zero disables feedback.

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
10. Build the conservative min/max Hi-Z depth atlases.
11. Trace camera-visible probes through Hi-Z, conservatively falling back to the same triangle BVH.
12. Query fresh surfel radiance at secondary hits and reconstruct sparse probes at full resolution.
13. Blend against the surfel fallback and composite direct shadows, indirect light, ambient visibility, and the final image.

Desktop settings retain upstream's `262144`-surfel pool, 32³ hash-grid cascades, 4×4 radial-depth tiles, 32 target samples, and four base integration samples. Screen probes use one probe per 8×8 tile and four secondary directions by default; GTAO runs at half resolution for GTX-class performance.

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
