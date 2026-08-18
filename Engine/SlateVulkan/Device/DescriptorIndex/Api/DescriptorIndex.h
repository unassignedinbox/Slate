//============================================================================================================================================
//                                                            DESCRIPTORINDEX.H
//============================================================================================================================================
// 🧩 Descriptor set layouts constructed once at bring-up, and explicit sets claimed one per cycle slot.

#pragma once

#include "Contract/DeliveryContract.h"
#include "Contract/ToleranceContract.h"
#include "SlateVulkan/Device/DiagnosticExtension/Api/DiagnosticExtension.h"
#include "SlateVulkan/Device/VulkanExchange/Api/VulkanExchange.h"

#include <vulkan/vulkan.h>

#include <cstdint>
#include <vector>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE DECLARED SHAPE
//------------------------------------------------------------------------------------------------------------------------

// 📝 No layout; never a valid layout ordinal. Sibling of `ByteSpace`'s `AbsentExtent`.
inline constexpr std::uint32_t AbsentDescriptor = 0xFFFFFFFFu;   // [-] - the claim names no layout

/// 🧩 What one descriptor slot in a layout carries, as the shader declares it.
/// note  🔴 The count is a declaration and not a ceiling. A shader declaring an unsized run reads a count the
///       layout must state, and a layout stating a larger one leaves the shader indexing beyond what is written.
/// tag   nonallocating, nonthrowing
struct DescriptorSlot
{
    std::uint32_t       SlotOrdinal    = 0u;                                    // [-] - the shader's binding ordinal
    VkDescriptorType    Carried        = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;     // [-] - the vendor spelling
    std::uint32_t       CarriedCount   = 1u;                                    // [-] - one, or the run's length
    VkShaderStageFlags  ReachingStages = VK_SHADER_STAGE_COMPUTE_BIT;           // [-] - which stages read it
};

/// 🧩 What one descriptor set is written with — one entry per slot the recording amends.
/// note  ⚠️ Exactly one of the three is read, chosen by the slot's declared `VkDescriptorType`. Writing a
///       sampled image into a slot the layout declares as a span is a validation error at the write rather
///       than at the declaration that disagreed.
/// tag   nonallocating, nonthrowing
struct DescriptorContent
{
    std::uint32_t   SlotOrdinal   = 0u;               // [-] - which declared slot is amended
    VkBuffer        SpanExtent    = VK_NULL_HANDLE;   // [-] - for a span slot; the vendor spelling
    VkDeviceSize    SpanOffset    = 0u;               // [B]
    VkDeviceSize    SpanBytes     = VK_WHOLE_SIZE;    // [B]
    VkImageView     ImageView     = VK_NULL_HANDLE;   // [-] - for an image slot
    VkSampler       ImageSampler  = VK_NULL_HANDLE;   // [-] - null for a storage image
    VkImageLayout   ImageStanding = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;   // [-] - what it stands in when read
};

//------------------------------------------------------------------------------------------------------------------------
//                                                THE DESCRIPTOR LEDGER
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every descriptor set layout the engine declares, and the rotation-deep sets claimed against them.
/// note  🔴 `06` §7's first gate: no descriptor set layout is constructed during a recording. Every layout is
///       declared at bring-up, and `Declare` refuses once `Fix` has been resolved — the gate is a refusal at
///       the call rather than a remark in a review.
/// note  🔴 `06` §2.1 settles explicit sets per cycle slot rather than a bindless arrangement. A claim
///       therefore yields `RecordingSlotCount` sets, and the recording writes the one its slot names —
///       amending a set the device is still reading is the defect the depth exists to remove.
/// tag   owning
class DescriptorIndex
{
public:

    DescriptorIndex()                                  = default;
    DescriptorIndex(const DescriptorIndex&)            = delete;
    DescriptorIndex& operator=(const DescriptorIndex&) = delete;
    ~DescriptorIndex();

    /// 🧩 Takes the device against which every layout and every set is constructed.
    /// in    Exchange  [-]  the created device; borrowed and outlives this component
    /// in    Naming    [-]  names every layout, the extent and every set; borrowed and outlives this component
    /// out   Deliver   [-]  refuses with CapabilityAbsent when no device is active
    /// post  no layout is declared and no set is claimed
    /// note  🔴 `06` §7's diagnostic-name gate. A descriptor set is the object the validation layer names most
    ///        often — every content mismatch is reported against the set rather than against the recording that
    ///        bound it — so an unnamed set turns each of those reports into an address the reader must resolve.
    /// cost  ✔️
    /// tag   api, nonthrowing
    Deliver<bool> Construct(const VulkanExchange& Exchange, const DiagnosticExtension& Naming);

