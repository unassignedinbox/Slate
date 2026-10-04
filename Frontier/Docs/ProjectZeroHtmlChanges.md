# Project Zero HTML changes and C++ conversion

## Working agreement

- Make and review editor changes in `Experimental/ProjectZeroEditor` first.
- Keep this document as the cumulative change record for subsequent requests.
- Initial HTML-only gate was lifted on 2026-10-04: the user authorized C++ conversion and native build verification.
- All baking/export controls belong below authoring settings; native work must avoid stack-sized scene storage.
- Record browser verification separately from native verification. A browser check does not prove a C++ fix.
- Preserve the approved SolidArc and Fluid work.

## Change register

| ID   | Requested change                                    | HTML progress                     | C++ progress                                      |
| ---- | --------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| C001 | Native-style Construct presentation                 | Implemented; awaiting user review | Deferred until the HTML review is finished        |
| C002 | Ctrl+A opens Construct; Shift+A must not open it    | Implemented and browser-checked   | Implemented; native shortcut checks pass               |
| C003 | Blank checkerboard with constructed representations | Implemented and browser-checked   | HTML-only preview, not a renderer change          |
| C004 | Distinct filled inspector quick-action icons        | Implemented and browser-checked   | Deferred until the HTML review is finished        |
| C005 | Redesigned viewport header                          | Implemented and browser-checked   | Deferred until the HTML review is finished        |
| C006 | SolidArc-style XYZ transform table                  | Implemented and browser-checked   | Deferred until the HTML review is finished        |
| C007 | Object-bound full material channels and sources     | Implemented and browser-checked   | Native slab and producer integration deferred     |
| C008 | Dockable ShaderEditor and shader-ball preview       | Implemented and browser-checked   | Native shader execution and BSDF preview deferred |
| C009 | Matching top/bottom drawers and page-close gestures | Implemented; mouse/touch checked | Reported native drag problem recorded; mirror deferred |
| C010 | Material, imported-file and engine asset browser | Implemented and browser-checked | Native asset pipeline integration deferred |
| C011 | Viewport-only settings/debug menu | Implemented and browser-checked | Native settings/statistics menu implemented; broader parity pending |
| C012 | Entity-relevant circular quick toggles | Implemented and browser-checked | Per-entity shadow/GI/physics bindings deferred |
| C013 | Precipitation icon instead of umbrella | HTML rain-cloud symbol implemented | Native artwork unchanged |
| C014 | Animated composite WindEditor | Implemented; evaluator and browser checked | Native wind field evaluation deferred |
| C015 | Cloud selection of a composite wind field | Implemented and browser-checked | Native cloud advection binding deferred |
| C016 | Local fog volume shape instead of fixed box bounds | Implemented and browser-checked | Native shape masks/SDF integration deferred |
| C017 | Permanent first Editor Camera | Implemented and browser-checked | Editor Camera pinned/locked; native feed checked |
| C018 | Interactive environment graphs | Implemented and browser-checked | Native Sun/atmosphere plots implemented; remaining graphs pending (C024) |
| C019 | AtmosphereLab atlas and space study | Implemented and browser-checked | Still to mirror; real native dome bake retained |
| C020 | Pill viewport header | Implemented and browser-checked | Existing native pill rail retained |
| C021 | Folder/collection inspector | Implemented and browser-checked | Native census, search and bounded paging; native roster cap unchanged |
| C022 | Resizable statistics/debug card | Implemented and browser-checked | Native card with engine intervals/completed GPU telemetry |
| C023 | Native conversion, bottom baking, stack safety | Approved HTML baseline retained | Initial native checkpoint; see remaining work below |
| C024 | Native Sun and atmosphere graph controls | Approved HTML baseline retained | Eight interactive plots; native input and low-stack checks passed |

## 2026-10-04 — C001: Construct presentation

### HTML changes

Replaced the two-column descriptive list with the structure drawn by
[`NativeConstructPanel.h`](../Engine/Editor/NativeConstructPanel.h):

- Compact Construct window, up to 860 × 760 pixels, with 12-pixel outer clearance on smaller displays.
- `CONSTRUCT / FRONTIER` heading and `01 Entities > 02 Properties` progression.
- Search across entity names.
- A 138-pixel category rail: All, Environment, Weather, Cameras, Geometry, Lighting.
- A multi-column, table-like entity matrix: 116-pixel cells, 8-pixel gaps, 52-pixel native icon artwork, names below the icons.
- Selecting a cell opens the matching inspector in the Properties step; Entities or Escape returns to the selection step.
- In the HTML preview, **Add to scene** confirms construction. Name and property edits are copied into the new outliner entry; Cancel does not create anything.
- Escape works while the search or a property has keyboard focus. Tab stays within the dialog; closing restores the opener's focus.

### Important native distinction for the later mirror

The checked native Construct window selects and activates **existing scene records**. Its source explicitly treats environment records as singletons. The HTML confirmation creates browser-local representations to exercise the requested workflow; this is not proof that native entity creation or environment duplication is supported.

When the C++ work is authorized, preserve those ownership rules and review creation versus activation deliberately. Do not copy the HTML duplication behavior blindly into native environment records.

## 2026-10-04 — C002: Construct shortcut conflict

### Observed source and desired behavior

The user wants Ctrl+A for Construct and Shift+A for fast leftward camera movement.
The checked [`EditorHost.cpp`](../Engine/Editor/EditorHost.cpp) currently opens Construct on **Shift+A**, guarded by `!Steering_` and `!WantTextInput`. Its comment already describes the overlap with boost + strafe left. The former HTML shortcut also used Shift+A.

### HTML fix

- Ctrl+A opens Construct outside editable controls. Cmd+A is supported as the corresponding browser shortcut.
- Shift+A and Shift+W/A/S/D do not open Construct; Shift+A is not consumed by the Construct shortcut.
- Extra Shift/Alt modifiers and repeated keydown events do not trigger this command.
- Ctrl+A retains ordinary Select All behavior in inputs, textareas, selects, and editable content.
- Another open dialog is not bypassed by the global Construct shortcut.

No HTML flight-camera implementation is claimed: the movement chord is left available rather than repurposed.

### Deferred C++ action and acceptance checks

- Replace the Shift-based Construct predicate with the deliberate Ctrl+A chord, while retaining appropriate text-entry and camera-input guards.
- Audit displayed shortcut hints and all other native Construct entry points.
- Verify Ctrl+A opens once, held Shift+A never opens it, and WASD + Shift keeps moving the camera, including entering/leaving steering mode while modifiers remain down.
- Verify Select All in text entry and Escape in both Construct steps.
- **Native implementation, build, and runtime verification are pending explicit authorization after the HTML review.**

## 2026-10-04 — C003: Checkerboard construction preview

- Replaced the static native reference image with a blank, dark checkerboard.
- Each confirmed construction adds a labeled analytical symbol: box, sphere, cylinder, cone, ring, camera outline, light circle, weather symbol, or a circle/label fallback.
- All 23 catalogue entries have a representation. These are SVG previews, not meshes, physics, GPU lighting, or astronomical rendering.
- Selecting a symbol selects the same entry in the outliner and inspector.
- Renaming, visibility, collection visibility, duplication, removal, and browser-local persistence operate on the same entries.
- Generated names are unique; cancelling the Properties step leaves the checkerboard unchanged.
- The original reference outliner is retained for inspector coverage. Only newly constructed preview entries appear on the checkerboard; the viewport footer reports those entries, not the old reference-frame triangle count.
- The blank checkerboard and analytical symbols are **HTML-only stand-ins**. Do not replace the native editor's actual renderer with them during the later mirror.

## Browser verification

Executed on 2026-10-04 using headless Chromium, without building or changing native C++:

- `CheckConstruction.mjs`: all 23 catalogue entries construct selectable symbols; shortcut exclusions; text-field Select All; Escape; six categories; empty search; cancel; carried property edits; unique names; rename, visibility and collection visibility; duplicate/remove; reload persistence; 1024/1280/1440/1920-pixel widths. No browser errors.
- `CheckBrowser.mjs`: existing regression covering 18 inspector sheets, 121 numeric edits, pointer dragging, tab docking and reopening, Control Centre pages, and moon selection. No browser errors.

Visual proofs:

- [Construct matrix](../Experimental/ProjectZeroEditor/Screenshots/ConstructMenu.png)
- [Construct properties](../Experimental/ProjectZeroEditor/Screenshots/ConstructProperties.png)
- [Blank checkerboard](../Experimental/ProjectZeroEditor/Screenshots/Checkerboard.png)
- [Constructed symbols and selection](../Experimental/ProjectZeroEditor/Screenshots/ConstructedScene.png)

## 2026-10-04 — C004: Filled inspector quick actions

