# Dynamic Cascaded LPV WebGPU Demo

Open `CascadedLPV.html` through an HTTP server in a WebGPU-capable browser.

## Implemented pipeline

1. Rasterize the animated scene into a supersampled primary G-buffer, a GI-only 384² reflective shadow map, and three stabilized 1024² direct-shadow cascades.
2. Choose one sample from each 2×2 RSM tile with a deterministic, world-quantized blue-noise rule. Store stable IDs and lower confidence at depth/normal discontinuities, producing 36,864 transient candidates.
3. Resolve one deterministic candidate reservoir per LPV cell and trilinearly splat each selected source into the eight neighbouring cells.
4. Add camera-visible geometry to a separate six-direction blocker volume. Conservatively dilate only the near-cascade blockers by one cell; radiance sources are never dilated.
5. Reproject the previous propagated volume through the prior snapped cascade origins, temporally blend stable cells, and immediately invalidate history inside swept moving-object bounds.
6. Run one to six Jacobi propagation steps in three persistent 40³ grids covering 24 m, 64 m, and 160 m.
7. Compute half-resolution short-range screen-space colour transfer and GTAO with world-position history rejection.
8. Resolve direct light through selectable 3×3 or 5×5 PCF, then combine persistent LPV indirect light, screen detail, sky response, and diagnostic views.

The RSM is used only to discover indirect-light sources. It is not reused for direct shadowing. The scene uses the repository's exact 67,832-triangle ShaderBall mesh for four animated objects, plus procedural dynamic game-world geometry. No BVH, ray query, path tracing, signed-distance field, lightmap, or precomputed transport is used.

## Controls

- **2×2 comparison:** direct only, LPV-only indirect, screen-only detail, and the combined result.
- **Shadow filter:** switches the dedicated cascaded shadow maps between 9-tap 3×3 and 25-tap 5×5 PCF. The 3×3 option is the GTX-class default; 5×5 softens edges at extra fragment cost.
- **Blocker field:** disables directional propagation attenuation for a leak comparison.
- **Screen GI + GTAO:** removes the near-field refinement while leaving world-space LPV active.
- **Show RSM surfels:** overlays current GI candidates in the single combined view.
- **Propagation:** changes how far light diffuses through each cascade.
- **Dynamic world / moving sun:** independently freeze geometry or illumination changes.
- **Render scale:** scales presentation from 100% to 175%, capped at 1920×1080.

## Performance and limitations

The fixed world-space storage remains bounded for open-world use. Three direct-shadow depth layers add about 12 MiB, while source radiance, persistent history, propagation ping-pong volumes, deterministic reservoirs, atomics, and raw/dilated directional blockers remain compact enough for a GTX-class target. The default uses 3×3 PCF and four propagation steps.

This demonstrates a low-memory raster architecture rather than claiming Lumen-equivalent visibility. LPV cells are still coarse, RSM source discovery remains light-view dependent, and screen-space refinement cannot recover hidden surfaces. Thin-wall leaks are reduced by six-direction blockers and near-cascade dilation, but broad indirect shadows and missing off-screen local emissives remain expected limitations under the no-ray/no-SDF/no-bake constraints.
