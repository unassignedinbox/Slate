//============================================================================================================================================
//                                                          OCCLUSIONSCHEDULER.CPP
//============================================================================================================================================
// 🧩 The claimed chain, the per-level reduction it is filled by, and the two culling dispatches that compact survivors out of it.

#include "SlateCompute/Compute/VisibilityIndex/Api/OcclusionScheduler.h"

#include <cstring>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   WHAT THE DEVICE READS
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📝 The reduction's workgroup edge, matching `Shader/DepthReduction.slang`'s `[numthreads(8, 8, 1)]`. One invocation per texel
//    of the level being written, so the dispatch is the written extent rounded up to this on both ordinates.
constexpr std::uint32_t ReductionWorkgroupEdge = 8u;   // [-] - invocations per edge of one reduction workgroup

// 📝 The cull's flat workgroup extent, matching `Shader/OcclusionCulling.slang`'s `[numthreads(64, 1, 1)]`. One invocation per
//    **partition**, not per triangle — the compaction writes a run per surviving partition and the run length is the
//    partition's own triangle count, so a per-triangle lane would write the same run a hundred times.
constexpr std::uint32_t OcclusionWorkgroupLanes = 64u;   // [-] - invocations per cull workgroup

// 📝 Three ordinals per level in the extent span — where the level begins in the chain, and how far it runs on each axis. The
//    device selects its own level from a projected extent and then needs all three to address it, which is why the offset is
//    carried rather than re-derived: the halving rounds up, so a device-side prefix sum would have to repeat that rounding
//    exactly and a single disagreement addresses another level entirely.
constexpr std::uint32_t OrdinalsPerLevel = 3u;   // [-] - offset, along, across

// 📝 🔴 `VkDrawIndirectCommand` and not the indexed form. `16` §4's raster draws its fan with `vkCmdDraw` — the corners are
//    reached by division and remainder over the vertex ordinal and no index span exists — so an indexed record would name an
//    index buffer the draw does not bind. The vertex count is what the cull's atomic advances.
constexpr VkDeviceSize IndirectRecordBytes = sizeof(VkDrawIndirectCommand);   // [B] - one record per residency per slot

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OcclusionScheduler::Construct(SpanSpace&         Spans,
                                            ImageSpace&        Images,
                                            const TargetSpace& Claimed,
                                            ShaderCodec&       Modules,
                                            DescriptorIndex&   Descriptors,
                                            ProgramIndex&      Programs)
{
    SpanEdge       = &Spans;
    ImageEdge      = &Images;
    TargetEdge     = &Claimed;
    ModuleEdge     = &Modules;
    DescriptorEdge = &Descriptors;
    ProgramEdge    = &Programs;

    // 🔴 The three reduction slots and their order are the shader's, and the depth target is a **sampled** image rather than a
    //    storage one. `08` §2 claims it with `ImageIntent::DepthTarget`, whose usage admits sampling and attachment and not
    //    storage; a layout declaring a storage image here is one the vendor accepts and the descriptor write then refuses.
    std::vector<DescriptorSlot> Reducing;

    DescriptorSlot ReductionRecord;
    ReductionRecord.SlotOrdinal    = 0u;
    ReductionRecord.Carried        = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    ReductionRecord.CarriedCount   = 1u;
    ReductionRecord.ReachingStages = VK_SHADER_STAGE_COMPUTE_BIT;

    DescriptorSlot DepthRead;
    DepthRead.SlotOrdinal    = 1u;
    DepthRead.Carried        = VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE;
    DepthRead.CarriedCount   = 1u;
    DepthRead.ReachingStages = VK_SHADER_STAGE_COMPUTE_BIT;

    DescriptorSlot ChainWritten;
    ChainWritten.SlotOrdinal    = 2u;
    ChainWritten.Carried        = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    ChainWritten.CarriedCount   = 1u;
    ChainWritten.ReachingStages = VK_SHADER_STAGE_COMPUTE_BIT;

    Reducing.push_back(ReductionRecord);
    Reducing.push_back(DepthRead);
    Reducing.push_back(ChainWritten);

    const Deliver<std::uint32_t> ReductionDeclared = DescriptorEdge->Declare(Reducing);

    if (!ReductionDeclared.ContentPresent)
        return Deliver<bool>::Refuse(ReductionDeclared.Declined);

    ReductionLayout = ReductionDeclared.Resolve();

    // 📝 Seven slots: record, chain, level extents, classification, surviving run, indirect record, verdicts.
    std::vector<DescriptorSlot> Culling;

    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < 7u; ++SlotOrdinal)
    {
        DescriptorSlot Declaring;
        Declaring.SlotOrdinal    = SlotOrdinal;
        Declaring.Carried        = SlotOrdinal == 0u ? VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER
                                                     : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        Declaring.CarriedCount   = 1u;
        Declaring.ReachingStages = VK_SHADER_STAGE_COMPUTE_BIT;

        Culling.push_back(Declaring);
    }

    const Deliver<std::uint32_t> OcclusionDeclared = DescriptorEdge->Declare(Culling);

    if (!OcclusionDeclared.ContentPresent)
        return Deliver<bool>::Refuse(OcclusionDeclared.Declined);

    OcclusionLayout = OcclusionDeclared.Resolve();

    const Deliver<std::uint32_t> ReductionStream = ModuleEdge->Resolve("SlateCompute", "DepthReduction");

    if (!ReductionStream.ContentPresent)
        return Deliver<bool>::Refuse(ReductionStream.Declined);

    const Deliver<std::uint32_t> OcclusionStream = ModuleEdge->Resolve("SlateCompute", "OcclusionCulling");

    if (!OcclusionStream.ContentPresent)
        return Deliver<bool>::Refuse(OcclusionStream.Declined);

    ReductionModule  = ReductionStream.Resolve();
    OcclusionModule  = OcclusionStream.Resolve();

    ComputeDeclaration Reducer;
    Reducer.ModuleOrdinal  = ReductionModule;
    Reducer.LayoutOrdinals = { ReductionLayout };

    const Deliver<std::uint32_t> ReducerProgram = ProgramEdge->DeclareCompute(Reducer);

    if (!ReducerProgram.ContentPresent)
        return Deliver<bool>::Refuse(ReducerProgram.Declined);

    ComputeDeclaration Culler;
    Culler.ModuleOrdinal  = OcclusionModule;
    Culler.LayoutOrdinals = { OcclusionLayout };

    const Deliver<std::uint32_t> CullerProgram = ProgramEdge->DeclareCompute(Culler);

    if (!CullerProgram.ContentPresent)
        return Deliver<bool>::Refuse(CullerProgram.Declined);

    ReductionProgram = ReducerProgram.Resolve();
    OcclusionProgram = CullerProgram.Resolve();

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE ORDERING
//------------------------------------------------------------------------------------------------------------------------

