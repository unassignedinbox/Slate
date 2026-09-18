#!/usr/bin/env bash
#============================================================================================================================================
#                                                     CHECKFRAMETELEMETRY.SH
#============================================================================================================================================
# The verbose per-frame ledger must record everything in a development build and must NOT EXIST in a shipping one.
#
#    The development half links the ledger and exercises RAM-only recording. The shipping half compiles WITHOUT the
#    ledger translation unit: the header must expose no telemetry API, the executable must define no ledger symbol,
#    and the actual Windows/CMake source lists must not name the ledger for production builds.
#
#    usage: bash Tools/Build/CheckFrameTelemetry.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

Stage="$(mktemp -d)"
trap 'rm -rf "$Stage"' EXIT

Gate=Tools/Build/Gates/FrameTelemetryLedgerGate.cpp
Ledger=Projects/Project-Zero/Source/FrameTelemetryLedger.cpp
Warnings=(-Wall -Wextra -Wpedantic -Werror)

# The production contract is intentionally stronger than no-op macros: there is no telemetry API at all when the
# development define is absent. Keep every real call behind an explicit positive FRONTIER_DEVELOPMENT branch, so an
# accidentally unguarded call cannot smuggle timer code back into a shipping translation unit.
echo "── source guards ────────────────────────────────────────────────────────────────"
python3 - <<'PYTHON'
from pathlib import Path
import re

Sources = [
    Path("Projects/Project-Zero/Source/GameExecution.cpp"),
    Path("Engine/DeviceExchange/SwapchainExchange.cpp"),
    Path("Engine/DeviceExchange/VisibilityExchange.cpp"),
    Path("Engine/DeviceExchange/InterfaceExchange.cpp"),
    Path("Engine/GeometricRaster/BlasBuildPipeline.cpp"),
    Path("Tools/Build/Gates/FrameTelemetryLedgerGate.cpp"),
]

for Source in Sources:
    PositiveDevelopmentBranches = []
    Errors = []
    for LineNumber, Line in enumerate(Source.read_text().splitlines(), start=1):
        Directive = Line.lstrip()
        if Directive.startswith("#ifdef"):
            PositiveDevelopmentBranches.append(Directive.split(None, 1)[1].strip() == "FRONTIER_DEVELOPMENT")
        elif Directive.startswith("#ifndef"):
            PositiveDevelopmentBranches.append(False)
        elif Directive.startswith("#if"):
            PositiveDevelopmentBranches.append("defined(FRONTIER_DEVELOPMENT)" in Directive or
                                                "defined FRONTIER_DEVELOPMENT" in Directive)
        elif Directive.startswith("#else"):
            if PositiveDevelopmentBranches:
                PositiveDevelopmentBranches[-1] = not PositiveDevelopmentBranches[-1]
        elif Directive.startswith("#endif"):
            if PositiveDevelopmentBranches:
                PositiveDevelopmentBranches.pop()

        # Definitions in the private development header are deliberately excluded by Sources. A use in these real
        # callers must sit below at least one positive development condition.
        if (re.search(r"\bFRONTIER_TELEMETRY_[A-Z_]+\s*\(", Line) and
                not Directive.startswith("#") and not any(PositiveDevelopmentBranches)):
            Errors.append(str(LineNumber))

    if Errors:
        raise SystemExit(f"FAIL  {Source}: unguarded telemetry use(s) at line(s) {', '.join(Errors)}")
    print(f"  PASS  {Source}: every telemetry use is beneath #ifdef FRONTIER_DEVELOPMENT")
PYTHON

echo
echo "── development build ───────────────────────────────────────────────────────────"
g++ -std=c++20 "${Warnings[@]}" -O1 -g -DFRONTIER_DEVELOPMENT -I. -o "$Stage/LedgerDev" "$Gate" "$Ledger"
( cd "$Stage" && ./LedgerDev )

echo
echo "── shipping build ──────────────────────────────────────────────────────────────"
g++ -std=c++20 "${Warnings[@]}" -O2 -I. -o "$Stage/LedgerShip" "$Gate"
( cd "$Stage" && ./LedgerShip )

echo
echo "── the facility is absent from the shipping executable, not merely disabled ─────"
g++ -std=c++20 "${Warnings[@]}" -O1 -g -DFRONTIER_DEVELOPMENT -I. -c -o "$Stage/Ledger.dev.o" "$Ledger"

DevSymbols=$(nm -C "$Stage/Ledger.dev.o"  2>/dev/null | grep -c "FrameTelemetryLedger" || true)
ShipSymbols=$(nm -C "$Stage/LedgerShip" 2>/dev/null | grep -c "FrameTelemetryLedger" || true)

echo "  development ledger object: $DevSymbols FrameTelemetryLedger symbol(s)"
echo "  shipping executable:       $ShipSymbols FrameTelemetryLedger symbol(s)"

Failed=0
if [ "$DevSymbols" -eq 0 ]; then
    echo "  FAIL  the development build defines no ledger symbols — the facility is not being compiled at all" >&2
    Failed=1
else
    echo "  PASS  the development build carries the ledger"
fi

if [ "$ShipSymbols" -ne 0 ]; then
    echo "  FAIL  the shipping executable still defines $ShipSymbols ledger symbol(s)" >&2
    nm -C "$Stage/LedgerShip" | grep "FrameTelemetryLedger" >&2 || true
    Failed=1
else
    echo "  PASS  the shipping executable links no ledger object or symbols"
fi

# The source lists are the hard build gate: production must not even hand the ledger TU to the compiler.
if bash Tools/Build/CheckBuildSourceList.sh; then
    echo "  PASS  Project-Zero source lists keep the ledger development-only"
else
    echo "  FAIL  Project-Zero source lists do not prove the ledger is development-only" >&2
    Failed=1
fi

[ "$Failed" -eq 0 ] || exit 1
echo
echo "[frame-telemetry] GREEN — verbose in development, omitted from shipping compilation"
