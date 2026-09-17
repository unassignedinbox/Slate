#!/usr/bin/env bash
# M9 headless gate — source contract + CPU mirror of motion-vector reprojection/disocclusion. A real GPU runner is still
# required for the final pixel A/B and sky-backed glass render; this gate makes that limitation explicit rather than
# calling a source-only check a render proof.
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
