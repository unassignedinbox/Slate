#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
#  CheckExposureIntegrator.sh — A6b: adaptive exposure, the prerequisite for aerial perspective and the night sky
# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
set -u
Root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$Root" || exit 1
Fail=0

echo "[Exposure] adaptation behaviour"
Binary="$(mktemp -u /tmp/Exposure.XXXXXX)"
if ! g++ -std=c++20 -O2 -Wall -Wextra -I Engine -I . \
     Scratchpad/ExposureIntegratorTest.cpp Engine/DisplayPresentation/ExposureIntegrator.cpp -o "$Binary" 2>/tmp/Exposure.build; then
    echo "  COMPILE FAILED"; sed 's/^/    /' /tmp/Exposure.build | head -20; exit 1
fi
"$Binary" || Fail=1
rm -f "$Binary"

echo
echo "[Exposure] design invariants"

# 🔴 LOG mean, never linear. A linear average is dominated by the brightest thing in frame, so the sun disc
# entering view blacks out the whole image.
grep -q 'log(Luminance)' Engine/Shaders/LuminanceReduce.slang \
    || { echo "  the reduction is not taking a logarithm — the sun would black out the frame"; Fail=1; }

# ⚠️ Frame-rate independence. `* Rate * Delta` adapts faster on faster hardware, so the same transition looks
# different per machine; 1 - exp(-dt/tau) does not.
grep -q '1.0f - std::exp(-DeltaSeconds / TimeConstant)' Engine/DisplayPresentation/ExposureIntegrator.cpp \
    || { echo "  the easing is not the frame-rate independent exponential form"; Fail=1; }

# Asymmetric adaptation: bright must be faster than dark, or the response feels wrong in one direction.
Brighten=$(grep -oP 'BrightenSeconds\s*=\s*\K[0-9.]+' Engine/DisplayPresentation/ExposureIntegrator.h)
Darken=$(grep -oP 'DarkenSeconds\s*=\s*\K[0-9.]+' Engine/DisplayPresentation/ExposureIntegrator.h)
awk -v b="$Brighten" -v d="$Darken" 'BEGIN { exit !(b < d) }' \
    || { echo "  brightening ($Brighten s) is not faster than darkening ($Darken s)"; Fail=1; }

# ⚠️ The exposure floor must be small enough for daylight. A noon sky needs 2.25e-5; a floor anywhere near
# 0.01 clamps it and renders the sky as flat white — which reads as a tone-mapping bug, not a clamp.
awk -v f="$(grep -oP 'MinimumExposure\s*=\s*\K[0-9.e-]+' Engine/DisplayPresentation/ExposureIntegrator.h)" \
    'BEGIN { exit !(f < 0.0000225) }' \
    || { echo "  MinimumExposure is too high — a noon sky would clamp to white"; Fail=1; }

# The renderer must read ONE exposure value, or manual and adaptive become two code paths that disagree.
grep -q 'float QueryExposure() const noexcept' Engine/DisplayPresentation/ExposureIntegrator.h \
    || { echo "  there is no single exposure accessor"; Fail=1; }

# Manual mode is the identity switch for this phase.
grep -q 'ExposureModeCategory::Manual) return Config.ManualExposure' Engine/DisplayPresentation/ExposureIntegrator.cpp \
    || { echo "  manual mode no longer bypasses adaptation — pre-A6b images are unreproducible"; Fail=1; }

[ "$Fail" = "0" ] && echo "  log mean, frame-rate independence, asymmetry and bounds hold      PASS"

echo
if [ "$Fail" = "0" ]; then echo "[Exposure] OK"; exit 0; else echo "[Exposure] FAILED"; exit 1; fi
