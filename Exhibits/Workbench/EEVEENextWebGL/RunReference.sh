#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
out="${TMPDIR:-/tmp}/slate-eevee-reference"
g++ -std=c++20 -O2 -Wall -Wextra -pedantic "$root/EEVEEReference.cpp" -o "$out"
"$out"
if [[ "${1:-}" == "--rebake" ]]; then
    "$out" --bake "$root/EeveeProbeCache.bin"
fi
