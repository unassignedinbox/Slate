//============================================================================================================================================
//                                                            CYCLESCHEDULER.CPP
//============================================================================================================================================
// 🧩 The ordering points of every cyclic slot, the bounded wait that reclaims one, and the advance that cycles them.

#include "SlateVulkan/Device/CycleScheduler/Api/CycleScheduler.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> CycleScheduler::Construct(const VulkanExchange& Exchange, const DiagnosticExtension& Naming)
{
    if (Exchange.ActiveDevice() == VK_NULL_HANDLE)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no device is active" });

    DeviceEdge = &Exchange;
    NamingEdge = &Naming;

    const VkDevice Active = Exchange.ActiveDevice();

    VkFenceCreateInfo CompletionDeclaration = {};
    CompletionDeclaration.sType             = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;

    // 🔴 Signalled at construction. The first recording waits before it has ever submitted, and an unsignalled
    //    completion makes that wait one for a submission that was never made.
    CompletionDeclaration.flags = VK_FENCE_CREATE_SIGNALED_BIT;

    VkSemaphoreCreateInfo OrderingDeclaration = {};
    OrderingDeclaration.sType                 = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;

    Slots.assign(RecordingSlotCount, CycleSlot{});

    // 📝 Walked by ordinal rather than by reference, because the cycle slot is what each of the three points
    //    is named by, and it is the same ordinal `StandingOrdinal` reports the stall against.
    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
    {
        CycleSlot& Slot = Slots[SlotOrdinal];

        const bool Constructed =
            vkCreateFence(Active, &CompletionDeclaration, nullptr, &Slot.Completion)        == VK_SUCCESS &&
            vkCreateSemaphore(Active, &OrderingDeclaration, nullptr, &Slot.ImageArrived)    == VK_SUCCESS &&
            vkCreateSemaphore(Active, &OrderingDeclaration, nullptr, &Slot.RecordingDone)   == VK_SUCCESS;

        // 📝 🔴 Refused in full. A cycle half-constructed leaves some slots orderable and some not, and the
        //    defect surfaces on whichever recording first reaches the unordered slot rather than at bring-up.
        if (!Constructed)
        {
            Reclaim();
            return Deliver<bool>::Refuse(
                { RefusalReason::ExtentExhausted, "the device declined an ordering point of the cycle" });
        }

        // 📝 🔴 `06` §7's diagnostic-name gate. The two semaphores are named apart rather than by one prefix and
        //    an ordinal, because what a stall report needs is the direction — a recording waiting on an image that
        //    never arrived and one whose recording never signalled are different defects with different causes,
        //    and the addresses alone say only that the cycle stopped. The refusals are discarded for
        //    `ByteSpace`'s reason.
        Disregard(NamingEdge->Declare(VK_OBJECT_TYPE_FENCE,
                            reinterpret_cast<std::uint64_t>(Slot.Completion),
                            "CycleScheduler cycle completion",
                            SlotOrdinal));

        Disregard(NamingEdge->Declare(VK_OBJECT_TYPE_SEMAPHORE,
                            reinterpret_cast<std::uint64_t>(Slot.ImageArrived),
                            "CycleScheduler cycle image arrival",
                            SlotOrdinal));

        Disregard(NamingEdge->Declare(VK_OBJECT_TYPE_SEMAPHORE,
                            reinterpret_cast<std::uint64_t>(Slot.RecordingDone),
                            "CycleScheduler cycle recording completion",
                            SlotOrdinal));
    }

    SlotStanding = 0u;
    CompletedCount = 0u;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE WAIT
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> CycleScheduler::Await()
{
    if (DeviceEdge == nullptr || Slots.empty())
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no cycle is constructed" });

    const VkResult Reached = vkWaitForFences(DeviceEdge->ActiveDevice(),
                                             1u,
                                             &Slots[SlotStanding].Completion,
                                             VK_TRUE,
                                             CompletionCeilingNanoseconds);

    if (Reached == VK_TIMEOUT)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::HostDenied, "the slot did not complete within the ceiling; the device is unresponsive" });
    }

    // 🔴 `06` §7: device loss is reported upward before anything is destroyed. Reported here as the refusal
    //    rather than acted on, because what to destroy and in what order is `06` §4.2's recovery and not this
    //    component's — a wait that tore down its own device would remove the operand the recovery re-scores.
    if (Reached == VK_ERROR_DEVICE_LOST)
        return Deliver<bool>::Refuse({ RefusalReason::DeviceLost, "the device was lost awaiting the standing slot" });

    if (Reached != VK_SUCCESS)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the device declined the wait" });

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> CycleScheduler::Arm()
{
    if (DeviceEdge == nullptr || Slots.empty())
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no cycle is constructed" });

    // 📝 Cleared immediately before the submission that signals it, never immediately after the wait. A slot
    //    cleared early and then refused before submitting is a slot no submission will ever signal, and the
    //    next recording to reach it waits the whole ceiling out for nothing.
    if (vkResetFences(DeviceEdge->ActiveDevice(), 1u, &Slots[SlotStanding].Completion) != VK_SUCCESS)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the device declined to clear the completion" });

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE CYCLE
//------------------------------------------------------------------------------------------------------------------------

void CycleScheduler::Advance()
{
    if (Slots.empty())
        return;

    SlotStanding = (SlotStanding + 1u) % static_cast<std::uint32_t>(Slots.size());
    ++CompletedCount;
}

Deliver<CycleSlot> CycleScheduler::Standing() const
{
    if (Slots.empty())
        return Deliver<CycleSlot>::Refuse({ RefusalReason::CapabilityAbsent, "no cycle is constructed" });

    return Deliver<CycleSlot>::Deliver(Slots[SlotStanding]);
}

std::uint32_t CycleScheduler::StandingOrdinal() const
{
    return SlotStanding;
}

std::uint64_t CycleScheduler::CompletedRecordings() const
{
    return CompletedCount;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     RECLAMATION
//------------------------------------------------------------------------------------------------------------------------

void CycleScheduler::Reclaim()
{
    if (DeviceEdge != nullptr && DeviceEdge->ActiveDevice() != VK_NULL_HANDLE)
    {
        const VkDevice Active = DeviceEdge->ActiveDevice();

        for (CycleSlot& Slot : Slots)
        {
            if (Slot.Completion != VK_NULL_HANDLE)
            {
                vkDestroyFence(Active, Slot.Completion, nullptr);
                Slot.Completion = VK_NULL_HANDLE;
            }

            if (Slot.ImageArrived != VK_NULL_HANDLE)
            {
                vkDestroySemaphore(Active, Slot.ImageArrived, nullptr);
                Slot.ImageArrived = VK_NULL_HANDLE;
            }

            if (Slot.RecordingDone != VK_NULL_HANDLE)
            {
                vkDestroySemaphore(Active, Slot.RecordingDone, nullptr);
                Slot.RecordingDone = VK_NULL_HANDLE;
            }
        }
    }

    Slots.clear();
    SlotStanding = 0u;
}

CycleScheduler::~CycleScheduler()
{
    Reclaim();
}

}   // namespace Slate
