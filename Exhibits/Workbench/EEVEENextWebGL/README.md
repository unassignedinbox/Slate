# EEVEE Next WebGL2 + C++ Study

Open `EEVEENext.html` over HTTP. This exhibit is an independent architectural reconstruction of the major Blender 4.2+ EEVEE lighting paths, not Blender code transpiled to JavaScript.

## Included instead of implied

- **Deferred material G-buffer:** world position, normal/roughness, albedo/metalness, and depth feed a GGX direct-light pass.
- **Direct shadows:** a 4096² depth atlas contains three stable 2048² directional clip/cascade tiles. A moving local light owns a six-face 512² radial-depth shadow. Receiver-slope bias, 3×3/5×5 PCF, and eight-tap cube filtering are explicit.
- **Baked volume light probes:** `EeveeProbeCache.bin` contains a 12×10×6 static cache produced by `EEVEEReference.cpp`. Every probe stores RGB L1 directional irradiance, six directional visibility reaches, validity, and sky visibility.
- **Probe leak control:** probes inside geometry are rejected and flood-filled at lower confidence. Runtime interpolation manually weighs all eight neighbours and rejects a probe when its directional reach cannot see the receiver.
- **Screen tracing:** half-resolution cosine rays march camera-visible geometry. Rays that leave the screen or miss fall back to the volume cache.
- **Denoising:** normal/depth spatial reuse, world-position temporal reprojection, disocclusion rejection, and neighbourhood clamping are separate, switchable stages.
- **Fast GI approximation:** a screen-space horizon-style visibility term modulates distant probe/ray lighting.
- **Specular indirect:** low-roughness reflection rays search the screen and fall back to a mip-filtered sphere probe. The sphere probe is captured separately and has an explicit recapture control.
- **Faithful baked/dynamic boundary:** moving objects receive cached diffuse light but do not alter it. Moving the sun updates direct shadows immediately and marks the indirect cache stale. Visible moving emission can contribute through screen traces but does not become an off-screen baked source.
- **Exact Slate ShaderBall:** the same `Exhibits/Assets/ShaderBall/ShaderBall.mesh` is used for animated objects.

## Why the shadow system is an analogue

EEVEE Next uses compute-driven sparse Virtual Shadow Maps: depth-visible receivers tag needed tiles, physical pages are allocated/cached, local lights use cube-face LOD, and sun lights use clipmaps or cascades. WebGL2 exposes neither compute shaders nor the storage-buffer atomics needed for Blender's page allocator. This exhibit preserves the observable architecture—stable directional levels, a bounded atlas, local cube projection, automatic receiver bias, and filtered shadow lookup—but keeps all atlas tiles resident. Calling this exact Blender VSM would be misleading.

## C++ reference and cache bake

The C++ program is deliberately independent of WebGL. It mirrors the browser's cache format, L1 irradiance convention, invalid-probe flood fill, six-direction leak test, and shadow-level selection.

```bash
./RunReference.sh
./RunReference.sh --rebake
```

The checked-in cache is deterministic: 720 probes × 256 bake rays and is approximately 57 KiB. Static box geometry participates in the bake; animated ShaderBalls and movers intentionally do not.

## Controls and useful comparisons

- **2×2 comparison:** direct/shadows, volume-probe fallback, screen-traced GI, and combined output.
- **Screen tracing / Volume probes:** isolate EEVEE's visible-hit path and miss fallback.
- **Probe leak rejection:** demonstrates why ordinary trilinear probe interpolation leaks through walls.
- **Temporal / Spatial reuse:** compare raw low-ray-count instability against the denoised path.
- **Fast GI occlusion:** adds local screen-space visibility to otherwise distant probe lighting.
- **Sphere reflections:** compares screen hits with the sphere-probe fallback.
- **Shadow filtering:** changes the directional kernel from 3×3 to 5×5 while retaining local cube filtering.
- **Move sun:** intentionally demonstrates stale baked bounce versus live direct shadows.
- **Emissive-only screen proof:** zeros analytic lights; visible emissive bounce can remain, while off-screen contribution disappears as expected for EEVEE screen tracing without a rebake.

## Fidelity limits

The browser path uses one or two diffuse rays per half-resolution pixel rather than reproducing every EEVEE BSDF closure and tile-classification pass. It does not implement Blender's transmission, subsurface, volumetric froxels, transparent shadow modes, light clustering for thousands of lights, or sparse virtual-page allocation. Those omissions are stated rather than silently relabelled. The core GI, probe fallback, cache validity, reflections, denoising, and both directional/local shadow paths are implemented and exposed for inspection.

## References

- Blender 4.2 EEVEE release notes: screen-space ray tracing for BSDFs, Virtual Shadow Maps, shadow-map ray tracing, rewritten volume probes, rejection/flood fill, and dynamic sphere probes.
- Blender EEVEE ray-tracing manual: screen-trace/probe methods, thickness/backface controls, spatial reuse, temporal accumulation, bilateral filtering, and Fast GI parameters.
- Blender EEVEE Next irradiance-cache implementation history: capture-time surfel placement, baked light-cache storage, irradiance sampling, visibility tagging, and controlled atlas budgets.
