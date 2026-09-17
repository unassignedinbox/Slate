# Project-Zero material grid

`MaterialGridStructure` is the Project-Zero exhibit for the resolved material channels. The 5×4 grid is also appended to the default `Showcase.gltf`; it is not a replacement level. The original 100 scattered analytical shapes and their sun/sky/cloud/celestial/lens-flare presentation remain in the same default scene. `MaterialGridStructure` remains available as the isolated `--scene materialgrid` fixture for focused tests.

The default level is regenerated in place when its `Showcase.gltf.m9grid.version` sidecar is absent or stale, so an older generated Showcase cannot hide the grid.

`MaterialGridStructure` is an export-once fixture, not a renderer shortcut:

1. `Construct()` creates one `MaterialDescriptor` for each ball.
2. `Export()` writes `Projects/Project-Zero/Content/Scenes/MaterialGrid.gltf`.
3. Project-Zero imports that file through the normal `ContentCodec` / `MaterialIndex` path.

Run the project with:

```text
Project-Zero.exe --scene materialgrid
```

The scene is generated on first launch if the glTF is missing. It is intentionally not checked in as a large generated buffer; deleting the file regenerates the same deterministic scene. The headless interchange gate is `bash Exhibits/Workbench/Materials/CheckMaterialGrid.sh` (10/10 checks when the Vulkan/interchange headers are available).

## Grid contents

The grid is four rows by five columns. Every ball has a distinct material descriptor and a distinct material name:

| Row | Materials |
|---|---|
| 1 | plastic, bone, clearcoat, glass_glossy, glass_clear |
| 2 | metal_gold, metal_silver, metal_copper, metal_iron, metal_brushed |
| 3 | clearcoat_rough, velvet, felt, wax, jade |
| 4 | soap_film, emissive, unlit, hazy_clear, matte_eon |

The set covers the standard, anisotropic, clear-coated, cloth, subsurface, transmissive, emissive-only, and unlit reflectance selections. It also gives the grid visible representatives for metalness, roughness, specular/F82 colour, emission, transmission, subsurface radius/colour, coat, fuzz, thin-film, anisotropy, haziness, opacity defaults, and EON diffuse roughness. The floor and luminaire are separate descriptors, so the 20 test materials remain one-to-one with the 20 grid cells.

## M9 CPU render and UI counterpart

M9 is validated against the actual Project-Zero scene on the CPU, not only by source assertions. The Vulkan scene exporter and CPU renderer share `Engine/ContentInterchange/MaterialGridMaterials.h`; `Exhibits/Workbench/Materials/MaterialGridM9CpuRender.cpp` then uses the existing `MaterialEvaluation.slang` CPU port, the same 5×4 sphere layout, floor, luminaire, material slots, transmission/subsurface records, and a CPU-rasterized status strip.

```text
bash Exhibits/Workbench/Materials/RunMaterialGridM9Cpu.sh 256 2 Projects/Project-Zero/Diagnostics
```

For the complete default scene, including the original scattered shapes, sunset sun/sky, clouds, moon, stars, ground mist and lens flare, render the high-quality CPU reference:

```text
bash Projects/Project-Zero/RunHighQualityShowcaseCpu.sh 1280 720 12 4
```

This writes `Projects/Project-Zero/Diagnostics/ProjectZero_Showcase.png`; the reference run is 1280×720, 12 bounce candidates and four spatial passes. The latest run completed in 18.1 seconds and produced SHA-256 `0835f41ca708cfd4d2493386187b752fe8f0ee48cf8a1e66b7deca39cde181b8`.

This writes raw, enabled, `--no-denoise` and `--no-reprojection` A/B images, the UI-facing image, and a SHA-256 manifest. The source-contract gate remains useful for dispatch/barrier wiring:

```text
bash Exhibits/Workbench/Materials/CheckMaterialM9.sh
```

A real Vulkan device is still needed for final GPU shader compilation and GPU-vs-CPU pixel agreement. That is distinct from the completed CPU same-scene/same-math render validation. Still explicitly out of scope: geometric displacement, volumetric interiors/random-walk SSS, nested dielectrics, and default-on spectral dispersion/glints. The displacement channel has no carrier yet; the others remain stored hooks or later work by design.
