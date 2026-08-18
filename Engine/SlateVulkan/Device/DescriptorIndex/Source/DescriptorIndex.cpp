//============================================================================================================================================
//                                                           DESCRIPTORINDEX.CPP
//============================================================================================================================================
// 🧩 The layout declaration that closes at bring-up, the extent it is sized against, and the per-slot write.

#include "SlateVulkan/Device/DescriptorIndex/Api/DescriptorIndex.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> DescriptorIndex::Construct(const VulkanExchange& Exchange, const DiagnosticExtension& Naming)
{
    if (Exchange.ActiveDevice() == VK_NULL_HANDLE)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no device is active" });

    DeviceEdge = &Exchange;
    NamingEdge = &Naming;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE DECLARATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> DescriptorIndex::Declare(const std::vector<DescriptorSlot>& Declared)
{
    if (DeviceEdge == nullptr)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::CapabilityAbsent, "no device is active" });

    // 🔴 `06` §7's first gate. A layout constructed after the extent was sized is one the extent was not sized
    //    for, and the recording that asked for it is the recording that stalls on the vendor constructing it.
    if (DeclarationFixed)
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::RelationCyclic, "the declaration is closed; no layout is constructed after it" });
    }

    if (Declared.empty())
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "a layout declaring no slot" });

    for (std::size_t Ordinal = 0u; Ordinal < Declared.size(); ++Ordinal)
    {
        if (Declared[Ordinal].CarriedCount == 0u)
            return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "a slot carrying nothing" });

        for (std::size_t Against = Ordinal + 1u; Against < Declared.size(); ++Against)
        {
            if (Declared[Ordinal].SlotOrdinal == Declared[Against].SlotOrdinal)
            {
                return Deliver<std::uint32_t>::Refuse(
                    { RefusalReason::ContentUnsupported, "two slots declare the same ordinal" });
            }
        }
    }

    std::vector<VkDescriptorSetLayoutBinding> VendorDeclared;
    VendorDeclared.reserve(Declared.size());

    for (const DescriptorSlot& Slot : Declared)
    {
        VkDescriptorSetLayoutBinding Carried = {};
        Carried.binding                      = Slot.SlotOrdinal;
        Carried.descriptorType               = Slot.Carried;
        Carried.descriptorCount              = Slot.CarriedCount;
        Carried.stageFlags                   = Slot.ReachingStages;
        Carried.pImmutableSamplers           = nullptr;

        VendorDeclared.push_back(Carried);
    }

    VkDescriptorSetLayoutCreateInfo LayoutDeclaration = {};
    LayoutDeclaration.sType                           = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    LayoutDeclaration.bindingCount                    = static_cast<std::uint32_t>(VendorDeclared.size());
    LayoutDeclaration.pBindings                       = VendorDeclared.data();

    DeclaredLayout Arriving;
    Arriving.Slots = Declared;

    if (vkCreateDescriptorSetLayout(DeviceEdge->ActiveDevice(), &LayoutDeclaration, nullptr, &Arriving.Constructed)
        != VK_SUCCESS)
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ContentUnsupported, "the device declined the declared layout" });
    }

    Layouts.push_back(Arriving);

    const std::uint32_t LayoutOrdinal = static_cast<std::uint32_t>(Layouts.size() - 1u);

    // 📝 🔴 `06` §7's diagnostic-name gate. The refusal is discarded for `ByteSpace`'s reason — a layout that
    //    stands and could not be named is still the layout every program is constructed against.
    Disregard(NamingEdge->Declare(VK_OBJECT_TYPE_DESCRIPTOR_SET_LAYOUT,
                        reinterpret_cast<std::uint64_t>(Arriving.Constructed),
                        "DescriptorIndex layout",
                        LayoutOrdinal));

    return Deliver<std::uint32_t>::Deliver(LayoutOrdinal);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE ONE EXTENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> DescriptorIndex::Fix(std::uint32_t ConcurrentSets)
{
    if (DeviceEdge == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no device is active" });

    if (DeclarationFixed)
        return Deliver<bool>::Refuse({ RefusalReason::RelationCyclic, "the declaration is already closed" });

    if (Layouts.empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no layout was declared" });

    if (ConcurrentSets == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "an extent admitting no set" });

    // 📝 Every declared slot of every declared layout is counted once per admitted set, so the extent is sized
    //    for the worst arrangement of claims across the layouts rather than for one assumed distribution.
    //    Over-sizing costs descriptor bookkeeping the vendor keeps on the host; under-sizing refuses a claim
    //    at the rotation that needed it.
    std::vector<VkDescriptorPoolSize> Admitted;

    for (const DeclaredLayout& Holding : Layouts)
    {
        for (const DescriptorSlot& Slot : Holding.Slots)
        {
            const std::uint32_t Spanned = Slot.CarriedCount * ConcurrentSets;

            bool Folded = false;

            for (VkDescriptorPoolSize& Standing : Admitted)
            {
                if (Standing.type == Slot.Carried)
                {
                    Standing.descriptorCount += Spanned;
                    Folded                    = true;
                    break;
                }
            }

            if (!Folded)
                Admitted.push_back({ Slot.Carried, Spanned });
        }
    }

    VkDescriptorPoolCreateInfo ExtentDeclaration = {};
    ExtentDeclaration.sType                      = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    ExtentDeclaration.maxSets                    = ConcurrentSets * RecordingSlotCount;
    ExtentDeclaration.poolSizeCount              = static_cast<std::uint32_t>(Admitted.size());
    ExtentDeclaration.pPoolSizes                 = Admitted.data();

    // 📝 No free-descriptor-set capability. Sets are returned by resetting the whole extent at teardown, which
    //    is the only point at which none of them is read — an individually freed set is one whose slot the
    //    vendor reuses while a rotation still names it.
    ExtentDeclaration.flags = 0u;

    if (vkCreateDescriptorPool(DeviceEdge->ActiveDevice(), &ExtentDeclaration, nullptr, &DescriptorExtent)
        != VK_SUCCESS)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ExtentExhausted, "the device declined the descriptor extent the declaration was sized to" });
    }

    DeclarationFixed = true;

    // 📝 🔴 `06` §7's gate. Named by the two-operand form and carrying no ordinal, because there is exactly one
    //    descriptor extent for the engine's whole life and an ordinal on a single object reads as one of many.
    Disregard(NamingEdge->Declare(VK_OBJECT_TYPE_DESCRIPTOR_POOL,
                        reinterpret_cast<std::uint64_t>(DescriptorExtent),
                        "DescriptorIndex descriptor extent"));

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE CLAIM
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> DescriptorIndex::Claim(std::uint32_t LayoutOrdinal)
{
    if (DeviceEdge == nullptr || !DeclarationFixed || DescriptorExtent == VK_NULL_HANDLE)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::CapabilityAbsent, "the declaration is not yet closed" });

    if (static_cast<std::size_t>(LayoutOrdinal) >= Layouts.size())
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no layout stands at that ordinal" });

    // 📝 🔴 `06` §2.1: one set per cycle slot, claimed together. Claiming them apart admits a claim that
    //    half-succeeds, and the recording then writes rotation one against a set that was never sliced.
    const std::vector<VkDescriptorSetLayout> Repeated(RecordingSlotCount, Layouts[LayoutOrdinal].Constructed);

    VkDescriptorSetAllocateInfo SetDeclaration = {};
    SetDeclaration.sType                       = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    SetDeclaration.descriptorPool              = DescriptorExtent;
    SetDeclaration.descriptorSetCount          = RecordingSlotCount;
    SetDeclaration.pSetLayouts                 = Repeated.data();

    ClaimedSet Arriving;
    Arriving.LayoutOrdinal = LayoutOrdinal;
    Arriving.PerSlot.assign(RecordingSlotCount, VK_NULL_HANDLE);

    if (vkAllocateDescriptorSets(DeviceEdge->ActiveDevice(), &SetDeclaration, Arriving.PerSlot.data())
        != VK_SUCCESS)
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ExtentExhausted, "the descriptor extent admits no further set" });
    }

    Claimed.push_back(Arriving);

    const std::uint32_t ClaimOrdinal = static_cast<std::uint32_t>(Claimed.size() - 1u);

    // 📝 🔴 `06` §7's gate. A set is addressed by a claim and a cycle slot, and the name carries the two
    //    flattened in the order the depth fixes — so a claim's sets sort adjacently in the driver's text and the
    //    reader recovers the pair the same way `Resolve` reaches the set. Naming by the claim alone would give
    //    every cycle slot of one claim a single name, and a set amended in the wrong slot is exactly the
    //    defect the depth exists to catch.
    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
    {
        Disregard(NamingEdge->Declare(VK_OBJECT_TYPE_DESCRIPTOR_SET,
                            reinterpret_cast<std::uint64_t>(Arriving.PerSlot[SlotOrdinal]),
                            "DescriptorIndex set",
                            ClaimOrdinal * RecordingSlotCount + SlotOrdinal));
    }

    return Deliver<std::uint32_t>::Deliver(ClaimOrdinal);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE WRITE
