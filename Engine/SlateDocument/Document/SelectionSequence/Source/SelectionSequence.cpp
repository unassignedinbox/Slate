//============================================================================================================================================
//                                                          SELECTIONSEQUENCE.CPP
//============================================================================================================================================
// 🧩 Sealing, traversal, and the restoration that pairs a document scrub with the selection it served.

#include "SlateDocument/Document/SelectionSequence/Api/SelectionSequence.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       SEALING
//------------------------------------------------------------------------------------------------------------------------

void SelectionSequence::Seal(const std::vector<OccupantIdentity>& Selected, std::uint64_t RevisionOrdinal)
{
    // 📝 Sealing after a backward traversal truncates what stood ahead, exactly as the document sequence
    //    does. Leaving it would let a forward traversal reach a selection the artist has since replaced.
    if (TraversalOrdinal < CommittedOrder.size())
        CommittedOrder.resize(static_cast<std::size_t>(TraversalOrdinal));

    CommittedSelection Arriving;
    Arriving.SelectedOccupants = Selected;
    Arriving.RevisionOrdinal   = RevisionOrdinal;

    CommittedOrder.push_back(Arriving);

    StandingSelection = Selected;
    TraversalOrdinal  = CommittedOrder.size();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      TRAVERSAL
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> SelectionSequence::Retreat()
{
    if (TraversalOrdinal == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the traversal is at the beginning" });

    --TraversalOrdinal;

    if (TraversalOrdinal == 0u)
        StandingSelection.clear();
    else
        StandingSelection = CommittedOrder[static_cast<std::size_t>(TraversalOrdinal) - 1u].SelectedOccupants;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> SelectionSequence::Advance()
{
    if (TraversalOrdinal >= CommittedOrder.size())
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the traversal is at the end" });

    StandingSelection = CommittedOrder[static_cast<std::size_t>(TraversalOrdinal)].SelectedOccupants;
    ++TraversalOrdinal;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> SelectionSequence::RestoreAt(std::uint64_t RevisionOrdinal)
{
    // 📝 The most recent selection sealed at or before the arrived-at revision. Searched backwards because a
    //    scrub arrives at a revision the artist selected against several times, and the last one is theirs.
    for (std::size_t Ordinal = CommittedOrder.size(); Ordinal-- > 0u;)
    {
        if (CommittedOrder[Ordinal].RevisionOrdinal > RevisionOrdinal)
            continue;

        StandingSelection = CommittedOrder[Ordinal].SelectedOccupants;
        TraversalOrdinal  = Ordinal + 1u;

        return Deliver<bool>::Deliver(true);
    }

    return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "no selection was sealed at that revision" });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

const std::vector<OccupantIdentity>& SelectionSequence::Standing() const
{
    return StandingSelection;
}

const std::vector<CommittedSelection>& SelectionSequence::Committed() const
{
    return CommittedOrder;
}

std::uint64_t SelectionSequence::TraversalPosition() const
{
    return TraversalOrdinal;
}

}   // namespace Slate
