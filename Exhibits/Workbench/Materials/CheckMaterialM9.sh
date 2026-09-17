#!/usr/bin/env bash
# M9 gate — source contract + CPU behavior mirror + actual Project-Zero CPU render/A-B/UI output. A real GPU runner is
# still required only for final GPU shader compilation and GPU-vs-CPU pixel agreement; this gate never calls CPU output GPU.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1

Bin="$(mktemp -u /tmp/MaterialM9.XXXXXX)"
if ! g++ -std=c++20 -O2 -Wall -Wextra \
     Exhibits/Workbench/Materials/MaterialM9Proof.cpp -o "$Bin" \
     2>/tmp/MaterialM9.build; then
    echo "[MaterialM9] COMPILE FAILED"; sed 's/^/    /' /tmp/MaterialM9.build | head -60; rm -f "$Bin"; exit 1
fi
if ! "$Bin" 2>&1 | tee /tmp/MaterialM9.log | grep -q "M9 HEADLESS: PASS"; then
    echo "[MaterialM9] RED"; grep "FAIL" /tmp/MaterialM9.log | sed 's/^/    /'; rm -f "$Bin"; exit 1
fi
grep -c "^ok " /tmp/MaterialM9.log | xargs echo "[MaterialM9] GREEN — checks passed:"
rm -f "$Bin"

# Source contracts are necessary but not sufficient under CLAUDE.md: render the same Project-Zero material grid,
# Slang CPU BSDF, UI-facing presentation, and all M9 A/B paths before declaring the gate complete.
RenderSize="${M9_CPU_RENDER_SIZE:-256}"
RenderSpp="${M9_CPU_RENDER_SPP:-2}"
bash Exhibits/Workbench/Materials/RunMaterialGridM9Cpu.sh "$RenderSize" "$RenderSpp" \
    Projects/Project-Zero/Diagnostics
