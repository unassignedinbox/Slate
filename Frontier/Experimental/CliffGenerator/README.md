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
   genuine overhangs, ledges and recesses that the heightfield itself cannot represent. Rocks
   are seated on the displaced surface.
5. **Rocks** (`src/rock-geometry.js`, `src/rock-placement.js`) — eight archetypes per seed
   (boulder / block / slab / shard): displaced icosphere, anisotropic stretch, then clipped by
   bedding + joint‑set planes, crease‑aware normals. Placed with three patterns read from the
   erosion maps: scree aprons (deposit), cliff blocks snapped into bed rows along resistant
   layers (hardness × slope, aligned to the strata dip, protruding from the face) and summit
   tors (convexity × elevation). Rendered as `InstancedMesh` with per‑instance tone variation
   and the same surface shader.
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
     vertical faces. All layers contribute height **and** an analytic gradient, combined
     triplanarly into one perturbed normal — no finite differences, no texture reads;
   - cover: runoff staining from the flow map, gravel on deposits, vegetation on gentle ground,
     moss in concavities, slope‑limited snow above the snow line.
7. **Lighting** — `Sky` with PMREM environment, shadowed directional sun, exponential fog,
   ACES tone mapping, water plane.

## Controls

Outliner rows map to inspector groups: **Landform / Strata / Erosion** rebuild the heightfield
(press *Generate* or Ctrl+Enter; the worker reports progress), **Rocks** re‑scatter automatically,
**Surface / Sun & atmosphere / Viewport** are live. Presets: Alpine granite, Sandstone mesa,
Canyon, Sea cliffs, Limestone escarpment. **Cliff depth** rebuilds the mesh live.

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
