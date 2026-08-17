//============================================================================================================================================
//                                                          AMENDMENTSEQUENCE.H
//============================================================================================================================================
// 🧩 Structural changes recorded during a traversal and applied after it, so nothing edits the arrangement it is walking.

#pragma once

#include "Contract/DeliveryContract.h"
#include "Contract/IdentityContract.h"
#include "SlateUI/Interface/InteractionIndex/Api/InteractionIndex.h"
#include "SlateUI/Interface/RedrawScheduler/Api/RedrawScheduler.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    WHAT ONE AMENDMENT DOES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The structural change one amendment carries.
/// note  `Command` and not the obvious spelling: `SKILL-Naming.md` names `Command` as the replacement for a
///       discriminating operation, and bans the word this would otherwise be called.
/// note  🔴 Every one of these alters the set being traversed. A panel withdrawn mid-traversal invalidates
///       the position the traversal is holding; a panel enrolled mid-traversal may or may not be visited
///       depending on where the cursor had reached. Both are the defect this component exists to remove.
/// tag   contract
enum class AmendmentCommand : std::uint32_t
{
    Enrol        = 0u,   // [-] - a subject joins the presented set
    Withdraw     = 1u,   // [-] - a subject leaves it
    Present      = 2u,   // [-] - a subject already enrolled becomes visible
    Conceal      = 3u,   // [-] - it stops being visible without leaving the set
    Relocate     = 4u,   // [-] - it moves to sit under a declared destination
    CommandCount = 5u    // [-] - the closed count, never a command
};

/// 🧩 One recorded structural change, valid until the sequence is applied.
/// note  Both identities are the caller's own. Nothing here allocates, and nothing here reaches into the
///       arrangement — an amendment is a statement of intent and not a partial edit.
/// tag   contract, nonallocating, nonthrowing
struct Amendment
{
    AmendmentCommand  Command     = AmendmentCommand::Enrol;   // [-] - what it does
    ControlIdentity   Subject     = {};                        // [-] - what it does it to
    ControlIdentity   Destination = {};                        // [-] - read by Relocate alone
};

/// 🧩 What one applied amendment resolved to.
/// note  🔴 A refused amendment is reported and not silently dropped. An interaction that asked for a
///       relocation and received nothing, with no reason, is indistinguishable from one the artist
///       mis-aimed — and the two want opposite responses.
/// tag   contract, nonallocating, nonthrowing
struct AmendmentVerdict
{
    std::uint32_t  Applied  = 0u;                    // [-] - how many amendments took effect
    std::uint32_t  Refused  = 0u;                    // [-] - how many were declined, with a reason each
    RedrawMark     Mark     = RedrawMark::Quiet;     // [-] - the dearest mark the applied set raised
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Records structural amendments during a traversal and applies them at one declared point afterwards.
/// note  🔴 The whole purpose is the ordering. A panel that withdrew itself while the traversal was inside
///       it would invalidate the position the traversal holds; a panel that enrolled another mid-traversal
///       would be visited or skipped depending only on where the cursor had reached, which is not a
///       decision anybody made. Recording the intent and applying it after the sweep removes both.
/// note  🔴 Applied in the order recorded. Two amendments naming one subject are not merged — a withdraw
///       followed by an enrol is a different outcome from an enrol followed by a withdraw, and collapsing
///       them would pick one silently.
/// note  ⚠️ `Apply` must be called exactly once per tick, after the traversal and before anything reads the
///       arrangement again. Amendments left unapplied are discarded by the next `Advance`, which is a
///       structural change the artist asked for and did not receive.
/// tag   owning
class AmendmentSequence
{
public:

    static constexpr std::uint32_t AmendmentCapacity = 64u;   // [-] - per tick; never allocated, never grown

    AmendmentSequence()                                    = default;
    AmendmentSequence(const AmendmentSequence&)            = delete;
    AmendmentSequence& operator=(const AmendmentSequence&) = delete;
    ~AmendmentSequence()                                   = default;

    /// 🧩 Borrows the ledger every amendment's identities are resolved against.
    /// in    Ledger   [-]  borrowed; outlives this component
    /// out   Deliver  [-]  refuses with ContentUnsupported when a construction already stands
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> Construct(InteractionIndex& Ledger);

    /// 🧩 Opens one tick, discarding anything the previous tick recorded and never applied.
    /// note  ⚠️ An unapplied amendment is discarded rather than carried. Carrying it would apply a
    ///        structural change one tick after the interaction that asked for it, against an arrangement
    ///        that has since moved.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Advance();

    /// 🧩 Records one amendment to be applied after the traversal.
    /// in    Declared  [-]  what to do, to which subject, and where
    /// out   Deliver   [-]  refuses with CapabilityAbsent before Construct, ExtentExhausted when the tick's
    ///                      capacity is full, and IdentityStale when either identity does not resolve
    /// note  🔴 The identities are checked HERE, at the site that asked, and again at Apply. Checking only
    ///        at Apply would report a stale identity from a call site that is merely the synchronisation
    ///        point, naming nothing about which interaction produced it.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> Record(const Amendment& Declared);

    /// 🧩 How many amendments stand recorded and unapplied.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    std::uint32_t Standing() const;

    /// 🧩 Whether one subject already has an amendment recorded against it this tick.
    /// use   A control tests this before recording a second one, so an interaction that fires twice within
    ///       a tick does not enrol the same subject twice.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Amended(ControlIdentity Subject) const;

    /// 🧩 Applies every recorded amendment, in the order recorded, and empties the sequence.
    /// out   Verdict  [-]  how many applied, how many were refused, and the dearest mark raised
    /// note  🔴 An identity that resolved at Record and does not resolve now is refused rather than
    ///        applied. Between the two, an earlier amendment in this same sweep may have withdrawn it —
    ///        which is exactly the case a mid-traversal edit would have got wrong.
    /// note  🔴 A Relocate whose destination is its own subject is refused. It is the smallest possible
    ///        cycle, and `12` §9 requires a cycle-creating relation change to be rejected at commit.
    /// post  the sequence is empty; every applied amendment is visible to the next traversal
    /// cost  🚩
    /// tag   api, nonallocating, nonthrowing
    AmendmentVerdict Apply();

    /// 🧩 The refusal one amendment met, for a caller reporting why an interaction had no effect.
    /// in    Ordinal  [-]  which of the refusals from the last Apply; below the verdict's Refused count
    /// out   Deliver  [-]  refuses when the ordinal names no refusal
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<Refusal> Declined(std::uint32_t Ordinal) const;

    /// 🧩 Returns the sequence to its constructed condition.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Reset();

private:

    InteractionIndex*  Ledger                            = nullptr;   // [-] - borrowed; never owned
    Amendment          Recorded[AmendmentCapacity]       = {};        // [-] - never allocated
    std::uint32_t      RecordedCount                     = 0u;        // [-]
    Refusal            Refusals[AmendmentCapacity]       = {};        // [-] - from the last Apply
    std::uint32_t      RefusedCount                      = 0u;        // [-]
};

}   // namespace Slate
