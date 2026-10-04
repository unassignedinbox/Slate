# Frontier Texture

An experimental, browser-resident texture authoring editor: paint an **OpenPBR Surface** texture set straight onto a model,
with a full layer stack, Substance-style masks and SVG/text decals. It shares its shell, theme and conventions with the
[Frontier fluid app](https://github.com/unassignedinbox/Slate/tree/ed7d5dfbda50ee856ad27471767c1f06197a0c18/Frontier/Experimental/Fluid)
— same DM Sans chrome, same rounded panels, same slider pills — but the subject is surfaces rather than gas.

```
cd Frontier/Experimental/Texture
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/, fonts and all
npm test           # 42 unit tests, no browser required
```

There is no build step in the sources: every module is plain ESM with relative specifiers and every asset address is a
`new URL(..., import.meta.url)`, so the checked-out tree runs straight off any static host. From a browser, with nothing
installed:

```
https://raw.githack.com/unassignedinbox/Slate/<branch-or-commit>/Frontier/Experimental/Texture/index.html
```

If the browser will only offer a CPU rasteriser — Chromium's SwiftShader, reached with `--enable-unsafe-swiftshader` —
the editor recognises it, authors at 512² instead of 1024² and stops asking for retina pixels, which keeps it usable
rather than merely alive.

`RendererCheck.html` sits beside the editor: a dependency-free page that asks the browser for WebGL 2, WebGL 1, Canvas 2D
and a WebGPU adapter and prints what came back. If it cannot get a context, nothing on the web can on that machine.

Requires WebGL 2 and floating-point render targets (`EXT_color_buffer_float`, or `EXT_color_buffer_half_float`). If the
context is refused the viewport says why — the browser's own refusal message, whether WebGL 1 is present, the renderer
string — and lists what to do about it. It then retries quietly a couple of times, because a browser waiting to be
relaunched for an update keeps its GPU process down and usually has it back a second later. A context lost mid-session
raises the same panel and rebuilds the renderer when the browser restores it.

---

## What it does

**Twelve channels, four targets, one stroke.** Every layer writes into the same twelve OpenPBR channels at once, packed
into four RGBA8 render targets:

| Target | R | G | B | A |
| --- | --- | --- | --- | --- |
| 0 | `base_color.r` | `base_color.g` | `base_color.b` | `geometry_opacity` |
| 1 | `specular_roughness` | `base_metalness` | `ambient_occlusion` | `height` |
| 2 | `specular_weight` | `coat_weight` | `coat_roughness` | `fuzz_weight` |
| 3 | `emission_color.r` | `emission_color.g` | `emission_color.b` | `transmission_weight` |

Colour channels are stored sRGB-encoded, scalars linear, all of them UNORM8. The tangent-space normal map is derived from
`height` at export, so there is no separate normal channel to keep in sync. Each layer carries a per-channel write mask:
a layer can own roughness and metalness without touching colour.

**Layer stack.** Visibility, lock, opacity, ten blend modes (normal, multiply, screen, overlay, add, subtract, darken,
lighten, difference, linear-burn), drag reorder, duplicate, delete, double-click rename, and a mask per layer. Each row is
a card: the layer's colour plate, its kind, blend and channel count, the opacity read large, and a pair of chips —
**Content** and **Mask** — naming where the next stroke will land. Rows keep their full height however many there are:
the stack scrolls inside the panel rather than squeezing, with the heading, filters and footer staying put. Five kinds
of layer:

- **fill** — a flat value per channel, the base of most materials.
- **stroke** — painted coverage, written by the brush, eraser and flood tools.
- **generator** — seven procedurals (fbm, cells, scratches, weave, wood, checker, gradient) and five surface signals
  (curvature, cavity, occlusion, inclination, altitude), each with scale, detail, contrast, balance, warp, angle and seed.
- **decal** — SVG or text artwork, either stamped into the texture or placed on the surface as a movable 3D decal.
- **finish** — a procedural material: automotive paint, fabric, metal or plastic, evaluated per texel.

**Procedural materials.** A material layer is a recipe rather than a colour. Four families, nineteen presets on the
shelf, and one inspector that renames itself to suit the family:

| Family | Styles | What the inspector asks about |
| --- | --- | --- |
| Automotive | metallic flake, candy pearl, matte wrap, primer | flake scale, flake density, flake brightness, clear coat, flake angle, pigment variation |
| Fabric | plain, twill / denim, satin, knitted rib, velvet | thread count, thread spread, fuzz, sheen, weave angle, thread variation |
| Metal | brushed, hammered, cast and pitted, galvanised spangle | grain scale, pitting, relief, polish, lacquer, brush angle |
| Plastic | injection moulded, pebbled grain, soft touch, polycarbonate | grain scale, grain density, grain depth, gloss, clear coat |

The recipe writes nine channels per texel — colour, roughness, metalness, occlusion, height, specular weight, coat
weight, coat roughness and fuzz — so those rows in the Channels group read *written by the material recipe* rather than
offering a flat slider that would be a lie. Occlusion and specular weight keep their sliders, because the material's own
value is scaled by them. Everything else about the layer is unchanged: blend, opacity, a mask, reorder, and paint on top.

**Masks.** A mask is multiplied into the layer's coverage: black conceals, white reveals, the same way Substance Painter
does it. Four kinds — **painted** (a greyscale image the brush writes), **generator** (any of the twelve procedurals) and
**colour** (keys on the colour already composited beneath the layer, with a tolerance, a softness and an eyedropper), or
none at all. A layer with no mask shows a dashed *Add mask* chip; clicking it attaches a black mask and aims the brush at
it in one step, so the layer disappears and you paint it back.

The mask can be looked at three ways — from the toggle floating at the top of the viewport, from the same switch in the
Mask group, or by cycling `⇧ M`:

- **Off** — the shaded surface.
- **Overlay** — the shaded surface with a tint washed over whatever the mask hides. The surface stays live, so you paint
  the mask and watch the wash retreat.
- **Mask** — the mask on its own in black and white.

Generator and colour masks have no image behind them, so a pass of their own resolves whichever kind the layer carries
into a preview target before the viewport samples it: what you see is what the compositor applied, inversion included.
`M` flips the brush between content and mask while painting and the stack footer always states which one is live. Masks
are undoable with the rest of the stack, and a removed mask frees its image so the next one starts clean.

**Content browser.** A drawer across the foot of the viewport — drag its tab, press `B`, or use the grid button in the
viewport bar; it settles closed, half or full. The library column on the left walks Materials (the four finish families
plus the multi-layer surface presets), Decals (signage, marks, plates, grunge and the ten type families), Generators
(procedural and baked) and Scene (surfaces and lighting). The shelf on the right searches, switches between tiles and
rows, and one click puts the thing into the document: a material layer, a decal layer, a generator layer, a new mesh or
a new environment.

Painting on a layer that cannot hold coverage inserts a stroke layer above it rather than refusing the stroke. The stack
is capped at 64 layers.

**Surface constants.** Eighteen surface-level constants that are uniform over the model — specular
IOR and colour, anisotropy, coat IOR and darkening, fuzz colour, thin-film weight/thickness/IOR, transmission colour and
depth, emission luminance, normal intensity, height scale — live beside the painted channels in the **Material** tab and
travel with the descriptor at export.

**Decals.** Fourteen vector presets plus anything you paste: SVG markup is sanitised (scripts, `foreignObject`, `on*`
attributes and `javascript:`/`data:text/html` URLs are stripped) before it is rasterised at 1024². Text decals set in any
of ten OFL families from `EngineContent/FontArchives`.

**Two kinds of decal.** The first row of the Placement group decides which one a layer is, and the add menu offers
both outright:

- **Stamped into the texture** — every click burns the artwork into the layer's own image, oriented to the face it
  landed on. From then on it is paint: the eraser takes it off, the brush works over it, undo lifts the last stamp, and
  with the mask as the target the stamp lands in the mask instead. This is what a new decal layer does.
- **Placed on the surface · 3D** — the artwork stays a projector that lives on the model. A click puts it down, a drag
  slides it along the surface, it keeps following the face normals it is sitting on, and its frame, size, rotation and
  angle limit can be edited forever after.

A placed decal layer holds **one piece of artwork and up to thirty-two marks** of it. The layer opens with one mark
waiting — nothing is composited until you click the model, and the preview shows exactly where it will land. After that
the decal tool drops another mark wherever you click and slides it while you drag; each mark keeps its own frame, size,
rotation, softness, emboss and **colour** — the artwork is treated as a stencil and painted in the mark's colour, so one
channel carries the whole decal — and marks can be hidden, duplicated, reordered and dropped into named folders. They
composite bottom to top inside the layer, exactly the way the stack does, above anything stamped into it.

**The tool follows the layer, and the rail only offers what fits.** Select a paint layer and the brush is in hand, with
the brush, eraser and flood in the viewport rail; select a decal layer and the decal tool is in hand, with the brush and
the flood taken away. The camera and the texel picker are always there, and <kbd>1</kbd>–<kbd>6</kbd> for a tool the
layer cannot use is ignored rather than obeyed. Aim at the mask and the paint tools come back for any layer, because a
mask is paintable whatever the layer underneath is. A tool you reached for yourself is respected: an eraser or a flood
stays put as you move between paint layers, and orbit is never taken away from you.

**Masks take the value of the colour in hand.** A mask holds coverage, not colour, so a stroke into one carries the
brightness of the swatch: a pale colour reveals the layer, a dark one hides it, and the eraser clears what is there. The
mask chip on the row — and <kbd>M</kbd>, and the viewport toggle — put you in mask paint mode straight away, adding a
mask to the layer if it has none; the one it adds is the one your colour will show against, black for a light colour and
white for a dark one, so the first stroke is always visible. Decals obey the same rule: with the mask as the target a
stamp burns the artwork into the mask at the value of its tint.

**Previews, not guesses.** The cursor ring on the model is filled with the colour the stroke would lay down — the value
of that colour when the mask is the target, a dark wash for the eraser — and off the mesh it becomes a dashed outline that
follows the pointer. With the decal tool in hand the artwork itself is drawn where it would land, hairline footprint and
all, before the click that commits it. Symmetry draws too: the mirror button in the viewport bar (or <kbd>S</kbd>)
cycles off → X → Y → Z, the seam where the plane cuts the model is drawn in green, and the mirrored cursor shows the
twin stroke.

**Objects and UDIM tiles.** A document holds a scene, not a single mesh. The outliner above the stack lists every
object — select, rename (double-click), hide, isolate, add and remove — and each object owns a UDIM tile, numbered the
usual way (`1001` is the first, `1002` is one column right, `1011` is one row up). Every visible object is built,
transformed and folded into **one** surface whose UVs have been pushed into their tiles, so a single bake, a single
spatial index and a single stroke serve the whole scene: a brush dragged across a seam paints both objects, and the
sheet stays square so texels stay square. Isolating simply reassembles the scene without the others. Clicking an object
with the camera tool selects it; the texture view draws the tile grid over the sheet with each tile's number and owner.

**Layers that belong to an object.** Every layer carries a scope: the whole scene by default, or one object. A scoped
layer only paints its object's tile of the sheet, so a decal on the bonnet cannot bleed onto the wheel. The button above
the stack switches between *Whole scene* and the selected object — scoped, the stack lists that object's layers over the
scene-wide ones and follows the outliner as the selection changes, and anything added while it is on (or while the
object is isolated) belongs to that object.

**Timeline and branches.** The fourth inspector tab reads the session back as a story: every stroke, layer, material,
decal, generator and surface change becomes a typed event on a vertical rail — coloured node, badge, short hash,
timestamp, and a colour chip when the edit had a colour. The head follows undo and redo, and events past it dim rather
than vanish. Editing after stepping back **forks a branch** instead of discarding the future, so one document can carry
several versions of itself; the pills at the top switch between them, `+` forks on the spot, and up to eight branches
live side by side.

**The `.pigment` document.** Save (<kbd>Ctrl S</kbd>, the timeline's Save button, or the export dialog) writes one JSON
document holding the project record, the camera pose and the whole branching timeline. Opening one restores all three,
and the flat `.texture.json` files earlier builds wrote still open.

**Export.** Three presets — the full OpenPBR channel set, glTF metallic-roughness (ORM-packed), or a three-image compact
set. Each writes one PNG per channel named `<project-name>_<Channel>.png` next to a JSON descriptor tagged
`"specification": "OpenPBR Surface 1.1.1"`, which is the shape the engine's `ContentInterchange/MaterialCodec` reads.

---

## Keyboard

| | | | |
| --- | --- | --- | --- |
| Orbit / brush / eraser | <kbd>1 2 3</kbd> | Content ⇄ mask (adds one if needed) | <kbd>M</kbd> |
| Flood / decal / pick | <kbd>4 5 6</kbd> | Mask view: off → overlay → mask | <kbd>⇧ M</kbd> |
| Brush size | <kbd>[</kbd> <kbd>]</kbd> | Texture space | <kbd>X</kbd> |
| Brush size, live | <kbd>Alt</kbd> + wheel | Frame the surface | <kbd>F</kbd> |
| Search layers | <kbd>/</kbd> | Content browser | <kbd>B</kbd> |
| Undo / redo | <kbd>Ctrl Z</kbd> / <kbd>Ctrl ⇧ Z</kbd> | Save `.pigment` / export | <kbd>Ctrl S</kbd> / <kbd>Ctrl E</kbd> |
| Symmetry: off → X → Y → Z | <kbd>S</kbd> | | |

The **right button always paints** into the selected layer, whichever tool is in hand, so the camera can stay on the
left button. Middle-drag and <kbd>Space</kbd>-drag pan; a click that never becomes a drag selects the object under it.

---

## Modules

| File | Role |
| --- | --- |
| `TexturePanel.js` | The panel: stack, masks, inspector, content browser, tools, documents, shortcuts, dialogs. |
| `ChannelSpecification.js` | The twelve channels, their packing, encodings, blend and export orderings. |
| `MaterialSpecification.js` | Surface constants, material presets, the six-light environments. |
| `GeneratorSpecification.js` | Procedural and surface-signal generators and their parameter ranges. |
| `FinishSpecification.js` | Procedural material families, their styles, named controls and the preset shelf. |
| `LayerSpecification.js` | Layer, mask and decal records; sanitisers; project defaults and validation. |
| `DecalSpecification.js` | Vector library, font archive, SVG/text rasterisation. |
| `SurfaceStructure.js` | Built-in surfaces, Wavefront import, tangents, bounds, occlusion, spatial index. |
| `SceneStructure.js` | Object records, UDIM tiles, and the assembly that folds a scene into one surface. |
| `OrbitProjection.js` | Damped orbit camera, framing, panning, picking rays. |
| `ShadingGlsl.js` | Every shader stage and the export slot table. |
| `ShadingIntegrator.js` | The WebGL2 device: targets, stamping, compositing, viewport and plane passes, readback. |
| `StrokeProjection.js` | Brush state, stroke spacing, symmetry, placement frames. |
| `RevisionQueue.js` | Byte-budgeted undo of both painted images and structural edits. |
| `TimelineSequence.js` | Typed timeline events, the head that steps with undo, and the branches a document forks into. |
| `DocumentSequence.js` | Up to four resident documents and their tabs. |
| `ExportSequence.js` | Slot resolve, PNG emission, OpenPBR descriptor. |
| `*.mjs` | Node test files — surface maths, stack semantics, device behaviour and context recovery, against a recording WebGL2 stand-in. |

`TexturePanel.css` holds the editor-specific rules; `ThemeSpecification.css` is the shared Frontier chrome and should stay
in step with the fluid app's copy of the same file.

---

## Limits

Painted coverage is a GPU image: projects store the layer record, materials, decals and camera, not the pixels. Resolution
changes resample painted layers rather than dropping them, but a project reopened in a new session starts from its
generators and materials. Undo is byte-budgeted, so very long paint sessions retire their oldest image snapshots first.
