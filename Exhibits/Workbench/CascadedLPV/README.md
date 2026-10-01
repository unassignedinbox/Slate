# Dynamic Cascaded LPV WebGPU Demo

Open `CascadedLPV.html` through an HTTP server in a WebGPU-capable browser.

## Revision 8 pipeline

1. Rasterize the animated scene into a primary G-buffer, a GI-only 512² reflective shadow map, and independent 2048²/1024²/1024² stabilized direct-shadow textures.
2. Extract at most 65,536 candidates by ranking all four samples in every RSM 2×2 tile with deterministic world-space blue noise, stable IDs, and depth/normal-discontinuity confidence. Reduced adaptive prefixes are permuted across the complete RSM instead of cropping it.
3. Resolve two competing deterministic source reservoirs in each near LPV cell and one reservoir in each middle/far cell. Sources are trilinearly splatted without dilating radiance.
4. Generate a fixed best-candidate blue-noise pattern on the cyan emitter's mesh triangles in object-local space. Transform and inject those records into all applicable LPV cascades every frame, independently of the directional RSM and camera.
5. Store near radiance as six RGB faces in a persistent 48³ field. Middle/far 48³ fields retain compact first-order directional coefficients. Snap the cascade origins around the camera/player focus—not a fixed eye look-ahead—so dollying the camera does not demote the focused scene into coarse cells. Reproject history through prior origins, while swept moving-object bounds immediately invalidate stale cells.
6. Scatter geometry into a separate 80³ near blocker lattice and two 48³ middle/far lattices. Six directional opacity channels occupy two packed `u32` words per cell. Only near blockers receive one-cell 3×3×3 dilation, and each near propagation link tests three high-resolution blocker samples.
7. Run adaptive Jacobi propagation in the three persistent world-space grids covering 24 m, 64 m, and 160 m, then resolve with the original soft trilinear reconstruction.
8. Compute half-resolution GTAO with fixed world-space blue-noise directions, temporal clamping, and world-position rejection. It contributes ambient visibility only and transfers no screen-space colour.
9. Resolve direct light with 3×3 PCF by default or optional 5×5 PCF. Where `timestamp-query` is available, a four-buffer asynchronous readback ring adjusts presentation scale, spatial RSM candidate count, propagation count, and finally PCF radius. LPV and blocker dimensions never change at runtime.

The RSM discovers reflected-sun sources; it is never reused for direct visibility. The scene retains the repository's exact 67,832-triangle ShaderBall mesh. There is no BVH, ray query, path tracing, signed-distance field, lightmap, baked lighting, or precomputed transfer.

## Persistent emissive proof

A moving cyan mesh is positioned between two neutral pillars. Its 768-record maximum sample set is generated once on the actual local-space cube triangles and remains fixed. Every frame the GPU transforms the active records by the emitter's current object transform and injects them directly into the near six-face and compact middle/far fields.

Select **Emissive-only proof** to make directional-RSM solar injection exactly zero and clear history. In that view:

- the cyan mesh remains visible through self-emission;
- coloured illumination on non-emissive receivers comes only from persistent world-space LPV transport;
- the source continues to update while moving or outside the camera/RSM capture;
- switching **Emissive light** off resets history and removes both source and spill.

## Controls

- **2×2 comparison:** direct/self-emission, LPV-only indirect, GTAO visibility, and combined output.
- **Emissive light / Emissive-only proof:** enable the persistent cyan source or isolate it from every solar contribution.
- **Emitter surfels:** changes the actual number of transformed local-space records, from 128 to 768. More records improve triangle coverage and motion continuity but add atomic injection work.
- **Emitter footprint:** changes the persistent surfels' trilinear kernel from 0.50× to 2.00×. Larger values fill neighbouring cells more smoothly but can soften detail and increase apparent spill.
- **Adaptive GPU budget:** targets a roughly 16.7 ms class budget using GPU timestamps. Over budget, it reduces presentation scale first, then active spatial RSM candidates, propagation iterations, and only then 5×5 PCF to 3×3. It restores quality in reverse order with hysteresis.
- **Maximum render scale:** caps the adaptive scale (75–150%); it is the fixed scale when adaptation is disabled.
- **Shadow filter:** selects the quality ceiling. 3×3 is the GTX-class default; 5×5 is optional.
- **Blocker field:** disables directional propagation attenuation for a leak comparison.
- **Temporal stability:** compares persistent adaptive history against rapidly updating current measurements.
- **GTAO:** controls ambient occlusion only; it never adds screen-derived radiance.
- **Sparse RSM debug:** overlays one in sixteen active GI candidates in Combined view.
- **Cascade coverage / blocker field / shadow visibility:** expose the principal world-space structures directly.
- **Propagation:** sets the maximum number of diffusion iterations.
- **Dynamic world / moving sun:** independently freeze geometry or directional illumination.

## Why screen-space GI remains removed

The former colour-transfer pass inferred bounce light from nearby visible pixels without reliable thickness, hidden-surface information, or receiver-to-source visibility. It could transfer light across gaps, lose illumination at screen edges, and change with the camera. Temporal filtering hid noise but could not correct those errors.

The exhibit therefore keeps GTAO and delegates all diffuse colour transport to persistent world-space LPVs. This is intentionally not presented as path tracing or as a replacement for Lumen's ray/SDF visibility.

## Performance and limitations

All expensive world-space allocations are fixed. Raising the three radiance grids to 48³ and adding near six-face radiance costs more than revision 7, but remains bounded on a 4 GB GTX 1650 Super-class target. Packed blockers avoid six floating-point channels per 80³ cell; inactive RSM candidates and persistent mesh records skip work without reallocating buffers. Separate direct-shadow textures consume about 24 MiB at 32-bit depth.

This remains a raster LPV prototype, not Lumen-equivalent visibility. Coarse voxels smear transport, blockers approximate rather than trace receiver-to-source visibility, and only emissive meshes supplied to the persistent local-space sampler are independent of source-view discovery. Broad indirect shadows, glossy reflections, arbitrary unsampled emitters, and very thin geometry remain expected limitations under the no-ray/no-SDF/no-bake constraints.