- Replaced the repeated small power/orbit glyphs with filled semantic SVG silhouettes. Each action within a quick group has a distinct symbol: fog, wind, cloud, rain, collision, stars, twinkle, sun, disc, orbit, motion, pause, baking, baked image, and optical effects.
- Enabled icons follow the inspector context: fog layers, a cloud, falling rain, or a rainbow rather than the same generic power icon.
- Larger icon seats, rounded tiles, and explicit **ON / OFF / UNAVAILABLE** captions use green, muted red, and grey respectively. Status is conveyed by text as well as colour.
- Retained existing property callbacks, keyboard activation, and native-unavailable disabled states. Styling does not enable baking, imported-image playback, or any disconnected native control.
- Original outliner artwork, inspector graphs, card styling, notch, and trapezoidal document tabs remain intact.

## 2026-10-04 — C005: Viewport header

- Replaced the scattered single-row controls with two grouped rows: scene identity / constructed count / preview badge / Edit–Sim–Play, followed by Construct / frame selected / projection / split / diagnostics / Control Centre.
- Construct is the primary action, with its Ctrl+A hint at wider sizes. Compact layouts remove secondary wording rather than hiding tool buttons. Very narrow dock widths allow the action row to wrap.
- Projection and split view are independent controls; switching the projection preference does not close split view. Projection remains a UI preference for the analytical 2D preview, not a live camera.
- Split, diagnostics, and mode buttons expose their state through `aria-pressed`. F3 / Shift+F3 diagnostics remain synchronized with the toolbar.
- Frame selected is disabled for reference-only or effectively hidden entities. It targets the selected constructed marker, not an engine camera.
- Sim and Play still disclose that no native simulation is connected. The scene counter reports browser-local constructions, not engine entities.
- C++ presentation, icons, and behavior are deliberately **not mirrored yet**.

### Browser verification for C004–C005

Executed on 2026-10-04 using headless Chromium:

- `CheckQuickTools.mjs`: 32 quick-tile instances across 12 inspector sheets; semantic filled SVGs; distinct symbols within each quick group; click and Space activation; ON/OFF/unavailable captions; independent split and projection; diagnostics button plus F3/Shift+F3; exclusive mode selection; Control Centre open/close; Construct and frame eligibility.
- Toolbar bounds and hit-testing checked at 1024, 1280, 1366, 1440, and 1920 pixels wide, including a 1366 × 608 content area. Screenshots wait for the existing notch resize animation to settle.
- `CheckBrowser.mjs` and `CheckConstruction.mjs` rerun successfully, including all 18 inspector sheets, 121 numeric edits, and all 23 construction entries. All three suites reported no browser errors.
- No C++ files changed, native build performed, or native runtime result claimed.

Visual proofs:

- [Fog and wind filled quick icons / viewport header](../Experimental/ProjectZeroEditor/Screenshots/QuickTilesFog.png)
- [Stars: distinct symbols and ON/OFF/unavailable states](../Experimental/ProjectZeroEditor/Screenshots/QuickTilesStars.png)
- [Compact 1024-pixel toolbar](../Experimental/ProjectZeroEditor/Screenshots/Toolbar1024.png)

## 2026-10-04 — C006: Transform table

- Replaced the geometry inspector's read-only position / rotation controls with a compact SolidArc-style table.
- Position, rotation and scale occupy rows; X/Y/Z occupy columns, with units and axis colours.
- Local cloud and local fog bounds use the same table for world-space Centre / Half Size, preserving their native defaults.
- Supports numeric entry, horizontal value scrubbing, Shift precision, row resets, and the existing instance lock.
- Transform drafts are per object and survive selection changes and browser reloads.
- These values are **HTML authoring state**, not native transform matrices or modifications to SolidArc geometry.
  The checkerboard remains an analytical placement preview, not a transformed mesh renderer.

## 2026-10-04 — C007: Object-bound material channels

### Presentation and ownership

- Replaced the geometry inspector's small Surface block with object-bound Material channels.
- Used the supplied traffic-dashboard image for rounded charcoal cards, light typography, pill selectors,
  understated borders, status counters and restrained colour accents. Preserved the existing editor shell.
- Shows all 20 rows from `Engine/DisplayPresentation/MaterialInspector.cpp`: base colour, metallic, roughness,
  reflectance/IOR, orientation, occlusion, emission, opacity, anisotropy, anisotropy direction, coat, coat roughness,
  coat orientation, sheen colour, sheen roughness, subsurface colour, thickness, transmission, refraction IOR,
  and displacement. A searchable list selects the channel editor.
- Material drafts belong to the selected geometry object's surface slot 0. The separate ShaderEditor remains pinned
  to that owner when outliner selection changes; its target selector deliberately changes the owner.
- This does not claim discovery of native shared material assets or multiple resolved submesh slots.
  Non-surface environment / light / camera inspectors retain their existing domain-specific controls.
- Reflectance and refraction share the same IOR carrier, matching the inspected native slab semantics.
- Added Standard, SSR, Glass, Fabric, Metal, Clear coat, Subsurface, Emissive and Unlit profiles.
  Profiles adjust fill defaults while retaining authored gradient, texture and code drafts.
- **SSR is explicitly identified as a reflection route, not a BSDF or a working browser ray-tracing mode.**

### One active source per channel

- **Fill:** typed colour or scalar value, with hex entry, numeric limits and sliders as appropriate.
- **Gradient:** 2–8 stops; add/remove; pointer dragging; keyboard movement; explicit stop position and colour/value;
  U/V direction; linear interpolation. Scalar channels interpolate scalar values rather than RGB colours.
- **Texture:** local PNG/JPEG/WebP selection, replace/remove, RGB or component sampling, and UV repeat.
  Inputs are limited to 8 MB. A maximum 160-pixel image retaining alpha is embedded for the browser preview;
  this is not the original full-resolution texture or a native resource descriptor. No external upload occurs.
- **Code link:** C++, Slang/HLSL or GLSL provider, symbol/entry point, source/integration notes, and stored fill fallback.
  These are unresolved descriptors. No text is evaluated, compiled or executed by the HTML editor.
- Switching sources preserves the other source drafts. Material state and bounded texture previews use the existing
  per-object save/export data. Storage failures now show an explicit warning instead of silently failing.
- Restored material values are constrained to the channel schema; embedded image sources are restricted to data URLs.

## 2026-10-04 — C008: ShaderEditor window and preview

- The material card's expand arrow opens a separate, movable, resizable **non-modal window inside the HTML app**.
- Dock buttons attach it to Left, Centre or Right. The docked ShaderEditor uses the existing trapezoidal tab strip
  and tab drag/drop; Float window undocks it. It can be closed and reopened without discarding material data.
- Owner selection is explicit; missing/deleted owners show a recovery prompt instead of silently editing another object.
- Uses the existing `Exhibits/DistanceFieldGI/ShaderBall.mesh`, embedded by the standalone build: 35,897 vertices,
  67,832 triangles. Mesh provenance is shown in the preview details, following the native exhibit's identification
  of Pseudopode / UnityShaderBall as CC0. No replacement generated illustration is used.
- A browser-side software rasterizer displays the actual mesh with orbit and softbox/warm/cool lighting controls.
  Supported channel edits change preview pixels, including image UV sampling and gradients.
- Preview coverage: colour, roughness, metallic, IOR, occlusion, emission, opacity, coat, sheen, and approximate
  transmission. Orientation, anisotropy, subsurface and displacement are stored but not evaluated by this preview.
- **This is a lighting/authoring study, not the native BSDF, shader compiler, SSR renderer or native shader-ball exhibit.**
  Code-driven channels use their fill fallback until a real producer is connected later.

### Browser verification for C006–C008

Executed on 2026-10-04 using headless Chromium, without a C++ build:

- `CheckMaterials.mjs`: XYZ edit/scrub/reset/lock/persistence; all 20 typed channel rows and nine profiles;
  pinned ownership; shared IOR; channel search; signed scalar typing; gradient editing, limits and retained drafts;
  texture pixel changes, embedded data, failed-decode preservation and removal; code descriptors; floating movement;
  docking/tab dragging/undocking; non-overlapping docked cards; reload persistence.
- Material window layouts checked at 1024, 1280, 1366, 1440 and 1920 pixels wide without horizontal content overflow.
- `CheckBrowser.mjs`: all 18 inspector sheets, now 128 numeric edits, and existing shell/Control Centre regressions.
- `CheckConstruction.mjs`: all 23 catalogue entries, including material roughness carried from the new channel UI
  into the constructed object's inspector. Its selector was updated to the new channel editor, not bypassed.
- `CheckQuickTools.mjs`: prior filled-icon and viewport-toolbar regressions retained.
- All four suites reported no browser errors. No native source files, SolidArc or Fluid files were changed.

