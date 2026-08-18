//============================================================================================================================================
//                                                            VISIBILITYRASTER.CPP
//============================================================================================================================================
// 🧩 The composition, the fan, the residency it becomes, and the one recording that writes `16` §4's targets.

#include "SlateCompute/Compute/VisibilityIndex/Api/VisibilityRaster.h"

#include <cstring>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE COMPOSITION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📐 A column-major product, the outer operand applied second. Written here rather than reached for because
//    `02` holds no matrix product at all — it holds `Compound`, which multiplies decomposed transforms without
//    ever forming one, and the projection this composes with is not decomposable.
ProjectedTransform ComposeCoefficients(const ProjectedTransform& Outer, const ProjectedTransform& Inner)
{
    ProjectedTransform Composed;

    for (std::uint32_t Column = 0u; Column < 4u; ++Column)
    {
        for (std::uint32_t Row = 0u; Row < 4u; ++Row)
        {
            double Accumulated = 0.0;

            for (std::uint32_t Inner_ = 0u; Inner_ < 4u; ++Inner_)
                Accumulated += Outer.Coefficient[Inner_ * 4u + Row] * Inner.Coefficient[Column * 4u + Inner_];

            Composed.Coefficient[Column * 4u + Row] = Accumulated;
        }
    }

    return Composed;
}

}   // namespace

