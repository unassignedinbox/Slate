# Rug and textile studies — v7.4

## Scope and originality

This revision prioritizes composition and ornament detail over colorway counts. It adds **108 original composition blueprints**, rather than another colorway multiplication: 36 African-inspired compositions, 36 Islamic-style carpets and 36 rug-atelier compositions. The 108 share an editable ornamental vocabulary but combine different field arrangements, focal structures, motifs, proportions and border treatments. They are contemporary vector studies—not scans, replicas, authenticated traditional patterns, symbolic interpretations or loom-ready instructions.

The older **African Diamond Carpet**, **Islamic Medallion Carpet** and **Islamic Garden Carpet** starter names now resolve to three of the richer compositions. Those compatibility aliases are **not** extra unique compositions. The full catalogue contains 341 named preset entries plus Blank, still including the previous colorways and these aliases. Do not advertise that larger number as distinct designs.

No research photographs, museum images, stock watermarks or externally hosted assets are embedded in the materials or standalone app. Research downloads are ignored by Git. The generated paths and shader finish assignments are the artwork shipped in the application. Palette changes are not counted as new compositions.

## Research that informed the designs

### African textile structures

- **International Quilt Museum, _From Kente to Kuba_.** Asante/Ewe kente uses joined narrow woven strips with offset warp-/weft-faced sections. The exhibition also describes raffia patchwork/appliqué and Yoruba adire resist techniques. This informed offset strip blocks, alternating patterned bands and indigo compartment studies, rather than one generic “African” repeating triangle. The library's titles do not claim the meanings of particular named motifs. [1](https://www.internationalquiltmuseum.org/exhibition/kente-kuba)
- **V&A, Kuba cloth, O89315.** The museum describes embroidered raffia, cut-pile and uncut topstitching, interlocking angular motifs and intentional individual variation. This informed high-contrast angular paths, nested/interrupted lozenges, spirals and unequal patchwork compartments. Wool finish in the studio is a rug interpretation; it is not a physical reconstruction of raffia manufacture. [4](https://collections.vam.ac.uk/item/O89315/kuba-cloth-kuba-cloth-unknown/)
- **Minneapolis Institute of Art, Asante Kente Cloth.** The examples emphasize strip structures, supplementary weft patterning, contrasting colors and shifts in geometric blocks. The strip studies use those structural ideas, without reproducing the institution's named cloths or asserting their symbolism. [5](https://new.artsmia.org/programs/teachers-and-students/teaching-the-arts/artwork-in-focus/asante-kente-cloth)
- **FIT Fashion History Timeline, bògòlanfini.** The article discusses patterned grids, narrow strips, chevrons, crosses, dashes and decorated end borders. These informed earth-tone panel/mark arrangements—not an attempt to reproduce culturally specific ceremonial motifs. [4](https://fashionhistory.fitnyc.edu/bogolanfini/)
- **V&A, _Africa fashion: cloth of a continent_.** Its bògòlanfini discussion describes geometric negative-space patterning and the off-white/brown palette associated with the dyeing process. That informed the contrast treatment of the Earthmark studies. [2](https://www.vam.ac.uk/articles/cloth-of-a-continent-africa-fashion)

The earlier user-supplied vivid nested-diamond rug informed **Chromatic Diamond Tapestry**: a large central diamond, flanking medallions, broad blue/red/yellow/green bands, finer inset marks, stepped corners, comb/chevron fields and hooked guard borders. This is an original reconstruction of the composition idea, not a pixel trace or exact reproduction of that textile.

### Islamic carpets and rug structures

- **The Metropolitan Museum of Art, _Carpets from the Islamic World, 1600–1800_.** The essay and object images distinguish medallion, vase, garden, geometric and flowing vegetal carpet designs. This informed separate composition plans instead of treating Islamic carpet design as nested stars alone. [1](https://www.metmuseum.org/essays/carpets-from-the-islamic-world-1600-1800)
- **The Met, Carpet with a Compartment Design, 10.61.3.** Its description relates geometric star-based compartments to curvilinear ornament, cartouches and bookbinding-style borders. The new compartment studies use those organizational ideas without copying the artifact's figural imagery. [2](https://www.metmuseum.org/art/collection/search/445996)
- **The Met, “Medallion Ushak” Carpet, 08.173.13.** Its repeating ogival medallions and smaller stars, cut by a border, informed ogival fields and alternating focal arrangements. These are labeled studies, not historical Ushak reproductions. [4](https://www.metmuseum.org/art/collection/search/445311)
- **Smarthistory, The Ardabil Carpet.** The article and detail photographs show the relationship between a central medallion, surrounding ovals, dense floral decoration, cartouche borders and echoed corner pieces. This informed the radial plan and ornament hierarchy of **Saffron Rosette Court**. No inscriptions, lamps or photographic fragments were copied. [5](https://smarthistory.org/the-ardabil-carpet/)
- **The Met, Dragon Carpet.** The museum contrasts the strong geometry of village Caucasian carpets with flowing court florals. This informed the hooked/stepped geometric rug group and its distinction from the floral salon designs; it does not claim to reproduce the artifact's dragons. [1](https://www.metmuseum.org/art/collection/search/447580)
- **Kilim, Turkish rug overview.** Its discussion of stars, diamonds, hooked forms and medallions supplied additional vocabulary for the geometric rug studies. No symbolic or authenticity claims are attached to the generated motifs. [3](https://www.kilim.com/kilim-wiki/what-is-a-turkish-rug)

## Implementation and editing

`src/rugDesigns.js` contains the 108 explicit blueprints and study-source links. Each selects a composition plan, primary and secondary motifs, border system, focal treatment and field subdivision. `src/rugCompositions.js` renders the blueprints into ordinary `alloy.pattern.v1` vector layers. It does not fetch images or make random variations at runtime.

Composition plans include central, triple, vertical and cross medallions; radial satellites; offset strips; unequal patchwork; compartments; canals; trellises; ogival fields; stepped bands; arches; trees; and vase groups. The motif vocabulary includes hooked/stepped diamonds, spirals, divided lozenges, combs, patterned strips, rings, interlace, eight-/twelvefold stars, lobed medallions, flowers, palmettes, leaves, paisleys and branching vines. Fine stems, buds, inlay marks and multiple guard bands add hierarchy around the large motifs.

Use **108 detailed compositions** in the library, or filter **African compositions**, **Islamic carpets**, or **Rug atelier**. **Composition designer** controls:

- Detail level: Open / Detailed / Intricate. This changes subdivisions and fine ornament—not opacity.
- Border width: 28–76 design units.
- Patterned field, focal structure, corner ornaments and ornamental border. Focal/corner controls are shown only on applicable layouts.
- Existing palette controls edit matching pigments across vector layers. Individual layers retain their material, roughness, metalness and relief controls.

Regeneration replaces generated geometry identified by `ornamentRole`. It preserves matching role colors/finish assignments, manually added non-generated layers and stitch overlays, plus the document's name and mapping settings. Newly appearing roles start with the recipe defaults; manually edited generated paths are replaced. Undo/redo covers these changes. Adding enough custom layers can exceed the 64-layer limit; that fails explicitly without replacing the document.

Generated compositions reserve at most **61 layers**, leaving room for the three-layer stitch overlay. Paths are chunked below 100,000 characters instead of silently truncating detail. Normalized detail/border extremes are covered by tests. Compound paths group ornamental regions, not each flower into a separate layer.

## Finite rugs and rendering limits

These new rugs use `tileAxes: "none"`: a single framed composition with no wrapped vector copies, and clamp-to-edge on both GPU texture axes. Their export is labeled **Export rug SVG**. This keeps the opposite edge from bleeding into a border and avoids repeating the entire composition into itself. Changing mapping/repeat scale can crop or stretch the terminal pixels; these are not declared seamless repeating fabrics. The old repeatable textile and one-way fade modes are retained.

SVG remains scalable and editable. Live material sampling remains finite (normally 1024² for a single tile); tiny filigree can become subpixel. UV shape/aspect affects the design on a mesh. Wool is shader relief and sheen, not groomed yarn geometry, antique wear reconstruction, fringe or a knot-by-knot physical simulation. The Rug preview now starts from a more frontal, centered camera; other preview geometries and material kernels are unchanged.

Validation: 21 targeted pattern/editor/library/composition tests and one standalone test with external assets blocked. Tests cover 108 distinct color-independent geometry signatures, full JSON roundtrips, path/layer limits at dense boundary settings, finite texture wrapping, assignment and stitch preservation, UI controls/undo, actual rug rendering, wool baking and independent exported shader helpers. This is targeted validation, not a claim that all historical tests were rerun or that the materials are measured textile reproductions.
