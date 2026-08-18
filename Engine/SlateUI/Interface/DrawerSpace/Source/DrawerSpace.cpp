//============================================================================================================================================
//                                                             DRAWERSPACE.CPP
//============================================================================================================================================
// 🧩 Grab arbitration, elastic constraint, the two snap arbitrations, and the clipped tongue.

#include "SlateUI/Interface/DrawerSpace/Api/DrawerSpace.h"

#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE FIGURES
//------------------------------------------------------------------------------------------------------------------------

namespace
{

constexpr float  ClickMargin     = 12.0f;    // [px] - extra reach around the tongue and the grip
constexpr float  GutterAcross    = 28.0f;    // [px] - the edge strip a withdrawn drawer is swiped in from
constexpr float  ExtentTolerance = 0.5f;     // [px] - below this the display extent did not move

/// 🧩 Admits travel beyond a constraint at the declared elasticity.
/// cost  ✔️
double Constrain(double Ordinate, double Least, double Most, double Elasticity)
{
    if (Ordinate < Least)
        return Least - (Least - Ordinate) * Elasticity;

    if (Ordinate > Most)
        return Most + (Ordinate - Most) * Elasticity;

    return Ordinate;
}

/// 🧩 Expands an extent by the click margin on every side.
/// cost  ✔️
PlaneExtent Reach(const PlaneExtent& Exact)
{
    return PlaneExtent{ Exact.LeastAlong  - ClickMargin, Exact.LeastAcross - ClickMargin,
                        Exact.MostAlong   + ClickMargin, Exact.MostAcross  + ClickMargin };
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                      CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> DrawerSpace::Construct(MotionIntegrator&              Integrator,
                                     const AppearanceSpecification& Resolved,
                                     const DrawerDeclaration&       North,
                                     const DrawerDeclaration&       South,
                                     const DisplayCondition&        Arrived)
{
    if (Arrived.ExtentAlong <= 0.0f || Arrived.ExtentAcross <= 0.0f)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the display extent is not positive" });

    if (Motion != nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the arrangement already stands" });

    // 📝 🔴 All four enrolments are attempted before any ordinal is retained. An integrator that declines
    //    the third delivers slot zero for it, and the south tongue would then drive the north drawer's
    //    across ordinate — a defect with no operand and no error.
    const Deliver<std::uint32_t> NorthAcross = Integrator.EnrolSpring(Resolved.Motion, 0.0);
    const Deliver<std::uint32_t> NorthTongue = Integrator.EnrolSpring(Resolved.Motion, 0.0);
    const Deliver<std::uint32_t> SouthAcross = Integrator.EnrolSpring(Resolved.Motion, 0.0);
    const Deliver<std::uint32_t> SouthTongue = Integrator.EnrolSpring(Resolved.Motion, 0.0);

    if (!NorthAcross.ContentPresent || !NorthTongue.ContentPresent ||
        !SouthAcross.ContentPresent || !SouthTongue.ContentPresent)
    {
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the integrator declined a drawer spring" });
    }

    Motion       = &Integrator;
    Appearance   = &Resolved;
    ExtentAlong  = Arrived.ExtentAlong;
    ExtentAcross = Arrived.ExtentAcross;

    Slots[0]              = {};
    Slots[1]              = {};
    Slots[0].Declared     = North;
    Slots[1].Declared     = South;
    Slots[0].AcrossSpring = NorthAcross.Resolve();
    Slots[0].TongueSpring = NorthTongue.Resolve();
    Slots[1].AcrossSpring = SouthAcross.Resolve();
    Slots[1].TongueSpring = SouthTongue.Resolve();

    Contacts.Reset();
    GrabbedBy = DrawerBearing::BearingCount;

    Seat(DrawerBearing::North, DrawerPose::Closed);
    Seat(DrawerBearing::South, DrawerPose::Closed);

    return Deliver<bool>::Deliver(true);
}

void DrawerSpace::Reset()
{
    Motion       = nullptr;
    Appearance   = nullptr;
    Slots[0]     = {};
    Slots[1]     = {};
    ExtentAlong  = 0.0f;
    ExtentAcross = 0.0f;
    GrabbedBy    = DrawerBearing::BearingCount;

    Contacts.Reset();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      REARRANGEMENT
//------------------------------------------------------------------------------------------------------------------------

bool DrawerSpace::Rearrange(const DisplayCondition& Arrived)
{
    if (Motion == nullptr || Appearance == nullptr)
        return false;

    if (Arrived.ExtentAlong <= 0.0f || Arrived.ExtentAcross <= 0.0f)
        return false;

    // 📝 🔴 The gate the previous arrangement did not have. Re-solving is correct exactly when the extent
    //    moved; on every other tick it re-seats each spring onto its pose ordinate, drops the live grab and
    //    erases the drag one tick after it began.
    const bool Altered = std::fabs(Arrived.ExtentAlong  - ExtentAlong)  > ExtentTolerance
                      || std::fabs(Arrived.ExtentAcross - ExtentAcross) > ExtentTolerance;

    if (!Altered)
        return false;

    ExtentAlong  = Arrived.ExtentAlong;
    ExtentAcross = Arrived.ExtentAcross;

    const float Admissible = TongueAdmissible();

    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < 2u; ++SlotOrdinal)
    {
        DrawerSlot&         Standing = Slots[SlotOrdinal];
        const DrawerBearing Bearing  = static_cast<DrawerBearing>(SlotOrdinal);

        Standing.Seized         = GrabSubject::Nothing;
        Standing.AxisResolved   = false;
        Standing.AcrossDominant = false;
        Standing.TravelAcross   = 0.0;
        Standing.ReleaseRate    = 0.0;
        Standing.StandingCount  = 0u;
        Standing.PendingCount   = 0u;

        Motion->Spring(Standing.AcrossSpring).Seat(PoseOrdinate(Bearing, Standing.Standing));

        // 📝 The tongue's travel is clamped rather than re-derived. It is the artist's own placement along
        //    the edge and carries no fraction of the extent.
        if (Standing.TongueTravel >  Admissible) Standing.TongueTravel =  Admissible;
        if (Standing.TongueTravel < -Admissible) Standing.TongueTravel = -Admissible;

        Motion->Spring(Standing.TongueSpring).Seat(static_cast<double>(Standing.TongueTravel));
    }

    // 📝 The contact is abandoned rather than released. A drag arbitrated against an extent that no longer
    //    exists resolves to a pose the artist never asked for.
    Contacts.Abandon();
    GrabbedBy = DrawerBearing::BearingCount;

    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    POSES AND ORDINATES
//------------------------------------------------------------------------------------------------------------------------

const DrawerSpace::DrawerSlot& DrawerSpace::Slot(DrawerBearing Bearing) const
{
    return Slots[(Bearing == DrawerBearing::South) ? 1u : 0u];
}

DrawerSpace::DrawerSlot& DrawerSpace::Slot(DrawerBearing Bearing)
{
    return Slots[(Bearing == DrawerBearing::South) ? 1u : 0u];
}

double DrawerSpace::PoseOrdinate(DrawerBearing Bearing, DrawerPose Declared) const
{
    const double Extent = static_cast<double>(ExtentAcross);

    if (Bearing == DrawerBearing::North)
        return (Declared == DrawerPose::Open) ? 0.0 : -Extent;

    switch (Declared)
    {
        case DrawerPose::Open: return 0.0;
        case DrawerPose::Half: return Extent * 0.5;
        default:               return Extent;
    }
}

double DrawerSpace::StandingOrdinate(DrawerBearing Bearing) const
{
    if (Motion == nullptr)
        return PoseOrdinate(Bearing, DrawerPose::Closed);

    return Motion->Spring(Slot(Bearing).AcrossSpring).Standing;
}

DrawerPose DrawerSpace::Pose(DrawerBearing Bearing) const
{
    return Slot(Bearing).Standing;
}

GrabSubject DrawerSpace::Grabbed() const
{
    return (GrabbedBy == DrawerBearing::BearingCount) ? GrabSubject::Nothing : Slot(GrabbedBy).Seized;
}

void DrawerSpace::Seat(DrawerBearing Bearing, DrawerPose Declared)
{
    if (Motion == nullptr)
        return;

    DrawerSlot& Standing = Slot(Bearing);

    if (Standing.Declared.PoseCount < 3u && Declared == DrawerPose::Half)
        Declared = DrawerPose::Closed;

    Standing.Standing = Declared;
    Motion->Spring(Standing.AcrossSpring).Seat(PoseOrdinate(Bearing, Declared));
}

void DrawerSpace::Depart(DrawerBearing Bearing, DrawerPose Declared)
{
    if (Motion == nullptr)
        return;

    DrawerSlot& Standing = Slot(Bearing);

    if (Standing.Declared.PoseCount < 3u && Declared == DrawerPose::Half)
        Declared = DrawerPose::Closed;

    Standing.Standing = Declared;

    SpringInterpolant& Travelling = Motion->Spring(Standing.AcrossSpring);
    Travelling.Target  = PoseOrdinate(Bearing, Declared);
    Travelling.Settled = false;
}

DrawerPose DrawerSpace::Advanced(DrawerBearing Bearing) const
{
    const DrawerSlot& Standing = Slot(Bearing);

    if (Standing.Declared.PoseCount < 3u)
        return (Standing.Standing == DrawerPose::Open) ? DrawerPose::Closed : DrawerPose::Open;

    switch (Standing.Standing)
    {
        case DrawerPose::Closed: return DrawerPose::Half;
        case DrawerPose::Half:   return DrawerPose::Open;
        default:                 return DrawerPose::Closed;
    }
}

DrawerPose DrawerSpace::Withdrawing(DrawerBearing Bearing) const
{
    const DrawerSlot& Standing = Slot(Bearing);

    if (Standing.Declared.PoseCount < 3u)
        return DrawerPose::Closed;

    return (Standing.Standing == DrawerPose::Open) ? DrawerPose::Half : DrawerPose::Closed;
}

float DrawerSpace::TongueAdmissible() const
{
    if (Appearance == nullptr)
        return 0.0f;

    const float Ceiling = (ExtentAlong - Appearance->Measure.TongueAlong) * 0.5f;
    return (Ceiling > 0.0f) ? Ceiling : 0.0f;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE SNAP ARBITRATION
//------------------------------------------------------------------------------------------------------------------------

// 📐 🔴 Transcribed literally from the source's two release handlers. Two operands, and they are not the
//    same operand in the two drawers. The north drawer compares the release's own displacement against a
//    quarter of the extent. The south drawer compares `h + offset.y` — the extent **plus** the displacement —
//    against fractions of the extent, which is the quantity its handler names `Be`.
// 📝 The nesting is the source's too. `closed` and `full` each gate an inner pair behind an outer condition.
DrawerPose DrawerSpace::Classify(DrawerBearing Bearing) const
{
    const DrawerSlot&  Standing = Slot(Bearing);
    const MotionScale& Figures  = Appearance->Motion;

    const double Extent       = static_cast<double>(ExtentAcross);
    const double Displacement = Standing.TravelAcross;
    const double Rate         = Standing.ReleaseRate;
    const double Near         = Extent * Figures.SnapFractionNear;
    const double Far          = Extent * Figures.SnapFractionFar;

    if (Bearing == DrawerBearing::North)
    {
        if (Standing.Standing == DrawerPose::Open)
            return (Displacement < -Near || Rate < -Figures.SnapRateSoft) ? DrawerPose::Closed : DrawerPose::Open;

        return (Displacement > Near || Rate > Figures.SnapRateSoft) ? DrawerPose::Open : DrawerPose::Closed;
    }

    // 📐 The source's `Be`. The south drawer rests at `h` when closed and at zero when full, so this is the
    //    ordinate the release would have left it at had nothing been constrained.
    const double Reached = Extent + Displacement;

    if (Standing.Standing == DrawerPose::Closed)
    {
        if (Rate < -Figures.SnapRateFirm || Reached < Far)
            return (Rate < -Figures.SnapRateHard || Reached < Near) ? DrawerPose::Open : DrawerPose::Half;

        return DrawerPose::Closed;
    }

    if (Standing.Standing == DrawerPose::Half)
    {
        if (Rate < -Figures.SnapRateSoft || Reached < Near) return DrawerPose::Open;
        if (Rate >  Figures.SnapRateSoft || Reached > Far)  return DrawerPose::Closed;
        return DrawerPose::Half;
    }

    if (Rate > Figures.SnapRateFirm || Reached > Near)
        return (Rate > Figures.SnapRateHard || Reached > Far) ? DrawerPose::Closed : DrawerPose::Half;

    return DrawerPose::Open;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE GRAB ARBITRATION
//------------------------------------------------------------------------------------------------------------------------

GrabSubject DrawerSpace::Contacted(DrawerBearing Bearing, float Along, float Across) const
{
    const DrawerSlot& Standing = Slot(Bearing);
    const bool        Visible  = !Withdrawn(Bearing);

    // ① The grip outranks the body it sits inside, so that a contact on the pill withdraws rather than drags.
    // 📝 The grip keeps its margin on all four sides: it sits INSIDE the drawer's own body, so an inflated
    //    reach can only take pixels from the body beside it and never from the workspace beyond.
    if (Visible && Reach(Grip(Bearing)).Encloses(Along, Across))
        return GrabSubject::Grip;

    // ② The tongue outranks everything, visible or not — it is the only chrome a closed drawer offers.
    // 🔴 Reached ALONG only, never across. `Reach` inflates all four sides by the click margin, which on
    //    the leading edge pushes the claim twelve pixels past the notch and INTO the workspace: a 36 px
    //    tongue claimed 48 px of depth, and the artist met an invisible band below a notch they could see
    //    the bottom of. Across the drawer's own axis the notch's drawn edge is the edge that may be
    //    pressed; along it the margin is what makes a narrow pill comfortable to hit.
    const PlaneExtent Notch   = Tongue(Bearing);
    const PlaneExtent Reached = { Notch.LeastAlong - ClickMargin, Notch.LeastAcross,
                                  Notch.MostAlong  + ClickMargin, Notch.MostAcross };

    if (Reached.Encloses(Along, Across))
        return GrabSubject::Tongue;

    if (Visible && Body(Bearing).Encloses(Along, Across))
    {
        for (std::uint32_t Ordinal = 0u; Ordinal < Standing.StandingCount; ++Ordinal)
        {
            if (Standing.Standing_Excluded[Ordinal].Encloses(Along, Across))
                return GrabSubject::Nothing;
        }

        return GrabSubject::Body;
    }

    // ③ The gutter — what makes a swipe from the display edge open a drawer that has no body on screen.
    if (!Visible && Gutter(Bearing).Encloses(Along, Across))
        return GrabSubject::Gutter;

    return GrabSubject::Nothing;
}

bool DrawerSpace::Claims(float Along, float Across, DrawerBearing& Bearing) const
{
    // 🔴 The OPEN drawer is asked first, both of them, before either withdrawn one. A raised body reaches
    //    across the display and can cover the other drawer's gutter; the drawer the artist raised is the
    //    one they mean, so it takes the contact rather than the strip hiding beneath it.
    for (std::uint32_t Ordinal = 0u; Ordinal < static_cast<std::uint32_t>(DrawerBearing::BearingCount); ++Ordinal)
    {
        const DrawerBearing Asked = static_cast<DrawerBearing>(Ordinal);

        if (Withdrawn(Asked))
            continue;

        if (Contacted(Asked, Along, Across) != GrabSubject::Nothing)
        {
            Bearing = Asked;
            return true;
        }
    }

    // 📝 Then the withdrawn ones, for their tongue and their gutter — the only chrome a closed drawer has.
    for (std::uint32_t Ordinal = 0u; Ordinal < static_cast<std::uint32_t>(DrawerBearing::BearingCount); ++Ordinal)
    {
        const DrawerBearing Asked = static_cast<DrawerBearing>(Ordinal);

        if (!Withdrawn(Asked))
            continue;

        if (Contacted(Asked, Along, Across) != GrabSubject::Nothing)
        {
            Bearing = Asked;
            return true;
        }
    }

    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE TICK
//------------------------------------------------------------------------------------------------------------------------

bool DrawerSpace::Advance(const PointerCondition& Arrived, double Elapsed, bool Available)
{
    if (Motion == nullptr || Appearance == nullptr)
        return false;

    PromoteExclusions();

    // 📝 A pointer the interface has taken for a window of its own must not also drag a drawer. A grab
    //    already live is carried to its release regardless: the window did not exist when it began.
    if (!Available && GrabbedBy == DrawerBearing::BearingCount)
    {
        Contacts.Abandon();
        return false;
    }

    const ContactTravel& Contact = Contacts.Advance(Arrived, Elapsed);

    switch (Contact.Phase)
    {
        case ContactPhase::Arrived:    return Seize(Contact);
        case ContactPhase::Travelling: return Carry(Contact);
        case ContactPhase::Released:   return Relinquish(Contact);
        default:                       break;
    }

    return GrabbedBy != DrawerBearing::BearingCount;
}

bool DrawerSpace::Seize(const ContactTravel& Contact)
{
    // 📝 Tested in reverse paint order, so the drawer drawn on top is the drawer a contact reaches first.
    const bool          SouthAbove = (Slots[1].Standing == DrawerPose::Open);
    const DrawerBearing Order[2]   = { SouthAbove ? DrawerBearing::South : DrawerBearing::North,
                                       SouthAbove ? DrawerBearing::North : DrawerBearing::South };

    for (std::uint32_t Ordinal = 0u; Ordinal < 2u; ++Ordinal)
    {
        const DrawerBearing Bearing = Order[Ordinal];
        const GrabSubject   Seized  = Contacted(Bearing, Contact.PositionAlong, Contact.PositionAcross);

        if (Seized == GrabSubject::Nothing)
            continue;

        DrawerSlot& Standing = Slot(Bearing);

        Standing.Seized         = Seized;
        Standing.AxisResolved   = (Seized != GrabSubject::Tongue);
        Standing.AcrossDominant = (Seized != GrabSubject::Tongue);
        Standing.SeatedOrdinate = StandingOrdinate(Bearing);
        Standing.TongueSeated   = Standing.TongueTravel;
        Standing.TravelAcross   = 0.0;
        Standing.ReleaseRate    = 0.0;

        GrabbedBy = Bearing;
        return true;
    }

    return false;
}

bool DrawerSpace::Carry(const ContactTravel& Contact)
{
    if (GrabbedBy == DrawerBearing::BearingCount)
        return false;

    DrawerSlot& Standing = Slot(GrabbedBy);

    Standing.TravelAcross = Contact.TravelAcross;
    Standing.ReleaseRate  = Contact.RateAcross;

    // 📐 The tongue's axis is decided once, on the first travel that clears the tap ceiling, and by the
    //    larger of the two displacements. Deciding it per tick makes a diagonal drag alternate between
    //    sliding the notch and opening the drawer.
    if (Standing.Seized == GrabSubject::Tongue && !Standing.AxisResolved && Contact.TravelExceeded)
    {
        Standing.AcrossDominant = std::fabs(Contact.TravelAcross) > std::fabs(Contact.TravelAlong);
        Standing.AxisResolved   = true;
    }

    if (Standing.Seized == GrabSubject::Tongue && !Standing.AcrossDominant)
    {
        CarryTongue(Standing, Contact);
        return true;
    }

    if (Standing.Seized != GrabSubject::Nothing)
        CarryBody(Standing, Contact);

    return true;
}

void DrawerSpace::CarryBody(DrawerSlot& Standing, const ContactTravel& Contact)
{
    const bool   Northern = (GrabbedBy == DrawerBearing::North);
    const double Least    = Northern ? -static_cast<double>(ExtentAcross) : 0.0;
    const double Most     = Northern ?  0.0 : static_cast<double>(ExtentAcross);
    const double Dragged  = Standing.SeatedOrdinate + Contact.TravelAcross;

    Motion->Spring(Standing.AcrossSpring)
           .Seat(Constrain(Dragged, Least, Most, Appearance->Motion.DragElasticity));
}

void DrawerSpace::CarryTongue(DrawerSlot& Standing, const ContactTravel& Contact)
{
    const double Admissible = static_cast<double>(TongueAdmissible());
    const double Dragged    = static_cast<double>(Standing.TongueSeated) + Contact.TravelAlong;

    Standing.TongueTravel = static_cast<float>(
        Constrain(Dragged, -Admissible, Admissible, Appearance->Motion.DragElasticity));

    Motion->Spring(Standing.TongueSpring).Seat(static_cast<double>(Standing.TongueTravel));
}

bool DrawerSpace::Relinquish(const ContactTravel& Contact)
{
    if (GrabbedBy == DrawerBearing::BearingCount)
        return false;

    DrawerSlot&  Standing   = Slot(GrabbedBy);
    const float  Admissible = TongueAdmissible();

    Standing.TravelAcross = Contact.TravelAcross;
    Standing.ReleaseRate  = Contact.RateAcross;

    const bool TongueAlong = (Standing.Seized == GrabSubject::Tongue) && !Standing.AcrossDominant;

    if (Contact.TapResolved && Standing.Seized == GrabSubject::Tongue)
    {
        // 📝 The tap the previous arrangement did not have. Its comment argued the source declares no press
        //    handler on the notch; a notch that cannot be tapped is a notch the artist reports as dead.
        Depart(GrabbedBy, Advanced(GrabbedBy));
    }
    else if (Contact.TapResolved && Standing.Seized == GrabSubject::Grip)
    {
        Depart(GrabbedBy, Withdrawing(GrabbedBy));
    }
    else if (TongueAlong)
    {
        SpringInterpolant& Travelling = Motion->Spring(Standing.TongueSpring);

        const float Settled = (Standing.TongueTravel >  Admissible) ?  Admissible
                            : (Standing.TongueTravel < -Admissible) ? -Admissible
                                                                    :  Standing.TongueTravel;

        Standing.TongueTravel = Settled;
        Travelling.Target     = static_cast<double>(Settled);
        Travelling.Settled    = (std::fabs(Travelling.Standing - Travelling.Target) < 0.1);
    }
    else
    {
        Depart(GrabbedBy, Classify(GrabbedBy));

        // 📐 The release's own rate is injected into the spring rather than discarded. A spring departing
        //    from rest arrives visibly later than the flick that asked for it.
        Motion->Spring(Standing.AcrossSpring).Rate = Contact.RateAcross / 1000.0;
    }

    Loosen();
    return true;
}

void DrawerSpace::Loosen()
{
    if (GrabbedBy == DrawerBearing::BearingCount)
        return;

    DrawerSlot& Standing = Slot(GrabbedBy);

    Standing.Seized         = GrabSubject::Nothing;
    Standing.AxisResolved   = false;
    Standing.AcrossDominant = false;
    Standing.TravelAcross   = 0.0;
    Standing.ReleaseRate    = 0.0;

    GrabbedBy = DrawerBearing::BearingCount;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE EXTENTS
//------------------------------------------------------------------------------------------------------------------------

PlaneExtent DrawerSpace::Body(DrawerBearing Bearing) const
{
    return Spanning(0.0f, static_cast<float>(StandingOrdinate(Bearing)), ExtentAlong, ExtentAcross);
}

PlaneExtent DrawerSpace::Interior(DrawerBearing Bearing) const
{
    PlaneExtent Occupied = Body(Bearing);

    if (Appearance == nullptr)
        return Occupied;

    const float Strip = Appearance->Measure.GripStripAcross;

    if (Bearing == DrawerBearing::North)
        Occupied.MostAcross -= Strip;
    else
        Occupied.LeastAcross += Strip;

    return Occupied;
}

PlaneExtent DrawerSpace::Tongue(DrawerBearing Bearing) const
{
    if (Appearance == nullptr)
        return {};

    const MetricScale& Measure  = Appearance->Measure;
    const PlaneExtent  Occupied = Body(Bearing);
    const float        Centre   = ExtentAlong * 0.5f + Slot(Bearing).TongueTravel;
    const float        Leading  = Centre - Measure.TongueAlong * 0.5f;

    if (Bearing == DrawerBearing::North)
        return Spanning(Leading, Occupied.MostAcross, Measure.TongueAlong, Measure.TongueAcross);

    return Spanning(Leading, Occupied.LeastAcross - Measure.TongueAcross,
                    Measure.TongueAlong, Measure.TongueAcross);
}

PlaneExtent DrawerSpace::Grip(DrawerBearing Bearing) const
{
    if (Appearance == nullptr)
        return {};

    const MetricScale& Measure  = Appearance->Measure;
    const PlaneExtent  Occupied = Body(Bearing);
    const bool         Northern = (Bearing == DrawerBearing::North);

    const float PillAlong  = ExtentAlong * 0.5f - Measure.GripAlong * 0.5f;
    const float PillAcross = Northern
                           ? Occupied.MostAcross  - Measure.GripLiftNorth - Measure.GripAcross
                           : Occupied.LeastAcross + (Measure.GripStripAcross - Measure.GripAcross) * 0.5f;

    return Spanning(PillAlong, PillAcross, Measure.GripAlong, Measure.GripAcross);
}

PlaneExtent DrawerSpace::Gutter(DrawerBearing Bearing) const
{
    if (!Withdrawn(Bearing) || Appearance == nullptr)
        return {};

    // 🔴 The gutter spans the TONGUE and nothing more. Spanning the whole display edge put an invisible
    //    28 px band across the full width, top and bottom, that swallowed every contact near either edge —
    //    an artist reaching for a tab, a window's resize corner, or the workspace itself got a drawer
    //    swipe from a strip they could not see. The only chrome a withdrawn drawer offers is its tongue,
    //    so the only place it may claim a contact is the tongue's own run.
    // 📝 A shade wider than the tongue, by half the gutter's own depth, so a swipe that begins a pixel
    //    outside the notch still opens the drawer rather than reporting nothing.
    const PlaneExtent Notch   = Tongue(Bearing);
    const float       Reached = GutterAcross * 0.5f;

    const float Leading  = Notch.LeastAlong - Reached;
    const float Trailing = Notch.MostAlong  + Reached;

    if (Bearing == DrawerBearing::North)
        return PlaneExtent{ Leading, 0.0f, Trailing, GutterAcross };

    return PlaneExtent{ Leading, ExtentAcross - GutterAcross, Trailing, ExtentAcross };
}

bool DrawerSpace::Withdrawn(DrawerBearing Bearing) const
{
    const PlaneExtent Occupied = Body(Bearing);

    return Occupied.MostAcross <= 0.0f || Occupied.LeastAcross >= ExtentAcross;
}

bool DrawerSpace::Moving() const
{
    if (Motion == nullptr)
        return false;

    if (GrabbedBy != DrawerBearing::BearingCount)
        return true;

    return !Motion->Spring(Slots[0].AcrossSpring).Settled
        || !Motion->Spring(Slots[1].AcrossSpring).Settled
        || !Motion->Spring(Slots[0].TongueSpring).Settled
        || !Motion->Spring(Slots[1].TongueSpring).Settled;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE EXCLUSIONS
//------------------------------------------------------------------------------------------------------------------------

void DrawerSpace::Exclude(DrawerBearing Bearing, const PlaneExtent& Extent)
{
    DrawerSlot& Standing = Slot(Bearing);

    if (Standing.PendingCount >= ExclusionCapacity)
        return;

    Standing.Pending_Excluded[Standing.PendingCount++] = Extent;
}

void DrawerSpace::PromoteExclusions()
{
    // 📝 A panel declares its exclusions while recording, which happens after arbitration. Promoting the
    //    previous tick's set is what lets the two run in that order without the set growing without bound.
    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < 2u; ++SlotOrdinal)
    {
        DrawerSlot& Standing = Slots[SlotOrdinal];

        for (std::uint32_t Ordinal = 0u; Ordinal < Standing.PendingCount; ++Ordinal)
            Standing.Standing_Excluded[Ordinal] = Standing.Pending_Excluded[Ordinal];

        Standing.StandingCount = Standing.PendingCount;
        Standing.PendingCount  = 0u;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE RECORDING
//------------------------------------------------------------------------------------------------------------------------

void DrawerSpace::Record(RecordingSurface& Surface) const
{
    if (Appearance == nullptr)
        return;

    if (Slots[1].Standing == DrawerPose::Open)
    {
        RecordOne(Surface, DrawerBearing::North);
        RecordOne(Surface, DrawerBearing::South);
        return;
    }

    RecordOne(Surface, DrawerBearing::South);
    RecordOne(Surface, DrawerBearing::North);
}

void DrawerSpace::Record(RecordingSurface& Surface, DrawerBearing Bearing) const
{
    if (Appearance == nullptr)
        return;

    RecordOne(Surface, Bearing);
}

void DrawerSpace::RecordOne(RecordingSurface& Surface, DrawerBearing Bearing) const
{
    const SurfaceInk&  Ink      = Appearance->Ink;
    const MetricScale& Measure  = Appearance->Measure;
    const DrawerSlot&  Standing = Slot(Bearing);
    const PlaneExtent  Occupied = Body(Bearing);
    const PlaneExtent  Tab      = Tongue(Bearing);
    const bool         Northern = (Bearing == DrawerBearing::North);
    const bool         Visible  = !Withdrawn(Bearing);

    if (Visible)
    {
        // ① The drawer body.
        Surface.Ground(Occupied, Ink.SurfaceStanding, 0.0f, CornerNone);

        // ② The one edge the source declares — a rule on the travelling side only.
        const float EdgeAcross = Northern ? Occupied.MostAcross : Occupied.LeastAcross;

        Surface.Ground(PlaneExtent{ Occupied.LeastAlong, EdgeAcross - (Northern ? 1.0f : 0.0f),
                                    Occupied.MostAlong,  EdgeAcross + (Northern ? 0.0f : 1.0f) },
                       Ink.EdgeQuiet, 0.0f, CornerNone);

        // ③ The grip pill, centred along, lifted from the travelling edge.
        Surface.Ground(Grip(Bearing), Ink.GripPill, Measure.GripAcross * 0.5f, CornerAll);
    }

    // ④ The tongue's clipped outline — always drawn so the notch is reachable when closed.
    const float Inset = Tab.SpanAlong() * Measure.TongueClipFraction;
    const float Least = Tab.LeastAlong;
    const float Most  = Tab.MostAlong;
    const float Upper = Tab.LeastAcross;
    const float Lower = Tab.MostAcross;

    const float NorthOutline[8] = { Least,         Upper, Most,          Upper,
                                    Most - Inset,  Lower, Least + Inset, Lower };
    const float SouthOutline[8] = { Least + Inset, Upper, Most - Inset,  Upper,
                                    Most,          Lower, Least,         Lower };

    Surface.Tongue(Northern ? NorthOutline : SouthOutline, 4u, Ink.SurfaceSunken);

    // ⑤ The tongue's figure and its run, measured together and centred inside the pad.
    const char* Caption = Standing.Declared.Caption;
    const float RunSpan = Surface.MeasureRun(Caption, Measure.TextSmall, Measure.TrackingWide);
    const float Content = Measure.SymbolTongue + Measure.TongueGapAlong + RunSpan;
    const float Origin  = (Least + Most) * 0.5f - Content * 0.5f;
    const float Middle  = (Upper + Lower) * 0.5f;

    Surface.Stroke(Standing.Declared.TongueSubject,
                   Spanning(Origin, Middle - Measure.SymbolTongue * 0.5f,
                            Measure.SymbolTongue, Measure.SymbolTongue),
                   Ink.InkPrimary);

    Surface.TextRunCapitalised(Origin + Measure.SymbolTongue + Measure.TongueGapAlong,
                               Middle - Measure.TextSmall * 0.5f,
                               Ink.InkPrimary, Caption, Measure.TextSmall, Measure.TrackingWide, true);
}

}   // namespace Slate
