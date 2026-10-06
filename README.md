# Alloy 06 — 100+ Procedural Materials

A real-time procedural material editor built with React, Vite and Three.js. All surface detail is procedural: **no bitmap material maps, external HDRIs, or downloaded 3D assets**. The charcoal interface uses rounded panels and desaturated accents. Fonts are self-hosted.

## Run

```sh
npm ci
npm run dev
```

Vite serves on `0.0.0.0:5173`, including Arena preview hosts. `npm run build` creates a conventional production build.

### Open with raw.githack.com

Run `npm run verify:published` for the current immutable GitHack URL. Choose **Open the page** if GitHack shows its external-content notice. Append `?material=scratches` to open the isolated scratch study directly.

`site/index.html` is the committed, **self-contained application**: JavaScript, CSS, fonts, baked cloth geometry and shader recipes are embedded. It needs no development server and makes no runtime CDN imports or material-map requests. WebGL 2 and a modern browser are required.

Regenerate it after source changes:

```sh
npm run build:githack
```

After committing and pushing the current branch, open:

```text
https://raw.githack.com/unassignedinbox/Slate/<commit-sha>/site/index.html
```

Use the SHA containing the built page, not the source-only initial commit. An immutable SHA avoids branch-cache ambiguity. Local presets are browser-local and do not synchronize across preview/GitHack origins.

## Material-aware inspector

**114 procedural presets** across 16 categories. The library is open-ended, not a count target. Presets share purpose-built shader families; this is not a claim of 100 unrelated BRDF models or measured industrial finishes.

| Category                 |     Count | Examples                                                                                                                                                     |
| ------------------------ | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paint                    |         7 | Multicolor flakes, pearl, three thin-film iridescent paints                                                                                                  |
| Metal                    |        23 | Aluminium, 24K/18K/14K gold, rose/white gold, copper, maraging/cast/stainless steel, iron/rust, chromium, bronze, brass, nickel, titanium, zinc, silver, tin |
| Plastic                  |        17 | PVC-U/PVC-P, PP, HDPE/LDPE, PET/PBT, PTFE, POM, PA6, glass-filled PA66, PC, PMMA, PEEK; three existing polymers                                              |
| Fabric                   |        19 | Nine weave constructions, indigo/raw/washed/black denim, two jersey knits, cotton, linen, wool, silk, satin, suede, velvet, carbon composite                 |
| Leather                  |         4 | Cognac, nappa and two bull-grain hides                                                                                                                       |
| Clay                     |         4 | Terracotta, wet potter’s clay, kaolin, sculpting clay                                                                                                        |
| Wax                      |         4 | Beeswax, paraffin, soy, sealing wax                                                                                                                          |
| Skin                     |         6 | Pigment variants with pores, undertone and bounded wrap-scattering controls                                                                                  |
| Paper                    |         6 | Cotton rag, kraft, coated art stock, newsprint, corrugated card, mulberry                                                                                    |
| Technical                |         9 | Three solar modules, two golf-ball covers, two LED arrays, corrugated aluminium, isolated scratches                                                          |
| Ceramic / Rubber / Glass | 3 / 1 / 1 | Carbon ceramic, two glazed-tile constructions, performance rubber, crystal glass                                                                             |
| Stone                    |         4 | Two granites and two marbles                                                                                                                                 |
| Wall                     |         3 | Cast concrete, board-form concrete, lime stucco                                                                                                              |
| Nature                   |         3 | Green/autumn leaf cards and meadow grass blades                                                                                                              |

**Interpretation:** “PPT” was treated as PP (polypropylene); PET and PBT are also included. Alloy/polymer grades and skin/wax optics are representative visual approximations, not certified spectral or mechanical data. Gold variants, steels, bronze and brass are correctly treated as alloys rather than all being described as pure metals.

The inspector shows only a material's useful controls. Friendly **0–100% art-direction sliders** drive bounded internal physical values, often together. It does not expose a universal wall of metallic/roughness/IOR/clearcoat controls. `src/materialProfiles.js` defines the controls, mappings and fixed optical properties; the same rules apply to rendering, saved presets and shader exports.

Examples:

