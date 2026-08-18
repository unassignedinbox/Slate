//============================================================================================================================================
//                                                          INTERACTIONINDEX.CPP
//============================================================================================================================================
// 🧩 The one seizure, the one open popup, and the two fades every enrolled control carries.

#include "SlateUI/Interface/InteractionIndex/Api/InteractionIndex.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                        CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> InteractionIndex::Construct(MotionIntegrator& Arriving)
{
    if (Motion != nullptr)
    {
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::ContentUnsupported,
                                                   "InteractionIndex is already constructed" });
    }

    Motion = &Arriving;

    return Deliver<bool>::Deliver(true);
}

Deliver<ControlIdentity> InteractionIndex::Enrol()
{
    if (Motion == nullptr)
    {
        return Deliver<ControlIdentity>::Refuse(Refusal{ RefusalReason::CapabilityAbsent,
                                                          "InteractionIndex was not constructed" });
    }

    if (EnrolledSlots >= ControlCapacity)
    {
        return Deliver<ControlIdentity>::Refuse(Refusal{ RefusalReason::ExtentExhausted,
                                                          "InteractionIndex holds no further control slot" });
    }

    // 📝 🔴 Both fades are enrolled before the slot is claimed. Claiming first and refusing second would leave
    //    a slot enrolled against an interpolant that does not exist, and every later read of it would return
    //    the ordinal zero — which is another control's fade.
    const Deliver<std::uint32_t> RouseEnrolled = Motion->EnrolEased(0.0);

    if (!RouseEnrolled.ContentPresent)
    {
        return Deliver<ControlIdentity>::Refuse(Refusal{ RefusalReason::ExtentExhausted,
                                                          "the integrator declined a rouse fade" });
    }

    const Deliver<std::uint32_t> TakeEnrolled = Motion->EnrolEased(0.0);

    if (!TakeEnrolled.ContentPresent)
    {
        return Deliver<ControlIdentity>::Refuse(Refusal{ RefusalReason::ExtentExhausted,
                                                          "the integrator declined a take fade" });
    }

    const std::uint32_t Claimed = EnrolledSlots;
    ++EnrolledSlots;

    // 📝 The generation rises with every Reset and never falls, so an identity issued before one resolves
    //    false afterwards rather than naming whatever now occupies its ordinal.
    Generations[Claimed] = IssuedGeneration + 1u;

    Poses[Claimed].RouseOrdinal = RouseEnrolled.Resolve();
    Poses[Claimed].TakeOrdinal  = TakeEnrolled.Resolve();
    Poses[Claimed].Enrolled     = true;

    return Deliver<ControlIdentity>::Deliver(ControlIdentity{ Claimed, Generations[Claimed] });
}

std::uint32_t InteractionIndex::Slot(ControlIdentity Claimed) const
{
    if (!Claimed.IdentityDeclared() || Claimed.SlotOrdinal >= EnrolledSlots)
        return ControlCapacity;

    if (Generations[Claimed.SlotOrdinal] != Claimed.SlotGeneration)
        return ControlCapacity;

    return Claimed.SlotOrdinal;
}

bool InteractionIndex::Resolves(ControlIdentity Claimed) const
{
    return Slot(Claimed) != ControlCapacity;
}

