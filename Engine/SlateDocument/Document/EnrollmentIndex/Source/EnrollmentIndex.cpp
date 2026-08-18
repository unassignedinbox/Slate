//============================================================================================================================================
//                                                           ENROLLMENTINDEX.CPP
//============================================================================================================================================
// 🧩 Interval merging, division, and the exclusion refusal that precedes every write.

#include "SlateDocument/Document/EnrollmentIndex/Api/EnrollmentIndex.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   INTERVAL SEARCH
//------------------------------------------------------------------------------------------------------------------------

// 📝 The first run whose last ordinal is not below the subject. Every enrolment, withdrawal and test starts
//    here, so it is one routine rather than three loops that must agree.
static std::size_t LocateInterval(const std::vector<EnrolledInterval>& Runs, std::uint32_t SlotOrdinal)
{
    std::size_t Lower = 0u;
    std::size_t Upper = Runs.size();

    while (Lower < Upper)
    {
        const std::size_t Middle = Lower + (Upper - Lower) / 2u;

        if (Runs[Middle].LastOrdinal < SlotOrdinal)
            Lower = Middle + 1u;
        else
            Upper = Middle;
    }

    return Lower;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 INTERVAL ENROLMENT
//------------------------------------------------------------------------------------------------------------------------

// 📝 The merging body Enrol used to hold inline, lifted out so that `38`'s degeneracy enrolment reads the same
//    code rather than a second copy of the same reasoning.
bool EnrolInterval(std::vector<EnrolledInterval>& Runs, std::uint32_t Ordinal)
{
    const std::size_t Located = LocateInterval(Runs, Ordinal);

    if (Located < Runs.size() && Runs[Located].FirstOrdinal <= Ordinal)
        return false;

    const bool AbutsBelow = Located != 0u && Runs[Located - 1u].LastOrdinal + 1u == Ordinal;
    const bool AbutsAbove = Located < Runs.size() && Runs[Located].FirstOrdinal == Ordinal + 1u;

    if (AbutsBelow && AbutsAbove)
    {
        Runs[Located - 1u].LastOrdinal = Runs[Located].LastOrdinal;
        Runs.erase(Runs.begin() + static_cast<std::ptrdiff_t>(Located));
    }
    else if (AbutsBelow)
    {
        Runs[Located - 1u].LastOrdinal = Ordinal;
    }
    else if (AbutsAbove)
    {
        Runs[Located].FirstOrdinal = Ordinal;
    }
    else
    {
        EnrolledInterval Arriving;
        Arriving.FirstOrdinal = Ordinal;
        Arriving.LastOrdinal  = Ordinal;

        Runs.insert(Runs.begin() + static_cast<std::ptrdiff_t>(Located), Arriving);
    }

    return true;
}

bool IntervalEnrolled(const std::vector<EnrolledInterval>& Runs, std::uint32_t Ordinal)
{
    const std::size_t Located = LocateInterval(Runs, Ordinal);

    return Located < Runs.size() && Runs[Located].FirstOrdinal <= Ordinal;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      ENROLMENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> EnrollmentIndex::Enrol(OccupantIdentity Subject, SubsetSubject EnrolledSubset)
{
    if (!Subject.IdentityDeclared())
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "an undeclared identity enrols in nothing" });

    // 🔴 Decided before anything is written. A rejected enrolment leaves no partial state, which is what
    //    lets the caller abandon its transaction rather than repair it.
    for (std::uint32_t Ordinal = 0u; Ordinal < static_cast<std::uint32_t>(SubsetSubject::SubsetCount); ++Ordinal)
    {
        const SubsetSubject Standing = static_cast<SubsetSubject>(Ordinal);

        if (SubsetsExclusive(EnrolledSubset, Standing) && Enrolled(Subject, Standing))
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::ContentUnsupported, "a mutually exclusive subset already holds the occupant" });
        }
    }

    std::vector<EnrolledInterval>& Runs        = SubsetIntervals[static_cast<std::size_t>(EnrolledSubset)];

    // 📝 Extending an abutting run keeps the storage at one run per contiguous span. Two runs that touch
    //    carry no fact the merged run does not, and every later comparison pays for the extra entry.
    if (EnrolInterval(Runs, Subject.SlotOrdinal))
        ++SubsetCounts[static_cast<std::size_t>(EnrolledSubset)];

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      WITHDRAWAL
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> EnrollmentIndex::Unenrol(OccupantIdentity Subject, SubsetSubject EnrolledSubset)
{
    if (!Subject.IdentityDeclared())
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "an undeclared identity enrols in nothing" });

    std::vector<EnrolledInterval>& Runs        = SubsetIntervals[static_cast<std::size_t>(EnrolledSubset)];
    const std::uint32_t            SlotOrdinal = Subject.SlotOrdinal;
    const std::size_t              Located     = LocateInterval(Runs, SlotOrdinal);

    if (Located >= Runs.size() || Runs[Located].FirstOrdinal > SlotOrdinal)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the occupant was not enrolled here" });

    const EnrolledInterval Held = Runs[Located];

    if (Held.FirstOrdinal == SlotOrdinal && Held.LastOrdinal == SlotOrdinal)
    {
        Runs.erase(Runs.begin() + static_cast<std::ptrdiff_t>(Located));
    }
    else if (Held.FirstOrdinal == SlotOrdinal)
    {
        Runs[Located].FirstOrdinal = SlotOrdinal + 1u;
    }
    else if (Held.LastOrdinal == SlotOrdinal)
    {
        Runs[Located].LastOrdinal = SlotOrdinal - 1u;
    }
    else
    {
        // 📝 A withdrawal from the interior divides one run into two. This is the only operation that grows
        //    the run count, and it grows it by exactly one.
        Runs[Located].LastOrdinal = SlotOrdinal - 1u;

        EnrolledInterval Upper;
        Upper.FirstOrdinal = SlotOrdinal + 1u;
        Upper.LastOrdinal  = Held.LastOrdinal;

        Runs.insert(Runs.begin() + static_cast<std::ptrdiff_t>(Located) + 1, Upper);
    }

    --SubsetCounts[static_cast<std::size_t>(EnrolledSubset)];

    return Deliver<bool>::Deliver(true);
}