//------------------------------------------------------------------------------------------------------------------------

const DescriptorSlot* DescriptorIndex::SlotOf(const DeclaredLayout& Holding, std::uint32_t SlotOrdinal) const
{
    for (const DescriptorSlot& Slot : Holding.Slots)
    {
        if (Slot.SlotOrdinal == SlotOrdinal)
            return &Slot;
    }

    return nullptr;
}

Deliver<bool> DescriptorIndex::Amend(std::uint32_t                          ClaimOrdinal,
                                     std::uint32_t                          SlotOrdinal,
                                     const std::vector<DescriptorContent>&  Amended)
{
    if (DeviceEdge == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no device is active" });

    if (static_cast<std::size_t>(ClaimOrdinal) >= Claimed.size())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no claim stands at that ordinal" });

    if (SlotOrdinal >= RecordingSlotCount)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the cycle slot is outside the depth" });

    if (Amended.empty())
        return Deliver<bool>::Deliver(true);

    const ClaimedSet&     Standing = Claimed[ClaimOrdinal];
    const DeclaredLayout& Holding  = Layouts[Standing.LayoutOrdinal];

    // 📝 The two content declarations are held alongside the writes rather than inside the loop, because the
    //    vendor reads them at the call and a pointer into a temporary is a read of what the stack now holds.
    // 🔴 Both are reserved to the whole amendment before the first entry, so that no push moves an entry a
    //    write already points at. Without the reservation the addresses taken below are addresses into a run
    //    the next entry reallocates, and the vendor then reads the content of a freed span.
    std::vector<VkWriteDescriptorSet>    Writes;
    std::vector<VkDescriptorBufferInfo>  SpanContent;
    std::vector<VkDescriptorImageInfo>   ImageContent;

    Writes.reserve(Amended.size());
    SpanContent.reserve(Amended.size());
    ImageContent.reserve(Amended.size());

    for (const DescriptorContent& Content : Amended)
    {
        const DescriptorSlot* Declared = SlotOf(Holding, Content.SlotOrdinal);

        if (Declared == nullptr)
            return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the layout declares no such slot" });

        VkWriteDescriptorSet Written = {};
        Written.sType                = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        Written.dstSet               = Standing.PerSlot[SlotOrdinal];
        Written.dstBinding           = Content.SlotOrdinal;
        Written.dstArrayElement      = 0u;
        Written.descriptorCount      = 1u;
        Written.descriptorType       = Declared->Carried;

        switch (Declared->Carried)
        {
            case VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER:
            case VK_DESCRIPTOR_TYPE_STORAGE_BUFFER:
            case VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER_DYNAMIC:
            case VK_DESCRIPTOR_TYPE_STORAGE_BUFFER_DYNAMIC:
            {
                if (Content.SpanExtent == VK_NULL_HANDLE)
                {
                    return Deliver<bool>::Refuse(
                        { RefusalReason::ContentUnsupported, "a span slot written with no span" });
                }

                SpanContent.push_back({ Content.SpanExtent, Content.SpanOffset, Content.SpanBytes });

                Written.pBufferInfo = &SpanContent.back();
                Written.pImageInfo  = nullptr;
                break;
            }

            default:
            {
                if (Content.ImageView == VK_NULL_HANDLE)
                {
                    return Deliver<bool>::Refuse(
                        { RefusalReason::ContentUnsupported, "an image slot written with no view" });
                }

                ImageContent.push_back({ Content.ImageSampler, Content.ImageView, Content.ImageStanding });

                Written.pImageInfo  = &ImageContent.back();
                Written.pBufferInfo = nullptr;
                break;
            }
        }

        Writes.push_back(Written);
    }

    vkUpdateDescriptorSets(DeviceEdge->ActiveDevice(),
                           static_cast<std::uint32_t>(Writes.size()),
                           Writes.data(),
                           0u,
                           nullptr);

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   WHAT IS DECLARED
//------------------------------------------------------------------------------------------------------------------------

Deliver<VkDescriptorSet> DescriptorIndex::Resolve(std::uint32_t ClaimOrdinal, std::uint32_t SlotOrdinal) const
{
    if (static_cast<std::size_t>(ClaimOrdinal) >= Claimed.size())
        return Deliver<VkDescriptorSet>::Refuse({ RefusalReason::ContentUnsupported, "no claim stands at that ordinal" });

    if (SlotOrdinal >= RecordingSlotCount)
    {
        return Deliver<VkDescriptorSet>::Refuse(
            { RefusalReason::ContentUnsupported, "the cycle slot is outside the depth" });
    }

    return Deliver<VkDescriptorSet>::Deliver(Claimed[ClaimOrdinal].PerSlot[SlotOrdinal]);
}

Deliver<VkDescriptorSetLayout> DescriptorIndex::Layout(std::uint32_t LayoutOrdinal) const
{
    if (static_cast<std::size_t>(LayoutOrdinal) >= Layouts.size())
    {
        return Deliver<VkDescriptorSetLayout>::Refuse(
            { RefusalReason::ContentUnsupported, "no layout stands at that ordinal" });
    }

    return Deliver<VkDescriptorSetLayout>::Deliver(Layouts[LayoutOrdinal].Constructed);
}

std::uint32_t DescriptorIndex::DeclaredCount() const
{
    return static_cast<std::uint32_t>(Layouts.size());
}

std::uint32_t DescriptorIndex::ClaimedCount() const
{
    return static_cast<std::uint32_t>(Claimed.size());
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     RECLAMATION
//------------------------------------------------------------------------------------------------------------------------

void DescriptorIndex::Reclaim()
{
    if (DeviceEdge != nullptr && DeviceEdge->ActiveDevice() != VK_NULL_HANDLE)
    {
        const VkDevice Active = DeviceEdge->ActiveDevice();

        // 📝 The extent before the layouts, and every set with the extent. A set outliving the extent it was
        //    sliced from is a vendor reference into an allocation the driver has already reclaimed.
        if (DescriptorExtent != VK_NULL_HANDLE)
        {
            vkDestroyDescriptorPool(Active, DescriptorExtent, nullptr);
            DescriptorExtent = VK_NULL_HANDLE;
        }

        for (DeclaredLayout& Holding : Layouts)
        {
            if (Holding.Constructed != VK_NULL_HANDLE)
            {
                vkDestroyDescriptorSetLayout(Active, Holding.Constructed, nullptr);
                Holding.Constructed = VK_NULL_HANDLE;
            }
        }
    }

    Claimed.clear();
    Layouts.clear();
    DeclarationFixed = false;
}

DescriptorIndex::~DescriptorIndex()
{
    Reclaim();
}

}   // namespace Slate