std::uint32_t InteractionIndex::EnrolledCount() const
{
    return EnrolledSlots;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          THE TICK
//------------------------------------------------------------------------------------------------------------------------

void InteractionIndex::Advance(const PointerCondition& Arrived, double Elapsed)
{
    static_cast<void>(Elapsed);

    // 📝 The tick's pointer is retained so that Seize can stamp the arrival ordinates without every control
    //    having to pass them in — and, more to the point, without a control being able to pass in a position
    //    it computed rather than the one the window system reported.
    ArrivedAlong  = Arrived.PositionAlong;
    ArrivedAcross = Arrived.PositionAcross;

    // 📝 🔴 The release is retired here and not at the seizing control. A control whose extent left the
    //    arrangement between two ticks never runs again, and a seizure retired only by that control would
    //    stand for the life of the process — every later contact refused because something invisible holds it.
    ReleasedControl = {};
    ReleasedPart    = ControlPart::Nothing;

    if (SeizedPart != ControlPart::Nothing && !Arrived.ContactHeld)
    {
        ReleasedControl    = SeizedControl;
        ReleasedPart       = SeizedPart;
        SeizedControl      = {};
        SeizedPart         = ControlPart::Nothing;
        SeizedDeparted     = 0.0f;
        DepartedRecorded   = false;
    }
}

bool InteractionIndex::Seize(ControlIdentity Claimed, ControlPart Part)
{
    if (Part == ControlPart::Nothing || Slot(Claimed) == ControlCapacity)
        return false;

    // 🔴 One seizure. A second claim while one stands is refused rather than replacing it, which is what
    //    keeps a drag addressing the control it began on when the pointer crosses a neighbour.
    if (SeizedPart != ControlPart::Nothing)
        return false;

    SeizedControl      = Claimed;
    SeizedPart         = Part;
    SeizedOriginAlong  = ArrivedAlong;
    SeizedOriginAcross = ArrivedAcross;
    SeizedDeparted     = 0.0f;
    DepartedRecorded   = false;

    return true;
}

bool InteractionIndex::Holding(ControlIdentity Claimed) const
{
    return SeizedPart != ControlPart::Nothing && SeizedControl == Claimed && Slot(Claimed) != ControlCapacity;
}

ControlPart InteractionIndex::HeldPart(ControlIdentity Claimed) const
{
    return Holding(Claimed) ? SeizedPart : ControlPart::Nothing;
}

bool InteractionIndex::Released(ControlIdentity Claimed) const
{
    return ReleasedControl.IdentityDeclared() && ReleasedControl == Claimed;
}

ControlPart InteractionIndex::ReleasedControlPart(ControlIdentity Claimed) const
{
    return Released(Claimed) ? ReleasedPart : ControlPart::Nothing;
}

bool InteractionIndex::DepartFrom(ControlIdentity Claimed, float Ordinate)
{
    if (!Holding(Claimed))
        return false;

    SeizedDeparted   = Ordinate;
    DepartedRecorded = true;

    return true;
}

Deliver<float> InteractionIndex::DepartedOrdinate(ControlIdentity Claimed) const
{
    if (!Holding(Claimed) || !DepartedRecorded)
    {
        return Deliver<float>::Refuse(Refusal{ RefusalReason::IdentityStale,
                                                       "this control holds no seizure to depart from" });
    }

    return Deliver<float>::Deliver(SeizedDeparted);
}

float InteractionIndex::OriginAlong() const
{
    return SeizedOriginAlong;
}

float InteractionIndex::OriginAcross() const
{
    return SeizedOriginAcross;
}

void InteractionIndex::Abandon()
{
    SeizedControl    = {};
    SeizedPart       = ControlPart::Nothing;
    ReleasedControl  = {};
    ReleasedPart     = ControlPart::Nothing;
    SeizedDeparted   = 0.0f;
    DepartedRecorded = false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE DISCLOSURE
//------------------------------------------------------------------------------------------------------------------------

bool InteractionIndex::Disclose(ControlIdentity Claimed)
{
    if (Slot(Claimed) == ControlCapacity)
        return false;

    // 🔴 Whatever stood before is closed by the assignment itself. Two open popups cannot be represented.
    DisclosedControl = Claimed;

    return true;
}

void InteractionIndex::Withdraw()
{
    DisclosedControl = {};
}

bool InteractionIndex::Disclosed(ControlIdentity Claimed) const
{
    return DisclosedControl.IdentityDeclared() && DisclosedControl == Claimed
        && Slot(Claimed) != ControlCapacity;
}

bool InteractionIndex::AnyDisclosed() const
{
    return DisclosedControl.IdentityDeclared();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         THE FADES
//------------------------------------------------------------------------------------------------------------------------

namespace
{

/// 🧩 Departs one eased traverse toward a declared pose, if it is not already heading there.
/// note  📐 Departed from where it **stands**, never from zero or one. A fade re-departed from its endpoint
///        jumps backward the moment the pointer crosses an edge twice inside one duration, which is exactly
///        what a pointer travelling along a column of rows does.
/// cost  ✔️
bool DepartToward(MotionIntegrator& Motion, std::uint32_t Ordinal, bool Toward, double Duration,
                  EaseCurve Shape = EaseCurve::Standard)
{
    EasedInterpolant& Fade    = Motion.Eased(Ordinal);
    const double      Arrival = Toward ? 1.0 : 0.0;

    if (Fade.Settled && Fade.Standing() == Arrival)
        return false;

    if (!Fade.Settled && Fade.Arriving == Arrival)
        return false;

    Fade.Depart(Fade.Standing(), Arrival, Duration, 0.0, Shape);

    return true;
}

}   // namespace

bool InteractionIndex::DeclareRoused(ControlIdentity Claimed, bool Roused, double Duration)
{
    const std::uint32_t Ordinal = Slot(Claimed);

    if (Ordinal == ControlCapacity || Motion == nullptr || !Poses[Ordinal].Enrolled)
        return false;

    return DepartToward(*Motion, Poses[Ordinal].RouseOrdinal, Roused, Duration);
}

bool InteractionIndex::DeclareTaken(ControlIdentity Claimed, bool Taken, double Duration, EaseCurve Shape)
{
    const std::uint32_t Ordinal = Slot(Claimed);

    if (Ordinal == ControlCapacity || Motion == nullptr || !Poses[Ordinal].Enrolled)
        return false;

    return DepartToward(*Motion, Poses[Ordinal].TakeOrdinal, Taken, Duration, Shape);
}

float InteractionIndex::RousedFraction(ControlIdentity Claimed) const
{
    const std::uint32_t Ordinal = Slot(Claimed);

    if (Ordinal == ControlCapacity || Motion == nullptr || !Poses[Ordinal].Enrolled)
        return 0.0f;

    return static_cast<float>(Motion->Eased(Poses[Ordinal].RouseOrdinal).Standing());
}

float InteractionIndex::TakenFraction(ControlIdentity Claimed) const
{
    const std::uint32_t Ordinal = Slot(Claimed);

    if (Ordinal == ControlCapacity || Motion == nullptr || !Poses[Ordinal].Enrolled)
        return 0.0f;

    return static_cast<float>(Motion->Eased(Poses[Ordinal].TakeOrdinal).Standing());
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        RETIREMENT
//------------------------------------------------------------------------------------------------------------------------

void InteractionIndex::Reset()
{
    // 🔴 The generation rises past every ordinal ever issued, so no identity from before this call can ever
    //    resolve again. Rewinding it to zero would make a stale identity name a fresh slot silently.
    ++IssuedGeneration;

    for (std::uint32_t Ordinal = 0u; Ordinal < EnrolledSlots; ++Ordinal)
    {
        Generations[Ordinal] = 0u;
        Poses[Ordinal]       = ControlPose{};
    }

    EnrolledSlots    = 0u;
    DisclosedControl = {};

    Abandon();
}

}   // namespace Slate
