# Frontier Editor — Cliff generator (experimental, browser)

Procedural cliff / mountain terrain generator in the Frontier Editor UI (outliner · viewport ·
inspector cards). It is a plain static page: no bundler, no JSX, Three.js resolves from a CDN
import map, so it runs straight from GitHub via raw.githack, GitHub Pages or any static server.

```
https://raw.githack.com/<owner>/Slate/<branch>/Frontier/Experimental/CliffGenerator/index.html
```

Local preview:

```sh
cd Frontier/Experimental/CliffGenerator
python3 -m http.server 5173 --bind 0.0.0.0     # or: npm install && npm run dev
```

## Representation

The terrain is **heightfield‑based**: a 2‑D grid of heights (128²–2048²) is what the noise,
strata and erosion operate on, and what the heightmap / satmap / mask exports describe. The
*rendered mesh* is more than the heightfield — vertices are moved horizontally for overhangs and
along the normal for fine detail — but it is still one sheet with no caves, arches or tunnels, and
overhangs are limited to roughly one grid cell. True 3‑D (voxel / SDF) terrain is out of scope here.

## Pipeline — base shape → noise → erosion → rocks → surface

1. **Base relief** (`src/heightfield.js`) — domain‑warped ridged multifractal with a continental
   mask, optional mesa soft‑clamp and a meandering canyon incision.
2. **Strata** — the heightfield is terraced in a tilted (geological dip) frame. Every bed gets a
   hashed *hardness*; hard caprock beds become near‑vertical faces, soft beds become slopes.
   Hardness is kept as a map and drives everything downstream.
3. **Erosion** (`src/erosion.js`) — thermal pre‑settle, Lagrangian droplet hydraulic erosion
   (cutting scaled by hardness so cliff bands survive, deposition builds fans), then talus
   slumping with a hardness‑dependent repose angle → scree aprons beneath the faces.
   Outputs: height, deposit, flow (log accumulation), hardness, cavity, slope.
4. **Mesh** (`src/terrain-geometry.js`) — indexed grid with alternating diagonals, per‑vertex
   normals and an `aux` attribute `(deposit, flow, hardness, cavity)`; a skirt turns the tile
   into a cut block of ground. **Cliff depth**: steep vertices are displaced horizontally along
   the face normal — hard beds out, soft beds in, plus buttress/alcove noise — so the mesh has
   genuine overhangs, ledges and recesses that the heightfield itself cannot represent.
   **Mesh detail**: the mesh can carry 1–4× the heightfield's vertices (bicubic upsample, side
   capped at 2049) plus fine relief pushed along the surface normal (knobs on steep rock,
   hummocks on flat ground) — cheap detail on top of the expensive erosion. Rocks are seated on
   the final displaced surface.
5. **Rocks** (`src/rock-geometry.js`, `src/rock-placement.js`) — eight archetypes per seed
   (boulder / block / slab / shard): displaced icosphere, anisotropic stretch, then clipped by
   bedding + joint‑set planes, crease‑aware normals. Placement is a plain scatter: jittered
   grid × density × slope window × clustering mask, power‑law sizes, slope‑following tilt and
   embed depth. A second, denser pass scatters up to 40 000 small rounded **stones** on scree
   aprons and river beds (slope‑limited, never on roads or under water) so gravel is real
   geometry up close. Rendered as `InstancedMesh` with per‑instance tone variation and the same
   surface shader.
6. **Surface** (`src/surface-shader.js`) — analytic, world‑space, texture‑free material injected
   into `MeshStandardMaterial` so Three's PBR, shadows, sky environment and fog still apply:
   - strata colour bands with dip, bed seams, oxide pockets, aggregate grain (3D value noise
     with analytic gradient);
   - **mineral flakes** — three stacked plate layers composited top‑over‑bottom, each with its
     **own colour** (filled from the rock type, then editable), size (3 cm – 8 m), density,
     plate height (mm; drives tilt + rim bevel in the normal), shape (angular chips → rounded
     grains), tint variation and a **crystal share**: crystal plates are brighter, glossy,
     slightly metallic and carry a view‑dependent sun glint. Each layer can be revealed only on
     hard caprock or only on soft eroded beds (the *hardness* channel), and plates take the
     oxide colour where the *flow* channel and oxide pockets say the rock is weathering;
   - **spalling (“peeling rock”)** — modelled on exfoliating sandstone: irregular fbm‑threshold
     patches where a thin sheet has flaked off, each a shallow step (sheet thickness in metres,
     height + analytic normal) with a bevelled rim, paler fresh rock inside, a second generation
     of smaller spalls and sparse weathering pits. Patches are stretched along bedding on
     vertical faces; no cell networks or concentric contours;
   - cover: runoff staining from the flow map + face streaks, **pebble gravel** on deposits and
     river beds (two generations of domed stones in a sandy matrix, each with its own tone),
     vegetation on gentle ground, moss in concavities, slope‑limited snow above the snow line.
   All layers contribute height **and** an analytic gradient, combined triplanarly into one
   perturbed normal — no finite differences, no texture reads.
