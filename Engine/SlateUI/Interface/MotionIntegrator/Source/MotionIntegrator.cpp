//============================================================================================================================================
//                                                          MOTIONINTEGRATOR.CPP
//============================================================================================================================================
// 🧩 A semi-implicit spring, a Newton-solved cubic ease, and the one sweep that retires both.

#include "SlateUI/Interface/MotionIntegrator/Api/MotionIntegrator.h"

#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     SETTLING CRITERIA
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📐 Both criteria are display-pixel figures and both must hold. A tenth of a pixel is below what any
//    display resolves, and a rate of one pixel per second would take ten seconds to cross that tenth —
//    so a spring meeting both is stationary by every measure the artist has.
constexpr double DisplacementCriterion = 0.1;      // [px]
constexpr double RateCriterion         = 0.001;    // [px/ms] - one pixel per second

// 📐 A tick longer than this is not a slow tick, it is a stalled process — a window drag, a breakpoint, a
//    driver reset. Integrating it whole gives the spring one step of eighty pixels and the drawer arrives
//    somewhere it was never travelling toward. The interval is clamped rather than subdivided because a
//    subdivided stall spends the recovery tick integrating the stall.
constexpr double IntervalCeiling = 64.0;   // [ms]

/// 🧩 The abscissa of a cubic Bézier whose endpoints are the origin and unity.
constexpr double CurveAlong(double Parameter, double FirstControl, double SecondControl)
{
    const double Complement = 1.0 - Parameter;

    return 3.0 * Complement * Complement * Parameter * FirstControl
         + 3.0 * Complement * Parameter  * Parameter * SecondControl
         + Parameter * Parameter * Parameter;
}

/// 🧩 The slope of the same cubic, for the Newton step.
constexpr double CurveSlope(double Parameter, double FirstControl, double SecondControl)
{
    const double Complement = 1.0 - Parameter;

    return 3.0 * Complement * Complement * FirstControl
         + 6.0 * Complement * Parameter  * (SecondControl - FirstControl)
         + 3.0 * Parameter  * Parameter  * (1.0 - SecondControl);
}

// 📐 🔴 The four curves the sources declare, and only those four. The browser's
//    `cubic-bezier(a, b, c, d)` gives the abscissa its controls at a and c and the ordinate its controls at b
//    and d, so each curve below carries four figures and the solve inverts the abscissa before reading it.
struct CurveControl
{
    double  FirstAlong   = 0.0;
    double  FirstAcross  = 0.0;
    double  SecondAlong  = 0.0;
    double  SecondAcross = 0.0;
};

constexpr CurveControl DeclaredCurves[static_cast<std::uint32_t>(EaseCurve::CurveCount)] =
{
    /* Standard   */ { 0.4,  0.0,  0.2,  1.0 },
    /* Departing  */ { 0.0,  0.0,  0.58, 1.0 },
    /* Carousel   */ { 0.5,  0.05, 0.2,  1.0 },
    /* CssEase    */ { 0.25, 0.1,  0.25, 1.0 }
};

// 📐 Newton from the fraction itself as the initial estimate. The abscissa is monotone and its slope is
//    bounded away from zero over the whole interval for both curves above, so four steps carry the residue
//    below a thousandth — far under a pixel of the traverses these shape.
constexpr std::uint32_t SolveSteps = 4u;