    /// 🧩 Declares one layout from its slots, returning the ordinal every later claim names it by.
    /// in    Declared  [-]  the slots, in any order; slot ordinals need not be contiguous
    /// out   Deliver   [-]  refuses with ContentUnsupported for an empty declaration or a repeated ordinal,
    ///                      and with RelationCyclic once the declaration set has been fixed
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<std::uint32_t> Declare(const std::vector<DescriptorSlot>& Declared);

    /// 🧩 Closes the declaration and constructs the one descriptor extent every later claim is sliced from.
    /// in    ConcurrentSets [-]  how many sets the extent must admit, across every layout and every rotation
    /// out   Deliver        [-]  refuses with ExtentExhausted when the device declines the extent
    /// post  Declare refuses thereafter; Claim delivers
    /// note  🔴 One extent sized against the declaration rather than one grown on demand. A descriptor extent
    ///       that reallocates invalidates every set sliced from it, including the ones a rotation still reads.
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Fix(std::uint32_t ConcurrentSets);

    /// 🧩 Claims one set per cycle slot against a declared layout, returning the claim's ordinal.
    /// in    LayoutOrdinal [-]  a layout this component declared
    /// out   Deliver       [-]  refuses with ExtentExhausted when the extent admits no further set
    /// post  `RecordingSlotCount` sets stand and are addressed by the returned ordinal and a cycle slot
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<std::uint32_t> Claim(std::uint32_t LayoutOrdinal);

    /// 🧩 Writes the content of one claimed set for one cycle slot.
    /// in    ClaimOrdinal  [-]  a claim this component issued
    /// in    SlotOrdinal  [-]  below `RecordingSlotCount`
    /// in    Amended       [-]  one entry per slot being written; a slot omitted is left as it stood
    /// out   Deliver       [-]  refuses with ContentUnsupported for an unclaimed ordinal, a cycle slot at
    ///                          or above the depth, or a slot the layout does not declare
    /// pre   🔴 no recording that reads this set for this cycle slot is still executing
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Amend(std::uint32_t                          ClaimOrdinal,
                        std::uint32_t                          SlotOrdinal,
                        const std::vector<DescriptorContent>&  Amended);

    /// 🧩 The set one claim names for one cycle slot, for the recording that reads it.
    /// out   Deliver  [-]  refuses with ContentUnsupported for an unclaimed ordinal or an excessive slot
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<VkDescriptorSet> Resolve(std::uint32_t ClaimOrdinal, std::uint32_t SlotOrdinal) const;

    /// 🧩 The layout one ordinal names, for the recording that constructs a program against it.
    /// out   Deliver  [-]  refuses with ContentUnsupported for an undeclared ordinal
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<VkDescriptorSetLayout> Layout(std::uint32_t LayoutOrdinal) const;

    /// 🧩 Destroys every set, every layout and the extent they were sliced from.
    /// pre   the device is idle
    /// cost  🚩
    /// tag   api, nonthrowing
    void Reclaim();

    std::uint32_t DeclaredCount() const;
    std::uint32_t ClaimedCount() const;

private:

    struct DeclaredLayout
    {
        VkDescriptorSetLayout        Constructed = VK_NULL_HANDLE;   // [-] - the vendor layout
        std::vector<DescriptorSlot>  Slots       = {};               // [-] - as declared, ordered as given
    };

    struct ClaimedSet
    {
        std::uint32_t                  LayoutOrdinal = AbsentDescriptor;   // [-] - which layout it was sliced against
        std::vector<VkDescriptorSet>   PerSlot   = {};                 // [-] - RecordingSlotCount entries
    };

    /// 🧩 Which declared slot carries an ordinal, or nothing when the layout does not declare it.
    const DescriptorSlot* SlotOf(const DeclaredLayout& Holding, std::uint32_t SlotOrdinal) const;

    const VulkanExchange*        DeviceEdge       = nullptr;         // [-] - borrowed; never owned
    const DiagnosticExtension*   NamingEdge       = nullptr;         // [-] - borrowed; never owned
    VkDescriptorPool             DescriptorExtent = VK_NULL_HANDLE;  // [-] - vendor spelling; one, fixed at Fix
    std::vector<DeclaredLayout>  Layouts          = {};              // [-] - every declared layout
    std::vector<ClaimedSet>      Claimed          = {};              // [-] - every claim, rotation-deep
    bool                         DeclarationFixed = false;           // [-] - true once Fix resolved
};

}   // namespace Slate
