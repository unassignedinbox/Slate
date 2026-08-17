//============================================================================================================================================
//                                                            DELIVERYCONTRACT.H
//============================================================================================================================================
// 🧩 Absence that carries a reason, and a convergent result that reports which criterion terminated it.

#pragma once

#include <cstdint>

#ifdef SLATE_DEBUG
#include <cstdio>
#endif

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       REFUSAL
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Why a computation declined to deliver content. Absence without one of these is never reported.
/// tag   contract
enum class RefusalReason : std::uint32_t
{
    CapabilityAbsent    = 0u,   // [-] - the vendor capability the mechanism requires was not negotiated
    ExtentExhausted     = 1u,   // [-] - a reserved or committed claim could not be satisfied in full
    IdentityStale       = 2u,   // [-] - the generation held by the reference no longer occupies the slot
    ContentUnsupported  = 3u,   // [-] - the intake subset does not accept what the stream contained
    VersionUnmigratable = 4u,   // [-] - no declared migration reaches the current stream version
    HostDenied          = 5u,   // [-] - the operating system declined the request
    RelationCyclic      = 6u,   // [-] - the relation change would close a cycle; never applied
    DeviceLost          = 7u    // [-] - the device was lost; nothing it holds is valid to destroy or reuse
};

// 📝 🔴 RelationCyclic exists because `12` §9 requires a cycle-creating relation change to be rejected at
//    commit and reported as a Refusal a reader can discriminate. Spelling it HostDenied would have put a
//    document-model rejection behind the operating system's reason, and `86` presents that reason verbatim.
//    Both operands are the rejecting call's own arguments, so the caller names them without allocating.

// 📝 🔴 DeviceLost exists for the same reason at the vendor edge. `06` §7 requires device loss to be reported
//    upward before anything is destroyed, and `06` §4.2's recovery is a different response from an ordinary
//    refusal — the device is recreated and the capability set re-scored, rather than the call being retried.
//    A caller cannot tell those apart from HostDenied and prose, so the six sites that can observe the loss
//    report it as this reason and destroy nothing themselves.

/// 🧩 One reported refusal — the reason, plus static text naming the operand it applies to.
/// note  Detail points at string literal storage only. Nothing here ever owns an allocation.
/// tag   contract, nonallocating
struct Refusal
{
    RefusalReason  DeclaredReason = RefusalReason::HostDenied;   // [-] - the discriminating reason
    const char*    Detail         = "";                          // [-] - static text, never allocated
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       DELIVERY
//------------------------------------------------------------------------------------------------------------------------

// 🔍 Defined inline rather than in a translation unit, because `Contract/` is headers only — no unit
//    gathers a .cpp from it, so an out-of-line definition would compile everywhere and link nowhere.
// 📝 Debug builds alone. In a release build the call site inside Resolve is compiled out and neither this
//    function nor <cstdio> is reached, so the release contract carries no standard streams.
#ifdef SLATE_DEBUG
inline void ReportResolvedRefusal(const Refusal& Declining)
{
    std::fprintf(stderr, "Slate \u2014 a refused delivery was resolved: reason %u, %s\n",
                 static_cast<unsigned>(Declining.DeclaredReason),
                 (Declining.Detail != nullptr) ? Declining.Detail : "");
    std::fflush(stderr);
}
#endif

/// 🧩 Delivered content, or a refusal naming why it is absent. Used wherever a document reports a refusal.
/// note  ⚠️ Delivered is default-constructed when ContentPresent is false. Read it only through Resolve.
/// note  🔴 `[[nodiscard]]`. A refusal nobody read is a refusal that did not happen: the caller carries on
///        against state the callee declined to produce, and the defect surfaces later at a call that is
///        correct. Applying it found `HostLifecycle` discarding the delivery from a presentation-chain
///        re-establishment — a resize that failed would have reported success and ticked on against a
///        chain that no longer existed. A delivery genuinely not worth reading is discarded through
///        `Disregard`, which says so in one word at the site.
/// tag   contract, nonallocating, nonthrowing
template <typename Content>
struct [[nodiscard]] ContentDelivery
{
    Content  Delivered      = Content{};   // [-] - meaningful only while ContentPresent holds
    Refusal  Declined       = {};          // [-] - meaningful only while ContentPresent is false
    bool     ContentPresent = false;       // [-] - the discriminant, and the only thing read first

