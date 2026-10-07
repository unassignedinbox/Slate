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
   embed depth. Rendered as `InstancedMesh` with per‑instance tone variation and the same
   surface shader.
6. **Surface** (`src/surface-shader.js`) — analytic, world‑space, texture‑free material injected
   into `MeshStandardMaterial` so Three's PBR, shadows, sky environment and fog still apply:
   - strata colour bands with dip, bed seams, oxide pockets, aggregate grain (3D value noise
     with analytic gradient);
   - **mineral flakes** — three stacked, independently seeded layers of angular plates (basal
     chips, laminae, fine flecks); the front plate occludes those behind; per‑plate colour,
     tilt/bevel relief and sheen are separate controls, size from 5 cm to 8 m;
   - **exfoliation (“peeling rock”)** — Voronoi sheets in three states: *intact* (joint cracks),
     *lifting* (sheet tilted so one edge curls off the face, shadowed underside) and *spalled*
     (sheet gone: recessed pale fresh rock with a dark rim); two octaves (sheets and small
     flakes). Sheets only grow on exposed rock, in patches, and are stretched along bedding on
     vertical faces — coverage, size, thickness, lift, bedding stretch, fresh contrast and
     shadow depth are all separate controls;
   - **joint network** — an independent Voronoi fracture set (F2−F1 V‑grooves) with its own
     block size, line width, groove depth and bedding bias, so cracks and peeling can be tuned
     (or switched off) separately;
   - cover: runoff staining from the flow map + face streaks, gravel on deposits, vegetation on
     gentle ground, moss in concavities, slope‑limited snow above the snow line.
   All layers contribute height **and** an analytic gradient, combined triplanarly into one
   perturbed normal — no finite differences, no texture reads.
7. **Lighting** — `Sky` with PMREM environment, shadowed directional sun, exponential fog,
   ACES tone mapping, water plane.

## Controls

Outliner rows map to inspector groups: **Landform / Strata / Erosion** rebuild the heightfield
(press *Generate* or Ctrl+Enter; the worker reports progress), **Rocks** re‑scatter automatically,
**Cliff depth** rebuilds the mesh live, and everything under **Rock material / Mineral flakes /
Cell layers / Ground cover / Sun & atmosphere / Viewport** is live. Presets: Alpine
granite, Sandstone mesa, Canyon, Sea cliffs, Limestone escarpment.

Every texture layer is fully exposed: each has an **enable** toggle, its own **scale**,
**strength** and **colour** controls —

| Group | Layers | Controls |
| --- | --- | --- |
| Rock material | palette → five editable colour swatches; strata; grain; oxide; cavity | bed contrast, band scale, laminae, bed shading, seam darkness/width, caprock tint, grain size/relief/mottle/fineness, oxide amount/scale, cavity shading, bump strength, base roughness |
| Mineral flakes | 1–3 cellular plate layers | coverage, size (5 cm – 8 m), layer count, density, colour variation, raised plates, rim highlight, sheen |
| Cell layers | peeling sheets; joint cells (Voronoi, off by default) | peel strength, coverage, sheet size/thickness, edge lift, small sheets, follow bedding, fresh contrast, shadow depth; joint darkness, block size, line width, groove depth, bedding bias |
| Ground cover | runoff; gravel; vegetation; moss; snow | wetness, face streaks + scale; gravel amount/scale/colour; vegetation amount, slope limit, patch scale, patchiness, dry grass + three colours; moss amount/scale/colour; snow line, slope limit, transition, roughness, colour |

Picking a rock type fills the colour swatches; they can be edited freely afterwards.

**Viewport → Isolate layer** renders a single layer on its own (Strata / Grain / Flakes / Peeling /
Joint cells / Cover / Masks) so each pattern and its scale can be judged before tuning it.

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
