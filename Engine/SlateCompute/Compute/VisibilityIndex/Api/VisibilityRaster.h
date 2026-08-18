//============================================================================================================================================
//                                                             VISIBILITYRASTER.H
//============================================================================================================================================
// 🧩 The device residency one partitioning occupies, the program that draws it, and the recording that writes `16` §4's targets.

#pragma once

#include "Contract/DeliveryContract.h"
#include "Contract/PrecisionContract.h"
#include "SlateCompute/Compute/VisibilityIndex/Api/VisibilityIndex.h"
#include "SlateCompute/Compute/VisibilityIndex/Api/OcclusionScheduler.h"
#include "SlateDocument/Document/CameraProjection/Api/CameraProjection.h"
#include "SlateMath/Numeric/TransformProjection/Api/TransformProjection.h"
#include "SlateVulkan/Device/AttachmentIndex/Api/AttachmentIndex.h"
#include "SlateVulkan/Device/CommandSequence/Api/CommandSequence.h"
#include "SlateVulkan/Device/DescriptorIndex/Api/DescriptorIndex.h"
#include "SlateVulkan/Device/ProgramIndex/Api/ProgramIndex.h"
#include "SlateVulkan/Device/ShaderCodec/Api/ShaderCodec.h"
#include "SlateVulkan/Device/SpanSpace/Api/SpanSpace.h"

#include <cstdint>
#include <vector>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE UPLOADED RECORDS
//------------------------------------------------------------------------------------------------------------------------

// 📝 🔴 The three records below are the host halves of what `Shader/VisibilityUniform.slang` declares. They are
//    mirrors and they are checked as mirrors: the static assertions beneath each hold the width and the member
//    count the shader reads, so a member inserted on one side alone fails the build rather than shifting every
//    later member's offset by four bytes and reaching the artist as an image that is nearly right.
//
// ⚠️ There is no shared declaration to reach for. `Shared/` compiles under both toolchains and this does not —
//    the shader form carries semantics and register bindings the host toolchain has no spelling for — so the two
//    are mirrors held in agreement by assertion rather than one declaration read twice.

/// 🧩 One vertex position as the device reads it, in the occupant's own object space.
/// note  🔴 Object space and not rebased, which is what lets the residency persist across rotations. `16` §1
///        forbids rebuilding a partitioning per rotation, and a view-relative span would have to be rewritten
///        whenever the camera moved. The rebasing rides in the composed transform instead — `Compose` below.
/// tag   nonallocating, nonthrowing
struct UploadedPosition
{
    float  PositionX = 0.0f;   // [mm] - in the occupant's own object space
    float  PositionY = 0.0f;   // [mm]
    float  PositionZ = 0.0f;   // [mm]
};

/// 🧩 One drawn triangle as the device reads it — its three corners and the two ordinals a pixel carries.
/// note  🔴 The triangle ordinal counts within its partition and the partition ordinal is document-wide, exactly
///        as `16` §4 splits the two components. `Enroll` lays the enrolments end to end, so the document-wide
///        ordinal written here is the enrolment's base plus the partition's position within it.
/// tag   nonallocating, nonthrowing
struct UploadedTriangle
{
    std::uint32_t  CornerVertex0    = 0u;   // [-] - into the uploaded positions
    std::uint32_t  CornerVertex1    = 0u;   // [-]
    std::uint32_t  CornerVertex2    = 0u;   // [-]
    std::uint32_t  PartitionOrdinal = 0u;   // [-] - document-wide
    std::uint32_t  TriangleOrdinal  = 0u;   // [-] - within the partition
    std::uint32_t  Unoccupied       = 0u;   // [-] - pads the record; the shader never reads it
};

/// 🧩 The uniform block as the device reads it — the composed transform, the display extent and the drawn run.
/// note  📝 Every member is scalar and ordered widest-first, matching the shader's declaration member for
///        member. A matrix member would carry a row stride the two toolchains agree on under one layout rule.
/// tag   nonallocating, nonthrowing
struct UploadedProjection
{
    float          ComposedCoefficient[16] = {};   // [-]  - column-major, as `02` declares a transform
    std::uint32_t  DisplayAlong            = 0u;   // [px] - the extent this rotation is recorded against
    std::uint32_t  DisplayAcross           = 0u;   // [px]
    std::uint32_t  EnrolmentBase           = 0u;   // [-]  - the document-wide ordinal this enrolment begins at
    std::uint32_t  DrawnPartitionCount     = 0u;   // [-]  - partitions the recording draws, from that base
    std::uint32_t  SurvivingResolved       = 0u;   // [-]  - non-zero routes the corner through the surviving run
};

