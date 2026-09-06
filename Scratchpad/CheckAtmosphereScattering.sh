#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
#  CheckAtmosphereScattering.sh — A3: the single-scattering sky, and its agreement with the shader
# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
set -u
Root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$Root" || exit 1
Fail=0

echo "[Atmosphere] physical behaviour"
Binary="$(mktemp -u /tmp/Atmosphere.XXXXXX)"
if ! g++ -std=c++20 -O2 -Wall -Wextra Scratchpad/AtmosphereScatteringTest.cpp -o "$Binary" 2>/tmp/Atmosphere.build; then
    echo "  COMPILE FAILED"; sed 's/^/    /' /tmp/Atmosphere.build | head -20; exit 1
fi
"$Binary" || Fail=1
rm -f "$Binary"

echo
echo "[Atmosphere] the CPU port and the shader agree"
# The harness is a verbatim port. If a constant is changed in one and not the other the proof silently stops
# describing what the GPU runs, which is worse than having no proof.
Shader="Engine/Shaders/AtmosphereScattering.slang"
Harness="Scratchpad/AtmosphereScatteringTest.cpp"
for Constant in kPlanetRadius kAtmosphereThickness kRayleighScaleHeight kMieScaleHeight \
                kMieScattering kMieExtinction kMieAsymmetry kOzoneCentre kOzoneWidth kSunAngularRadius; do
    ShaderValue=$(grep -oP "${Constant}\s*=\s*\K[0-9.e+-]+" "$Shader"  | head -1)
    HarnessValue=$(grep -oP "${Constant}\s*=\s*\K[0-9.e+-]+" "$Harness" | head -1)
    if [ -z "$ShaderValue" ] || [ -z "$HarnessValue" ]; then
        echo "  $Constant is missing from one side"; Fail=1
    elif [ "${ShaderValue%f}" != "${HarnessValue%f}" ]; then
        echo "  $Constant is $ShaderValue in the shader but $HarnessValue in the harness"; Fail=1
    fi
done
# The scattering vectors are the ones that set the sky's colour; compare them as whole lines.
for Vector in kRayleighScattering kOzoneAbsorption; do
    ShaderNumbers=$(grep -oP "${Vector}[^;]*" "$Shader"  | grep -oP '[0-9]+\.[0-9]+e-[0-9]+' | tr '\n' ' ')
    HarnessNumbers=$(grep -oP "${Vector}[^;]*" "$Harness" | grep -oP '[0-9]+\.[0-9]+e-[0-9]+' | tr '\n' ' ')
    [ "$ShaderNumbers" = "$HarnessNumbers" ] \
        || { echo "  $Vector differs: shader [$ShaderNumbers] harness [$HarnessNumbers]"; Fail=1; }
done

# The ray-miss path must actually call the sky, and must keep the zero-illuminance identity switch.
grep -q 'SkyRadiance(CameraAltitude' Engine/Shaders/ReSTIRViewport.slang \
    || { echo "  the kernel's ray-miss path does not evaluate the sky"; Fail=1; }
grep -q 'SunIlluminance > 0.0' Engine/Shaders/ReSTIRViewport.slang \
    || { echo "  the zero-illuminance identity switch is gone — pre-A3 images could not be reproduced"; Fail=1; }

# ⚠️ A moving sun must invalidate the accumulated history exactly as a moving camera does, or a sunset blends
# two different skies and smears into a grey dissolve that reads as a denoiser fault.
grep -q 'Resized || SunMoved' Engine/DisplayPresentation/ReSTIRIntegrator.cpp \
    || { echo "  a moving sun does not restart accumulation — a sunset would smear"; Fail=1; }

# Push constants are now exactly at Vulkan's guaranteed 128 bytes; anything further needs a uniform buffer.
grep -q 'sizeof(DispatchConfiguration) == 128u' Engine/DeviceExchange/SwapchainExchange.h \
    || { echo "  the push-constant size assertion no longer states 128 bytes"; Fail=1; }

[ "$Fail" = "0" ] && echo "  constants, ray-miss wiring and history invalidation agree        PASS"

echo
Glslang=""
for Candidate in /tmp/gl/build/StandAlone/glslang "$(command -v glslang 2>/dev/null)" "$(command -v glslangValidator 2>/dev/null)"; do
    [ -n "$Candidate" ] && [ -x "$Candidate" ] && Glslang="$Candidate" && break
done
if [ -z "$Glslang" ]; then
    echo "[Atmosphere] glslang not found — SPIR-V check skipped"
    [ "$Fail" = "0" ] && { echo; echo "[Atmosphere] OK (CPU only)"; exit 0; }
    echo; echo "[Atmosphere] FAILED"; exit 1
fi

echo "[Atmosphere] compiling the kernel with the sky included"
if ( cd Engine/Shaders && "$Glslang" -V --target-env vulkan1.2 -S comp ReSTIRViewport.slang -o /dev/null ) >/tmp/Atmosphere.spv.log 2>&1; then
    echo "  SPIR-V compiles                                                  PASS"
else
    sed 's/^/    /' /tmp/Atmosphere.spv.log | head -20; Fail=1
fi

echo
if [ "$Fail" = "0" ]; then echo "[Atmosphere] OK"; exit 0; else echo "[Atmosphere] FAILED"; exit 1; fi
