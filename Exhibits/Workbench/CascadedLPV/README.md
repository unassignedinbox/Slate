# Dynamic Cascaded LPV WebGPU Demo

Open `CascadedLPV.html` through an HTTP server in a WebGPU-capable browser.

## Implemented pipeline

1. Rasterize the animated scene into a supersampled primary G-buffer and a 384² reflective shadow map.
2. Compact every second RSM texel into 36,864 transient surface-light candidates.
3. Scatter RSM and downsampled G-buffer samples into three snapped, camera-relative 40³ grids.
4. Normalize fixed-point atomic injection into directional RGB radiance and a directional blocker field.
5. Run one to six Jacobi propagation steps independently in the 24 m, 64 m, and 160 m cascades.
6. Compute half-resolution short-range screen-space colour transfer and GTAO with world-position history rejection.
7. Resolve direct light, shadowing, LPV indirect light, screen detail, sky response, and diagnostic views.

The scene uses the repository's full 67,832-triangle ShaderBall asset for four animated objects, plus procedural dynamic game-world geometry. No BVH, ray query, path tracing, signed-distance field, lightmap, or precomputed transport is used.

## Controls

- **2×2 comparison:** direct only, LPV-only indirect, screen-only detail, and the combined result.
- **Blocker field:** disables directional propagation attenuation for a leak comparison.
- **Screen GI + GTAO:** removes the near-field refinement while leaving world-space LPV active.
- **Show RSM surfels:** overlays current light-view surface samples in the single combined view.
- **Propagation:** changes how far light diffuses through each cascade.
- **Dynamic world / moving sun:** independently freeze geometry or illumination changes.

## Deliberate limitations

This demonstrates the low-memory raster architecture rather than claiming Lumen-equivalent visibility. The blocker volume is coarse, RSM coverage is light-view dependent, and screen-space refinement cannot recover hidden surfaces. Thin-wall leaks, broad indirect shadows, and missing off-screen local emissives remain expected limitations.