void OcclusionScheduler::Order(VkCommandBuffer      Recorded,
                               VkPipelineStageFlags ReadStages,
                               VkAccessFlags        ReadAccess)
{
    // 📝 A global memory barrier rather than one per span. Every ordering this component records is "everything the dispatch
    //    just wrote, before everything the next thing reads", and naming the spans individually would be four buffer barriers
    //    saying the same thing — with four more places for a span added later to be forgotten.
    VkMemoryBarrier Ordered = {};
    Ordered.sType         = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    Ordered.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    Ordered.dstAccessMask = ReadAccess;

    vkCmdPipelineBarrier(Recorded, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, ReadStages,
                         0u, 1u, &Ordered, 0u, nullptr, 0u, nullptr);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE CHAIN
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OcclusionScheduler::Derive(std::uint32_t DisplayAlong, std::uint32_t DisplayAcross)
{
    if (SpanEdge == nullptr || DescriptorEdge == nullptr || TargetEdge == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "nothing was constructed" });

    const Deliver<bool> Derived = Chain.Construct(DisplayAlong, DisplayAcross);

    if (!Derived.ContentPresent)
        return Derived;

    // 📝 The previous chain's spans are released before the new ones are claimed. `06` §7 requires the device to be idle here,
    //    so nothing is still reading them — and holding them would leak one chain's worth of extent per resize.
    if (ChainSpan != AbsentSpan)
        SpanEdge->Release(ChainSpan);

    if (LevelExtentSpan != AbsentSpan)
        SpanEdge->Release(LevelExtentSpan);

    for (const std::uint32_t Held : ReductionSpans)
    {
        if (Held != AbsentSpan)
            SpanEdge->Release(Held);
    }

    ChainSpan        = AbsentSpan;
    LevelExtentSpan  = AbsentSpan;
    ChainEverReduced = false;

    for (std::size_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
        ReducedFor[SlotOrdinal] = false;

    ReductionSpans.clear();
    LevelOffsets.clear();

    const std::uint32_t Levels = Chain.LevelCount();

    // 🔴 A span of reals and not of the depth target's own reduction levels. `DepthReduction` halves by rounding **up** and the
    //    vendor's level extents halve by rounding down, so the two disagree from the first odd ordinate; `08` §2 claims every
    //    target with one level; and the depth format admits no storage usage, so no dispatch could write into it.
    SpanShape ChainShape;
    ChainShape.SpanBytes = Chain.ChainTexels() * static_cast<VkDeviceSize>(sizeof(float));
    ChainShape.Intent    = SpanIntent::StorageRead;
    ChainShape.Residency = ExtentResidency::DeviceLocal;

    const Deliver<SpanClaim> ChainClaimed = SpanEdge->Claim(ChainShape);

    if (!ChainClaimed.ContentPresent)
        return Deliver<bool>::Refuse(ChainClaimed.Declined);

    ChainSpan = ChainClaimed.Resolve().SpanOrdinal;

    // 📐 The offsets are accumulated here in the one place, from the same level extents the chain was sized against. Deriving
    //    them a second time on the device would be deriving one prefix sum twice.
    LevelOffsets.assign(static_cast<std::size_t>(Levels) * OrdinalsPerLevel, 0u);

    std::uint32_t Accumulated = 0u;

    for (std::uint32_t LevelOrdinal = 0u; LevelOrdinal < Levels; ++LevelOrdinal)
    {
        const Deliver<ReductionLevel> Held = Chain.Level(LevelOrdinal);

        if (!Held.ContentPresent)
            return Deliver<bool>::Refuse(Held.Declined);

        LevelOffsets[LevelOrdinal * OrdinalsPerLevel]        = Accumulated;
        LevelOffsets[LevelOrdinal * OrdinalsPerLevel + 1u]   = Held.Resolve().ExtentAlong;
        LevelOffsets[LevelOrdinal * OrdinalsPerLevel + 2u]   = Held.Resolve().ExtentAcross;

        Accumulated += Held.Resolve().ExtentAlong * Held.Resolve().ExtentAcross;
    }

    // 📝 Host-writable rather than device-local, and deliberately so — the offsets are derived on the host and written once per
    //    derivation, so a device-local span would need a staging span and a recorded transfer to carry a few dozen words.
    SpanShape ExtentShape;
    ExtentShape.SpanBytes = static_cast<VkDeviceSize>(LevelOffsets.size() * sizeof(std::uint32_t));
    ExtentShape.Intent    = SpanIntent::StorageRead;
    ExtentShape.Residency = ExtentResidency::HostWritable;

    const Deliver<SpanClaim> ExtentClaimed = SpanEdge->Claim(ExtentShape);

    if (!ExtentClaimed.ContentPresent)
        return Deliver<bool>::Refuse(ExtentClaimed.Declined);

    LevelExtentSpan = ExtentClaimed.Resolve().SpanOrdinal;

    const Deliver<bool> ExtentWritten = SpanEdge->Amend(LevelExtentSpan,
                                                        LevelOffsets.data(),
                                                        ExtentShape.SpanBytes,
                                                        0u);

    if (!ExtentWritten.ContentPresent)
        return Deliver<bool>::Refuse(ExtentWritten.Declined);

    // 📝 One uniform span per level per cycle slot. The record differs per level and the recording slot count is what keeps the
    //    slot being written from being the slot the device is reading, so both factors are real.
    ReductionSpans.assign(static_cast<std::size_t>(Levels) * RecordingSlotCount, AbsentSpan);

    for (std::size_t Ordinal = 0u; Ordinal < ReductionSpans.size(); ++Ordinal)
    {
        SpanShape RecordShape;
        RecordShape.SpanBytes = static_cast<VkDeviceSize>(sizeof(UploadedReduction));
        RecordShape.Intent    = SpanIntent::UniformRead;
        RecordShape.Residency = ExtentResidency::HostWritable;

        const Deliver<SpanClaim> RecordClaimed = SpanEdge->Claim(RecordShape);

        if (!RecordClaimed.ContentPresent)
            return Deliver<bool>::Refuse(RecordClaimed.Declined);

        ReductionSpans[Ordinal] = RecordClaimed.Resolve().SpanOrdinal;
    }

    if (ReductionClaims.empty())
    {
        for (std::uint32_t LevelOrdinal = 0u; LevelOrdinal < ReductionLevelCeiling; ++LevelOrdinal)
        {
            const Deliver<std::uint32_t> Claimed = DescriptorEdge->Claim(ReductionLayout);

            if (!Claimed.ContentPresent)
                return Deliver<bool>::Refuse(Claimed.Declined);

            ReductionClaims.push_back(Claimed.Resolve());
        }
    }

    const Deliver<ImageClaim> DepthStanding = TargetEdge->Resolve(SharedTarget::DepthSurface);

    if (!DepthStanding.ContentPresent)
        return Deliver<bool>::Refuse(DepthStanding.Declined);

    const Deliver<SpanClaim> ChainStanding  = SpanEdge->Standing(ChainSpan);
    const Deliver<SpanClaim> ExtentStanding = SpanEdge->Standing(LevelExtentSpan);

    if (!ChainStanding.ContentPresent || !ExtentStanding.ContentPresent)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a claimed span no longer stands" });

    for (std::uint32_t LevelOrdinal = 0u; LevelOrdinal < Levels; ++LevelOrdinal)
    {
        for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
        {
            const std::size_t SpanOrdinal = static_cast<std::size_t>(LevelOrdinal) * RecordingSlotCount + SlotOrdinal;

            const Deliver<SpanClaim> RecordStanding = SpanEdge->Standing(ReductionSpans[SpanOrdinal]);

            if (!RecordStanding.ContentPresent)
                return Deliver<bool>::Refuse(RecordStanding.Declined);

            DescriptorContent Recording;
            Recording.SlotOrdinal = 0u;
            Recording.SpanExtent  = RecordStanding.Resolve().Extent;
            Recording.SpanBytes   = RecordStanding.Resolve().SpanBytes;

            DescriptorContent Depth;
            Depth.SlotOrdinal   = 1u;
            Depth.ImageView     = DepthStanding.Resolve().WholeView;
            Depth.ImageStanding = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

            DescriptorContent Chained_;
            Chained_.SlotOrdinal = 2u;
            Chained_.SpanExtent  = ChainStanding.Resolve().Extent;
            Chained_.SpanBytes   = ChainStanding.Resolve().SpanBytes;

            const std::vector<DescriptorContent> Amending = { Recording, Depth, Chained_ };

            const Deliver<bool> Amended = DescriptorEdge->Amend(ReductionClaims[LevelOrdinal], SlotOrdinal, Amending);

            if (!Amended.ContentPresent)
                return Deliver<bool>::Refuse(Amended.Declined);
        }
    }

    for (const CulledResidency& Standing : Culled)
    {
        for (std::uint32_t PhaseIdx = 0u; PhaseIdx < static_cast<std::uint32_t>(CullingPhase::PhaseCount); ++PhaseIdx)
        {
            const CullingPhase Phase = static_cast<CullingPhase>(PhaseIdx);
            for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
            {
                const std::uint32_t SlotIdx = PhaseSlot(Phase, SlotOrdinal);
                DescriptorContent Chained_;
                Chained_.SlotOrdinal = 1u;
                Chained_.SpanExtent  = ChainStanding.Resolve().Extent;
                Chained_.SpanBytes   = ChainStanding.Resolve().SpanBytes;

                DescriptorContent Extents;
                Extents.SlotOrdinal = 2u;
                Extents.SpanExtent  = ExtentStanding.Resolve().Extent;
                Extents.SpanBytes   = ExtentStanding.Resolve().SpanBytes;

                const std::vector<DescriptorContent> Amending = { Chained_, Extents };

                const Deliver<bool> Amended =
                    DescriptorEdge->Amend(Standing.ClaimOrdinals[SlotIdx], SlotOrdinal, Amending);

                if (!Amended.ContentPresent)
                    return Deliver<bool>::Refuse(Amended.Declined);
            }
        }
    }

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE RESIDENCY
//------------------------------------------------------------------------------------------------------------------------

void OcclusionScheduler::Abandon(CulledResidency& Abandoned)
{
    if (SpanEdge == nullptr)
        return;

    for (const std::uint32_t Held : Abandoned.ClassifiedSpans)
    {
        if (Held != AbsentSpan)
            SpanEdge->Release(Held);
    }

    for (const std::uint32_t Held : Abandoned.OcclusionSpans)
    {
        if (Held != AbsentSpan)
            SpanEdge->Release(Held);
    }

    for (const std::uint32_t Held : Abandoned.VerdictSpans)
    {
        if (Held != AbsentSpan)
            SpanEdge->Release(Held);
    }

    for (const std::uint32_t Held : Abandoned.RecordSpans)
    {
        if (Held != AbsentSpan)
            SpanEdge->Release(Held);
    }

    for (const std::uint32_t Held : Abandoned.SurvivingSpans)
    {
        if (Held != AbsentSpan)
            SpanEdge->Release(Held);
    }

    Abandoned = CulledResidency{};
}

Deliver<std::uint32_t> OcclusionScheduler::Resolve(std::uint32_t TriangleCeiling, std::uint32_t PartitionCount)
{
    if (SpanEdge == nullptr || DescriptorEdge == nullptr)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::CapabilityAbsent, "nothing was constructed" });

    if (ChainSpan == AbsentSpan || LevelExtentSpan == AbsentSpan)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no chain is derived" });

    if (TriangleCeiling == 0u || PartitionCount == 0u)
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ContentUnsupported, "a residency carrying no partition and no triangle" });
    }

    CulledResidency Arriving;
    Arriving.TriangleCeiling = TriangleCeiling;
    Arriving.PartitionCount  = PartitionCount;

    const Deliver<SpanClaim> ChainStanding  = SpanEdge->Standing(ChainSpan);
    const Deliver<SpanClaim> ExtentStanding = SpanEdge->Standing(LevelExtentSpan);

    if (!ChainStanding.ContentPresent || !ExtentStanding.ContentPresent)
    {
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "a claimed span no longer stands" });
    }

    // 1. Per-slot spans: ClassifiedSpans, OcclusionSpans, VerdictSpans, AmendedFor
    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
    {
        SpanShape ClassifiedShape;
        ClassifiedShape.SpanBytes = static_cast<VkDeviceSize>(PartitionCount) * sizeof(ClassifiedPartition);
        ClassifiedShape.Intent    = SpanIntent::StorageRead;
        ClassifiedShape.Residency = ExtentResidency::HostWritable;

        const Deliver<SpanClaim> Classified = SpanEdge->Claim(ClassifiedShape);

        if (!Classified.ContentPresent)
        {
            Abandon(Arriving);
            return Deliver<std::uint32_t>::Refuse(Classified.Declined);
        }

        Arriving.ClassifiedSpans.push_back(Classified.Resolve().SpanOrdinal);

        SpanShape UniformShape;
        UniformShape.SpanBytes = static_cast<VkDeviceSize>(sizeof(UploadedOcclusion));
        UniformShape.Intent    = SpanIntent::UniformRead;
        UniformShape.Residency = ExtentResidency::HostWritable;

        const Deliver<SpanClaim> Uniform = SpanEdge->Claim(UniformShape);

        if (!Uniform.ContentPresent)
        {
            Abandon(Arriving);
            return Deliver<std::uint32_t>::Refuse(Uniform.Declined);
        }

        Arriving.OcclusionSpans.push_back(Uniform.Resolve().SpanOrdinal);

        SpanShape VerdictShape;
        VerdictShape.SpanBytes = static_cast<VkDeviceSize>(PartitionCount) * sizeof(std::uint32_t);
        VerdictShape.Intent    = SpanIntent::StorageRead;
        VerdictShape.Residency = ExtentResidency::DeviceLocal;

        const Deliver<SpanClaim> Verdict = SpanEdge->Claim(VerdictShape);

        if (!Verdict.ContentPresent)
        {
            Abandon(Arriving);
            return Deliver<std::uint32_t>::Refuse(Verdict.Declined);
        }

        Arriving.VerdictSpans.push_back(Verdict.Resolve().SpanOrdinal);
        Arriving.AmendedFor.push_back(false);
    }

    // 2. Per-phase-slot spans & descriptor sets: RecordSpans, SurvivingSpans, ClaimOrdinals
    for (std::uint32_t PhaseIdx = 0u; PhaseIdx < static_cast<std::uint32_t>(CullingPhase::PhaseCount); ++PhaseIdx)
    {
        for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
        {
            SpanShape SurvivingShape;
            SurvivingShape.SpanBytes = static_cast<VkDeviceSize>(TriangleCeiling) * sizeof(std::uint32_t);
            SurvivingShape.Intent    = SpanIntent::StorageRead;
            SurvivingShape.Residency = ExtentResidency::DeviceLocal;

            const Deliver<SpanClaim> Surviving = SpanEdge->Claim(SurvivingShape);

            if (!Surviving.ContentPresent)
            {
                Abandon(Arriving);
                return Deliver<std::uint32_t>::Refuse(Surviving.Declined);
            }

            Arriving.SurvivingSpans.push_back(Surviving.Resolve().SpanOrdinal);

            SpanShape RecordShape;
            RecordShape.SpanBytes = IndirectRecordBytes;
            RecordShape.Intent    = SpanIntent::IndirectRecord;
            RecordShape.Residency = ExtentResidency::HostWritable;

            const Deliver<SpanClaim> Record = SpanEdge->Claim(RecordShape);

            if (!Record.ContentPresent)
            {
                Abandon(Arriving);
                return Deliver<std::uint32_t>::Refuse(Record.Declined);
            }

            Arriving.RecordSpans.push_back(Record.Resolve().SpanOrdinal);

            const Deliver<std::uint32_t> Claimed = DescriptorEdge->Claim(OcclusionLayout);

            if (!Claimed.ContentPresent)
            {
                Abandon(Arriving);
                return Deliver<std::uint32_t>::Refuse(Claimed.Declined);
            }

            Arriving.ClaimOrdinals.push_back(Claimed.Resolve());
        }
    }

    // 3. Populate descriptor sets for all PhaseSlots
    for (std::uint32_t PhaseIdx = 0u; PhaseIdx < static_cast<std::uint32_t>(CullingPhase::PhaseCount); ++PhaseIdx)
    {
        const CullingPhase Phase = static_cast<CullingPhase>(PhaseIdx);
        for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
        {
            const std::uint32_t SlotIdx = PhaseSlot(Phase, SlotOrdinal);

            const Deliver<SpanClaim> Uniform    = SpanEdge->Standing(Arriving.OcclusionSpans[SlotOrdinal]);
            const Deliver<SpanClaim> Classified = SpanEdge->Standing(Arriving.ClassifiedSpans[SlotOrdinal]);
            const Deliver<SpanClaim> Verdict    = SpanEdge->Standing(Arriving.VerdictSpans[SlotOrdinal]);
            const Deliver<SpanClaim> Surviving  = SpanEdge->Standing(Arriving.SurvivingSpans[SlotIdx]);
            const Deliver<SpanClaim> Record     = SpanEdge->Standing(Arriving.RecordSpans[SlotIdx]);

            if (!Uniform.ContentPresent || !Classified.ContentPresent || !Verdict.ContentPresent ||
                !Surviving.ContentPresent || !Record.ContentPresent)
            {
                Abandon(Arriving);
                return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "a claimed span no longer stands" });
            }

            std::vector<DescriptorContent> Amending;

            DescriptorContent Recorded_;
            Recorded_.SlotOrdinal = 0u;
            Recorded_.SpanExtent  = Uniform.Resolve().Extent;
            Recorded_.SpanBytes   = Uniform.Resolve().SpanBytes;

            DescriptorContent Chained_;
            Chained_.SlotOrdinal = 1u;
            Chained_.SpanExtent  = ChainStanding.Resolve().Extent;
            Chained_.SpanBytes   = ChainStanding.Resolve().SpanBytes;

            DescriptorContent Extents;
            Extents.SlotOrdinal = 2u;
            Extents.SpanExtent  = ExtentStanding.Resolve().Extent;
            Extents.SpanBytes   = ExtentStanding.Resolve().SpanBytes;

            DescriptorContent Tested;
            Tested.SlotOrdinal = 3u;
            Tested.SpanExtent  = Classified.Resolve().Extent;
            Tested.SpanBytes   = Classified.Resolve().SpanBytes;

            DescriptorContent Survived;
            Survived.SlotOrdinal = 4u;
            Survived.SpanExtent  = Surviving.Resolve().Extent;
            Survived.SpanBytes   = Surviving.Resolve().SpanBytes;

            DescriptorContent Drawn;
            Drawn.SlotOrdinal = 5u;
            Drawn.SpanExtent  = Record.Resolve().Extent;
            Drawn.SpanBytes   = Record.Resolve().SpanBytes;

            DescriptorContent Verdicts_;
            Verdicts_.SlotOrdinal = 6u;
            Verdicts_.SpanExtent  = Verdict.Resolve().Extent;
            Verdicts_.SpanBytes   = Verdict.Resolve().SpanBytes;

            Amending.push_back(Recorded_);
            Amending.push_back(Chained_);
            Amending.push_back(Extents);
            Amending.push_back(Tested);
            Amending.push_back(Survived);
            Amending.push_back(Drawn);
            Amending.push_back(Verdicts_);

            const Deliver<bool> Amended = DescriptorEdge->Amend(Arriving.ClaimOrdinals[SlotIdx], SlotOrdinal, Amending);

            if (!Amended.ContentPresent)
            {
                Abandon(Arriving);
                return Deliver<std::uint32_t>::Refuse(Amended.Declined);
            }
        }
    }

    const std::uint32_t CullingOrdinal = static_cast<std::uint32_t>(Culled.size());

    Culled.push_back(Arriving);

    return Deliver<std::uint32_t>::Deliver(CullingOrdinal);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE CLASSIFICATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OcclusionScheduler::Amend(std::uint32_t                           CullingOrdinal,
                                        std::uint32_t                           SlotOrdinal,
                                        const std::vector<ClassifiedPartition>& Classified)
{
    if (SpanEdge == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "nothing was constructed" });

    if (CullingOrdinal >= static_cast<std::uint32_t>(Culled.size()))
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no residency stands at that ordinal" });

    if (SlotOrdinal >= RecordingSlotCount)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the cycle slot is outside the depth" });

    CulledResidency& Standing = Culled[CullingOrdinal];

    if (static_cast<std::uint32_t>(Classified.size()) != Standing.PartitionCount)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "the classification disagrees with the declared partition count" });
    }

    const Deliver<bool> Written = SpanEdge->Amend(Standing.ClassifiedSpans[SlotOrdinal],
                                                  Classified.data(),
                                                  static_cast<VkDeviceSize>(Classified.size() * sizeof(ClassifiedPartition)),
                                                  0u);

    if (!Written.ContentPresent)
        return Deliver<bool>::Refuse(Written.Declined);

    VkDrawIndirectCommand Cleared = {};
    Cleared.vertexCount   = 0u;
    Cleared.instanceCount = 1u;
    Cleared.firstVertex   = 0u;
    Cleared.firstInstance = 0u;

    for (std::uint32_t PhaseIdx = 0u; PhaseIdx < static_cast<std::uint32_t>(CullingPhase::PhaseCount); ++PhaseIdx)
    {
        const CullingPhase Phase = static_cast<CullingPhase>(PhaseIdx);
        const std::uint32_t SlotIdx = PhaseSlot(Phase, SlotOrdinal);

        const Deliver<bool> Recorded = SpanEdge->Amend(Standing.RecordSpans[SlotIdx],
                                                       &Cleared,
                                                       IndirectRecordBytes,
                                                       0u);

        if (!Recorded.ContentPresent)
            return Deliver<bool>::Refuse(Recorded.Declined);
    }

    Standing.AmendedFor[SlotOrdinal] = true;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE REDUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OcclusionScheduler::ReduceLevel(VkCommandBuffer Recorded,
                                              std::uint32_t   SlotOrdinal,
                                              std::uint32_t   LevelOrdinal)
{
    const Deliver<ReductionLevel> Written = Chain.Level(LevelOrdinal);

    if (!Written.ContentPresent)
        return Deliver<bool>::Refuse(Written.Declined);

    UploadedReduction Reducing;
    Reducing.WrittenLevel  = LevelOrdinal;
    Reducing.WrittenOffset = LevelOffsets[LevelOrdinal * OrdinalsPerLevel];
    Reducing.WrittenAlong  = Written.Resolve().ExtentAlong;
    Reducing.WrittenAcross = Written.Resolve().ExtentAcross;

    if (LevelOrdinal == 0u)
    {
        Reducing.SourceOffset     = 0u;
        Reducing.SourceAlong      = Written.Resolve().ExtentAlong;
        Reducing.SourceAcross     = Written.Resolve().ExtentAcross;
        Reducing.SourceFromTarget = 1u;
    }
    else
    {
        const Deliver<ReductionLevel> Source = Chain.Level(LevelOrdinal - 1u);

        if (!Source.ContentPresent)
            return Deliver<bool>::Refuse(Source.Declined);

        Reducing.SourceOffset     = LevelOffsets[(LevelOrdinal - 1u) * OrdinalsPerLevel];
        Reducing.SourceAlong      = Source.Resolve().ExtentAlong;
        Reducing.SourceAcross     = Source.Resolve().ExtentAcross;
        Reducing.SourceFromTarget = 0u;
    }

    const std::size_t SpanOrdinal = static_cast<std::size_t>(LevelOrdinal) * RecordingSlotCount + SlotOrdinal;

    const Deliver<bool> Amended = SpanEdge->Amend(ReductionSpans[SpanOrdinal],
                                                  &Reducing,
                                                  static_cast<VkDeviceSize>(sizeof(Reducing)),
                                                  0u);

    if (!Amended.ContentPresent)
        return Deliver<bool>::Refuse(Amended.Declined);

    const Deliver<ConstructedProgram> Program = ProgramEdge->Resolve(ReductionProgram);

    if (!Program.ContentPresent)
        return Deliver<bool>::Refuse(Program.Declined);

    const Deliver<VkDescriptorSet> Reaching =
        DescriptorEdge->Resolve(ReductionClaims[LevelOrdinal], SlotOrdinal);

    if (!Reaching.ContentPresent)
        return Deliver<bool>::Refuse(Reaching.Declined);

    const ConstructedProgram& Constructed = Program.Resolve();
    const VkDescriptorSet     Reached     = Reaching.Resolve();

    vkCmdBindPipeline(Recorded, Constructed.RecordedAs, Constructed.Constructed);
    vkCmdBindDescriptorSets(Recorded, Constructed.RecordedAs, Constructed.ReachedLayout, 0u, 1u, &Reached, 0u, nullptr);

    const std::uint32_t GroupsAlong  = (Written.Resolve().ExtentAlong  + ReductionWorkgroupEdge - 1u) / ReductionWorkgroupEdge;
    const std::uint32_t GroupsAcross = (Written.Resolve().ExtentAcross + ReductionWorkgroupEdge - 1u) / ReductionWorkgroupEdge;

    vkCmdDispatch(Recorded, GroupsAlong, GroupsAcross, 1u);

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> OcclusionScheduler::Reduce(VkCommandBuffer Recorded, std::uint32_t SlotOrdinal)
{
    if (SpanEdge == nullptr || ProgramEdge == nullptr || ImageEdge == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "nothing was constructed" });

    if (Recorded == VK_NULL_HANDLE)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no recording was supplied" });

    if (SlotOrdinal >= RecordingSlotCount)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the cycle slot is outside the depth" });

    if (ChainSpan == AbsentSpan || ReductionClaims.empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no chain is derived" });

    const Deliver<std::uint32_t> DepthOrdinal = TargetEdge->OrdinalOf(SharedTarget::DepthSurface);

    if (!DepthOrdinal.ContentPresent)
        return Deliver<bool>::Refuse(DepthOrdinal.Declined);

    const Deliver<bool> Transitioned =
        ImageEdge->Transition(Recorded, DepthOrdinal.Resolve(), VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);

    if (!Transitioned.ContentPresent)
        return Deliver<bool>::Refuse(Transitioned.Declined);

    const std::uint32_t Levels = Chain.LevelCount();

    for (std::uint32_t LevelOrdinal = 0u; LevelOrdinal < Levels; ++LevelOrdinal)
    {
        if (LevelOrdinal != 0u)
            Order(Recorded, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT);

        const Deliver<bool> Written = ReduceLevel(Recorded, SlotOrdinal, LevelOrdinal);

        if (!Written.ContentPresent)
            return Written;
    }

    Order(Recorded, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT);

    ReducedFor[SlotOrdinal] = true;
    ChainEverReduced         = true;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE CULL
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OcclusionScheduler::Cull(VkCommandBuffer Recorded, std::uint32_t SlotOrdinal, CullingPhase Phase)
{
    if (SpanEdge == nullptr || ProgramEdge == nullptr || DescriptorEdge == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "nothing was constructed" });

    if (Recorded == VK_NULL_HANDLE)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no recording was supplied" });

    if (SlotOrdinal >= RecordingSlotCount)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the cycle slot is outside the depth" });

    if (Phase == CullingPhase::PhaseCount)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no such culling phase" });

    if (ChainSpan == AbsentSpan)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no chain is derived" });

    if (Phase == CullingPhase::AgainstCurrent && !ReducedFor[SlotOrdinal])
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "Reduce has not been recorded for this cycle slot" });
    }

    const Deliver<ConstructedProgram> Program = ProgramEdge->Resolve(OcclusionProgram);

    if (!Program.ContentPresent)
        return Deliver<bool>::Refuse(Program.Declined);

    const ConstructedProgram& Constructed = Program.Resolve();

    vkCmdBindPipeline(Recorded, Constructed.RecordedAs, Constructed.Constructed);

    for (CulledResidency& Standing : Culled)
    {
        if (Standing.PartitionCount == 0u)
            continue;

        if (Phase == CullingPhase::AgainstPrevious && !Standing.AmendedFor[SlotOrdinal])
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::ContentUnsupported, "Amend has not written this cycle slot since the last cull" });
        }

        UploadedOcclusion Testing;
        Testing.ClassifiedCount = Standing.PartitionCount;
        Testing.DisplayAlong    = Chain.DisplayAlong();
        Testing.DisplayAcross   = Chain.DisplayAcross();
        Testing.TriangleCeiling = Standing.TriangleCeiling;
        Testing.PhaseOrdinal    = static_cast<std::uint32_t>(Phase);

        Testing.LevelCount = (Phase == CullingPhase::AgainstPrevious && !ChainEverReduced) ? 0u : Chain.LevelCount();

        const Deliver<bool> Written = SpanEdge->Amend(Standing.OcclusionSpans[SlotOrdinal],
                                                      &Testing,
                                                      static_cast<VkDeviceSize>(sizeof(Testing)),
                                                      0u);

        if (!Written.ContentPresent)
            return Deliver<bool>::Refuse(Written.Declined);

        const std::uint32_t SlotIdx = PhaseSlot(Phase, SlotOrdinal);

        const Deliver<VkDescriptorSet> Reaching =
            DescriptorEdge->Resolve(Standing.ClaimOrdinals[SlotIdx], SlotOrdinal);

        if (!Reaching.ContentPresent)
            return Deliver<bool>::Refuse(Reaching.Declined);

        const VkDescriptorSet Reached = Reaching.Resolve();

        vkCmdBindDescriptorSets(Recorded, Constructed.RecordedAs, Constructed.ReachedLayout,
                                0u, 1u, &Reached, 0u, nullptr);

        const std::uint32_t Groups =
            (Standing.PartitionCount + OcclusionWorkgroupLanes - 1u) / OcclusionWorkgroupLanes;

        vkCmdDispatch(Recorded, Groups, 1u, 1u);

        if (Phase == CullingPhase::AgainstCurrent)
        {
            Standing.AmendedFor[SlotOrdinal] = false;
        }
    }

    Order(Recorded,
          VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT | VK_PIPELINE_STAGE_VERTEX_SHADER_BIT,
          VK_ACCESS_INDIRECT_COMMAND_READ_BIT | VK_ACCESS_SHADER_READ_BIT);

    if (Phase == CullingPhase::AgainstCurrent)
    {
        ReducedFor[SlotOrdinal] = false;
    }

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE READS
//------------------------------------------------------------------------------------------------------------------------

