#!/usr/bin/env bash
# R7 gate: the edge-avoiding à-trous denoiser removes noise without removing detail.
#
# Three checks:
#   1. CPU harness  — a verbatim port of the shader arithmetic, asserting the behaviours a plain blur would FAIL:
#                     silhouettes and shadow boundaries survive, background does not bleed, energy is preserved,
#                     and the filter is an exact identity when disabled.
#   2. SPIR-V       — AtrousDenoise.slang compiles for Vulkan 1.2.
#   3. Agreement    — the constants the harness hard-codes still match the ones in the shader. Without this the
#                     port could silently drift and keep passing while the shader misbehaved.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

Glslang="${1:-$(command -v glslang || command -v glslangValidator || echo /tmp/gl/build/StandAlone/glslang)}"

echo "[AtrousDenoise] CPU filter harness"
g++ -std=c++20 -O2 -Wall -Wextra Scratchpad/AtrousDenoiseTest.cpp -o /tmp/AtrousDenoiseTest || exit 1
/tmp/AtrousDenoiseTest || exit 1

echo
echo "[AtrousDenoise] shader / harness agreement"
Fail=0

# The B3 spline kernel and the luminance vector must be identical on both sides.
grep -q '0.0625, 0.25, 0.375, 0.25, 0.0625' Engine/Shaders/AtrousDenoise.slang \
    || { echo "  shader lost the B3 spline kernel"; Fail=1; }
grep -q '0.0625f, 0.25f, 0.375f, 0.25f, 0.0625f' Scratchpad/AtrousDenoiseTest.cpp \
    || { echo "  harness lost the B3 spline kernel"; Fail=1; }
grep -q '0.2126, 0.7152, 0.0722'   Engine/Shaders/AtrousDenoise.slang  || { echo "  shader luminance vector changed";  Fail=1; }
grep -q '0.2126f \* R'             Scratchpad/AtrousDenoiseTest.cpp    || { echo "  harness luminance vector changed"; Fail=1; }

# The three weights must all still be present in the shader — dropping one silently turns this into a blur.
for Term in NormalWeight DepthWeight LuminanceWeight; do
    grep -q "float $Term" Engine/Shaders/AtrousDenoise.slang || { echo "  shader is missing $Term"; Fail=1; }
done

# Variance must propagate as the square of the weights, or the filter's own strength estimate is wrong.
grep -q 'Weight \* Weight' Engine/Shaders/AtrousDenoise.slang || { echo "  shader lost the squared-weight variance"; Fail=1; }

# Background rejection appears twice: the centre early-out and the per-tap skip.
[ "$(grep -c 'w <= 0.0' Engine/Shaders/AtrousDenoise.slang)" -ge 2 ] \
    || { echo "  shader is missing a background (depth <= 0) rejection"; Fail=1; }

[ "$Fail" = "0" ] && echo "  constants and weights agree with the harness                     PASS"
[ "$Fail" = "0" ] || exit 1

if [ ! -x "$Glslang" ]; then
    echo
    echo "[AtrousDenoise] glslang not found - SPIR-V check skipped"
    echo "[AtrousDenoise] OK (CPU only)"
    exit 0
fi

echo
echo "[AtrousDenoise] compiling AtrousDenoise.slang to SPIR-V"
Stage=$(mktemp -d); trap 'rm -rf "$Stage"' EXIT
"$Glslang" -V --target-env vulkan1.2 -S comp Engine/Shaders/AtrousDenoise.slang -o "$Stage/AtrousDenoise.spv" >/dev/null \
    || { echo "  SPIR-V COMPILE FAILED"; exit 1; }
echo "  SPIR-V compiles                                                  PASS"

echo
echo "[AtrousDenoise] OK"
