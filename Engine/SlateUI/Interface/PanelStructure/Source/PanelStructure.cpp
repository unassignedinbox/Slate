//============================================================================================================================================
//                                                         PANELSTRUCTURE.CPP
//============================================================================================================================================
// 🧩 Division, withdrawal, assignment and proportional resizing of a bounded workspace partition.

#include "SlateUI/Interface/PanelStructure/Api/PanelStructure.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

void PanelStructure::Construct(PanelSubject InitialSubject)
{
    Reset();
    Records[RootOrdinal].Occupied = true;
    Records[RootOrdinal].Subject  = InitialSubject;
}

void PanelStructure::Reset()
{
    for (std::uint32_t Ordinal = 0u; Ordinal < RecordCeiling; ++Ordinal)
        Records[Ordinal] = PanelRecord{};
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        DIVISION
//------------------------------------------------------------------------------------------------------------------------

std::uint32_t PanelStructure::ClaimVacant()
{
    for (std::uint32_t Ordinal = 1u; Ordinal < RecordCeiling; ++Ordinal)
    {
        if (!Records[Ordinal].Occupied)
            return Ordinal;
    }

    return RecordCeiling;
}

Deliver<bool> PanelStructure::Divide(std::uint32_t LeafOrdinal,
                                     PanelDivisionAxis Axis,
                                     PanelDivisionSide VacantSide)
{
    if (LeafOrdinal >= RecordCeiling || !Records[LeafOrdinal].Occupied || Records[LeafOrdinal].Divided)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "that ordinal names no leaf panel" });

    const std::uint32_t FirstClaim = ClaimVacant();
    if (FirstClaim >= RecordCeiling)
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "no two panel slots remain" });

    Records[FirstClaim].Occupied = true;
    const std::uint32_t SecondClaim = ClaimVacant();
    Records[FirstClaim].Occupied = false;

    if (SecondClaim >= RecordCeiling)
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "no two panel slots remain" });

    const PanelSubject DepartingSubject = Records[LeafOrdinal].Subject;
    const bool VacantLeast = VacantSide == PanelDivisionSide::Least;

    Records[FirstClaim] = PanelRecord{ true, false,
                                      VacantLeast ? PanelSubject::Vacant : DepartingSubject };
    Records[SecondClaim] = PanelRecord{ true, false,
                                       VacantLeast ? DepartingSubject : PanelSubject::Vacant };

    PanelRecord& Divided = Records[LeafOrdinal];
    Divided.Divided       = true;
    Divided.Subject       = PanelSubject::Vacant;
    Divided.Axis          = Axis;
    Divided.LeastFraction = 0.5f;
    Divided.LeastOrdinal  = FirstClaim;
    Divided.MostOrdinal   = SecondClaim;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       WITHDRAWAL
//------------------------------------------------------------------------------------------------------------------------

bool PanelStructure::Encloses(std::uint32_t BranchOrdinal,
                              std::uint32_t SeekingOrdinal,
                              std::uint32_t& EnclosingOrdinal,
                              bool& LeastSide) const
{
    if (BranchOrdinal >= RecordCeiling || !Records[BranchOrdinal].Occupied || !Records[BranchOrdinal].Divided)
        return false;

    const PanelRecord& Branch = Records[BranchOrdinal];
    if (Branch.LeastOrdinal == SeekingOrdinal || Branch.MostOrdinal == SeekingOrdinal)
    {
        EnclosingOrdinal = BranchOrdinal;
        LeastSide        = Branch.LeastOrdinal == SeekingOrdinal;
        return true;
    }

    return Encloses(Branch.LeastOrdinal, SeekingOrdinal, EnclosingOrdinal, LeastSide) ||
           Encloses(Branch.MostOrdinal, SeekingOrdinal, EnclosingOrdinal, LeastSide);
}

Deliver<bool> PanelStructure::Withdraw(std::uint32_t LeafOrdinal)
{
    if (LeafOrdinal >= RecordCeiling || !Records[LeafOrdinal].Occupied || Records[LeafOrdinal].Divided)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "that ordinal names no leaf panel" });

    if (LeafOrdinal == RootOrdinal)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the sole panel cannot be withdrawn" });

    std::uint32_t EnclosingOrdinal = RecordCeiling;
    bool          LeastSide        = false;
    if (!Encloses(RootOrdinal, LeafOrdinal, EnclosingOrdinal, LeastSide))
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the leaf has no enclosing division" });

    const PanelRecord Enclosing = Records[EnclosingOrdinal];
    const std::uint32_t PromotedOrdinal = LeastSide ? Enclosing.MostOrdinal : Enclosing.LeastOrdinal;
    const PanelRecord Promoted = Records[PromotedOrdinal];

    Records[EnclosingOrdinal] = Promoted;
    Records[LeafOrdinal]      = PanelRecord{};
    Records[PromotedOrdinal]  = PanelRecord{};

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        EDITING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> PanelStructure::Assign(std::uint32_t LeafOrdinal, PanelSubject Subject)
{
    if (LeafOrdinal >= RecordCeiling || !Records[LeafOrdinal].Occupied || Records[LeafOrdinal].Divided)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "that ordinal names no leaf panel" });

    if (Subject >= PanelSubject::SubjectCount)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "that panel subject is unsupported" });

    Records[LeafOrdinal].Subject = Subject;
    return Deliver<bool>::Deliver(true);
}

Deliver<bool> PanelStructure::Proportion(std::uint32_t DivisionOrdinal, float LeastFraction)
{
    if (DivisionOrdinal >= RecordCeiling || !Records[DivisionOrdinal].Occupied ||
        !Records[DivisionOrdinal].Divided)
    {
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "that ordinal names no panel division" });
    }

    Records[DivisionOrdinal].LeastFraction = (LeastFraction < 0.05f) ? 0.05f
                                                   : (LeastFraction > 0.95f) ? 0.95f
                                                                                 : LeastFraction;
    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        READINGS
//------------------------------------------------------------------------------------------------------------------------

Deliver<PanelRecord> PanelStructure::Standing(std::uint32_t Ordinal) const
{
    if (Ordinal >= RecordCeiling || !Records[Ordinal].Occupied)
        return Deliver<PanelRecord>::Refuse({ RefusalReason::IdentityStale, "that panel ordinal is unoccupied" });

    return Deliver<PanelRecord>::Deliver(Records[Ordinal]);
}

bool PanelStructure::WithdrawalAdmitted() const
{
    const PanelRecord& Root = Records[RootOrdinal];
    return Root.Occupied && Root.Divided;
}

}   // namespace Slate
