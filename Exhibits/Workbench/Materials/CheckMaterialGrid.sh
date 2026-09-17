#!/usr/bin/env bash
# Project-Zero material-grid gate. This is deliberately Vulkan-free at runtime but uses the same interchange TUs as
# CheckMaterialScenes.sh, so the procedural exhibit is tested through the real glTF import path.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1

Vk=""
for candidate in "$PWD/ExternalPackages" "${MATERIAL_SCENES_EXT:-}" "$HOME/.cache/m7"; do
    [ -n "$candidate" ] && [ -f "$candidate/Vulkan-Headers/include/vulkan/vulkan.h" ] && Vk="$candidate" && break
done
if [ -z "$Vk" ]; then
    echo "[MaterialGrid] RED — Vulkan-Headers not found (tried ExternalPackages/, \$MATERIAL_SCENES_EXT, ~/.cache/m7)"
    exit 1
fi
M6=""
for candidate in "$PWD/ExternalPackages" "${MATERIAL_SCENES_EXT:-}" "${MATERIAL_CODEC_EXT:-}" "$HOME/.cache/m6"; do
    [ -n "$candidate" ] && [ -f "$candidate/cgltf/cgltf.h" ] && [ -f "$candidate/ufbx/ufbx.h" ] \
        && [ -f "$candidate/fast_obj/fast_obj.h" ] && M6="$candidate" && break
done
if [ -z "$M6" ]; then
    echo "[MaterialGrid] RED — interchange headers not found (tried ExternalPackages/, \$MATERIAL_SCENES_EXT, \$MATERIAL_CODEC_EXT, ~/.cache/m6)"
    exit 1
fi
Stb=""
for candidate in "$PWD/ExternalPackages/stb" "${MATERIAL_SCENES_EXT:+$MATERIAL_SCENES_EXT/stb}" "$HOME/.cache/m8/stb" "$HOME/.cache/sweep/stb"; do
    [ -n "$candidate" ] && [ -f "$candidate/stb_image.h" ] && Stb="$candidate" && break
done
if [ -z "$Stb" ]; then
    echo "[MaterialGrid] RED — stb_image.h not found (tried ExternalPackages/stb, \$MATERIAL_SCENES_EXT/stb, ~/.cache/m8/stb, ~/.cache/sweep/stb)"
    exit 1
fi

Bin="$(mktemp -u /tmp/MaterialGrid.XXXXXX)"
if ! g++ -std=c++20 -O2 -Wall -Wextra -ffunction-sections -fdata-sections -Wl,--gc-sections -DFRONTIER_CPU_PORT \
     -I Exhibits/Workbench/Materials -I Engine/DisplayPresentation -I Engine/ContentInterchange -I Engine/DeviceExchange \
     -I Engine/GeometricRaster -I Engine/Shaders \
     -I "$Vk/Vulkan-Headers/include" -I "$M6/cgltf" -I "$M6/ufbx" -I "$M6/fast_obj" -I "$Stb" \
     Exhibits/Workbench/Materials/MaterialGridProof.cpp \
     Engine/ContentInterchange/MaterialGridStructure.cpp \
     Engine/ContentInterchange/MaterialIndex.cpp \
     Engine/ContentInterchange/MaterialCodec.cpp \
     Engine/ContentInterchange/SceneCodec.cpp \
     Engine/ContentInterchange/ContentCodec.cpp \
     Engine/ContentInterchange/ObjCodec.cpp \
     Engine/ContentInterchange/FbxCodec.cpp \
     Engine/ContentInterchange/UfbxTranslation.cpp \
     Engine/ContentInterchange/TextureIndex.cpp \
     Engine/GeometricRaster/SceneStructure.cpp \
     Engine/GeometricRaster/GeometryStructure.cpp \
     Engine/DeviceExchange/OrientationClassifier.cpp \
     -o "$Bin" 2>/tmp/MaterialGrid.build; then
    echo "[MaterialGrid] COMPILE FAILED"; sed 's/^/    /' /tmp/MaterialGrid.build | head -60; rm -f "$Bin"; exit 1
fi
if [ -s /tmp/MaterialGrid.build ]; then echo "[MaterialGrid] warnings:"; sed 's/^/    /' /tmp/MaterialGrid.build | head -30; fi
if ! "$Bin" 2>&1 | tee /tmp/MaterialGrid.log | grep -q "MATERIAL GRID: PASS"; then
    echo "[MaterialGrid] RED"; grep "FAIL" /tmp/MaterialGrid.log | sed 's/^/    /'; rm -f "$Bin"; exit 1
fi
grep -c "^ok " /tmp/MaterialGrid.log | xargs echo "[MaterialGrid] GREEN — checks passed:"
rm -f "$Bin"
