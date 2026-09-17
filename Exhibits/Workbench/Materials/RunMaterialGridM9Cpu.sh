#!/usr/bin/env bash
# CPU parity render for M9. This is intentionally a render gate, not a source grep gate.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
Size="${1:-256}"
Spp="${2:-4}"
OutDir="${3:-Projects/Project-Zero/Diagnostics}"
Bin="$(mktemp -u /tmp/MaterialGridM9Cpu.XXXXXX)"
Log="/tmp/MaterialGridM9Cpu.log"
trap 'rm -f "$Bin"' EXIT

echo "[MaterialGridM9Cpu] building"
if ! g++ -std=c++20 -O2 -pthread -DFRONTIER_CPU_PORT \
    -I Exhibits/Workbench/Materials -I Engine/DisplayPresentation -I Engine/Shaders -I Exhibits/Workbench/Editor -I Engine/ContentInterchange \
    Exhibits/Workbench/Materials/MaterialGridM9CpuRender.cpp \
    Engine/DisplayPresentation/ShadingTableCodec.cpp -o "$Bin" 2>/tmp/MaterialGridM9Cpu.build; then
    echo "[MaterialGridM9Cpu] COMPILE FAILED"
    sed 's/^/    /' /tmp/MaterialGridM9Cpu.build | head -100
    exit 1
fi
"$Bin" --size "$Size" --spp "$Spp" --out-dir "$OutDir" 2>&1 | tee "$Log"
Manifest="$OutDir/ProjectZero_MaterialGrid_M9.sha256"
: > "$Manifest"
for Name in raw enabled no_denoise no_reprojection ui; do
    File="$OutDir/ProjectZero_MaterialGrid_${Name}.png"
    test -s "$File" || { echo "[MaterialGridM9Cpu] missing $File"; exit 1; }
    sha256sum "$File" | tee -a "$Manifest"
done
printf '[MaterialGridM9Cpu] hashes: %s\n' "$Manifest"
printf '[MaterialGridM9Cpu] CPU RENDER: PASS\n'
