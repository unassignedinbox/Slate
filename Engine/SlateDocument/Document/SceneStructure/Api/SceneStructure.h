//============================================================================================================================================
//                                                             SCENESTRUCTURE.H
//============================================================================================================================================
// 🧩 The two nesting relations over the population — organisational enclosure and kinematic attachment, apart.

#pragma once

#include "Contract/IdentityContract.h"
#include "Contract/DeliveryContract.h"
#include "Contract/PrecisionContract.h"
#include "Shared/ContainmentClassifier.slang.h"
#include "SlateMath/Numeric/TransformProjection/Api/TransformProjection.h"

#include <cstdint>
#include <vector>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  INTERVAL LABELLING
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 One occupant's half-open-free interval label. Enclosure at any depth is a comparison of two of these.
/// note  📐 Both bounds are issued from a single 64-bit line walked depth-first, so increasing LabelBegin is
///       exactly row order. An unlabelled record carries two zeros, and zero is never issued.
/// tag   nonallocating, nonthrowing
struct IntervalLabel
{
    std::uint64_t  LabelBegin = 0u;   // [-] - first ordinal of the span this occupant owns
    std::uint64_t  LabelEnd   = 0u;   // [-] - last ordinal of it; every enclosed label sits strictly inside
};

// 📝 The label line is 2⁶⁰ wide rather than the full 64-bit range so that a relabel escalating to the root
//    can still be expressed, and so that arithmetic on a span never approaches overflow.
inline constexpr std::uint64_t RootLabelCeiling  = 1ull << 60;   // [-] - the span the root ordering divides
inline constexpr std::uint64_t EnclosureLabelGap = 1024ull;      // [-] - narrowest interval that accepts content

// 📝 The gap is sized to expected enclosure width — an enclosure of a thousand occupants inserts without a
//    relabel, and one deeper than that relabels its own span only. `12` §10 leaves the figure open and blocks
//    tuning alone, so it is declared here rather than in `Contract/`: no second unit reads it. `16` and `26`
//    read the labels, never the gap that produced them.
inline constexpr std::uint32_t EnclosureDepthCeiling = 64u;         // [-] - deepest enclosure the relation admits
inline constexpr std::uint32_t AbsentSlot            = 0xFFFFFFFFu; // [-] - no slot; never a valid ordinal

/// 🧩 Whether Outer encloses Inner at any depth, by integer comparison alone.
/// in    Outer      [-]  the candidate enclosing occupant's label
/// in    Inner      [-]  the candidate enclosed occupant's label
/// out   Contained  [-]  false for either label unissued, and false for an occupant against itself
/// note  🔴 This is the Tier A predicate `16` and `26` ask per occupant per rotation. Neither can afford a
///       traversal, which is the entire reason the labels exist.
/// note  🔴 The comparison itself lives in `Shared/` and is parity-proven, because `26` §1 ② asks it on the
///       device against labels this unit issued on the host. Two implementations of one comparison are two
///       that must agree about strictness at every bound, and the rotation on which they stop agreeing is the
///       one where the outline and the shading disagree about which enclosure a pixel belongs to.
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
constexpr bool EnclosureContains(IntervalLabel Outer, IntervalLabel Inner)
{
    return ClassifyIntervalContainment(Outer.LabelBegin, Outer.LabelEnd,
                                       Inner.LabelBegin, Inner.LabelEnd) > 0;
}
SLATE_DECLARES_PRECISION(PrecisionGuarantee::Exact, PrecisionGuarantee::Exact);

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE TWO RELATIONS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Which of the two relations a declared change addresses.
/// note  🔴 They are separately stored and separately reconciled. Deriving either from the other terminates
///       in a transform override, and that override is a rewrite rather than a patch.
/// tag   contract
enum class RelationSubject : std::uint32_t
{
    EnclosureContains = 0u,   // [-] - organisational; row order, visibility inheritance, grouping
    AttachmentFollows = 1u    // [-] - kinematic; transform compounding, motion propagation
};

