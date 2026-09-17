# Branch survey — the three sibling M9 branches, and why one Project-Zero render reads flat

Date: 2026-09-17 · Scope: `arena/01a0af43-slate`, `arena/01a0af3e-slate`, `arena/01a0af54-slate`
(vs this branch, `arena/01a0af3d-slate` @ `c8bda9c`). All three branched from **M8 (`1872def`)** — they do NOT
carry the verified M-chain lineage this branch carries (K0–K5 kernel unbreak + M5v2 + M6–M8 + the merged
`884ae0b` two-M9 merge + the in-kernel two-stratum MIS, `MaterialReuseProof` PASS, `SkyGlassProof` PASS,
`OutdoorMaterialGrid` GREEN).

---

## 1. What each branch shipped

### arena/01a0af43-slate — "re-enable milestone" (`ad413eb` + `4b44dc8`)
- **Reached the same defaults conclusion independently**: `Denoise`/`TemporalReprojection` were never off in
  code (blame `2be1647`); "M9 ships as the proof and the gate, not a flag flip." Same finding, same day, both
  branches — cross-confirmation.
- **`DenoiseReprojectionProof.cpp` — 97 checks** driving `AtrousDenoise.slang`'s own `main()` 1:1, with the
  C++-compat spellings applied as **four mechanical substitutions at include time** (gate-asserted, re-derived
  byte for byte) — the shader's GPU text stays untouched. 7 gallery sheets: levels, edge stops, fade-out,
  identity-at-convergence, noise+edges, reprojection, RNG-stream A/B. (This branch also *independently*
  re-derived the never-off defaults from the code — convergent evidence, not copying.)

### arena/01a0af3e-slate — materialswatch wall (`02f83bf`)
- **`MaterialSwatchStructure`** — an engine-shared, export-once Project-Zero **level** (`--scene materialswatch`):
  4×4 wall of 0.45 m spheres, 16 pairwise-unique materials spanning **all eight reflectance selections**
  (Standard / Anisotropic / ClearCoated / Cloth / Subsurface / Transmissive / EmissiveOnly / Unlit), census
  checked (6/1/1/2/2/2/1/1), channel round-trips in the gate. Gate grew 102 → **143**. Sheet:
  `Exhibits/Gallery/Materials/SwatchSheet_FullWall.png` — **excellent** (true refraction, Fresnel metals,
  glowing emitter, SSS skin).

### arena/01a0af54-slate — authored showcase + grid in the default scene (`3491aac`…`073e38b`, 10 commits)
- Wired authored `MaterialDescriptor`s into Project-Zero's `RendererHost` CPU renderer (`CpuMaterialShading.h`
  includes the **real** `MaterialEvaluation.slang` 1:1), applied authored materials to the scattered showcase
  shapes, made the material grid **additive to the default Showcase scene**, 256-px CPU A/B hashes, cloud
  shadows in the CPU shading, `RunHighQualityShowcaseCpu.sh`. Rendered result:
  `Projects/Project-Zero/Diagnostics/ProjectZero_Showcase.png` — **the flat one**.

### This branch (`01a0af3d`) — the lineage + the proofs + the outdoor grid
- Only branch carrying the **verified kernel chain** (M0→M8) and the **in-kernel M9** (two-stratum MIS with
  the pure-SSS virtual walk, compile-verified 87763-word SPIR-V), proven by `MaterialReuseProof` (§A–§D PASS)
  and `SkyGlassProof` (14 ok: seam parity vs `AtmosphereModel`, sun-arm parity, GI dome closure for wax /
  mixed T+SSS / solid glass / foil, visual sheet). Plus the outdoor material grid rendered with the
  kernel-true transport (`OutdoorGrid_{Field,Balls,Original}.png`).

---

## 2. Why the af54 render is flat — the real answer to "is the Project-Zero renderer different?"

**Yes. Three different pipelines are in play, and they are not the same:**

| | GPU kernel (`ReSTIRViewport.slang`) | Exhibit CPU renders (this branch) | af54's PZ CPU renderer |
|---|---|---|---|
| BSDF | real, 1:1 | real, 1:1 (same file) | **real, 1:1** (same file) |
| Direct sun | disc NEE + K5 MIS split | mirrored exactly | point-direction `f·cos` toward sun/moon only |
| Specular/metal energy | BSDF-sampled paths | BSDF GI walk → `SkyAlong(dir)` | **none — no reflection ray exists** |
| Environment | `SkyAlong` per direction | per direction (dome + disc) | **one constant `SkyAmbient` vector** |
| Transmission | solid walk (Beer) / foil | solid walk + virtual see-through | `ThroughF · BackSky` thin tint only |
| SSS below | K5 arm + M9 virtual at W_B | mirrored | SssThickness ≈ `2·radius` heuristic |
| Ambient | never added by hand | never added by hand | **`+ SkyAmbient` added on top of the BSDF** |

