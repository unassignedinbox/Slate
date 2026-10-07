# Pattern studio — v7.6

This is a **hybrid vector/procedural material workflow**, not the previous zero-input-map claim. Existing paint, scratch and botanical families remain analytic. All five leather presets now share one generated SVG height atlas; pattern documents can contain vector shapes, sanitized SVG groups and embedded user images. No reference photographs are shipped as leather maps.

## V7.6: 200 counted structures, without colorway padding

**174 ornamental compositions + 16 weave constructions + 10 stitch constructions = 200.** These are not 200 different carpet layouts or 200 unrelated renderers. The public catalog also retains 38 elementary/legacy starters plus Blank, excluded from the 200. Colorways, border-only changes, repeat density, scale, seeds and rotation do not create new counted designs. Ombre has one basic card. Historical aliases and palette-bearing names remain loadable without multiplying public cards.

Use **200 structures · no colorway counts** to browse only the counted inventory. **Ornamental compositions** selects the 174 decorative entries. The new **African inlay**, **Islamic networks** and **Ornamental carpets** groups each contain 21 constructions (63 additions). A construction description appears above the canvas; card tooltips expose the same basis. [The complete construction ledger](pattern-structure-ledger.md) lists every counted identity.

The older 108 composition recipes retain their IDs and controls, but six sparse field vocabularies have been replaced by compound inlays, brocaded bands, stepped/quartered panels and resist rosettes. Those replacements do not add to the count. The new graph-based designs use clipped cubic foliage and geometric inlays rather than just changing a palette or a random seed. Concave compartment clipping is supported through triangulation. New `construction` metadata survives ordinary JSON save/reload and shader exports.

The initial library filter is **Reference studies**. **Reference studies** opens:

- **Chromatic Diamond Tapestry**: replacement of the existing design, with a 640:360 artboard, nested shields, staircase contours, patterned outline bands, split rectangular fields and narrow selvedges.
- **Beaded Diamond Weave**: thousands of individually authored oval bead polygons arranged in a staggered lattice. Color is assigned per bead; highlights, edge shading and pierced centers remain vector geometry. Analytical rounded relief and gap roughness are shared by live materials and baking.
- **Turquoise Faceted Vault**: a flat decorative study of a fan of connected panels, alternating cream/navy/turquoise grounds, gold ribs and clipped floral infill. It is not actual vaulted/muqarnas mesh geometry.
- **Crimson Star and Cross Carpet**: a continuous eightfold star/cross arrangement with branching leaf, scroll, blossom and palmette infill—not disconnected star stamps.

These four studies are counted once. Older, now-revised recipes are under **Compositions / …**; elementary repeats remain under **Basic / …** and are excluded from the 200. None of these labels claims historical authentication or user approval.

### Editing and rendering

- All four studies are ordinary editable `alloy.pattern.v1` path layers with pigment and finish assignments. They reserve room for a three-layer stitch overlay. Semantic groups, rather than each individual bead or blossom, are layers.
- `designAspect` retains wide-artboard proportions in the editor, exported SVG and the Rug preview. Old documents without it retain their old dimensions. Other preview objects use their own UV aspect.
- The designs use `tileAxes: "none"`, clamp-to-edge sampling and one finite composition. Increasing repeat count crops/stretches edge pixels; it does not make a framed rug seamless.
- The reference studies and 63 graph-based constructions do not show the old generic Composition designer. They are editable compound-path documents; the older recipes retain regeneration controls and preservation behavior.
- Bead relief uses a fixed staggered grid in document coordinates. Individual bead-layer geometry transformations do not move that procedural grid; use document-level mapping/rotation/repeats to transform the complete beaded surface coherently. Beads are shader relief, not separate glass meshes or transmission simulation.
- SVG is scalable; live source maps remain finite resolution. Tiny ornament can become subpixel. The reference studies are original vector interpretations, not scans or exact photographic reconstructions.

[Research, inventory and limitations](rug-references.md).

### Family colorways, not duplicate cards

| Public family group                | Cards | Starting colorways per card |
| ---------------------------------- | ----: | --------------------------: |
| Fabric weaves                      |    16 |                           4 |
| Stitch patterns                    |    10 |                           4 |
| Basic geometric designs            |    15 |                           4 |
| Basic checks/stripes/color layouts |    10 |                           4 |

