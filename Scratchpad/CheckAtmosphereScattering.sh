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

# ── A2 lookup tables ─────────────────────────────────────────────────────────────────────────────────────────────
# Table sizes must agree between the shader that defines them, the C++ that allocates them, and the harness that
# proves them. Three copies of a number is three chances to drift.
for Pair in "kTransmittanceWidth:kTransmittanceLutWidth" "kTransmittanceHeight:kTransmittanceLutHeight" \
            "kMultiScatterSize:kMultiScatterLutSize"; do
    ShaderName="${Pair%%:*}"; CppName="${Pair##*:}"
    ShaderValue=$(grep -oP "${ShaderName}\s*=\s*\K[0-9]+" Engine/Shaders/AtmosphereScattering.slang | head -1)
    CppValue=$(grep -oP "${CppName}\s*=\s*\K[0-9]+" Engine/DeviceExchange/SwapchainExchange.h | head -1)
    HarnessValue=$(grep -oP "${ShaderName}\s*=\s*\K[0-9]+" Scratchpad/AtmosphereScatteringTest.cpp | head -1)
    if [ "$ShaderValue" != "$CppValue" ] || [ "$ShaderValue" != "$HarnessValue" ]; then
        echo "  $ShaderName disagrees: shader $ShaderValue, C++ $CppValue, harness $HarnessValue"; Fail=1
    fi
done

# ⚠️ Textures[] is a variable-count binding and Vulkan requires it on the HIGHEST binding number. The LUTs took
# 21 and 22, so it had to move to 23; leaving it where it was silently breaks descriptor-indexing devices.
TexturesBinding=$(grep -oP 'layout\(binding = \K[0-9]+(?=\) uniform sampler2D Textures)' Engine/Shaders/ReSTIRViewport.slang)
BindingCount=$(grep -oP 'kComputeBindingCount\s*=\s*\K[0-9]+' Engine/DeviceExchange/SwapchainExchange.h)
[ "$TexturesBinding" = "$((BindingCount - 1))" ] \
    || { echo "  Textures[] is at $TexturesBinding but must be the highest of $BindingCount bindings"; Fail=1; }

# The LUTs must be sampled, not storage, in the kernel's set — a storage image cannot filter, and an unfiltered
# transmittance table bands visibly across the sunset.
grep -q 'B == 21u || B == 22u' Engine/DeviceExchange/SwapchainExchange.cpp \
    || { echo "  the atmosphere LUTs are not declared as sampled images"; Fail=1; }

# The tables are constant per atmosphere; building them per frame would throw away the entire point.
grep -q '!Vulkan->AtmosphereTablesBuilt' Engine/DeviceExchange/SwapchainExchange.cpp \
    || { echo "  the LUT build has no once-only latch — it would run every frame"; Fail=1; }

# Bring-up order: the tables must exist before WriteDescriptorSet binds them.
LutLine=$(grep -n '"BringAtmosphereTables"' Engine/DeviceExchange/SwapchainExchange.cpp | head -1 | cut -d: -f1)
SetLine=$(grep -n '"BringDescriptorSet"'    Engine/DeviceExchange/SwapchainExchange.cpp | head -1 | cut -d: -f1)
if [ -n "$LutLine" ] && [ -n "$SetLine" ] && [ "$LutLine" -gt "$SetLine" ]; then
    echo "  BringAtmosphereTables runs after BringDescriptorSet — the LUTs would never be bound"; Fail=1
fi

# ── A4: the sun as a light ───────────────────────────────────────────────────────────────────────────────────────
# 🔴 Emission must be read through ONE accessor. It used to be fetched inline at eleven separate sites, and
# adding the sun to each would have been eleven chances to miss one — a missed site reads a scene material for
# the sun, which is a plausible wrong colour rather than an obvious failure.
InlineFetches=$(grep -c 'floatBitsToUint(Triangles\[LightTriangle' Engine/Shaders/ReSTIRViewport.slang)
[ "$InlineFetches" = "1" ] \
    || { echo "  $InlineFetches inline emission fetches; only LightEmission() may read a light's material"; Fail=1; }

grep -q 'vec3 LightEmission(uint lightIndex)' Engine/Shaders/ReSTIRViewport.slang \
    || { echo "  the LightEmission accessor is gone"; Fail=1; }
grep -q 'vec3 SampleLightPointFor(' Engine/Shaders/ReSTIRViewport.slang \
    || { echo "  the SampleLightPointFor accessor is gone"; Fail=1; }

# The sun and the sky must consult the SAME transmittance, or the disc, the sky and the light on the ground
# redden at different rates and the sunset comes apart.
grep -q 'SampleTransmittance(max(CameraAltitude, 1.0), SunDirection.z) \* SunIlluminance' Engine/Shaders/ReSTIRViewport.slang \
    || { echo "  the sun's radiance does not use the shared transmittance table"; Fail=1; }

# A sun-only scene has no emissive triangle; gating direct lighting on the triangle count would leave it black.
grep -q 'LightSlotCount() > 0u' Engine/Shaders/ReSTIRViewport.slang \
    || { echo "  direct lighting is still gated on the triangle count — a sun-only scene would be black"; Fail=1; }

# ⚠️ The second bounce must divide by the slot count it sampled from. Dividing by a different number is a bias
# that scales the entire indirect term.
grep -q 'bDist2 + 0.01) \* float(bSlots)' Engine/Shaders/ReSTIRViewport.slang \
    || { echo "  the bounce estimator does not divide by the slot count it sampled from"; Fail=1; }

# The sun must drop out of the candidate set once it is below the horizon, or samples are spent on a light that
# cannot contribute.
grep -q 'SunDirection.z > -0.05' Engine/Shaders/ReSTIRViewport.slang \
    || { echo "  a set sun is still offered as a light candidate"; Fail=1; }

[ "$Fail" = "0" ] && echo "  constants, LUT sizes, bindings, build order and sun wiring agree PASS"

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