ProjectedTransform ComposeVisibilityTransform(const ViewProjection&     Viewing,
                                              const ProjectedTransform& Placement,
                                              DocumentPosition          ObjectOrigin)
{
    // 🔴 The subtraction happens here, at 64 bits, and it is the whole reason the composition is on the host.
    //    `Rebase` narrows on its way out — which is admissible because what it returns is already relative to
    //    the camera — and the narrowed ordinates then re-enter a 64-bit composition as the fourth column.
    const DevicePosition Rebased = Rebase(ObjectOrigin, Viewing.ViewOrigin);

    ProjectedTransform Placed = Placement;

    Placed.Coefficient[12] = static_cast<double>(Rebased.PositionX);
    Placed.Coefficient[13] = static_cast<double>(Rebased.PositionY);
    Placed.Coefficient[14] = static_cast<double>(Rebased.PositionZ);
    Placed.Coefficient[15] = 1.0;

    return ComposeCoefficients(Viewing.Composed, Placed);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> VisibilityRaster::Construct(SpanSpace&        Spans,
                                          ShaderCodec&      Modules,
                                          DescriptorIndex&  Descriptors,
                                          ProgramIndex&     Programs,
                                          AttachmentIndex&  Attachments)
{
    SpanEdge       = &Spans;
    ModuleEdge     = &Modules;
    DescriptorEdge = &Descriptors;
    ProgramEdge    = &Programs;
    AttachmentEdge = &Attachments;

    // 🔴 The four slots and their order are the shader's, verified against the lowered stream rather than
    //    assumed: `Projecting` at nought, `ObjectPositions` at one, `DrawnTriangles` at two, `SurvivingRun` at
    //    three. A layout declaring them in another order is one the vendor accepts and the device then reads a
    //    triangle out of the uniform for.
    std::vector<DescriptorSlot> Declared;

    DescriptorSlot Projecting;
    Projecting.SlotOrdinal    = 0u;
    Projecting.Carried        = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    Projecting.CarriedCount   = 1u;
    Projecting.ReachingStages = VK_SHADER_STAGE_VERTEX_BIT;

    DescriptorSlot Positions;
    Positions.SlotOrdinal     = 1u;
    Positions.Carried         = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    Positions.CarriedCount    = 1u;
    Positions.ReachingStages  = VK_SHADER_STAGE_VERTEX_BIT;

    DescriptorSlot Triangles;
    Triangles.SlotOrdinal     = 2u;
    Triangles.Carried         = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    Triangles.CarriedCount    = 1u;
    Triangles.ReachingStages  = VK_SHADER_STAGE_VERTEX_BIT;

    // 📝 Bound on every route. The entry point names it statically, so the vendor requires it present whether
    //    or not `SurvivingResolved` routes the corner through it.
    DescriptorSlot Surviving;
    Surviving.SlotOrdinal     = 3u;
    Surviving.Carried         = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    Surviving.CarriedCount    = 1u;
    Surviving.ReachingStages  = VK_SHADER_STAGE_VERTEX_BIT;

    Declared.push_back(Projecting);
    Declared.push_back(Positions);
    Declared.push_back(Triangles);
    Declared.push_back(Surviving);

    const Deliver<std::uint32_t> Layout = DescriptorEdge->Declare(Declared);

    if (!Layout.ContentPresent)
        return Deliver<bool>::Refuse(Layout.Declined);

    LayoutOrdinal = Layout.Resolve();

    // 📝 The stems are the source file names without their extension, which is what the build lowers each
    //    `[shader(...)]` translation to. Each carries exactly one entry point, so each is named `main` and
    //    `ShaderCodec::Stage`'s declaration of that spelling holds.
    const Deliver<std::uint32_t> Corner = ModuleEdge->Resolve("SlateCompute", "VisibilityCorner");

    if (!Corner.ContentPresent)
        return Deliver<bool>::Refuse(Corner.Declined);

    const Deliver<std::uint32_t> Surface = ModuleEdge->Resolve("SlateCompute", "VisibilitySurface");

    if (!Surface.ContentPresent)
        return Deliver<bool>::Refuse(Surface.Declined);

    CornerModule  = Corner.Resolve();
    SurfaceModule = Surface.Resolve();

    // 🔴 The colour order is the fragment's own output order — `SV_Target0` is the visibility word and
    //    `SV_Target1` the occupancy. `AttachmentIndex` declares the run rather than deriving it from the
    //    produced set, and a run listed the other way round writes the occupancy into two unsigned integers.
    ConstructDeclaration Declaring;
    Declaring.ColourTargets = { SharedTarget::VisibilityIndex, SharedTarget::OccupancySurface };
    Declaring.DepthTarget   = static_cast<std::uint32_t>(SharedTarget::DepthSurface);

    const Deliver<std::uint32_t> Construct_ = AttachmentEdge->Declare(Declaring);

    if (!Construct_.ContentPresent)
        return Deliver<bool>::Refuse(Construct_.Declined);

    ConstructOrdinal = Construct_.Resolve();

    const Deliver<VkRenderPass> Standing = AttachmentEdge->ConstructOf(ConstructOrdinal);

    if (!Standing.ContentPresent)
        return Deliver<bool>::Refuse(Standing.Declined);

    // 🔴 `MotionSurface` is the fourth target `16` §4.2 declares and it is not among these two. 🚧 It is the
    //    difference between this projection and the previous rotation's, and no previous projection crosses the
    //    device edge yet — the recording produces three targets until the second transform lands.
    GraphicsDeclaration Programmed;
    Programmed.VertexModule          = CornerModule;
    Programmed.FragmentModule        = SurfaceModule;
    Programmed.LayoutOrdinals        = { LayoutOrdinal };
    Programmed.RenderConstruct       = Standing.Resolve();
    Programmed.ColourAttachmentCount = 2u;
    Programmed.Assembled             = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
    Programmed.FacingCulled          = VK_CULL_MODE_BACK_BIT;
    Programmed.Depth.DepthTested     = true;
    Programmed.Depth.DepthWritten    = true;
    Programmed.Depth.DepthComparison = VK_COMPARE_OP_GREATER;

    const Deliver<std::uint32_t> Program = ProgramEdge->DeclareGraphics(Programmed);

    if (!Program.ContentPresent)
        return Deliver<bool>::Refuse(Program.Declined);

    ProgramOrdinal = Program.Resolve();

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE FAN
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::vector<UploadedTriangle>> VisibilityRaster::Fan(const PartitionStructure&  Enrolled,
                                                            const TopologyStructure&   Imported,
                                                            std::uint32_t              EnrolmentBase) const
{
    using Fanned = std::vector<UploadedTriangle>;

    const DerivedPartitioning& Standing = Enrolled.Standing();

    Fanned Drawn;
    Drawn.reserve(Imported.CornerCount());

    for (std::size_t PartitionOrdinal = 0u; PartitionOrdinal < Standing.Partitions.size(); ++PartitionOrdinal)
    {
        const MicroSurfacePartition& Partitioned = Standing.Partitions[PartitionOrdinal];

        // 🔴 The ordinal written into every pixel is document-wide and the one counted here is not. `16` §4
        //    splits the two components exactly so, and `Enroll` lays the enrolments end to end — so the first
        //    component is the enrolment's base plus the partition's position within this partitioning.
        const std::uint32_t Document = EnrolmentBase + static_cast<std::uint32_t>(PartitionOrdinal);

        std::uint32_t Within = 0u;

        for (std::uint32_t Spanned = 0u; Spanned < Partitioned.FaceCount; ++Spanned)
        {
            const std::size_t Ordered = static_cast<std::size_t>(Partitioned.FirstFace) + Spanned;

            if (Ordered >= Standing.OrderedFaces.size())
            {
                return Deliver<Fanned>::Refuse(
                    { RefusalReason::ContentUnsupported, "a partition spans past the derived ordering" });
            }

            const std::uint32_t Face = Standing.OrderedFaces[Ordered];

            if (Face >= Imported.FaceCount())
            {
                return Deliver<Fanned>::Refuse(
                    { RefusalReason::ContentUnsupported, "the ordering names a face the topology does not carry" });
            }

            const std::uint32_t FirstCorner = Imported.FaceFirstCorner(Face);
            const std::uint32_t CornerCount = Imported.FaceCornerCount(Face);

            // 📝 A triangle fan from the first corner, which is `10`'s own winding preserved. `50` §2 ① never
            //    repairs, so a concave n-gon fans into triangles that overlap — and that is the artist's face
            //    reproduced rather than a retriangulation nothing in the document asked for.
            for (std::uint32_t Corner = 2u; Corner < CornerCount; ++Corner)
            {
                UploadedTriangle Triangle;
                Triangle.CornerVertex0    = Imported.CornerVertex(FirstCorner);
                Triangle.CornerVertex1    = Imported.CornerVertex(FirstCorner + Corner - 1u);
                Triangle.CornerVertex2    = Imported.CornerVertex(FirstCorner + Corner);
                Triangle.PartitionOrdinal = Document;
                Triangle.TriangleOrdinal  = Within;

                Drawn.push_back(Triangle);

                ++Within;
            }
        }

        // 🔴 The two counts are compared rather than trusted. `16` §1 counts the fan triangles the spanned faces
        //    amount to and this derives them; a fan derived differently at the two sites hands the pixel a
        //    triangle ordinal `18` resolves to another triangle of the same partition, which shades as a surface
        //    that is very nearly the right one.
        if (Within != Partitioned.TriangleCount)
        {
            return Deliver<Fanned>::Refuse(
                { RefusalReason::ContentUnsupported, "the fan disagrees with the partition's declared count" });
        }
    }

    if (Drawn.empty())
        return Deliver<Fanned>::Refuse({ RefusalReason::ContentUnsupported, "the partitioning fans to no triangle" });

    return Deliver<Fanned>::Deliver(Drawn);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE STAGING
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> VisibilityRaster::Stage(const void*      Arriving,
                                               VkDeviceSize     ArrivingBytes,
                                               SpanIntent       Intent,
                                               VkCommandBuffer  Recorded)
{
    SpanShape Staging;
    Staging.SpanBytes = ArrivingBytes;
    Staging.Intent    = SpanIntent::TransferSource;
    Staging.Residency = ExtentResidency::HostWritable;

    const Deliver<SpanClaim> Staged = SpanEdge->Claim(Staging);

    if (!Staged.ContentPresent)
        return Deliver<std::uint32_t>::Refuse(Staged.Declined);

    const std::uint32_t StagedOrdinal = Staged.Resolve().SpanOrdinal;

    // 📝 Retained before the write, so that a refusal below still releases it at the next surrender. A staging
    //    span recorded nowhere is one nothing returns until the device is torn down.
    StagedSpans.push_back(StagedOrdinal);

    const Deliver<bool> Written = SpanEdge->Amend(StagedOrdinal, Arriving, ArrivingBytes, 0u);

    if (!Written.ContentPresent)
        return Deliver<std::uint32_t>::Refuse(Written.Declined);

    SpanShape Occupying;
    Occupying.SpanBytes = ArrivingBytes;
    Occupying.Intent    = Intent;
    Occupying.Residency = ExtentResidency::DeviceLocal;

    const Deliver<SpanClaim> Claimed = SpanEdge->Claim(Occupying);

    if (!Claimed.ContentPresent)
        return Deliver<std::uint32_t>::Refuse(Claimed.Declined);

    const std::uint32_t ResidentOrdinal = Claimed.Resolve().SpanOrdinal;

    const Deliver<bool> Carried = SpanEdge->Transfer(Recorded, StagedOrdinal, ResidentOrdinal, ArrivingBytes);

    if (!Carried.ContentPresent)
    {
        SpanEdge->Release(ResidentOrdinal);
        return Deliver<std::uint32_t>::Refuse(Carried.Declined);
    }

    return Deliver<std::uint32_t>::Deliver(ResidentOrdinal);
}

void VisibilityRaster::Abandon(ResidentPartitioning& Abandoned)
{
    if (SpanEdge == nullptr)
        return;

    for (const std::uint32_t Uniform : Abandoned.UniformSpans)
    {
        if (Uniform != AbsentSpan)
            SpanEdge->Release(Uniform);
    }

    if (Abandoned.PositionSpan != AbsentSpan)
        SpanEdge->Release(Abandoned.PositionSpan);

    if (Abandoned.TriangleSpan != AbsentSpan)
        SpanEdge->Release(Abandoned.TriangleSpan);

    Abandoned = ResidentPartitioning{};
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE RESIDENCY
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> VisibilityRaster::Resolve(const PartitionStructure&  Enrolled,
                                                 const TopologyStructure&   Imported,
                                                 std::uint32_t              EnrolmentBase,
                                                 const OcclusionScheduler*  Culling,
                                                 std::uint32_t              CullingOrdinal,
                                                 VkCommandBuffer            Recorded)
{
    if (SpanEdge == nullptr || DescriptorEdge == nullptr)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::CapabilityAbsent, "nothing was constructed" });

    if (Recorded == VK_NULL_HANDLE)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no recording was supplied" });

    if (!Imported.Sealed())
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "the topology is not sealed" });

    if (!Enrolled.PartitioningStanding())
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no partitioning stands" });

    // 🔴 The two must describe one revision. A partitioning derived from an earlier seal addresses faces the
    //    topology has since renumbered nothing about — `10` forbids renumbering — but it spans a face count the
    //    topology no longer has, and the fan then reads corners belonging to another face entirely.
    if (Enrolled.DescribedRevision() != Imported.Revision())
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::IdentityStale, "the partitioning describes another revision of the topology" });
    }

    const Deliver<std::vector<UploadedTriangle>> Fanned = Fan(Enrolled, Imported, EnrolmentBase);

    if (!Fanned.ContentPresent)
        return Deliver<std::uint32_t>::Refuse(Fanned.Declined);

    const std::vector<UploadedTriangle>& Drawn = Fanned.Resolve();

    // 🔴 Narrowed here and nowhere else, and narrowed in **object** space where the extent is the occupant's own.
    //    `02`'s rule is that a document position never narrows; an object position is not one, and the rebasing
    //    it would otherwise need rides in the composed transform instead.
    const std::vector<DocumentPosition>& Positioned = Imported.Positions();

    std::vector<UploadedPosition> Narrowed;
    Narrowed.reserve(Positioned.size());

    for (const DocumentPosition& Held : Positioned)
    {
        UploadedPosition Uploaded;
        Uploaded.PositionX = static_cast<float>(Held.PositionX);
        Uploaded.PositionY = static_cast<float>(Held.PositionY);
        Uploaded.PositionZ = static_cast<float>(Held.PositionZ);

        Narrowed.push_back(Uploaded);
    }

    ResidentPartitioning Arriving;
    Arriving.VertexCount    = static_cast<std::uint32_t>(Narrowed.size());
    Arriving.TriangleCount  = static_cast<std::uint32_t>(Drawn.size());
    Arriving.EnrolmentBase  = EnrolmentBase;
    Arriving.PartitionCount = Enrolled.PartitionCount();
    Arriving.CullingOrdinal = Culling != nullptr ? CullingOrdinal : AbsentSpan;

    const Deliver<std::uint32_t> Positions =
        Stage(Narrowed.data(),
              static_cast<VkDeviceSize>(Narrowed.size() * sizeof(UploadedPosition)),
              SpanIntent::StorageRead,
              Recorded);

    if (!Positions.ContentPresent)
        return Deliver<std::uint32_t>::Refuse(Positions.Declined);

    Arriving.PositionSpan = Positions.Resolve();

    const Deliver<std::uint32_t> Triangles =
        Stage(Drawn.data(),
              static_cast<VkDeviceSize>(Drawn.size() * sizeof(UploadedTriangle)),
              SpanIntent::StorageRead,
              Recorded);

    if (!Triangles.ContentPresent)
    {
        Abandon(Arriving);
        return Deliver<std::uint32_t>::Refuse(Triangles.Declined);
    }

    Arriving.TriangleSpan = Triangles.Resolve();

    // 📝 One host-writable uniform per cycle slot. `06` §2.1 admits explicit sets per slot precisely so that
    //    the block a recording writes is never the block the previous rotation is still reading, and a single
    //    block shared across the depth would reintroduce that read at the one site the depth exists for.
    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
    {
        SpanShape Uniform;
        Uniform.SpanBytes = static_cast<VkDeviceSize>(sizeof(UploadedProjection));
        Uniform.Intent    = SpanIntent::UniformRead;
        Uniform.Residency = ExtentResidency::HostWritable;

        const Deliver<SpanClaim> Claimed = SpanEdge->Claim(Uniform);

        if (!Claimed.ContentPresent)
        {
            Abandon(Arriving);
            return Deliver<std::uint32_t>::Refuse(Claimed.Declined);
        }

        Arriving.UniformSpans.push_back(Claimed.Resolve().SpanOrdinal);
    }

    // 📝 One claim for the direct route and one per culling phase. Three rather than one because slot three
    //    names a different span in each, and a set is written once at enrolment and never rewritten.
    for (std::uint32_t ClaimOrdinal = 0u; ClaimOrdinal < RasterClaimCount; ++ClaimOrdinal)
    {
        if (ClaimOrdinal != DirectClaimOrdinal && Arriving.CullingOrdinal == AbsentSpan)
            break;

        const Deliver<std::uint32_t> Claim_ = DescriptorEdge->Claim(LayoutOrdinal);

        if (!Claim_.ContentPresent)
        {
            Abandon(Arriving);
            return Deliver<std::uint32_t>::Refuse(Claim_.Declined);
        }

        Arriving.ClaimOrdinals.push_back(Claim_.Resolve());
    }

    // 🔴 Written once per cycle slot, here, and never inside a recording. Every span the set names stands for
    //    the residency's whole life, so a per-slot write would rewrite one arrangement with itself — and
    //    would write it into a set the previous rotation's recording still reads.
    for (std::uint32_t ClaimOrdinal = 0u; ClaimOrdinal < Arriving.ClaimOrdinals.size(); ++ClaimOrdinal)
    {
        for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < RecordingSlotCount; ++SlotOrdinal)
        {
            const Deliver<SpanClaim> Uniform  = SpanEdge->Standing(Arriving.UniformSpans[SlotOrdinal]);
            const Deliver<SpanClaim> Position = SpanEdge->Standing(Arriving.PositionSpan);
            const Deliver<SpanClaim> Triangle = SpanEdge->Standing(Arriving.TriangleSpan);

            if (!Uniform.ContentPresent || !Position.ContentPresent || !Triangle.ContentPresent)
            {
                Abandon(Arriving);
                return Deliver<std::uint32_t>::Refuse(
                    { RefusalReason::ContentUnsupported, "a span the set names no longer stands" });
            }

            // 📝 The direct claim binds the triangle span at slot three. It is a valid storage read the entry
            //    point never performs, which is what keeps one program serving both routes.
            VkBuffer     SurvivingExtent = Triangle.Resolve().Extent;
            VkDeviceSize SurvivingBytes  = Triangle.Resolve().SpanBytes;

            if (ClaimOrdinal != DirectClaimOrdinal)
            {
                const CullingPhase Phase = static_cast<CullingPhase>(ClaimOrdinal - 1u);

                const Deliver<VkBuffer> Compacted =
                    Culling->SurvivingOf(Arriving.CullingOrdinal, SlotOrdinal, Phase);

                if (!Compacted.ContentPresent)
                {
                    Abandon(Arriving);
                    return Deliver<std::uint32_t>::Refuse(Compacted.Declined);
                }

                SurvivingExtent = Compacted.Resolve();
                SurvivingBytes  = VK_WHOLE_SIZE;
            }

            DescriptorContent Projecting;
            Projecting.SlotOrdinal = 0u;
            Projecting.SpanExtent  = Uniform.Resolve().Extent;
            Projecting.SpanBytes   = Uniform.Resolve().SpanBytes;

            DescriptorContent Positions_;
            Positions_.SlotOrdinal = 1u;
            Positions_.SpanExtent  = Position.Resolve().Extent;
            Positions_.SpanBytes   = Position.Resolve().SpanBytes;

            DescriptorContent Triangles_;
            Triangles_.SlotOrdinal = 2u;
            Triangles_.SpanExtent  = Triangle.Resolve().Extent;
            Triangles_.SpanBytes   = Triangle.Resolve().SpanBytes;

            DescriptorContent Surviving_;
            Surviving_.SlotOrdinal = 3u;
            Surviving_.SpanExtent  = SurvivingExtent;
            Surviving_.SpanBytes   = SurvivingBytes;

            const std::vector<DescriptorContent> Amending =
                { Projecting, Positions_, Triangles_, Surviving_ };

            const Deliver<bool> Amended =
                DescriptorEdge->Amend(Arriving.ClaimOrdinals[ClaimOrdinal], SlotOrdinal, Amending);

            if (!Amended.ContentPresent)
            {
                Abandon(Arriving);
                return Deliver<std::uint32_t>::Refuse(Amended.Declined);
            }
        }
    }

    const std::uint32_t ResidencyOrdinal = static_cast<std::uint32_t>(Resident.size());

    Resident.push_back(Arriving);

    return Deliver<std::uint32_t>::Deliver(ResidencyOrdinal);
}