Visual proofs:

- [XYZ transform table](../Experimental/ProjectZeroEditor/Screenshots/TransformTable.png)
- [ShaderEditor with gradient and shader ball](../Experimental/ProjectZeroEditor/Screenshots/ShaderGradient.png)
- [Texture source and shader-ball response](../Experimental/ProjectZeroEditor/Screenshots/ShaderTexture.png)
- [Unresolved code producer](../Experimental/ProjectZeroEditor/Screenshots/ShaderCodeLink.png)
- [ShaderEditor docked in the main workspace](../Experimental/ProjectZeroEditor/Screenshots/ShaderDocked.png)

### Deferred native acceptance work

- Resolve real object/submesh/material ownership rather than copying the HTML slot-0 convention.
- Map every channel and its typed source to native slab descriptors; preserve shared IOR semantics and colour spaces.
- Map Glass/Fabric/Metal profiles to native material models and parameters; keep SSR in reflection configuration.
- Connect gradients, full-resolution textures, and authorized native code/shader producers through the appropriate
  resource and compilation paths. The browser's text descriptor is not a compiled or trusted native producer.
- Integrate native transform editing, native docking, and the native shader-ball renderer only after the HTML review
  is finished. Do not replace the engine BSDF with this lightweight browser preview.

## Next review

Await the user's review of this batch. Append subsequent requests to this document, keep their native status deferred, and obtain the final go-ahead before starting the C++ mirror.

## 2026-10-04 — C009–C011: Shared drawers, content library, viewport settings

### C009 — Reference and drawer interaction

Used the user-supplied repository-root [`UI.html`](../../UI.html) reference
(commit `d8a65f8`) for the top/bottom sheet interaction. Its generated demonstration
inventory was **not** used as engine content.

- Both notches now share `DrawerPanel.jsx`: closed, half-open and full-open stops;
  vertical handle dragging; horizontal handle repositioning; distance/velocity
  release snapping; fast flicks; and pointer cancellation.
- Open sheets can be dragged using their blank page surface, header or grip.
  Buttons, fields and independent scrolling regions keep their own interaction.
- Handles support click, Enter and Space; Escape closes the browser or returns
  through the Control Centre pages. Drawers are mutually exclusive and prevent
  interaction with the editor behind them. Focus is contained/restored.
- Settings dialogs and the library fit the visible half-height sheet; their
  contents scroll independently instead of moving the drawer.
- Real touch testing caught and fixed cancellation from bubbling
  `lostpointercapture` when implicit touch capture transfers to the drawer root.

**Native follow-up:** the user reports that their C++ build closes only through
handle presses, not by sliding the open page/handle. Record this as a required
native regression case, not as a browser fix proving the native issue resolved.
`ControlCentreHost.cpp` already contains `GrabSubject::Card` and `Grip` carry
paths. Actual hit routing/body ownership and the running build need verification
when the mirror is authorized; the root cause has not been established here.
No native source changes or native builds were made.

### C010 — Asset Browser

Added a bottom-notch content library with a dark catalogue-style layout,
All/Project/Imported/Engine filters, categories, search, grid/list presentation,
a selected-asset detail pane and previews.

The built-in library contains **179 entries**:

- 9 HTML material-authoring presets (not resolved native slab files).
- 6 embedded moon image previews.
- 2 actual DM Sans font resources, previewed using `FontFace`.
- 161 repository icons.
- The repository shader-ball mesh, shown through the existing browser preview.

Materials can be created, renamed, saved from the selected object, exported,
imported and edited in the pinned ShaderEditor. Editing an engine preset first
creates a project copy. The assignment selector chooses a geometry object;
applying a library material makes an **independent deep copy** rather than a
shared live binding. Later library edits/removal do not alter that object copy.
All previous material channels, source drafts and object-bound ownership remain.

File import keeps the original bytes in browser-origin **IndexedDB**. Images
receive thumbnails and previews; fonts can be previewed; other model/code files
can be catalogued, downloaded and removed, but are not executed or parsed into
native geometry. Reload and byte-identical original-image download were tested.

Limits and storage boundaries:

- 256 project/imported records, up to 32 files per batch, 16 MiB per file and
  2 MiB per imported material JSON. Browser quota limits also apply.
- Scene export contains metadata, thumbnails and material descriptions—not the
  IndexedDB original files. Moving to another browser/origin does not transfer
  those originals; unavailable files are reported. Download originals separately.
- Engine moon downloads are the embedded 512×256 previews, not the source 2K maps.
- Font preview does not change the editor's font. Code remains non-executed.
- The shader-ball remains an approximate browser preview, not native BSDF/SSR
  execution. There is no native asset pipeline or renderer binding in this work.

### C011 — Viewport settings

The viewport header gear no longer opens global Control Centre settings. It now
opens a viewport-only popup for the debug view and Hi-Z, alias and patch-error
controls. Diagnostics remain a separate toolbar toggle. The top notch remains
the entry point for the global Control Centre.

### Browser verification and proofs

Rebuilt the self-contained `index.html` (4.11 MiB). All five suites passed with
`Errors: []` on the final build:

- `CheckBrowser.mjs`: existing settings, scene persistence and inspector checks.
- `CheckConstruction.mjs`: Construct, shortcuts, representations and layouts.
- `CheckQuickTools.mjs`: quick tools and the new viewport-only settings popup.
- `CheckMaterials.mjs`: material channels/sources, ownership, docking and reload.
- `CheckAssets.mjs`: mirrored mouse gestures, real CDP touch, page-close,
  cancellation, flicks, half-height settings, catalogue scrolling, filters,
  create/edit/rename/assign/export, import/reload/exact-byte download/removal,
  invalid image rejection and 1024/1280/1366/1920 layouts.

Committed browser screenshots (not native screenshots):

- [Half-open drawer](../Experimental/ProjectZeroEditor/Screenshots/AssetDrawerHalf.png)
- [Material library](../Experimental/ProjectZeroEditor/Screenshots/AssetBrowser.png)
- [Engine images](../Experimental/ProjectZeroEditor/Screenshots/AssetImages.png)
- [Engine fonts](../Experimental/ProjectZeroEditor/Screenshots/AssetFonts.png)
- [Viewport settings](../Experimental/ProjectZeroEditor/Screenshots/ViewportSettings.png)

**Status:** HTML implemented and verified; awaiting user review. C++ mirroring
remains deferred until the HTML changes are finished and approved.

## 2026-10-04 — C012–C015: Relevant quick tiles and composite wind fields

### C012 — Replace the blanket Instance flags

Removed the generic `INSTANCE` tag card (Visible / Locked / Dynamic / Physics)
that was appearing on inappropriate entities. The replacement uses the existing
filled-icon quick-tile styling with **circular green/red icon seats**:

| Entity | Quick controls |
| --- | --- |
| Geometry | Visible, Dynamic, Cast shadows, GI, Physics, Locked |
| Local lights | Visible, Cast shadows, GI |
| Post Process | Enabled only |
| Collections / generic fallback | Visible only |
| Specialized environment panels | Their existing relevant controls; no blanket physics/dynamic card |

Dynamic off means static. Requesting physics turns Dynamic on; changing to static
turns physics off. Geometry locking retains the existing transform-edit lock.
Visibility continues to use the scene's actual HTML hidden-state map. Shadow/GI
participation and physics are **saved authoring flags**, not claims that the HTML
checkerboard runs a native renderer or rigid-body simulation. Existing stored
values on unsupported entities are not exposed as working capabilities.

### C013 — Precipitation symbol

Replaced the HTML outliner/Construct umbrella with a **filled rain cloud and
falling rain streaks**, tinted pale blue. This shares the precipitation quick
control's semantic symbol. Native icon files and the engine-resource catalogue
have not been rewritten; the native artwork mirror remains deferred.

### C014 — Wind preview and expanded WindEditor

Selecting a wind now shows a live canvas with vector arrows, a smoothly sampled
speed gradient, and animated particles. The expand button opens a two-view editor:

1. **Component placement:** an XZ map, numbered handles, influence-radius
   outlines, mouse/touch pointer dragging and keyboard position adjustments.
2. **Combined vector field:** actual evaluation of all enabled components,
   with independent vector/gradient/particle visibility and pause/resume.

The editor supports multiple separately named wind-field entities. Each field can
contain up to 64 independently named/enabled components:

- **Directional:** uniform background flow, strength and travel bearing.
- **Gust:** local directional flow with smooth radial falloff and a time-varying
  envelope controlled by frequency.
- **Tornado:** local tangential flow plus inward pull, with strength and radius.
- **Radial:** local outward flow with smooth falloff.