Choose the **Starter colorway** before selecting a family card. It changes that starter's colors and thumbnail, not the number of results, and does not replace edits in the current document. **Design palette** edits the current document. The four options are Indigo, Earth, Studio and Mulberry. Old `Family - Palette` names still resolve; their presence in compatibility code is not a public count.

The legacy 108-blueprint geometry tests are retained as serialization/bounds regressions, not evidence of reference fidelity. A unique path hash does not demonstrate a genuinely different or sufficiently detailed design.

### Weaves and printed designs

- Weave drafts: plain, basket 2×2/3×3, twill 2/1, 2/2 and 3/1, reverse twill, herringbone, broken/diamond/point twill, five-/eight-shaft satin, warp/weft rib and waffle. Warp/weft underlays and float masks use different editable layer colors and relief. Complete draft periods fit the tile, including 30 yarns for five-shaft satin. The names describe representative visual draft constructions, not loom-ready manufacturing files or a full yarn-contact simulation.
- Geometric designs: dots, rings, hexagons, triangles, chevrons, zigzags, scallops, Greek keys, pinwheels, interlocking squares, flowers, petals, diamonds, brick bond and waves.
- Color patterns: gingham, tartan, windowpane, madras, pinstripes, awning/candy stripes, color blocks, harlequin, houndstooth, argyle and looping ombre bands.
- **Design palette** edits all matching vector colors at once, preserving shapes, transforms and finish assignments. Image/grouped-SVG internal colors remain untouched. The library metadata records the starting family/colorway; recoloring does not create an additional catalogue entry.
- These vector drafts coexist with the main material inspector's existing analytic fabric weave modes. They do not replace or alter those kernels. Use pattern **Repeats**, mapping and layer transforms to control the overall artwork scale; fine details are filtered by the finite-resolution GPU maps.

### Stitch an existing design

Expand **Stitch overlay**, then enable **Stitch this design**. Choose running, backstitch, chain, cross, zigzag, blanket, herringbone, feather, couching or satin-bar stitching. Place it in repeating rows, columns, a diagonal field or an inset border. Adjust thread color, spacing (16–64 tile units), width (1–8), border inset (12–96) and relief (0–1 mm). Spacing is rounded to whole repeats to avoid broken edges. Border placement repeats a bordered tile; it does not detect arbitrary mesh boundaries or automatically follow a hand-drawn path.

An overlay reserves **three editable vector layers**: recessed needle-entry marks, raised cotton thread and a narrow highlight. The recesses follow stitch endpoints/turns. These feed the same color, roughness, finish, height and normal workflow as other patterns. They are shader relief—not literal mesh holes, thread strand geometry or a sewing-machine simulation.

Controls rebuild only layers marked with `stitchRole`; the underlying design's edits are preserved. Rebuilding replaces manual path edits to generated stitch layers. Disable removes those three layers while retaining the controls for later use. **Rebuild stitch layers** restores manually deleted stitch components. Adding stitches to a full document produces an explicit layer-cap error without changing the design. Fade regeneration retains the stitch overlay. Undo/redo, pattern JSON, local material presets, SVG and independent shader exports all retain the applicable settings/geometry. In SVG, even-odd paths keep rings and frame interiors open; procedural controls themselves live in JSON, not SVG.

Deep links: `?material=natural-cotton&studio=pattern&pattern=chain-stitch---indigo` and `?material=natural-cotton&studio=pattern&pattern=herringbone-weave---earth&view=3d`. The three hyphens arise from the `-` separator in preset names.

**Historical v7.3 validation:** 17 targeted pattern/library/editor tests plus one standalone test with external assets blocked. Checks include all 216 new documents, 54 distinct geometry signatures with four consistent colorways each, maximum-density stitch bounds, weave-period boundaries, non-destructive overlay regeneration, search/pagination, palette edits, save/reload/undo, live rendering, changed height/normal bakes and independent shader construction. These are targeted checks, not the complete historical suite or a claim of measured textile realism. Leather, scratch, plant and analytic fabric shader kernels are unchanged.

## Retained from v7.2: rugs, geometric collections and size fades

**Historical v7.2 inventory:** ten starters joined seven originals. Current cards consolidate aliases and colorways; the names below remain compatibility inputs:

