//============================================================================================================================================
//                                                     DISTANCEFIELDREADINESS.CPP
//============================================================================================================================================
// 📦 Verifies that the SDF stage with missing resources cannot report readiness or record commands.

#include "Engine/DeviceExchange/DistanceFieldGIStage.h"

#include <cstdio>
#include <type_traits>

static_assert(!std::is_move_constructible_v<Frontier::DistanceFieldGIStage>);
static_assert(!std::is_move_assignable_v<Frontier::DistanceFieldGIStage>);

/// 📦 Checks refusal and idempotent retirement without creating a Vulkan device or window.
/// err   returns nonzero if missing resources becomes dispatchable
int main()
{
    Frontier::DistanceFieldGIStage ActiveStage;
    Frontier::DistanceFieldStageInit Initialization{};
    Frontier::DistanceFieldFrameParams Frame{};
    const VkCommandBuffer Command = reinterpret_cast<VkCommandBuffer>(static_cast<uintptr_t>(1u));
    for (uint32_t Cycle = 0u; Cycle < 3u; ++Cycle)
    {
        if (ActiveStage.Bring(Initialization) || ActiveStage.IsReady() || ActiveStage.RecordFrame(Command, Frame))
        {
            std::fputs("FAIL: SDF stage with missing resources accepted initialization or command recording\n", stderr);
            return 1;
        }
        ActiveStage.Destroy();
        ActiveStage.Destroy();
    }
    std::puts("PASS: SDF stage with missing resources refuses initialization and dispatch; repeated retirement is safe (no GPU used)");
    return 0;
}