All enabled contributions are **linearly summed**, rather than merely drawing
unrelated arrows or choosing one component. Components can be created, selected,
renamed, moved, retyped and removed. Numeric drafts commit on blur/Enter, allowing
negative positions and normal typing of bounded values. Preview width/depth are
editable; directional flow is global, while local influence is controlled by
component radius. Component handles also support arrow keys (10 m per step).

Field descriptors live under `Values[windEntityId].WindField` and therefore use
the existing scene save/export/import mechanism. New fields receive distinct
scene IDs. Unmodified legacy wind speed/bearing/gust seed the initial prevailing
flow and gust. Legacy altitude/shear/veer/turbulence/steadiness descriptors remain
editable in a clearly marked native-draft card, but are not secretly included in
this horizontal evaluator.

**Scope:** this is a deterministic 2D browser authoring/evaluation preview, not a
3D fluid/tornado solver. Speed colours saturate at 30 m/s; particles are visualized
at 8× advection time. There is no vertical tornado simulation, native atmospheric
solver, native terrain interaction or native cloud renderer connection here.

### C015 — Cloud wind-field selection

Global and local clouds now choose a specific wind entity by stable ID through
**Wind binding → Wind field**. The binding previews the selected field's complete
component sum, not just its first component. `Follow Wind` gates the preview;
`None` explicitly means still air. Hidden fields produce disabled output, and a
removed assigned field is reported as missing instead of silently redirecting
the cloud to another field.

The binding's **Edit wind field** button opens that field in WindEditor without
changing ownership to the selected cloud. Edits stay on the wind entity, and
renaming it does not invalidate the cloud's ID reference. Native cloud advection
must consume this binding when the C++ mirror is authorized.

### Verification and evidence

Final standalone HTML build: **4.13 MiB**. All six browser suites passed with
`Errors: []`: `CheckBrowser`, `CheckConstruction`, `CheckQuickTools`,
`CheckMaterials`, `CheckAssets`, and the new `CheckWind`.

`CheckWind.mjs` covers finite evaluation, exact linear summation, radial falloff,
gust time variation, empty/disabled fields, entity-specific toggles, circular
seats, keyboard toggling, physics/static coupling, visibility persistence, the
precipitation symbol, animated pixels, numeric entry, component CRUD, mouse/touch and
keyboard placement, pause/resume, independent fields, cloud-bound editor
ownership, Follow Wind gating, reload, missing fields, still air, Escape/focus
restoration, and 1024/1280/1366/1920 layouts. Existing material tests retain the
transform lock regression using the renamed `Locked` tile.

Committed **browser** evidence:

- [Entity quick tiles](../Experimental/ProjectZeroEditor/Screenshots/EntityQuickTiles.png)
- [Selected wind preview](../Experimental/ProjectZeroEditor/Screenshots/WindInspector.png)
- [Expanded WindEditor](../Experimental/ProjectZeroEditor/Screenshots/WindEditor.png)
- [Actual browser field animation](../Experimental/ProjectZeroEditor/Screenshots/WindFieldAnimation.gif)
- [Cloud field binding](../Experimental/ProjectZeroEditor/Screenshots/CloudWindBinding.png)

**Status:** HTML review checkpoint. No C++ sources were changed and no native
build was run. Native entity capability binding, composite wind evaluation and
cloud advection integration remain deferred until the HTML review is finished.

## 2026-10-04 — C016–C017: Local fog shape and permanent Editor Camera

### Change-log continuity

The previous turn's C012–C015 quick-tile, precipitation-symbol, composite-wind and
cloud-binding changes were committed with this log in `728a579`. The older
`ed7d5df` URL visible in the user's screenshot predates those changes. This
section appends the new corrections; it does not replace or omit the prior log.

### C016 — Local fog takes the selected volume shape

Replaced the fixed `Local bounds` box graphic and editable half-size table with
**Fog volume shape**:

- Box / rectangular volume: width, depth and height.
- Sphere: radius.
- Ellipsoid and diamond / octahedron: width, depth and height.
- Cylinder and cone: radius and height, aligned with Z up.
- Regular polygon prism: radius, height and 3–16 sides.
- Custom polygon extrusion: an editable, ordered XY footprint and Z height.

The wireframe changes with the selected shape and dimensions. World-space Centre
remains editable. **Min, Max and Size are calculated from the actual selected
shape geometry**, including asymmetric custom footprints and polygon prisms;
they are read-only results, not an independent fixed-box authoring control.
The preview auto-fits the volume, while centre edits update the world-bound
readouts. Legacy local-fog `Half Size` values seed box dimensions, preserving
existing volumes on first load. New descriptors persist under
`Values[localFogId].FogShape` and travel with scene export/import.

Custom footprints support 3–32 vertices, including simple concave polygons.
Crossing edges, duplicate adjacent points, zero-area footprints and invalid
coordinates are rejected on Apply without replacing the last valid shape.
Restored descriptors are bounded/sanitized. **Custom currently means polygon
extrusion, not arbitrary imported mesh or SDF clipping.** Native general-mesh/SDF
support remains a separate integration task.

Local Fog's old density illustration is now explicitly labelled as a density
study, not a ray march through the selected volume. This work does not falsely
claim native shape-based fog rendering. Global/aerial fog and Local Cloud's
existing bounds controls are unchanged.

### C017 — The first camera belongs to the editor

The original reserved `camera` entry is now **Editor Camera**, retaining its ID
and optics drafts rather than allocating a second replacement entry. It is the
first camera in the Cameras collection and carries an `EDITOR` badge and an
inspector explanation distinguishing it from scene render cameras.

- Editor Camera cannot be removed, hidden or renamed through context menus,
  outliner visibility controls or F2.
- Scene structure normalization guarantees exactly one reserved editor camera
  after startup, reload, scene import, reset and structural edits. Imports with
  no editor camera—including an empty scene—restore it. Spoofed or duplicated
  reserved rows cannot turn it into a deletable scene entity.
- Construct → Main Camera adds a normal scene camera. Duplicating Editor Camera
  also creates a normal Main Camera with a fresh ID, never a second protected
  editor camera. Ordinary scene cameras remain deletable and renameable.
- Empty-scene import remains valid and retains supplied editor optics settings.

This is an HTML editor ownership/identity policy. It does not implement or change
native viewport navigation, camera switching or the native scene lifecycle.

### Browser verification and proofs

Standalone HTML rebuilt at **4.14 MiB**. All seven suites passed with
`Errors: []`: `CheckBrowser`, `CheckConstruction`, `CheckQuickTools`,
`CheckMaterials`, `CheckAssets`, `CheckWind`, and the new `CheckFogCamera`.

The new suite checks all eight shape descriptors, finite geometry and derived
bounds, legacy half-size conversion, sphere/cylinder extents, prism topology,
custom polygon editing/rejection, centre offsets, scene round-trip, reload and
1024/1280/1366/1920 layouts. Camera checks cover disabled removal/hide/rename,
F2, duplicate and Construct semantics, empty/missing-camera imports, retained
optics and reserved-camera restoration after corrupted/missing stored rows.
Existing camera browser checks now target Editor Camera instead of the old
Main Camera baseline label; Construct continues to target Main Camera.

Committed browser screenshots:

- [Sphere fog shape and derived bounds](../Experimental/ProjectZeroEditor/Screenshots/FogSphere.png)
- [Triangular prism fog](../Experimental/ProjectZeroEditor/Screenshots/FogPrism.png)
- [Custom polygon volume](../Experimental/ProjectZeroEditor/Screenshots/FogCustom.png)
- [Protected Editor Camera](../Experimental/ProjectZeroEditor/Screenshots/EditorCamera.png)

**Status:** HTML review checkpoint. No C++ sources changed and no native build
was run. Native fog-shape masks and permanent editor-camera ownership/removal
rules remain deferred until the HTML review is finished.

## 2026-10-04 — C018–C019: Live environment graphs and AtmosphereLab

### Change-log continuity and scope

C016–C017 were published at `e5f1dbf`; the user's `728a579` screenshot predates
that checkpoint. This update retains the existing environment cards, fog-shape
editor, permanent Editor Camera, wind/cloud bindings, material editor and
geometry workflow. It changes the HTML prototype only. **No C++ sources were
changed and no native build was run.** Materials and geometry do not receive
this new card/graph treatment.

### C018 — Actual data in the existing cards

- **Height Fog:** replaced the unrelated decorative density and transmission
  illustrations with interactive sampled curves. Both use the same altitude
  and distance probe and exponential model:
  `sigma(z) = Density * exp(-max(0,z) / max(10,Falloff Height))`,
  `T(d,z) = 100 * exp(-sigma(z) * d)`. At density 0.02/m, height 2 m,
  falloff 400 m and distance 200 m, transmission is approximately **1.868%**,
  not the old unrelated 92% readout. Disabled fog gives zero extinction and
  100% transmission. The visibility graph represents a horizontal path at the
  selected height, not an integrated sloping ray.