Deliver<VkBuffer> OcclusionScheduler::RecordOf(std::uint32_t CullingOrdinal,
                                               std::uint32_t SlotOrdinal,
                                               CullingPhase  Phase) const
{
    if (SpanEdge == nullptr || CullingOrdinal >= static_cast<std::uint32_t>(Culled.size()))
        return Deliver<VkBuffer>::Refuse({ RefusalReason::ContentUnsupported, "no residency stands at that ordinal" });

    if (SlotOrdinal >= RecordingSlotCount || Phase == CullingPhase::PhaseCount)
        return Deliver<VkBuffer>::Refuse({ RefusalReason::ContentUnsupported, "the cycle slot or phase is outside range" });

    const std::uint32_t SlotIdx = PhaseSlot(Phase, SlotOrdinal);
    const Deliver<SpanClaim> Standing = SpanEdge->Standing(Culled[CullingOrdinal].RecordSpans[SlotIdx]);

    if (!Standing.ContentPresent)
        return Deliver<VkBuffer>::Refuse(Standing.Declined);

    return Deliver<VkBuffer>::Deliver(Standing.Resolve().Extent);
}

Deliver<VkBuffer> OcclusionScheduler::SurvivingOf(std::uint32_t CullingOrdinal,
                                                  std::uint32_t SlotOrdinal,
                                                  CullingPhase  Phase) const
{
    if (SpanEdge == nullptr || CullingOrdinal >= static_cast<std::uint32_t>(Culled.size()))
        return Deliver<VkBuffer>::Refuse({ RefusalReason::ContentUnsupported, "no residency stands at that ordinal" });

    if (SlotOrdinal >= RecordingSlotCount || Phase == CullingPhase::PhaseCount)
        return Deliver<VkBuffer>::Refuse({ RefusalReason::ContentUnsupported, "the cycle slot or phase is outside range" });

    const std::uint32_t SlotIdx = PhaseSlot(Phase, SlotOrdinal);
    const Deliver<SpanClaim> Standing = SpanEdge->Standing(Culled[CullingOrdinal].SurvivingSpans[SlotIdx]);

    if (!Standing.ContentPresent)
        return Deliver<VkBuffer>::Refuse(Standing.Declined);

    return Deliver<VkBuffer>::Deliver(Standing.Resolve().Extent);
}

