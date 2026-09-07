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

# 🔴 LOG, never linear. A linear average is dominated by the brightest thing in frame, so the sun disc entering
# view blacks out the whole image. The histogram buckets are log2 slices, which is the same property expressed
# as a distribution rather than as a sum.
grep -q 'log2(Luminance)' Engine/Shaders/LuminanceReduce.slang \
    || { echo "  the reduction is not working in log space — the sun would black out the frame"; Fail=1; }

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

# ── A7c: the meter is a histogram, and has no absolute threshold in it ───────────────────────────────────────────
# 🔴 No ABSOLUTE luminance may decide whether a pixel is metered. The rule used to skip anything below a fixed
# 1e-2 cd/m², which is a daylight constant standing where every scale of scene passes through: measured across a
# sunset, at 9 deg below the horizon the sky fell under it while the ground was still above it, so the sky went
# black against a correctly exposed ground, and by 18 deg below EVERY pixel was excluded, the count reached zero
# and the meter froze at its last daylight reading. A permanently black night with no stars in it.
if grep -qE 'kMeteringFloor|Luminance < [0-9]' Engine/Shaders/LuminanceReduce.slang; then
    echo "  the reduction has an absolute metering threshold again — it will go blind at night"; Fail=1
fi
grep -q 'atomicAdd(Bins\[Bin\], Weight)' Engine/Shaders/LuminanceReduce.slang \
    || { echo "  the reduction no longer builds a histogram"; Fail=1; }

# The only rejection allowed is a value that is not a positive number, because a NaN lands in an undefined
# bucket and one poisoned tap skews the whole frame's percentile.
grep -q 'if (!(Luminance > 0.0)) return;' Engine/Shaders/LuminanceReduce.slang \
    || { echo "  the reduction does not reject NaN and non-positive taps"; Fail=1; }

# ⚠️ Centre weighted, as a camera is. An unweighted frame average lets the amount of empty space in shot decide
# how bright the subject renders; measured, weighting cut that from 5.08x to 3.12x across realistic framings.
grep -q 'kCentreWeightPeak' Engine/Shaders/LuminanceReduce.slang \
    || { echo "  the meter is no longer centre weighted — framing would move the exposure again"; Fail=1; }

# The histogram's shape is duplicated in the shader, the readback and the harness. Three copies of a number is
# three chances to drift, and a drifted bin range silently rescales every measurement.
for Triple in "kHistogramBins:kLuminanceHistogramBins:kHistogramBins" \
              "kLogLuminanceLow:kLuminanceLog2Low:kLogLuminanceLow" \
              "kLogLuminanceHigh:kLuminanceLog2High:kLogLuminanceHigh"; do
    ShaderName="${Triple%%:*}"; Rest="${Triple#*:}"; CppName="${Rest%%:*}"; HarnessName="${Rest##*:}"
    ShaderValue=$(grep -oP "${ShaderName}\s*=\s*\K-?[0-9.]+" Engine/Shaders/LuminanceReduce.slang | head -1)
    CppValue=$(grep -oP "${CppName}\s*=\s*\K-?[0-9.]+" Engine/DeviceExchange/SwapchainExchange.h | head -1)
    HarnessValue=$(grep -oP "${HarnessName}\s*=\s*\K-?[0-9.]+" Scratchpad/ExposureIntegratorTest.cpp | head -1)
    if [ "${ShaderValue%.}" != "${CppValue%.}" ] || [ "${ShaderValue%.}" != "${HarnessValue%.}" ]; then
        echo "  $ShaderName disagrees: shader $ShaderValue, readback $CppValue, harness $HarnessValue"; Fail=1
    fi
done

