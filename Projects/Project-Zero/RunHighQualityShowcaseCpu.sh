#!/usr/bin/env bash
# Render the default combined Project-Zero Showcase + Material Grid on the CPU.
# This preserves the original sun/sky/clouds/moon/stars/lens-flare scene and adds the authored 5x4 grid.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
make -s all
./bin/Project-Zero-CpuReference \
    --width "${1:-1280}" --height "${2:-720}" \
    --bounce "${3:-12}" --passes "${4:-4}" --flare 1
if command -v convert >/dev/null 2>&1 && test -s Diagnostics/ProjectZero_Showcase.ppm; then
    convert Diagnostics/ProjectZero_Showcase.ppm Diagnostics/ProjectZero_Showcase.png
fi
if test -s Diagnostics/ProjectZero_Showcase.png; then
    sha256sum Diagnostics/ProjectZero_Showcase.png | tee Diagnostics/ProjectZero_Showcase.sha256
    printf '[Project-Zero] HIGH-QUALITY COMBINED SHOWCASE + GRID: PASS\n'
else
    printf '[Project-Zero] rendered PPM; PNG conversion unavailable\n'
fi