std::uint32_t OcclusionScheduler::CulledCount() const   { return static_cast<std::uint32_t>(Culled.size()); }
std::uint32_t OcclusionScheduler::LevelCount() const    { return Chain.LevelCount();                        }
bool          OcclusionScheduler::ChainDerived() const  { return ChainSpan != AbsentSpan;                   }
bool          OcclusionScheduler::ChainReduced() const  { return ChainEverReduced;                          }

bool OcclusionScheduler::ProgramsStanding() const
{
    return ReductionProgram != AbsentProgram && OcclusionProgram != AbsentProgram;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE RECLAMATION
//------------------------------------------------------------------------------------------------------------------------

void OcclusionScheduler::Reclaim()
{
    if (SpanEdge == nullptr)
        return;

    for (CulledResidency& Standing : Culled)
        Abandon(Standing);

    Culled.clear();

    for (const std::uint32_t Held : ReductionSpans)
    {
        if (Held != AbsentSpan)
            SpanEdge->Release(Held);
    }

    ReductionSpans.clear();
    LevelOffsets.clear();

    if (ChainSpan != AbsentSpan)
        SpanEdge->Release(ChainSpan);

    if (LevelExtentSpan != AbsentSpan)
        SpanEdge->Release(LevelExtentSpan);

    ChainSpan        = AbsentSpan;
    LevelExtentSpan  = AbsentSpan;
    ChainEverReduced = false;

    Chain.Reclaim();

    for (std::size_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
        ReducedFor[SlotOrdinal] = false;
}

}   // namespace Slate
