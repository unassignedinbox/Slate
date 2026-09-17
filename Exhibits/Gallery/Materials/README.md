# Materials gallery — shaderball sheet

`ShaderballSheet_GlassClothCoat.png` (1544×512): the CC0 shaderball path-traced on the CPU with the
proven `MaterialEvaluation.slang` BSDF — thin-wall glass (rough 0.06, η 1.5), deep-red velvet cloth
(fuzz 0.65), clearcoat car paint — under a 3-softbox studio rig. 256 spp/panel, BSDF sampling + NEE
with power-heuristic MIS, ACES + gamma 2.2. Deterministic: re-running the driver below reproduces it
pixel-for-pixel.

- Harness: `Exhibits/Workbench/Materials/ShaderballExhibit.cpp` · driver: `RunShaderballExhibit.sh`
  (smoke + full render; not part of the materials gate).
- Mesh: `shaderball.obj` (15,554 tris after quad split) + `shaderball-CC0-LICENSE.txt` — CC0 1.0
  Universal, Pseudopode/UnityShaderBall, credited with thanks.
- Kept-sheet values (linear means): glass 0.1913 · cloth 0.1509 · coat 0.1434 · 0 non-finite pixels.
- `sha256 2d6ddb48…9e66e2` (2026-09-16 re-render after the below-horizon mixture polish: cloth/coat panels
  bit-identical, 0.14 % of glass pixels shifted by the recovered paths; re-rendered again for M4b — bit-identical).

`ShaderballSheet_SolidGlass.png` (1028×512): thin-vs-solid diptych — the same clear glass as the triptych's
glass panel, once as foil and once traversed as solid glass (M4b medium tracking: true enter/exit + Beer +
TIR). Rendered with `RunShaderballExhibit.sh 512 256 solid` (or `both` for both sheets).

- Kept-sheet values (linear means): thin 0.1913 · solid 0.1886 · 0 non-finite pixels.
- `sha256 b432c15389b62552faa4b523bedddfda062c69956c0073d2a7c74bfb3dcb20ac` (2026-09-16, new for M4b).

`SwatchSheet_FullWall.png` (1548×1548): the Project-Zero material grid (`--scene materialswatch`) as a 4×4
sheet — 16 unique materials, one per wall cell, all eight reflectance selections live (6 Standard /
1 Anisotropic / 1 ClearCoated / 2 Cloth / 2 Subsurface / 2 Transmissive / 1 EmissiveOnly / 1 Unlit). The
sheet reads like the wall as the camera sees it: top row is the glass row, bottom row the floor row
(dielectrics + metals). Each panel is one swatch through the M7b preview entry — byte-identical rig,
tables, and encode to the inspector preview — and the 16 descriptors come from
`MaterialSwatchStructure`, the same source the GPU scene exports from, so sheet and scene agree by
construction.

- Harness: `Exhibits/Workbench/Materials/SwatchSheetExhibit.cpp` · driver: `RunSwatchSheet.sh [Size] [Spp]`
  (smoke + full render; not part of the materials gate — minutes, not seconds).
- 96 spp/panel, 3-softbox stage, ACES + gamma 2.2, 0 non-finite pixels. Deterministic per (swatch, size, spp).
- `sha256 b5dc0fa4839ce067739e058957be2d112f95074de2f27963d2c49b12665a771f` (2026-09-17, 384 px/96 spp).
- Stage limit (`ShaderballPreview.h`): the emitter cell glows (the kernel's M1 emission short-circuit is
  ported to the tracer) but never lights the ground — the GPU scene's luminaire table has no stage twin;
  the Unlit card is a flat radiance ball, likewise ported.
