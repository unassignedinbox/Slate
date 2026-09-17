#!/usr/bin/env bash
# Material grid sheet driver — the Project-Zero `--scene materialswatch` wall as a 4×4 gallery sheet. Each
#    panel is one of the 16 unique swatches through the M7b preview entry (the byte-identical path the
#    inspector preview uses); the materials come from MaterialSwatchStructure — the same source the GPU scene
#    exports from, so the sheet and the scene agree by construction. NOT part of the materials gate (full
#    sheets are minutes, not seconds); run on demand or before a material milestone.
#    Headers: same candidates as CheckMaterialScenes.sh (Vulkan-Headers + interchange headers are needed to
#    COMPILE MaterialSwatchStructure.cpp; gc-sections drops its Export, so no codec TU is linked). No GPU.
# Usage: RunSwatchSheet.sh [Size=384] [Spp=128]
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1

Size="${1:-384}" Spp="${2:-128}"

Vk=""
for candidate in "$PWD/ExternalPackages" "${MATERIAL_SCENES_EXT:-}" "$HOME/.cache/m7"; do
    [ -n "$candidate" ] && [ -f "$candidate/Vulkan-Headers/include/vulkan/vulkan.h" ] && Vk="$candidate" && break
done
if [ -z "$Vk" ]; then
    echo "[SwatchSheet] RED — Vulkan-Headers not found (tried ExternalPackages/, \$MATERIAL_SCENES_EXT, ~/.cache/m7)"
    exit 1
fi
M6=""
for candidate in "$PWD/ExternalPackages" "${MATERIAL_SCENES_EXT:-}" "${MATERIAL_CODEC_EXT:-}" "$HOME/.cache/m6"; do
    [ -n "$candidate" ] && [ -f "$candidate/cgltf/cgltf.h" ] && [ -f "$candidate/ufbx/ufbx.h" ] \
        && [ -f "$candidate/fast_obj/fast_obj.h" ] && M6="$candidate" && break
done
if [ -z "$M6" ]; then
    echo "[SwatchSheet] RED — interchange headers not found (tried ExternalPackages/, \$MATERIAL_SCENES_EXT, \$MATERIAL_CODEC_EXT, ~/.cache/m6)"
    exit 1
fi
Stb=""
for candidate in "$PWD/ExternalPackages/stb" "${MATERIAL_SCENES_EXT:+$MATERIAL_SCENES_EXT/stb}" "$HOME/.cache/m8/stb" "$HOME/.cache/sweep/stb"; do
    [ -n "$candidate" ] && [ -f "$candidate/stb_image.h" ] && Stb="$candidate" && break
done
if [ -z "$Stb" ]; then
    echo "[SwatchSheet] RED — stb_image.h not found (tried ExternalPackages/stb, \$MATERIAL_SCENES_EXT/stb, ~/.cache/m8/stb, ~/.cache/sweep/stb)"
    exit 1
fi
echo "[SwatchSheet] headers: $Vk + $M6 + $Stb"

Bin="$(mktemp -u /tmp/SwatchSheet.XXXXXX)"
echo "[SwatchSheet] building"
if ! g++ -std=c++20 -O2 -Wall -Wextra -ffunction-sections -fdata-sections -Wl,--gc-sections -DFRONTIER_CPU_PORT -DSHADERBALL_PREVIEW_LIB \
     -I Exhibits/Workbench/Materials -I Engine/DisplayPresentation -I Engine/ContentInterchange -I Engine/DeviceExchange \
     -I Engine/GeometricRaster -I Engine/Shaders -I Exhibits/Workbench/Editor \
     -I "$Vk/Vulkan-Headers/include" -I "$M6/cgltf" -I "$M6/ufbx" -I "$M6/fast_obj" -I "$Stb" \
     Exhibits/Workbench/Materials/SwatchSheetExhibit.cpp \
     Exhibits/Workbench/Materials/ShaderballExhibit.cpp \
     Engine/ContentInterchange/MaterialSwatchStructure.cpp \
     Engine/ContentInterchange/MaterialIndex.cpp \
     Engine/DisplayPresentation/ShadingTableCodec.cpp \
     -o "$Bin" 2>/tmp/SwatchSheet.build; then
    echo "[SwatchSheet] COMPILE FAILED"; sed 's/^/    /' /tmp/SwatchSheet.build | head -40; exit 1
fi
if [ -s /tmp/SwatchSheet.build ]; then echo "[SwatchSheet] warnings:"; sed 's/^/    /' /tmp/SwatchSheet.build | head -20; fi

# Run-then-inspect (NOT `| grep -q` in the pipeline: -q exits on the first match, tee then dies on EPIPE,
#    and the still-rendering binary takes SIGPIPE on its next 4 KB stdout flush — a false "crash" mid-line).
echo "[SwatchSheet] smoke (64px, 4spp)"
if ! "$Bin" --out /tmp/SwatchSheet.smoke.png --size 64 --spp 4 >/tmp/SwatchSheet.smoke.log 2>&1; then
    echo "[SwatchSheet] SMOKE FAILED"; tail -5 /tmp/SwatchSheet.smoke.log; rm -f "$Bin"; exit 1
fi
if ! grep -q "wrote" /tmp/SwatchSheet.smoke.log; then
    echo "[SwatchSheet] SMOKE FAILED (no sheet write)"; tail -5 /tmp/SwatchSheet.smoke.log; rm -f "$Bin"; exit 1
fi
if grep -q "bad=[1-9]" /tmp/SwatchSheet.smoke.log; then echo "[SwatchSheet] SMOKE: non-finite pixels"; rm -f "$Bin"; exit 1; fi

echo "[SwatchSheet] full sheet (${Size}px, ${Spp}spp)"
if ! "$Bin" --out /tmp/SwatchSheet.raw.png --size "$Size" --spp "$Spp" >/tmp/SwatchSheet.render.log 2>&1; then
    echo "[SwatchSheet] RENDER FAILED"; tail -5 /tmp/SwatchSheet.render.log; rm -f "$Bin"; exit 1
fi
tail -3 /tmp/SwatchSheet.render.log
if command -v convert >/dev/null 2>&1; then convert /tmp/SwatchSheet.raw.png -strip -define png:compression-level=9 "Exhibits/Gallery/Materials/SwatchSheet_FullWall.png"; else cp /tmp/SwatchSheet.raw.png "Exhibits/Gallery/Materials/SwatchSheet_FullWall.png"; fi
rm -f /tmp/SwatchSheet.raw.png
sha256sum "Exhibits/Gallery/Materials/SwatchSheet_FullWall.png"
rm -f "$Bin"
