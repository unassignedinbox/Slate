//============================================================================================================================================
//                                                           INTERACTIONINDEX.H
//============================================================================================================================================
// 🧩 A generational slot ledger of live control interaction — the one seizure, the one open popup, and every fade.

#pragma once

#include "Contract/DeliveryContract.h"
#include "Contract/IdentityContract.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"
#include "SlateUI/Interface/MotionIntegrator/Api/MotionIntegrator.h"
#include "SlateUI/Interface/RedrawScheduler/Api/RedrawScheduler.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE CONTROL SUBJECT
//------------------------------------------------------------------------------------------------------------------------

// 📝 The tag exists only to make Identity<ControlSubject> a distinct type. A ControlIdentity passed where an
//    OccupantIdentity is expected is a compile error, which is the whole reason the tag is declared.
struct ControlSubject {};

using ControlIdentity = Identity<ControlSubject>;

//------------------------------------------------------------------------------------------------------------------------
//                                                      WHAT ONE CONTACT DID
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Which part of a control one contact seized when it arrived.
/// note  🔴 Decided once, at arrival, and never re-decided while the contact stands. A part re-derived every
///        tick changes underneath a drag the moment the extent it was tested against moves — and for the
///        ruler and the slider, the drag is what moves it. `DrawerSpace` records the same rule for the same
///        reason.
/// tag   contract
enum class ControlPart : std::uint32_t
{
    Nothing   = 0u,   // [-] - the contact seized no part of any control
    Body      = 1u,   // [-] - the control's own extent — a row, a toggle, a stop
    Chevron   = 2u,   // [-] - the selection field's trailing cell
    Option    = 3u,   // [-] - one row of an open selection menu
    Track     = 4u,   // [-] - a slider's track, seized away from its thumb
    Thumb     = 5u,   // [-] - a slider's thumb
    Strip     = 6u,   // [-] - the rotation ruler's tick strip
    PartCount = 7u    // [-] - the closed count, never a part
};

/// 🧩 What one control reports after a tick of arbitration.
/// note  The mark is the control's own; a caller folds it into the panel's mark with `Dearer`. A control that
///       only recoloured must not force the re-record its neighbour needs.
/// tag   contract, nonallocating, nonthrowing
struct ControlVerdict
{
    bool        OrdinateAltered = false;              // [-] - the caller's datum was written this tick
    bool        ContactTaken    = false;              // [-] - this control holds the pointer
    RedrawMark  Mark            = RedrawMark::Quiet;  // [-] - what presenting it again costs
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE ROUSE FADE
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The two interpolants every enrolled control carries, and the pose they interpolate between.
/// note  📐 Rouse and take are separate traverses because the source fades them over different durations and
///        they overlap constantly — a row that is hovered while it is being taken is running both. One
///        interpolant carrying both would make the second transition restart the first.
/// tag   contract, nonallocating, nonthrowing
struct ControlPose
{
    std::uint32_t  RouseOrdinal = 0u;      // [-] - eased, zero quiet to one roused
    std::uint32_t  TakeOrdinal  = 0u;      // [-] - eased, zero absent to one taken
    bool           Enrolled     = false;   // [-] - both ordinals were delivered by the integrator
};

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE LEDGER
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every slot of live control interaction, keyed by a generational identity issued once at bring-up.
/// note  🔴 This component holds **interaction** and never a datum the artist edits. `14` §1 requires a panel
///        to store none of what it presents; a dropdown that remembers it is open and a ruler that remembers
///        where a drag arrived are interaction, which `14` §4.1 places here — "panel layout, scroll,
///        expansion", owned by `14`, beside the document, and never a transaction.
/// note  🔴 Exactly one control may hold the contact and exactly one popup may stand open. Both are single
///        members rather than a per-slot condition, so a second claim is a refusal the type system reports
///        instead of a second popup nobody notices until two are drawn overlapping.
/// note  ⚠️ Advance exactly once per tick, before any control is arbitrated. The seizure it resolves is what
///        every `Seize` call that tick tests against.
/// tag   owning
class InteractionIndex
{
public:

