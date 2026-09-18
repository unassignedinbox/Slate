#!/usr/bin/env bash
# AssetPath — does a repository-relative asset load when the binary is NOT run from the repository root?
#
#    This is the 2026-09-18 Windows failure, reproduced as a gate. The user launched
#    `Build\Project-Zero.exe`; the working directory was therefore not the repository root, and every loader that
#    opened a repository-relative path directly failed silently:
#
#        [INFO] [Textures] texture 'EngineContent/CelestialTextures/luna_2k.jpg': can't fopen -> 1x1 placeholder   (x6)
#        [WARN] [Stars]    Catalogue empty or missing — the night sky renders starless.
#
#    The shaders did NOT fail, because the SPIR-V loader already searched the executable's parents. AssetPath.cpp is
#    that search, now shared: shaders, textures, the star catalogue and the typeface archives all resolve through it.
#
#    The gate builds a throwaway program, drops it in a directory shaped like the real output tree
#    (<root>/Projects/Project-Zero/Build/Output/Windows/Release/Binary/probe), puts a copy of both real content files
#    at the repository-shaped location, runs the probe with the working directory set SOMEWHERE ELSE, and requires it
#    to find both. It then repeats the run with the working directory at the fake root (the "launched from the
#    repository root" case) and with a deliberately absent file (the negative case: the resolver must hand the path
#    back unchanged rather than inventing one).
#
#    Usage: CheckAssetPath.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

Work="$(mktemp -d /tmp/AssetPath.XXXXXX)"
trap 'rm -rf "$Work"' EXIT

Failures=0
Pass() { echo "  PASS  $1"; }
Fail() { echo "  FAIL  $1"; Failures=$((Failures + 1)); }

# ── a fake repository: the two content files where the engine expects them ───────────────────────────────────────────
Root="$Work/Repository"
mkdir -p "$Root/EngineContent/CelestialTextures" "$Root/EngineContent/StarCatalogue" \
         "$Root/Projects/Project-Zero/Build/Output/Windows/Release/Binary" "$Root/Sideways"

if [ ! -f EngineContent/CelestialTextures/luna_2k.jpg ] || [ ! -f EngineContent/StarCatalogue/BrightStars.bin ]; then
    echo "  FAIL  the repository's own content files are missing — the gate cannot test what it cannot copy"
    exit 1
fi
cp EngineContent/CelestialTextures/luna_2k.jpg "$Root/EngineContent/CelestialTextures/"
cp EngineContent/StarCatalogue/BrightStars.bin "$Root/EngineContent/StarCatalogue/"

# ── the probe ────────────────────────────────────────────────────────────────────────────────────────────────────────
cat > "$Work/probe.cpp" <<'CPP'
#include "AssetPath.h"
#include <cstdio>
#include <string>

int main(int Argc, char** Argv)
{
    if (Argc < 2) return 2;
    const std::string Relative = Argv[1];
    const std::filesystem::path Resolved = Frontier::ResolveAssetPath(Relative);
    std::printf("%s\n", Resolved.string().c_str());
    // Existence is the answer the caller actually cares about; printing both lets a failure show WHERE it looked.
    return std::filesystem::exists(Resolved) ? 0 : 1;
}
CPP

if ! g++ -std=c++20 -O2 -Wall -Wextra -Werror -IEngine/DeviceExchange "$Work/probe.cpp" \
        Engine/DeviceExchange/AssetPath.cpp -o "$Root/Projects/Project-Zero/Build/Output/Windows/Release/Binary/probe" \
        2> "$Work/build.log"; then
    echo "  FAIL  the probe did not build"; sed 's/^/    /' "$Work/build.log" | head -15; exit 1
fi
Probe="$Root/Projects/Project-Zero/Build/Output/Windows/Release/Binary/probe"

# On Windows the executable is .exe and QueryExecutableDirectory uses GetModuleFileNameW; the search logic below is the
#    same code either way, so the POSIX build exercises the real thing.
echo "[AssetPath] probe lives at $(basename "$(dirname "$Probe")"), content lives at the fake repository root"

# ① the failure case: working directory is NOT the repository root
if (cd "$Root/Sideways" && "$Probe" "EngineContent/CelestialTextures/luna_2k.jpg" > "$Work/out1.txt"); then
    Pass "① a moon texture resolves from a binary in Build\\Output\\...\\Binary with the working directory elsewhere"
    echo "          -> $(cat "$Work/out1.txt")"
else
    Fail "① the moon texture did NOT resolve (this is the reported failure: a textureless moon)"
    echo "          searched and gave back: $(cat "$Work/out1.txt")"
fi

# ② the same run for the star catalogue — the one that rendered the night sky starless
if (cd "$Root/Sideways" && "$Probe" "EngineContent/StarCatalogue/BrightStars.bin" > "$Work/out2.txt"); then
    Pass "② the star catalogue resolves the same way (the night sky is no longer starless for this reason)"
else
    Fail "② the star catalogue did NOT resolve"
    echo "          searched and gave back: $(cat "$Work/out2.txt")"
fi

# ③ the shader path keeps working — it is the case that already worked, and must not regress
mkdir -p "$Root/Engine/Shaders"
cp Engine/Shaders/ReSTIRViewport.slang "$Root/Engine/Shaders/" >/dev/null 2>&1 || : > "$Root/Engine/Shaders/probe.spv"
ShaderName="ReSTIRViewport.slang"
[ -f "$Root/Engine/Shaders/$ShaderName" ] || ShaderName="probe.spv"
if (cd "$Root/Sideways" && "$Probe" "Engine/Shaders/$ShaderName" > /dev/null); then
    Pass "③ a shader path still resolves (the SPIR-V loader keeps the behaviour it had)"
else
    Fail "③ a shader path stopped resolving — the shared resolver regressed the case that used to work"
fi

# ④ repository-root launch still short-circuits at step ① of the search
if (cd "$Root" && "$Probe" "EngineContent/CelestialTextures/luna_2k.jpg" > "$Work/out4.txt"); then
    IfPath="$(cat "$Work/out4.txt")"
    case "$IfPath" in
        "EngineContent/CelestialTextures/luna_2k.jpg") Pass "④ launched from the root, the path is used as given (no search)" ;;
        *) Fail "④ launched from the root, the resolver rewrote a path that already existed: $IfPath" ;;
    esac
else
    Fail "④ launched from the root, the asset did not resolve"
fi

# ⑤ the negative case: an absent asset comes back UNCHANGED, so the caller's error message names what it asked for
if (cd "$Root/Sideways" && "$Probe" "EngineContent/CelestialTextures/not_here.jpg" > "$Work/out5.txt"); then
    Fail "⑤ an absent asset resolved to something — the resolver invented a path"
else
    IfPath="$(cat "$Work/out5.txt")"
    if [ "$IfPath" = "EngineContent/CelestialTextures/not_here.jpg" ]; then
        Pass "⑤ an absent asset is returned unchanged (the caller's message stays truthful)"
    else
        Fail "⑤ an absent asset came back rewritten as $IfPath"
    fi
fi

echo
if [ "$Failures" -eq 0 ]; then
    echo "[AssetPath] GREEN — relative assets resolve from the output tree, from the root, and fail honestly when absent"
    exit 0
fi
echo "[AssetPath] RED — $Failures check(s) failed"
exit 1
