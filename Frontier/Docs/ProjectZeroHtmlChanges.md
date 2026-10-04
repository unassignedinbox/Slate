# Project Zero HTML changes and deferred C++ mirror

## Working agreement

- Make and review editor changes in `Experimental/ProjectZeroEditor` first.
- Keep this document as the cumulative change record for subsequent requests.
- **Do not mirror changes into C++ until the user says the HTML changes are finished.**
- Record browser verification separately from native verification. A browser check does not prove a C++ fix.
- Preserve the approved SolidArc and Fluid work.

## Change register

| ID   | Requested change                                    | HTML progress                     | C++ progress                                      |
| ---- | --------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| C001 | Native-style Construct presentation                 | Implemented; awaiting user review | Deferred until the HTML review is finished        |
| C002 | Ctrl+A opens Construct; Shift+A must not open it    | Implemented and browser-checked   | Bug recorded; no native change made               |
| C003 | Blank checkerboard with constructed representations | Implemented and browser-checked   | HTML-only preview, not a renderer change          |
| C004 | Distinct filled inspector quick-action icons        | Implemented and browser-checked   | Deferred until the HTML review is finished        |
| C005 | Redesigned viewport header                          | Implemented and browser-checked   | Deferred until the HTML review is finished        |
| C006 | SolidArc-style XYZ transform table                  | Implemented and browser-checked   | Deferred until the HTML review is finished        |
| C007 | Object-bound full material channels and sources     | Implemented and browser-checked   | Native slab and producer integration deferred     |
| C008 | Dockable ShaderEditor and shader-ball preview       | Implemented and browser-checked   | Native shader execution and BSDF preview deferred |
| C009 | Matching top/bottom drawers and page-close gestures | Implemented; mouse/touch checked | Reported native drag problem recorded; mirror deferred |
| C010 | Material, imported-file and engine asset browser | Implemented and browser-checked | Native asset pipeline integration deferred |
| C011 | Viewport-only settings/debug menu | Implemented and browser-checked | Deferred until the HTML review is finished |
| C012 | Entity-relevant circular quick toggles | Implemented and browser-checked | Per-entity shadow/GI/physics bindings deferred |
| C013 | Precipitation icon instead of umbrella | HTML rain-cloud symbol implemented | Native artwork unchanged |
| C014 | Animated composite WindEditor | Implemented; evaluator and browser checked | Native wind field evaluation deferred |
| C015 | Cloud selection of a composite wind field | Implemented and browser-checked | Native cloud advection binding deferred |

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