    static constexpr std::uint32_t ControlCapacity = 256u;   // [-] - enrolled controls; never allocated, never grown

    InteractionIndex()                                   = default;
    InteractionIndex(const InteractionIndex&)            = delete;
    InteractionIndex& operator=(const InteractionIndex&) = delete;
    ~InteractionIndex()                                  = default;

    /// 🧩 Borrows the integrator every enrolled control's fades are enrolled into.
    /// in    Motion   [-]  borrowed; outlives this component
    /// out   Deliver  [-]  refuses with ContentUnsupported when a construction already stands
    /// post  the ledger is empty and Enrol may be called
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<bool> Construct(MotionIntegrator& Motion);

    /// 🧩 Claims one slot and delivers the identity the caller holds for the life of the interface.
    /// out   Deliver  [-]  refuses with CapabilityAbsent before Construct, and with ExtentExhausted when the
    ///                     ledger is full or the integrator declines either fade
    /// note  🔴 Called at bring-up and never per tick. An identity claimed inside the tick loop exhausts the
    ///        ledger in a few seconds and reports it as a refusal at a call site that looks correct.
    /// post  the delivered identity carries a generation of at least one and resolves until Reset
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<ControlIdentity> Enrol();

    /// 🧩 Whether one identity still names the slot it was issued for.
    /// out   Resolved  [-]  false for a default-constructed identity and for one issued before a Reset
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Resolves(ControlIdentity Claimed) const;

    /// 🧩 Advances one tick — samples the arrived contact and retires a seizure whose contact was released.
    /// in    Arrived  [-]   what `RecordingSurface::Pointer` sampled this tick
    /// in    Elapsed  [ms]  what the same tick's display condition measured
    /// note  🔴 The release is observed here rather than at the seizing control, because a control whose
    ///        extent left the arrangement between two ticks never runs again and would hold the seizure for
    ///        the life of the process.
    /// post  a seizure released this tick is still readable through `Released` and is gone next tick
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Advance(const PointerCondition& Arrived, double Elapsed);

    /// 🧩 Seizes the contact for one control and one part, if nothing else already holds it.
    /// in    Claimed  [-]  the seizing control
    /// in    Part     [-]  what it seized; `Nothing` never seizes
    /// out   Seized   [-]  false when another control holds the contact, or the identity is stale
    /// note  The arrival ordinates are recorded at seizure so that a drag law reads its own origin rather
    ///       than the pointer's position two ticks ago.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Seize(ControlIdentity Claimed, ControlPart Part);

    /// 🧩 Whether one control holds the contact right now.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Holding(ControlIdentity Claimed) const;

    /// 🧩 Which part the standing seizure took; `Nothing` when no seizure stands.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    ControlPart HeldPart(ControlIdentity Claimed) const;

    /// 🧩 Whether the seizure this control held was released during this tick.
    /// note  Exactly one tick reports it, which is what a tap resolves on.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Released(ControlIdentity Claimed) const;

    /// 🧩 Which part the released seizure addressed during its one reported tick.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    ControlPart ReleasedControlPart(ControlIdentity Claimed) const;

    /// 🧩 Where the standing contact arrived, and what the caller's datum read at that moment.
    /// out   Arrived  [-]  refuses with IdentityStale when this control holds no seizure
    /// use   A drag law reads `Departed + (Position − Origin) × Rate`, never an accumulated per-tick delta,
    ///       which drifts by a pixel for every tick the pointer was outside the extent.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<float> DepartedOrdinate(ControlIdentity Claimed) const;

    /// 🧩 Records the datum the seizing control departed from, once, at seizure.
    /// out   Recorded  [-]  false when this control holds no seizure
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool DepartFrom(ControlIdentity Claimed, float Ordinate);

    /// 🧩 Where the contact stood when it arrived.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    float OriginAlong() const;
    float OriginAcross() const;

