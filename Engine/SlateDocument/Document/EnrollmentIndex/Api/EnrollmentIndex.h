//============================================================================================================================================
//                                                            ENROLLMENTINDEX.H
//============================================================================================================================================
// 🧩 Which slots are enrolled in a named subset, compressed by interval rather than stored per occupant.

#pragma once

#include "Contract/IdentityContract.h"
#include "Contract/DeliveryContract.h"

#include <cstdint>
#include <vector>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE NAMED SUBSETS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every subset the outliner declares, and where each one's mutations are recorded.
/// note  ⚠️ `MembershipRegion` and `MembershipIndex` are retired spellings. `Region` is banned and the
///        mechanism is enrollment — `12` §3.
/// note  🔴 `12` §11: every subset mutation is a transaction. What differs between these is where the
///        transaction is recorded, not whether there is one. Selection is recorded in `SelectionSequence`
///        and is session-scoped; the other three are recorded in `RevisionSequence` and scrubbed by undo.
/// tag   contract
enum class SubsetSubject : std::uint32_t
{
    Selection           = 0u,   // [-] - recorded in SelectionSequence, session-scoped
    VisibilityExclusion = 1u,   // [-] - recorded in RevisionSequence, scrubbed by undo
    Isolation           = 2u,   // [-] - recorded in RevisionSequence, scrubbed by undo
    Lock                = 3u,   // [-] - recorded in RevisionSequence, scrubbed by undo
    SubsetCount         = 4u    // [-] - the closed count, never a subset
};

/// 🧩 One run of consecutively enrolled slots, inclusive at both ends.
/// note  💾 A subset over a scene is overwhelmingly contiguous in row order, so a run is the storage that
///        matches the shape of the fact. Storing it densely costs a bit per occupant per subset and a linear
///        comparison to answer, and `12` §6 has room for neither at a million occupants.
/// tag   nonallocating, nonthrowing
struct EnrolledInterval
{
    std::uint32_t  FirstOrdinal = 0u;   // [-] - first enrolled slot ordinal of the run
    std::uint32_t  LastOrdinal  = 0u;   // [-] - last of it; equal to the first for a single slot
};

//------------------------------------------------------------------------------------------------------------------------
//                                              INTERVAL ENROLMENT, ON ITS OWN
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Enrols one ordinal into a sorted run of intervals, merging where it abuts.
/// in    Runs     [-]  sorted, never touching; amended in place
/// in    Ordinal  [-]  the ordinal to enrol
/// out   Arrived  [-]  false when the ordinal was already enrolled, so a caller may count arrivals
/// note  🔴 Declared apart from `EnrollmentIndex` because `38` §3 enrols **faces and vertices** by this same
///        mechanism and neither is a slot of the document population. One implementation both read is the whole
///        point: two interval implementations that must agree are one that will not.
/// cost  🚩
/// tag   api, nonthrowing
bool EnrolInterval(std::vector<EnrolledInterval>& Runs, std::uint32_t Ordinal);

/// 🧩 Whether one ordinal is enrolled in a sorted run of intervals.
/// out   Enrolled  [-]  answered by a search over the runs, never over the ordinals
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
bool IntervalEnrolled(const std::vector<EnrolledInterval>& Runs, std::uint32_t Ordinal);

//------------------------------------------------------------------------------------------------------------------------
//                                                   MUTUAL EXCLUSION
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Whether two subsets may hold one occupant at once.
/// in    LeftSubset   [-]  one subset
/// in    RightSubset  [-]  the other
/// out   Exclusive    [-]  true when an occupant may not be enrolled in both
/// note  🔴 Isolation and visibility exclusion are mutually exclusive: an occupant isolated to be the only
///        one visible cannot also be excluded from visibility. `12` §10 rules multi-enrollment in mutually
///        exclusive subsets rejected at commit rather than resolved by a precedence nobody declared.
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
constexpr bool SubsetsExclusive(SubsetSubject LeftSubset, SubsetSubject RightSubset)
{
    return (LeftSubset == SubsetSubject::Isolation           && RightSubset == SubsetSubject::VisibilityExclusion)
        || (LeftSubset == SubsetSubject::VisibilityExclusion && RightSubset == SubsetSubject::Isolation);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE ENROLLMENTS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every named subset over one population, each held as an ordered run of intervals.
/// note  The runs stay sorted and never touch, so an enrolment is a search and a merge rather than an append.
///        Two runs that abut are one run: leaving them apart grows the storage without adding a fact to it.
/// tag   owning
class EnrollmentIndex
{
public:

    /// 🧩 Enrols one occupant in a subset.
    /// in    Subject         [-]  the occupant
    /// in    EnrolledSubset  [-]  which subset
    /// out   Deliver         [-]  refuses with IdentityStale for an undeclared identity, and with
    ///                            ContentUnsupported when a mutually exclusive subset already holds it
    /// note  🔴 The exclusion refusal is decided before anything is written, so a rejected enrolment leaves
    ///        no partial state behind. `12` §10 rejects at commit and resolves nothing silently.
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Enrol(OccupantIdentity Subject, SubsetSubject EnrolledSubset);

    /// 🧩 Withdraws one occupant from a subset, dividing the run it sat inside.
    /// in    Subject         [-]  the occupant
    /// in    EnrolledSubset  [-]  which subset
    /// out   Deliver         [-]  refuses with IdentityStale when the occupant was not enrolled
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Unenrol(OccupantIdentity Subject, SubsetSubject EnrolledSubset);

    /// 🧩 Withdraws one occupant from every subset — the subset half of invariant 8.
    /// in    Subject  [-]  the occupant being retired
    /// cost  🚩
    /// tag   api, nonthrowing
    void UnenrolEverywhere(OccupantIdentity Subject);

    /// 🧩 Whether one occupant is enrolled in a subset.
    /// in    Subject         [-]  the occupant
    /// in    EnrolledSubset  [-]  which subset
    /// out   Enrolled        [-]  answered by interval comparison over the runs
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Enrolled(OccupantIdentity Subject, SubsetSubject EnrolledSubset) const;

    /// 🧩 The runs of one subset, in ascending slot order.
    /// in    EnrolledSubset  [-]  which subset
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    const std::vector<EnrolledInterval>& Intervals(SubsetSubject EnrolledSubset) const;

    /// 🧩 How many occupants one subset holds.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    std::uint32_t EnrolledCount(SubsetSubject EnrolledSubset) const;

    /// 🧩 Empties one subset entirely.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Reclaim(SubsetSubject EnrolledSubset);

    /// 🧩 🔍 Whether every enrolled slot is occupied at the current generation — invariant 6.
    /// in    Generations  [-]  the current generation per slot, zero where the slot is vacant
    /// cost  🚩
    /// tag   api, nonallocating, nonthrowing
    bool EnrolmentsOccupied(const std::vector<std::uint32_t>& Generations) const;

private:

    static constexpr std::size_t SubsetSpan = static_cast<std::size_t>(SubsetSubject::SubsetCount);

    std::vector<EnrolledInterval>  SubsetIntervals[SubsetSpan] = {};   // [-] - sorted, never touching
    std::uint32_t                  SubsetCounts[SubsetSpan]    = {};   // [-] - enrolled occupants per subset
};

}   // namespace Slate