| Collection       | Starters                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Islamic geometry | Islamic Star Lattice, Islamic Rosette Mosaic, Islamic Garden Carpet, Islamic Medallion Carpet |
| African-inspired | African Diamond Carpet, African Chevron Weave, Indigo Diamond Rug                             |
| Fading           | Golden Cube Fade, Ink Cube Fade, Diamond Dissolve                                             |

These are original reference-inspired vector constructions, not reproductions of a particular named textile tradition or embedded stock images. The gold and black fade references inform the geometric growth, not a raster decal. Dense repeating details use compound paths to stay below 64 layers and 100,000 path characters per layer; each cube-face group is editable, rather than each individual cube having its own layer.

### Make a rug

Choose a carpet/rug starter, then **3D material**. Rug starters select cotton backing, with cut-pile wool finish assigned to the colored regions. **Rug** is a gently flexed, finite-thickness rectangular preview mesh, available in the editor and the main workspace. Edit each motif's color, roughness and relief, or bulk-assign finishes; the same document can be used on cloth, a panel, tiles or pottery. Wool detail is shader relief and sheen, not groomed carpet strands, fringe or a manufacturing weave specification. Mesh UVs control artwork aspect/distortion.

Examples: `?material=natural-cotton&studio=pattern&pattern=african-diamond-carpet&view=3d` and `?material=natural-cotton&studio=pattern&pattern=islamic-medallion-carpet&view=3d`.

### Geometric fading, not transparency

Choose a Fading starter. **Fade direction**, **Motif density** (4–22 columns), **Fade strength**, **Smallest motif**, **Lattice gap**, **Fade start** and **Fade end** regenerate the geometry. Small detached facets grow into the cube lattice while their opacity remains unchanged. Gold starts with metal-inlay assignments; black starts with printed dye. **Loop fade seamlessly** changes the one-way growth into a small→large→small density envelope.

- One-way fades repeat **across** the fade only. Their ends deliberately do not repeat. SVG copies are suppressed along that axis; live and exported shader textures use clamp-to-edge there. The terminal row/column stretches if mapping samples outside the source. Repeat layout is locked to Straight. The export is labeled **Export border SVG**, not seamless SVG.
- Loop profiles repeat on both axes and enable the other repeat layouts. Arbitrary later motif edits, rotation, mapping and physical bake crops still need checking.
- Regeneration preserves matching face-group colors, finishes, roughness, metalness, relief, opacity and visibility. It replaces manual geometry/extra layers and resets the repeat layout to Straight. Undo/redo is available. Renaming a face group prevents its old assignment from being matched.
- Collection, rug presentation, fade settings and `tileAxes` (`x`, `y`, `xy`) survive pattern JSON, saved presets and standalone shader exports. Older documents without `tileAxes` default to repeating both axes.

Try `?studio=pattern&pattern=golden-cube-fade`. **Save document** keeps the editable controls and geometry; SVG export is the current vector result, not a procedural editor.

Validation for v7.2: 13 targeted collection/editor/integration tests plus one standalone test with external assets blocked. Checks include maximum-density path bounds, directional coverage growth, loop-edge sampling, cache wrap modes, undo/JSON reload, live wool rug rendering, gold metallic baking and independent shader exports. This is not a claim that the entire historical suite was rerun or that the shaders reproduce measured rug fibers. Existing leather sources, scratch kernels and plant shaders were not changed.

## Retained from v7.1: compose and inspect together

- **Design tile / 3D material** switches the center pane between the vector artboard and the actual workspace shader. Color, relief and finish edits update the material after a 450 ms editing pause. This is a second live renderer, not a screenshot or a different approximation.
- Preview on a rug, panel, draped cloth, leather swatch, shader ball, cube, sphere or teapot. Lighting, orbit, a 60–800% zoom slider, Fit and Inspect detail are available. Preview view settings are local; **Apply to material** commits the material, not the inspection camera.
- **Banded geometry**, **Medallion rug** and **Graduated lattice** add original editable compositions to the existing four starters. The rug uses layered wool relief; it still does not generate individual strand geometry.
- On the design artboard, drag the corner handle to resize and the round handle to rotate. Shift constrains resizing to the original aspect ratio or rotation to 15-degree steps. **Keep aspect ratio** applies to corner dragging; exact numeric dimensions can still be entered independently.
- Optional **8 / 16 / 32-unit snapping** applies to dragging and keyboard nudges. Focus the artboard and use arrow keys; Shift moves ten steps. Delete removes the selected motif. Ctrl/Cmd+S exports the pattern document without triggering the underlying workspace's save modal.
- Center, flip, create reflected copies, or replace a selected motif with **2–12 radial copies**. All operations retain finish assignments and obey the existing 64-layer document limit. Undo/redo includes pointer gestures.
- Reflection now handles rotated motifs correctly in mirrored repeats. Horizontal/vertical flip flags travel through JSON, SVG, live rendering and map baking.
- Source rasters are reused when changing only naming, overall rotation, mapping or repeat count. Static starter thumbnails are generated once, and the underlying workspace's auto-rotation pauses while the editor is open.
- Fixed a drag/freehand completion race that could read a cleared drag reference and blank the editor. Late image imports now append to the current document instead of an earlier edit snapshot.

