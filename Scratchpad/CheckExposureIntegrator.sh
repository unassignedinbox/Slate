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

# ── GPU wiring ───────────────────────────────────────────────────────────────────────────────────────────────────
# ⚠️ The reduction must read the LINEAR history image, not the tone-mapped presentation image. Measuring the tone
# map's own output feeds the curve its result and the exposure chases itself in a loop.
grep -q 'Vulkan->HistoryImageView, VK_IMAGE_LAYOUT_GENERAL' Engine/DeviceExchange/SwapchainExchange.cpp \
    || { echo "  the reduction is not reading the linear history image"; Fail=1; }

# The kernel writes HistoryImage in the same command buffer; without a barrier the reduction measures a
# half-written frame and the exposure jitters.
grep -q 'HistoryBarrier.image                       = Vulkan->HistoryImage' Engine/DeviceExchange/SwapchainExchange.cpp \
    || { echo "  the reduction does not wait for the kernel's history write"; Fail=1; }

# ⚠️ The accumulator must be cleared ON THE GPU. Clearing the mapped pointer from the CPU races the previous
# frame's dispatch, which may still be adding to it.
grep -q 'vkCmdFillBuffer(Command, Vulkan->LuminanceBuffers' Engine/DeviceExchange/SwapchainExchange.cpp \
    || { echo "  the accumulator is not cleared on the GPU — a CPU clear would race the previous frame"; Fail=1; }

# The readback must use a slot the GPU has finished with, or it stalls the CPU for one scalar.
grep -q '(Vulkan->ActiveSlot + 1u) % kCycleSlotCount' Engine/DeviceExchange/SwapchainExchange.cpp \
    || { echo "  the readback does not use the completed cycle slot — it would stall"; Fail=1; }

# The fixed-point scale is duplicated in the shader and the readback; a mismatch scales every measurement.
ShaderScale=$(grep -oP 'kFixedScale\s*=\s*\K[0-9.]+' Engine/Shaders/LuminanceReduce.slang)
HostScale=$(grep -oP 'FixedScale = \K[0-9.]+' Engine/DeviceExchange/SwapchainExchange.cpp)
[ "${ShaderScale%.*}" = "${HostScale%.*}" ] \
    || { echo "  fixed-point scale differs: shader $ShaderScale, readback $HostScale"; Fail=1; }

# One exposure value reaches the shader, whichever mode is active.
grep -q 'Dispatch.Exposure              = Adaptation.QueryExposure();' Engine/DisplayPresentation/ReSTIRIntegrator.cpp \
    || { echo "  the dispatch does not take its exposure from the integrator"; Fail=1; }

[ "$Fail" = "0" ] && echo "  log mean, frame-rate independence, bounds and GPU wiring hold     PASS"

echo
if [ "$Fail" = "0" ]; then echo "[Exposure] OK"; exit 0; else echo "[Exposure] FAILED"; exit 1; fi