- Drag or touch a graph to set its probe; hover to inspect; arrow keys and
  Home/End provide keyboard control. Density and visibility share saved probes.
  Numerical probe inputs remain available. SVG chart dimensions follow the
  actual card width, keeping axes readable in the narrow inspector.
- **Local and aerial fog:** visibility studies now respond to authored settings.
  Local fog uses an explicitly illustrative `0.01 * Density * Coverage` /m
  coefficient; aerial fog uses `0.001 * Density` /m after Start. These are HTML
  authoring approximations, not recovered native scattering coefficients.
  Local visibility is not ray-marched through the selected shape. Aerial
  spectral transmission now responds to Density, Mie Blend and the shared
  distance probe; its 550 nm sample agrees with the visibility graph.
- **Sun:** the existing daylight card now samples the existing NOAA-style solar
  solver across 24 hours, rather than drawing an unrelated parabola. The
  existing Dynamic settings card gains a 2026 local-noon seasonal curve; dragging
  it edits Month and Day of Month. Sunlight intensity plots `Intensity * Direct`
  as relative gain, explicitly not measured lux. Temperature gains a normalized
  visible Planck spectrum and wavelength probe; RGB mode explicitly treats this
  as the temperature draft, not the active RGB tint's spectrum. No duplicate Sun
  cards were introduced.
- **Atmosphere:** scattering, aerosol haze, ozone absorption and density falloff
  cards now contain interactive wavelength/distance/altitude studies connected
  to their controls. The ozone Gaussian and aerosol attenuation are labelled
  illustrative, not native LUT or measured spectroscopy results.
- **Clouds:** replaced the old generic exponential sketch with an interactive
  vertical density envelope using actual base/centre, thickness, density and
  coverage. The sine-squared profile is explicitly an unlit authoring study,
  not a native volume-field sample. Local Cloud's bounds are now projected from
  its actual Half Size; X/Y/Z handles resize those native fields and derived
  world Min/Max/Size readouts follow Centre. The existing Volume section card
  shows the density study rather than repeating the same fixed box drawing.
  The separate GPU-cloud-shadow controls also receive a live parameter map;
  unavailable runtime march/tap counters remain unavailable.
- **Other cards:** numeric and colour controls are shown in collapsible,
  directly editable SVG parameter-column maps, with exact native-valued
  readouts. Heights represent each control's fraction of its declared range;
  these are authored data, not simulated telemetry. RGB columns edit the
  actual hex colour (including Ground reflectance). This covers environment,
  camera, light and post-processing cards while excluding materials/geometry.
  Existing useful previews, controls, disabled native actions and cards remain.
- Rounded, quieter dark surfaces and subdued fractional digits follow the
  supplied dashboard references, particularly `62c17c83ea725348903581db2a824349`.
  Styling is scoped rather than changing the material/geometry layout.

### C019 — Reconstructed 2D atlas and a space-view study

Searched the current Experimental and broader Frontier source tree for the old
Arctic/smog/Mars atlas, but did not recover its implementation. **This is a
reconstruction, not a claim to have restored the historical atlas or its entire
inventory.** The UI says so explicitly.

A single coloured 2D map plots **Rayleigh strength (0–4)** against **Mie strength
(0–6)**. Its nine representative presets are Arctic clear, Alpine, Temperate
Earth, Tropical humid, Desert dust, Urban haze, Thick smog, Mars-like dust and
Dense golden haze. The colour field is an inverse-distance authoring palette,
not a physically simulated sky colour or exhaustive atmospheric taxonomy.

Named dots/buttons apply complete presets, including scale heights, tint,
ground reflectance, ozone, anisotropy and atmosphere extent. Switching back
from Mars-like restores Earth radius/other defaults instead of leaving stale
planet settings. A preset is active only while its associated settings match.
Dragging empty map space or using its arrow keys edits Rayleigh/Mie and marks
it Custom. Atlas pointer coordinates use the SVG screen transform, including
letterboxing in small cards and compact workbench layouts.

**Atmosphere from space** renders a CPU spherical, single-scatter study with
Rayleigh/Mie terms, approximate ozone absorption, a planet shadow and a
procedural surface. It responds to atmosphere settings, ground colour,
observer altitude, orbit and a preview-only sun angle. It is not the native sky
renderer, real planet imagery, a multiple-scattering solution or a composition-
accurate Mars model. Default limb exaggeration is **8×**, visibly labelled;
1× is available. The preview sun angle is independent of the scene Sun.

Drag/arrow keys orbit; Animate/Pause uses one shared clock between the inspector
and expanded workbench. **Expand AtmosphereLab** presents the atlas and space
view together. The modal makes the editor inert, traps Tab, closes with Escape
and restores focus. It fits the tested desktop widths, with a compact treatment
at 1366×768. Background preview drawing is skipped while the workbench is open.

Probe values, atlas-applied properties and orbit/observer settings use the
existing scene Values/save path. Planet radius and preview controls are HTML
study descriptors, not newly implemented native fields. Baking/LUT fetching
remains explicitly unavailable; no fake bake results were added.

### Verification and committed proofs

Rebuilt the standalone `index.html` (**4.16 MiB**). All **eight** browser suites
passed on the final build: `CheckBrowser`, `CheckConstruction`, `CheckQuickTools`,
`CheckMaterials`, `CheckAssets`, `CheckWind`, `CheckFogCamera`, and the new
`CheckEnvironmentGraphs`.

New checks cover shared fog equations/probes and disabled state, real touch
input and endpoint clamping, mouse/keyboard edits, solar date/time response,
atlas preset completeness and free-map edits, changed canvas pixels for
presets/orbit, animation, modal Tab/Escape/inert/focus restoration, RGB edits,
reload persistence, native local-cloud extent edits, aerial spectral response,
cloud-shadow graphs, and exclusion of geometry/materials. Workbench layout
checks cover 1024/1280/1366/1920 widths; a separate real 1366×768 proof is included.

- [Height Fog — live visibility probe](../Experimental/ProjectZeroEditor/Screenshots/HeightFogVisibility.png)
- [Height Fog — altitude density study](../Experimental/ProjectZeroEditor/Screenshots/HeightFogDensity.png)
- [Sun — seasonal graph in the existing card](../Experimental/ProjectZeroEditor/Screenshots/SunSeasonalGraph.png)
- [AtmosphereLab — atlas and Arctic space study](../Experimental/ProjectZeroEditor/Screenshots/AtmosphereAtlas.png)
- [AtmosphereLab — actual 1366×768 layout](../Experimental/ProjectZeroEditor/Screenshots/AtmosphereDesktop.png)
- [AtmosphereLab — Mars-like preset](../Experimental/ProjectZeroEditor/Screenshots/AtmosphereMars.png)
- [Local Cloud — live bounds and derived extents](../Experimental/ProjectZeroEditor/Screenshots/LocalCloudBounds.png)
- [Environment graph test report](../Experimental/ProjectZeroEditor/Screenshots/EnvironmentGraphs.json)

**Status:** HTML review checkpoint. Native integration, physical calibration,
real volume sampling and native atmosphere rendering remain deferred.

## 2026-10-04 — C020–C022: Header pills, collection inventory and performance cards

### Change-log continuity

The C018–C019 environment graphs and reconstructed AtmosphereLab were published
at `8b13c12` and accepted as looking better. This update retains those cards and
adds the requested header, folder and debug-view changes. It remains HTML-only:
**no C++ sources changed, no native build run, no native timing values invented.**

### C020 — Pill-shaped viewport header controls

Construct, frame-selection, projection, split, diagnostics/settings and the
Edit/Sim/Play controls now use pill rounding. Icon-only actions use short
capsules, with compact sizing in narrower viewports. Existing actions, keyboard
shortcuts, disabled states and pressed-state styling are retained. Document
tabs keep their existing trapezoidal shape; materials and geometry inspectors
are not restyled by this change.

### C021 — Informative folder/collection inspector

Replaced the generic folder panel's static `5 direct · 14 total` readout with
an inventory derived from the actual scene hierarchy:

- Collection name, description, ancestor breadcrumbs and stable identity.
- Total descendant entries, direct children, nested folders and maximum depth.
  Counts include folders and entity attachments, not only geometry leaves.
- Effective visible/hidden counts, including ancestor visibility. The protected
  Editor Camera remains visible. The two visibility cards also filter contents.
- Proportional type-distribution bar and clickable type/count legend. Constructed
  preview marker counts are separate; these are scene records, not renderer
  workload, resident memory, triangle counts or file-size claims.
