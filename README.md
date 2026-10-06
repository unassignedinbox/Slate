# Alloy 04 — Material Studio

A real-time automotive material editor built with React, Vite and Three.js. All surface detail is procedural: **no bitmap material maps, external HDRIs, or downloaded 3D assets**. The charcoal interface uses rounded panels and desaturated accents. Fonts are self-hosted.

## Run

```sh
npm ci
npm run dev
```

Vite serves on `0.0.0.0:5173`, including Arena preview hosts. `npm run build` creates a conventional production build.

### Open with raw.githack.com

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

**32 presets** cover automotive paint, three iridescent finishes, metals, carbon ceramic, rubber, glass, brake iron, carbon fiber, polymers, leather, suede, velvet and woven textiles.

The inspector shows only a material's useful controls. Friendly **0–100% art-direction sliders** drive bounded internal physical values, often together. It does not expose a universal wall of metallic/roughness/IOR/clearcoat controls. `src/materialProfiles.js` defines the controls, mappings and fixed optical properties; the same rules apply to rendering, saved presets and shader exports.

Examples:

- **Velvet Roughness:** maps 0–100% to roughness 0.78–0.97 and sheen roughness 0.30–0.85. Only dye, roughness, pile softness and pile length are shown. Velvet remains nonmetallic and uncoated.
- **Silk Roughness:** maps to 0.12–0.38. Silk lustre couples anisotropy, dielectric specular and sheen within fabric-appropriate ranges.
- **Metal polish:** maps from broad to sharp conductor reflections. Metalness stays metallic.
- **Glass clarity:** maps from softly frosted to clear; thickness and edge refraction stay within useful glass ranges.
- **Polymer wear:** lowers the raised grain, with separate abrasion softness and worn-surface polish.
- **Paint:** bounded paint roughness, depth and clearcoat gloss. Flake coverage, size, sparkle and reflectivity are separate. Sparkle drives flake micro-roughness/orientation; reflectivity independently drives the metallic range. Surface-detail controls are collapsible.

Dimensional size and repetition controls are **not** reduced to arbitrary 0–1 ranges:

| Control | Slider range | Typed range |
| --- | --- | --- |
| Flake size | 0.001–1,000 µm, logarithmic | 0.000001–1,000,000 µm |
| Thread / grain / peel / flake repetition scale | 0.01–1,000×, logarithmic | 0.000001–1,000,000× |
| Yarn direction | −180–180° | −180–180° |

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

## Macro inspection

- **10–10,000% optical zoom:** mouse wheel, pinch, buttons or logarithmic slider.
- **Macro** jumps to 800%; double-click a visible point to inspect it closely.
- Drag to orbit; right-drag or shift-drag to pan. **Fit** or **R** restores framing.
- Optical zoom keeps the camera outside the surface.
- Five preview assets: grooved shader ball, frozen draped cloth, rounded cube, torus knot and perforated brake rotor.
- Four studio-light setups, auto rotation, wireframe and focus mode.

## Frozen cloth asset

Textile presets automatically select **Draped cloth**. It is also available for other materials. A deterministic, offline position-based simulation uses structural/shear/bending constraints, a sphere collider, floor/pedestal collisions and a small center pin area. The settled mesh is baked into `src/assets/draped-cloth.json`; **no live physics runs in the viewer**. Material edits do not change the folds. A thin rim gives the cloth visible thickness.

Reproduce the bake with `npm run bake:cloth`. The small generated geometry is intentionally included; it is not a texture or an externally sourced asset. The simulation does not implement self-collision. This is a fixed preview sample, not a general-purpose cloth solver.

## Presets and exports

Search/category filters, local presets and favorites are supported. Older presets receive v4 defaults and are bounded to their material recipe; physically incompatible legacy settings may therefore change. `recipeId` preserves a saved material's family even when its name or ID changes. Art-direction positions are retained in `tuning`.

Exports: **v4 JSON**, standalone Three.js material module, and PNG viewport snapshot. The JavaScript export includes the pure recipe module, normalization and unminified shader source, so it remains self-contained after production bundling. It expects Three.js 0.180+ and a lit scene/environment. Exports retain the cloth/object-space mapping mode. The shader includes procedural nap and sheen; additional preview fiber geometry belongs to the preview asset, not the exported material module.

Keyboard: `/` search, `R` reset camera, `F` focus, `Space` auto rotation, `Ctrl/Cmd+S` save, `?` shortcuts.

## Rendering notes

These are **browser PBR approximations**, not Unreal Substrate slabs or measured automotive BRDFs. Optical constants are handled by material recipes. Clearcoat Fresnel replaces Three.js's fixed F0 with `((ior - 1)/(ior + 1))²`; this is not a full multi-interface spectral slab solver. Glass uses screen-space transmission.

The environment cubemap is generated from studio-light geometry, not fetched from a texture asset. The renderer runs on demand when idle. Library thumbnails are renders of the actual procedural materials.

## Tests

```sh
npx playwright install chromium
npm test
```

The suite covers all material families, bounded recipe mappings, context-relevant inspector controls, all nine live weave patterns, independent yarn colors, thin-film uniforms and live iridescence, frozen geometry, height-aware wear, local persistence, JSON/JavaScript/PNG exports, macro zoom, extended ranges, color ramps and mobile layouts. Use `PLAYWRIGHT_EXECUTABLE_PATH` for an existing Chromium executable; software-rendering launch flags are included.
