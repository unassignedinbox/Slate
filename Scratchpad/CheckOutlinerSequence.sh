#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
#  CheckOutlinerSequence.sh — text entry editing rules + outliner tree, search, filter, twirl and rename
# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
set -u
Root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$Root" || exit 1
Fail=0

echo "[Outliner] building the headless proof"
Binary="$(mktemp -u /tmp/OutlinerSequence.XXXXXX)"
if ! g++ -std=c++20 -O2 -Wall -Wextra -I Engine -I . \
     Scratchpad/OutlinerSequenceTest.cpp \
     Engine/DisplayPresentation/InterfaceOutlinerSequence.cpp \
     Engine/DisplayPresentation/TextEntryState.cpp \
     Scratchpad/OutlinerLinkStub.cpp -o "$Binary" 2>/tmp/Outliner.build; then
    echo "  COMPILE FAILED"; sed 's/^/    /' /tmp/Outliner.build | head -25; exit 1
fi
"$Binary" || Fail=1
rm -f "$Binary"

echo
echo "[Outliner] engine ⇄ project seam"
# The engine must never learn game semantics. A single include of Projects/ here would make the outliner
# unusable by any other project and break CLAUDE.md's seam rule.
if grep -rn '#include.*Projects/' Engine/DisplayPresentation/InterfaceOutlinerSequence.* >/dev/null 2>&1; then
    echo "  the outliner includes from Projects/ — the engine must not know game semantics"; Fail=1
fi
# Row types are project-registered; the engine may not hard-code one.
for Word in Sun Moon Cornell Luminaire Showroom; do
    if grep -q "\"$Word" Engine/DisplayPresentation/InterfaceOutlinerSequence.cpp; then
        echo "  the outliner hard-codes the project noun '$Word'"; Fail=1
    fi
done

# Banned vocabulary (CLAUDE.md §2). 'Node' is the one this file would most naturally reach for.
for Word in Widget Atlas Node Pass Manager Registry Element; do
    if grep -qw "$Word" Engine/DisplayPresentation/InterfaceOutlinerSequence.h; then
        echo "  forbidden word '$Word' in the outliner header"; Fail=1
    fi
done

# No heap traffic while drawing: Record() must not allocate.
if grep -nE '(push_back|emplace_back|resize|reserve|new )' Engine/DisplayPresentation/InterfaceOutlinerSequence.cpp \
   | awk -F: '$1 > 190' | grep -q .; then
    echo "  Record() appears to allocate — the render loop must not touch the heap"; Fail=1
fi

[ "$Fail" = "0" ] && echo "  seam and vocabulary hold                                         PASS"

echo
if [ "$Fail" = "0" ]; then echo "[Outliner] OK"; exit 0; else echo "[Outliner] FAILED"; exit 1; fi
