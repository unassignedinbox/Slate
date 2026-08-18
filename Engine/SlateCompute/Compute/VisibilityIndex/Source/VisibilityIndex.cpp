//============================================================================================================================================
//                                                           VISIBILITYINDEX.CPP
//============================================================================================================================================
// 🧩 The enrolment run, the recording `08` §3 ② is contributed as, and the two indexed hops one written pixel resolves through.

#include "SlateCompute/Compute/VisibilityIndex/Api/VisibilityIndex.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📝 The recording's own name, spelled once. The schedule orders by it and `86` reports by it, and two spellings
//    of one name are two recordings as far as the ordering is concerned.
// ⚠️ Qualified by what it names rather than spelled `RecordingIdentity`, because that is already the alias for
//    `Identity<RecordingSubject>` and unqualified lookup at the use site finds both at once.
const char* const VisibilityRecordingIdentity = "16-VisibilityIndex";

// 🔴 `08` §5's substitution, declared rather than branched. Where the 64-bit atomic capability was not negotiated
//    the compute route cannot record a depth and an identity in one indivisible word, and every partition takes
//    the hardware path instead — coarser on slivers and correct everywhere. The recording site reads the ordering
//    it was given; it does not test the capability, because a capability tested at five sites is a capability
//    four of them will eventually test differently.
const char* const RecordingSubstitution = "hardware rasterisation for every partition, the compute route withdrawn";

}   // namespace

Deliver<bool> VisibilityIndex::Construct(std::uint32_t DisplayAlong, std::uint32_t DisplayAcross)
{
    // 📝 Forwarded whole. The chain's refusals already name the extent that was refused and restating them here
    //    would give one condition two spellings, which is the case `00` §2 makes against a number read twice.
    return Reduced.Construct(DisplayAlong, DisplayAcross);
}

