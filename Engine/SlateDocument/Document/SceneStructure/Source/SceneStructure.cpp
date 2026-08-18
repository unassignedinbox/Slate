//============================================================================================================================================
//                                                            SCENESTRUCTURE.CPP
//============================================================================================================================================
// 🧩 Enclosure ordering, gapped label assignment and repair, and downward attachment compounding.

#include "SlateDocument/Document/SceneStructure/Api/SceneStructure.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      RESOLUTION
//------------------------------------------------------------------------------------------------------------------------

std::uint32_t SceneStructure::Resolved(OccupantIdentity Subject) const
{
    if (!Subject.IdentityDeclared())
        return AbsentSlot;

    if (Subject.SlotOrdinal >= SlotGenerations.size())
        return AbsentSlot;

    if (SlotGenerations[Subject.SlotOrdinal] != Subject.SlotGeneration)
        return AbsentSlot;

    return Subject.SlotOrdinal;
}

OccupantIdentity SceneStructure::OccupantAt(std::uint32_t SlotOrdinal) const
{
    OccupantIdentity Occupying;

    if (SlotOrdinal >= SlotGenerations.size())
        return Occupying;

    Occupying.SlotOrdinal    = SlotOrdinal;
    Occupying.SlotGeneration = SlotGenerations[SlotOrdinal];

    return Occupying;
}

std::uint32_t SceneStructure::SpannedCount() const
{
    return static_cast<std::uint32_t>(SlotGenerations.size());
}

std::uint32_t SceneStructure::RootFirst() const
{
    return RootFirstSlot;
}

std::uint32_t SceneStructure::NextInOrder(std::uint32_t SlotOrdinal) const
{
    if (SlotOrdinal >= Enclosures.size())
        return AbsentSlot;

    return Enclosures[SlotOrdinal].NextInOrder;
}

std::uint32_t SceneStructure::FirstEnclosed(std::uint32_t SlotOrdinal) const
{
    if (SlotOrdinal >= Enclosures.size())
        return AbsentSlot;

    return Enclosures[SlotOrdinal].FirstEnclosed;
}

std::uint32_t SceneStructure::EnclosureDepth(std::uint32_t SlotOrdinal) const
{
    if (SlotOrdinal >= Enclosures.size())
        return 0u;

    return Enclosures[SlotOrdinal].EnclosureDepth;
}

bool SceneStructure::RelabelOwed() const
{
    return !ExhaustedEnclosures.empty();
}