// 📐 The widths the shader reads, asserted rather than commented. A record that grew on one side alone is a
//    span the device walks at the wrong stride, and every ordinal past the first is then another triangle's.
static_assert(sizeof(UploadedPosition)   == 12u, "the device reads three 32-bit ordinates per position");
static_assert(sizeof(UploadedTriangle)   == 24u, "the device reads six 32-bit ordinals per triangle");
static_assert(sizeof(UploadedProjection) == 84u, "the device reads sixteen coefficients and five ordinals");

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE COMPOSED VIEW
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Composes one occupant's placement with the view and the projection, rebasing before anything narrows.
/// in    Viewing      [-]   what `46` derived for this rotation
/// in    Placement    [-]   the occupant's rotation and scale; its fourth column is not read
/// in    ObjectOrigin [mm]  where the occupant's object space sits in the document
/// out   Composed     [-]   the composition, still at 64 bits; the narrowing is the upload's
/// note  🔴 The whole reason this exists on the host. `02`'s `Rebase` subtracts the view origin at 64 bits, and
///         doing it here places the subtraction **before** the narrowing — the one ordering that keeps the
///         precision. A device composing the same product from a narrowed placement has already spent it, and
///         `02` names the result jitter with a plausible-looking cause rather than an error anything reports.
/// note  🔴 The translation arrives as `ObjectOrigin` and **not** in the placement's fourth column, which is
///         why that column is not read. A document-space translation carried inside a matrix is one that has
///         to be rebased out of it again, and `02` §3.1 keeps a transform decomposed for exactly that reason:
///         the rotation and the scale never need the width, and the translation always does.
/// note  📐 Column-major throughout, matching `ProjectedTransform`. The product is `Viewing.Composed` applied
///         after the placement, so the placement is the inner operand and the rebased translation is folded
///         into the fourth column before the two are multiplied.
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
ProjectedTransform ComposeVisibilityTransform(const ViewProjection&     Viewing,
                                              const ProjectedTransform& Placement,
                                              DocumentPosition          ObjectOrigin);

// 📐 The composition is a product of transforms already declared Bounded, and the narrowing at the end is the
//    only rounding it introduces. `00` §3's transitivity rule folds the two to the weaker.
SLATE_DECLARES_PRECISION(PrecisionGuarantee::Bounded, PrecisionGuarantee::Bounded);

//------------------------------------------------------------------------------------------------------------------------
//                                                    WHAT IS RESIDENT
//------------------------------------------------------------------------------------------------------------------------

// 📝 No residency; never a valid residency ordinal. Sibling of `SpanSpace`'s `AbsentSpan`.
inline constexpr std::uint32_t AbsentResidency = 0xFFFFFFFFu;   // [-] - the resolution names no residency

/// 🧩 What one enrolled partitioning occupies on the device, and what a draw over it costs.
/// note  🔴 Claimed once when the topology changes and never per rotation, per `16` §1. The two geometry spans
///        are device-local and are written by one transfer at enrolment; nothing rewrites them while the camera
///        moves, which is what the object-space positions above are for.
/// note  🔴 The descriptor claim and the uniform spans are **per residency** rather than per component. One set
///        reaches one partitioning's two spans, and a recording that amended a shared set between draws would
///        be rewriting a set the draw it just recorded still reads. The uniform is per residency for the same
///        reason and for a second one: it carries the occupant's own composed placement, so a shared block
///        would place every occupant where the last one written stands.
/// tag   owning
struct ResidentPartitioning
{
    std::uint32_t               PositionSpan   = AbsentSpan;         // [-] - the object-space positions, device-local
    std::uint32_t               TriangleSpan   = AbsentSpan;         // [-] - the fanned triangles and their ordinals
    std::vector<std::uint32_t>  UniformSpans   = {};                 // [-] - one per cycle slot, host-writable
    std::vector<std::uint32_t>  ClaimOrdinals  = {};                 // [-] - direct, then one per culling phase
    std::uint32_t               CullingOrdinal = AbsentSpan;         // [-] - `OcclusionScheduler`'s, or absent
    std::uint32_t               VertexCount    = 0u;                 // [-] - positions the span carries
    std::uint32_t               TriangleCount  = 0u;                 // [-] - triangles the span carries
    std::uint32_t               EnrolmentBase  = 0u;                 // [-] - the document-wide ordinal it begins at
    std::uint32_t               PartitionCount = 0u;                 // [-] - partitions the enrolment declared
};