A shareable example uses `?material=natural-cotton&studio=pattern&pattern=medallion-rug&view=3d`. Starter names use lower-case hyphenated slugs; unknown names fall back to Diamond weave. This is not an arbitrary document encoded into the URL.

## Design a surface

1. Open **Pattern studio** in the top navigation. `?studio=pattern` opens it directly.
2. Choose **Diamond weave**, **Painted blossoms**, **Cube lattice**, **Inlaid tile**, **Banded geometry**, **Medallion rug**, **Graduated lattice**, one of the new collection starters above, or a blank document. These are original geometric/floral starters inspired by the supplied references, not reproductions of a named cultural textile tradition.
3. Alternatively, choose a generator style, seed and motif count, then **Generate pattern**. The generated layout is editable like a hand-built one.
4. Add rectangles, ellipses, diamonds, triangles, flowers or SVG paths. Drag to position, draw a freehand path, or edit coordinates, size, rotation, opacity and path commands. Duplicate, reorder, hide and delete motifs; undo/redo retains up to 32 edits.
5. Use the repeat inspection strip to check **straight**, **half-drop** or **mirrored** layouts. Motifs crossing boundaries are wrapped, rather than cropped and restarted. Half-drop exports a 1024 × 512 supertile; mirror exports 1024 × 1024. The canonical design tile is 512 × 512 units.
6. Assign finishes per motif: **printed dye, woven cotton, cut-pile wool, glazed ceramic, metal inlay**. Roughness, metalness and relief in millimetres can be edited independently. **Assign this finish to all motifs** is a bulk action, not a hidden automatic conversion.
7. Pick a base: current material, cotton, linen, porcelain floor tiles, or continuous glazed pottery. **Apply to material** prepares the sources and updates the 3D renderer. Pottery selects the new **Teapot** preview; rug starters select the Rug mesh; other fabrics select the draped cloth. Flat Panel and other previews remain available.
8. Use **Save as preset** in the material workspace for browser-local persistence. **Save document** exports editable pattern JSON; **Open document** restores it. SVG export preserves vector geometry and embeds image layers. Material JSON/JavaScript exports retain the pattern too.

The editor is not a complete Illustrator replacement or an arbitrary node/shader graph. It supports an extensible set of motifs and imported artwork—not literally every possible pattern or SVG feature. Material slots are explicit finish models, not arbitrary complete library shaders nested inside one another.

## Imports and sharpness

- PNG, JPEG and WebP: up to 4 MB per file; resized to at most 2048 pixels on the longest side and embedded as PNG. Alpha blends the pattern into the underlying material; it does **not** cut holes in the mesh.
- SVG: up to 500 KB / 5,000 elements. Paths, basic shapes, groups, gradients and clipping are supported. Simple local 100 × 100 paths are directly editable. Other supported groups preserve their SVG source and expose a source editor.
- Scripts, events, CSS styles, external links, fonts, animation, filters, `foreignObject`, and document entities are rejected by the import allowlist. Expand unsupported features to paths or import a flattened PNG. The internally generated leather SVG uses trusted filter/use constructs; it is exported for external use, not accepted by the restricted artwork importer.
- 64 layers per document; 12 MB total serialized document limit. Large imported images can exceed browser storage quota; export JSON rather than relying on local storage in that case.
- Vector exports remain scalable. **Live GPU rendering is not infinite resolution**: pattern supertiles are rasterized to 1024–2048-pixel maps. Imported bitmap detail remains limited by its original resolution. Vector geometry is retained so another application can rasterize the SVG more finely.
- The editor retains original colors in image/grouped-SVG imports. Change SVG source to edit its internal palette; per-layer dye controls apply to the built-in vector motifs and paths.