- **Velvet Roughness:** maps 0–100% to roughness 0.78–0.97 and sheen roughness 0.30–0.85. Only dye, roughness, pile softness and pile length are shown. Velvet remains nonmetallic and uncoated.
- **Silk Roughness:** maps to 0.12–0.38. Silk lustre couples anisotropy, dielectric specular and sheen within fabric-appropriate ranges.
- **Metal polish:** maps from broad to sharp conductor reflections. Metalness stays metallic.
- **Glass clarity:** maps from softly frosted to clear; thickness and edge refraction stay within useful glass ranges.
- **Polymer wear:** lowers the raised grain, with separate abrasion softness and worn-surface polish.
- **Paint:** bounded paint roughness, depth and clearcoat gloss. Flake coverage, size, sparkle and reflectivity are separate. Sparkle drives flake micro-roughness/orientation; reflectivity independently drives the metallic range. Surface-detail controls are collapsible.

Dimensional size and repetition controls are **not** reduced to arbitrary 0–1 ranges:

| Control                                        | Slider range                | Typed range           |
| ---------------------------------------------- | --------------------------- | --------------------- |
| Flake size                                     | 0.001–1,000 µm, logarithmic | 0.000001–1,000,000 µm |
| Thread / grain / peel / flake repetition scale | 0.01–1,000×, logarithmic    | 0.000001–1,000,000×   |
| Yarn direction                                 | −180–180°                   | −180–180°             |

The dimensional convention is **1 scene unit = 100 mm**. Extended inputs expand the slider domain. Fine features become subpixel and are filtered; increasingly small features need not remain individually visible.

## Fabric construction and color

All three foundational constructions—**plain, twill and satin**—plus basket, rib, herringbone, Oxford, houndstooth and warp-faced denim are selectable on woven textiles. This is nine procedural constructions, not a claim to model every specialized industrial weave.

- Independent **warp and weft** color pickers and hex inputs follow the over/under yarn pattern.
- Houndstooth alternates dark/light yarn bands within a 2×2 twill, rather than simply tinting each yarn orientation.
- Thread scale, direction and weave definition affect the actual shader.
- Cloth UVs carry the weave through the folds; rigid objects use triplanar mapping.
- Sheen is material-specific and dye informs the pile highlight. Additional fiber geometry appears in macro views and is hidden when unresolved.
- Presets include natural/basket/ribbed cotton, plain linen, Oxford, indigo denim, herringbone/houndstooth wool, champagne silk, midnight satin, woven upholstery, suede and velvet.

## Paint and surface detail

- **Iridescent paint:** Aurora Flip, Sunset Prism and Opal Pearl use Three.js's native thin-film interference, not a rainbow diffuse-color overlay. Color-shift strength, film phase (160–850 nm) and angle response control the optical model. A low-frequency procedural thickness variation adds subtle surface variation. Fresnel controls angular reflection; wavelength-dependent thin-film interference produces the shifting colors.
- **Cellular flakes:** filled 3D Worley/Voronoi cells, domain-warped and composited through 1–4 independently transformed depth layers. Upper flakes occlude lower ones; buried flakes pick up the binder tint. No cell-centered dot grid or emissive glitter overlay. Subpixel coverage is filtered.
- **Flake colors:** up to 12 individually editable colors, with palette, single-color and interpolated ramp modes. Ramp stops can be moved, added or removed.
- **Orange peel:** bounded amplitude and extended repetition scale, affecting the clearcoat normal and, more subtly, the substrate.
- **Carbon fiber:** 2-over/2-under twill with rounded bundles, sub-fibers and alternating anisotropic reflections beneath resin.
- **Polymers and leather:** a feathered wear field smoothly truncates raised grain. Removed height drives polishing and restrained color change; recessed pockets retain their texture. Leather adds irregular cellular pebble grain and fine pores.

## Architecture, vegetation and scratch study (v6)

