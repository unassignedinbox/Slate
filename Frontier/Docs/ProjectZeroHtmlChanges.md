# Project Zero HTML changes and deferred C++ mirror

## Working agreement

- Make and review editor changes in `Experimental/ProjectZeroEditor` first.
- Keep this document as the cumulative change record for subsequent requests.
- **Do not mirror changes into C++ until the user says the HTML changes are finished.**
- Record browser verification separately from native verification. A browser check does not prove a C++ fix.
- Preserve the approved SolidArc and Fluid work.

## Change register

| ID   | Requested change                                    | HTML progress                     | C++ progress                               |
| ---- | --------------------------------------------------- | --------------------------------- | ------------------------------------------ |
| C001 | Native-style Construct presentation                 | Implemented; awaiting user review | Deferred until the HTML review is finished |
| C002 | Ctrl+A opens Construct; Shift+A must not open it    | Implemented and browser-checked   | Bug recorded; no native change made        |
| C003 | Blank checkerboard with constructed representations | Implemented and browser-checked   | HTML-only preview, not a renderer change   |
| C004 | Distinct filled inspector quick-action icons        | Implemented and browser-checked   | Deferred until the HTML review is finished |
| C005 | Redesigned viewport header                          | Implemented and browser-checked   | Deferred until the HTML review is finished |

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

## Next review

Await the user's review of this batch. Append subsequent requests to this document, keep their native status deferred, and obtain the final go-ahead before starting the C++ mirror.
