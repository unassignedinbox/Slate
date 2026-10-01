# EEVEE Next architecture sources

The exhibit was scoped against Blender's official documentation and implementation history on 2026-10-01.

- [Blender 4.2 LTS EEVEE release notes](https://developer.blender.org/docs/release_notes/4.2/eevee/) — screen-space ray tracing for BSDFs; Virtual Shadow Maps and shadow-map ray tracing; rewritten volume probes with rejection/flood fill; dynamic sphere probes; velocity-aware temporal stability.
- [EEVEE ray-tracing manual](https://docs.blender.org/manual/en/latest/render/eevee/render_settings/raytracing.html) — screen-trace and light-probe methods, miss fallback, precision/thickness/backface controls, spatial reuse, temporal accumulation, bilateral filtering, and Fast GI modes.
- [Virtual Shadow Map initial implementation](https://projects.blender.org/blender/blender/commit/a0f52400890) — visibility-tagged sparse pages, cached physical page pool, local-light cube projection with receiver-distance LOD, and directional clipmap/cascade selection.
- [Irradiance Cache initial implementation](https://projects.blender.org/blender/blender/pulls/108639) — dedicated surfel capture pipeline, C++ light-cache ownership, object-level bake lifecycle, streamed irradiance atlas, irradiance sample controls, surfel shadow usage tagging, and baked spherical-harmonic capture.

## Translation decisions

WebGL2 supports MRT deferred rendering, 3D textures, cube maps, timer queries, and depth comparison, but not compute shaders, SSBO atomics, or sparse page allocation. Therefore:

- Blender's sparse VSM page pool is represented by three always-resident directional atlas tiles plus one local cube shadow.
- Baked directional irradiance and validity/visibility are preserved in 3D textures.
- Compute denoisers are represented by half-resolution fragment passes with the same categories of spatial, temporal, clamp, and bilateral tests.
- The sphere probe is a separately captured cube map with mip fallback.
- Unsupported features are listed explicitly in `README.md` rather than being silently omitted.