The flatness in `ProjectZero_Showcase.png` is exactly this signature:

1. **Metals go near-black with tiny white dots.** `CpuMaterial::Evaluate(record, N, view, sunDir)` evaluates
   the true BSDF only toward TWO point directions. A polished metal's lobe is a few degrees wide — the
   probability it lines up with the sun/moon direction is ~0, so the metal body collects ≈ nothing and the
   render shows dark balls with pin-glints. The kernel instead lets specular surfaces BSDF-sample their
   bounce and collect `SkyAlong(reflected)` — chrome mirrors the dome; that ray does not exist in af54.
2. **`+ SkyAmbient` flattens everything.** A constant view-independent vector added at bounce endpoints and
   composition swamps the lobe structure: no Fresnel grazing falloff, no sun-side/shade-side modelling —
   pastel, uniform balls.
3. **Glass reads as tinted plastic.** Transmission is a thin `ThroughF · BackSky` term; there is no
   entered-solid walk, no refraction ray — the ball cannot bend the background (compare af3e's wall, where
   the glass spheres visibly refract).
4. **No shadows read under the wash.** Sun is a single visibility-sampled point at 17.93 h with cloud shade,
   then the ambient dominates the ground anyway.

So: the exhibits and the GPU kernel share the transport structure (NEE + BSDF-sampled walk + real
environment); af54's renderer is a **reservoir-schematic replica** whose ambient + point-NEE shortcut erases
precisely the effects the material system exists to produce. Its material DATA is fine; its LIGHT TRANSPORT
is the bug. The fix is mechanical: replace the `SkyAmbient` term with a BSDF-sampled bounce that escapes to
`SkyAlong(dir)` (the `OutdoorMaterialGrid.cpp` structure, ~150 lines), keep their reservoir phases for
temporal/spatial stability.

---

## 3. What the siblings did better — adopt list

1. **af3e's `MaterialSwatchStructure` level** — the grid as a real exported glTF scene with all eight
   selections and census/round-trip gates. Strictly more GPU-reachable than an analytic exhibit; port it and
   align its 16 materials with the outdoor grid's 18 archetypes (superset).
2. **af43's `DenoiseReprojectionProof`** — 97 checks through the shader's own `main()` + the seven denoise
   sheets, and the include-time substitution trick that keeps `AtrousDenoise.slang`'s GPU text pristine
   (worth revisiting this branch's in-file C++-compat spellings for — they were GLSL-identical and
   SPIR-V-verified, but af43's approach leaves zero GPU-side diff).
3. **af54's integration skeleton** — authored descriptors on the *scattered* shapes, the grid additive to the
   default scene, A/B artifact hashes, `RunHighQualityShowcaseCpu.sh`. Keep the skeleton, replace the
   transport as in §2.
4. **af54's cloud-shadow hook in the CPU shading** — the exhibits render clear-sky only.

## 4. What only this branch has (keep-list)

- The verified M-chain lineage itself (the other three cannot merge without taking the chain).
- The in-kernel two-stratum MIS + `MaterialReuseProof` (§B closure) — the MIS algebra no sibling implements.
- `SkyGlassProof`'s seam parity against `AtmosphereModel` (the packer-true environment no sibling checks).
- The kernel-true outdoor renderer (`OutdoorMaterialGrid`) — the transport reference §2 recommends af54 adopt.

## 5. Recommended consolidation

Trunk = this branch. Merge order: (a) af3e's swatch level + gates (adapted to the chain's `MaterialIndex`),
(b) af43's denoise proof + sheets (keep both proof styles; theirs is the deeper gate), (c) af54's PZ
integration with its `RendererHost` shading replaced by the kernel-true structure. Then one
`--scene` family: `materialgrid` (glTF, 18 archetypes), the outdoor field default, and the exhibits remain
the proof layer. GPU render-verification stays user-side, as everywhere since K0.

---

# RE-REVIEW 2 — the branches as of 17 Sep ~16:00 (post-survey updates)

## What changed since the first survey

