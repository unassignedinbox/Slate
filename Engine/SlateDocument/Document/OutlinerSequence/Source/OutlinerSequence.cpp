//============================================================================================================================================
//                                                           OUTLINERSEQUENCE.CPP
//============================================================================================================================================
// 🧩 The seven steps in order, every mutation a transaction, and the retirement cascade as one of them.

#include "SlateDocument/Document/OutlinerSequence/Api/OutlinerSequence.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      ENROLMENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<OccupantIdentity> OutlinerSequence::Enrol(const std::string& DeclaredName)
{
    const Deliver<OccupantIdentity> Enrolled = Population.Enrol();

    if (!Enrolled.ContentPresent)
        return Enrolled;

    const OccupantIdentity Arriving = Enrolled.Resolve();

    const Deliver<bool> Admitted = NestingRelations.Admit(Arriving);

    if (!Admitted.ContentPresent)
    {
        // 📝 The slot is withdrawn again rather than left enrolled in a population the relations do not hold.
        //    A slot present in one and absent from the other is invariant 6 broken at the moment of arrival.
        Disregard(Population.Withdraw(Arriving));
        return Deliver<OccupantIdentity>::Refuse(Admitted.Declined);
    }

    if (!DeclaredName.empty())
        Disregard(NameSearch.Declare(Arriving, DeclaredName));

    const std::size_t Required = static_cast<std::size_t>(Arriving.SlotOrdinal) + 1u;

    if (Required > LiveGenerations.size())
        LiveGenerations.resize(Required, 0u);

    LiveGenerations[Arriving.SlotOrdinal] = Arriving.SlotGeneration;

    // 📝 An occupant arriving while a narrowing stands is retained by nothing, so the narrowing is owed again
    //    at ⑦. Without it the arrival is hidden by a search its own name may well confirm.
    NarrowingOwed = true;

    return Deliver<OccupantIdentity>::Deliver(Arriving);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   DECLARED INTENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OutlinerSequence::Declare(const DeclaredIntent& Arriving)
{
    // 📝 Narrowing addresses the whole sequence rather than one occupant, so it is the one intent admitted
    //    with an undeclared subject. Every other intent names what it applies to and is gated on it here.
    if (Arriving.Declared != OutlinerIntent::Narrow && !Population.Resolve(Arriving.Subject))
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the intent addresses no enrolled occupant" });

    PendingDeclarations.push_back(Arriving);

    return Deliver<bool>::Deliver(true);
}

void OutlinerSequence::Reject(const DeclaredIntent& Refused, const Refusal& Declining)
{
    RejectedIntent Reported;
    Reported.Refused   = Refused;
    Reported.Declining = Declining;

    RefusedDeclarations.push_back(Reported);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SUBSET INTENT
//------------------------------------------------------------------------------------------------------------------------

// 📝 The subset half of a selection, taken on its own so that a selection arriving as intent and one restored
//    by a scrub reach the same enrolment without the scrub sealing a selection the artist never made.
Deliver<bool> OutlinerSequence::EnrolSelection(const std::vector<OccupantIdentity>& Standing)
{
    Subsets.Reclaim(SubsetSubject::Selection);

    for (const OccupantIdentity& Enrolling : Standing)
    {
        const Deliver<bool> Held = Subsets.Enrol(Enrolling, SubsetSubject::Selection);

        if (!Held.ContentPresent)
            return Held;
    }

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> OutlinerSequence::ApplySelection(const std::vector<OccupantIdentity>& Standing,
                                               std::uint64_t                        SealedAt)
{
    const Deliver<bool> Enrolled = EnrolSelection(Standing);

    if (!Enrolled.ContentPresent)
        return Enrolled;

    Selected.Seal(Standing, Revised.Committed().size());

    // 📝 The stamp is accepted and unused: selection is sealed against the document revision it stands at
    //    rather than against an arrival, which is what `12` §11 pairs a scrub with. Taking it keeps every
    //    applier's signature the same, so nothing has to know which of them consults the clock.
    static_cast<void>(SealedAt);

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> OutlinerSequence::ApplySubset(const DeclaredIntent& Applying,
                                            SubsetSubject         Addressed,
                                            std::uint64_t         SealedAt)
{
    // 🔴 `12` §11: every subset mutation is a transaction without exception. What differs between the subsets
    //    is where the transaction is recorded, and selection is the only one recorded outside the document.
    if (Addressed == SubsetSubject::Selection)
    {
        std::vector<OccupantIdentity> Standing = Applying.SelectionExtended
                                               ? Selected.Standing()
                                               : std::vector<OccupantIdentity>{};

        if (Applying.StandingEnabled)
        {
            bool Held = false;

            for (const OccupantIdentity& Enrolled : Standing)
            {
                if (Enrolled == Applying.Subject)
                {
                    Held = true;
                    break;
                }
            }

            if (!Held)
                Standing.push_back(Applying.Subject);
        }
        else
        {
            for (std::size_t Ordinal = 0u; Ordinal < Standing.size(); ++Ordinal)
            {
                if (Standing[Ordinal] == Applying.Subject)
                {
                    Standing.erase(Standing.begin() + static_cast<std::ptrdiff_t>(Ordinal));
                    break;
                }
            }
        }

        return ApplySelection(Standing, SealedAt);
    }

    const Deliver<bool> Opened = Revised.Open("", Applying.StandingEnabled ? "EnrolSubset" : "UnenrolSubset");

    if (!Opened.ContentPresent)
        return Opened;

    const Deliver<bool> Enrolled = Applying.StandingEnabled
                                 ? Subsets.Enrol(Applying.Subject, Addressed)
                                 : Subsets.Unenrol(Applying.Subject, Addressed);

    if (!Enrolled.ContentPresent)
    {
        // 📝 Abandoned rather than sealed. A refused enrolment that sealed anyway would put a transaction in
        //    the sequence whose forward operation does nothing and whose inverse undoes nothing.
        Revised.Abandon();
        return Enrolled;
    }

    return Revised.Seal(SealedAt, false);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  NARROWING INTENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OutlinerSequence::ApplyNarrowing(const DeclaredIntent& Applying)
{
    // 📝 `14` §4.1 places the sought text beside the document, so narrowing is not a transaction and nothing
    //    here opens one. The text is held rather than the confirmed set, because the set has to be derived
    //    again whenever a rename or a retirement changes what the same text confirms.
    NarrowingSought = Applying.SoughtText;
    NarrowingOwed   = true;

    // 🔴 The rows are not narrowed here. ① runs before ⑤ rebuilds them, so a set confirmed now would be
    //    retained against row ordinals the rebuild is about to reassign. The narrowing is derived at ⑦, where
    //    both the rows and the search entries are final.
    return Deliver<bool>::Deliver(true);
}

Deliver<bool> OutlinerSequence::DeriveNarrowing()
{
    if (NarrowingSought.empty())
        return Linearisation.DeclareNarrowing({}, false);

    // 🔴 `12` §3: approximate index, exact confirmation. Narrow confirms each candidate against the whole
    //    name, so what the rows retain is what genuinely contains the text rather than what shares a trigram.
    return Linearisation.DeclareNarrowing(NameSearch.Narrow(NarrowingSought), true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      SCRUBBING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OutlinerSequence::Retreat(std::uint64_t SealedAt)
{
    const Deliver<bool> Scrubbed = Revised.Retreat();

    if (!Scrubbed.ContentPresent)
        return Scrubbed;

    // 🔴 The selection is restored to what the arrived-at position was selected against, and the restoration
    //    seals nothing. `84` §3: scrubbing to position twelve and back is not an edit, and a sequence that
    //    recorded its own navigation is one no artist can reason about.
    if (Selected.RestoreAt(Revised.ScrubPosition()).ContentPresent)
    {
        const Deliver<bool> Enrolled = EnrolSelection(Selected.Standing());

        if (!Enrolled.ContentPresent)
            return Enrolled;
    }

    static_cast<void>(SealedAt);

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> OutlinerSequence::Advance(std::uint64_t SealedAt)
{
    const Deliver<bool> Scrubbed = Revised.Advance();

    if (!Scrubbed.ContentPresent)
        return Scrubbed;

    if (Selected.RestoreAt(Revised.ScrubPosition()).ContentPresent)
    {
        const Deliver<bool> Enrolled = EnrolSelection(Selected.Standing());

        if (!Enrolled.ContentPresent)
            return Enrolled;
    }

    static_cast<void>(SealedAt);

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                THE RETIREMENT CASCADE
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OutlinerSequence::RetireCascade(const DeclaredIntent& Applying, std::uint64_t SealedAt)
{
    // 🔴 `12` §12: retirement is one transaction including its whole cascade. A cascade committed as several
    //    transactions is undone in pieces, and the intermediate pieces are states the document was never in.
    const Deliver<bool> Opened = Revised.Open("", "RetireOccupant");

    if (!Opened.ContentPresent)
        return Opened;

    // 📝 The relations re-enclose what the occupant enclosed and reattach what followed it. `12` §12 makes
    //    that a declared policy rather than a default: deleting a group deletes the group, not the work.
    const Deliver<bool> Withdrawn = NestingRelations.Retire(Applying.Subject);

    if (!Withdrawn.ContentPresent)
    {
        Revised.Abandon();
        return Withdrawn;
    }

    Subsets.UnenrolEverywhere(Applying.Subject);
    NameSearch.Withdraw(Applying.Subject);

    // 📝 The population slot is withdrawn at ② rather than here, so that everything applied in this ① still
    //    resolves against the generation it was declared with.
    WithdrawnOccupants.push_back(Applying.Subject);

    return Revised.Seal(SealedAt, false);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   APPLYING INTENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OutlinerSequence::ApplyIntent(const DeclaredIntent& Applying, std::uint64_t SealedAt)
{
    switch (Applying.Declared)
    {
        case OutlinerIntent::Enclose:
        {
            // 🔴 Reordering a row is a transaction against the enclosure relation, committed like any other
            //    edit. `12` §7: a drag that mutated the relation directly would bypass undo entirely.
            const Deliver<bool> Opened = Revised.Open("", "EncloseOccupant");

            if (!Opened.ContentPresent)
                return Opened;

            const Deliver<bool> Enclosed = NestingRelations.Enclose(Applying.Subject,
                                                                   Applying.RelatedOccupant,
                                                                   Applying.OrderWithinEnclosure);

            if (!Enclosed.ContentPresent)
            {
                Revised.Abandon();
                return Enclosed;
            }

            return Revised.Seal(SealedAt, false);
        }

        case OutlinerIntent::Attach:
        {
            const Deliver<bool> Opened = Revised.Open("", "AttachOccupant");

            if (!Opened.ContentPresent)
                return Opened;

            const Deliver<bool> Attached = NestingRelations.Attach(Applying.Subject, Applying.RelatedOccupant);

            if (!Attached.ContentPresent)
            {
                Revised.Abandon();
                return Attached;
            }

            return Revised.Seal(SealedAt, false);
        }

        case OutlinerIntent::Rename:
        {
            const Deliver<bool> Opened = Revised.Open("", "RenameOccupant");

            if (!Opened.ContentPresent)
                return Opened;

            // 📝 The whole declaration is held, not just the subject, because ① clears the pending run before
            //    ⑦ reads it. `12` §4 makes ⑦ not optional: search answering with a name the artist already
            //    changed is worse than search that finds nothing.
            RenamedDeclarations.push_back(Applying);

            return Revised.Seal(SealedAt, false);
        }

        case OutlinerIntent::Select:
            return ApplySubset(Applying, SubsetSubject::Selection, SealedAt);

        case OutlinerIntent::ExcludeVisibility:
            return ApplySubset(Applying, SubsetSubject::VisibilityExclusion, SealedAt);

        case OutlinerIntent::Isolate:
            return ApplySubset(Applying, SubsetSubject::Isolation, SealedAt);

        case OutlinerIntent::Lock:
            return ApplySubset(Applying, SubsetSubject::Lock, SealedAt);

        case OutlinerIntent::Expand:
            // 📝 Expansion is a count adjustment and mutates nothing in the document, so it is not a
            //    transaction. `14` §4.1 rules the same way for every non-document state: undo must not step
            //    back through the artist collapsing a row.
            return Linearisation.DeclareExpansion(Applying.Subject, Applying.StandingEnabled);

        case OutlinerIntent::Retire:
            return RetireCascade(Applying, SealedAt);

        case OutlinerIntent::Narrow:
            return ApplyNarrowing(Applying);
    }

    return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the declared intent has no applier" });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE TICK ORDER
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OutlinerSequence::Reconcile(std::uint64_t SealedAt)
{
    // ① Apply committed intent. Every refusal is reported and the intent is never partly applied.
    for (const DeclaredIntent& Applying : PendingDeclarations)
    {
        if (!Population.Resolve(Applying.Subject))
        {
            Reject(Applying, { RefusalReason::IdentityStale, "the occupant was retired before the intent applied" });
            continue;
        }

        const Deliver<bool> Applied = ApplyIntent(Applying, SealedAt);

        if (!Applied.ContentPresent)
            Reject(Applying, Applied.Declined);
    }

    PendingDeclarations.clear();

    // ② Reconcile the population — retire the slots whose generation this tick advanced.
    for (const OccupantIdentity& Departing : WithdrawnOccupants)
    {
        Disregard(Population.Withdraw(Departing));

        if (Departing.SlotOrdinal < LiveGenerations.size())
            LiveGenerations[Departing.SlotOrdinal] = 0u;
    }

    WithdrawnOccupants.clear();

    // ③ Reconcile the attachment relation, compounding transforms downward from each attachment root. Before
    //    ④ deliberately: transforms must be final before anything spatial is derived from them.
    const Deliver<bool> Compounded = NestingRelations.CompoundAttachments();

    if (!Compounded.ContentPresent)
        return Compounded;

    // ④ Reconcile the enclosure relation, repairing interval labels where gaps were exhausted.
    const Deliver<bool> Repaired = NestingRelations.RepairLabels();

    if (!Repaired.ContentPresent)
        return Repaired;

#if defined(SLATE_DEBUG)
    // 🔍 Invariants 3 and 4 are checked on every reconciliation — `12` §5. The remainder are checked as each
    //    transaction seals, which is why they are not repeated here.
    if (!NestingRelations.RelationsAcyclic() || !NestingRelations.LabelsNested())
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::RelationCyclic, "a relation held a cycle or a label was not strictly nested" });
    }
#endif

    // ⑤ Rebuild the rows and adjust the counts. After ④ deliberately: rows rebuilt against stale labels
    //    produce an order that is briefly wrong and is displayed while it is.
    const Deliver<bool> Linearized = Linearisation.Linearize(NestingRelations);

    if (!Linearized.ContentPresent)
        return Linearized;

    // ⑥ Re-derive the subsets whose enrolment changed. Withdrawn slots left every subset at ①, so what
    //    remains is confirming that no enrolment outlived its occupant.
    if (!Subsets.EnrolmentsOccupied(LiveGenerations))
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::IdentityStale, "a subset held a slot that is no longer occupied" });
    }

    // ⑦ Re-derive the search entries for occupants whose name changed, within this same tick. Each declaration
    //    carries its own name, so nothing here consults a run ① has already cleared.
    for (const DeclaredIntent& Naming : RenamedDeclarations)
    {
        Disregard(NameSearch.Declare(Naming.Subject, Naming.DeclaredName));
        NarrowingOwed = true;
    }

    RenamedDeclarations.clear();

    // 🔴 The narrowing is derived here rather than at ①. ⑤ reassigns every row ordinal and the entries above
    //    are only final now, so a set confirmed earlier would be retained against rows the rebuild discarded.
    if (NarrowingOwed)
    {
        const Deliver<bool> Narrowed = DeriveNarrowing();

        if (!Narrowed.ContentPresent)
            return Narrowed;

        NarrowingOwed = false;
    }

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

const RowSequence& OutlinerSequence::Sequenced() const
{
    return Linearisation;
}

const EnrollmentIndex& OutlinerSequence::Enrollments() const
{
    return Subsets;
}

const TrigramIndex& OutlinerSequence::Names() const
{
    return NameSearch;
}

const SceneStructure& OutlinerSequence::Relations() const
{
    return NestingRelations;
}

const RevisionSequence& OutlinerSequence::Revisions() const
{
    return Revised;
}

const SelectionSequence& OutlinerSequence::Selections() const
{
    return Selected;
}

const std::string& OutlinerSequence::Sought() const
{
    return NarrowingSought;
}

const std::vector<RejectedIntent>& OutlinerSequence::Rejected() const
{
    return RefusedDeclarations;
}

void OutlinerSequence::ReclaimRejected()
{
    RefusedDeclarations.clear();
}

bool OutlinerSequence::InvariantsHeld() const
{
    // 📝 Invariants 1, 2, 8 and 9 are structural: the relations hold one enclosure and one attachment per
    //    occupant by storage rather than by check, retirement withdraws from both and from every subset in one
    //    routine, and row order has no input but the enclosure relation. What remains measurable is checked.
    return NestingRelations.RelationsAcyclic()
        && NestingRelations.LabelsNested()
        && Linearisation.CountsAgree()
        && Subsets.EnrolmentsOccupied(LiveGenerations);
}

}   // namespace Slate
