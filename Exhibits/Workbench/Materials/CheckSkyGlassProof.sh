#!/usr/bin/env bash
# M9 gate — the sky-backed outdoor glass proof (the last open M9 item, plan §4). Compiles the CPU exhibit with the
#    system compiler (no Vulkan, no GLFW, no submodules) and runs it:
#      ① SkyGlassProof — SkyRecords/MoonRecords/PostRecords.slang included 1:1 over the HOST-PACKED record
#        (PackSkyConstants): seam parity vs AtmosphereModel::Integrate, the sun arm on the real packed factor,
#        the GI sky-dome closure (escape → SkyAlong at W=1) for wax / mixed T+SSS / solid glass / foil, and the
#        visual sheet (sky panorama, rig on black vs sky-backed, the 1-spp frame) to /tmp/SkyGlass_*.png.
#    The sky/moon/post records' FRONTIER_CPU_PORT guards exist since the seam landed; this is the consumer that
#    makes the seam earn them. GPU render-verification stays user-side (no GPU in the sandbox).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1
Fail=0

echo "[SkyGlass] compiling the sky-glass proof (celestial records 1:1 + the host packer)"
Bin="$(mktemp -u /tmp/SkyGlass.XXXXXX)"
if ! g++ -std=c++20 -O2 -Wall -Wextra -DFRONTIER_CPU_PORT -I Exhibits/Workbench/Materials \
     -I Engine/DisplayPresentation -I Engine/Shaders -I Exhibits/Workbench/Editor \
     Exhibits/Workbench/Materials/SkyGlassProof.cpp \
     Engine/DisplayPresentation/ShadingTableCodec.cpp \
     -o "$Bin" -pthread 2>/tmp/SkyGlass.build; then
    echo "  SKY GLASS COMPILE FAILED"; sed 's/^/    /' /tmp/SkyGlass.build | head -40; exit 1
fi
if ! "$Bin" 2>&1 | tee /tmp/SkyGlass.log | grep -q "SKY GLASS: PASS"; then
    echo "  SKY GLASS FAILED"; grep "FAIL" /tmp/SkyGlass.log | sed 's/^/    /' | head -20; Fail=1
else
    grep -E "^  \.\." /tmp/SkyGlass.log | sed 's/^/    /' || true
fi
rm -f "$Bin"

[ "$Fail" -eq 0 ] && echo "[SkyGlass] GREEN — seam parity + sun arm + dome closure + visual sheet pass" \
                  || echo "[SkyGlass] RED"
exit "$Fail"