- **af43** added `MaterialLevelViewport.cpp` (905 lines) + 4 `MaterialLibrary_*.png` sheets: a Project-Zero
  CPU viewport over `MaterialSwatchStructure` that is **kernel-true end to end** — records through
  `MaterialIndex::Register/Finalise` + a transcription of the kernel's `ResolveMaterial`, the 1:1 BSDF,
  **NEE on the level's six emissive triangles with power-heuristic MIS against the BSDF strategy**, the sun
  as a disc light with **escape-direction MIS**, M4b Beer over interior segments, the SSS chord,
  thin-wall continuation, and Project-Zero's own SkySpecification at the product staging. Their hero sheet
  shows real reflections and studio lighting. **This is now the best-looking PZ-side render of any branch,
  and it is the correct way to render.** Their denoise stack (97-check proof through the shader's own
  `main()` + 7 sheets + include-time substitutions) stands as the best denoise artifact anywhere.
- **af54** pushed `931f388` ("render authored materials in combined Showcase", minutes after my survey): a
  path continuation with the real `EvaluateBsdf/SampleBsdf` on secondary rays. Their new
  `ProjectZero_Showcase.png` is visibly better (chrome reflects), **but the constant-ambient term and the
  point-direction sun remain**, so the wash persists — mid-tier, fixed skeleton.
- **af3e** unchanged (`02f83bf`): still the best grid-as-scene level (16 materials, all 8 selections,
  143-check gate) with the best material sheet.

## Honest self-assessment — is the 01a0af3d work better?

**Where this branch is ahead (uncontested):** the verified M-chain lineage itself; the **in-kernel
two-stratum MIS** (sun/mesh arms at W_L + the pure-SSS virtual at W_B — no sibling implements the kernel
MIS); `MaterialReuseProof` (§A–§D, bitwise ReSTIR-sync algebra); `SkyGlassProof` (seam parity vs
`AtmosphereModel`, sun-arm parity, GI dome closure, foil invariant); the outdoor scene + 18-archetype grid
with kernel-true transport; kernel compile verification (87763-word SPIR-V).

**Where af43 is ahead (conceded):** the **denoiser**. This branch includes `AtrousDenoise.slang` 1:1 and
proves the filter's algebra (§C identity/edge/fade gates) and its ToneMap, but the *rendered panels* are raw
MC — **no denoise pass is applied to any pretty picture here**. af43 drives the shader's own `main()` through
97 checks, ships 7 sheets, and does it with include-time substitutions that leave the GPU file byte-pristine
(this branch edited the .slang in place with C++-compatible spellings — GLSL-identical and SPIR-V-verified,
but a diff nonetheless). Their denoise work is better; integrate it.

## The consolidation plan (user decision: trunk = 01a0af3d + af43's denoiser + af3e's features)

1. **Trunk stays `arena/01a0af3d-slate`.** Cherry-pick **files**, not merges — all siblings branched from
   M8, a merge would drag 60k+ lines of pre-chain kernel back in.
2. **Port af43's denoise stack** (`DenoiseReprojectionProof.cpp`, `AtrousDenoiseMirror.{h,cpp}`,
   `DenoiseCpuShim.h`, `CheckMaterialDenoise.sh`, 7 sheets) and **revert `AtrousDenoise.slang` to the pure
   GPU spelling** (pre-edit text from the K5 commit) — one substitution layer, both proofs (§C of
   `MaterialReuseProof` included) consume the shader through it. End state: pristine GPU file, the strongest
   denoise gate, zero duplicated shims.
3. **Apply the denoiser to the outdoor grid**: re-render the panels raw + à-trous-filtered (the filter's
   first real scene) — "all features at once" preview ①.
4. **Port af3e's `MaterialSwatchStructure`** (`--scene materialswatch` level + B-block gates), aligned to
   the chain's `MaterialIndex` (same 304-B ABI — drop-in), its 16 materials reconciled with this branch's
   18 archetypes (superset, all 8 selections).
5. **Celestial features into the outdoor preview** (user ask): moon(s) via `MoonRecords` (real MoonControl
   rows; the texture fetch stays stubbed — flat-tinted disc acceptable for preview), stars via
   `PostRecords::StarAlong` with a small deterministic catalogue packed into `StarCells/StarStars`, lens
   flare via `FlareAlong`, clouds/rainbow from the PZ SkyFog core (cloud shadow via `CloudShadow.slang`),
   and the rainbow's rain gate exercised. One dusk panel: sun disc + aureole + flare + clouds + moon +
   early stars + the material grid in front — "all features at once" preview ②.
6. **af54**: adopt concepts only (the additive-grid default, A/B artifact hashes, the cloud-shadow hook);
   do not merge the branch (pre-chain lineage, 60k-line conflicts, and its transport is now the weakest of
   the three fixed renderers).

Sequence: (2)→(3)→(5) on this branch immediately; (4) after; GPU render-verification user-side as always.