//------------------------------------------------------------------------------------------------------------------------
//                                               ADMISSION AND RETIREMENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> SceneStructure::Admit(OccupantIdentity Arriving)
{
    if (!Arriving.IdentityDeclared())
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "an undeclared identity names no occupant" });

    const std::size_t Required = static_cast<std::size_t>(Arriving.SlotOrdinal) + 1u;

    if (Required > SlotGenerations.size())
    {
        SlotGenerations.resize(Required, 0u);
        Enclosures.resize(Required);
        Attachments.resize(Required);
        AuthoredTransforms.resize(Required);
        CompoundedTransforms.resize(Required);
    }

    const std::uint32_t SlotOrdinal = Arriving.SlotOrdinal;

    // 📝 The slot is reset rather than merged into. A slot reused after a withdrawal carries the previous
    //    occupant's ordering links, and inheriting them would enclose the arrival where the departed sat.
    SlotGenerations[SlotOrdinal]      = Arriving.SlotGeneration;
    Enclosures[SlotOrdinal]           = EnclosureRecord{};
    Attachments[SlotOrdinal]          = AttachmentRecord{};
    AuthoredTransforms[SlotOrdinal]   = DecomposedTransform{};
    CompoundedTransforms[SlotOrdinal] = DecomposedTransform{};

    Link(SlotOrdinal, AbsentSlot, RootCount);
    ++AdmittedCount;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> SceneStructure::Retire(OccupantIdentity Departing)
{
    const std::uint32_t SlotOrdinal = Resolved(Departing);

    if (SlotOrdinal == AbsentSlot)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the identity no longer resolves here" });

    // 🔴 `12` §12: enclosed occupants are re-enclosed by the departing occupant's enclosure, not retired with
    //    it. Deleting a group deletes the group, not the work inside it. Each is placed immediately after the
    //    departing occupant so the ordering the artist saw survives the retirement.
    const OccupantIdentity RisingEnclosure = Enclosures[SlotOrdinal].EnclosingOccupant;
    const std::uint32_t    RisingSlot      = Resolved(RisingEnclosure);

    std::uint32_t Insertion = 0u;

    for (std::uint32_t Walking = RisingSlot == AbsentSlot ? RootFirstSlot : Enclosures[RisingSlot].FirstEnclosed;
         Walking != AbsentSlot && Walking != SlotOrdinal;
         Walking = Enclosures[Walking].NextInOrder)
    {
        ++Insertion;
    }

    std::uint32_t Enclosed = Enclosures[SlotOrdinal].FirstEnclosed;

    while (Enclosed != AbsentSlot)
    {
        const std::uint32_t Following = Enclosures[Enclosed].NextInOrder;

        Unlink(Enclosed);
        Link(Enclosed, RisingSlot, ++Insertion);

        if (Enclosures[Enclosed].EnclosedCount != 0u || !LabelBetween(Enclosed))
            DeclareExhausted(RisingSlot);

        Enclosed = Following;
    }

    // 📝 Attached occupants retain the transform they were compounded to. Compounding the departing
    //    occupant's authored transform into each of theirs and reattaching to its attachment reaches the same
    //    compounded result without ever inverting a transform, because compounding is associative.
    const OccupantIdentity RisingAttachment = Attachments[SlotOrdinal].AttachmentOccupant;

    std::uint32_t Attached = Attachments[SlotOrdinal].FirstAttached;

    while (Attached != AbsentSlot)
    {
        const std::uint32_t Following = Attachments[Attached].NextAttached;

        AuthoredTransforms[Attached] = Compound(AuthoredTransforms[SlotOrdinal], AuthoredTransforms[Attached]);

        Attachments[Attached].AttachmentOccupant = RisingAttachment;
        Attachments[Attached].NextAttached       = AbsentSlot;

        const std::uint32_t RisingAttachmentSlot = Resolved(RisingAttachment);

        if (RisingAttachmentSlot != AbsentSlot)
        {
            Attachments[Attached].NextAttached                     = Attachments[RisingAttachmentSlot].FirstAttached;
            Attachments[RisingAttachmentSlot].FirstAttached        = Attached;
        }

        Attached = Following;
    }

    const std::uint32_t DepartingAttachment = Resolved(RisingAttachment);

    if (DepartingAttachment != AbsentSlot)
    {
        std::uint32_t* Linking = &Attachments[DepartingAttachment].FirstAttached;

        while (*Linking != AbsentSlot && *Linking != SlotOrdinal)
            Linking = &Attachments[*Linking].NextAttached;

        if (*Linking == SlotOrdinal)
            *Linking = Attachments[SlotOrdinal].NextAttached;
    }

    Unlink(SlotOrdinal);

    SlotGenerations[SlotOrdinal] = 0u;
    Enclosures[SlotOrdinal]      = EnclosureRecord{};
    Attachments[SlotOrdinal]     = AttachmentRecord{};
    --AdmittedCount;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  ENCLOSURE ORDERING
//------------------------------------------------------------------------------------------------------------------------

void SceneStructure::Unlink(std::uint32_t SlotOrdinal)
{
    EnclosureRecord& Departing = Enclosures[SlotOrdinal];

    const std::uint32_t EnclosureSlot = Resolved(Departing.EnclosingOccupant);

    std::uint32_t* HeadLink = EnclosureSlot == AbsentSlot ? &RootFirstSlot : &Enclosures[EnclosureSlot].FirstEnclosed;
    std::uint32_t* TailLink = EnclosureSlot == AbsentSlot ? &RootLastSlot  : &Enclosures[EnclosureSlot].LastEnclosed;
    std::uint32_t* Counting = EnclosureSlot == AbsentSlot ? &RootCount     : &Enclosures[EnclosureSlot].EnclosedCount;

    if (Departing.PriorInOrder != AbsentSlot)
        Enclosures[Departing.PriorInOrder].NextInOrder = Departing.NextInOrder;
    else
        *HeadLink = Departing.NextInOrder;

    if (Departing.NextInOrder != AbsentSlot)
        Enclosures[Departing.NextInOrder].PriorInOrder = Departing.PriorInOrder;
    else
        *TailLink = Departing.PriorInOrder;

    if (*Counting != 0u)
        --*Counting;

    Departing.PriorInOrder      = AbsentSlot;
    Departing.NextInOrder       = AbsentSlot;
    Departing.EnclosingOccupant = OccupantIdentity{};
}

void SceneStructure::Link(std::uint32_t SlotOrdinal, std::uint32_t EnclosureSlot, std::uint32_t OrderWithinEnclosure)
{
    EnclosureRecord& Arriving = Enclosures[SlotOrdinal];

    std::uint32_t* HeadLink = EnclosureSlot == AbsentSlot ? &RootFirstSlot : &Enclosures[EnclosureSlot].FirstEnclosed;
    std::uint32_t* TailLink = EnclosureSlot == AbsentSlot ? &RootLastSlot  : &Enclosures[EnclosureSlot].LastEnclosed;
    std::uint32_t* Counting = EnclosureSlot == AbsentSlot ? &RootCount     : &Enclosures[EnclosureSlot].EnclosedCount;

    std::uint32_t Preceding = AbsentSlot;
    std::uint32_t Walking   = *HeadLink;

    for (std::uint32_t Passed = 0u; Passed < OrderWithinEnclosure && Walking != AbsentSlot; ++Passed)
    {
        Preceding = Walking;
        Walking   = Enclosures[Walking].NextInOrder;
    }

    Arriving.PriorInOrder      = Preceding;
    Arriving.NextInOrder       = Walking;
    Arriving.EnclosingOccupant = EnclosureSlot == AbsentSlot ? OccupantIdentity{} : OccupantAt(EnclosureSlot);
    Arriving.EnclosureDepth    = EnclosureSlot == AbsentSlot ? 0u : Enclosures[EnclosureSlot].EnclosureDepth + 1u;

    if (Preceding != AbsentSlot)
        Enclosures[Preceding].NextInOrder = SlotOrdinal;
    else
        *HeadLink = SlotOrdinal;

    if (Walking != AbsentSlot)
        Enclosures[Walking].PriorInOrder = SlotOrdinal;
    else
        *TailLink = SlotOrdinal;

    ++*Counting;
}

Deliver<bool> SceneStructure::Enclose(OccupantIdentity Subject,
                                      OccupantIdentity ProposedEnclosure,
                                      std::uint32_t    OrderWithinEnclosure)
{
    const std::uint32_t SlotOrdinal = Resolved(Subject);

    if (SlotOrdinal == AbsentSlot)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the enclosed occupant no longer resolves" });

    std::uint32_t EnclosureSlot = AbsentSlot;

    if (ProposedEnclosure.IdentityDeclared())
    {
        EnclosureSlot = Resolved(ProposedEnclosure);

        if (EnclosureSlot == AbsentSlot)
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::IdentityStale, "the enclosing occupant no longer resolves" });
        }

        // 🔴 Rejected at commit and never applied. `12` §9 requires the refusal to name both occupants; both
        //    are the caller's own arguments, so it names them without this seam allocating a message.
        if (EnclosureCyclic(Subject, ProposedEnclosure))
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::RelationCyclic, "the occupant already encloses its proposed enclosure" });
        }

        if (Enclosures[EnclosureSlot].EnclosureDepth + 1u >= EnclosureDepthCeiling)
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::ExtentExhausted, "the enclosure reached the declared depth ceiling" });
        }
    }

    Unlink(SlotOrdinal);
    Link(SlotOrdinal, EnclosureSlot, OrderWithinEnclosure);

    // 📝 A leaf takes a label out of the gap between its neighbours and costs nothing further. An occupant
    //    that encloses others carries a whole span with it, so its interior is relabelled at ④ instead.
    if (Enclosures[SlotOrdinal].EnclosedCount != 0u || !LabelBetween(SlotOrdinal))
        DeclareExhausted(EnclosureSlot);

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   LABEL ASSIGNMENT
//------------------------------------------------------------------------------------------------------------------------