# 🔴 The exposure is anchored to the frame's MEDIAN and averaged over a window measured in STOPS, not over a
# percentile of the distribution. A percentile cannot tell a bright outlier from a bright subject, because both
# are simply "the top". That is what made the exposure pump as the camera moved: a Cornell frame is a room near
# 1 cd/m2 with a hole showing sky at thousands, the bright mode slid into and out of the average as the hole's
# share of the frame changed, and the reading swung up to 4.7 stops. Exposure is global, so the SKY pumped with
# it - a sky whose brightness depends on where the camera stands is not a sky problem.
grep -q 'Seen >= Total \* 0.5' Engine/DeviceExchange/SwapchainExchange.cpp \
    || { echo "  the meter no longer anchors on the median — a bright mode can drag it again"; Fail=1; }
grep -q 'std::fabs(Centre - Anchor) > static_cast<double>(kLuminanceMedianStops)' Engine/DeviceExchange/SwapchainExchange.cpp \
    || { echo "  the meter no longer bounds its window in stops around the anchor"; Fail=1; }
if grep -qE 'kLuminanceTrimLow|kLuminanceTrimHigh' Engine/DeviceExchange/SwapchainExchange.h; then
    echo "  the percentile trim is back — it cannot separate a bright outlier from a bright subject"; Fail=1
fi

# ⚠️ Bounded on both sides, and measured rather than tuned: three to eight stops all behave identically, and at
# twelve the oculus sky comes back inside the window and the pumping returns.
awk -v f="$(grep -oP 'kLuminanceMedianStops\s*=\s*\K[0-9.]+' Engine/DeviceExchange/SwapchainExchange.h)" \
    'BEGIN { exit !(f >= 3.0 && f <= 8.0) }' \
    || { echo "  the median window is outside the measured-safe 3..8 stop band"; Fail=1; }

# The harness has to port the same rule, or the proof describes a meter the renderer does not have.
grep -q 'std::fabs(Centre - Anchor) > MedianStops' Scratchpad/ExposureIntegratorTest.cpp \
    || { echo "  the harness no longer ports the median-anchored window"; Fail=1; }

# ── A7c: dark adaptation ─────────────────────────────────────────────────────────────────────────────────────────
# 🔴 An exposure of Key/L renders every scene at the same mid-grey, so a starlit field arrives looking like an
# overcast afternoon and its stars are a slightly brighter grey. The key must fall below the photopic level.
grep -q 'KeyForLuminance' Engine/DisplayPresentation/ExposureIntegrator.cpp \
    || { echo "  the key is constant again — night would render as grey daylight and hide the stars"; Fail=1; }
grep -q 'if (Safe >= Config.PhotopicLuminance) return Config.KeyValue;' Engine/DisplayPresentation/ExposureIntegrator.cpp \
    || { echo "  dark adaptation no longer leaves daylight exactly unchanged"; Fail=1; }

# The numerical floor must be epsilon, not a scene luminance: at 1e-2 a night sky clamps straight up to it and
# the adaptation curve never engages at all.
awk -v f="$(grep -oP 'LuminanceFloor\s*=\s*\K[0-9.e-]+' Engine/DisplayPresentation/ExposureIntegrator.h)" \
    'BEGIN { exit !(f < 0.00001) }' \
    || { echo "  LuminanceFloor is a scene luminance again — it would clamp the night away"; Fail=1; }

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

# The accumulator has to be big enough for the whole histogram; a short buffer would silently drop the top bins,
# which are exactly where the sun and every highlight live.
grep -q 'kLuminanceHistogramBytes' Engine/DeviceExchange/SwapchainExchange.cpp \
    || { echo "  the accumulator is not sized from the histogram"; Fail=1; }

# One exposure value reaches the shader, whichever mode is active.
grep -q 'Dispatch.Exposure              = Adaptation.QueryExposure();' Engine/DisplayPresentation/ReSTIRIntegrator.cpp \
    || { echo "  the dispatch does not take its exposure from the integrator"; Fail=1; }

[ "$Fail" = "0" ] && echo "  log mean, frame-rate independence, bounds and GPU wiring hold     PASS"

echo
if [ "$Fail" = "0" ]; then echo "[Exposure] OK"; exit 0; else echo "[Exposure] FAILED"; exit 1; fi
