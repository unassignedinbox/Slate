#!/usr/bin/env python3
"""Rasterise the REAL SolidArc editor — `Editor/AuthoringTools/Modelling/SolidArc/Editor/SolidArcEditorHost`
driven headless through the same patched ImGui the application ships.

`Exhibits/Workbench/Editor/SolidArcEditorProof.cpp` is the engine's own headless proof for the CAD editor: it
seats `SolidArcEditorHost` — which reuses the very same Frontier `OutlinerPanel`, `ViewportPanel` and
`InspectorPanel` as Project-Zero — builds a small CAD scene through the SolidArc console (a body, a sheet
surface, a sketch line and a construction plane), drives the ImGui docking tick, opens the CAD filter menu and
picks a body, and rasterises the resulting `ImDrawData` for each phase. The viewport inside those sheets is the
SolidArc software raster, not a picture of one.

Nothing about the editor is drawn by this script. It compiles the engine's proof and copies out what it wrote.

The engine's own `Tools/Build/CheckEditorVisualProofs.sh` link line has rotted exactly like the game editor's:
`InspectorPanel.cpp` dispatches to nine `Record*Inspector` translation units and the ThorVG-backed
`IconPresentation` that `OutlinerPanel`/`ViewportPanel`/`SolidArcEditorHost` draw through, and the script's
SolidArc source list never gained them, so it dies at link before a single sheet is written. The corrected list
below is the fix — the additions are the engine's own files, nothing is substituted.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import EngineCheckout as Checkout  # noqa: E402

ROOT = Checkout.ROOT
GALLERY = ROOT / "Exhibits/Gallery/SolidArcEditor"

# The SolidArc tree inside the engine checkout.
ARC = "Editor/AuthoringTools/Modelling/SolidArc"

SOURCES = [
    "Exhibits/Workbench/Editor/SolidArcEditorProof.cpp",
    # the SolidArc modelling kernel the console builds the scene with
    f"{ARC}/Kernel/CurveSpecification.cpp", f"{ARC}/Kernel/SurfaceSpecification.cpp",
    f"{ARC}/Kernel/TopologySpecification.cpp", f"{ARC}/Kernel/SkinSolver.cpp",
    f"{ARC}/Kernel/IntersectionSolver.cpp", f"{ARC}/Kernel/FairPatchSolver.cpp",
    f"{ARC}/Kernel/ProfileSolver.cpp", f"{ARC}/Kernel/ConstraintSolver.cpp",
    f"{ARC}/Kernel/ConstraintGraph.cpp", f"{ARC}/Kernel/MirrorSolver.cpp",
    f"{ARC}/Kernel/BlendSolver.cpp",
    # the SolidArc software raster the viewport panel displays
    f"{ARC}/Presentation/SoftwareRaster.cpp", f"{ARC}/Presentation/ScenePresentation.cpp",
    # SolidArc interaction, document and console
    f"{ARC}/Interaction/CameraProjection.cpp", f"{ARC}/Interaction/SnapResolution.cpp",
    f"{ARC}/Interaction/InputEvent.cpp", f"{ARC}/Interaction/HotkeyChart.cpp",
    f"{ARC}/Interaction/ToolSession.cpp", f"{ARC}/Interaction/TransformGizmo.cpp",
    f"{ARC}/Document/SceneDocument.cpp", f"{ARC}/Document/FigureRecipe.cpp",
    f"{ARC}/Document/UndoSequence.cpp",
    f"{ARC}/Console/CommandCodec.cpp", f"{ARC}/Console/ConsoleHost.cpp",
    f"{ARC}/Console/ConsoleInteraction.cpp", f"{ARC}/Console/ConsoleSelection.cpp",
    # the SolidArc editor shell and its outliner/inspector row mapping
    f"{ARC}/Editor/SolidArcOutlinerAdapter.cpp", f"{ARC}/Editor/SolidArcEditorHost.cpp",
    # the shared Frontier editor panels SolidArc reuses verbatim
    "Engine/Editor/ControlPanel.cpp", "Engine/Editor/OutlinerPanel.cpp",
    "Engine/Editor/ViewportPanel.cpp", "Engine/Editor/InspectorPanel.cpp", "Engine/Editor/ShadeTick.cpp",
    # the nine inspector pages InspectorPanel dispatches to (missing from the engine's own script)
    "Engine/Editor/SunInspectorPanel.cpp", "Engine/Editor/StarsInspectorPanel.cpp",
    "Engine/Editor/AtmosphereSkyInspectorPanel.cpp", "Engine/Editor/CameraInspectorPanel.cpp",
    "Engine/Editor/CloudsInspectorPanel.cpp", "Engine/Editor/FogInspectorPanel.cpp",
    "Engine/Editor/LensFlareInspectorPanel.cpp", "Engine/Editor/MoonInspectorPanel.cpp",
    "Engine/Editor/WeatherInspectorPanel.cpp",
    # the presentation layer the panels draw through (incl. the ThorVG-backed icon presentation)
    "Engine/DisplayPresentation/ControlCentreHost.cpp", "Engine/DisplayPresentation/PixelSpace.cpp",
    "Engine/DisplayPresentation/MotionIntegrator.cpp", "Engine/DisplayPresentation/ThemeStructure.cpp",
    "Engine/DisplayPresentation/ControlKit.cpp", "Engine/DisplayPresentation/AppearanceInspector.cpp",
    "Engine/DisplayPresentation/ConfigurationInspector.cpp", "Engine/DisplayPresentation/DialogueHost.cpp",
    "Engine/DisplayPresentation/FidelityClassifier.cpp", "Engine/DisplayPresentation/VectorCodec.cpp",
    "Engine/DisplayPresentation/NotificationQueue.cpp", "Engine/DisplayPresentation/TelemetryMetrics.cpp",
    "Engine/DisplayPresentation/TypefaceRegistry.cpp", "Engine/DisplayPresentation/GlyphSpace.cpp",
    "Engine/DisplayPresentation/FontCodec.cpp", "Engine/DisplayPresentation/MaterialInspector.cpp",
    "Engine/DisplayPresentation/IconArt.cpp", "Engine/DisplayPresentation/IconPresentation.cpp",
    "Engine/ContentInterchange/AssetResolution.cpp", "Engine/ContentInterchange/MaterialIndex.cpp",
    "Engine/DeviceExchange/InputExchange.cpp", "Engine/GeometricRaster/StarCatalogueIndex.cpp",
    "Engine/GeometricRaster/CameraProjection.cpp", "Engine/DeviceExchange/OrientationClassifier.cpp",
    # the patched vendor the application ships
    "ExternalPackages/imgui/imgui.cpp", "ExternalPackages/imgui/imgui_draw.cpp",
    "ExternalPackages/imgui/imgui_tables.cpp", "ExternalPackages/imgui/imgui_widgets.cpp",
]
INCLUDES = [
    ".", "Engine", "ExternalPackages/imgui", "Engine/Editor", "Engine/DisplayPresentation",
    "Engine/ContentInterchange", "Engine/DeviceExchange", "Engine/GeometricRaster", "Engine/Shaders",
    "ExternalPackages/tomlpp/include", "ExternalPackages/thorvg/inc",
    "Exhibits/Workbench/Editor", "Exhibits/Workbench/Editor/Counterparts", "Exhibits/Workbench/IconArt",
    ARC, f"{ARC}/Presentation",
]

# The proof writes these two sheets into the engine checkout's canonical editor gallery. Each maps to the
#    outliner/inspector state the CAD editor is meant to show: the CAD filter menu over an empty inspector, and
#    a body picked with the full CAD inspector seated.
SHEETS = {
    "EditorProof_SolidArc_Menu.png": "SolidArcEditor_Outliner_CPU_Reference.png",
    "EditorProof_SolidArc.png": "SolidArcEditor_Inspector_CPU_Reference.png",
}


def main() -> int:
    engine = Checkout.seat()
    GALLERY.mkdir(parents=True, exist_ok=True)

    # The vendor patches the application ships must be seated, exactly as every build seats them.
    Checkout.run([sys.executable, "Tools/Build/ApplyImGuiPatches.py"], cwd=engine, quiet=True)
    Checkout.run([sys.executable, "Tools/Build/ApplyImGuiPatches.py", "--verify"], cwd=engine, quiet=True)

    binary = engine / ".cache/SolidArcEditorProof"
    binary.parent.mkdir(parents=True, exist_ok=True)
    compile_command = ["g++", "-std=c++20", "-O2", "-DFRONTIER_DEVELOPMENT", "-DTVG_STATIC", "-pthread",
                       *[f"-I{path}" for path in INCLUDES], *SOURCES,
                       ".cache/icon-art/release/libthorvg.a", "-o", str(binary)]
    print("[solidarc] compiling the SolidArc editor + shared panels + patched vendor ImGui (headless: no Vulkan, no GLFW)")
    Checkout.run(compile_command, cwd=engine, quiet=True)

    # The proof writes into the engine checkout's own gallery; it gates the filtered sheet as it goes.
    destination = engine / "Exhibits/Gallery/Editor"
    destination.mkdir(parents=True, exist_ok=True)
    run_command = [str(binary)]
    result = subprocess.run(run_command, cwd=engine, text=True, capture_output=True)
    log = result.stdout + result.stderr

    written: list[Path] = []
    for produced_name, reference_name in SHEETS.items():
        produced = destination / produced_name
        if not produced.exists():
            print(f"[solidarc] MISSING {produced_name}")
            continue
        target = GALLERY / reference_name
        shutil.copyfile(produced, target)
        written.append(target)
        print(f"[solidarc] {produced_name:<28} -> {target.name}")

    if not written:
        raise RuntimeError("the SolidArc editor proof produced no sheets")

    failures = [line.strip() for line in log.splitlines() if "[FAIL]" in line]
    record = Checkout.provenance(
        proof=("The SolidArc CAD editor, rasterised from the real SolidArcEditorHost tick through the real patched "
               "ImGui. It reuses the engine's own OutlinerPanel, ViewportPanel and InspectorPanel with CAD chrome."),
        scene=("No imported level: the SolidArc console builds a body, a sheet surface, a sketch line and a "
               "construction plane, then the editor is driven through the ImGui docking tick — one sheet with the "
               "CAD filter menu open over an empty inspector, one with a body picked and the full CAD inspector "
               "seated."),
        commands=[compile_command, run_command], results={
            "sheets": [path.name for path in written],
            "gateFailures": failures,
            "note": ("The sheets are real ImDrawData rasterised by the proof's own CPU rasteriser — the widgets, "
                     "theme, fonts, icons and viewport raster are the engine's. Any gate listed in gateFailures is "
                     "an upstream editor regression the sheet still faithfully records; it is not a rendering "
                     "substitution."),
        }, outputs=written)
    (GALLERY / "Provenance.json").write_text(json.dumps(record, indent=2) + "\n")
    print(f"[solidarc] wrote {len(written)} sheets + Provenance.json under {GALLERY.relative_to(ROOT)}")
    if failures:
        print(f"[solidarc] NOTE {len(failures)} upstream editor gates failed; recorded in Provenance.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
