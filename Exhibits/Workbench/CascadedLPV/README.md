# Dynamic Cascaded LPV WebGPU Demo

Open `CascadedLPV.html` through an HTTP server in a WebGPU-capable browser.

## Implemented pipeline

1. Rasterize the animated scene into a supersampled primary G-buffer, a GI-only 384² reflective shadow map, and three stabilized 1024² direct-shadow cascades.
2. Capture reflected sunlight and explicit emissive radiance in the RSM. Rank all four samples in each 2×2 tile with a deterministic world-space blue-noise rule, stable IDs, and depth/normal discontinuity confidence.
3. Resolve one deterministic candidate reservoir per LPV cell and trilinearly splat each selected source into the eight neighbouring cells.
4. Add camera-visible geometry to a separate six-direction blocker volume. Conservatively dilate only the near-cascade blockers by one cell; radiance sources are never dilated.
5. Reproject both the previous source field and propagated volume through the prior snapped cascade origins. A short mean/variance estimate adaptively publishes stable source radiance, while swept moving-object bounds immediately invalidate stale history.
6. Run one to six Jacobi propagation steps in three persistent 40³ grids covering 24 m, 64 m, and 160 m, then resolve with soft trilinear reconstruction.
7. Compute half-resolution GTAO with fixed world-space blue-noise directions, adaptive temporal smoothing, history clamping, and world-position rejection. No colour is transferred by this screen-space pass.
8. Resolve direct light through selectable 3×3 or 5×5 PCF, then combine persistent LPV indirect light, self-emission, GTAO-modulated sky response, and diagnostic views.

The RSM is used only to discover indirect-light sources. It is not reused for direct shadowing. The scene uses the repository's exact 67,832-triangle ShaderBall mesh for four animated objects, plus procedural dynamic game-world geometry. No BVH, ray query, path tracing, signed-distance field, lightmap, or precomputed transport is used.

## Emissive-light proof

A cyan emissive bar is positioned between two neutral pillars. Select **Emissive-only proof** to set solar RSM injection to exactly zero and clear temporal history. In that view:

- the cyan bar remains visible through self-emission;
- coloured illumination on nearby non-emissive surfaces can only come from the world-space LPV;
- switching **Emissive light** off resets history and removes both the source and its propagated spill.

This proves that emissive radiance enters the same persistent, blocked LPV transport path as reflected sunlight. It does not claim arbitrary off-screen emissive discovery: an emitter must still be captured by the directional RSM or another raster source view.

## Controls

- **2×2 comparison:** direct/self-emission, LPV-only indirect, GTAO visibility, and the combined result.
- **Emissive light:** enables the cyan emissive source and invalidates old lighting history when changed.
- **Emissive-only proof:** removes every solar source from LPV injection so emissive transport can be evaluated in isolation.
- **GTAO:** enables ambient visibility only; it never adds screen-derived radiance.
- **Shadow filter:** switches the dedicated cascaded shadow maps between 9-tap 3×3 and 25-tap 5×5 PCF. The 3×3 option is the GTX-class default.
- **Blocker field:** disables directional propagation attenuation for a leak comparison.
- **Temporal stability:** compares adaptive LPV/GTAO history against the unsmoothed current frame.
- **Sparse RSM debug:** overlays one in sixteen current GI candidates in Combined view.
- **Shadow visibility:** displays CSM/PCF without ambient or indirect-light fill; white is sun-visible and black is shadowed.
- **Propagation:** changes how far light diffuses through each cascade.
- **Dynamic world / moving sun:** independently freeze geometry or illumination changes.
- **Render scale:** scales presentation from 100% to 175%, capped at 1920×1080.

## Why screen-space GI was removed

The former colour-transfer pass was not an accurate GI solution. It inferred bounce light from nearby visible pixels without reliable thickness, hidden-surface information, or receiver-to-source visibility. It could create plausible contact colour in selected views, but it could also transfer light across gaps, lose illumination at screen edges, and change when the camera moved. Temporal filtering hid noise but could not correct those visibility errors.

More elaborate screen-space ray marching would reduce some local errors, but it would retain the same off-screen and disocclusion failures while increasing GTX-class cost. The exhibit therefore keeps GTAO and delegates all diffuse colour transport to the world-space RSM/LPV system.

## Performance and limitations

The fixed world-space storage remains bounded for open-world use. Three direct-shadow depth layers add about 12 MiB; adaptive source history and its short moments add about 12 MiB. Radiance, propagation ping-pong volumes, deterministic reservoirs, atomics, and directional blockers remain bounded for the GTX-class target. The default uses 3×3 PCF and four propagation steps.

This demonstrates a low-memory raster architecture rather than claiming Lumen-equivalent visibility. LPV cells are still coarse and RSM source discovery remains light-view dependent. Thin-wall leaks are reduced by six-direction blockers and near-cascade dilation, but broad indirect shadows and emissive sources outside every raster source view remain expected limitations under the no-ray/no-SDF/no-bake constraints.