- Search by name, ID or description; direct-child/all-descendant scope; type
  and visibility filters; name/type/depth sorting; 25/50/100-entry pages. Only
  the current results page is mounted, rather than thousands of inspector rows.
- Each result shows its type, hierarchy level, parent and visibility reason.
  Open an entry to inspect it, expand its ancestors and clear outliner filters
  so the selected row is discoverable. Per-entry visibility uses the existing
  protected-camera policy; an inherited hidden state is explained rather than
  presented as an effective visible toggle.
- Empty/no-match states, filter reset, persistent notes and the existing Tint
  draft. Tint now colours collection accents only, not child objects/materials.

`FolderInventory.mjs` builds indexed parent/identity maps and traverses
iteratively with a cycle guard. The outliner also reuses the child index and
iterative traversal, replacing per-node full-array scans/recursive descent.
The existing outliner remains a tree, not a newly virtualized asset database;
the bounded-page guarantee applies to the new folder contents list.

### C022 — Movable, resizable performance/debug card

The diagnostics header button and existing F3 route now open a rounded dark
performance card, following the supplied dashboard references. Large metrics,
subdued fractional digits, restrained accents and real history replace the
old monospace diagnostic block.

Metric choices:

- **Frame rate / FPS:** actual browser `requestAnimationFrame` cadence.
- **Frame interval / ms:** measured callback intervals, not CPU execution or GPU
  render duration. Half-second samples report mean interval/FPS and latest
  interval p95; window statistics report mean and low/high sampled values.
- **GPU timing:** a clearly unavailable state and unpopulated stage timings.
  There is no native GPU timing connection in this HTML app, so no synthetic
  values or timing graph are shown.
- **Scene counts:** actual scene records, visible/hidden counts, folders and
  constructed preview markers. These are not draw calls or memory telemetry.

Choose **Graph + stats**, **Graph**, or **Stats**, and 15/30/60-second history.
Hover or use arrow/Home/End keys on the graph to inspect recorded samples.
Pause/Resume freezes the browser sample snapshot, not the scene authoring state.
The independent FPS badge now uses the same browser timing sampler. Sampling
runs only while subscribed, and visibility-change handling resets timing
intervals so a suspended/background tab is not counted as one giant frame.

Drag the header to move the card; drag its lower-right handle to resize. Both
handles accept arrow keys (10 px; Shift = 30 px). Layout stays inside the
viewport and adapts when the viewport shrinks. Metric, presentation, history
window, position and size persist in `Frontier.DiagnosticsCard.v1`; live timing
history itself does not persist. Header reset restores the default layout.
Pause/history controls and the resize handle remain in the fixed card footer;
content scrolls when the card is small. Close/Escape restores the diagnostics
button's focus.

Existing native-buffer selections and F3/Shift+F3, F4, F5 and F6 controls remain
available in viewport settings and the card's expandable native-debug details.
They are still selections only, not rendered native buffers. F3 cycles those
buffer selections; the card's metric selector changes its statistics view.

### Browser verification and proofs

Standalone HTML rebuilt at **4.19 MiB**. All **nine** browser suites passed:
`CheckBrowser`, `CheckConstruction`, `CheckQuickTools`, `CheckMaterials`,
`CheckAssets`, `CheckWind`, `CheckFogCamera`, `CheckEnvironmentGraphs`, and the new
`CheckWorkspaceCards`.

New coverage includes pill geometry, actual collection counts, inherited
visibility, persistent notes/tint, a generated **2,500-record browser fixture**,
search/filter/page-size changes, bounded result DOM, drill-through, camera
protection and empty state. A separate pure-model test traverses a
**10,000-level hierarchy** without recursive stack growth (24.9 ms in this
sandbox run; not a native performance guarantee).

Diagnostics checks exercise actual callback samples, deliberately induced
browser main-thread stalls, history probing, pause/resume, metric/presentation
switches, unavailable GPU state, mouse/keyboard movement and resizing,
close/reopen persistence, Escape from a focused select and viewport bounds at
1024/1280/1366/1920 widths. Existing environment, material, wind, fog-shape,
assets, construction and permanent-camera regression suites also pass.

Committed screenshots and report:

- [Folder inventory and resized FPS card](../Experimental/ProjectZeroEditor/Screenshots/FolderDiagnostics.png)
- [Frame-interval graph](../Experimental/ProjectZeroEditor/Screenshots/FrameTimingCard.png)
- [GPU timing — explicit unavailable state](../Experimental/ProjectZeroEditor/Screenshots/GpuTimingUnavailable.png)
- [Large collection summary — generated browser test records](../Experimental/ProjectZeroEditor/Screenshots/LargeCollection.png)
- [Searchable/paginated collection browser — same fixture](../Experimental/ProjectZeroEditor/Screenshots/CollectionBrowser.png)
- [Workspace-card test report](../Experimental/ProjectZeroEditor/Screenshots/WorkspaceCards.json)

**Status:** published HTML review checkpoint. Native GPU/CPU frame telemetry,
renderer-buffer visualization and C++ UI mirroring remain deferred.


## 2026-10-04 — C023: Native conversion begins; baking and stack safety

**This is a partial native checkpoint, not a claim that C001–C022 are all ported.**
The approved HTML baseline remains `95cfb8e68ad25b8aca17d9ee0d5421d168ec19a2`.
User authorization now includes headless native execution, Windows/MSVC and stack checks.

### Implemented in the native editor

- C002: Ctrl+A opens Construct, with no repeat; Shift+A stays available for fast flight.
  Text editing, steering and conflicting modifiers are excluded.
- C011: the viewport gear opens a settings menu, including Statistics/Debug and rendering settings.
- C017: the stock first camera is named Editor Camera and is pinned/locked; generic inspector identity,
  visibility and lock controls cannot change a pinned record. This retains the native camera owner.
- C021: native folder inspector displays real roster totals, direct contents, depth, inherited visibility,
  protected counts, tint and notes. Search, category/visibility narrowing and 25/50/100-row pages are bounded.
  Selecting a result reveals it in the outliner, clearing search/category exclusions and opening enclosing rows.
  The runtime's existing 1,024-row capacity is unchanged; the larger traversal proof is explicitly a fixture.
- C022: native movable/resizable Statistics/Debug window, FPS/frame-interval/GPU selection,
  stats/graph modes, pause/clear, 15/30/60-second sample windows and graph inspection.
  Frame intervals come from the engine clock; GPU values use valid completed timestamp telemetry, not an estimate.
  The old renderer detail rows and F3–F6 shortcuts remain available.
- Sun, Atmosphere/Sky, Lens Flare, Stars and Rainbow baking/export sections now follow properties.
  Actual atmosphere pixels and all their preview selectors move with the bake section.
  The atmosphere request still reaches the renderer queue; Lens Flare still exports the real HDR image.
  Unsupported Sun/Stars/Rainbow targets and flare scene playback remain explicitly unavailable, not fake successes.

### Stack work and verification

- Runtime scheduler/editor, celestial owner and selected sheet are constructed directly in heap-backed storage.
  The sheet alone is 19,392 bytes and the current editor owner is 37,040 bytes on this Linux build.
  No stack reserve increase was used.
- Removed recursive scene-roster traversal and repeated whole-scene scans during traversal. Heap-backed
  adjacency and an explicit pending list preserve preorder and terminate cyclic links through visited records.
  Roster depth is carried by the traversal rather than truncated to eight enclosing links.
- Actual compiled native proof executes under a **262,144-byte Linux stack limit**, including a 10,000-level
  collection fixture, a 10,000-placement real SceneStructure, native camera protection, Construct shortcuts,
  a pointer click on the relocated atmosphere bake button and a 256 × 512 × RGBA16F bake.
  The real `.environment` export/reload also passes with every HDR texel preserved exactly.
- GCC `-fstack-usage` gates the critical compiled UI/traversal functions at 8 KiB each. This is not a measurement
  of the complete Vulkan runtime entry point or a diagnosis of the user's historical crash.
- Native captures are CPU rasterizations of production ImGui commands, with real baked atmosphere pixels.
  Folder and timing records in the proof are labeled fixtures; the proof does not claim GPU execution.
- The native CMake proof route was repaired to compile the consolidated `Engine/Host` sources and current
  shading dependencies rather than removed Project-Zero source paths. Windows MSVC proof job added.
- All four Linux CTest targets passed: bootstrap safety, native renderer/billboards (113 assertions),
  native wind bindings, and the low-stack conversion proof. Final run: 181.17 seconds in this sandbox,
  using production source `28946b3c1ca7f4f1e552921ddbedc180dcdf59cf`.
- The renderer proof had stale assumptions: it expected removed global-system billboards and expected
  zero wind to stop independent density evolution. The proof now locates the actual Markers control by ID,
  tests only physical local-volume proxies, and separately verifies zero bulk velocity and continuing
  procedural evolution. No renderer behavior was changed to make those assertions pass.
