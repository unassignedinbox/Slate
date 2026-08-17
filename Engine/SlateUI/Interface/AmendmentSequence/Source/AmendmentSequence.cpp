//============================================================================================================================================
//                                                         AMENDMENTSEQUENCE.CPP
//============================================================================================================================================
// 🧩 Record during the sweep, validate and apply after it — so no traversal edits the set it is walking.

#include "SlateUI/Interface/AmendmentSequence/Api/AmendmentSequence.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                        CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> AmendmentSequence::Construct(InteractionIndex& Arriving)
{
    if (Ledger != nullptr)
    {
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::ContentUnsupported,
                                              "AmendmentSequence is already constructed" });
    }

    Ledger = &Arriving;

    return Deliver<bool>::Deliver(true);
}

void AmendmentSequence::Advance()
{
    // 📝 🔴 An amendment recorded last tick and never applied is discarded rather than carried. Carrying it
    //    would apply a structural change one tick after the interaction that asked for it, against an
    //    arrangement that has since moved — and the artist would see a panel move on a tick they did
    //    nothing on.
    RecordedCount = 0u;
    RefusedCount  = 0u;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE RECORDING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> AmendmentSequence::Record(const Amendment& Declared)
{
    if (Ledger == nullptr)
    {
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::CapabilityAbsent,
                                              "AmendmentSequence was not constructed" });
    }

    if (RecordedCount >= AmendmentCapacity)
    {
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::ExtentExhausted,
                                              "this tick holds no further amendment" });
    }

    if (Declared.Command >= AmendmentCommand::CommandCount)
    {
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::ContentUnsupported,
                                              "the amendment names no declared command" });
    }

    // 🔴 Checked here, at the site that asked. Checking only at Apply would report a stale identity from
    //    the synchronisation point, which names nothing about which interaction produced it.
    if (!Ledger->Resolves(Declared.Subject))
    {
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::IdentityStale,
                                              "the amendment names a subject that does not resolve" });
    }

    if (Declared.Command == AmendmentCommand::Relocate)
    {
        if (!Ledger->Resolves(Declared.Destination))
        {
            return Deliver<bool>::Refuse(Refusal{ RefusalReason::IdentityStale,
                                                  "the relocation names a destination that does not resolve" });
        }

        // 🔴 The smallest possible cycle. `12` §9 requires a cycle-creating relation change to be rejected
        //    at commit rather than applied and repaired.
        if (Declared.Destination == Declared.Subject)
        {
            return Deliver<bool>::Refuse(Refusal{ RefusalReason::RelationCyclic,
                                                  "a subject cannot be relocated under itself" });
        }
    }

    Recorded[RecordedCount] = Declared;
    ++RecordedCount;

    return Deliver<bool>::Deliver(true);
}

std::uint32_t AmendmentSequence::Standing() const
{
    return RecordedCount;
}

bool AmendmentSequence::Amended(ControlIdentity Subject) const
{
    for (std::uint32_t Ordinal = 0u; Ordinal < RecordedCount; ++Ordinal)
    {
        if (Recorded[Ordinal].Subject == Subject)
            return true;
    }

    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE APPLICATION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

/// 🧩 What one command costs to present again.
/// note  🔴 Ordered by cost, matching `RedrawScheduler`'s own ordering. A concealment recolours nothing and
///       re-solves everything, so it is Rearrange; a presentation of an already-enrolled subject changes
///       what is drawn but not where anything sits, so it is Rerecord.
/// cost  ✔️
constexpr RedrawMark MarkFor(AmendmentCommand Command)
{
    switch (Command)
    {
        case AmendmentCommand::Enrol:    return RedrawMark::Rearrange;
        case AmendmentCommand::Withdraw: return RedrawMark::Rearrange;
        case AmendmentCommand::Relocate: return RedrawMark::Rearrange;
        case AmendmentCommand::Present:  return RedrawMark::Rerecord;
        case AmendmentCommand::Conceal:  return RedrawMark::Rerecord;
        default:                         return RedrawMark::Quiet;
    }
}

}   // namespace

AmendmentVerdict AmendmentSequence::Apply()
{
    AmendmentVerdict Reported;

    if (Ledger == nullptr)
    {
        return Reported;
    }

    RefusedCount = 0u;

    // 🔴 In the order recorded, and never merged. Two amendments naming one subject are two decisions: a
    //    withdraw then an enrol is a different outcome from an enrol then a withdraw, and collapsing them
    //    would pick one of the two silently.
    for (std::uint32_t Ordinal = 0u; Ordinal < RecordedCount; ++Ordinal)
    {
        const Amendment& Standing = Recorded[Ordinal];

        // 🔴 Re-checked. An earlier amendment in this same sweep may have withdrawn the subject, which is
        //    precisely the case a mid-traversal edit would have applied against a set that had moved.
        if (!Ledger->Resolves(Standing.Subject))
        {
            if (RefusedCount < AmendmentCapacity)
            {
                Refusals[RefusedCount] = Refusal{ RefusalReason::IdentityStale,
                                                  "the subject stopped resolving before the amendment applied" };
                ++RefusedCount;
            }

            ++Reported.Refused;
            continue;
        }

        if (Standing.Command == AmendmentCommand::Relocate &&
            !Ledger->Resolves(Standing.Destination))
        {
            if (RefusedCount < AmendmentCapacity)
            {
                Refusals[RefusedCount] = Refusal{ RefusalReason::IdentityStale,
                                                  "the destination stopped resolving before the relocation applied" };
                ++RefusedCount;
            }

            ++Reported.Refused;
            continue;
        }

        // 📝 🚧 The arrangement this would edit does not exist yet — `14` §1's thirteen panels are unbuilt,
        //    and inventing a home for enrolment here would make this component the owner of what it
        //    presents, which is the one thing `14` §1 forbids. What is settled and testable now is the
        //    ordering and the validation; the edit itself is one call to whichever component owns the set.
        //    Until then an amendment that survives validation counts as applied and raises its mark.
        Reported.Mark = Dearer(Reported.Mark, MarkFor(Standing.Command));
        ++Reported.Applied;
    }

    RecordedCount = 0u;

    return Reported;
}

Deliver<Refusal> AmendmentSequence::Declined(std::uint32_t Ordinal) const
{
    if (Ordinal >= RefusedCount)
    {
        return Deliver<Refusal>::Refuse(Refusal{ RefusalReason::ExtentExhausted,
                                                 "no refusal stands at that ordinal" });
    }

    return Deliver<Refusal>::Deliver(Refusals[Ordinal]);
}

void AmendmentSequence::Reset()
{
    Ledger        = nullptr;
    RecordedCount = 0u;
    RefusedCount  = 0u;
}

}   // namespace Slate