void VisibilityIndex::Reclaim()
{
    Enrolments.clear();
    DeclaredIdentity.clear();

    Reduced.Reclaim();

    ResolvedRevision = 0u;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE RECORDING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> VisibilityIndex::Contribute(RenderSchedule& Schedule) const
{
    DeclaredRecording Declared;
    Declared.Identity = VisibilityRecordingIdentity;

    // 🔴 Four targets from one recording. `16` §4.2 writes motion here because the previous rotation's projection
    //    of this same triangle is in hand at exactly this point and is recoverable nowhere downstream — a second
    //    recording deriving motion from depth alone recovers the camera's movement and never the occupant's.
    Declared.Produces = { SharedTarget::DepthSurface,
                          SharedTarget::VisibilityIndex,
                          SharedTarget::OccupancySurface,
                          SharedTarget::MotionSurface };

    // 📝 Nothing is read. The reduction phase ① tests against is the **previous** rotation's, which is last
    //    rotation's residue of a target this recording itself produces; declaring it as a read would close a
    //    cycle in an ordering that has no notion of the rotation the ordinate came from.
    Declared.Reads  = {};
    Declared.Amends = {};

    Declared.Command            = RecordingCommand::GraphicsRecording;
    Declared.CapabilityRequired = true;
    Declared.Substitution       = RecordingSubstitution;
    Declared.DisplayReferred    = false;

    return Schedule.Contribute(Declared);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      ENROLMENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> VisibilityIndex::Enroll(OccupantIdentity            Occupant,
                                               const TopologyStructure&    Imported,
                                               const TopologyConditioning& Conditioned,
                                               PartitionResolutionIndex&   Resolutions)
{
    if (!Occupant.IdentityDeclared())
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::IdentityStale, "the occupant identity names no slot" });

    const Deliver<DerivedPartitioning> Derived = DerivePartitioning(Imported, Conditioned);

    if (!Derived.ContentPresent)
        return Deliver<std::uint32_t>::Refuse(Derived.Declined);

    const DerivedPartitioning& Partitioning = Derived.Resolve();

    if (static_cast<std::uint64_t>(DeclaredIdentity.size()) + Partitioning.Partitions.size()
        >= static_cast<std::uint64_t>(AbsentPartition))
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ExtentExhausted, "the document-wide ordinal would reach the one reserved for absence" });
    }

    // 📝 Derived into a standing partitioning of its own before anything document-wide moves. The enrolment is
    //    appended only once the derivation, the adoption and the declaration have all delivered, so a refusal
    //    part of the way through leaves the run exactly as long as it was rather than one entry short of itself.
    std::unique_ptr<PartitionStructure> Standing = std::make_unique<PartitionStructure>();

    const Deliver<bool> Adopted = Standing->Adopt(Partitioning);

    if (!Adopted.ContentPresent)
        return Deliver<std::uint32_t>::Refuse(Adopted.Declined);

    const Deliver<bool> Issued = Standing->Declare(Resolutions, Occupant);

    if (!Issued.ContentPresent)
        return Deliver<std::uint32_t>::Refuse(Issued.Declined);

    std::vector<PartitionIdentity> Arriving;
    Arriving.reserve(Standing->PartitionCount());

    for (std::uint32_t PartitionOrdinal = 0u; PartitionOrdinal < Standing->PartitionCount(); ++PartitionOrdinal)
    {
        const Deliver<PartitionIdentity> Named = Standing->IdentityOf(PartitionOrdinal);

        if (!Named.ContentPresent)
            return Deliver<std::uint32_t>::Refuse(Named.Declined);

        Arriving.push_back(Named.Resolve());
    }

    // 🔴 The document-wide ordinal a pixel carries is the position in this run and not the position within the
    //    enrolment. `16` §4 gives the word one component for it, so the runs are laid end to end and the second
    //    occupant's first partition follows the first occupant's last rather than restarting at nought.
    DeclaredIdentity.insert(DeclaredIdentity.end(), Arriving.begin(), Arriving.end());

    const std::uint32_t EnrolmentOrdinal = static_cast<std::uint32_t>(Enrolments.size());

    Enrolments.push_back(std::move(Standing));

    // 📝 Taken after the declaration and not before. `42` advances its revision as it issues, and a revision read
    //    ahead of the issuing is one `Resolve` compares against and refuses every identity this enrolment holds.
    ResolvedRevision = Resolutions.Revision();

    return Deliver<std::uint32_t>::Deliver(EnrolmentOrdinal);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE RESOLUTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<ResolvedPartition> VisibilityIndex::Resolve(VisibilityWord                  Written,
                                                    const PartitionResolutionIndex& Resolutions) const
{
    // 📝 An unoccupied pixel is refused rather than delivered empty. `16` §5 dispatches it as a class of its own
    //    and every consumer that reaches here instead has read a pixel it already classified as carrying nothing.
    if (Written.PartitionOrdinal == AbsentPartition)
    {
        return Deliver<ResolvedPartition>::Refuse(
            { RefusalReason::ContentUnsupported, "an unoccupied pixel names no partition" });
    }

    if (Written.PartitionOrdinal >= static_cast<std::uint32_t>(DeclaredIdentity.size()))
        return Deliver<ResolvedPartition>::Refuse({ RefusalReason::ContentUnsupported, "no such declared partition" });

    // 🔴 The revision comparison is what makes a pixel written before a rebuild discoverably stale. `42` reuses
    //    its slots, so an identity taken against the previous resolution still indexes something — it indexes
    //    another occupant's surface, and the artist meets that as one object shading as a different one.
    if (Resolutions.Revision() != ResolvedRevision)
    {
        return Deliver<ResolvedPartition>::Refuse(
            { RefusalReason::IdentityStale, "the resolution was rebuilt since these partitions were declared" });
    }

    return Resolutions.Resolve(DeclaredIdentity[Written.PartitionOrdinal]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE READS
//------------------------------------------------------------------------------------------------------------------------

Deliver<const PartitionStructure*> VisibilityIndex::Enrolled(std::uint32_t EnrolmentOrdinal) const
{
    if (EnrolmentOrdinal >= static_cast<std::uint32_t>(Enrolments.size()))
        return Deliver<const PartitionStructure*>::Refuse({ RefusalReason::ContentUnsupported, "no such enrolment" });

    return Deliver<const PartitionStructure*>::Deliver(Enrolments[EnrolmentOrdinal].get());
}

const DepthReduction& VisibilityIndex::Reduction() const
{
    return Reduced;
}

std::uint32_t VisibilityIndex::EnrolledCount() const
{
    return static_cast<std::uint32_t>(Enrolments.size());
}

std::uint32_t VisibilityIndex::DeclaredPartitionCount() const
{
    return static_cast<std::uint32_t>(DeclaredIdentity.size());
}

bool VisibilityIndex::ChainDerived() const
{
    return Reduced.ChainDerived();
}

}   // namespace Slate
