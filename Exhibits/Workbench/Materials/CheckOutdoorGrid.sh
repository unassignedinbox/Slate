#!/usr/bin/env bash
# M9 — the outdoor material grid: Project-Zero's open-air scene (sun + sky + scattered casters, each caster its
#    own unique material) plus an 18-ball archetype grid, CPU-rendered (no Vulkan, no GLFW, no submodules):
#      distinct-materials gate + three panels (field / balls close-up / the original PZ camera) + read gates
#      (emission dominates, foil transmits what the solid glass cannot, metals/SSS read their tint).
#    Panels land in Exhibits/Gallery/Materials/OutdoorGrid_{Field,Balls,Original}.png.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1
Fail=0

echo "[OutdoorGrid] compiling (celestial records 1:1 + the real BSDF + the 1:1 tone map)"
Bin="$(mktemp -u /tmp/OutdoorGrid.XXXXXX)"
if ! g++ -std=c++20 -O2 -Wall -Wextra -DFRONTIER_CPU_PORT -I Exhibits/Workbench/Materials \
     -I Engine/DisplayPresentation -I Engine/Shaders -I Exhibits/Workbench/Editor \
     Exhibits/Workbench/Materials/OutdoorMaterialGrid.cpp \
     Engine/DisplayPresentation/ShadingTableCodec.cpp \
     -o "$Bin" -pthread 2>/tmp/OutdoorGrid.build; then
    echo "  OUTDOOR GRID COMPILE FAILED"; sed 's/^/    /' /tmp/OutdoorGrid.build | head -40; exit 1
fi
if ! "$Bin" 2>&1 | tee /tmp/OutdoorGrid.log | grep -q "OUTDOOR GRID: PASS"; then
    echo "  OUTDOOR GRID FAILED"; grep "FAIL" /tmp/OutdoorGrid.log | sed 's/^/    /' | head -20; Fail=1
else
    grep -E "^  \.\." /tmp/OutdoorGrid.log | sed 's/^/    /' || true
fi
rm -f "$Bin"

[ "$Fail" -eq 0 ] && echo "[OutdoorGrid] GREEN — distinct materials + panels + read gates pass" \
                  || echo "[OutdoorGrid] RED"
exit "$Fail"