7. **Drawn features** (`src/features.js`) — splines and points drawn in the viewport:
   - **rivers** (terrain stage): Catmull‑Rom line → meander → smoothed, monotone‑downhill bed
     profile (flowing from the higher end) → channel carved with sloped banks up to a bank
     height, gorge walls above that. Carved before hydraulic erosion, and a share of the droplets
     start *in* the river carrying extra water, so the water erodes its own bed and the slopes
     drain into it; carved again after slumping so the final bed matches. Outputs a bed mask
     and a water level. Water can be switched off for dried beds (cobbles → silt).
   - **roads** (mesh stage, instant): smoothed grade profile along the spline, flat carriageway,
     cut slopes above / fill embankments below, shoulder verge; proper widths (3.5 m track …
     30 m), computed on the refined mesh grid so a 6 m road is resolved.
   - **lakes** (mesh stage, instant): flood fill from the clicked point up to a level (adjustable
     per lake), flat silt bed below, water surface; off = dried lake bed.
   River / lake water is a mesh built from the water‑level map; the sea is the live level plane.
8. **Lighting** — `Sky` with PMREM environment, shadowed directional sun, exponential fog,
   ACES tone mapping, water plane.

## Controls

Outliner rows map to inspector groups: **Landform / Strata / Erosion** rebuild the heightfield
(press *Generate* or Ctrl+Enter; the worker reports progress), **Rocks** re‑scatter automatically,
**Cliff depth** rebuilds the mesh live, and everything under **Rock material / Mineral flakes /
Spalling / Ground cover / Sun & atmosphere / Viewport** is live. Presets: Alpine
granite, Sandstone mesa, Canyon, Sea cliffs, Limestone escarpment, Fjord, Badlands, Dolomite towers,
Desert buttes, Volcanic island, Highland glens, Boulder field, Scree slopes, Granite domes,
Rocky coast, Talus canyon, Karst pinnacles.

Every texture layer is fully exposed: each has an **enable** toggle, its own **scale**,
**strength** and **colour** controls —

| Group | Layers | Controls |
| --- | --- | --- |
| Rock material | palette → nine editable colour swatches (beds, fresh, oxide, three flake layers, stones); strata; grain; oxide; cavity | bed contrast, band scale, laminae, bed shading, seam darkness/width, caprock tint, grain size/relief/mottle/fineness, oxide amount/scale, cavity shading, bump strength, base roughness |
| Mineral flakes | three plate layers | global: coverage, rim highlight, sheen, crystal glitter, oxidise‑with‑runoff; per layer: enable, colour, plate size, density, plate height (mm), tint variation, shape, crystals, reveal by hardness |
| Spalling | flaked‑off sheets | amount, coverage, patch size, sheet thickness (m), small spalls, weathering pits, follow bedding, fresh contrast, rim shadow |
| Rocks → Gravel stones | instanced small stones | enable, density, largest stone |
| Ground cover | runoff; pebble gravel; vegetation; moss; snow | wetness, face streaks + scale; gravel amount, stone size/relief/variation/colour; vegetation amount, slope limit, patch scale, patchiness, dry grass + three colours; moss amount/scale/colour; snow line, slope limit, transition, roughness, colour |

Picking a rock type fills the colour swatches; they can be edited freely afterwards.

**Drawing**: the toolbar over the viewport (or *Roads, rivers & lakes → Draw*) has Road / River /
Lake. Click points on the terrain; Enter or double‑click finishes a spline, Backspace removes the
last point, Esc cancels; a lake is one click. Drawn features are listed in the inspector with
delete buttons and per‑lake level sliders, persist with the settings, and survive preset changes.
**Water** (own outliner row) has the live sea‑level slider, colour, opacity, shoreline wetness and
the dried‑bed toggles.

**Viewport → Isolate layer** renders a single layer on its own (Strata / Grain / Flakes / Spalls /
Pebbles / Cover / Masks / Features) so each pattern and its scale can be judged before tuning it.

Exports (all maps share the heightmap's top‑down frame): OBJ / GLB (displaced terrain block +
all rock instances), 16‑bit packed heightmap PNG, **satmap** PNG (top‑down lit colour render at
2048², rocks and shadows included, same exposure/ACES chain as the viewport), splat masks PNG
(R rock · G scree · B wetness · A hardness), normal map PNG, viewport screenshot. Settings persist
in `localStorage`.

## Checks

```sh
node scripts/check-generate.mjs "Sandstone mesa" 256   # headless pipeline run + ASCII preview
node scripts/check-shader.mjs /path/to/glslangValidator # assembles the injected shader exactly as
                                                        # Three does and validates GLSL ES 3.00
```
