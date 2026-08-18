//============================================================================================================================================
//                                                            GESTURESEQUENCE.H
//============================================================================================================================================
// 🧩 One pointer contact resolved into a phase, a travel since arrival, a smoothed rate and a tap verdict.

#pragma once

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE CONTACT PHASE
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Where one contact stands in its own lifetime.
/// note  🔴 Exactly one tick reports `Arrived` and exactly one reports `Released`, even when the window
///       system delivers both in the same tick. A consumer that seizes on `Arrived` and resolves on
///       `Released` therefore never loses either edge to a stalled or coalesced tick.
/// tag   contract
enum class ContactPhase : std::uint32_t
{
    Absent     = 0u,   // [-] - nothing is held
    Arrived    = 1u,   // [-] - contact went down during this tick
    Travelling = 2u,   // [-] - contact is held and has been held since a previous tick
    Released   = 3u,   // [-] - contact came up during this tick
    PhaseCount = 4u    // [-] - the closed count, never a phase
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE TOLERANCES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 What separates a tap from a drag, and a drag from a fling.
/// tag   contract, nonallocating, nonthrowing
struct GestureTolerance
{
    float   TapTravelCeiling   = 6.0f;    // [px]   - beyond this a contact is a drag and never a tap
    double  TapDurationCeiling = 350.0;   // [ms]   - beyond this a contact is a press and never a tap
    double  RateRetention      = 0.60;    // [-]    - carried from the previous tick's rate estimate
    double  FlingRateFloor     = 300.0;   // [px/s] - beyond this a release carries momentum
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE TRAVEL
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Everything one contact has done since it arrived.
/// note  📐 The rate is smoothed across ticks rather than taken from the last one. A single stalled tick
///       produces an instantaneous rate of several thousand pixels a second from a stationary thumb.
/// tag   contract, nonallocating, nonthrowing
struct ContactTravel
{
    ContactPhase  Phase           = ContactPhase::Absent;   // [-]    - this tick's phase
    float         OriginAlong     = 0.0f;                   // [px]   - where the contact arrived
    float         OriginAcross    = 0.0f;                   // [px]
    float         PositionAlong   = 0.0f;                   // [px]   - where it stands now
    float         PositionAcross  = 0.0f;                   // [px]
    double        TravelAlong     = 0.0;                    // [px]   - accumulated since arrival
    double        TravelAcross    = 0.0;                    // [px]
    double        RateAlong       = 0.0;                    // [px/s] - smoothed, signed
    double        RateAcross      = 0.0;                    // [px/s]
    double        HeldDuration    = 0.0;                    // [ms]   - since arrival
    bool          TravelExceeded  = false;                  // [-]    - passed TapTravelCeiling at least once
    bool          TapResolved     = false;                  // [-]    - Released, within both tap ceilings
    bool          FlingResolved   = false;                  // [-]    - Released above FlingRateFloor across
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Turns one tick's `PointerCondition` into one tick's `ContactTravel`.
/// note  ⚠️ Advance exactly once per tick. Two calls in one tick double every accumulation and halve the
///       measured rate.
/// tag   owning
class GestureSequence
{
public:

    GestureSequence()                                  = default;
    GestureSequence(const GestureSequence&)            = delete;
    GestureSequence& operator=(const GestureSequence&) = delete;
    ~GestureSequence()                                 = default;

    /// 🧩 Replaces the tolerances the next contact is resolved against.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Declare(const GestureTolerance& Declared);

    /// 🧩 Advances one tick and reports what the contact did.
    /// in    Arrived  [-]   what `RecordingSurface::Pointer` sampled this tick
    /// in    Elapsed  [ms]  what the same tick's display condition measured
    /// out   Travel   [-]   valid until the next Advance
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    const ContactTravel& Advance(const PointerCondition& Arrived, double Elapsed);

    /// 🧩 What the previous Advance reported.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    const ContactTravel& Standing() const;

    /// 🧩 Drops the live contact without reporting a release — what a resize does.
    /// post  the next Advance reports Absent until a fresh contact arrives
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Abandon();

    /// 🧩 Returns the sequence to its constructed condition, tolerances included.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void Reset();

private:

    GestureTolerance  Tolerance        = {};      // [-] - as declared
    ContactTravel     Reported         = {};      // [-] - this tick's report
    bool              ContactLive      = false;   // [-] - a contact stands between Arrived and Released
    bool              ReleaseDeferred  = false;   // [-] - press and release landed in one tick
    bool              CancelDeferred   = false;   // [-] - Abandon was called while a contact stood
};

}   // namespace Slate