/// 🧩 One occupant's place in `EnclosureContains`, with the ordering walked to linearise it.
/// note  The ordering is intrusive rather than a vector per slot: a million occupants would otherwise carry a
///       million empty vectors, and the walk is the same walk either way.
/// tag   nonallocating, nonthrowing
struct EnclosureRecord
{
    OccupantIdentity  EnclosingOccupant = {};           // [-] - undeclared places the occupant in the root ordering
    IntervalLabel     Label             = {};           // [-] - repaired at ④, read by ⑤ and by `16` and `26`
    std::uint32_t     FirstEnclosed     = AbsentSlot;   // [-] - first enclosed occupant in enclosure ordering
    std::uint32_t     LastEnclosed      = AbsentSlot;   // [-] - last of them; kept so appending is not a walk
    std::uint32_t     PriorInOrder      = AbsentSlot;   // [-] - preceding occupant of the same enclosure
    std::uint32_t     NextInOrder       = AbsentSlot;   // [-] - following occupant of the same enclosure
    std::uint32_t     EnclosedCount     = 0u;           // [-] - occupants this one encloses directly
    std::uint32_t     EnclosureDepth    = 0u;           // [-] - zero for the root ordering
};

/// 🧩 One occupant's place in `AttachmentFollows`, and the chain compounded downward from a root.
/// note  🔴 An occupant with an undeclared attachment is an attachment root, and its compounded transform is
///       its authored transform unchanged. Enclosure has no entry here, by construction.
/// tag   nonallocating, nonthrowing
struct AttachmentRecord
{
    OccupantIdentity  AttachmentOccupant = {};           // [-] - undeclared makes this occupant a root
    std::uint32_t     FirstAttached      = AbsentSlot;   // [-] - first occupant following this one
    std::uint32_t     NextAttached       = AbsentSlot;   // [-] - next occupant following the same attachment
    std::uint32_t     AttachmentDepth    = 0u;           // [-] - compounding steps from the attachment root
};

// 📝 💾 `12` §6 puts the design point at 108 bytes per occupant for slot, generation, both relations and the
//    interval label. Asserting it here makes the budget a build failure rather than a review remark; the
//    authored and compounded transforms are `10`'s per-occupant storage and are outside this figure.
static_assert(sizeof(EnclosureRecord) + sizeof(AttachmentRecord) <= 108u,
              "The two relations and the interval label must fit the declared per-occupant budget.");

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE RELATIONS HELD
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Both nesting relations over one population, each reconciled on its own.
/// note  ⚠️ Kinship vocabulary is absent by law: an occupant has an enclosing occupant, encloses others, and
///       sits at an enclosure depth. `12` §1 bans the alternative spellings outright.
/// note  🔴 Slot ordinals index every vector here directly. A stale identity is refused at the seam rather
///       than resolved against whatever later took the slot, which is what the generation is for.
/// tag   owning
class SceneStructure
{
public:

    /// 🧩 Admits one enrolled occupant into both relations, unenclosed and unattached.
    /// in    Arriving  [-]  the identity `PopulationIndex` issued
    /// out   Deliver   [-]  refuses with IdentityStale for an undeclared identity
    /// post  the occupant sits last in the root ordering and is its own attachment root
    /// cost  ✔️
    /// tag   api, nonthrowing
    Deliver<bool> Admit(OccupantIdentity Arriving);

    /// 🧩 Withdraws one occupant from both relations, re-enclosing what it enclosed.
    /// in    Departing  [-]  the identity being retired
    /// out   Deliver    [-]  refuses with IdentityStale when the identity does not resolve here
    /// post  🔴 enclosed occupants are re-enclosed by the departing occupant's enclosure and are not retired
    ///       with it; attached occupants keep their compounded transform and take its attachment
    /// note  `12` §12 states the policy in one sentence — deleting a group deletes the group, not the work
    ///       inside it. The caller seals the whole cascade as one transaction.
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Retire(OccupantIdentity Departing);

