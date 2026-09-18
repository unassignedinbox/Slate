#!/usr/bin/env bash
# Frame synchronization — the descriptor sets a pending command buffer is reading must not be rewritten.
#
#    The 2026-09-18 Windows run reported, once per frame:
#
#        [Vulkan Validation] VUID-vkUpdateDescriptorSets-None-03047 ... dstSet=... dstBinding=25
#        [Vulkan Validation] VUID-vkUpdateDescriptorSets-None-03047 ... dstSet=... dstBinding=26
#
#    Bindings 25/26 are the indirect pool's reservoir pair (GiPrevReservoirs / GiCurrReservoirs) — the history GI
#    accumulates in — and their prev/curr roles swap every presented frame. The swap used to rewrite the ONE compute
#    descriptor set, while RecordAndPresent waits only its OWN cycle slot's fence before recording: the other slot's
#    submission could still be executing against that set. Validation was right, and the writes it was flagging are
#    exactly the ones the indirect half depends on for temporal reuse.
#
#    The fix is structural, so the check is too: one compute set PER CYCLE SLOT, and the per-frame parity write
#    touches only the slot being recorded (the one whose fence was just waited on). This gate reads the device
#    source and fails if any of the three legs of that argument goes away:
#
#        ① the compute descriptor pool is sized for every cycle slot and a set is allocated for each
#        ② the per-frame reservoir write targets ComputeDescriptorSets[WriteSlot], and WriteSlot is ActiveSlot
#        ③ the frame waits the active slot's fence BEFORE the parity swap, and the bind uses the active slot's set
#
#    It is a source-level gate on purpose. There is no Vulkan device in the sandbox, so the alternative is no check
#    at all until a driver says so — which is how this arrived the first time.
#
#    Usage: CheckFrameSynchronization.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1

Source="Engine/DeviceExchange/SwapchainExchange.cpp"
Pass() { echo "  PASS  $1"; }
Fail() { echo "  FAIL  $1"; Failures=$((Failures + 1)); }
Failures=0

[ -f "$Source" ] || { echo "  FAIL  $Source is missing"; exit 1; }

# One helper so a check can be "this pattern appears exactly N times" or "these appear in this order".
Count() { grep -c -- "$1" "$Source" 2>/dev/null || echo 0; }
Ordered() {  # Ordered <first-pattern> <second-pattern> — both present, first before second
    local A B
    A="$(grep -n -- "$1" "$Source" | head -1 | cut -d: -f1)"
    B="$(grep -n -- "$2" "$Source" | head -1 | cut -d: -f1)"
    [ -n "$A" ] && [ -n "$B" ] && [ "$A" -lt "$B" ]
}

# ① per-slot sets exist ------------------------------------------------------
if grep -q "VkDescriptorSet *ComputeDescriptorSets\[kCycleSlotCount\]" "$Source"; then
    Pass "① the compute sets are an array of kCycleSlotCount, not one shared set"
else
    Fail "① the compute descriptor set is not per cycle slot — a frame rewrite can hit a set in use"
fi

if grep -q "PoolInfo.maxSets *= *kCycleSlotCount" "$Source"; then
    Pass "② the compute descriptor pool is sized for every cycle slot"
else
    Fail "② the compute descriptor pool does not have room for one set per cycle slot"
fi

if grep -q "AllocateInfo.descriptorSetCount *= *kCycleSlotCount" "$Source" &&
   grep -q "VariableInfo.descriptorSetCount *= *kCycleSlotCount" "$Source"; then
    Pass "③ every slot's set is allocated, each carrying the full bindless variable count"
else
    Fail "③ the sets are not all allocated (the bindless table's variable count is per set)"
fi

# ④ the per-frame write is scoped to the slot being recorded -----------------
if grep -q "const uint32_t WriteSlot = Vulkan->ActiveSlot;" "$Source"; then
    Pass "④ the per-frame reservoir write names its target slot explicitly"
else
    Fail "④ the per-frame reservoir write does not scope itself to the slot being recorded"
fi

if grep -q "Writes\[I\].dstSet * = *Vulkan->ComputeDescriptorSets\[WriteSlot\]" "$Source"; then
    Pass "⑤ both reservoir pairs (16/17 and 25/26) are written into that one slot's set"
else
    Fail "⑤ the per-frame write does not target ComputeDescriptorSets[WriteSlot]"
fi

# ⑥ the order that makes it legal: fence → swap, and bind the active slot ---
if Ordered "vkWaitForFences(Vulkan->Device, 1u, &Vulkan->CycleFences\[ActiveSlot\], VK_TRUE, UINT64_MAX)" \
           "void\* PrevReservoirs = SwapReservoirParity()"; then
    Pass "⑥ the frame waits the active slot's fence before the parity swap"
else
    Fail "⑥ the parity swap is not ordered after the slot's fence wait — the write may hit a pending set"
fi

if grep -q "&Vulkan->ComputeDescriptorSets\[Vulkan->ActiveSlot\], 0u, nullptr);" "$Source"; then
    Pass "⑦ the kernel binds the active slot's set"
else
    Fail "⑦ the kernel does not bind the active slot's set (it would read another slot's parity)"
fi

# ⑦ every OTHER writer is quiescent ----------------------------------------
#    WriteDescriptorSet() rewrites all slots at once, which is only sound when nothing is in flight. Every caller
#    must be a load-time upload or the resize path, both of which drain the device.
Unsafe=0
for Line in $(grep -n "WriteDescriptorSet();" "$Source" | cut -d: -f1); do
    Context="$(awk -v l="$Line" 'NR>=l-40 && NR<=l' "$Source")"
    case "$Context" in
        *vkDeviceWaitIdle*|*QueueWaitIdle*) continue ;;   # an explicit drain above the rewrite
    esac
    # No drain: legal only if the function is one of Bring()'s stages, which runs at bring-up with nothing in flight.
    #    The stage table is the authority for that, so it is read rather than assumed — a function that is NOT in it
    #    and has no drain is a rewrite against a possibly-live frame.
    Enclosing="$(awk -v l="$Line" 'NR<=l && /^[a-zA-Z].*SwapchainExchange::[A-Za-z]+\(/ {f=$0} NR==l {print f}' "$Source" |
                 sed 's/.*SwapchainExchange:://; s/(.*//')"
    if [ -n "$Enclosing" ] && grep -q "&SwapchainExchange::$Enclosing[^A-Za-z0-9_]" "$Source"; then
        continue                                          # a bring-up stage: nothing is in flight when it runs
    fi
    Unsafe=$((Unsafe + 1)); echo "          ⚠ line $Line (in ${Enclosing:-unknown}): no drain and not a bring-up stage"
done
if [ "$Unsafe" -eq 0 ]; then
    Pass "⑧ every full-set rewrite is reachable only after a device drain"
else
    Fail "⑧ $Unsafe full-set rewrite(s) have no drain above them"
fi

# ⑨ no bare single-set reference survives ------------------------------------
if grep -q "ComputeDescriptorSet\b" "$Source"; then
    Fail "⑨ a bare ComputeDescriptorSet reference survives: $(grep -n "ComputeDescriptorSet\b" "$Source" | head -3 | tr '\n' ' ')"
else
    Pass "⑨ no bare single-set reference survives anywhere in the device layer"
fi

echo
if [ "$Failures" -eq 0 ]; then
    echo "[FrameSync] GREEN — the per-frame descriptor writes are scoped to a slot whose fence has been waited on"
    exit 0
fi
echo "[FrameSync] RED — $Failures check(s) failed"
exit 1
