//============================================================================================================================================
//                                                           RECOVERYSEQUENCE.CPP
//============================================================================================================================================
// 🧩 `48` §4 — the per-document journal appended as transactions seal, and the replay that is offered and never applied.

#include "SlateDocument/Document/RecoverySequence/Api/RecoverySequence.h"

#include <cstddef>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE DECLARATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> RecoverySequence::DeclareDocument(const std::string& DeclaredDocument, const std::string& DeclaredJournal)
{
    if (DeclaredDocument.empty() || DeclaredJournal.empty())
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "a journal knows which document it belongs to — `48` §4.1" });
    }

    DocumentPath = DeclaredDocument;
    JournalPath  = DeclaredJournal;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE APPENDING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> RecoverySequence::Append(const CommittedTransaction& Sealing, std::uint64_t RevisionOrdinal)
{
    if (DocumentPath.empty())
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "no document is declared for this journal — `48` §4.1" });
    }

    JournalEntry Appending;
    Appending.Description     = Sealing.Description;
    Appending.OperationName   = Sealing.OperationName;
    Appending.RevisionOrdinal = RevisionOrdinal;
    Appending.SealedAt        = Sealing.SealedAt;

    Entries.push_back(Appending);

    if (Entries.size() > static_cast<std::size_t>(EntryCeiling))
    {
        // ⚠️ The oldest entry leaves and the discard is counted rather than forgotten. A journal that silently
        //    dropped its first entries would offer a replay that begins mid-session, and the artist would read
        //    the result as the recovery having invented a document.
        Entries.erase(Entries.begin());
        ++DiscardedTotal;
    }

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE RETIREMENT
//------------------------------------------------------------------------------------------------------------------------

void RecoverySequence::Retire(std::uint64_t SavedThrough)
{
    std::size_t Retiring = 0u;

    while (Retiring < Entries.size() && Entries[Retiring].RevisionOrdinal <= SavedThrough)
    {
        ++Retiring;
    }

    if (Retiring == 0u) { return; }

    Entries.erase(Entries.begin(), Entries.begin() + static_cast<std::ptrdiff_t>(Retiring));

    // 📝 An unreadable ordinal addresses a position in the retained entries, so retiring from the front moves
    //    it. Left unmoved it would exclude entries that are perfectly readable and are past the save.
    if (UnreadableOrdinal != EntryCeiling)
    {
        UnreadableOrdinal = UnreadableOrdinal > static_cast<std::uint32_t>(Retiring)
                          ? UnreadableOrdinal - static_cast<std::uint32_t>(Retiring)
                          : 0u;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE OFFER
//------------------------------------------------------------------------------------------------------------------------

RecoveryOffer RecoverySequence::OfferReplay(std::uint64_t SavedAt, std::uint64_t SavedThrough) const
{
    RecoveryOffer Stating;
    Stating.SavedAt        = SavedAt;
    Stating.UnreadableFrom = UnreadableOrdinal;

    if (UnreadableOrdinal == 0u)
    {
        // 🔴 Nothing of the journal was readable. `48` §4 reports it and offers nothing, because an offer of
        //    zero transactions presented as a recovery teaches the artist that recovery does nothing.
        Stating.Standing = RecoveryStanding::Unreadable;
        return Stating;
    }

    std::uint32_t  Offering    = 0u;
    std::uint64_t  LastReadable = 0u;

    for (std::size_t Ordinal = 0u; Ordinal < Entries.size(); ++Ordinal)
    {
        if (Ordinal >= static_cast<std::size_t>(UnreadableOrdinal)) { break; }
        if (Entries[Ordinal].RevisionOrdinal <= SavedThrough)       { continue; }

        ++Offering;
        LastReadable = Entries[Ordinal].SealedAt;
    }

    Stating.OfferedCount = Offering;
    Stating.JournalledAt = LastReadable;

    if (Offering == 0u)
    {
        Stating.Standing = RecoveryStanding::NothingOffered;
        return Stating;
    }

    // ⚠️ Partial for either reason — an entry that could not be read, or entries the ceiling discarded before
    //    the save. Both leave a gap between the file and the offer, and the artist is told which they have.
    const bool GapStanding = UnreadableOrdinal != EntryCeiling || DiscardedTotal > 0u;

    Stating.Standing = GapStanding ? RecoveryStanding::PartlyOffered : RecoveryStanding::Offered;

    return Stating;
}

void RecoverySequence::DeclareUnreadable(std::uint32_t EntryOrdinal)
{
    if (EntryOrdinal < UnreadableOrdinal)
    {
        UnreadableOrdinal = EntryOrdinal;
    }
}

std::vector<JournalEntry> RecoverySequence::Offered(std::uint64_t SavedThrough) const
{
    std::vector<JournalEntry> Offering;

    for (std::size_t Ordinal = 0u; Ordinal < Entries.size(); ++Ordinal)
    {
        if (Ordinal >= static_cast<std::size_t>(UnreadableOrdinal)) { break; }
        if (Entries[Ordinal].RevisionOrdinal <= SavedThrough)       { continue; }

        Offering.push_back(Entries[Ordinal]);
    }

    return Offering;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE READINGS
//------------------------------------------------------------------------------------------------------------------------

const std::vector<JournalEntry>& RecoverySequence::Retained() const
{
    return Entries;
}

const std::string& RecoverySequence::DocumentOrigin() const
{
    return DocumentPath;
}

const std::string& RecoverySequence::JournalOrigin() const
{
    return JournalPath;
}

std::uint32_t RecoverySequence::DiscardedCount() const
{
    return DiscardedTotal;
}

void RecoverySequence::Reclaim()
{
    Entries.clear();
    UnreadableOrdinal = EntryCeiling;
    DiscardedTotal    = 0u;
}

}   // namespace Slate