double CurveOrdinate(double Fraction, EaseCurve Declared)
{
    if (Fraction <= 0.0) return 0.0;
    if (Fraction >= 1.0) return 1.0;

    const std::uint32_t Ordinal = static_cast<std::uint32_t>(Declared);
    const CurveControl& Shape   = DeclaredCurves[(Ordinal < static_cast<std::uint32_t>(EaseCurve::CurveCount))
                                               ? Ordinal : 0u];

    double Parameter = Fraction;

    for (std::uint32_t StepOrdinal = 0u; StepOrdinal < SolveSteps; ++StepOrdinal)
    {
        const double Residue = CurveAlong(Parameter, Shape.FirstAlong, Shape.SecondAlong) - Fraction;
        const double Slope   = CurveSlope(Parameter, Shape.FirstAlong, Shape.SecondAlong);

        if (std::fabs(Slope) < 1.0e-9)
            break;

        Parameter -= Residue / Slope;

        if (Parameter < 0.0) Parameter = 0.0;
        if (Parameter > 1.0) Parameter = 1.0;
    }

    return CurveAlong(Parameter, Shape.FirstAcross, Shape.SecondAcross);
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE SPRING
//------------------------------------------------------------------------------------------------------------------------

// 📐 🔴 Semi-implicit Euler: the rate is advanced first and the ordinate is advanced by the **new** rate.
//    The explicit ordering — ordinate first, from the old rate — injects energy at every step and a spring
//    at ζ ≈ 0.935 stops converging entirely somewhere above a 20 ms tick. This ordering is unconditionally
//    stable for every interval the tick ceiling below admits.
bool SpringInterpolant::Advance(double Elapsed)
{
    if (Settled)
        return false;

    const double Interval = (Elapsed > IntervalCeiling) ? IntervalCeiling
                          : (Elapsed > 0.0)             ? Elapsed
                                                        : 0.0;

    if (Interval <= 0.0)
        return true;

    // 📐 The coefficients are stated per second, as the source states them, and the interval arrives in
    //    milliseconds. Converting the interval once here is one division; converting the coefficients
    //    instead would convert two figures at every one of the four springs on every tick.
    const double Seconds      = Interval / 1000.0;
    const double Displacement = Standing - Target;
    const double Acceleration = -Stiffness * Displacement - Damping * (Rate * 1000.0);

    Rate     = (Rate * 1000.0 + Acceleration * Seconds) / 1000.0;
    Standing = Standing + Rate * Interval;

    if (std::fabs(Standing - Target) < DisplacementCriterion && std::fabs(Rate) < RateCriterion)
    {
        Standing = Target;
        Rate     = 0.0;
        Settled  = true;
        return false;
    }

    return true;
}

void SpringInterpolant::Seat(double Ordinate)
{
    Standing = Ordinate;
    Target   = Ordinate;
    Rate     = 0.0;
    Settled  = true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE EASED TRAVERSE
//------------------------------------------------------------------------------------------------------------------------

bool EasedInterpolant::Advance(double Interval)
{
    if (Settled)
        return false;

    const double Admitted = (Interval > IntervalCeiling) ? IntervalCeiling
                          : (Interval > 0.0)             ? Interval
                                                         : 0.0;

    Elapsed += Admitted;

    if (Elapsed >= Deferral + Duration)
    {
        Elapsed = Deferral + Duration;
        Settled = true;
        return false;
    }

    return true;
}

double EasedInterpolant::Standing() const
{
    if (Duration <= 0.0)
        return Arriving;

    if (Elapsed <= Deferral)
        return Departed;

    const double Fraction = (Elapsed - Deferral) / Duration;

    return Departed + (Arriving - Departed) * CurveOrdinate(Fraction, Shape);
}

void EasedInterpolant::Depart(double From, double To, double Over, double Held, EaseCurve Declared)
{
    Departed = From;
    Arriving = To;
    Duration = (Over > 0.0) ? Over : 1.0;
    Deferral = (Held > 0.0) ? Held : 0.0;
    Elapsed  = 0.0;
    Shape    = Declared;
    Settled  = false;
}

void EasedInterpolant::Seat(double Ordinate)
{
    Departed = Ordinate;
    Arriving = Ordinate;
    Elapsed  = Deferral + Duration;
    Settled  = true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE ENROLMENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> MotionIntegrator::EnrolSpring(const MotionScale& Motion, double Seated)
{
    if (SpringCount >= InterpolantCapacity)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ExtentExhausted, "no spring slot remains" });

    SpringInterpolant& Enrolled = Springs[SpringCount];

    Enrolled            = {};
    Enrolled.Stiffness  = Motion.DrawerStiffness;
    Enrolled.Damping    = Motion.DrawerDamping;
    Enrolled.Seat(Seated);

    return Deliver<std::uint32_t>::Deliver(SpringCount++);
}

Deliver<std::uint32_t> MotionIntegrator::EnrolEased(double Seated)
{
    if (EaseCount >= InterpolantCapacity)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ExtentExhausted, "no eased slot remains" });

    EasedInterpolant& Enrolled = Eases[EaseCount];

    Enrolled = {};
    Enrolled.Seat(Seated);

    return Deliver<std::uint32_t>::Deliver(EaseCount++);
}

SpringInterpolant& MotionIntegrator::Spring(std::uint32_t Ordinal)
{
    return Springs[(Ordinal < SpringCount) ? Ordinal : 0u];
}

const SpringInterpolant& MotionIntegrator::Spring(std::uint32_t Ordinal) const
{
    return Springs[(Ordinal < SpringCount) ? Ordinal : 0u];
}

EasedInterpolant& MotionIntegrator::Eased(std::uint32_t Ordinal)
{
    return Eases[(Ordinal < EaseCount) ? Ordinal : 0u];
}

const EasedInterpolant& MotionIntegrator::Eased(std::uint32_t Ordinal) const
{
    return Eases[(Ordinal < EaseCount) ? Ordinal : 0u];
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE SWEEP
//------------------------------------------------------------------------------------------------------------------------

bool MotionIntegrator::Advance(double Elapsed)
{
    bool Moving = false;

    for (std::uint32_t Ordinal = 0u; Ordinal < SpringCount; ++Ordinal)
        Moving = Springs[Ordinal].Advance(Elapsed) || Moving;

    for (std::uint32_t Ordinal = 0u; Ordinal < EaseCount; ++Ordinal)
        Moving = Eases[Ordinal].Advance(Elapsed) || Moving;

    AnythingMoving = Moving;

    return Moving;
}

bool MotionIntegrator::Moving() const
{
    return AnythingMoving;
}

}   // namespace Slate