- **Corrugated Aluminium:** reuses conductor optics, adding axial rib relief and a hollow-pipe preview. Ribs affect normals; the pipe silhouette remains smooth.
- **Porcelain / zellige tiles:** glazed faces, rounded edge relief and recessed matte grout. Grout changes base color, height, roughness and clearcoat coverage together.
- **Granite / marble:** irregular quartz/feldspar/mica grain fields; multiscale warped veins. These are procedural stone studies, not scans of named commercial slabs.
- **Concrete / stucco:** cement mottling, aggregate, air voids, board-form marks and raised plaster grain.
- **Leaves / grass:** UV-card silhouettes with generated coverage, leaf venation, tapered curved blades and normal relief. No alpha texture input. Preview cutout shadows are disabled rather than drawing incorrect rectangular shadows. No plant geometry or wind simulation is implied.
- **LED matrix:** recessed housings, rounded lens domes, emitter dies, small bond wires, contact pads and PCB traces. The contacts have their own metalness; lenses have their own roughness/coat response. Emission stays separate from the hardware.
- **Pure metals:** only **Tooling scale** was removed from the uncoated-metal inspector. Metal polish and surface tooth are unchanged; internal scale values remain compatible with existing presets.

### Scratches: isolated for approval

**Scratches** is a dedicated material—not a toggle applied to other metals. It searches neighboring seeded cells for finite line/arc segments, allowing cuts to cross cell boundaries. Occupancy, length, width, depth, direction and curvature vary independently. Tapered endpoints prevent endless stripes; a negative groove profile and small raised lips alter surface normals, while roughness broadens inside the cut. Derivative-aware filtering reduces subpixel sparkle. The density-zero setting is an exact bypass.

Use **Panel** for the clearest assessment, orbit the light reflection, then use **Macro**. Controls include density, length, width, depth, direction spread, preferred angle, curvature, field scale and a reproducible seed. This is a surface-normal/height study, not geometric damage to the silhouette. Existing worn-polymer detail is unchanged; the new scratch system has not been rolled out elsewhere.

Shader variants now compile the material-family ID as a constant, so drivers can eliminate unrelated kernels. Programs are retained through the thumbnail batch for reuse. Progress still reports real completed previews, not a fictitious GPU percentage.

## Macro inspection

- **10–10,000% optical zoom:** mouse wheel, pinch, buttons or logarithmic slider.
- **Macro** jumps to 800%; double-click a visible point to inspect it closely.
- Drag to orbit; right-drag or shift-drag to pan. **Fit** or **R** restores framing.
- Optical zoom keeps the camera outside the surface.
- Nine preview assets: grooved shader ball, frozen draped cloth, rounded cube, torus knot, perforated brake rotor, smooth sphere, flat panel, hollow pipe and foliage card. Solar/paper/LED presets select the panel; golf-ball covers select the sphere.
- Four studio-light setups, auto rotation, wireframe and focus mode.

## Frozen cloth asset

Textile presets automatically select **Draped cloth**. It is also available for other materials. A deterministic, offline position-based simulation uses structural/shear/bending constraints, a sphere collider, floor/pedestal collisions and a small center pin area. The settled mesh is baked into `src/assets/draped-cloth.json`; **no live physics runs in the viewer**. Material edits do not change the folds. A thin rim gives the cloth visible thickness.

Reproduce the bake with `npm run bake:cloth`. The small generated geometry is intentionally included; it is not a texture or an externally sourced asset. The simulation does not implement self-collision. This is a fixed preview sample, not a general-purpose cloth solver.

## Presets and exports

Search/category filters, local presets and favorites are supported. Older presets receive v6 defaults and are bounded to their material recipe; physically incompatible legacy settings may therefore change. `recipeId` preserves a saved material's family even when its name or ID changes. Art-direction positions are retained in `tuning`.

Exports: **v6 JSON**, standalone Three.js material module, six-channel PNG/ZIP surface baking, and PNG viewport snapshot. The JavaScript export includes the pure recipe module, shared surface kernels, normalization and unminified shader source, so it remains self-contained after production bundling. It expects Three.js 0.180+ and a lit scene/environment. Exports retain the cloth/object-space mapping mode. The shader includes procedural nap and sheen; additional preview fiber geometry belongs to the preview asset, not the exported material module.

Keyboard: `/` search, `R` reset camera, `F` focus, `Space` auto rotation, `Ctrl/Cmd+S` save, `?` shortcuts.

## Rendering notes

These are **browser PBR approximations**, not Unreal Substrate slabs or measured automotive BRDFs. Optical constants are handled by material recipes. Clearcoat Fresnel replaces Three.js's fixed F0 with `((ior - 1)/(ior + 1))²`; this is not a full multi-interface spectral slab solver. Glass uses screen-space transmission.