    /// 🧩 Opens one popup, closing whichever stood before it.
    /// out   Opened  [-]  false when the identity is stale
    /// note  🔴 Closing the previous one here is what makes "exactly one popup" a property of the ledger
    ///        rather than a discipline every call site has to remember.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Disclose(ControlIdentity Claimed);

    /// 🧩 Closes the standing popup, whichever control owns it.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Withdraw();

    /// 🧩 Whether this control's popup stands open.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Disclosed(ControlIdentity Claimed) const;

    /// 🧩 Whether any popup stands open — what a panel tests before treating a contact as a row press.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool AnyDisclosed() const;

    /// 🧩 Declares whether one control is roused, and departs its fade when the condition changed.
    /// in    Roused    [-]   whether the pointer stands over it this tick
    /// in    Duration  [ms]  what the source declares for this control's fade
    /// out   Altered   [-]   true when the condition changed and a fade departed
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool DeclareRoused(ControlIdentity Claimed, bool Roused, double Duration);

    /// 🧩 Declares whether one control is taken, and departs its fade when the condition changed.
    /// in    Shape  [-]  the declared cubic; Standard keeps every existing control's transition
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool DeclareTaken(ControlIdentity Claimed, bool Taken, double Duration,
                      EaseCurve Shape = EaseCurve::Standard);

    /// 🧩 How far through its rouse fade one control stands, zero quiet to one roused.
    /// out   Fraction  [-]  zero for a stale identity; a caller never has to test before interpolating
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    float RousedFraction(ControlIdentity Claimed) const;

    /// 🧩 How far through its take fade one control stands, zero absent to one taken.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    float TakenFraction(ControlIdentity Claimed) const;

    /// 🧩 Drops the standing seizure without reporting a release — what a rearrangement does.
    /// post  the next Advance reports no seizure until a fresh contact arrives
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Abandon();

    /// 🧩 Returns the ledger to its constructed condition, retiring every issued identity.
    /// note  🔴 Generations are **not** rewound. An identity issued before a Reset resolves false afterwards,
    ///        which is the whole purpose of carrying a generation; rewinding them would make a stale identity
    ///        silently name a fresh slot.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Reset();

    /// 🧩 How many slots stand enrolled.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    std::uint32_t EnrolledCount() const;

private:

    /// 🧩 The slot ordinal one identity names, or the capacity when it names none.
    std::uint32_t Slot(ControlIdentity Claimed) const;

    MotionIntegrator*  Motion                        = nullptr;   // [-] - borrowed; never owned
    ControlPose        Poses[ControlCapacity]        = {};        // [-] - one per enrolled control
    std::uint32_t      Generations[ControlCapacity]  = {};        // [-] - zero declares the slot never issued
    std::uint32_t      EnrolledSlots                 = 0u;        // [-] - how many have been claimed
    std::uint32_t      IssuedGeneration              = 0u;        // [-] - rises with every Reset, never falls

    float              ArrivedAlong                  = 0.0f;      // [px] - this tick's pointer, sampled at Advance
    float              ArrivedAcross                 = 0.0f;      // [px]

    ControlIdentity    SeizedControl                 = {};        // 🔴 [-] - at most one, ever
    ControlPart        SeizedPart                    = ControlPart::Nothing;   // [-]
    ControlIdentity    ReleasedControl               = {};        // [-] - the seizure this tick retired
    ControlPart        ReleasedPart                  = ControlPart::Nothing;   // [-] - its addressed part
    float              SeizedOriginAlong             = 0.0f;      // [px] - where the contact arrived
    float              SeizedOriginAcross            = 0.0f;      // [px]
    float              SeizedDeparted                = 0.0f;      // [-]  - the datum at seizure
    bool               DepartedRecorded              = false;     // [-]  - DepartFrom was called for it

    ControlIdentity    DisclosedControl              = {};        // 🔴 [-] - at most one, ever
};

}   // namespace Slate
