//============================================================================================================================================
//                                                             TRIGRAMINDEX.CPP
//============================================================================================================================================
// 🧩 Trigram folding and entry, the rarest-run narrowing, and the exact confirmation over it.

#include "SlateDocument/Document/TrigramIndex/Api/TrigramIndex.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     FOLDED NAMES
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📝 The trigram ordinals one name occupies, in ascending order and without repetition. A repeated trigram
//    would enter the same run twice and withdraw from it once.
std::vector<std::uint32_t> FoldedTrigrams(const std::string& Declared)
{
    std::vector<std::uint32_t> Folded;

    if (Declared.size() < 3u)
        return Folded;

    Folded.reserve(Declared.size() - 2u);

    for (std::size_t Ordinal = 0u; Ordinal + 3u <= Declared.size(); ++Ordinal)
    {
        const std::uint32_t Trigram = FoldedOrdinal(Declared[Ordinal])      * TrigramAlphabet * TrigramAlphabet
                                    + FoldedOrdinal(Declared[Ordinal + 1u]) * TrigramAlphabet
                                    + FoldedOrdinal(Declared[Ordinal + 2u]);

        bool Repeated = false;

        for (const std::uint32_t Held : Folded)
        {
            if (Held == Trigram)
            {
                Repeated = true;
                break;
            }
        }

        if (!Repeated)
            Folded.push_back(Trigram);
    }

    return Folded;
}

// 📝 The exact confirmation. Case-folded so it agrees with the folding the trigrams used — a narrowing that
//    matched case-insensitively and confirmed case-sensitively drops results the index promised.
bool NameContains(const std::string& Declared, const std::string& Sought)
{
    if (Sought.empty())
        return true;

    if (Sought.size() > Declared.size())
        return false;

    for (std::size_t Start = 0u; Start + Sought.size() <= Declared.size(); ++Start)
    {
        std::size_t Matched = 0u;

        while (Matched < Sought.size()
            && FoldedOrdinal(Declared[Start + Matched]) == FoldedOrdinal(Sought[Matched]))
        {
            ++Matched;
        }

        if (Matched == Sought.size())
            return true;
    }

    return false;
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     DECLARATION
//------------------------------------------------------------------------------------------------------------------------

void TrigramIndex::Enter(std::uint32_t SlotOrdinal, const std::string& Declared)
{
    if (TrigramRuns.empty())
        TrigramRuns.resize(TrigramSpan);

    for (const std::uint32_t Trigram : FoldedTrigrams(Declared))
    {
        std::vector<std::uint32_t>& Run = TrigramRuns[Trigram];

        std::size_t Lower = 0u;
        std::size_t Upper = Run.size();

        while (Lower < Upper)
        {
            const std::size_t Middle = Lower + (Upper - Lower) / 2u;

            if (Run[Middle] < SlotOrdinal)
                Lower = Middle + 1u;
            else
                Upper = Middle;
        }

        if (Lower < Run.size() && Run[Lower] == SlotOrdinal)
            continue;

        Run.insert(Run.begin() + static_cast<std::ptrdiff_t>(Lower), SlotOrdinal);
    }
}

Deliver<bool> TrigramIndex::Declare(OccupantIdentity Subject, const std::string& Declared)
{
    if (!Subject.IdentityDeclared())
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "an undeclared identity carries no name" });

    // 🔴 The former name's entries are withdrawn before the new ones are entered. Skipping the withdrawal is
    //    exactly the defect step ⑦ exists to prevent: the occupant stays findable under a name it lost.
    Withdraw(Subject);

    const std::size_t Required = static_cast<std::size_t>(Subject.SlotOrdinal) + 1u;

    if (Required > DeclaredNames.size())
    {
        DeclaredNames.resize(Required);
        NamedIdentities.resize(Required);
    }

    DeclaredNames[Subject.SlotOrdinal]   = Declared;
    NamedIdentities[Subject.SlotOrdinal] = Subject;

    if (!Declared.empty())
        ++NamedOccupants;

    Enter(Subject.SlotOrdinal, Declared);

    return Deliver<bool>::Deliver(true);
}

void TrigramIndex::Withdraw(OccupantIdentity Subject)
{
    if (!Subject.IdentityDeclared() || Subject.SlotOrdinal >= DeclaredNames.size())
        return;

    const std::string Departing = DeclaredNames[Subject.SlotOrdinal];

    if (Departing.empty())
        return;

    for (const std::uint32_t Trigram : FoldedTrigrams(Departing))
    {
        std::vector<std::uint32_t>& Run = TrigramRuns[Trigram];

        for (std::size_t Ordinal = 0u; Ordinal < Run.size(); ++Ordinal)
        {
            if (Run[Ordinal] == Subject.SlotOrdinal)
            {
                Run.erase(Run.begin() + static_cast<std::ptrdiff_t>(Ordinal));
                break;
            }
        }
    }

    DeclaredNames[Subject.SlotOrdinal].clear();
    NamedIdentities[Subject.SlotOrdinal] = OccupantIdentity{};
    --NamedOccupants;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE NARROWING
//------------------------------------------------------------------------------------------------------------------------

std::vector<OccupantIdentity> TrigramIndex::Narrow(const std::string& Sought) const
{
    std::vector<OccupantIdentity> Confirmed;

    if (Sought.empty())
        return Confirmed;

    const std::vector<std::uint32_t> Folded = FoldedTrigrams(Sought);

    // 📝 Text shorter than one trigram narrows to nothing, so it is confirmed against every declared name
    //    rather than answered as absent. A one-character search returning nothing looks like a broken index.
    if (Folded.empty() || TrigramRuns.empty())
    {
        for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < DeclaredNames.size(); ++SlotOrdinal)
        {
            if (!DeclaredNames[SlotOrdinal].empty() && NameContains(DeclaredNames[SlotOrdinal], Sought))
                Confirmed.push_back(NamedIdentities[SlotOrdinal]);
        }

        return Confirmed;
    }

    // 📝 Narrowed by the rarest run rather than by intersecting every run. One run is already small, and the
    //    intersection costs more than confirming the difference between it and the answer.
    const std::vector<std::uint32_t>* Narrowest = &TrigramRuns[Folded[0]];

    for (const std::uint32_t Trigram : Folded)
    {
        if (TrigramRuns[Trigram].size() < Narrowest->size())
            Narrowest = &TrigramRuns[Trigram];
    }

    // 🔴 The exact confirmation. A trigram set matches names that never contain the sought text — "arm" and
    //    "ram" share no trigram, but longer text easily produces candidates that do not match at all.
    for (const std::uint32_t SlotOrdinal : *Narrowest)
    {
        if (SlotOrdinal >= DeclaredNames.size())
            continue;

        if (!NameContains(DeclaredNames[SlotOrdinal], Sought))
            continue;

        Confirmed.push_back(NamedIdentities[SlotOrdinal]);
    }

    return Confirmed;
}

const std::string& TrigramIndex::DeclaredName(OccupantIdentity Subject) const
{
    if (!Subject.IdentityDeclared() || Subject.SlotOrdinal >= DeclaredNames.size())
        return AbsentName;

    return DeclaredNames[Subject.SlotOrdinal];
}

std::uint32_t TrigramIndex::NamedCount() const
{
    return NamedOccupants;
}

}   // namespace Slate
