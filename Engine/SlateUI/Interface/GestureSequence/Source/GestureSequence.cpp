//============================================================================================================================================
//                                                           GESTURESEQUENCE.CPP
//============================================================================================================================================
// 🧩 The contact phase machine — one edge per tick, one accumulation, one smoothed rate.

#include "SlateUI/Interface/GestureSequence/Api/GestureSequence.h"

#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      DECLARATION
//------------------------------------------------------------------------------------------------------------------------

void GestureSequence::Declare(const GestureTolerance& Declared)
{
    Tolerance = Declared;
}

const ContactTravel& GestureSequence::Standing() const
{
    return Reported;
}

void GestureSequence::Abandon()
{
    if (ContactLive || ReleaseDeferred)
        CancelDeferred = true;

    ContactLive     = false;
    ReleaseDeferred = false;
    Reported        = {};
}

void GestureSequence::Reset()
{
    Tolerance       = {};
    Reported        = {};
    ContactLive     = false;
    ReleaseDeferred = false;
    CancelDeferred  = false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE TICK
//------------------------------------------------------------------------------------------------------------------------

const ContactTravel& GestureSequence::Advance(const PointerCondition& Arrived, double Elapsed)
{
    Reported.Phase         = ContactPhase::Absent;
    Reported.TapResolved   = false;
    Reported.FlingResolved = false;

    // ① A cancelled contact is swallowed here rather than reported as a release, so that a consumer never
    //    arbitrates a pose from a drag the display extent invalidated underneath it.
    if (CancelDeferred)
    {
        CancelDeferred = false;

        if (Arrived.ContactHeld)
            return Reported;
    }

    // ② A press and a release that land in the same tick are separated across two ticks. Collapsing them
    //    into one report loses whichever edge the consumer does not look at first.
    if (ReleaseDeferred)
    {
        ReleaseDeferred      = false;
        ContactLive          = false;
        Reported.Phase       = ContactPhase::Released;
        Reported.TapResolved = !Reported.TravelExceeded
                             && Reported.HeldDuration <= Tolerance.TapDurationCeiling;
        return Reported;
    }

    // ③ Arrival — everything accumulated is discarded and the origin is stamped.
    if (Arrived.ContactArrived && !ContactLive)
    {
        Reported                = {};
        Reported.Phase          = ContactPhase::Arrived;
        Reported.OriginAlong    = Arrived.PositionAlong;
        Reported.OriginAcross   = Arrived.PositionAcross;
        Reported.PositionAlong  = Arrived.PositionAlong;
        Reported.PositionAcross = Arrived.PositionAcross;

        ContactLive     = true;
        ReleaseDeferred = Arrived.ContactReleased;

        return Reported;
    }

    if (!ContactLive)
        return Reported;

    // ④ Carriage — accumulate travel, integrate the smoothed rate, latch the travel ceiling.
    Reported.PositionAlong  = Arrived.PositionAlong;
    Reported.PositionAcross = Arrived.PositionAcross;
    Reported.TravelAlong   += static_cast<double>(Arrived.TravelAlong);
    Reported.TravelAcross  += static_cast<double>(Arrived.TravelAcross);
    Reported.HeldDuration  += (Elapsed > 0.0) ? Elapsed : 0.0;

    if (Elapsed > 0.0)
    {
        const double InstantAlong  = static_cast<double>(Arrived.TravelAlong)  * 1000.0 / Elapsed;
        const double InstantAcross = static_cast<double>(Arrived.TravelAcross) * 1000.0 / Elapsed;

        Reported.RateAlong  = Reported.RateAlong  * Tolerance.RateRetention
                            + InstantAlong  * (1.0 - Tolerance.RateRetention);
        Reported.RateAcross = Reported.RateAcross * Tolerance.RateRetention
                            + InstantAcross * (1.0 - Tolerance.RateRetention);
    }

    // 📐 The ceiling is measured on the displacement from the origin, not on the path length. A contact that
    //    wanders three pixels out and three back is a tap; one that travels ten and holds is not.
    const double Reach = std::sqrt(Reported.TravelAlong  * Reported.TravelAlong
                                 + Reported.TravelAcross * Reported.TravelAcross);

    if (Reach > static_cast<double>(Tolerance.TapTravelCeiling))
        Reported.TravelExceeded = true;

    if (Arrived.ContactReleased || !Arrived.ContactHeld)
    {
        ContactLive            = false;
        Reported.Phase         = ContactPhase::Released;
        Reported.TapResolved   = !Reported.TravelExceeded
                               && Reported.HeldDuration <= Tolerance.TapDurationCeiling;
        Reported.FlingResolved = std::fabs(Reported.RateAcross) > Tolerance.FlingRateFloor;
        return Reported;
    }

    Reported.Phase = ContactPhase::Travelling;
    return Reported;
}

}   // namespace Slate