- First MSVC proof attempt exposed missing `NOMINMAX` in the CMake proof configuration, not a runtime
  stack overflow. After that fix, MSVC exposed the headless target's accidental Vulkan device dependency:
  the debug-view label function lived in the device implementation. Labels now live beside their enum,
  without duplicating/stubbing any renderer function, and the proof no longer links device creation.
  A subsequent MSVC link identified missing environment codec/export translation units, now linked directly
  rather than stubbed. A Linux link without section garbage collection independently passed as well.
- **Windows/MSVC Release build and native conversion execution passed** on the same source commit:
  [run 37222602604, native editor job 111495857820][NativeMsvcProof]. This executes the real bake and
  export/reload with the default MSVC stack reserve, not an increased reserve. The 256 KiB limit and
  compiler-frame measurements above are Linux-only. The broader full-application job is still pending;
  this result does not claim a complete Vulkan application launch.

[NativeMsvcProof]: https://github.com/unassignedinbox/Slate/actions/runs/37222602604/job/111495857820

Proof sources, captures and compiler stack report: `VisualProof/ProjectZeroNative/` at repository root.

### Still to convert or reconcile

Full native parity still requires the HTML material-channel/source editor and dockable ShaderEditor,
asset-browser expansion and drawer gestures, remaining relevant quick tiles, the composite WindEditor,
local-fog shape masks in the actual renderer, the added interactive environment graphs, and the
AtmosphereLab 2D colour atlas/space study. Existing native environment inspectors and wind-component
bindings are retained, but they are not presented as implementations of the newer HTML composite model.
The new native statistics card also does not yet reproduce every browser-only keyboard/persistence detail.


## 2026-10-04 — C024: Native Sun and atmosphere graph controls

Second native conversion phase, continuing C018 without changing the approved HTML.
This phase replaces decorative studies inside the existing Sun and Atmosphere cards;
it does not add duplicate cards or move baking above authoring controls.

### Implemented

- Sun daylight plot samples the production `CelestialSolver` through 24 local hours.
  Dragging edits Local Hours; the native owner then solves the scene light direction.
- Seasonal plot samples that same solver at 12:00 local wall-clock time, not solar noon.
  Dragging edits Month and Day of Month. It uses the actual native year, UTC offset,
  latitude and longitude rather than a second hard-coded observer.
- Exposed existing native Year and UTC offset alongside the additional Sun settings.
  Calendar writeback clamps actual month lengths, including Gregorian leap-century rules.
- Sunlight gain plots Intensity × Direct and edits the real Intensity property.
  Units remain authored multipliers, not lux. Temperature contains a normalized visible
  Planck spectrum probe, explicitly not the active spectrum when RGB tint is selected.
- Atmosphere scattering retains the approved relative wavelength studies: Rayleigh power −4
  and illustrative aerosol power −1.3. Haze retains the normalized-path attenuation study;
  ozone retains the illustrative 600 nm Gaussian transmission band. These are labelled
  authoring illustrations, not native spectral coefficients, measured visibility or LUTs.
- Density plots both exponential scale heights up to the authored atmosphere extent.
  Native sliders continue through the existing medium writeback. Scattering and ozone
  share a wavelength probe; diagnostic probes do not edit medium settings.
- All eight plots support dragging, hover inspection, arrow keys and Home/End.
  Hover never writes a scene parameter. Diagnostic probe positions live in the inspector's
  UI-session storage; project-file persistence for these probes is not implemented.
- Curve sampling emits bounded line segments without automatic sample arrays or recursive calls.
  Existing baking, preview, export and unsupported-target states remain below the controls.

### Executed verification

Production source: `186f82446cbeb183ffd4e7272f33b880527be710`.

- Linux Release: **4/4 CTest targets passed**, 165.17 seconds total.
  The production CPU renderer still passes 113 assertions; wind and bootstrap checks also pass.
- Conversion execution passed with a **256 KiB stack** and the **8 KiB critical-frame gate**.
  GCC reports Sun inspector 1,840 bytes, Atmosphere inspector 704 bytes and proof entry 1,728 bytes.
  This remains a scoped native proof, not a diagnosis of every possible runtime stack failure.
- ImGui's optional item hooks are enabled only in the proof target. Checks locate actual
  submitted graph items and inject mouse/key input, rather than editing fields to fake a click.
  Pointer tolerances allow one native screen pixel; keyboard endpoints are checked exactly.
- Verified hover non-mutation, real gain/time/date writeback, resulting native solar-direction
  changes, every date in five common/leap/century years, February clamping, spectral and density
  equations, shared probes, and plot bounds in 900 px and 480 px inspector captures.
- Repeated the real bottom bake click, request consumption, heap-backed texture creation,
  `.environment` export/reload with exact HDR texel equality, and scrolling to baking.
- **Windows/MSVC Release compilation and NativeEditorConversion execution passed** for this source:
  [run 37224368522, native editor job 111500910577][EnvironmentMsvcProof]. The MSVC stack reserve
  remains unchanged; the 256 KiB restriction and compiler-frame report are Linux-specific.
  The broader application build for this source is still pending.
  The preceding source `28946b3` also completed its full Frontier/Project-Zero/Project-Drive
  build job successfully before this phase, independently of this phase's new checks.

Captures and execution reports remain in `VisualProof/ProjectZeroNative/`:
`SunGraphs.png`, `SunGraphsNarrow.png`, `AtmosphereGraphs.png`, `AtmosphereGraphsNarrow.png`,
`Verification.log`, `StackUsage.json`, `Regression.log` and `Provenance.json`.
They are actual native ImGui command rasterizations, not browser screenshots or Vulkan readbacks.
`AtmosphereGraphsDetail.png` is an unscaled crop of `AtmosphereGraphs.png` for convenient viewing.

### Still outstanding

C018 is not complete: the remaining fog/cloud studies, cloud bounds handles and generic
parameter-column maps still need reconciliation. AtmosphereLab's atlas/orbital study,
materials/ShaderEditor, asset drawers, composite wind and renderer fog shapes are unchanged
and remain outstanding. This checkpoint does not claim full C001–C022 native parity.

[EnvironmentMsvcProof]: https://github.com/unassignedinbox/Slate/actions/runs/37224368522/job/111500910577

## C025 — SDF artifact reproduction and transport correction (2026-10-04)

### Scope and faithful CPU execution

The user has **not** retested the recent build on their PC. This work investigates their
previous reports of reflection-like diffuse lighting, unstable shadows, and wavy shadow
outlines. `VisualProof/DistanceFieldGI/RunDistanceFieldExecution.py` compiles and executes
the actual production SPIR-V and Vulkan stage on Mesa lavapipe/llvmpipe, with Vulkan
synchronization validation. It does not substitute a separately written CPU renderer.

The fixture supplies raster-style positions and primitive IDs on a 160 × 160 receiver
plane under a rectangular overhead surface. Its images are **diagnostic lighting maps**,
not perspective screenshots of the application or the user's scene. All comparison pixels
come from Vulkan readback, enlarged without filtering. `matte-reference.png` is separately
labelled independent rectangular-emitter irradiance quadrature, used only as an oracle.

### Production changes

- Interpolate unsigned corner distances rather than allowing unrelated nearest-face signs
  to cancel into false zero sheets. The original nearest-face sign was not a solid winding
  classification, particularly around open meshes.
- Refine shadow distance against actual triangles with a stackless BVH traversal; exclude
  the coplanar receiver and confirm central-ray occlusion exactly. Penumbra stepping no
  longer depends on camera-snapped clipmap cells. This is a geometry-refined shadow path,
  not a claim that coarse voxels alone can reproduce thin occluders reliably.
- Combine cosine hemisphere sampling with spatially selected **textured surface-card area
  sampling**, using matching solid-angle PDFs and balance-heuristic multiple importance
  sampling. Source cards retain authored textures, emission and cutout coverage; this is
  not a flattened lighting coefficient or a post-process blur.
- Keep the sampling sequence fixed in world-space transport. Remove the repeating
  sixteen-frame direction cycle in the radiance-cache update. Preserve Jacobi ping-pong
  and material/geometry history invalidation.
- Confirm diffuse traversal against the mesh if the distance-march budget expires.
- Replace the unconditional fixed-Fresnel mirror contribution with the authored base
  specular lobe, GGX visible-normal sampling and its PDF. Zero base specular weight no
  longer creates an unwanted mirror. Roughness, anisotropy and haziness affect this lobe.
  Full coat/fuzz secondary-reflection parity is not established by this correction.
- Skip solar shadow evaluation when solar radiance is zero.