    /// 🧩 Places one occupant in an enclosure at a declared position in its ordering.
    /// in    Subject               [-]  the occupant being placed
    /// in    ProposedEnclosure    [-]  the enclosing occupant; undeclared returns it to the root ordering
    /// in    OrderWithinEnclosure [-]  position in the enclosure's ordering; clamped to its end
    /// out   Deliver              [-]  refuses with RelationCyclic when the change would close a cycle, and
    ///                                with IdentityStale when either identity does not resolve
    /// note  🔴 The refusal never applies the change. Both operands stay readable through RejectedRelation
    ///       on the caller so that `86` can name them without this seam allocating a message.
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Enclose(OccupantIdentity Subject,
                          OccupantIdentity ProposedEnclosure,
                          std::uint32_t    OrderWithinEnclosure);

    /// 🧩 Attaches one occupant to another so that it follows its motion.
    /// in    Subject             [-]  the occupant that will follow
    /// in    ProposedAttachment  [-]  what it follows; undeclared makes it an attachment root
    /// out   Deliver             [-]  refuses with RelationCyclic, or IdentityStale for either operand
    /// note  Attachment may cross enclosure boundaries freely — `12` §10 records that as the reason two
    ///       relations exist rather than one.
    /// cost  ✔️
    /// tag   api, nonthrowing
    Deliver<bool> Attach(OccupantIdentity Subject, OccupantIdentity ProposedAttachment);

    /// 🧩 Records the transform the artist authored for one occupant.
    /// in    Subject   [-]  the occupant
    /// in    Authored  [-]  its own transform, before any attachment is compounded into it
    /// out   Deliver   [-]  refuses with IdentityStale
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> AuthorTransform(OccupantIdentity Subject, const DecomposedTransform& Authored);

    /// 🧩 Compounds every occupant's transform downward from its attachment root — tick step ③.
    /// out   Deliver  [-]  refuses with ExtentExhausted when a chain exceeds the declared depth ceiling
    /// post  every occupant's compounded transform depends only on its attachment root path
    /// note  🔴 Runs before enclosure is reconciled. Transforms must be final before anything spatial is
    ///       derived from them, which `12` §4 makes an ordering rather than a preference.
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> CompoundAttachments();

    /// 🧩 Repairs interval labels across every span whose gap was exhausted — tick step ④.
    /// out   Deliver  [-]  refuses with ExtentExhausted when the root span itself cannot hold the ordering
    /// post  labels are strictly nested and no linearisation has yet been observed against them
    /// note  Relabelling covers the exhausted span and escalates outward only while the span above it also
    ///       refuses. A whole-population relabel is the last resort, never the first.
    /// cost  🔴
    /// tag   api, nonthrowing
    Deliver<bool> RepairLabels();

    /// 🧩 One occupant's interval label, for the containment predicate above.
    /// in    Subject  [-]  the occupant
    /// out   Deliver  [-]  refuses with IdentityStale
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<IntervalLabel> Label(OccupantIdentity Subject) const;

    /// 🧩 One occupant's transform with its whole attachment path compounded into it.
    /// in    Subject  [-]  the occupant
    /// out   Deliver  [-]  refuses with IdentityStale
    /// pre   CompoundAttachments delivered within this tick
    /// cost  ✔️
    /// tag   api, nonthrowing
    Deliver<DecomposedTransform> CompoundedTransform(OccupantIdentity Subject) const;

    /// 🧩 Whether enclosing Subject in ProposedEnclosure would close a cycle.
    /// in    Subject            [-]  the occupant being placed
    /// in    ProposedEnclosure  [-]  where it would go
    /// out   Cyclic             [-]  true when Subject already encloses the proposal, or is it
    /// note  Answered by walking outward rather than by comparing labels, because a change arriving before
    ///       ④ is gated against labels that ④ has not yet repaired.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool EnclosureCyclic(OccupantIdentity Subject, OccupantIdentity ProposedEnclosure) const;

