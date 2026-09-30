#!/usr/bin/env bash
# Build and exercise both isolated project code images through the revisioned C ABI.
# Output is intentionally durable only in Exhibits/Gallery; binaries stay in _AgentScratch.
set -euo pipefail

RepositoryRoot="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ScratchPath="$RepositoryRoot/_AgentScratch/AbiContract"
GalleryPath="$RepositoryRoot/Exhibits/Gallery/CodeImages"
mkdir -p "$ScratchPath" "$GalleryPath"

cxx=(g++ -std=c++20 -Wall -Wextra -Werror)
"${cxx[@]}" -fPIC -shared \
    "$RepositoryRoot/FlattenedEngine/Projects/Project-Zero/Source/ProjectZeroInterchange.cpp" \
    -o "$ScratchPath/ProjectZero.so"
"${cxx[@]}" -fPIC -shared \
    "$RepositoryRoot/FlattenedEngine/Projects/Project-Drive/Source/ProjectDriveInterchange.cpp" \
    -o "$ScratchPath/ProjectDrive.so"
"${cxx[@]}" -I"$RepositoryRoot/FlattenedEngine" \
    "$RepositoryRoot/Exhibits/Workbench/CodeImages/CodeImageAbiCheck.cpp" -ldl \
    -o "$ScratchPath/CodeImageAbiCheck"
(
    cd "$ScratchPath"
    ./CodeImageAbiCheck
) | tee "$GalleryPath/AbiContract_CPU_Check.txt"

python3 - "$GalleryPath" <<'PY'
from pathlib import Path
import hashlib
import json
import sys

gallery = Path(sys.argv[1])
log = gallery / "AbiContract_CPU_Check.txt"
source = gallery.parents[1] / "Workbench" / "CodeImages" / "CodeImageAbiCheck.cpp"
provenance = {
    "proof": "Frontier project code-image C ABI revision-2 lifecycle check",
    "execution": "Linux C++ ABI check only; no native Frontier/Vulkan/UI execution.",
    "runner": "Exhibits/Workbench/CodeImages/RunAbiContractCheck.sh",
    "contract": {"revision": 2, "fingerprint": "0xdd4363893c94c8f0"},
    "checks": [
        "Loads both independently linked project code images with dlopen.",
        "Accepts the current revision/fingerprint and exact C-layout interchange.",
        "Refuses a revision-1 request before callbacks run.",
        "Calls construct, cycle advance, and retirement callbacks.",
        "Receives five Project-Zero C-layout panel declarations and the exact 20 x 20 material-showcase subject set.",
        "Receives seven Project-Drive C-layout panel declarations, including ControlVehicle, XPBD tyres, telemetry, material showcase and Surfel GI / ReSTIR.",
        "Receives the exact Project-Drive vehicle/course subject set, including body paint/glass/trim, four XPBD tyres, wheel hubs, brakes, course props and 20 x 20 material-showcase subjects.",
        "Receives visibility-raster, Surfel-GI and ReSTIR rendering preferences from both projects, plus one camera request per project.",
        "Receives Project-Zero and Project-Drive diagnostics naming the material showcase and ControlVehicle declarations.",
    ],
    "sha256": {
        "AbiContract_CPU_Check.txt": hashlib.sha256(log.read_bytes()).hexdigest(),
        "Exhibits/Workbench/CodeImages/CodeImageAbiCheck.cpp": hashlib.sha256(source.read_bytes()).hexdigest(),
    },
}
(gallery / "Provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
PY