void VisibilityRaster::Surrender()
{
    if (SpanEdge == nullptr)
        return;

    for (const std::uint32_t Staged : StagedSpans)
        SpanEdge->Release(Staged);

    StagedSpans.clear();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE DERIVATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> VisibilityRaster::Derive(std::uint32_t DisplayAlong, std::uint32_t DisplayAcross)
{
    if (AttachmentEdge == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "nothing was constructed" });

    return AttachmentEdge->Derive(DisplayAlong, DisplayAcross);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE RECORDING
//------------------------------------------------------------------------------------------------------------------------

Deliver<ConstructedSpan> VisibilityRaster::Open(VkCommandBuffer Recorded, ConstructedProgram& Constructed)
{
    const Deliver<ConstructedSpan> Spanned = AttachmentEdge->Resolve(ConstructOrdinal);

    if (!Spanned.ContentPresent)
        return Spanned;

    const Deliver<ConstructedProgram> Program = ProgramEdge->Resolve(ProgramOrdinal);

    if (!Program.ContentPresent)
        return Deliver<ConstructedSpan>::Refuse(Program.Declined);

    const ConstructedSpan& Covering = Spanned.Resolve();

    Constructed = Program.Resolve();

    // 🔴 Three clears in the construct's own attachment order — the two colour targets, then the depth. The
    //    visibility target clears to `AbsentPartition`, which is `16` §5's unoccupied class and is recognised
    //    downstream by exactly this magnitude; the depth clears to `FarPlaneDepth`, which is nought under the
    //    reversed convention and unity under the ordinary one. Clearing to unity against a greater-than
    //    comparison resolves nothing at all, and the image is empty rather than sorted wrongly.
    VkClearValue Cleared[3] = {};
    Cleared[0].color.uint32[0] = AbsentPartition;
    Cleared[0].color.uint32[1] = 0u;
    Cleared[1].color.float32[0] = 0.0f;
    Cleared[2].depthStencil.depth   = static_cast<float>(FarPlaneDepth);
    Cleared[2].depthStencil.stencil = 0u;

    VkRenderPassBeginInfo Opening = {};
    Opening.sType                    = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    Opening.renderPass               = Covering.RenderConstruct;
    Opening.framebuffer              = Covering.SpannedTargets;
    Opening.renderArea.offset.x      = 0;
    Opening.renderArea.offset.y      = 0;
    Opening.renderArea.extent.width  = Covering.SpannedWidth;
    Opening.renderArea.extent.height = Covering.SpannedHeight;
    Opening.clearValueCount          = 3u;
    Opening.pClearValues             = Cleared;

    vkCmdBeginRenderPass(Recorded, &Opening, VK_SUBPASS_CONTENTS_INLINE);

    // 📝 The extent is the derived one and not what the display currently reports. `AttachmentIndex` delivers it
    //    beside the span for this reason: a viewport derived a second time from the display is the one number
    //    that can disagree with the span a resize has not yet re-derived.
    VkViewport Displayed = {};
    Displayed.x        = 0.0f;
    Displayed.y        = 0.0f;
    Displayed.width    = static_cast<float>(Covering.SpannedWidth);
    Displayed.height   = static_cast<float>(Covering.SpannedHeight);
    Displayed.minDepth = 0.0f;
    Displayed.maxDepth = 1.0f;

    VkRect2D Bounded = {};
    Bounded.offset.x      = 0;
    Bounded.offset.y      = 0;
    Bounded.extent.width  = Covering.SpannedWidth;
    Bounded.extent.height = Covering.SpannedHeight;

    vkCmdSetViewport(Recorded, 0u, 1u, &Displayed);
    vkCmdSetScissor(Recorded, 0u, 1u, &Bounded);

    vkCmdBindPipeline(Recorded, Constructed.RecordedAs, Constructed.Constructed);

    return Deliver<ConstructedSpan>::Deliver(Covering);
}

Deliver<bool> VisibilityRaster::Project(const ResidentPartitioning& Standing,
                                        std::uint32_t               SlotOrdinal,
                                        const ViewProjection&       Viewing,
                                        const ConstructedSpan&      Covering,
                                        bool                        SurvivingResolved)
{
    // ⚠️ 🚧 Every occupant is composed at the identity placement, because nothing yet supplies one. `56` holds
    //    the placements and `ComposeVisibilityTransform` already admits one — the argument arrives with it.
    const ProjectedTransform Composed =
        ComposeVisibilityTransform(Viewing, ProjectedTransform{}, DocumentPosition{});

    UploadedProjection Projecting;

    for (std::uint32_t Coefficient = 0u; Coefficient < 16u; ++Coefficient)
        Projecting.ComposedCoefficient[Coefficient] = static_cast<float>(Composed.Coefficient[Coefficient]);

    Projecting.DisplayAlong        = Covering.SpannedWidth;
    Projecting.DisplayAcross       = Covering.SpannedHeight;
    Projecting.EnrolmentBase       = Standing.EnrolmentBase;
    Projecting.DrawnPartitionCount = Standing.PartitionCount;
    Projecting.SurvivingResolved   = SurvivingResolved ? 1u : 0u;

    return SpanEdge->Amend(Standing.UniformSpans[SlotOrdinal],
                           &Projecting,
                           static_cast<VkDeviceSize>(sizeof(Projecting)),
                           0u);
}

Deliver<bool> VisibilityRaster::Record(VkCommandBuffer        Recorded,
                                       std::uint32_t          SlotOrdinal,
                                       const ViewProjection&  Viewing)
{
    if (SpanEdge == nullptr || ProgramEdge == nullptr || AttachmentEdge == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "nothing was constructed" });

    if (Recorded == VK_NULL_HANDLE)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no recording was supplied" });

    if (SlotOrdinal >= RecordingSlotCount)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the cycle slot is outside the depth" });

    ConstructedProgram Constructed;

    const Deliver<ConstructedSpan> Opened = Open(Recorded, Constructed);

    if (!Opened.ContentPresent)
        return Deliver<bool>::Refuse(Opened.Declined);

    const ConstructedSpan& Covering = Opened.Resolve();

    for (const ResidentPartitioning& Standing : Resident)
    {
        if (Standing.TriangleCount == 0u)
            continue;

        const Deliver<bool> Written = Project(Standing, SlotOrdinal, Viewing, Covering, false);

        if (!Written.ContentPresent)
        {
            vkCmdEndRenderPass(Recorded);
            return Deliver<bool>::Refuse(Written.Declined);
        }

        const Deliver<VkDescriptorSet> Reaching =
            DescriptorEdge->Resolve(Standing.ClaimOrdinals[DirectClaimOrdinal], SlotOrdinal);

        if (!Reaching.ContentPresent)
        {
            vkCmdEndRenderPass(Recorded);
            return Deliver<bool>::Refuse(Reaching.Declined);
        }

        const VkDescriptorSet Reached = Reaching.Resolve();

        vkCmdBindDescriptorSets(Recorded, Constructed.RecordedAs, Constructed.ReachedLayout,
                                0u, 1u, &Reached, 0u, nullptr);

        // 🔴 Three corners per triangle and no index span. The vertex entry point reaches its corner by division
        //    and remainder over `SV_VertexID`, which is what lets one program serve every partitioning — `16` §4
        //    forbids a per-topology input declaration and this is the draw that shape implies.
        vkCmdDraw(Recorded, Standing.TriangleCount * 3u, 1u, 0u, 0u);
    }

    vkCmdEndRenderPass(Recorded);

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE INDIRECT RECORDING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> VisibilityRaster::RecordIndirect(VkCommandBuffer           Recorded,
                                               std::uint32_t             SlotOrdinal,
                                               const ViewProjection&     Viewing,
                                               const OcclusionScheduler& Culling,
                                               CullingPhase              Phase)
{
    if (SpanEdge == nullptr || ProgramEdge == nullptr || AttachmentEdge == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "nothing was constructed" });

    if (Recorded == VK_NULL_HANDLE)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no recording was supplied" });

    if (SlotOrdinal >= RecordingSlotCount || Phase == CullingPhase::PhaseCount)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no such cycle slot or phase" });

    ConstructedProgram Constructed;

    const Deliver<ConstructedSpan> Opened = Open(Recorded, Constructed);

    if (!Opened.ContentPresent)
        return Deliver<bool>::Refuse(Opened.Declined);

    const ConstructedSpan& Covering       = Opened.Resolve();
    const std::uint32_t    ClaimOrdinal   = 1u + static_cast<std::uint32_t>(Phase);

    for (const ResidentPartitioning& Standing : Resident)
    {
        if (Standing.TriangleCount == 0u)
            continue;

        // 🔴 A residency that declared no culling ordinal is refused rather than drawn directly. Falling back
        //    would draw every triangle of it beside the compacted survivors of its neighbours, and the artist
        //    would meet one occupant of a scene costing what the whole scene costs with no way to see why.
        if (Standing.CullingOrdinal == AbsentSpan || Standing.ClaimOrdinals.size() <= ClaimOrdinal)
        {
            vkCmdEndRenderPass(Recorded);
            return Deliver<bool>::Refuse(
                { RefusalReason::ContentUnsupported, "the residency declared no culling ordinal" });
        }

        const Deliver<bool> Written = Project(Standing, SlotOrdinal, Viewing, Covering, true);

        if (!Written.ContentPresent)
        {
            vkCmdEndRenderPass(Recorded);
            return Deliver<bool>::Refuse(Written.Declined);
        }

        const Deliver<VkBuffer> Recording =
            Culling.RecordOf(Standing.CullingOrdinal, SlotOrdinal, Phase);

        if (!Recording.ContentPresent)
        {
            vkCmdEndRenderPass(Recorded);
            return Deliver<bool>::Refuse(Recording.Declined);
        }

        const Deliver<VkDescriptorSet> Reaching =
            DescriptorEdge->Resolve(Standing.ClaimOrdinals[ClaimOrdinal], SlotOrdinal);

        if (!Reaching.ContentPresent)
        {
            vkCmdEndRenderPass(Recorded);
            return Deliver<bool>::Refuse(Reaching.Declined);
        }

        const VkDescriptorSet Reached = Reaching.Resolve();

        vkCmdBindDescriptorSets(Recorded, Constructed.RecordedAs, Constructed.ReachedLayout,
                                0u, 1u, &Reached, 0u, nullptr);

        // 🔴 One draw and not one per partition. The compaction wrote a contiguous run of triangle ordinals and
        //    advanced one corner count, so the whole surviving set of a residency issues as a single draw whose
        //    extent the host never learns.
        vkCmdDrawIndirect(Recorded, Recording.Resolve(), 0u, 1u, 0u);
    }

    vkCmdEndRenderPass(Recorded);

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE RECLAMATION
//------------------------------------------------------------------------------------------------------------------------

void VisibilityRaster::Reclaim()
{
    Surrender();

    for (ResidentPartitioning& Standing : Resident)
        Abandon(Standing);

    Resident.clear();
}

std::uint32_t VisibilityRaster::ResidentCount() const
{
    return static_cast<std::uint32_t>(Resident.size());
}

std::uint32_t VisibilityRaster::DrawnTriangleCount() const
{
    std::uint32_t Drawn = 0u;

    for (const ResidentPartitioning& Standing : Resident)
        Drawn += Standing.TriangleCount;

    return Drawn;
}

bool VisibilityRaster::ProgramStanding() const
{
    return ProgramOrdinal != AbsentProgram;
}

}   // namespace Slate