// 📝 Claim ordinal nought is the direct route and the two after it follow `CullingPhase`. Three sets rather than
//    one because slot three names a different surviving run in each, and a set is written once at enrolment.
inline constexpr std::uint32_t DirectClaimOrdinal = 0u;             // [-] - the route that reads no surviving run
inline constexpr std::uint32_t RasterClaimCount   = 1u + static_cast<std::uint32_t>(CullingPhase::PhaseCount);

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE RASTER
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The hardware raster of `16` §3 — the residency it draws from, the program it draws with, and the
///     recording that writes which partition and which triangle every pixel resolved to.
/// note  🔴 `16` §3's hardware path alone. The compute path routes sub-pixel partitions through a 64-bit atomic
///        maximum and is a separate mechanism against the same targets; `RouteOfExtent` already declares which
///        partition belongs to which, and this component draws the partitions the hardware route claims.
/// note  🔴 Constructed at bring-up and never during a recording. The program, the render construct and the
///        descriptor layout are all `06` §7's "fixed before the first rotation", and the per-slot work is
///        one uniform write and one draw per resident enrolment.
/// note  🔴 Two recording routes, and both are required. `Record` draws every triangle of every enrolment and
///        lets depth resolve them — correct, and the arrangement `16` §2 supersedes. `RecordIndirect` issues
///        the draw `OcclusionScheduler` compacted, which is the arrangement `16` §2 gates. The direct route
///        stays because `08` §5's substitution withdraws the compute route entirely where the 64-bit atomic
///        capability was not negotiated, and something must still draw.
/// tag   owning
class VisibilityRaster
{
public:

    VisibilityRaster()                                   = default;
    VisibilityRaster(const VisibilityRaster&)            = delete;
    VisibilityRaster& operator=(const VisibilityRaster&) = delete;

    /// 🧩 Declares the layout, resolves both modules, and constructs the program the raster draws with.
    /// in    Spans        [-]  where every resident span is claimed; borrowed and outlives this component
    /// in    Modules      [-]  where both lowered streams are resolved; borrowed, non-const for the specialisation
    /// in    Descriptors  [-]  where the layout is declared; borrowed and outlives this component
    /// in    Programs     [-]  where the program is constructed; borrowed and outlives this component
    /// in    Attachments  [-]  where the render construct is declared; borrowed and outlives this component
    /// out   Deliver      [-]  refuses with whatever the layout, the modules, the construct or the program refused
    /// pre   🔴 the descriptor declaration is not yet fixed — `Declare` refuses once it is
    /// post  the program stands and the residency is claimable
    /// cost  🔴
    /// tag   api, nonthrowing
    Deliver<bool> Construct(SpanSpace&        Spans,
                            ShaderCodec&      Modules,
                            DescriptorIndex&  Descriptors,
                            ProgramIndex&     Programs,
                            AttachmentIndex&  Attachments);

    /// 🧩 Makes one enrolled partitioning resident, fanning its faces into the triangle run the device draws.
    /// in    Enrolled      [-]  the standing partitioning, from `VisibilityIndex::Enrolled`
    /// in    Imported      [-]  the sealed topology it was derived from, at the same revision
    /// in    EnrolmentBase [-]  the document-wide ordinal this enrolment's partitions begin at
    /// in    Culling       [-]  where the surviving runs come from; null declares the direct route only
    /// in    CullingOrdinal[-]  an ordinal `OcclusionScheduler::Resolve` issued, or AbsentSpan
    /// in    Recorded      [-]  an immediate recording the transfers are written into
    /// out   Deliver       [-]  the residency ordinal; refuses with whatever the claim refused and with
    ///                          ContentUnsupported for an unsealed topology or a partitioning that is not standing
    /// pre   🔴 `DescriptorIndex::Fix` delivered — a set cannot be claimed before the extent it is sliced from
    /// post  the spans stand and are drawn from every rotation until the topology changes
    /// note  🔴 The fan is derived **here** and matches `MicroSurfacePartition::TriangleCount` by construction.
    ///        `10` admits faces of any corner count and `16` §1 counts the fan triangles the spanned faces amount
    ///        to; a fan derived differently at the two sites gives the pixel a triangle ordinal `18` resolves to
    ///        another triangle of the same partition.
    /// note  🔴 The descriptor set is written **here**, once per cycle slot, and never again. Every span it
    ///        names stands for the life of the residency, so a per-slot write would rewrite one arrangement
    ///        with itself — and would do it to a set the previous rotation's recording is still reading.
    /// note  🔴 Slot three is written for **every** claim, the direct one included. The vertex entry point names
    ///        the surviving run statically, so the vendor requires it bound whether or not the uniform routes
    ///        through it; the direct claim binds the triangle span there, which is a valid storage read the
    ///        entry point never performs.
    /// note  ⚠️ The staging spans this claims are **not** released here. They are the source of a transfer the
    ///        caller has not yet surrendered, and returning their bytes at this point hands the free list an
    ///        extent a recorded transfer still names. `Surrender` below is what releases them.
    /// cost  🔴
    /// tag   api, nonthrowing
    Deliver<std::uint32_t> Resolve(const PartitionStructure&  Enrolled,
                                   const TopologyStructure&   Imported,
                                   std::uint32_t              EnrolmentBase,
                                   const OcclusionScheduler*  Culling,
                                   std::uint32_t              CullingOrdinal,
                                   VkCommandBuffer            Recorded);