    /// 🧩 Constructs a delivered result around content the computation produced.
    /// in    Produced   [-]  the content to deliver
    /// out   Deliver    [-]  ContentPresent holds
    /// cost  ✔️
    static constexpr ContentDelivery Deliver(const Content& Produced)
    {
        ContentDelivery Constructed;
        Constructed.Delivered      = Produced;
        Constructed.ContentPresent = true;
        return Constructed;
    }

    /// 🧩 Constructs a refused result carrying the reason the content is absent.
    /// in    Declining  [-]  the reason and the operand it applies to
    /// out   Deliver    [-]  ContentPresent is false
    /// cost  ✔️
    static constexpr ContentDelivery Refuse(const Refusal& Declining)
    {
        ContentDelivery Constructed;
        Constructed.Declined       = Declining;
        Constructed.ContentPresent = false;
        return Constructed;
    }

    /// 🧩 Whether content was delivered, for a caller that wants the discriminant in a condition.
    /// use   `if (const auto Opened = Commands.Open(Slot); Opened) { … }`
    /// note  Explicit, so a delivery cannot be compared against an integer or silently narrowed. It reads
    ///       the same discriminant `ContentPresent` does and exists only to make the condition shorter.
    /// cost  ✔️
    constexpr explicit operator bool() const
    {
        return ContentPresent;
    }

    /// 🧩 Reads the delivered content.
    /// out   Content    [-]  the produced content
    /// pre   ContentPresent holds
    /// note  🔴 🔍 Under SLATE_DEBUG a read of refused content reports here, at the call that did it.
    ///        Without the check it returns a default-constructed Content — a zero handle, an empty span, an
    ///        identity of generation zero — and the defect surfaces wherever that value is finally used,
    ///        which is never the call that failed to test the delivery.
    /// cost  ✔️
    constexpr const Content& Resolve() const
    {
#ifdef SLATE_DEBUG
        if (!ContentPresent)
        {
            ReportResolvedRefusal(Declined);
        }
#endif
        return Delivered;
    }
};

/// 🧩 Discards a delivery deliberately, saying so at the site.
/// in    Delivered  [-]  the delivery whose outcome genuinely does not affect what follows
/// use   `Disregard(NamingEdge->Declare(…));` — a debug label the vendor declined changes nothing about
///       the object it would have named.
/// note  🔴 The one sanctioned way past `[[nodiscard]]`. A cast to void would do the same thing and say
///        nothing; this spelling is greppable, so the set of deliberate discards can be read as a list and
///        argued with. Every use should be able to complete the sentence "nothing downstream depends on
///        this having succeeded, because…".
/// cost  ✔️
/// tag   contract, constexpr, nonallocating, nonthrowing
template <typename Content>
constexpr void Disregard(const ContentDelivery<Content>&)
{
}

/// 🧩 Public spelling for content delivered or refused across one fallible call.
/// note  An alias permits `Deliver<Content>::Deliver(Produced)`: a class named Deliver cannot declare a static
///       function carrying its own name because C++ reserves that spelling for its constructor.
/// tag   contract, nonallocating, nonthrowing
template <typename Content>
using Deliver = ContentDelivery<Content>;

//------------------------------------------------------------------------------------------------------------------------
//                                                  CONVERGENT RESULT
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Which of the two terminating conditions ended an iteration.
/// note  A solver that returns its last iterate at the ceiling is otherwise indistinguishable from one
///       that converged, and the ambiguity propagates upward as an unexplained artefact.
/// tag   contract
enum class TerminationCause : std::uint32_t
{
    CriterionSatisfied = 0u,   // [-] - the declared convergence criterion was met
    CeilingReached     = 1u    // [-] - the declared iteration ceiling was reached first
};

/// 🧩 The result of a Convergent computation. Never returned as a bare approximation.
/// tag   contract, nonallocating, nonthrowing
template <typename Content>
struct ConvergentResult
{
    Content           Approximation  = Content{};                       // [-]  - the last iterate produced
    double            ResidualNorm   = 0.0;                             // [-]  - ‖r‖ measured at termination
    std::uint32_t     IterationCount = 0u;                              // [-]  - iterations actually taken
    TerminationCause  Cause          = TerminationCause::CeilingReached; // [-] - which condition terminated
};

}   // namespace Slate