    /// 🧩 Whether attaching Subject to ProposedAttachment would close a cycle.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool AttachmentCyclic(OccupantIdentity Subject, OccupantIdentity ProposedAttachment) const;

    //  📝 The four walks below are the linearisation's own, taken by `RowSequence` in slot ordinals. Nothing
    //     outside this unit reads them: `16` and `26` ask the interval predicate instead.

    /// 🧩 First occupant of the root ordering, or AbsentSlot when the population is empty.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    std::uint32_t RootFirst() const;

    /// 🧩 Next occupant of the same enclosure ordering, or AbsentSlot at its end.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    std::uint32_t NextInOrder(std::uint32_t SlotOrdinal) const;

    /// 🧩 First occupant enclosed by this one, or AbsentSlot when it encloses nothing.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    std::uint32_t FirstEnclosed(std::uint32_t SlotOrdinal) const;

    /// 🧩 How many enclosures stand between this occupant and the root ordering.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    std::uint32_t EnclosureDepth(std::uint32_t SlotOrdinal) const;

    /// 🧩 The identity occupying one slot, undeclared when the slot is vacant here.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    OccupantIdentity OccupantAt(std::uint32_t SlotOrdinal) const;

    /// 🧩 How many slots both relations span, occupied or not.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    std::uint32_t SpannedCount() const;

    /// 🧩 Whether a relabel is owed before a linearisation may be taken.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool RelabelOwed() const;

    /// 🧩 🔍 Whether neither relation contains a cycle — invariant 3, checked on every reconciliation.
    /// cost  🔴
    /// tag   api, nonallocating, nonthrowing
    bool RelationsAcyclic() const;

    /// 🧩 🔍 Whether every label is strictly nested and disjoint enclosures never overlap — invariant 4.
    /// cost  🔴
    /// tag   api, nonallocating, nonthrowing
    bool LabelsNested() const;

private:

    std::uint32_t Resolved(OccupantIdentity Subject) const;
    void          Unlink(std::uint32_t SlotOrdinal);
    void          Link(std::uint32_t SlotOrdinal, std::uint32_t EnclosureSlot, std::uint32_t OrderWithinEnclosure);
    IntervalLabel EnclosureInterval(std::uint32_t EnclosureSlot) const;
    bool          LabelBetween(std::uint32_t SlotOrdinal);
    Deliver<bool> AssignLabels(std::uint32_t EnclosureSlot, IntervalLabel Available, std::uint32_t Depth);
    void          DeclareExhausted(std::uint32_t EnclosureSlot);
    Deliver<bool> CompoundFrom(std::uint32_t SlotOrdinal, std::uint32_t Depth);

    std::vector<EnclosureRecord>      Enclosures;                 // [-] - indexed by slot ordinal
    std::vector<AttachmentRecord>     Attachments;                // [-] - indexed by slot ordinal
    std::vector<DecomposedTransform>  AuthoredTransforms;         // [-] - as the artist authored them
    std::vector<DecomposedTransform>  CompoundedTransforms;       // [-] - as ③ compounded them
    std::vector<std::uint32_t>        SlotGenerations;            // [-] - generation admitted per slot; zero is vacant
    std::vector<std::uint32_t>        ExhaustedEnclosures;        // [-] - spans ④ must relabel; root is AbsentSlot
    std::uint32_t                     RootFirstSlot = AbsentSlot; // [-] - head of the root ordering
    std::uint32_t                     RootLastSlot  = AbsentSlot; // [-] - its tail
    std::uint32_t                     RootCount     = 0u;         // [-] - occupants in the root ordering
    std::uint32_t                     AdmittedCount = 0u;         // [-] - occupants held in both relations
};

// 📐 Compounding is Bounded and nothing here claims better of it: CompoundAttachments consumes
//    `TransformProjection::Compound`, which renormalises and is declared Bounded. The relations themselves
//    and every interval comparison are Exact, and the two claims never mix in one computation.
SLATE_DECLARES_PRECISION(PrecisionGuarantee::Bounded, PrecisionGuarantee::Bounded);

}   // namespace Slate