    /// 🧩 Releases the staging spans every `Resolve` since the last surrender claimed.
    /// pre   🔴 the recording those transfers were written into has been surrendered and has completed
    /// note  🔴 Separate from `Resolve` because the transfer is recorded there and completes at the caller's
    ///        surrender. Releasing inside `Resolve` returns bytes to the free list while a recorded transfer
    ///        still names them, and the next claim then transfers one partitioning's positions out of another's.
    /// cost  🚩
    /// tag   api, nonthrowing
    void Surrender();

    /// 🧩 Derives the render construct's spans against one display extent.
    /// in    DisplayAlong   [px]  the extent this rotation is recorded against
    /// in    DisplayAcross  [px]
    /// out   Deliver        [-]   refuses with whatever `AttachmentIndex` refused
    /// pre   🔴 the device is idle — every rotation reading the previous spans has completed
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Derive(std::uint32_t DisplayAlong, std::uint32_t DisplayAcross);

    /// 🧩 Records the raster for one cycle slot — the construct, the program, and one draw per residency.
    /// in    Recorded      [-]  the open recording of this cycle slot
    /// in    SlotOrdinal  [-]  below `RecordingSlotCount`
    /// in    Viewing       [-]  what `46` derived for this rotation
    /// out   Deliver       [-]  refuses with ContentUnsupported before the spans are derived, and with
    ///                          whatever the descriptor write or the program resolution refused
    /// note  🔴 The depth clear carries `FarPlaneDepth` and the comparison is `VK_COMPARE_OP_GREATER`. Reversed,
    ///        per `Contract/`'s convention — clearing to unity against a greater-than comparison resolves nothing
    ///        at all, and the image is empty rather than wrong, which is the failure mode that gets attributed
    ///        to the geometry.
    /// note  ⚠️ Every occupant is drawn at the identity placement, because nothing yet supplies one. `56` holds
    ///        the placements and the composition already admits one — 🚧 the argument arrives with it.
    /// cost  🔴
    /// tag   api, nonthrowing
    Deliver<bool> Record(VkCommandBuffer        Recorded,
                         std::uint32_t          SlotOrdinal,
                         const ViewProjection&  Viewing);

    /// 🧩 Records the raster for one cycle slot from what one culling phase compacted.
    /// in    Recorded      [-]  the open recording of this cycle slot
    /// in    SlotOrdinal  [-]  below `RecordingSlotCount`
    /// in    Viewing       [-]  what `46` derived for this rotation
    /// in    Culling       [-]  the scheduler whose records the draws are issued from
    /// in    Phase         [-]  which of `16` §2's two phases this draw follows
    /// out   Deliver       [-]  refuses with ContentUnsupported for a residency that declared no culling
    ///                          ordinal, and with whatever the record resolution refused
    /// note  🔴 The corner count is the device's and is never the host's. `vkCmdDrawIndirect` reads it from the
    ///        record the cull advanced, so the host neither knows nor needs to know how many partitions
    ///        survived — which is the whole reason the compaction is on the device.
    /// note  🔴 The caller has already ordered the record against this draw. `OcclusionScheduler::Cull` records
    ///        the barrier declaring the record an indirect read and the surviving run a vertex-stage storage
    ///        read, so nothing further is issued here.
    /// cost  🔴
    /// tag   api, nonthrowing
    Deliver<bool> RecordIndirect(VkCommandBuffer           Recorded,
                                 std::uint32_t             SlotOrdinal,
                                 const ViewProjection&     Viewing,
                                 const OcclusionScheduler& Culling,
                                 CullingPhase              Phase);

