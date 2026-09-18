#!/usr/bin/env bash
# Build Slate-owned Project-Zero content from the procedural Showcase authoring source.
#
# usage: bash Tools/Scripts/BakeProjectSpace.sh [project-directory]
#        bash Tools/Scripts/BakeProjectSpace.sh --build-only
#
# The baker reads/writes no glTF and has no Vulkan dependency. It produces:
#   <project>/Project-Zero.projectspace                 TOML project manifest
#   <project>/Content/Space/Showcase/Materials/*.material  TOML materials
#   <project>/Content/Space/Showcase/Geometry/*.geometry   checksummed binary FSPC geometry
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BuildOnly=0
if [ "${1:-}" = "--build-only" ]; then BuildOnly=1; shift; fi
if [ "$#" -gt 1 ]; then
    echo "usage: bash Tools/Scripts/BakeProjectSpace.sh [project-directory]" >&2
    exit 2
fi
Out="${1:-Projects/Project-Zero}"
Tool="Build/SpaceBake"

if [ ! -x "$Tool" ] || [ -n "$(find Exhibits/Workbench/ProjectFormat Engine/ContentInterchange -newer "$Tool" \( -name '*.cpp' -o -name '*.h' \) -print -quit 2>/dev/null)" ]; then
    mkdir -p Build
    echo "[BakeProjectSpace] building CPU-only SpaceBake"
    g++ -std=c++20 -O2 -Wall -Wextra -Werror -Wno-array-bounds -Wno-maybe-uninitialized -DFRONTIER_CPU_PORT \
        -ffunction-sections -fdata-sections -Wl,--gc-sections \
        -I Engine/GeometricRaster -I Engine/DeviceExchange -I Engine/ContentInterchange \
        Exhibits/Workbench/ProjectFormat/SpaceBake.cpp \
        Engine/ContentInterchange/SpaceCodec.cpp Engine/ContentInterchange/SpaceExport.cpp \
        Engine/ContentInterchange/SpaceToml.cpp Engine/ContentInterchange/ShowcaseStructure.cpp \
        Engine/DeviceExchange/OrientationClassifier.cpp \
        -o "$Tool"
fi

[ "$BuildOnly" -eq 1 ] && exit 0
"$Tool" "-Out=$Out"