void EnrollmentIndex::UnenrolEverywhere(OccupantIdentity Subject)
{
    for (std::uint32_t Ordinal = 0u; Ordinal < static_cast<std::uint32_t>(SubsetSubject::SubsetCount); ++Ordinal)
        Disregard(Unenrol(Subject, static_cast<SubsetSubject>(Ordinal)));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

bool EnrollmentIndex::Enrolled(OccupantIdentity Subject, SubsetSubject EnrolledSubset) const
{
    if (!Subject.IdentityDeclared())
        return false;

    return IntervalEnrolled(SubsetIntervals[static_cast<std::size_t>(EnrolledSubset)], Subject.SlotOrdinal);
}

const std::vector<EnrolledInterval>& EnrollmentIndex::Intervals(SubsetSubject EnrolledSubset) const
{
    return SubsetIntervals[static_cast<std::size_t>(EnrolledSubset)];
}

std::uint32_t EnrollmentIndex::EnrolledCount(SubsetSubject EnrolledSubset) const
{
    return SubsetCounts[static_cast<std::size_t>(EnrolledSubset)];
}

void EnrollmentIndex::Reclaim(SubsetSubject EnrolledSubset)
{
    SubsetIntervals[static_cast<std::size_t>(EnrolledSubset)].clear();
    SubsetCounts[static_cast<std::size_t>(EnrolledSubset)] = 0u;
}

bool EnrollmentIndex::EnrolmentsOccupied(const std::vector<std::uint32_t>& Generations) const
{
    for (std::size_t Subset = 0u; Subset < SubsetSpan; ++Subset)
    {
        for (const EnrolledInterval& Run : SubsetIntervals[Subset])
        {
            for (std::uint32_t Ordinal = Run.FirstOrdinal; Ordinal <= Run.LastOrdinal; ++Ordinal)
            {
                if (Ordinal >= Generations.size() || Generations[Ordinal] == 0u)
                    return false;
            }
        }
    }

    return true;
}

}   // namespace Slate