## Surface mapping and repeat limitations

Mesh UV mapping is the default for cloth and decoration. Object projection is available for solid objects; cylindrical projection helps wrap pottery bodies. A complex mesh still needs suitable UVs; the studio does not automatically unwrap or import arbitrary meshes. The built-in teapot's patch UVs may repeat artwork on separate patches; cylindrical mapping trades those patch boundaries for a cylindrical seam and distortion near the spout/handle/poles.

The built-in repeat layouts wrap vector motifs, while one-way fades intentionally leave their fade axis nonperiodic. **Importing a rectangular photograph does not automatically repair mismatched image edges.** Use isolated motifs on transparent ground, a mirrored layout, or pre-process the bitmap. The general six-channel baker still exports an arbitrary physical patch; rotated, non-integer repeats, base-material fields, object/cylindrical mappings and dynamically varied leather do not guarantee that every baked patch tiles. Its manifest intentionally leaves `repeatable: false`.

## Material assignment, not only colored stickers

At Apply time, the same vector scene produces color, physical parameters and finish-weight maps. Color is decoded from sRGB; roughness, metalness, height and finish weights remain linear data. Premultiplied-alpha filtering avoids dark fringes. Finish weights are separate from material IDs, so translucent overlaps do not accidentally interpolate into unrelated finish classes.

- Cotton has filtered thread relief; wool has coarser pile relief and a broad sheen.
- Ceramic regions add a glaze lobe; metal inlay changes the local metallic response.
- Relief contributes to the surface normal and coat normal, and reaches height/normal bakes.
- The base stays continuous under transparent decoration. Printed/metallic decoration can retain a base glaze; fibrous regions suppress it.
- This is **surface relief and shading**, not individually groomed carpet strands, tessellated pile, silhouette displacement, embroidery geometry or a manufacturing/CAD specification.

## Leather source and variation

`src/leatherSource.js` deterministically authors one SVG atlas with four independently wrapped height fields: fine nappa, full grain, bull grain and rectangular belly scales. Both bull presets share the bull field with different finishes. Variant identity is explicitly stored, so saving under a custom name does not silently switch the grain.

The SVG supplies only surface structure—not baked lighting or a photograph. Live rendering rasterizes it at 2048 × 2048, adds periodic gutters to each patch, and uses explicit sampling gradients. A continuous, seeded coordinate warp varies the repeats without abrupt random tile rotations. Offset-image crossfading was tried and rejected because it doubled the crocodile furrows. **Repeat variation** controls the warp; scale, relief, patina and finish remain controllable. Crocodile crease width, pores and seed still affect the result.

This avoids hard tile boundaries but is not an infinite unique scan or a guarantee of photorealism. Large enough surfaces can still reveal the finite source. The atlas can be downloaded from the editor as **Export leather source SVG**.

## Runtime and export

The standalone HTML contains the source generator, editor and SVG/image pipeline. User imports travel inside pattern documents and material exports; they are not uploaded to a service.

`createMaterial()` remains synchronous, but vector/image preparation is asynchronous. Consumers of exported Three.js modules should wait before a single static render or shader compilation:

```js
import material from "./exported-material.js";
await material.userData.ready;
mesh.material = material;
await renderer.compileAsync(scene, camera);
renderer.render(scene, camera);
// On replacement/teardown:
material.dispose();
```

This path requires a browser DOM for image/SVG decoding and Three.js 0.180+ for rendering. Sources are shared/ref-counted and released when the last owning material is disposed.

The six-channel ZIP includes the embedded document in `material.json`. Patterned materials use a height range of **at least 0.05 scene units / 5 mm total**, preserving the ±1 mm motif controls without clipping ordinary leather relief. Always decode using the manifest's actual range. Unpatterned leather retains the finer 0.012 range. Static maps cannot encode the full coat/sheen/anisotropy lobes; use the shader export for those.

## Checks

Pattern tests cover document bounds, source identity, SVG sanitization, image/vector import, editing, undo/redo, local persistence, independent exported-shader GPU compilation, actual roughness/metalness/height bake values, repeat-edge continuity and leather atlas gutters. Leather is tested on both swatch and flat panel. The self-contained build is tested with HTTP asset requests blocked, including leather source loading and decorated pottery. Passing these checks establishes functionality, **not visual realism**.