IntervalLabel SceneStructure::EnclosureInterval(std::uint32_t EnclosureSlot) const
{
    IntervalLabel Interior;

    if (EnclosureSlot == AbsentSlot)
    {
        Interior.LabelBegin = 1u;
        Interior.LabelEnd   = RootLabelCeiling - 1u;
        return Interior;
    }

    Interior.LabelBegin = Enclosures[EnclosureSlot].Label.LabelBegin + 1u;
    Interior.LabelEnd   = Enclosures[EnclosureSlot].Label.LabelEnd   - 1u;

    return Interior;
}

bool SceneStructure::LabelBetween(std::uint32_t SlotOrdinal)
{
    const EnclosureRecord& Placed        = Enclosures[SlotOrdinal];
    const std::uint32_t    EnclosureSlot = Resolved(Placed.EnclosingOccupant);

    if (EnclosureSlot != AbsentSlot && Enclosures[EnclosureSlot].Label.LabelEnd == 0u)
        return false;

    const IntervalLabel Interior = EnclosureInterval(EnclosureSlot);

    std::uint64_t LowerBound = Interior.LabelBegin;
    std::uint64_t UpperBound = Interior.LabelEnd;

    if (Placed.PriorInOrder != AbsentSlot)
    {
        if (Enclosures[Placed.PriorInOrder].Label.LabelEnd == 0u)
            return false;

        LowerBound = Enclosures[Placed.PriorInOrder].Label.LabelEnd + 1u;
    }

    if (Placed.NextInOrder != AbsentSlot)
    {
        if (Enclosures[Placed.NextInOrder].Label.LabelBegin == 0u)
            return false;

        UpperBound = Enclosures[Placed.NextInOrder].Label.LabelBegin - 1u;
    }

    if (UpperBound < LowerBound || UpperBound - LowerBound < 1u)
        return false;

    // 📐 The free run is halved and centred rather than consumed whole, so that an insertion on either side of
    //    this occupant still finds a gap. Taking the whole run makes the next insertion a relabel.
    const std::uint64_t FreeSpan = UpperBound - LowerBound + 1u;
    std::uint64_t       TakenSpan = FreeSpan / 2u;

    if (TakenSpan < 2u)
        TakenSpan = FreeSpan;

    Enclosures[SlotOrdinal].Label.LabelBegin = LowerBound + (FreeSpan - TakenSpan) / 2u;
    Enclosures[SlotOrdinal].Label.LabelEnd   = Enclosures[SlotOrdinal].Label.LabelBegin + TakenSpan - 1u;

    return true;
}

