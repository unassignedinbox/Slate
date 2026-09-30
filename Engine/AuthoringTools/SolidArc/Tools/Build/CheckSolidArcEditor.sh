#!/usr/bin/env bash
# SolidArc editor gate for environments without CMake: seats the pinned vendor (the docking ImGui with
#   Frontier's five tab patches, and GLFW), compiles the editor host, the shared panels, the windowed GLFW
#   host and the headless proof with the compiler directly, then runs the proof so every gate it carries
#   fails loudly. Writes the gated sheets into VisualProof/SolidArcEditor/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/Editor/AuthoringTools/Modelling/SolidArc"
PROOF_OUT="${1:-$ROOT/VisualProof/SolidArcEditor}"
CXX_BIN="${CXX:-g++}"

if ! command -v "$CXX_BIN" >/dev/null 2>&1; then
    echo "[SolidArcEditor] SKIPPED — no C++ compiler ($CXX_BIN) on PATH"
    exit 0
fi

cd "$ROOT"

# ① The pinned vendor: the same two packages and the same five ImGui patches the Frontier engine seats.
#    Bootstrap is idempotent; ApplyImGuiPatches verifies its own stack afterwards.
python3 Tools/Build/Bootstrap.py >/dev/null
python3 Tools/Build/ApplyImGuiPatches.py --verify >/dev/null

WORK="$(mktemp -d /tmp/SolidArcEditorGate.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
PROOF_FOLDER="${SOLIDARC_PROOF_FOLDER:-$WORK/proofs}"
mkdir -p "$WORK/obj" "$PROOF_FOLDER" "$PROOF_OUT"

FLAGS=(-std=c++20 -Wall -Wextra -Wpedantic -Wno-unused-function -DFRONTIER_DEVELOPMENT
       -I"$ROOT" -I"$ROOT/Engine" -I"$SRC" -I"$SRC/Presentation"
       -I"$ROOT/ExternalPackages/imgui" -I"$ROOT/ExternalPackages/glfw/include"
       "-DSOLIDARC_PROOF_FOLDER=\"$PROOF_FOLDER\"")

# ② The tool's own console kit — the document the editor panels speak through.
CORE=(
    Kernel/CurveSpecification.cpp
    Kernel/SurfaceSpecification.cpp
    Kernel/TopologySpecification.cpp
    Kernel/SkinSolver.cpp
    Kernel/IntersectionSolver.cpp
    Kernel/FairPatchSolver.cpp
    Kernel/ProfileSolver.cpp
    Kernel/ConstraintSolver.cpp
    Kernel/ConstraintGraph.cpp
    Kernel/MirrorSolver.cpp
    Kernel/BlendSolver.cpp
    Kernel/TweakSolver.cpp
    Kernel/FaceEditSolver.cpp
    Presentation/SoftwareRaster.cpp
    Presentation/ScenePresentation.cpp
    Interaction/CameraProjection.cpp
    Interaction/SnapResolution.cpp
    Interaction/InputEvent.cpp
    Interaction/HotkeyChart.cpp
    Interaction/ToolSession.cpp
    Interaction/TransformGizmo.cpp
    Document/SceneDocument.cpp
    Document/FigureRecipe.cpp
    Document/UndoSequence.cpp
    Console/CommandCodec.cpp
    Console/ConsoleHost.cpp
    Console/ConsoleInteraction.cpp
    Console/ConsoleSelection.cpp
)

OBJECTS=()
for REL in "${CORE[@]}"; do
    OBJ="$WORK/obj/${REL//\//_}.o"
    "$CXX_BIN" "${FLAGS[@]}" -c "$SRC/$REL" -o "$OBJ"
    OBJECTS+=("$OBJ")
done

# ③ The shared editor panels, the CAD interchange, the editor host, the patched vendor ImGui, and the
#    headless proof itself.
EDITOR=(
    Engine/Editor/ControlPanel.cpp
    Engine/Editor/OutlinerPanel.cpp
    Engine/Editor/ViewportPanel.cpp
    Engine/Editor/InspectorPanel.cpp
    Engine/DisplayPresentation/GlyphSpace.cpp
    Engine/DisplayPresentation/VectorCodec.cpp
    Editor/AuthoringTools/Modelling/SolidArc/Editor/SolidArcOutlinerInterchange.cpp
    Editor/AuthoringTools/Modelling/SolidArc/Editor/SolidArcEditorHost.cpp
    Editor/AuthoringTools/Modelling/SolidArc/Verification/EditorDockingVerification.cpp
    ExternalPackages/imgui/imgui.cpp
    ExternalPackages/imgui/imgui_draw.cpp
    ExternalPackages/imgui/imgui_tables.cpp
    ExternalPackages/imgui/imgui_widgets.cpp
)
for REL in "${EDITOR[@]}"; do
    OBJ="$WORK/obj/${REL//\//_}.o"
    "$CXX_BIN" "${FLAGS[@]}" -c "$ROOT/$REL" -o "$OBJ"
    OBJECTS+=("$OBJ")
done

PROOF_BIN="$WORK/EditorDockingVerification"
# shellcheck disable=SC2086
"$CXX_BIN" "${OBJECTS[@]}" -o "$PROOF_BIN"

# ④ The windowed GLFW host and the two vendor backends compile against the pinned GLFW headers and the
#    private OpenGL loader. Linking them needs the platform GL libraries and is the CMake route's job;
#    this gate proves the windowed source translates against the same pinned vendor. GLFW_INCLUDE_NONE
#    keeps glfw3.h from pulling the platform GL headers, which a header-less gate environment lacks —
#    the platform backend references no GL entry point.
WINDOW_FLAGS=("${FLAGS[@]}" -DGLFW_INCLUDE_NONE)
WINDOW=(
    Editor/AuthoringTools/Modelling/SolidArc/Editor/SolidArcWindowHost.cpp
    ExternalPackages/imgui/backends/imgui_impl_glfw.cpp
    ExternalPackages/imgui/backends/imgui_impl_opengl3.cpp
)
for REL in "${WINDOW[@]}"; do
    "$CXX_BIN" "${WINDOW_FLAGS[@]}" -c "$ROOT/$REL" -o "$WORK/obj/${REL//\//_}.o"
done

# ⑤ The proof writes its gated sheets and reports its own chart; its exit code is the gate's.
"$PROOF_BIN" "$PROOF_OUT"

echo
echo "[SolidArcEditor] GREEN — editor shell proof sheets are in $PROOF_OUT"
