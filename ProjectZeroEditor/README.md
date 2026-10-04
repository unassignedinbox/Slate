# Project Zero — Editor UI (HTML redesign)

A faithful HTML/CSS/JS port of the native Frontier **Project-Zero editor** (the
C++ ImGui editor in `Frontier/Engine/Editor/` on branch `arena/01a0fd48-slate`),
replicated 1:1 from the engine sources and the CPU reference proofs in
`Exhibits/Gallery/Editor/`, then completed with the artwork and entities the
native build was missing. **Not** based on the `Frontier/Experimental/` UI.

Run: `python3 -m http.server 8000` in this folder, open `http://localhost:8000`.

## Replicated exactly from the C++ (first pass)

| Area | Source of truth |
|---|---|
| Style tokens (colours, radii, trapezoid tab sheet, slant 14 / height 24) | `EditorStyleSpecification.h` |
| Outliner: title + "Showcase · N nodes", Visible/Hidden census tiles, search `Ctrl+Shift+F`, Filter popup (Lights / Sky / Bodies / Geometry / Camera with the exact pill tints), chips, 38 px rows (8 + 16 × depth indent, 11 px radius, 30 px icon box), status discs, census foot bar, five-column REALTIME / QUALITY / SUN / MOONS / CAM footer | `OutlinerPanel.cpp`, `EditorHost.cpp` |
| Viewport rail: F brand tile, dock pair, Add menu (exact `##addmenu` items), Edit / Simulate / Play mode pill with transport that only arrives while running, Persp + FOV pill, Markers, Live/Held/Static status + accumulated samples, 2 px convergence hairline (teal filling → blue refining) | `ViewportPanel.cpp::RecordBar`, `Docs/Design/ViewportHeader.html` option A |
| Command line: the 15 verb words, usages and help strings, the nine sayable examples, entity rows ("GEOMETRY · FIND AND FRAME") — all verbatim and all executable | `ViewportPanel.cpp` `kVerbs` / `kExamples` |
| Transform gizmo: translate cones + corner quads (cyan/magenta/yellow, 0.28→0.55 opacity) + billboarded white ring; rotate 31° annular arcs; scale cylinders; tints `#e01414 #12d40a #1560e0`; Blender drag rules, Ctrl snaps 0.25 u / 0.1× / 5° | `GizmoFigures.h` (the Slate `References/Gizmo.html` figures) |
| Inspector: artwork + name + caps category + lock/eye, section cards (the Sun LIGHT sheet exactly as the Inspector proof: Intensity 32.0 lx + switch, Colour #FFFFFF, AIM −Z nadir), the INSTANCE panel (VISIBLE / LOCKED / DYNAMIC / PHYSICS pills, TYPE, ID #NNN), NOTES, "Light · dynamic — FPS · TRIS" foot | `InspectorPanel.cpp`, `EditorProof_Inspector` |
| Construct overlay (Tab): CONSTRUCT / FRONTIER crumb, 01 Entities > 02 Properties, search, All / Environment / Weather / Cameras / Geometry / Lighting, 116 px tiles, properties slide with "Enable in world" | `NativeConstructPanel.h` |
| Control Center (`` ` `` or gear): the eight quick tiles with the proof's exact labels (GI: 2 Bounces, Refl: Raytraced, Anti-Aliasing, FPS Overlay, Notifications, Standard, Patches: Off, Raytracing) + resolution slider | `ControlCentreHost.cpp`, `EditorProof_Shade` |
| Viewport scene: sand + blue sky + long soft shadows + path-traced grain that converges with the sample counter; nav-axis ball cluster; status bar FPS · ms · TRIS · INSTANCES · CAMERA | `EditorProof_Views/Filtered/Menu` |

Every entry renders as its own coloured primitive in the viewport
(one colour per entry, as the showcase field does).

## Improvements on top (second pass)

- **Missing icons filled in**: `tyre`, `rim`, `vehicle`, `cloth`, `suspension`,
  plus the artwork the native build reported as rejected/fallback
  (Clouds, Local Cloud, Local Fog, Height/Atmospheric Fog) — all drawn in the
  outliner's own glyph grammar (24-unit viewBox, stroke 1.6, round caps).
- **New roster entities** using them: a Vehicle rig (Body, Tyre FL/FR/RL/RR,
  Rim Set, Suspension) and a Cloth sheet — visible in the outliner, the
  viewport, the Construct catalogue and the Add menu ("Generators" group).
- Everything is **live**: eye toggles, filters, search, rename, instance
  pills, property sliders write back to the scene; the command line really
  finds/moves/rotates/scales/hides/adds/deletes; Add spawns entities;
  gizmo drags transform the selection; the shade's tiles restart accumulation.

Keys: `Tab` Construct · `` ` `` Control Center · `⌘K` command line ·
`Ctrl+Shift+F` search · `Shift+A` add · `W/E/R` gizmo · `F` frame ·
`Alt+S/P` simulate/play · `Space` pause · `Esc` stop/close.