void SceneStructure::DeclareExhausted(std::uint32_t EnclosureSlot)
{
    for (const std::uint32_t Declared : ExhaustedEnclosures)
    {
        if (Declared == EnclosureSlot)
            return;
    }

    ExhaustedEnclosures.push_back(EnclosureSlot);
}

Deliver<bool> SceneStructure::AssignLabels(std::uint32_t EnclosureSlot, IntervalLabel Available, std::uint32_t Depth)
{
    if (Depth >= EnclosureDepthCeiling)
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the enclosure exceeded the depth ceiling" });

    const std::uint32_t Population = EnclosureSlot == AbsentSlot ? RootCount
                                                                 : Enclosures[EnclosureSlot].EnclosedCount;

    if (Population == 0u)
        return Deliver<bool>::Deliver(true);

    if (Available.LabelEnd < Available.LabelBegin)
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the span holds no ordinal to divide" });

    const std::uint64_t SpanWidth = Available.LabelEnd - Available.LabelBegin + 1u;
    const std::uint64_t EachWidth = SpanWidth / Population;

    if (EachWidth < 2u)
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the span cannot hold its ordering" });

    std::uint32_t Walking  = EnclosureSlot == AbsentSlot ? RootFirstSlot : Enclosures[EnclosureSlot].FirstEnclosed;
    std::uint64_t Issuing  = Available.LabelBegin;

    while (Walking != AbsentSlot)
    {
        Enclosures[Walking].Label.LabelBegin = Issuing;
        Enclosures[Walking].Label.LabelEnd   = Issuing + EachWidth - 1u;
        Enclosures[Walking].EnclosureDepth   = Depth;

        if (Enclosures[Walking].EnclosedCount != 0u)
        {
            IntervalLabel Interior;
            Interior.LabelBegin = Enclosures[Walking].Label.LabelBegin + 1u;
            Interior.LabelEnd   = Enclosures[Walking].Label.LabelEnd   - 1u;

            const Deliver<bool> Nested = AssignLabels(Walking, Interior, Depth + 1u);

            if (!Nested.ContentPresent)
                return Nested;
        }

        Issuing += EachWidth;
        Walking  = Enclosures[Walking].NextInOrder;
    }

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> SceneStructure::RepairLabels()
{
    // 📝 Repair covers the exhausted span and escalates outward only while the span above it also refuses. A
    //    whole-population relabel is the last resort here rather than the first, which is the entire reason
    //    labels are issued with gaps.
    while (!ExhaustedEnclosures.empty())
    {
        std::uint32_t EnclosureSlot = ExhaustedEnclosures.back();
        ExhaustedEnclosures.pop_back();

        for (;;)
        {
            const std::uint32_t Depth = EnclosureSlot == AbsentSlot
                                      ? 0u
                                      : Enclosures[EnclosureSlot].EnclosureDepth + 1u;

            const Deliver<bool> Assigned = AssignLabels(EnclosureSlot, EnclosureInterval(EnclosureSlot), Depth);

            if (Assigned.ContentPresent)
                break;

            if (EnclosureSlot == AbsentSlot)
            {
                return Deliver<bool>::Refuse(
                    { RefusalReason::ExtentExhausted, "the root span cannot hold the enclosure ordering" });
            }

            EnclosureSlot = Resolved(Enclosures[EnclosureSlot].EnclosingOccupant);
        }
    }

    return Deliver<bool>::Deliver(true);
}

Deliver<IntervalLabel> SceneStructure::Label(OccupantIdentity Subject) const
{
    const std::uint32_t SlotOrdinal = Resolved(Subject);

    if (SlotOrdinal == AbsentSlot)
    {
        return Deliver<IntervalLabel>::Refuse(
            { RefusalReason::IdentityStale, "the identity no longer resolves here" });
    }

    return Deliver<IntervalLabel>::Deliver(Enclosures[SlotOrdinal].Label);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                ATTACHMENT COMPOUNDING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> SceneStructure::Attach(OccupantIdentity Subject, OccupantIdentity ProposedAttachment)
{
    const std::uint32_t SlotOrdinal = Resolved(Subject);

    if (SlotOrdinal == AbsentSlot)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the following occupant no longer resolves" });

    std::uint32_t AttachmentSlot = AbsentSlot;

    if (ProposedAttachment.IdentityDeclared())
    {
        AttachmentSlot = Resolved(ProposedAttachment);

        if (AttachmentSlot == AbsentSlot)
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::IdentityStale, "the proposed attachment no longer resolves" });
        }

        if (AttachmentCyclic(Subject, ProposedAttachment))
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::RelationCyclic, "the occupant is already followed by its proposed attachment" });
        }
    }

    const std::uint32_t PriorAttachment = Resolved(Attachments[SlotOrdinal].AttachmentOccupant);

    if (PriorAttachment != AbsentSlot)
    {
        std::uint32_t* Linking = &Attachments[PriorAttachment].FirstAttached;

        while (*Linking != AbsentSlot && *Linking != SlotOrdinal)
            Linking = &Attachments[*Linking].NextAttached;

        if (*Linking == SlotOrdinal)
            *Linking = Attachments[SlotOrdinal].NextAttached;
    }

    Attachments[SlotOrdinal].AttachmentOccupant = AttachmentSlot == AbsentSlot ? OccupantIdentity{}
                                                                              : OccupantAt(AttachmentSlot);
    Attachments[SlotOrdinal].NextAttached       = AbsentSlot;

    if (AttachmentSlot != AbsentSlot)
    {
        Attachments[SlotOrdinal].NextAttached      = Attachments[AttachmentSlot].FirstAttached;
        Attachments[AttachmentSlot].FirstAttached  = SlotOrdinal;
    }

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> SceneStructure::AuthorTransform(OccupantIdentity Subject, const DecomposedTransform& Authored)
{
    const std::uint32_t SlotOrdinal = Resolved(Subject);

    if (SlotOrdinal == AbsentSlot)
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the identity no longer resolves here" });

    AuthoredTransforms[SlotOrdinal] = Authored;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> SceneStructure::CompoundFrom(std::uint32_t SlotOrdinal, std::uint32_t Depth)
{
    if (Depth >= EnclosureDepthCeiling)
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the attachment chain exceeded the ceiling" });

    for (std::uint32_t Following = Attachments[SlotOrdinal].FirstAttached;
         Following != AbsentSlot;
         Following = Attachments[Following].NextAttached)
    {
        // 📐 The attachment is the outer transform and the occupant's own is the inner one, so the compounded
        //    result depends only on the path back to the attachment root — invariant 7, stated as arithmetic.
        CompoundedTransforms[Following]      = Compound(CompoundedTransforms[SlotOrdinal],
                                                       AuthoredTransforms[Following]);
        Attachments[Following].AttachmentDepth = Depth + 1u;

        const Deliver<bool> Deeper = CompoundFrom(Following, Depth + 1u);

        if (!Deeper.ContentPresent)
            return Deeper;
    }

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> SceneStructure::CompoundAttachments()
{
    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < SlotGenerations.size(); ++SlotOrdinal)
    {
        if (SlotGenerations[SlotOrdinal] == 0u)
            continue;

        if (Attachments[SlotOrdinal].AttachmentOccupant.IdentityDeclared())
            continue;

        // 📝 An attachment root compounds to its authored transform unchanged. `12` §1: enclosure composes no
        //    transform, so an occupant indented under another and attached to nothing moves alone.
        CompoundedTransforms[SlotOrdinal]        = AuthoredTransforms[SlotOrdinal];
        Attachments[SlotOrdinal].AttachmentDepth = 0u;

        const Deliver<bool> Compounded = CompoundFrom(SlotOrdinal, 0u);

        if (!Compounded.ContentPresent)
            return Compounded;
    }

    return Deliver<bool>::Deliver(true);
}

Deliver<DecomposedTransform> SceneStructure::CompoundedTransform(OccupantIdentity Subject) const
{
    const std::uint32_t SlotOrdinal = Resolved(Subject);

    if (SlotOrdinal == AbsentSlot)
    {
        return Deliver<DecomposedTransform>::Refuse(
            { RefusalReason::IdentityStale, "the identity no longer resolves here" });
    }

    return Deliver<DecomposedTransform>::Deliver(CompoundedTransforms[SlotOrdinal]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   CYCLE REJECTION
//------------------------------------------------------------------------------------------------------------------------

bool SceneStructure::EnclosureCyclic(OccupantIdentity Subject, OccupantIdentity ProposedEnclosure) const
{
    const std::uint32_t SlotOrdinal = Resolved(Subject);

    if (SlotOrdinal == AbsentSlot)
        return false;

    // 📝 Walked outward rather than compared against labels. A change arriving before ④ would otherwise be
    //    gated against labels ④ has not yet repaired, and the gate would pass a cycle through.
    std::uint32_t Walking = Resolved(ProposedEnclosure);

    for (std::uint32_t Passed = 0u; Walking != AbsentSlot && Passed <= EnclosureDepthCeiling; ++Passed)
    {
        if (Walking == SlotOrdinal)
            return true;

        Walking = Resolved(Enclosures[Walking].EnclosingOccupant);
    }

    return false;
}

bool SceneStructure::AttachmentCyclic(OccupantIdentity Subject, OccupantIdentity ProposedAttachment) const
{
    const std::uint32_t SlotOrdinal = Resolved(Subject);

    if (SlotOrdinal == AbsentSlot)
        return false;

    std::uint32_t Walking = Resolved(ProposedAttachment);

    for (std::uint32_t Passed = 0u; Walking != AbsentSlot && Passed <= EnclosureDepthCeiling; ++Passed)
    {
        if (Walking == SlotOrdinal)
            return true;

        Walking = Resolved(Attachments[Walking].AttachmentOccupant);
    }

    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  INVARIANTS 3 AND 4
//------------------------------------------------------------------------------------------------------------------------

bool SceneStructure::RelationsAcyclic() const
{
    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < SlotGenerations.size(); ++SlotOrdinal)
    {
        if (SlotGenerations[SlotOrdinal] == 0u)
            continue;

        std::uint32_t Walking = Resolved(Enclosures[SlotOrdinal].EnclosingOccupant);
        std::uint32_t Passed  = 0u;

        while (Walking != AbsentSlot)
        {
            if (Walking == SlotOrdinal || ++Passed > EnclosureDepthCeiling)
                return false;

            Walking = Resolved(Enclosures[Walking].EnclosingOccupant);
        }

        Walking = Resolved(Attachments[SlotOrdinal].AttachmentOccupant);
        Passed  = 0u;

        while (Walking != AbsentSlot)
        {
            if (Walking == SlotOrdinal || ++Passed > EnclosureDepthCeiling)
                return false;

            Walking = Resolved(Attachments[Walking].AttachmentOccupant);
        }
    }

    return true;
}

bool SceneStructure::LabelsNested() const
{
    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < SlotGenerations.size(); ++SlotOrdinal)
    {
        if (SlotGenerations[SlotOrdinal] == 0u)
            continue;

        const EnclosureRecord& Held = Enclosures[SlotOrdinal];

        if (Held.Label.LabelBegin == 0u || Held.Label.LabelEnd <= Held.Label.LabelBegin)
            return false;

        const std::uint32_t EnclosureSlot = Resolved(Held.EnclosingOccupant);

        if (EnclosureSlot != AbsentSlot && !EnclosureContains(Enclosures[EnclosureSlot].Label, Held.Label))
            return false;

        // 📝 Disjoint enclosures never overlap, which over one ordering is exactly that each label begins
        //    after the one before it ended. Checking the ordering covers every disjoint pair at once.
        if (Held.NextInOrder != AbsentSlot
         && Enclosures[Held.NextInOrder].Label.LabelBegin <= Held.Label.LabelEnd)
        {
            return false;
        }
    }

    return true;
}

}   // namespace Slate