    /// 🧩 Releases every resident span and every uniform span.
    /// pre   the device is idle
    /// cost  🚩
    /// tag   api, nonthrowing
    void Reclaim();

    std::uint32_t ResidentCount() const;
    std::uint32_t DrawnTriangleCount() const;
    bool          ProgramStanding() const;

private:

    /// 🧩 Opens the render construct, sets the extent, binds the program, and hands back the covering span.
    /// out   Deliver  [-]  refuses with whatever the span or the program resolution refused
    Deliver<ConstructedSpan> Open(VkCommandBuffer Recorded, ConstructedProgram& Constructed);

    /// 🧩 Writes one residency's uniform for one cycle slot.
    /// in    SurvivingResolved [-]  non-zero routes the corner through the surviving run
    Deliver<bool> Project(const ResidentPartitioning& Standing,
                          std::uint32_t               SlotOrdinal,
                          const ViewProjection&       Viewing,
                          const ConstructedSpan&      Covering,
                          bool                        SurvivingResolved);

    /// 🧩 Fans one partitioning's faces into the triangle run the device draws.
    /// in    Enrolled      [-]  the standing partitioning
    /// in    Imported      [-]  the sealed topology
    /// in    EnrolmentBase [-]  the document-wide ordinal the partitions begin at
    /// out   Deliver       [-]  the fanned run; refuses with ContentUnsupported when the two disagree on a face
    Deliver<std::vector<UploadedTriangle>> Fan(const PartitionStructure&  Enrolled,
                                               const TopologyStructure&   Imported,
                                               std::uint32_t              EnrolmentBase) const;

    /// 🧩 Claims one device-local span and stages the supplied bytes into it through one recorded transfer.
    /// in    Arriving       [-]  what is staged; read for ArrivingBytes and never retained
    /// in    ArrivingBytes  [B]  how far the span runs
    /// in    Intent         [-]  what the device is permitted to read the resident span as
    /// in    Recorded       [-]  the immediate recording the transfer is written into
    /// out   Deliver        [-]  the resident span's ordinal; refuses with whatever the claim refused
    Deliver<std::uint32_t> Stage(const void*      Arriving,
                                 VkDeviceSize     ArrivingBytes,
                                 SpanIntent       Intent,
                                 VkCommandBuffer  Recorded);

    /// 🧩 Releases every span one part-built residency claimed, so a refusal retains nothing.
    /// in    Abandoned  [-]  the residency being given up
    void Abandon(ResidentPartitioning& Abandoned);

    SpanSpace*        SpanEdge        = nullptr;          // [-] - borrowed; never owned
    ShaderCodec*      ModuleEdge      = nullptr;          // [-] - borrowed; never owned
    DescriptorIndex*  DescriptorEdge  = nullptr;          // [-] - borrowed; never owned
    ProgramIndex*     ProgramEdge     = nullptr;          // [-] - borrowed; never owned
    AttachmentIndex*  AttachmentEdge  = nullptr;          // [-] - borrowed; never owned

    std::vector<ResidentPartitioning>  Resident         = {};                 // [-] - one per resident enrolment
    std::vector<std::uint32_t>         StagedSpans      = {};                 // [-] - released at Surrender
    std::uint32_t                      LayoutOrdinal    = AbsentDescriptor;   // [-] - the one declared layout
    std::uint32_t                      ProgramOrdinal   = AbsentProgram;      // [-] - the constructed program
    std::uint32_t                      ConstructOrdinal = AbsentConstruct;    // [-] - the render construct
    std::uint32_t                      CornerModule     = AbsentModule;       // [-] - the vertex stream
    std::uint32_t                      SurfaceModule    = AbsentModule;       // [-] - the fragment stream
};

// 📐 The fan and the ordinals are integer throughout and therefore Exact; the composition carries its own
//    declaration and the raster inherits it. `00` §3's transitivity rule folds them to the weaker of the two.
SLATE_DECLARES_PRECISION(PrecisionGuarantee::Bounded, PrecisionGuarantee::Bounded, PrecisionGuarantee::Exact);

}   // namespace Slate
