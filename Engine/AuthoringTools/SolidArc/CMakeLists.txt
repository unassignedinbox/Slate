#============================================================================================================================================
# Engine/AuthoringTools/SolidArc/CMakeLists.txt — the SolidArc workbench root.
#
# This mirrors the Frontier engine's own build order: the vendored ImGui is patched before any unit
# translates (a `git submodule update` restores the pristine tree and silently discards the patches, which
# is exactly how they once disappeared), GLFW builds from the pinned source, the editor links the patched
# docking ImGui through the GLFW and OpenGL3 backends, and the console tool joins as a subdirectory with
# its own dependency-free build untouched.
#
#   cmake -S Engine/AuthoringTools/SolidArc -B build-solidarc        # everything: editor + console tool
#   cmake --build build-solidarc --target SolidArcEditor
#   ctest --test-dir build-solidarc                                  # includes the editor shell proof
#
# The console tool also still builds standalone, with no dependencies at all:
#   cmake -S Engine/AuthoringTools/SolidArc/Editor/AuthoringTools/Modelling/SolidArc -B build-solidarc-console
#============================================================================================================================================

cmake_minimum_required(VERSION 3.20)
project(SolidArcWorkbench LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(TOOLROOT "${CMAKE_CURRENT_SOURCE_DIR}")
set(SOLIDARC_TOOL "${TOOLROOT}/Editor/AuthoringTools/Modelling/SolidArc")
set(IMGUI_ROOT "${TOOLROOT}/ExternalPackages/imgui")

# ─── The console tool, its verification suite, and its own dependency-free build ───────────────────────────
add_subdirectory("${SOLIDARC_TOOL}" SolidArcTool)

if(NOT EXISTS "${IMGUI_ROOT}/imgui.cpp")
    message(STATUS "[SolidArc] ExternalPackages/imgui is not seated — building the console tool only.")
    message(STATUS "[SolidArc] seat the editor dependencies with: python3 Tools/Build/Bootstrap.py")
    return()
endif()

# ─── ImGui patches — Frontier's divergence, applied before anything is compiled ────────────────────────────
find_package(Python3 COMPONENTS Interpreter)
if(Python3_Interpreter_FOUND AND EXISTS "${TOOLROOT}/Tools/Build/ApplyImGuiPatches.py")
    execute_process(
        COMMAND "${Python3_EXECUTABLE}" "${TOOLROOT}/Tools/Build/ApplyImGuiPatches.py"
        WORKING_DIRECTORY "${TOOLROOT}"
        OUTPUT_VARIABLE IMGUI_PATCH_OUTPUT
        ERROR_VARIABLE  IMGUI_PATCH_OUTPUT
        RESULT_VARIABLE IMGUI_PATCH_RESULT)
    if(NOT IMGUI_PATCH_RESULT EQUAL 0)
        message(FATAL_ERROR "[SolidArc] ApplyImGuiPatches.py failed; refusing to configure against a half-patched ImGui:\n${IMGUI_PATCH_OUTPUT}")
    endif()
    message(STATUS "[SolidArc] ImGui patches applied")
else()
    message(WARNING "[SolidArc] Python3 or Tools/Build/ApplyImGuiPatches.py absent - building against pristine ImGui")
endif()

# ─── GLFW — built from the pinned source (static) ───────────────────────────────────────────────────────────
set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_DOCS     OFF CACHE BOOL "" FORCE)
set(GLFW_INSTALL        OFF CACHE BOOL "" FORCE)
add_subdirectory("${TOOLROOT}/ExternalPackages/glfw" "${CMAKE_BINARY_DIR}/glfw" EXCLUDE_FROM_ALL)

# ─── The patched docking ImGui — core plus the GLFW and OpenGL3 backends ────────────────────────────────────
add_library(SolidArcImGui OBJECT
    "${IMGUI_ROOT}/imgui.cpp"
    "${IMGUI_ROOT}/imgui_draw.cpp"
    "${IMGUI_ROOT}/imgui_tables.cpp"
    "${IMGUI_ROOT}/imgui_widgets.cpp"
    "${IMGUI_ROOT}/backends/imgui_impl_glfw.cpp"
    "${IMGUI_ROOT}/backends/imgui_impl_opengl3.cpp")