A first attempt that only increased cosine-ray counts still showed stepped diffuse
silhouettes and **failed** the new quality gate. It was not accepted as the finished fix.

### Executed focused measurements

Baseline shaders: `a42147b1148ffa13f08d4d11f42b665a8afb1a0d` (unchanged production shaders).
Corrected shaders: `20409561bdf3fb8d37ec06c9bc14d921314e453b`.
Both were executed with the same fixture in run `37227335799`.
Errors below are in 8-bit red-channel display units, not linear radiance units.

| Measurement | Before | Corrected |
|---|---:|---:|
| Maximum camera-shift shadow RMS, fixed scene/light | 17.476 | 0 |
| Zero-specular reflection-toggle maximum delta | 106 | 0 |
| Symmetric scene's left/right diffuse RMS | 79.2705 | 4.23736 |
| Single-bounce error versus independent area integral | 83.1477 | 2.67571 |

The focused corrected execution passed its numerical gates and Vulkan validation.
The combined workflow exceeded its 20-minute job limit during the broader regression
phase; that is **not** recorded as a complete regression pass. Subsequent proof phases
are split into independent parallel CI jobs. The fixture also retessellates the same
emitter to exercise internal BVH branches and measure dependence on subdivision.

Evidence: `VisualProof/DistanceFieldGI/ArtifactBaseline/`, `ArtifactAfter/`, and
`SdfComparison.png`. Provenance includes source revisions, workflow IDs, shader hashes
and image hashes. Regression evidence has a separate provenance record.

### Completed independent verification

Final harness source: `00681169cb3e2d48067a3a63708b811dfc462245`; its production shaders
are unchanged from `2040956`. All three CPU Vulkan jobs passed in
[run 37228808856](https://github.com/unassignedinbox/Slate/actions/runs/37228808856):

- Baseline reproduction: **passed**, job `111513986487` (4m58s).
- Corrected artifact gates: **passed**, job `111513986626` (9m21s). The measurements above
  repeated exactly. Retessellating the identical emitter from two to six triangles,
  introducing internal BVH branches, changed the single-bounce map by **2.76445 RMS**,
  below the fixed 6-unit gate. The shadow and reflection-toggle maps are byte-identical
  across their respective comparisons, including all RGB channels.
- Full production SDF regression: **passed**, job `111513986649` (6m25s): textured material
  sampling and spatial card radiance, cutouts, emission/material revisions, unresident
  texture refusal, GI switching, moving geometry, camera re-snapping, clean restart,
  actual scene reflections, thin/solid glass and Beer attenuation, resize, and coplanar
  card continuity. Static frame RMS and restart maximum delta are both zero; coplanar
  card maximum neighbour delta is 1. **Zero Vulkan validation errors**, including
  synchronization and destruction checks.
- Windows/MSVC native editor/stack-safe conversion, project browser and Drive checks
  passed for the same harness revision. The broader Windows application build is still
  in progress; its completion is not required or claimed for these CPU-rendered results.

The numerical gates are enforced, not merely printed. Evidence and the cumulative
change record are retained on `arena/01a0fd48-slate`.

### Boundaries

This establishes the artifacts and focused corrections on the production software-Vulkan
path. It does not establish GPU frame time, driver parity on the user's hardware, or
artifact-free output for every scene. The refined shadow queries and additional transport
samples cost more than the old undersampled path; GPU performance remains unmeasured.
The fixture deliberately uses shadow cone slope 0.06; the application's existing default
softness and solar angular-size wiring have not been changed. This phase adds no editor
cards, changes no bake-control placement and does not close C018's remaining native UI work.

## C026 — Independent perspective SDF stress scene; broader fix is incomplete (2026-10-04)

The user requested actual Project Drive/material-grid renders, then selected an **independent custom scene**
when asked about the full shader-ball grid's SDF storage limits. This phase follows that revised request.
It does not claim to have rendered Project Drive or the full material grid.

### Method and captures

- Production shader source is unchanged from C025. Only the proof harness, workflow and evidence changed.
- Headless Vulkan host code was extracted without changing its implementation into `VulkanExecutionHost.h`.
  All three existing production SDF verification jobs passed again after this refactor.
- New scene: 292 triangles, ten instances, a ground plane, coloured walls, stairs, a smooth-normal sphere,
  a movable box, a thin post and a warm emissive ceiling panel. Materials are matte Lambertian with no maps.
  Reflections are disabled to isolate indirect diffuse artifacts. Unit placeholder specular tables are unused
  by these zero-specular/zero-coat/zero-fuzz materials; this is **not** a full material-lobe parity proof.
- Double-precision CPU triangle intersections produce perspective primary positions/primitive IDs from the
  same float geometry submitted to the stage. All material evaluation, SDF construction, card capture,
  radiance propagation, occlusion and final lighting execute the **unchanged production SPIR-V** on CPU Vulkan.
  This is not a rewritten CPU lighting equation or a full-application GPU raster screenshot.
- Readbacks are 384 × 256, with card resolution 4, volume resolution 32, cell size 0.15 m, shadow cone slope
  0.06, sun radiance 1.8, sky ambient 0.005 and 32 cache updates. These settings remain fixed across cases.
  No denoising, image smoothing, exposure adjustment or retouching was applied to the retained pixels.
- Camera variants are front, left orbit, high view and a camera twenty times farther from the target with a
  correspondingly narrower field of view. Geometry cases scale the entire scene and camera by 0.01 and 100,
  or translate both by (+10,000, −25,000, +1,000) m and (+1,000,000, −1,000,000, +1,000,000) m.
- The reference case moves one instance 1.5 m **without recreating the stage**, refreshes production geometry,
  captures its first frame and settled state, then restores it. Camera variants are separately warmed views,
  not a continuous interactive flythrough or a real-time performance demonstration.

Source: `fa6ee1b78051eb6367880a29521b3ae01854451b`.
[CPU scene workflow 37231216029](https://github.com/unassignedinbox/Slate/actions/runs/37231216029)
completed all eight execution jobs with no Vulkan validation errors. This is an **execution pass**,
not an image-quality or scale-invariance pass.

### Independent assessment — FAIL overall

`AssessSceneReadbacks.py` checks matching shader/image hashes and compares 850 identical physical floor
probe locations, excluding footprints hidden by objects. Errors are RGB display units on the 0–255 scale.
The fixed acceptance thresholds are RMS ≤ 1 and maximum channel difference ≤ 5.

| Case                               | Probe RMS | Maximum difference | Invariance result |
|------------------------------------|-----------|--------------------|-------------------|
| Left orbit                         | 0.0443    | 1                  | Within tolerance  |
| High camera                        | 0.0443    | 1                  | Within tolerance  |
| Camera twenty times farther        | 0.0443    | 1                  | Within tolerance  |
| Scene scaled to 0.01                | 9.3287    | 80                 | FAIL              |
| Scene scaled to 100                 | 1.3071    | 17                 | FAIL              |
| Translation (+10k, −25k, +1k) m      | 1.3201    | 17                 | FAIL              |
| Translation (+1M, −1M, +1M) m       | 8.7709    | 94                 | FAIL              |

Restoring the moved instance reproduces the original entire RGB image exactly: RMS 0 and maximum 0.
This does not establish artifact-free lighting during continuous motion.
`AssessSceneReadbacks.py --enforce` returns failure for the four scale/translation cases; thresholds were
not relaxed to turn these into passes. `Assessment.json` explicitly records `overallInvariancePass: false`.

**Visual inspection also fails the broader quality claim:** GI-on renders retain obvious triangular,
patchy/banded indirect lighting on the floor and coloured walls. These artifacts are absent from the
corresponding GI-off lighting. C025's restricted receiver-plane correction is therefore **not a complete
fix for general scenes**, even though its earlier numerical checks and the execution regressions passed.

Fixed world-space ray offsets/tolerances and float world-coordinate precision remain relevant suspects
for scale/translation sensitivity. Finite sampling/card representation remains relevant to the spatial
GI artifacts. This phase records those observations, not a verified diagnosis or a new production fix.
Far/large cases may use the production exact-mesh fallback outside finite clipmaps; their output does not
prove voxel coverage at arbitrary distances. No finite set of captures proves "any scale or distance".

### Retained deliverables

`VisualProof/SdfScene/LightingAndMotion.png` shows GI off/on and live-instance motion.
`VisualProof/SdfScene/ScaleDistanceAndViews.png` shows all eight views/stresses.
Individual unaltered PNGs, logs and source/SPIR-V/image provenance are under `Captures/<case>/`.
`Assessment.json` and the repeatable assessor retain both passing and failing measurements.
The user has not retested these changes on their own GPU; GPU performance and full application parity
remain unverified. No editor layout, baking placement or production shader was altered in this phase.
