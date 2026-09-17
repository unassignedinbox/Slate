# Project-Zero material grid

`MaterialGridStructure` is the Project-Zero exhibit for the resolved material channels. It is an export-once fixture, not a renderer shortcut:

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

## Remaining material plan after M9

M0 through M9 are now implemented. M9 restores default-on denoising and motion-vector reprojection and adds explicit A/B controls plus a headless contract gate. See `Docs/MaterialM9.md` and run `bash Exhibits/Workbench/Materials/CheckMaterialM9.sh`.

The remaining validation work is GPU-only: run the K0–K5 kernel, the M5 v2 dipole triptych, M7 inspector pixel checks, and the converged raw-vs-denoised / reprojected A/B scenes on a real Vulkan device. The sandbox has no GPU or shader compiler, so those renders are not claimed here.

Still explicitly out of scope: geometric displacement, volumetric interiors/random-walk SSS, nested dielectrics, and default-on spectral dispersion/glints. The displacement channel has no carrier yet; the others remain stored hooks or later work by design.