target_include_directories(SolidArcImGui PUBLIC "${IMGUI_ROOT}" "${IMGUI_ROOT}/backends")
target_compile_definitions(SolidArcImGui PUBLIC FRONTIER_DEVELOPMENT IMGUI_DEFINE_MATH_OPERATORS)
if(MSVC)
    target_compile_options(SolidArcImGui PRIVATE /W4 /permissive- /utf-8)
    target_compile_definitions(SolidArcImGui PRIVATE NOMINMAX)
else()
    target_compile_options(SolidArcImGui PRIVATE -Wall -Wextra -Wno-unused-function)
endif()

# ─── The shared editor panels and the SolidArc editor host ─────────────────────────────────────────────────
add_library(SolidArcEditorUi STATIC
    "${TOOLROOT}/Engine/Editor/ControlPanel.cpp"
    "${TOOLROOT}/Engine/Editor/OutlinerPanel.cpp"
    "${TOOLROOT}/Engine/Editor/ViewportPanel.cpp"
    "${TOOLROOT}/Engine/Editor/InspectorPanel.cpp"
    "${TOOLROOT}/Engine/DisplayPresentation/GlyphSpace.cpp"
    "${TOOLROOT}/Engine/DisplayPresentation/VectorCodec.cpp"
    "${SOLIDARC_TOOL}/Editor/SolidArcOutlinerInterchange.cpp"
    "${SOLIDARC_TOOL}/Editor/SolidArcEditorHost.cpp")
target_link_libraries(SolidArcEditorUi PUBLIC SolidArcImGui SolidArcConsoleKit)
target_include_directories(SolidArcEditorUi PUBLIC
    "${TOOLROOT}" "${TOOLROOT}/Engine"
    "${SOLIDARC_TOOL}" "${SOLIDARC_TOOL}/Presentation")
if(MSVC)
    target_compile_options(SolidArcEditorUi PRIVATE /W4 /permissive- /utf-8)
    target_compile_definitions(SolidArcEditorUi PRIVATE NOMINMAX)
else()
    target_compile_options(SolidArcEditorUi PRIVATE -Wall -Wextra -Wpedantic -Wno-unused-function)
endif()

# ─── The windowed editor — one GLFW window, the patched ImGui on the OpenGL3 backend ───────────────────────
find_package(OpenGL REQUIRED)
add_executable(SolidArcEditor "${SOLIDARC_TOOL}/Editor/SolidArcWindowHost.cpp")
target_link_libraries(SolidArcEditor PRIVATE SolidArcEditorUi SolidArcImGui glfw OpenGL::GL)
target_include_directories(SolidArcEditor PRIVATE
    "${TOOLROOT}" "${TOOLROOT}/Engine"
    "${SOLIDARC_TOOL}" "${SOLIDARC_TOOL}/Presentation"
    "${TOOLROOT}/ExternalPackages/glfw/include")
if(MSVC)
    target_compile_options(SolidArcEditor PRIVATE /W4 /permissive- /utf-8)
    target_compile_definitions(SolidArcEditor PRIVATE NOMINMAX)
else()
    target_compile_options(SolidArcEditor PRIVATE -Wall -Wextra -Wpedantic -Wno-unused-function)
endif()

# ─── The headless editor shell proof — the CPU mirror the gallery sheets come from ─────────────────────────
add_executable(EditorDockingVerification "${SOLIDARC_TOOL}/Verification/EditorDockingVerification.cpp")
target_link_libraries(EditorDockingVerification PRIVATE SolidArcEditorUi)
target_include_directories(EditorDockingVerification PRIVATE
    "${TOOLROOT}" "${TOOLROOT}/Engine"
    "${SOLIDARC_TOOL}" "${SOLIDARC_TOOL}/Presentation")
if(MSVC)
    target_compile_options(EditorDockingVerification PRIVATE /W4 /permissive- /utf-8)
    target_compile_definitions(EditorDockingVerification PRIVATE NOMINMAX)
else()
    target_compile_options(EditorDockingVerification PRIVATE -Wall -Wextra -Wpedantic -Wno-unused-function)
endif()
enable_testing()
add_test(NAME EditorDockingVerification
    COMMAND $<TARGET_FILE:EditorDockingVerification> "${TOOLROOT}/VisualProof/SolidArcEditor"
    WORKING_DIRECTORY "${TOOLROOT}")