Skin and wax use bounded **wrap-scattering approximations**, with native transmission for wax; they are not true multilayer subsurface solvers. Jersey uses V-shaped loop fields rather than a woven twill. Denim uses warp-faced 3/1 construction, undyed weft, along-yarn slub and raised-thread fading, at a finer default yarn density. Golf-ball dimples perturb normals rather than geometry. Solar cells include separators, busbars and collection fingers; LEDs have patterned emission but do not cast light onto neighboring objects or produce bloom.

The environment cubemap is generated from studio-light geometry, not fetched from a texture asset. The renderer runs on demand when idle. Library thumbnails are renders of the actual procedural materials.

## Shader preparation progress

The library compiles and renders incrementally. Its progress bar counts **completed material previews out of the current catalogue**, not an invented percentage of GPU compiler work. Each job yields to the UI; `compileAsync` uses parallel driver compilation where supported. A separate material-compilation notice appears when the active recipe changes. Rapid changes are serialized/coalesced so obsolete results do not overwrite the current selection. Retired fiber materials are kept alive until pending compilation finishes, avoiding a stalled compile when switching rapidly from cloth to paint. Driver/linking failures produce an error state rather than silently reporting success.

## Baking procedural surface channels

Choose **Export material → Bake procedural maps**. Select a 256, 512, 1024 or 2048 square resolution and a physical patch width of 1–1,000 mm. The shader is evaluated on a flat XY patch using **the same surface kernels as the viewport**. The six-channel ZIP contains (leaf/grass coverage is preserved in PNG alpha):

- `base-color.png` and `emission.png`: sRGB encoded; emission intensity is recorded separately.
- `roughness.png` and `metalness.png`: linear, unlit scalar channels.
- `normal.png`: linear OpenGL tangent-space normals, +Y.
- `height.png`: linear, 8-bit signed height encoded around 0.5; decode range is in the manifest.
- `material.json` and `README.txt`: original procedural recipe, scale, color-space conventions and limitations.

The source materials use **zero input bitmap maps**. Baked maps are generated outputs, not texture inputs used to produce the material. The baker has real per-channel progress, cancellation between GPU passes, and resource cleanup.

**Limits:** leaf and grass patterns use normalized UV cards; the default 100 mm bake captures their full unit-domain card. Other patch widths crop/extend that domain rather than unwrapping a plant mesh. This is a planar material swatch, not an unwrap/UV bake of the selected mesh. Seamless tiling is not guaranteed. Height has 8-bit precision and clips to the documented range. Clearcoat, transmission, sheen, anisotropy, scattering and angle-dependent iridescence remain shader/recipe properties; static maps alone cannot reproduce the full appearance. No studio lighting or ambient occlusion is baked into base color.

## Tests

```sh
npx playwright install chromium
npm test
```

The 13-test development suite covers the growing catalogue, all material families, progress notifications, ZIP/PNG contents and channel values, bake cancellation, bounded recipe mappings, context-relevant inspector controls, all nine live weave patterns, independent yarn colors, thin-film uniforms and live iridescence, frozen geometry, height-aware wear, local persistence, JSON/JavaScript/PNG exports, macro zoom, extended ranges, color ramps and mobile layouts. Use `PLAYWRIGHT_EXECUTABLE_PATH` for an existing Chromium executable; software-rendering launch flags are included.

### Standalone and publication checks

```sh
# Rebuild, then exercise only the generated HTML—without a Vite server.
npm run test:standalone

# Verify GitHub holds the exact local page bytes and print its immutable URL.
npm run verify:published
```

The standalone test blocks unexpected HTTP asset requests, checks the full material library, edits cloth construction/yarn colors, checks live iridescence, and executes the exported Three.js shader. It uses an intercepted test origin, not a dev-server fallback. Browser executable/launch settings are shared with the main suite.

To exercise the actual hosted page instead, set its URL explicitly:

```sh
ALLOY_PUBLIC_URL='https://raw.githack.com/unassignedinbox/Slate/<published-commit>/site/index.html' npm run test:standalone
```

The remote mode confirms GitHack's notice if present. Connection failures **fail the test**; it never substitutes a local copy. Successful artifact verification is not a claim that GitHack's live runtime was tested. Some sandbox networks block direct connections to GitHack.
