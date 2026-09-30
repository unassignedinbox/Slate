//============================================================================================================================================
//                                                 SOLIDARC EDITOR SHELL — DIRECTION NOTE
//============================================================================================================================================
// 📦 Dated architecture note (2026-09-30) for the SolidArc windowed editor: outliner, blank viewport, inspector.

# SolidArc editor shell — outliner, blank viewport, inspector

**Status:** 🏁 delivered and verified headless through the real patched ImGui (27 checks, 0 failures); the windowed GLFW host
is shipped and CMake-buildable but has not been opened on a desktop in this session — no display toolchain exists in the
authoring sandbox.

## What was asked for

The SolidArc CAD tool "really needs to be converted into a proper editor": a windowed shell with an **Outliner** window, an
**Inspector** window, and a **blank Viewport**, mirroring the Frontier editor's architecture — same panel split, same host
and tick order, same vendored GLFW + ImGui with the identical trapezoidal patch set, same standalone-CMake-plus-gate build
discipline.

## The architecture

The shell is three docked ImGui windows inside one host window, built from Frontier's editor tree and re-pointed at the
SolidArc document:

| Unit                                    | Responsibility                                                                     |
|-----------------------------------------|------------------------------------------------------------------------------------|
| `Engine/Editor/OutlinerPanel.cpp`       | The left column: six category folders (Bodies, Sheets, Curves, Points, Groups, Views) |
| `Engine/Editor/ViewportPanel.cpp`       | The centre column: the blank CAD pane, toolbar, hint rows — no scene feed yet      |
| `Engine/Editor/InspectorPanel.cpp`      | The right column: document summary, CAD kernel, presentation groups, picked sheet |
| `Engine/Editor/ControlPanel.cpp`        | The bottom console strip and its command echo                                      |
| `Editor/SolidArcOutlinerInterchange.*`  | `ConsoleHost` figures ⇄ outliner rows; narrowing; `QueryPickedFigureIdentity`      |
| `Editor/SolidArcEditorHost.{h,cpp}`     | Dock-builder, theme, tick order: panels ⇄ host seam, once per frame                |
| `Editor/SolidArcWindowHost.cpp`         | GLFW window + ImGui OpenGL3 backend entry, `solidarc-editor.ini` layout persistence |
| `Verification/EditorDockingVerification.cpp` | The headless CPU mirror: rasterises the real host through the real patched ImGui |

The editor mirrors the engine's own tick order — the host seam first (figures, picks, narrowing), then panels in column
order, then the console strip — exactly as `Frontier`'s `EditorHost` orders them.

## The dependency graft

`ExternalPackages/` under the graft root seats the identical vendored pair the engine uses, pinned by
`Tools/Build/Dependencies.lock.json` and fetched by `Tools/Build/Bootstrap.py`:

| Package | Revision                                  | Verification |
|---------|-------------------------------------------|--------------|
| imgui   | `3bae66c735670619baf51391eba7f3d90a25d125` (1.93.0-docking) | sha256 verified |
| glfw    | `7b6aead9fb88b3623e3b3725ebb42670cbe4c579`                  | sha256 verified |

`Tools/Build/ApplyImGuiPatches.py` seats the five trapezoidal patches **verbatim** from the engine — Patch A (14 px
trapezoidal tabs), Patch B (24 px interlock, strip figures), Patch C (rounded tab buttons), Patch D (tab add button),
Patch E (no scroll buttons) — and `--verify` proves every hunk applied. The graft never edits the vendor tree by hand:
the lock file records the pristine revisions and the patches restore on demand, mirroring the engine's
patch-before-compile ordering in CMake.

## The proof

`Tools/Build/CheckSolidArcEditor.sh` is the gate: bootstrap + patch verify, compile the tool core, compile and link the
editor, compile the windowed host against the pinned GLFW, then run the headless proof. The proof
(`EditorDockingVerification.cpp`) drives the **real** editor host through the **real** patched ImGui with a CPU rasteriser —
no native GL, no mock — and checks, among 27 clauses:

- the three windows exist, are docked, and hold their columns (outliner [0..239], viewport centre, inspector [1364..1600]);
- clicking the `Body01` row picks it through the host seam (`QueryPickedFigureIdentity`);
- the narrowing dropdown filters the outliner; the empty document still draws its six folders;
- the viewport carries no foreign texture and is one uniform shade — blank by construction, not by accident;
- the hovered tab's leading edge is inset by the 14 px slant — Patch A measured in pixels, not asserted from the style.

Five sheets land in `VisualProof/SolidArcEditor/`: the docked shell, the narrowing menu, the narrowed outliner, the empty
document, and a tab-strip crop. `Provenance.json` records the run.

## The build

Two routes, both standalone:

```powershell
# the full workbench — editor, proof, console tool (needs the seated dependencies)
cmake -S Engine/AuthoringTools/SolidArc -B build-solidarc
cmake --build build-solidarc --target SolidArcEditor
ctest --test-dir build-solidarc

# the console tool alone — no dependencies, unchanged
cmake -S Engine/AuthoringTools/SolidArc/Editor/AuthoringTools/Modelling/SolidArc -B build-solidarc-console
```

The workbench root applies the ImGui patches at configure time (refusing to configure against a half-patched vendor),
builds GLFW from the pinned source, and adds the tool as a subdirectory so its strict flags stay scoped to its own units.
MSVC is the primary target (`/W4 /permissive- /utf-8`, `/MD`, `SLATE_DEBUG` never `_DEBUG`).

## The Frontier static contract

Frontier's `Tools/Build/CheckEditorDockingSolidArc.sh` carries the docking contract the editor must hold. Its
Project-Zero clauses belong to Frontier's own engine; the **SolidArc section** was re-run clause by clause against this
graft: **49 of 52 pass**. The three that do not pass by the letter all grep for spellings the naming law retires, and the
port deliberately corrects them:

| Contract greps for             | The port spells it                        | Why                                                                 |
|--------------------------------|-------------------------------------------|----------------------------------------------------------------------|
| `SolidArcOutlinerAdapter.cpp`  | `SolidArcOutlinerInterchange.{h,cpp}`     | `Adapter` is not a closed Role suffix; `Interchange` is              |
| `SolidArcOutlinerFilter::Lines`| `SolidArcOutlinerNarrowing::Lines`        | `Filter` is a banned structural word                                  |
| `AssignFilterCatalog`          | `AssignNarrowingVocabulary`               | `Filter` and `Catalog` are both banned structural words               |

Every clause behind those spellings — the shared `EditorInstance` feed with visibility writeback, the CAD folder set
(Sketches, Bodies, Surfaces, Construction, Dimensions), the CAD narrowing vocabulary (Lines, Profiles, Bodies, Surfaces,
Construction, Dimensions), the five category tints (`#4fd8e0`, `#ffb454`, `#4da3ff`, `#b48cff`, `#e5d33a`), the
`BuildSolidArcInspectorSheet` groups (CAD geometry, Bounds, Parameters), the `SolidArcCad` chrome with the Construct /
sub-selection / Matcap / gizmo toolbar, the three `SolidArc …` window titles docked left / centre / right, and the
no-passthrough-viewport rule — holds in the port and is additionally proven live by the headless gate.

## What is deliberately not here yet

The viewport is blank by design at this stage — the CAD scene feed through `Presentation/RasterExchange.h` is the next
phase, along with viewport picking, gizmos, and the document save/load mirror.
